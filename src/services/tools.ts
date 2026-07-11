import { z } from "zod";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { buildReport } from "../engine/report.js";
import { createPaymentBuyer } from "../payments/buyer.js";
import { defaultServices, preflightInput, validatePreflightInput, type PreflightInput, type PreflightServices } from "../preflight.js";
import type { Finding, ProbeResult, ReportEnvelope } from "../types.js";

export const deepCheckInput = preflightInput.extend({ owner_attestation: z.literal(true) });
export type DeepCheckInput = z.infer<typeof deepCheckInput>;

export interface DeepPaidCallResult {
  ok: boolean;
  status: number;
  body: unknown;
  parseable: boolean;
  payer: string;
  latencyMs: number;
  receipt: { transaction?: string; status?: string; network?: string } | null;
}

export interface Stage2Services extends PreflightServices {
  paidCall(privateKey: `0x${string}`, target: string, body: unknown): Promise<DeepPaidCallResult>;
}

export interface OutboundPaymentAudit {
  event: "x402_outbound_blocked" | "x402_outbound_complete" | "x402_outbound_failed";
  tool: "deep_check" | "preflight_certified";
  target: string;
  price_usdt: string | null;
  settle_ref: string | null;
  settle_status: string;
  payer: string | null;
  owner_attestation: true;
}

export const defaultStage2Services: Stage2Services = {
  ...defaultServices,
  async paidCall(privateKey, target, body) {
    const buyer = createPaymentBuyer(privateKey);
    const started = performance.now();
    const paid = await buyer.postText(target, body);
    let value: unknown = paid.text;
    let parseable = false;
    try { value = JSON.parse(paid.text); parseable = true; } catch { /* Evidence retains the response text. */ }
    return {
      ok: paid.response.ok,
      status: paid.response.status,
      body: value,
      parseable,
      payer: buyer.address,
      latencyMs: Math.round(performance.now() - started),
      receipt: paid.receipt
    };
  }
};

function deepFinding(code: string, evidence: string, fix: string, severity: Finding["severity"] = "high"): ProbeResult {
  return { findings: [{ code, severity, evidence, fix }], evidence: { error: evidence } };
}

