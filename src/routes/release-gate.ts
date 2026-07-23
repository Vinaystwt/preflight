import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";
import { CONTRACT_VERSIONS, apiErrorV1Schema, discoveryResponseV1Schema, galleryResponseV1Schema, machineReportV1Schema, manifestHash, pubkeysResponseV1Schema, receiptEnvelopeV1Schema, releaseManifestV1Schema, runStatusV1Schema, runtimeSnapshotHash, verifyReleaseRequestV1JsonSchema, verifyReleaseRequestV1Schema, type ApiErrorV1, type CriterionResult, type DiscoveryResponseV1, type ReleaseManifestV1, type RunStageEventV1, type VerifyReleaseResponseV1 } from "../contracts/release-gate.js";
import type { Database } from "../db/client.js";
import { EgressPolicyError, SafeEgressClient } from "../egress/safe-client.js";
import { createBuyerProofClient, type BuyerProofClient } from "../payments/buyer.js";
import { createReleasePaymentGateway, type ReleasePaymentAuthorization, type ReleasePaymentGateway } from "../payments/release-gateway.js";
import { mcpAdapter, transportAdapter, x402Adapter } from "../release/adapters.js";
import { aggregateDecision, evaluateCriteria, evaluateListingCriteria, POLICY_VERSION } from "../release/criteria.js";
import { defaultDiscoveryProbeInput, discoverReleaseSurface } from "../release/discovery.js";
import { evidenceArtifact } from "../release/evidence.js";
import { ReleaseRepository } from "../release/repository.js";
import { createReceiptSigner, type ReceiptEnvelopeV1, type ReceiptSigner } from "../receipts/signer.js";
import { OnchainOsAgentResolver, selectA2McpService, type AgentResolver } from "../resolve/agent.js";
import { FreeCohortScanner } from "../cohort.js";
import { mountV5Routes, passportBadgeSvg } from "./v5.js";
import { judgeResponse } from "../release/judge-response.js";

function error(requestId: string, code: string, message: string, category: ApiErrorV1["error"]["category"], status: number, charge: ApiErrorV1["error"]["charge_status"] = "NOT_CHARGED", retryable = false, details?: Record<string, unknown>) {
  return { status, body: apiErrorV1Schema.parse({ schema_version: "preflight.error.v1", error: { code, message, category, retryable, charge_status: charge, request_id: requestId, ...(details ? { details } : {}) } }) };
}
function group(criteria: CriterionResult[]) {
  return [...new Set(criteria.map((criterion) => criterion.group))].map((code) => ({ code, label: code[0]!.toUpperCase() + code.slice(1), criteria: criteria.filter((criterion) => criterion.group === code) }));
}
function payer(payload: unknown): string | undefined { const value = (payload as { payload?: { authorization?: { from?: unknown } } })?.payload?.authorization?.from; return typeof value === "string" ? value : undefined; }
function complete(report: Omit<VerifyReleaseResponseV1, "report_access">, token: string, config: Config): VerifyReleaseResponseV1 {
  const badge_url = report.badge_url ?? null;
  return { ...report, badge_url, report_access: { report_url: `https://${config.PUBLIC_DOMAIN}/api/v1/reports/${report.report_id}`, access_token: token } };
}
function bearer(request: { headers: { authorization?: string | string[] }; query?: unknown }): string {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7);
  const token = (request.query as { token?: unknown } | undefined)?.token;
  return typeof token === "string" ? token : "";
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const verifyReleaseAuth = new WeakMap<FastifyRequest, { authorization: ReleasePaymentAuthorization; paymentPayload: ReleasePaymentAuthorization["payload"]; matched: Awaited<ReturnType<ReleasePaymentGateway["requirements"]>>[number]; verified: Awaited<ReturnType<ReleasePaymentGateway["verify"]>> }>();
const verifyReleaseBody = new WeakMap<FastifyRequest, { ok: true; body: unknown } | { ok: false; code: string; message: string }>();
function retryAfter(window: "day" | "hour" | "minute"): number {
  const now = new Date();
  if (window === "minute") return 60 - now.getUTCSeconds();
  if (window === "hour") return (60 - now.getUTCMinutes() - 1) * 60 + (60 - now.getUTCSeconds());
  return (24 - now.getUTCHours() - 1) * 3600 + (60 - now.getUTCMinutes() - 1) * 60 + (60 - now.getUTCSeconds());
}
async function parseAuthorizedBody(payload: AsyncIterable<Buffer>, contentType: string | string[] | undefined): Promise<{ ok: true; body: unknown } | { ok: false; code: string; message: string }> {
  if (Array.isArray(contentType) || !contentType?.toLowerCase().includes("application/json")) return { ok: false, code: "invalid_content_type", message: "Content-Type must be application/json." };
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of payload) {
    size += chunk.length;
    if (size > 1_000_000) return { ok: false, code: "body_too_large", message: "Request body must be at most 1 MB." };
    chunks.push(chunk);
  }
  if (!chunks.length) return { ok: false, code: "missing_body", message: "Request body must be a JSON object." };
  try { return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; }
  catch { return { ok: false, code: "invalid_json", message: "Request body must be valid JSON." }; }
}
function parsedPlaceholder(encodedLength: string | string[] | undefined) {
  const replacement = Readable.from([Buffer.from("{}")]) as Readable & { receivedEncodedLength?: number };
  const value = Array.isArray(encodedLength) ? encodedLength[0] : encodedLength;
  replacement.receivedEncodedLength = value && /^\d+$/.test(value) ? Number(value) : 2;
  return replacement;
}
function hasReleasePaymentHeader(headers: FastifyRequest["headers"]): boolean {
  return typeof headers["payment-signature"] === "string" || typeof headers["x-payment"] === "string";
}
function firstQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? firstQueryValue(value[0]) : value;
  return value;
}
export function verifyReleaseGetQueryToBody(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== "object" || Array.isArray(query)) return {};
  const source = query as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const key of ["endpoint", "url", "target_url", "targetUrl", "service_url", "service_endpoint", "agent_url", "agent_id", "schema_version", "include_in_gallery", "authorize_buyer_proof", "owner_attestation"]) {
    if (key in source) body[key] = firstQueryValue(source[key]);
  }
  if ("target.endpoint" in source) body.target = { endpoint: firstQueryValue(source["target.endpoint"]) };
  return body;
}
const EVENT_STAGE: Partial<Record<string, RunStageEventV1["stage"]>> = {
  REQUEST_VALIDATED: "reachable", REACHABLE: "reachable", MCP_DISCOVERED: "mcp_discovered", CHALLENGE_PARSED: "challenge_parsed", SURFACE_RECONSTRUCTED: "surface_reconstructed",
  INTENT_RECONCILED: "intent_reconciled", DECISION_SEALED: "decision_sealed", PAYMENT_VERIFIED: "authorized", SETTLEMENT_PENDING: "paid", PAYMENT_SETTLED: "settled", PAYMENT_SETTLED_RECONCILED: "settled",
  PAYMENT_REPLAY_REJECTED: "replayed", REPORT_PUBLISHED: "delivered", BUYER_AUTHORIZED: "authorized", BUYER_PAID: "paid", BUYER_SETTLED: "settled", BUYER_REPLAYED: "replayed", BUYER_DELIVERED: "delivered",
  BUYER_TERMS_CHANGED: "paid", BUYER_CAP_EXCEEDED: "paid", BUYER_PROOF_FAILED: "paid"
};
const eventStage = (event: string): RunStageEventV1["stage"] | null => EVENT_STAGE[event] ?? null;
function eventStatus(event: string, metadata: Record<string, JsonValue>): RunStageEventV1["status"] {
  if (event === "MCP_DISCOVERED" && metadata.applicable === false) return "na";
  if (event === "BUYER_TERMS_CHANGED" || event === "BUYER_CAP_EXCEEDED" || event === "BUYER_PROOF_FAILED") return "contradiction";
  if (event === "DECISION_SEALED") return metadata.decision === "RELEASE" ? "match" : metadata.decision === "BLOCK" ? "contradiction" : "unknown";
  return "match";
}
function machineExit(decision: string): 0 | 1 | 2 | 3 { return decision === "RELEASE" ? 0 : decision === "BLOCK" ? 1 : decision === "UNKNOWN" ? 2 : 3; }
function receiptEnvelopeFromStored(receipt: { id: string; key_id: string; payload: ReceiptEnvelopeV1["payload"]; signature: string }, config: Config): ReceiptEnvelopeV1 {
  return receiptEnvelopeV1Schema.parse({
    receipt_id: receipt.id,
    payload: receipt.payload,
    signature: receipt.signature,
    signature_alg: "Ed25519",
    key_id: receipt.key_id,
    verify: {
      canonicalization: "preflight.canonical-json.v1",
      payload_hash: canonicalHash(receipt.payload as unknown as JsonValue),
      pubkeys_url: `https://${config.PUBLIC_DOMAIN}/api/v1/pubkeys`
    }
  });
}
function redactedGalleryReport(report: Omit<VerifyReleaseResponseV1, "report_access">): JsonValue {
  const criteria = report.criterion_groups.flatMap((group) => group.criteria).filter((criterion) => criterion.state === "CONTRADICTION" || criterion.state === "UNKNOWN");
  return {
    schema_version: "preflight.gallery-entry.v1",
    report_id: report.report_id,
    decision: report.decision,
    policy_version: report.policy_version,
    criterion_codes: criteria.map((criterion) => criterion.code),
    why: criteria.map((criterion) => criterion.consequence ?? criterion.limitation ?? criterion.comparison_rule).slice(0, 20),
    fix: criteria.flatMap((criterion) => criterion.remediation ? [criterion.remediation] : []).slice(0, 20),
    generated_at: report.generated_at
  };
}

