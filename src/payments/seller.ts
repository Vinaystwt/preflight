import type { FastifyInstance } from "fastify";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { paymentMiddleware } from "@okxweb3/x402-fastify";
import type { PaymentPayload } from "@okxweb3/x402-core/types";
import type { RoutesConfig } from "@okxweb3/x402-core/server";
import type { Config } from "../config.js";
import { hasPaymentConfig } from "../config.js";
import type { Database } from "../db/client.js";

export const PAID_ENDPOINT = "/api/v1/run_preflight";
export const PAID_ENDPOINTS = {
  check_endpoint: "/api/v1/check_endpoint",
  check_x402: "/api/v1/check_x402",
  run_preflight: PAID_ENDPOINT,
  deep_check: "/api/v1/deep_check",
  preflight_certified: "/api/v1/preflight_certified",
  watch_endpoint: "/api/v1/watch_endpoint",
  get_watch_report: "/api/v1/get_watch_report"
} as const;
export type PaidTool = keyof typeof PAID_ENDPOINTS;

export interface SellerPaymentState {
  enabled: boolean;
  listenerStatus: "disabled" | "idle" | "polling" | "ok" | "error";
}

interface PaidService { tool: PaidTool; path: string; price: string; description: string }

export function paidServices(config: Config): PaidService[] {
  return [
    { tool: "check_endpoint", path: PAID_ENDPOINTS.check_endpoint, price: config.PRICE_CHECK_ENDPOINT, description: "PreFlight transport conformance check" },
    { tool: "check_x402", path: PAID_ENDPOINTS.check_x402, price: config.PRICE_CHECK_X402, description: "PreFlight transport and x402 conformance check" },
    { tool: "run_preflight", path: PAID_ENDPOINTS.run_preflight, price: config.PRICE_RUN_PREFLIGHT, description: "PreFlight MCP and x402 conformance report" },
    { tool: "deep_check", path: PAID_ENDPOINTS.deep_check, price: config.PRICE_DEEP_CHECK, description: "PreFlight deep conformance check with one authorized paid target call" },
    { tool: "preflight_certified", path: PAID_ENDPOINTS.preflight_certified, price: config.PRICE_CERTIFIED ?? config.PRICE_PREFLIGHT_CERTIFIED, description: "PreFlight certification bundle" },
    { tool: "watch_endpoint", path: PAID_ENDPOINTS.watch_endpoint, price: config.PRICE_WATCH ?? config.PRICE_WATCH_ENDPOINT, description: "Register a seven-day PreFlight conformance monitor" },
    { tool: "get_watch_report", path: PAID_ENDPOINTS.get_watch_report, price: config.PRICE_WATCH_REPORT ?? config.PRICE_GET_WATCH_REPORT, description: "Retrieve PreFlight monitor history" }
  ];
}

function payerFrom(payload: PaymentPayload): string | null {
  const authorization = (payload.payload as { authorization?: { from?: unknown } }).authorization;
  return typeof authorization?.from === "string" ? authorization.from : null;
}

function reportIdFrom(transportContext: unknown): string | null {
  const buffer = (transportContext as { responseBody?: Buffer } | undefined)?.responseBody;
  if (!buffer) return null;
  try {
    const reportId = (JSON.parse(buffer.toString("utf8")) as { report_id?: unknown }).report_id;
    return typeof reportId === "string" ? reportId : null;
  } catch { return null; }
}

function requestBodyFrom(transportContext: unknown): Record<string, unknown> | null {
  const adapter = (transportContext as { request?: { adapter?: { getBody?: () => unknown } } } | undefined)?.request?.adapter;
  const body = adapter?.getBody?.();
  return body && typeof body === "object" ? body as Record<string, unknown> : null;
}

function pathFromPayload(payload: PaymentPayload): string | null {
  try { return payload.resource?.url ? new URL(payload.resource.url).pathname : null; } catch { return null; }
}

function createWindowLimiter(max: number, windowMs: number) {
  const entries = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const active = (entries.get(key) ?? []).filter((time) => time > now - windowMs);
    if (active.length >= max) return false;
    active.push(now);
    entries.set(key, active);
    return true;
  };
}