function atomicUsdt(amount: string): string | null {
  if (!/^\d+$/.test(amount)) return null;
  const atomic = BigInt(amount);
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function runCheckEndpoint(input: PreflightInput, database: Database | null, services: PreflightServices = defaultServices): Promise<ReportEnvelope> {
  const validated = await validatePreflightInput(input, services);
  const transport = await services.transport(validated.target);
  return buildReport({ tool: "check_endpoint", target: validated.target, expected: validated.expected, modules: [transport], database });
}

export async function runCheckX402(input: PreflightInput, database: Database | null, services: PreflightServices = defaultServices): Promise<ReportEnvelope> {
  const validated = await validatePreflightInput(input, services);
  const [transport, x402] = await Promise.all([services.transport(validated.target), services.x402(validated.target, validated.expected)]);
  return buildReport({ tool: "check_x402", target: validated.target, expected: validated.expected, modules: [transport, x402], database });
}

export async function runDeepCheck(
  input: DeepCheckInput,
  database: Database | null,
  config: Config,
  services: Stage2Services = defaultStage2Services,
  options: { tool?: "deep_check" | "preflight_certified"; additionalFindings?: Finding[]; audit?: (entry: OutboundPaymentAudit) => void } = {}
): Promise<ReportEnvelope> {
  const validated = deepCheckInput.parse(input);
  await services.validateTarget(validated.target);
  if (validated.mcp_url) await services.validateTarget(validated.mcp_url);
  const mcpTarget = validated.mcp_url ?? validated.target;
  const [transport, x402, mcp] = await Promise.all([
    services.transport(validated.target),
    services.x402(validated.target, validated.expected),
    services.mcp(mcpTarget, !validated.mcp_url)
  ]);
  const modules: ProbeResult[] = [transport, mcp, x402];
  const requirements = x402.evidence.payment_requirements as { amount?: unknown } | undefined;
  const amountUsdt = typeof requirements?.amount === "string" ? atomicUsdt(requirements.amount) : null;
  let reservationId: string | null = null;
  let paid: DeepPaidCallResult | null = null;

  if (x402.findings.some((finding) => finding.severity === "high") || !amountUsdt) {
    options.audit?.({ event: "x402_outbound_blocked", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: null, settle_status: "invalid_challenge", payer: null, owner_attestation: true });
    modules.push(deepFinding("DEEP_CALL_FAILED", "Target did not expose a valid payable USD₮0 requirement.", "Fix the target x402 challenge before requesting deep_check."));
  } else if (!database) {
    options.audit?.({ event: "x402_outbound_blocked", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: null, settle_status: "ledger_unavailable", payer: null, owner_attestation: true });
    modules.push(deepFinding("DEEP_CHECK_CAP_EXCEEDED", "Spend ledger is unavailable, so the outbound cap cannot be proven.", "Configure the database before using deep_check."));
  } else {
    reservationId = await database.reserveSpend(validated.target, amountUsdt, config.DEEP_CHECK_TARGET_DAILY_CAP_USDT, config.DEEP_CHECK_GLOBAL_DAILY_CAP_USDT);
    if (!reservationId) {
      options.audit?.({ event: "x402_outbound_blocked", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: null, settle_status: "cap_exceeded", payer: null, owner_attestation: true });
      modules.push(deepFinding("DEEP_CHECK_CAP_EXCEEDED", `The ${amountUsdt} USDT outbound call would exceed a persisted daily cap.`, "Wait for the 24-hour spend window to reset or raise the configured cap."));
    } else if (!config.DEEP_CHECK_BUYER_PRIVATE_KEY) {
      await database.completeSpend(reservationId, "failed", null);
      options.audit?.({ event: "x402_outbound_failed", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: null, settle_status: "buyer_unconfigured", payer: null, owner_attestation: true });
      modules.push(deepFinding("DEEP_CALL_FAILED", "Outbound buyer wallet is not configured.", "Set DEEP_CHECK_BUYER_PRIVATE_KEY in the service environment."));
    } else {
      try {
        paid = await services.paidCall(config.DEEP_CHECK_BUYER_PRIVATE_KEY as `0x${string}`, validated.target, { target: validated.target, mcp_url: validated.mcp_url, expected: validated.expected });
        const settleRef = paid.receipt?.transaction ?? null;
        options.audit?.({ event: paid.ok ? "x402_outbound_complete" : "x402_outbound_failed", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: settleRef,
          settle_status: paid.receipt?.status ?? (paid.ok ? "success" : "failed"), payer: paid.payer, owner_attestation: true });
        if (!paid.ok) {
          await database.completeSpend(reservationId, "failed", settleRef);
          modules.push(deepFinding("DEEP_CALL_FAILED", `Paid target replay returned HTTP ${paid.status}.`, "Make the paid service return a successful response after payment verification."));
        } else if (!paid.parseable) {
          await database.completeSpend(reservationId, "spent", settleRef);
          modules.push(deepFinding("DEEP_CALL_UNPARSEABLE", "Paid response was not valid JSON.", "Return a machine-readable JSON response from the paid service."));
        } else {
          await database.completeSpend(reservationId, "spent", settleRef);
          const findings: Finding[] = paid.receipt?.status === "pending" ? [{ code: "DEEP_SETTLE_PENDING", severity: "info", evidence: `Outbound settlement ${settleRef ?? "unknown"} is pending asynchronously.`, fix: "No action required unless the settlement later fails." }] : [];
          modules.push({ findings, evidence: { status: paid.status, latency_ms: paid.latencyMs, response: paid.body, settlement: paid.receipt, payer: paid.payer, amount_usdt: amountUsdt } });
        }
      } catch (error) {
        await database.completeSpend(reservationId, "failed", null);
        options.audit?.({ event: "x402_outbound_failed", tool: options.tool ?? "deep_check", target: validated.target, price_usdt: amountUsdt, settle_ref: null, settle_status: "exception", payer: null, owner_attestation: true });
        modules.push(deepFinding("DEEP_CALL_FAILED", error instanceof Error ? error.message : "unknown outbound payment error", "Verify target payment compatibility and outbound wallet funding."));
      }
    }
  }

  if (options.additionalFindings?.length) modules.push({ findings: options.additionalFindings, evidence: { stage: "certification_bundle" } });
  const tool = options.tool ?? "deep_check";
  const report = await buildReport({ tool, target: validated.target, expected: validated.expected, modules, database });
  if (database && paid && amountUsdt) {
    await database.recordCall({ checkId: report.report_id, direction: "out", tool, priceUsdt: amountUsdt, settleRef: paid.receipt?.transaction ?? null,
      settleStatus: paid.receipt?.status ?? (paid.ok ? "success" : "failed"), payer: paid.payer, ownerAttestation: true });
  }
  return report;
}

export async function runCertified(input: DeepCheckInput, database: Database | null, config: Config, services: Stage2Services = defaultStage2Services, audit?: (entry: OutboundPaymentAudit) => void): Promise<ReportEnvelope> {
  const validated = deepCheckInput.parse(input);
  if (database) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const existing = await database.findReportSince(validated.target, "preflight_certified", since);
    if (existing) return existing;
  }
  const report = await runDeepCheck(validated, database, config, services, {
    tool: "preflight_certified",
    additionalFindings: [{ code: "ATTESTATION_PENDING", severity: "info", evidence: "Attestation is queued for Stage 3 processing.", fix: "No action required." }],
    audit
  });
  if (database) {
    const expiresAt = new Date(Date.now() + config.MONITOR_DURATION_DAYS * 86_400_000);
    await database.ensureMonitor(validated.target, config.MONITOR_INTERVAL_S, expiresAt);
    await database.markBadgeEligible(validated.target, report.verdict === "GO");
  }
  return report;
}