function validationIssues(cause: ZodError): Array<{ path: string; code: string; message: string }> {
  const render = (issue: ZodError["issues"][number]): Array<{ path: string; code: string; message: string }> => {
    if (issue.code === "invalid_union" && "errors" in issue && Array.isArray(issue.errors)) {
      const branches = issue.errors
        .filter((branch): branch is ZodError["issues"] => Array.isArray(branch))
        .map((branch) => branch.flatMap(render))
        .filter((branch) => branch.length > 0)
        .sort((left, right) => left.length - right.length);
      return branches[0] ?? [{ path: issue.path.join(".") || "$", code: issue.code, message: issue.message }];
    }
    const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys : null;
    if (keys?.length) return keys.map((key) => ({ path: [...issue.path, key].join(".") || key, code: issue.code, message: `Unknown field: ${key}` }));
    return [{ path: issue.path.join(".") || "$", code: issue.code, message: issue.message }];
  };
  return cause.issues.flatMap(render);
}

function invalidVerifyRequest(requestId: string, config: Config, issues: Array<{ path: string; code: string; message: string }>) {
  const failure = error(requestId, "VERIFY_REQUEST_INVALID", "Verify request validation failed.", "VALIDATION", 400);
  return {
    ...failure.body,
    error: {
      ...failure.body.error,
      details: {
        issues,
        accepted_input: {
          canonical_example: { endpoint: "https://target-service.example/path" },
          alternative_example: { agent_id: "5161" },
          schema_url: `https://${config.PUBLIC_DOMAIN}/api/v1/contracts/verify-release-request/v1`
        }
      }
    }
  };
}

type TerminalNoGoResponse = {
  schema_version: "preflight.terminal-no-go.v1";
  decision: "BLOCK" | "UNKNOWN";
  verdict: "NO-GO";
  headline: string;
  what_this_means: string;
  target: { endpoint?: string; agent_id?: string };
  primary_blocker: { code: string; observed: string; consequence: string; exact_fix: string };
  payment: { authorization_verified: true; settled: false; charge_status: "NOT_CHARGED"; refund_required: false };
  retryable: boolean;
  accepted_input: { canonical_example: { endpoint: string }; alternative_example: { agent_id: string }; schema_url: string };
  generated_at: string;
};

function terminalFix(code: string): string {
  if (code === "TARGET_X402_MISSING") return "On the target service, return HTTP 402 for unpaid calls with PAYMENT-REQUIRED containing x402Version and a non-empty accepts[] array.";
  if (code === "TARGET_X402_INCOMPLETE") return "Include network, asset, amount and payTo in at least one accepts[] entry of the PAYMENT-REQUIRED challenge.";
  if (code === "TARGET_X402_MALFORMED") return "Base64-encode valid JSON in PAYMENT-REQUIRED with shape { x402Version, accepts:[{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra }] }. ";
  if (code === "TARGET_UNREACHABLE") return "Make the target endpoint publicly reachable over HTTPS with valid DNS, TCP and TLS before re-running PreFlight.";
  if (code === "TARGET_TEMPORARILY_UNAVAILABLE") return "Retry after the target transport dependency recovers, or verify from a stable public HTTPS endpoint.";
  if (code === "AGENT_SERVICE_UNAVAILABLE") return "Publish an A2MCP service on the OKX.AI agent listing with a usable endpoint and x402 pricing metadata.";
  if (code === "AGENT_DISCOVERY_TEMPORARILY_UNAVAILABLE") return "Retry when OKX.AI agent discovery is reachable, or call PreFlight with the endpoint field directly.";
  return "Return a complete, observable x402 service surface and then re-run PreFlight.";
}