/** Official Fastify middleware with async settlement and non-blocking audit persistence. */
export function mountSellerPayments(app: FastifyInstance, config: Config, database: Database | null, mountLegacyRoutes = true): SellerPaymentState {
  const state: SellerPaymentState = { enabled: false, listenerStatus: "disabled" };
  if (!hasPaymentConfig(config)) return state;
  state.enabled = true;
  state.listenerStatus = "idle";
  const services = paidServices(config);
  const byPath = new Map(services.map((service) => [service.path, service]));
  const facilitator = new OKXFacilitatorClient({ apiKey: config.OKX_API_KEY!, secretKey: config.OKX_SECRET_KEY!, passphrase: config.OKX_PASSPHRASE!, syncSettle: false });
  const server = new x402ResourceServer(facilitator).register("eip155:196", new ExactEvmScheme());
  const allowPayer = createWindowLimiter(config.PAYER_RATE_LIMIT_MAX, config.PAYER_RATE_LIMIT_WINDOW_S * 1_000);

  server.onBeforeVerify(async ({ paymentPayload, requirements }) => {
    const payer = payerFrom(paymentPayload) ?? "unknown";
    const service = byPath.get(pathFromPayload(paymentPayload) ?? "");
    app.log.info({ event: "x402_verify_attempt", payer, network: requirements.network, amount: requirements.amount, tool: service?.tool ?? "unknown" }, "x402 payment verification attempt");
    if (!allowPayer(payer.toLowerCase())) return { abort: true as const, reason: "PAYER_RATE_LIMITED", message: "payer rate limit exceeded" };
  });

  const pollSettlement = (settleRef: string, attempt = 0): void => {
    if (attempt >= 60) {
      state.listenerStatus = "error";
      app.log.error({ event: "x402_settlement_timeout", settle_ref: settleRef }, "settlement remained pending");
      return;
    }
    state.listenerStatus = "polling";
    const timer = setTimeout(() => {
      void facilitator.getSettleStatus(settleRef).then(async (result) => {
        if (result.status === "pending" || !result.status) return pollSettlement(settleRef, attempt + 1);
        const status = result.status === "success" ? "confirmed" : "failed";
        if (database) await database.updateCallSettlement(settleRef, status, result.transaction);
        state.listenerStatus = status === "confirmed" ? "ok" : "error";
        app.log.info({ event: "x402_settlement_update", settle_ref: result.transaction ?? settleRef, status, payer: result.payer }, "x402 settlement status updated");
      }).catch((error: unknown) => {
        app.log.error({ event: "x402_settlement_poll_error", settle_ref: settleRef, err: error }, "settlement poll failed");
        pollSettlement(settleRef, attempt + 1);
      });
    }, 3_000);
    timer.unref();
  };

  server.onAfterSettle(async ({ paymentPayload, requirements, result, transportContext }) => {
    const payer = result.payer ?? payerFrom(paymentPayload);
    const checkId = reportIdFrom(transportContext);
    const service = byPath.get(pathFromPayload(paymentPayload) ?? "") ?? byPath.get(PAID_ENDPOINT)!;
    const ownerAttestation = requestBodyFrom(transportContext)?.owner_attestation === true;
    const settleStatus = result.status ?? (result.success ? "success" : "failed");
    app.log.info({ event: "x402_settled", check_id: checkId, payer, settle_ref: result.transaction, settle_status: settleStatus, network: result.network,
      amount: result.amount ?? requirements.amount, tool: service.tool, owner_attestation: ownerAttestation }, "x402 settlement accepted");
    if (database) {
      void database.recordCall({ checkId, direction: "in", tool: service.tool, priceUsdt: service.price, settleRef: result.transaction || null, settleStatus, payer, ownerAttestation })
        .then(() => { if (settleStatus === "pending" && result.transaction) pollSettlement(result.transaction); })
        .catch((error: unknown) => app.log.error({ event: "x402_call_audit_write_failed", check_id: checkId, err: error }, "failed to persist incoming paid call"));
    } else if (settleStatus === "pending" && result.transaction) pollSettlement(result.transaction);
  });

  server.onSettleFailure(async ({ paymentPayload, requirements, error }) => {
    const payer = payerFrom(paymentPayload);
    const service = byPath.get(pathFromPayload(paymentPayload) ?? "") ?? byPath.get(PAID_ENDPOINT)!;
    app.log.error({ event: "x402_settlement_failed", payer, network: requirements.network, amount: requirements.amount, tool: service.tool, err: error }, "x402 settlement failed");
    if (database) void database.recordCall({ checkId: null, direction: "in", tool: service.tool, priceUsdt: service.price, settleRef: null, settleStatus: "failed", payer })
      .catch((writeError: unknown) => app.log.error({ event: "x402_call_audit_write_failed", err: writeError }, "failed to persist failed paid call"));
  });

  const routes: RoutesConfig = Object.fromEntries(services.map((service) => [`POST ${service.path}`, {
    accepts: [{ scheme: "exact", network: "eip155:196", payTo: config.OPERATOR_WALLET!, price: `$${service.price}`, maxTimeoutSeconds: 300 }],
    description: service.description,
    mimeType: "application/json"
  }])) as RoutesConfig;
  if (mountLegacyRoutes) paymentMiddleware(app, routes, server);
  return state;
}