export async function runWatchEndpoint(input: PreflightInput, database: Database | null, config: Config, services: PreflightServices = defaultServices): Promise<ReportEnvelope> {
  const validated = await validatePreflightInput(input, services);
  if (!database) return buildReport({ tool: "watch_endpoint", target: validated.target, expected: validated.expected,
    modules: [deepFinding("MONITOR_UNAVAILABLE", "The durable monitor database is unavailable.", "Configure DATABASE_URL before registering a watch.")], database });
  const minimumSafeInterval = config.NODE_ENV === "test" ? config.MONITOR_INTERVAL_S : Math.max(360, config.MONITOR_INTERVAL_S);
  const expiresAt = new Date(Date.now() + config.MONITOR_DURATION_DAYS * 86_400_000);
  const monitorId = await database.ensureMonitor(validated.target, minimumSafeInterval, expiresAt);
  return buildReport({ tool: "watch_endpoint", target: validated.target, expected: validated.expected, modules: [{ findings: [{ code: "WATCH_REGISTERED", severity: "info",
    evidence: JSON.stringify({ monitor_id: monitorId, interval_s: minimumSafeInterval, expires_at: expiresAt.toISOString() }), fix: "No action required." }], evidence: { monitor_id: monitorId, interval_s: minimumSafeInterval, expires_at: expiresAt.toISOString() } }], database });
}

export async function runGetWatchReport(input: PreflightInput, database: Database | null, services: PreflightServices = defaultServices): Promise<ReportEnvelope> {
  const validated = await validatePreflightInput(input, services);
  const data = database ? await database.getWatchReportData(validated.target) : null;
  const module = data
    ? { findings: [{ code: "WATCH_REPORT", severity: "info" as const, evidence: JSON.stringify(data), fix: "No action required." }], evidence: data as unknown as Record<string, unknown> }
    : deepFinding("WATCH_NOT_FOUND", "No monitor history exists for this target.", "Register watch_endpoint before requesting monitor history.");
  return buildReport({ tool: "get_watch_report", target: validated.target, expected: validated.expected, modules: [module], database });
}