function terminalNoGoFromDiscovery(options: { requestId: string; config: Config; endpoint?: string; agentId?: string; discovery?: DiscoveryResponseV1; code?: string; observed?: string; retryable?: boolean }): TerminalNoGoResponse {
  const x402 = options.discovery?.observed_surface.x402;
  const firstAccept = x402?.accepts?.[0];
  const missingAcceptFields = firstAccept ? ["network", "asset", "amount", "payTo"].filter((field) => typeof firstAccept[field as keyof typeof firstAccept] !== "string" || !firstAccept[field as keyof typeof firstAccept]) : [];
  const transientCodes = new Set(["TIMEOUT", "CONNECTION_RESET", "REQUEST_LIMIT"]);
  const parseError = x402?.parse_error ?? null;
  const deterministicTransportCodes = new Set(["DNS_FAIL", "DNS_PRIVATE_OR_MIXED", "TARGET_REJECTED", "TLS_INVALID", "REDIRECT_FORBIDDEN", "REDIRECT_MALFORMED", "REDIRECT_ORIGIN_REJECTED", "REDIRECT_LOOP", "REDIRECT_LIMIT", "RESPONSE_TOO_LARGE", "DECOMPRESSION_FAILED"]);
  let code = options.code;
  let observed = options.observed;
  let retryable = options.retryable ?? false;
  if (!code) {
    if (parseError && transientCodes.has(parseError)) {
      code = "TARGET_TEMPORARILY_UNAVAILABLE";
      observed = `Target probe could not complete: ${parseError}.`;
      retryable = true;
    } else if (parseError && deterministicTransportCodes.has(parseError)) {
      code = "TARGET_UNREACHABLE";
      observed = `Target transport failed before a valid x402 challenge could be observed: ${parseError}.`;
    } else if (parseError) {
      code = "TARGET_X402_MALFORMED";
      observed = `Target returned HTTP 402 but PAYMENT-REQUIRED could not be parsed: ${parseError}.`;
    } else if (x402?.status !== 402) {
      code = "TARGET_X402_MISSING";
      observed = typeof x402?.status === "number" ? `Target returned HTTP ${x402.status}; no valid x402 payment challenge was observed.` : "No valid x402 payment challenge was observed.";
    } else if (!x402.accepts?.length) {
      code = "TARGET_X402_INCOMPLETE";
      observed = "Target returned HTTP 402 but accepts[] was empty or absent.";
    } else if (missingAcceptFields.length) {
      code = "TARGET_X402_INCOMPLETE";
      observed = `Target returned accepts[] but the first usable entry was missing: ${missingAcceptFields.join(", ")}.`;
    } else {
      code = "AGENT_SERVICE_UNAVAILABLE";
      observed = "Discovery could not synthesize a usable release manifest from the observed target surface.";
    }
  }
  const decision: "BLOCK" | "UNKNOWN" = retryable || code.includes("TEMPORARILY") ? "UNKNOWN" : "BLOCK";
  return {
    schema_version: "preflight.terminal-no-go.v1",
    decision,
    verdict: "NO-GO",
    headline: decision === "BLOCK" ? "PreFlight could not produce a releasable service manifest for this target." : "PreFlight could not complete target discovery because a dependency was temporarily unavailable.",
    what_this_means: "Your payment authorization was valid, but PreFlight did not settle it because the target failed before a publishable verification report could be generated. This terminal deliverable is returned for the buyer to act on; no refund is required because no charge was captured.",
    target: { ...(options.endpoint ? { endpoint: options.endpoint } : {}), ...(options.agentId ? { agent_id: options.agentId } : {}) },
    primary_blocker: {
      code,
      observed: observed ?? "Target discovery did not expose enough evidence to verify a release.",
      consequence: decision === "BLOCK" ? "PreFlight cannot verify or publish this release path until the target exposes a usable x402 service surface." : "PreFlight cannot classify the target deterministically until the temporary dependency recovers.",
      exact_fix: terminalFix(code)
    },
    payment: { authorization_verified: true, settled: false, charge_status: "NOT_CHARGED", refund_required: false },
    retryable,
    accepted_input: {
      canonical_example: { endpoint: "https://target-service.example/path" },
      alternative_example: { agent_id: "5161" },
      schema_url: `https://${options.config.PUBLIC_DOMAIN}/api/v1/contracts/verify-release-request/v1`
    },
    generated_at: new Date().toISOString()
  };
}

export interface ReleaseRouteOptions { gateway?: ReleasePaymentGateway | null; egress?: SafeEgressClient; buyerProof?: BuyerProofClient | null; agentResolver?: AgentResolver }
export function mountReleaseGate(app: FastifyInstance, config: Config, database: Database | null, options: ReleaseRouteOptions = {}): { reconciliation: "disabled" | "idle" | "error"; cohort: "disabled" | "idle" | "error"; stop(): void } {
  const state: { reconciliation: "disabled" | "idle" | "error"; cohort: "disabled" | "idle" | "error" } = { reconciliation: "disabled", cohort: "disabled" };
  const repository = database && config.REPORT_TOKEN_SECRET ? new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET) : null;
  const gateway = options.gateway === undefined ? createReleasePaymentGateway(config) : options.gateway;
  const buyerProof = options.buyerProof === undefined && repository ? createBuyerProofClient(config, repository) : options.buyerProof;
  const egress = options.egress ?? new SafeEgressClient();
  const agentResolver = options.agentResolver ?? new OnchainOsAgentResolver(config.ONCHAINOS_COMMAND);
  const cohortScanner = repository ? new FreeCohortScanner(repository, agentResolver, egress, config) : undefined;
  mountV5Routes(app, config, repository, cohortScanner);
  let cohortTimer: NodeJS.Timeout | null = null;
  const cohortIds = config.COHORT_SEED_AGENT_IDS.split(",").map((value) => value.trim()).filter(Boolean);
  if (cohortScanner && config.COHORT_ENABLED && cohortIds.length) {
    state.cohort = "idle";
    const scan = () => { void cohortScanner.scan(cohortIds).catch((cause) => { state.cohort = "error"; app.log.error({ event: "cohort_scan_failed", err: cause }, "free cohort scan failed"); }); };
    cohortTimer = setInterval(scan, config.COHORT_SCAN_INTERVAL_MS); cohortTimer.unref();
  }
  const receiptSigner = createReceiptSigner(config);
  if (repository && receiptSigner) {
    void repository.upsertPubkey({ keyId: receiptSigner.keyId, publicKeyBase64: receiptSigner.publicKeyBase64 }).catch((cause) => {
      app.log.error({ event: "receipt_pubkey_upsert_failed", err: cause }, "receipt public key registration failed");
    });
  }
  let reconciliationTimer: NodeJS.Timeout | null = null;
  if (repository) {
    state.reconciliation = "idle";
    let lastRetentionSweep = 0;
    let reconciliationInFlight = false;
    const sweepRetention = async () => {
      if (Date.now() - lastRetentionSweep < config.RETENTION_CLEANUP_INTERVAL_MS) return;
      const purged = await repository.purgeRetention(config.REPORT_RETENTION_DAYS);
      lastRetentionSweep = Date.now();
      app.log.info({ event: "retention_sweep_complete", retention_days: config.REPORT_RETENTION_DAYS, ...purged }, "retention sweep complete");
    };
    const reconcile = async () => {
      try {
        if (gateway) {
          for (const item of await repository.ambiguousSettlements()) {
            const settlement = await gateway.settlementStatus(item.reference);
            if (settlement.status === "success") await repository.reconcileConfirmedSettlement(item.paymentId, item.runId, item.reference);
          }
        }
        if (receiptSigner) {
          for (const run of await repository.settledUnpublishedRuns()) {
            if (!run.report) continue;
            const finalReport = await issueReceiptForReport(run.report, receiptSigner);
            if (finalReport !== run.report) await repository.updateReportAddenda(run.id, finalReport);
            await repository.publish(run.id);
          }
        } else await repository.recoverSettledUnpublished();
      } finally { await sweepRetention(); }
    };
    const runReconciliation = async () => {
      if (reconciliationInFlight) return;
      reconciliationInFlight = true;
      try {
        await reconcile();
        state.reconciliation = "idle";
      } catch (cause) {
        state.reconciliation = "error";
        app.log.error({ event: "release_reconciliation_failed", err: cause }, "release reconciliation failed");
      } finally {
        reconciliationInFlight = false;
      }
    };
    setImmediate(() => { void runReconciliation(); });
    reconciliationTimer = setInterval(() => { void runReconciliation(); }, 5_000);
    reconciliationTimer.unref();
  }

  app.get("/api/v1/service", async () => ({ schema_version: "preflight.service.v1", service: "verify_release", purpose: "Compare an operator-confirmed release manifest with observable production behavior.", price_usdt: config.PRICE_VERIFY_RELEASE, network: config.RELEASE_PAYMENT_NETWORK, asset: config.RELEASE_PAYMENT_ASSET, endpoint: `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`, method: "POST", input: { canonical_example: { endpoint: "https://target-service.example/path" }, alternative_example: { agent_id: "5161" }, schema_url: `https://${config.PUBLIC_DOMAIN}/api/v1/contracts/verify-release-request/v1`, json_schema: verifyReleaseRequestV1JsonSchema }, contracts: { request: "/api/v1/contracts/verify-release-request/v1", manifest: "/api/v1/contracts/release-manifest/v1", machine_report: "/api/v1/contracts/machine-report/v1", run_events: "/api/v1/contracts/run-events/v1" }, decisions: ["RELEASE", "BLOCK", "UNKNOWN"], limitations: ["Public HTTPS only", "No target payment unless authorize_buyer_proof:true and owner_attestation:true", "No listing-approval or security guarantee"] }));
  app.get("/api/v1/contracts/verify-release-request/v1", async () => ({ schema_version: CONTRACT_VERSIONS.request, json_schema: verifyReleaseRequestV1JsonSchema, canonical_example: { endpoint: "https://target-service.example/path" }, alternative_example: { agent_id: "5161" } }));
  app.get("/api/v1/contracts/release-manifest/v1", async () => ({ schema_version: CONTRACT_VERSIONS.manifest, json_schema: z.toJSONSchema(releaseManifestV1Schema) }));
  app.get("/api/v1/contracts/discovery/v1", async () => ({ schema_version: CONTRACT_VERSIONS.discovery, json_schema: z.toJSONSchema(discoveryResponseV1Schema) }));
  app.get("/api/v1/contracts/run-events/v1", async () => ({ schema_version: CONTRACT_VERSIONS.runStatus, json_schema: z.toJSONSchema(runStatusV1Schema) }));
  app.get("/api/v1/contracts/machine-report/v1", async () => ({ schema_version: CONTRACT_VERSIONS.machineReport, json_schema: z.toJSONSchema(machineReportV1Schema) }));
  app.get("/api/v1/pubkeys", async (_request, reply) => {
    if (!repository) return reply.code(503).send({ schema_version: "preflight.pubkeys.v1", keys: [] });
    const keys = (await repository.listPubkeys()).map((key) => ({ ...key, created_at: key.created_at.toISOString() }));
    return pubkeysResponseV1Schema.parse({ schema_version: "preflight.pubkeys.v1", keys });
  });
  app.get("/api/v1/gallery", async (_request, reply) => {
    if (!config.GALLERY_ENABLED) return reply.header("Cache-Control", "public, max-age=600").send(galleryResponseV1Schema.parse({ schema_version: "preflight.gallery.v1", entries: [] }));
    if (!repository) return reply.code(503).send(error("gallery", "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const entries = (await repository.listGalleryEntries()).map((entry) => {
      const redacted = entry.redacted_report as Record<string, unknown>;
      return { ...redacted, gallery_id: entry.id, report_id: entry.report_id, decision: entry.decision, policy_version: entry.policy_version, generated_at: entry.created_at.toISOString() };
    });
    return reply.header("Cache-Control", "public, max-age=600").send(galleryResponseV1Schema.parse({ schema_version: "preflight.gallery.v1", entries }));
  });
  if (config.ENABLE_STAGE3_TEST_FIXTURES) {
    app.post("/stage3-fixtures/terms-change", async (request, reply) => {
      const idempotency = typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : "";
      const amount = idempotency.includes("-paid") ? "200000" : "100000";
      const challenge = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: config.RELEASE_PAYMENT_NETWORK, amount, asset: config.RELEASE_PAYMENT_ASSET, payTo: config.OPERATOR_WALLET, maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } }] })).toString("base64");
      return reply.header("PAYMENT-REQUIRED", challenge).code(402).send(error(request.id, "PAYMENT_REQUIRED", "Fixture payment authorization is required.", "PAYMENT", 402).body);
    });
  }

  const issueReceiptForReport = async (report: Omit<VerifyReleaseResponseV1, "report_access">, signer: ReceiptSigner | null): Promise<Omit<VerifyReleaseResponseV1, "report_access">> => {
    if (!repository || !signer) return report;
    const existing = await repository.getReceiptByReport(report.report_id);
    if (existing) return { ...report, receipt: receiptEnvelopeFromStored(existing, config), chain_anchor_tx: existing.chain_anchor_tx };
    const payment = await repository.settledPaymentForRun(report.report_id);
    if (!payment) return report;
    const receipt = signer.issue({
      report_id: report.report_id,
      decision: report.decision,
      manifest_hash: report.manifest.manifest_hash,
      snapshot_hash: report.runtime_snapshot.snapshot_hash,
      policy_version: report.policy_version,
      settlement_ref: payment.settlement_reference,
      payer: payment.payer,
      price_usdt: config.PRICE_VERIFY_RELEASE,
      target_endpoint: report.runtime_snapshot.requested_url,
      pay_to: payment.pay_to,
      chain_anchor: null,
      valid_until: report.report_expires_at
    });
    const stored = await repository.storeReceipt(report.report_id, receipt);
    if (stored.id === receipt.receipt_id) await repository.audit(report.report_id, "RECEIPT_SIGNED", { receipt_id: receipt.receipt_id, key_id: receipt.key_id, chain_anchor: null });
    return { ...report, receipt: receiptEnvelopeFromStored(stored, config), chain_anchor_tx: stored.chain_anchor_tx };
  };

  const verifyReleaseRequirements = async () => {
    const resourceUrl = `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`;
    return { resourceUrl, requirements: await gateway!.requirements(resourceUrl) };
  };
  const paymentHeaderDetails = {
    accepted_payment_headers: ["PAYMENT-SIGNATURE", "X-PAYMENT"],
    protocol_versions: { "PAYMENT-SIGNATURE": 2, "X-PAYMENT": 1 }
  };
  const sendChallenge = async (request: FastifyRequest, reply: FastifyReply, reason: "missing_header" | "malformed_header" | "unsupported_protocol_version" | "requirements_mismatch" | "facilitator_rejected" | "conflicting_payment_headers" = "missing_header") => {
    const { resourceUrl, requirements } = await verifyReleaseRequirements();
    reply.header("PAYMENT-REQUIRED", await gateway!.challenge(requirements, resourceUrl));
    reply.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Allow");
    const supplied = reason !== "missing_header";
    const code = supplied ? "PAYMENT_AUTHORIZATION_INVALID" : "PAYMENT_REQUIRED";
    const message = supplied ? "Payment authorization was supplied but could not be accepted." : "Payment authorization is required.";
    return reply.code(402).send(error(request.id, code, message, "PAYMENT", 402, "NOT_CHARGED", false, { ...paymentHeaderDetails, reason, supplied_payment_header: supplied }).body);
  };

  app.addHook("preParsing", async (request, reply, payload) => {
    if (request.method !== "POST" || request.url.split("?")[0] !== "/api/v1/verify-release") return payload;
    if (!repository || !gateway) {
      const failure = error(request.id, "PAYMENT_SERVICE_UNAVAILABLE", "Paid verification is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true);
      reply.code(failure.status).send(failure.body);
      return reply;
    }
    try {
      const { requirements } = await verifyReleaseRequirements();
      const authorization = gateway.decodeAuthorization(request.headers, requirements);
      if (!authorization) return sendChallenge(request, reply);
      const paymentPayload = authorization.payload;
      const matched = gateway.match(requirements, paymentPayload);
      if (!matched) return sendChallenge(request, reply, "requirements_mismatch");
      const verified = await gateway.verify(paymentPayload, matched);
      if (!verified.valid) return sendChallenge(request, reply, "facilitator_rejected");
      verifyReleaseAuth.set(request, { authorization, paymentPayload, matched, verified });
      verifyReleaseBody.set(request, await parseAuthorizedBody(payload as AsyncIterable<Buffer>, request.headers["content-type"]));
      return parsedPlaceholder(request.headers["content-length"]);
    } catch (cause) {
      const reason = cause instanceof Error && /unsupported_protocol_version|requirements_mismatch|conflicting_payment_headers|malformed_header/.test(cause.message) ? cause.message as "unsupported_protocol_version" | "requirements_mismatch" | "conflicting_payment_headers" | "malformed_header" : "malformed_header";
      request.log.warn({ event: "verify_release_payment_authorization_invalid_preparse", reason }, "invalid x402 authorization challenged before body parsing");
      return sendChallenge(request, reply, reason);
    }
  });

  app.post("/api/v1/discover", async (request, reply) => {
    try {
      if (!repository) { const failure = error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const parsed = z.object({ endpoint: z.string().url().refine((value) => new URL(value).protocol === "https:", "public HTTPS URL required") }).strict().parse(request.body);
      const target = new URL(parsed.endpoint).hostname;
      const concurrent = await repository.claimDraftConcurrency(target, request.id);
      if (!concurrent) { const failure = error(request.id, "DISCOVERY_CONCURRENCY_LIMITED", "Too many discovery requests are active for this target. Try again shortly.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const clientLimit = await repository.reserveRateLimit("discover_client_day", request.ip, config.FREE_DISCOVERY_CLIENT_DAILY);
      if (!clientLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DISCOVERY_CLIENT_RATE_LIMITED", "This browser has reached today's free discovery allowance. Paid verification is still available.", "RATE_LIMIT", 429); return reply.header("Retry-After", retryAfter("day")).code(failure.status).send(failure.body); }
      const targetLimit = await repository.reserveRateLimit("discover_target_hour", target, config.FREE_DISCOVERY_TARGET_HOURLY, "hour");
      if (!targetLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DISCOVERY_TARGET_RATE_LIMITED", "This endpoint has already been checked recently. Try again after the hourly pacing window.", "RATE_LIMIT", 429); return reply.header("Retry-After", retryAfter("hour")).code(failure.status).send(failure.body); }
      const globalLimit = await repository.reserveRateLimit("discover_global_emergency_day", "global", config.FREE_DISCOVERY_GLOBAL_EMERGENCY_DAILY);
      if (!globalLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DISCOVERY_GLOBAL_CAPACITY_LIMITED", "Free discovery is temporarily at capacity for everyone. This is a shared system limit, not your personal allowance.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.header("Retry-After", retryAfter("day")).code(failure.status).send(failure.body); }
      const discovered = await discoverReleaseSurface({ endpoint: parsed.endpoint, client: egress });
      await repository.releaseDraftConcurrency(target, request.id);
      return discovered;
    } catch (cause) {
      if (cause instanceof ZodError) { const failure = error(request.id, "DISCOVERY_REQUEST_INVALID", "Discovery request validation failed.", "VALIDATION", 400); return reply.code(failure.status).send(failure.body); }
      request.log.error({ event: "discovery_internal_error", err: cause }, "discovery failed"); const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight could not discover the endpoint.", "INTERNAL", 500, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
  });

  app.post("/api/v1/release-manifests/draft", async (request, reply) => {
    try {
      if (!repository) { const failure = error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const manifest = releaseManifestV1Schema.parse(request.body); const target = new URL(manifest.target.endpoint).hostname;
      const concurrent = await repository.claimDraftConcurrency(target, request.id);
      if (!concurrent) { const failure = error(request.id, "DRAFT_CONCURRENCY_LIMITED", "Too many draft requests are active for this target. Try again shortly.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const clientLimit = await repository.reserveRateLimit("draft_client_day", request.ip, config.FREE_DISCOVERY_CLIENT_DAILY);
      if (!clientLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DRAFT_CLIENT_RATE_LIMITED", "This browser has reached today's free manifest-draft allowance. Paid verification is still available.", "RATE_LIMIT", 429); return reply.header("Retry-After", retryAfter("day")).code(failure.status).send(failure.body); }
      const targetLimit = await repository.reserveRateLimit("draft_target_hour", target, config.FREE_DISCOVERY_TARGET_HOURLY, "hour");
      if (!targetLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DRAFT_TARGET_RATE_LIMITED", "This endpoint has already been drafted recently. Try again after the hourly pacing window.", "RATE_LIMIT", 429); return reply.header("Retry-After", retryAfter("hour")).code(failure.status).send(failure.body); }
      const globalLimit = await repository.reserveRateLimit("draft_global_emergency_day", "global", config.FREE_DISCOVERY_GLOBAL_EMERGENCY_DAILY);
      if (!globalLimit.allowed) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DRAFT_GLOBAL_CAPACITY_LIMITED", "Free manifest drafting is temporarily at capacity for everyone. This is a shared system limit, not your personal allowance.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.header("Retry-After", retryAfter("day")).code(failure.status).send(failure.body); }
      const digest = manifestHash(manifest); await repository.storeManifest(manifest, digest);
      await repository.releaseDraftConcurrency(target, request.id);
      return { schema_version: "preflight.release-manifest-draft.v1", complete: true, normalized_manifest: manifest, manifest_hash: digest, verdict: null };
    } catch (cause) {
      if (cause instanceof ZodError) { const failure = error(request.id, "MANIFEST_INVALID", "Release Manifest validation failed.", "VALIDATION", 400); return reply.code(failure.status).send({ ...failure.body, error: { ...failure.body.error, details: { issues: cause.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } } }); }
      request.log.error({ event: "draft_internal_error", err: cause }, "manifest draft failed"); const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight could not prepare the manifest.", "INTERNAL", 500, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
  });

  app.get("/api/v1/verify-release", async (request, reply) => {
    if (!repository || !gateway) { const failure = error(request.id, "PAYMENT_SERVICE_UNAVAILABLE", "Paid verification is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.header("Allow", "POST").code(failure.status).send(failure.body); }
    reply.header("Allow", "POST").header("Cache-Control", "no-store").header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, Allow");
    if (hasReleasePaymentHeader(request.headers)) {
      const body = verifyReleaseGetQueryToBody(request.query);
      const forwardedHeaders: Record<string, string> = { "content-type": "application/json" };
      const paymentSignature = request.headers["payment-signature"];
      const xPayment = request.headers["x-payment"];
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof paymentSignature === "string") forwardedHeaders["payment-signature"] = paymentSignature;
      if (typeof xPayment === "string") forwardedHeaders["x-payment"] = xPayment;
      if (typeof idempotencyKey === "string") forwardedHeaders["idempotency-key"] = idempotencyKey;
      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/verify-release",
        headers: forwardedHeaders,
        payload: JSON.stringify(body),
        remoteAddress: request.ip
      });
      for (const [key, value] of Object.entries(replay.headers)) {
        if (key.toLowerCase() === "content-length" || value === undefined) continue;
        reply.header(key, value as string | string[] | number);
      }
      return reply.code(replay.statusCode).send(replay.body);
    }
    return sendChallenge(request, reply);
  });

  app.post("/api/v1/verify-release", async (request, reply) => {
    // The x402 challenge deliberately precedes all request validation. Buyers need
    // the challenge to construct a valid authorization; an unpaying caller must
    // therefore never be able to receive a schema error instead of the offer.
    if (!repository || !gateway) { const failure = error(request.id, "PAYMENT_SERVICE_UNAVAILABLE", "Paid verification is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
    const authorization = verifyReleaseAuth.get(request);
    if (!authorization) return sendChallenge(request, reply);
    const { paymentPayload, matched, verified } = authorization;

    const body = verifyReleaseBody.get(request);
    let parsed: ReturnType<typeof verifyReleaseRequestV1Schema.parse>;
    try {
      if (!body?.ok) return reply.code(400).send(invalidVerifyRequest(request.id, config, [{ path: "$", code: body?.code ?? "invalid_body", message: body?.message ?? "Request body must be a JSON object." }]));
      parsed = verifyReleaseRequestV1Schema.parse(body.body);
    }
    catch (cause) {
      const issues = cause instanceof ZodError ? validationIssues(cause) : [{ path: "$", code: "invalid_request", message: "Invalid request." }];
      return reply.code(400).send(invalidVerifyRequest(request.id, config, issues));
    }
    const buyerRequested = "authorize_buyer_proof" in parsed && parsed.authorize_buyer_proof === true;
    const includeInGallery = "include_in_gallery" in parsed && parsed.include_in_gallery === true;
    if (buyerRequested && (!("owner_attestation" in parsed) || parsed.owner_attestation !== true)) {
      const failure = error(request.id, "BUYER_OWNER_ATTESTATION_REQUIRED", "Buyer proof requires owner_attestation:true before any outbound payment can be attempted.", "VALIDATION", 400);
      return reply.code(failure.status).send(failure.body);
    }
    const paymentPayloadHash = canonicalHash(paymentPayload as unknown as JsonValue);
    const canonicalRequestHash = canonicalHash(parsed as unknown as JsonValue);
    const { resourceUrl } = await verifyReleaseRequirements();
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = typeof idempotencyHeader === "string" && idempotencyHeader.length >= 16
      ? `client:${idempotencyHeader}:request:${canonicalRequestHash}`
      : `server:${resourceUrl}:payment:${paymentPayloadHash}:request:${canonicalRequestHash}`;
    let resolved: { manifest: ReleaseManifestV1; probeInput?: unknown; discovery?: DiscoveryResponseV1; listing?: { agentId: string; serviceId: string; name: string | null; fee: string | null; asset: string | null; type: string | null } } | { terminal: TerminalNoGoResponse };
    try {
      resolved = "manifest" in parsed ? { manifest: parsed.manifest, probeInput: parsed.probe_input } : await (async () => {
        if ("agent_id" in parsed && parsed.agent_id) {
          const override = parsed.listing_override;
          const listing = override ? null : await repository.cachedAgentResolution(parsed.agent_id) ?? await agentResolver.resolve(parsed.agent_id);
          if (listing) await repository.cacheAgentResolution(listing, config.AGENT_RESOLUTION_TTL_SECONDS);
          const service = override ? (() => { const item = override.services.find((candidate) => candidate.type === "A2MCP"); return item ? { service_id: item.service_id, name: item.name ?? null, endpoint: item.endpoint, fee: item.fee ?? null, asset_contract: item.asset_contract ?? null, type: item.type } : null; })() : selectA2McpService(listing!);
          if (!service) return { terminal: terminalNoGoFromDiscovery({ requestId: request.id, config, agentId: parsed.agent_id, code: "AGENT_SERVICE_UNAVAILABLE", observed: "The OKX.AI listing did not expose a usable A2MCP service endpoint." }) };
          const endpointProbeInput = parsed.probe_input ?? defaultDiscoveryProbeInput(service.endpoint);
          const discovered = await discoverReleaseSurface({ endpoint: service.endpoint, expected: parsed.expected, probeInput: endpointProbeInput, client: egress });
          if (!discovered.proposed_manifest.manifest) return { terminal: terminalNoGoFromDiscovery({ requestId: request.id, config, endpoint: service.endpoint, agentId: parsed.agent_id, discovery: discovered }) };
          return { manifest: discovered.proposed_manifest.manifest, probeInput: endpointProbeInput, discovery: discovered, listing: { agentId: parsed.agent_id, serviceId: service.service_id, name: override?.name ?? (typeof listing?.name.value === "string" ? listing.name.value : null), fee: service.fee, asset: service.asset_contract, type: service.type } };
        }
        const endpointProbeInput = parsed.probe_input ?? defaultDiscoveryProbeInput(parsed.endpoint!);
        const discovered = await discoverReleaseSurface({ endpoint: parsed.endpoint!, expected: parsed.expected, probeInput: endpointProbeInput, client: egress });
        if (!discovered.proposed_manifest.manifest) return { terminal: terminalNoGoFromDiscovery({ requestId: request.id, config, endpoint: parsed.endpoint!, discovery: discovered }) };
        return { manifest: discovered.proposed_manifest.manifest, probeInput: endpointProbeInput, discovery: discovered };
      })();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AgentResolutionUnavailable") resolved = { terminal: terminalNoGoFromDiscovery({ requestId: request.id, config, agentId: "agent_id" in parsed ? parsed.agent_id : undefined, code: "AGENT_DISCOVERY_TEMPORARILY_UNAVAILABLE", observed: cause.message, retryable: true }) };
      else {
      request.log.error({ event: "verify_release_discovery_failed", err: cause }, "verify release discovery failed"); const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight could not discover the endpoint.", "INTERNAL", 500, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
      }
    }
    if ("terminal" in resolved) {
      const hostname = resolved.terminal.target.endpoint ? new URL(resolved.terminal.target.endpoint).hostname : null;
      request.log.info({ event: "terminal_no_go_returned", request_id: request.id, reason_code: resolved.terminal.primary_blocker.code, target_hostname: hostname, decision: resolved.terminal.decision, charge_status: resolved.terminal.payment.charge_status, authorization_type: authorization.authorization.protocol }, "terminal no-go returned without settlement");
      await repository.auditSystem("TERMINAL_NO_GO_RETURNED", { reason_code: resolved.terminal.primary_blocker.code, target_hostname: hostname, decision: resolved.terminal.decision, charge_status: "NOT_CHARGED", authorization_type: authorization.authorization.protocol }).catch((cause) => request.log.warn({ event: "terminal_no_go_audit_failed", err: cause }, "terminal no-go audit failed"));
      return reply.code(200).send(resolved.terminal);
    }
    const digest = manifestHash(resolved.manifest); const manifestId = await repository.storeManifest(resolved.manifest, digest);
    const { run, duplicate } = await repository.beginRun(manifestId, request.id, idempotencyKey, POLICY_VERSION, config.BUILD_SHA);
    if (duplicate && run.status !== "REQUEST_VALIDATED") {
      if (run.status === "REPORT_PUBLISHED" && run.report) return judgeResponse(complete(run.report, repository.tokenFor(run.id), config), repository.tokenFor(run.id), config);
      const failure = error(request.id, "RUN_IN_PROGRESS", "This idempotent verification is still reconciling. Retry with the same key.", "PAYMENT", 409, "UNKNOWN", true); return reply.code(failure.status).send(failure.body);
    }
    if (!duplicate && resolved.discovery) {
      await repository.audit(run.id, "REACHABLE", { evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("transport_"))?.id ?? null });
      await repository.audit(run.id, "MCP_DISCOVERED", { applicable: Boolean(resolved.discovery.observed_surface.mcp), evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("mcp_"))?.id ?? null });
      await repository.audit(run.id, "CHALLENGE_PARSED", { evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("x402_"))?.id ?? null, parse_error: resolved.discovery.observed_surface.x402.parse_error });
      await repository.audit(run.id, "SURFACE_RECONSTRUCTED", { payment_mode: resolved.manifest.payment.mode });
      await repository.audit(run.id, "INTENT_RECONCILED", { manifest_hash: digest });
    }
    let paymentId: string | null = null; let settlementConfirmed = false;
    try {
      paymentId = await repository.createPayment(run.id, { payloadHash: paymentPayloadHash, identifier: idempotencyKey, network: matched.network, asset: matched.asset, amount: matched.amount, payTo: matched.payTo, payer: payer(paymentPayload) });
      if (!paymentId) { await repository.audit(run.id, "PAYMENT_REPLAY_REJECTED", {}); const failure = error(request.id, "PAYMENT_REPLAY", "This payment payload has already been used.", "PAYMENT", 409, "NOT_CHARGED"); return reply.code(failure.status).send(failure.body); }
      const payerKey = verified.payer ?? payer(paymentPayload) ?? "unknown";
      const [payerLimit, targetLimit] = await Promise.all([
        repository.reserveRateLimit("paid_payer_minute", payerKey, config.PAID_VERIFICATION_PAYER_PER_MINUTE, "minute"), repository.reserveRateLimit("paid_target_hour", resolved.manifest.target.endpoint, config.PAID_VERIFICATION_TARGET_PER_HOUR, "hour")
      ]);
      const concurrent = payerLimit.allowed && targetLimit.allowed && await repository.claimPaidConcurrency(run.id, resolved.manifest.target.endpoint);
      if (!concurrent) { await repository.updatePayment(paymentId, "VERIFIED", "NOT_STARTED", undefined, undefined, false, "PAID_RATE_LIMITED"); const failure = error(request.id, "PAID_RATE_LIMITED", "Paid verification capacity is currently limited; no settlement occurred.", "RATE_LIMIT", 429); return reply.code(failure.status).send(failure.body); }
      await repository.updatePayment(paymentId, "VERIFIED", "NOT_STARTED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING");
      const artifacts = [];
      try { artifacts.push(await transportAdapter(egress, resolved.manifest.target.endpoint, resolved.probeInput ?? {})); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      try { artifacts.push(await x402Adapter(egress, resolved.manifest.target.endpoint, resolved.probeInput ?? {})); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      if (resolved.manifest.target.mcp_url) try { artifacts.push(await mcpAdapter(egress, resolved.manifest.target.mcp_url)); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      if (buyerRequested) {
        const buyerBody = resolved.probeInput ?? defaultDiscoveryProbeInput(resolved.manifest.target.endpoint);
        const audit = (event: string, metadata: Record<string, JsonValue>) => repository.audit(run.id, event, metadata);
        if (buyerProof) artifacts.push(await buyerProof.prove({ runId: run.id, target: resolved.manifest.target.endpoint, body: buyerBody, audit }));
        else {
          await repository.audit(run.id, "BUYER_PROOF_FAILED", { reason: "BUYER_WALLET_UNAVAILABLE" });
          artifacts.push(evidenceArtifact("BUYER_PROOF", resolved.manifest.target.endpoint, { authorized: true, status: "BUYER_WALLET_UNAVAILABLE" }));
        }
      } else {
        artifacts.push(evidenceArtifact("BUYER_PROOF", resolved.manifest.target.endpoint, { authorized: false, status: "NOT_AUTHORIZED" }));
      }
      const criteria = [...evaluateCriteria(resolved.manifest, artifacts, { buyerAuthorized: buyerRequested }), ...(resolved.listing ? evaluateListingCriteria({ endpoint: resolved.manifest.target.endpoint, fee: resolved.listing.fee, asset: resolved.listing.asset, type: resolved.listing.type }, artifacts) : [])]; const decision = aggregateDecision(criteria); const capturedAt = new Date().toISOString();
      await repository.audit(run.id, "DECISION_SEALED", { decision });
      const snapshot = { captured_at: capturedAt, requested_url: resolved.manifest.target.endpoint, artifacts, discovery: "discovery" in resolved ? resolved.discovery : undefined } as unknown as JsonValue; const snapshotHash = runtimeSnapshotHash(snapshot);
      const expiresAt = new Date(Date.now() + config.REPORT_RETENTION_DAYS * 86_400_000).toISOString();
      const report: Omit<VerifyReleaseResponseV1, "report_access"> = { schema_version: "preflight.release-report.v1", report_id: run.id, decision,
        manifest: { schema_version: resolved.manifest.schema_version, manifest_hash: digest, canonical_manifest: resolved.manifest }, runtime_snapshot: { snapshot_hash: snapshotHash, captured_at: capturedAt, requested_url: resolved.manifest.target.endpoint, final_url: (artifacts.find((artifact) => artifact.kind === "TRANSPORT")?.normalized as { final_url?: string } | undefined)?.final_url, build_identifier: config.BUILD_SHA }, policy_version: POLICY_VERSION,
        summary: { matched: criteria.filter((item) => item.state === "MATCH").length, contradictions: criteria.filter((item) => item.state === "CONTRADICTION").length, unknown: criteria.filter((item) => item.state === "UNKNOWN").length, not_applicable: criteria.filter((item) => item.state === "NOT_APPLICABLE").length }, criterion_groups: group(criteria), limitations: buyerRequested ? ["Observable public runtime only", `PreFlight service fee: ${config.PRICE_VERIFY_RELEASE} USDT; target buyer-proof spend is disclosed separately in buyer_proof criteria.`, "Decision applies only to this runtime snapshot"] : ["Observable public runtime only", "Target buyer-proof payment was not authorized; settlement/delivery criteria are UNKNOWN.", "Decision applies only to this runtime snapshot"], generated_at: capturedAt, report_expires_at: expiresAt };
      await repository.prepareReport(run.id, report, snapshot, snapshotHash); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.updatePayment(paymentId, "VERIFIED", "PENDING");
      let settled = await gateway.settle(paymentPayload, matched);
      // Some facilitators acknowledge a submitted settlement as success:true while
      // its status remains pending. It is not publishable until status=success.
      for (let attempt = 0; settled.status !== "success" && settled.transaction && attempt < 60; attempt += 1) {
        await delay(1_500);
        const status = await gateway.settlementStatus(settled.transaction);
        if (status.status === "success") settled = { ...settled, success: true, status: "success", transaction: status.transaction ?? settled.transaction };
      }
      if (!settled.success || settled.status !== "success") { await repository.updatePayment(paymentId, "VERIFIED", settled.status ?? "UNKNOWN", settled.transaction, settled.transaction, false, "SETTLEMENT_NOT_CONFIRMED"); const failure = error(request.id, "SETTLEMENT_NOT_CONFIRMED", "Settlement is not confirmed; no report was published.", "PAYMENT", 503, "UNKNOWN", true); return reply.code(failure.status).send(failure.body); }
      settlementConfirmed = true; await repository.updatePayment(paymentId, "VERIFIED", "SETTLED", settled.transaction, settled.transaction); await repository.transition(run.id, ["SETTLEMENT_PENDING"], "PAYMENT_SETTLED", { settlement_reference: settled.transaction ?? "confirmed" });
      const finalReport = await issueReceiptForReport(report, receiptSigner);
      if (finalReport !== report) await repository.updateReportAddenda(run.id, finalReport);
      if (config.GALLERY_ENABLED && includeInGallery && !duplicate && (finalReport.decision === "BLOCK" || finalReport.decision === "UNKNOWN")) {
        const galleryLimit = await repository.reserveRateLimit("gallery_global_hour", "global", 10, "hour");
        if (galleryLimit.allowed) {
          await repository.insertGalleryEntry(finalReport.report_id, finalReport.decision, finalReport.policy_version, redactedGalleryReport(finalReport));
          await repository.audit(run.id, "GALLERY_ENTRY_CREATED", { decision: finalReport.decision });
        } else await repository.audit(run.id, "GALLERY_RATE_LIMITED", {});
      }
      const token = await repository.publish(run.id); reply.header(authorization.authorization.responseHeaderName, gateway.responseHeader(settled));
      if (resolved.listing && finalReport.decision === "RELEASE" && finalReport.receipt) await repository.upsertPassport(resolved.listing.agentId, finalReport.receipt.receipt_id, finalReport.policy_version, { endpoint: resolved.manifest.target.endpoint, service_id: resolved.listing.serviceId }, new Date(Date.now() + config.PASSPORT_TTL_DAYS * 86_400_000));
      return judgeResponse(complete(finalReport, token, config), token, config, Date.now(), resolved.listing ? { agentId: resolved.listing.agentId, serviceId: resolved.listing.serviceId, name: resolved.listing.name } : undefined);
    } catch (cause) {
      request.log.error({ event: "verify_release_internal", run_id: run.id, err: cause }, "verify release failed");
      if (paymentId) await repository.updatePayment(paymentId, "VERIFIED", settlementConfirmed ? "SETTLED" : "NOT_SETTLED", undefined, undefined, settlementConfirmed, "PREFLIGHT_INTERNAL").catch(() => undefined);
      const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight failed before a report could be published.", "INTERNAL", 500, settlementConfirmed ? "SETTLED" : "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
  });

  app.get("/api/v1/reports/:reportId", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report) return reply.code(404).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_NOT_FOUND", "Private report is unavailable.", "REPORT_ACCESS", 404).body);
    if (run.report_expires_at && run.report_expires_at <= new Date()) return reply.code(410).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_EXPIRED", "Private report has expired.", "REPORT_ACCESS", 410).body);
    return reply.header("Cache-Control", "private, no-store").send(complete(run.report, token, config));
  });
  app.post("/api/v1/reports/:reportId/receipt", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    if (!receiptSigner) return reply.code(503).send(error(request.id, "RECEIPTS_UNAVAILABLE", "Receipt signing is not configured.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report) return reply.code(404).send(error(request.id, "REPORT_NOT_FOUND", "Private report is unavailable.", "REPORT_ACCESS", 404).body);
    const finalReport = await issueReceiptForReport(run.report, receiptSigner);
    await repository.updateReportAddenda(run.id, finalReport);
    if (!finalReport.receipt) return reply.code(503).send(error(request.id, "RECEIPT_NOT_AVAILABLE", "Receipt could not be issued for this report.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    return receiptEnvelopeV1Schema.parse(finalReport.receipt);
  });
  app.get("/api/v1/receipts/:receiptId", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const receiptId = (request.params as { receiptId: string }).receiptId;
    const receipt = await repository.getReceipt(receiptId);
    if (!receipt) return reply.code(404).send(error(request.id, "RECEIPT_NOT_FOUND", "Receipt is unavailable.", "REPORT_ACCESS", 404).body);
    return reply.header("Cache-Control", "public, max-age=600").send(receiptEnvelopeFromStored(receipt, config));
  });
  app.post("/api/v1/reports/:reportId/badge", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    if (!config.BADGES_ENABLED) return reply.code(404).send(error(request.id, "BADGES_DISABLED", "Badges are not enabled.", "DEPENDENCY", 404).body);
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report) return reply.code(404).send(error(request.id, "REPORT_NOT_FOUND", "Private report is unavailable.", "REPORT_ACCESS", 404).body);
    if (run.report.decision !== "RELEASE") { await repository.recordBadgeEvent(reportId, run.report.receipt?.receipt_id ?? null, "denied", { reason: "decision_not_release" }); return reply.code(409).send(error(request.id, "BADGE_NOT_ELIGIBLE", "Badges are available only for RELEASE reports.", "VALIDATION", 409).body); }
    const drift = await repository.hasNewerDrift(reportId);
    if (drift) { await repository.recordBadgeEvent(reportId, run.report.receipt?.receipt_id ?? null, "expired", { reason: "newer_drift" }); return reply.code(409).send(error(request.id, "BADGE_EXPIRED", "A newer report changed this release snapshot.", "VALIDATION", 409).body); }
    await repository.recordBadgeEvent(reportId, run.report.receipt?.receipt_id ?? null, "issued", {});
    return { schema_version: "preflight.badge.v1", badge_url: null, message: "Private report badges are not embeddable with capability tokens. Use a public passport badge when available." };
  });
  app.get("/api/v1/badge/:reportId.svg", async (request, reply) => {
    if (!repository) return reply.code(503).type("text/plain").send("PreFlight unavailable");
    if (!config.BADGES_ENABLED) return reply.code(404).type("text/plain").send("Badges disabled");
    const badgeLimit = await repository.reserveRateLimit("badge_ip_minute", request.ip, 300, "minute");
    if (!badgeLimit.allowed) return reply.code(429).type("text/plain").send("Badge rate limited");
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report || run.report.decision !== "RELEASE") {
      // v5 passport badges deliberately have no capability token; report badges
      // above remain private and continue to require one.
      const passport = await repository.getPassport(reportId);
      if (!passport) return reply.code(404).type("text/plain").send("Badge unavailable");
      const stale = Boolean(passport.revoked_at || passport.expires_at <= new Date());
      return reply.header("Cache-Control", "public, max-age=300").type("image/svg+xml").send(passportBadgeSvg(passport.agent_id, stale ? "STALE" : "RELEASE", passport.receipt_id, passport.issued_at.toISOString(), passport.policy_version));
    }
    const drift = await repository.hasNewerDrift(reportId);
    const receipt = run.report.receipt ?? (await repository.getReceiptByReport(reportId) ? receiptEnvelopeFromStored((await repository.getReceiptByReport(reportId))!, config) : undefined);
    if (drift || !receipt) return reply.code(409).type("text/plain").send("Badge expired");
    await repository.recordBadgeEvent(reportId, receipt.receipt_id, "issued", { route: "svg" });
    const issuedAt = receipt.payload.issued_at;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="28" role="img" aria-label="PreFlight RELEASE">
<!-- receipt_id:${receipt.receipt_id} issued_at:${issuedAt} -->
<rect width="88" height="28" rx="6" fill="#0b0f14"/>
<text x="8" y="18" fill="#f7fafc" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="700">PreFlight</text>
<circle cx="69" cy="14" r="5" fill="#22c55e"/>
<text x="76" y="18" fill="#22c55e" font-family="Inter,Arial,sans-serif" font-size="9" font-weight="700">R</text>
</svg>`;
    return reply.header("Cache-Control", "private, max-age=300").type("image/svg+xml").send(svg);
  });
  app.get("/api/v1/runs/:runId/events", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const runId = (request.params as { runId: string }).runId; const token = bearer(request);
    const run = await repository.retrieve(runId, token);
    if (!run || !run.report) return reply.code(404).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_NOT_FOUND", "Private run is unavailable.", "REPORT_ACCESS", 404).body);
    const events = (await repository.events(runId)).flatMap((item) => {
      const stage = eventStage(item.event_type); if (!stage) return null;
      return { stage, status: eventStatus(item.event_type, item.safe_metadata), observed_value: item.safe_metadata.decision ?? item.safe_metadata.payment_mode ?? item.safe_metadata.settlement_reference, evidence_ref: typeof item.safe_metadata.evidence_ref === "string" ? item.safe_metadata.evidence_ref : undefined, timestamp: item.created_at.toISOString() };
    }).filter((item) => item !== null);
    return reply.header("Cache-Control", "private, no-store").send(runStatusV1Schema.parse({ schema_version: "preflight.run-status.v1", run_id: runId, events }));
  });
  app.get("/api/v1/reports/:reportId/machine", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report) return reply.code(404).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_NOT_FOUND", "Private report is unavailable.", "REPORT_ACCESS", 404).body);
    const criteria = run.report.criterion_groups.flatMap((item) => item.criteria);
    const blockers = criteria.filter((item) => item.state === "CONTRADICTION");
    const remediations = criteria.filter((item) => item.remediation).map((item) => ({ code: item.code, remediation: item.remediation! }));
    const evidenceRefs = criteria.flatMap((item) => item.evidence_refs);
    return reply.header("Cache-Control", "private, no-store").send(machineReportV1Schema.parse({
      schema_version: "preflight.machine-report.v1.1", report_id: reportId, decision: run.report.decision, blockers, criteria, evidence_refs: evidenceRefs, remediations,
      hashes: { manifest_hash: run.report.manifest.manifest_hash, snapshot_hash: run.report.runtime_snapshot.snapshot_hash }, policy_version: run.report.policy_version,
      receipt_id: run.report.receipt?.receipt_id ?? null, receipt_signature: run.report.receipt?.signature ?? null, badge_url: run.report.badge_url ?? null, chain_anchor_tx: run.report.chain_anchor_tx ?? null,
      exit_code: machineExit(run.report.decision)
    }));
  });
  return {
    get reconciliation() { return state.reconciliation; },
    get cohort() { return state.cohort; },
    stop() { if (reconciliationTimer) clearInterval(reconciliationTimer); if (cohortTimer) clearInterval(cohortTimer); }
  };
}
