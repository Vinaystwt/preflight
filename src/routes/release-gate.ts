import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";
import { CONTRACT_VERSIONS, apiErrorV1Schema, manifestHash, releaseManifestV1Schema, runtimeSnapshotHash, verifyReleaseRequestV1Schema, type ApiErrorV1, type CriterionResult, type VerifyReleaseResponseV1 } from "../contracts/release-gate.js";
import type { Database } from "../db/client.js";
import { EgressPolicyError, SafeEgressClient } from "../egress/safe-client.js";
import { createReleasePaymentGateway, type ReleasePaymentGateway } from "../payments/release-gateway.js";
import { mcpAdapter, transportAdapter, x402Adapter } from "../release/adapters.js";
import { aggregateDecision, evaluateCriteria, POLICY_VERSION } from "../release/criteria.js";
import { ReleaseRepository } from "../release/repository.js";

function error(requestId: string, code: string, message: string, category: ApiErrorV1["error"]["category"], status: number, charge: ApiErrorV1["error"]["charge_status"] = "NOT_CHARGED", retryable = false) {
  return { status, body: apiErrorV1Schema.parse({ schema_version: "preflight.error.v1", error: { code, message, category, retryable, charge_status: charge, request_id: requestId } }) };
}
function group(criteria: CriterionResult[]) {
  return [...new Set(criteria.map((criterion) => criterion.group))].map((code) => ({ code, label: code[0]!.toUpperCase() + code.slice(1), criteria: criteria.filter((criterion) => criterion.group === code) }));
}
function payer(payload: unknown): string | undefined { const value = (payload as { payload?: { authorization?: { from?: unknown } } })?.payload?.authorization?.from; return typeof value === "string" ? value : undefined; }
function complete(report: Omit<VerifyReleaseResponseV1, "report_access">, token: string, config: Config): VerifyReleaseResponseV1 {
  return { ...report, report_access: { report_url: `https://${config.PUBLIC_DOMAIN}/api/v1/reports/${report.report_id}`, access_token: token } };
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export interface ReleaseRouteOptions { gateway?: ReleasePaymentGateway | null; egress?: SafeEgressClient }
export function mountReleaseGate(app: FastifyInstance, config: Config, database: Database | null, options: ReleaseRouteOptions = {}): { reconciliation: "disabled" | "idle" | "error"; stop(): void } {
  const state: { reconciliation: "disabled" | "idle" | "error" } = { reconciliation: "disabled" };
  const repository = database && config.REPORT_TOKEN_SECRET ? new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET) : null;
  const gateway = options.gateway === undefined ? createReleasePaymentGateway(config) : options.gateway;
  const egress = options.egress ?? new SafeEgressClient();
  let reconciliationTimer: NodeJS.Timeout | null = null;
  if (repository) {
    state.reconciliation = "idle";
    const reconcile = async () => {
      if (gateway) {
        for (const item of await repository.ambiguousSettlements()) {
          const settlement = await gateway.settlementStatus(item.reference);
          if (settlement.status === "success") await repository.reconcileConfirmedSettlement(item.paymentId, item.runId, item.reference);
        }
      }
      await repository.recoverSettledUnpublished();
    };
    void reconcile().catch((cause) => { state.reconciliation = "error"; app.log.error({ event: "release_reconciliation_failed", err: cause }, "release reconciliation failed"); });
    reconciliationTimer = setInterval(() => { void reconcile().catch((cause) => { state.reconciliation = "error"; app.log.error({ event: "release_reconciliation_failed", err: cause }, "release reconciliation failed"); }); }, 5_000);
    reconciliationTimer.unref();
  }

  app.get("/api/v1/service", async () => ({ schema_version: "preflight.service.v1", service: "verify_release", purpose: "Compare an operator-confirmed release manifest with observable production behavior.", price_usdt: config.PRICE_VERIFY_RELEASE, network: config.RELEASE_PAYMENT_NETWORK, asset: config.RELEASE_PAYMENT_ASSET, endpoint: `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`, contracts: "/api/v1/contracts/release-manifest/v1", decisions: ["RELEASE", "BLOCK", "UNKNOWN"], limitations: ["Public HTTPS only", "No target payment", "No security or listing-approval guarantee"] }));
  app.get("/api/v1/contracts/release-manifest/v1", async () => ({ schema_version: CONTRACT_VERSIONS.manifest, json_schema: z.toJSONSchema(releaseManifestV1Schema) }));

  app.post("/api/v1/release-manifests/draft", async (request, reply) => {
    try {
      if (!repository) { const failure = error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const manifest = releaseManifestV1Schema.parse(request.body); const target = new URL(manifest.target.endpoint).hostname;
      const concurrent = await repository.claimDraftConcurrency(target, request.id);
      if (!concurrent) { const failure = error(request.id, "DRAFT_CONCURRENCY_LIMITED", "Too many draft requests are active for this target. Try again shortly.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const checks = await Promise.all([repository.reserveRateLimit("draft_ip_day", request.ip, config.FREE_DRAFT_IP_DAILY), repository.reserveRateLimit("draft_target_day", target, config.FREE_DRAFT_TARGET_DAILY), repository.reserveRateLimit("draft_global_day", "global", config.FREE_DRAFT_GLOBAL_DAILY)]);
      if (checks.some((check) => !check.allowed)) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DRAFT_RATE_LIMITED", "The free manifest-draft limit has been reached. Try again after the daily reset.", "RATE_LIMIT", 429); return reply.code(failure.status).send(failure.body); }
      const digest = manifestHash(manifest); await repository.storeManifest(manifest, digest);
      await repository.releaseDraftConcurrency(target, request.id);
      return { schema_version: "preflight.release-manifest-draft.v1", complete: true, normalized_manifest: manifest, manifest_hash: digest, verdict: null };
    } catch (cause) {
      if (cause instanceof ZodError) { const failure = error(request.id, "MANIFEST_INVALID", "Release Manifest validation failed.", "VALIDATION", 400); return reply.code(failure.status).send({ ...failure.body, error: { ...failure.body.error, details: { issues: cause.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } } }); }
      request.log.error({ event: "draft_internal_error", err: cause }, "manifest draft failed"); const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight could not prepare the manifest.", "INTERNAL", 500, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
  });

  app.post("/api/v1/verify-release", async (request, reply) => {
    let parsed: ReturnType<typeof verifyReleaseRequestV1Schema.parse>;
    try { parsed = verifyReleaseRequestV1Schema.parse(request.body); }
    catch (cause) { const failure = error(request.id, "VERIFY_REQUEST_INVALID", cause instanceof ZodError ? "Verify request validation failed." : "Invalid request.", "VALIDATION", 400); return reply.code(failure.status).send(failure.body); }
    if (!repository || !gateway) { const failure = error(request.id, "PAYMENT_SERVICE_UNAVAILABLE", "Paid verification is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16) { const failure = error(request.id, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must contain at least 16 characters.", "VALIDATION", 400); return reply.code(failure.status).send(failure.body); }
    const digest = manifestHash(parsed.manifest); const manifestId = await repository.storeManifest(parsed.manifest, digest);
    const { run, duplicate } = await repository.beginRun(manifestId, request.id, idempotencyKey, POLICY_VERSION, config.BUILD_SHA);
    if (duplicate && run.status !== "REQUEST_VALIDATED") {
      if (run.status === "REPORT_PUBLISHED" && run.report) return complete(run.report, repository.tokenFor(run.id), config);
      const failure = error(request.id, "RUN_IN_PROGRESS", "This idempotent verification is still reconciling. Retry with the same key.", "PAYMENT", 409, "UNKNOWN", true); return reply.code(failure.status).send(failure.body);
    }
    const resourceUrl = `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`; const requirements = await gateway.requirements(resourceUrl);
    const signature = request.headers["payment-signature"];
    if (typeof signature !== "string") { reply.header("PAYMENT-REQUIRED", await gateway.challenge(requirements, resourceUrl)); return reply.code(402).send(error(request.id, "PAYMENT_REQUIRED", "Payment authorization is required.", "PAYMENT", 402).body); }
    let paymentId: string | null = null; let settlementConfirmed = false;
    try {
      const payload = gateway.decode(signature); const matched = gateway.match(requirements, payload);
      if (!matched) { const failure = error(request.id, "PAYMENT_REQUIREMENTS_MISMATCH", "Payment does not match this service.", "PAYMENT", 402); return reply.code(failure.status).send(failure.body); }
      paymentId = await repository.createPayment(run.id, { payloadHash: canonicalHash(payload as unknown as JsonValue), identifier: idempotencyKey, network: matched.network, asset: matched.asset, amount: matched.amount, payTo: matched.payTo, payer: payer(payload) });
      if (!paymentId) { const failure = error(request.id, "PAYMENT_REPLAY", "This payment payload has already been used.", "PAYMENT", 409, "NOT_CHARGED"); return reply.code(failure.status).send(failure.body); }
      const verified = await gateway.verify(payload, matched);
      if (!verified.valid) { await repository.updatePayment(paymentId, "REJECTED", "NOT_STARTED", undefined, undefined, false, "PAYMENT_INVALID"); await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_FAILED"); const failure = error(request.id, "PAYMENT_INVALID", "Payment verification failed.", "PAYMENT", 402); return reply.code(failure.status).send(failure.body); }
      const payerKey = verified.payer ?? payer(payload) ?? "unknown";
      const [payerLimit, targetLimit] = await Promise.all([
        repository.reserveRateLimit("paid_payer_minute", payerKey, 30, "minute"), repository.reserveRateLimit("paid_target_hour", parsed.manifest.target.endpoint, 10, "hour")
      ]);
      const concurrent = payerLimit.allowed && targetLimit.allowed && await repository.claimPaidConcurrency(run.id, parsed.manifest.target.endpoint);
      if (!concurrent) { await repository.updatePayment(paymentId, "VERIFIED", "NOT_STARTED", undefined, undefined, false, "PAID_RATE_LIMITED"); const failure = error(request.id, "PAID_RATE_LIMITED", "Paid verification capacity is currently limited; no settlement occurred.", "RATE_LIMIT", 429); return reply.code(failure.status).send(failure.body); }
      await repository.updatePayment(paymentId, "VERIFIED", "NOT_STARTED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING");
      const artifacts = [];
      try { artifacts.push(await transportAdapter(egress, parsed.manifest.target.endpoint, parsed.probe_input ?? {})); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      try { artifacts.push(await x402Adapter(egress, parsed.manifest.target.endpoint, parsed.probe_input ?? {})); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      if (parsed.manifest.target.mcp_url) try { artifacts.push(await mcpAdapter(egress, parsed.manifest.target.mcp_url)); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; }
      const criteria = evaluateCriteria(parsed.manifest, artifacts); const decision = aggregateDecision(criteria); const capturedAt = new Date().toISOString();
      const snapshot = { captured_at: capturedAt, requested_url: parsed.manifest.target.endpoint, artifacts } as unknown as JsonValue; const snapshotHash = runtimeSnapshotHash(snapshot);
      const expiresAt = new Date(Date.now() + config.REPORT_RETENTION_DAYS * 86_400_000).toISOString();
      const report: Omit<VerifyReleaseResponseV1, "report_access"> = { schema_version: "preflight.release-report.v1", report_id: run.id, decision,
        manifest: { schema_version: parsed.manifest.schema_version, manifest_hash: digest, canonical_manifest: parsed.manifest }, runtime_snapshot: { snapshot_hash: snapshotHash, captured_at: capturedAt, requested_url: parsed.manifest.target.endpoint, final_url: (artifacts.find((artifact) => artifact.kind === "TRANSPORT")?.normalized as { final_url?: string } | undefined)?.final_url, build_identifier: config.BUILD_SHA }, policy_version: POLICY_VERSION,
        summary: { matched: criteria.filter((item) => item.state === "MATCH").length, contradictions: criteria.filter((item) => item.state === "CONTRADICTION").length, unknown: criteria.filter((item) => item.state === "UNKNOWN").length, not_applicable: criteria.filter((item) => item.state === "NOT_APPLICABLE").length }, criterion_groups: group(criteria), limitations: ["Observable public runtime only", "No target payment", "Decision applies only to this runtime snapshot"], generated_at: capturedAt, report_expires_at: expiresAt };
      await repository.prepareReport(run.id, report, snapshot, snapshotHash); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.updatePayment(paymentId, "VERIFIED", "PENDING");
      let settled = await gateway.settle(payload, matched);
      for (let attempt = 0; !settled.success && settled.transaction && attempt < 8; attempt += 1) {
        await delay(1_500);
        const status = await gateway.settlementStatus(settled.transaction);
        if (status.status === "success") settled = { ...settled, success: true, status: "success", transaction: status.transaction ?? settled.transaction };
      }
      if (!settled.success || settled.status !== "success") { await repository.updatePayment(paymentId, "VERIFIED", settled.status ?? "UNKNOWN", settled.transaction, settled.transaction, false, "SETTLEMENT_NOT_CONFIRMED"); const failure = error(request.id, "SETTLEMENT_NOT_CONFIRMED", "Settlement is not confirmed; no report was published.", "PAYMENT", 503, "UNKNOWN", true); return reply.code(failure.status).send(failure.body); }
      settlementConfirmed = true; await repository.updatePayment(paymentId, "VERIFIED", "SETTLED", settled.transaction, settled.transaction); await repository.transition(run.id, ["SETTLEMENT_PENDING"], "PAYMENT_SETTLED", { settlement_reference: settled.transaction ?? "confirmed" });
      const token = await repository.publish(run.id); reply.header("PAYMENT-RESPONSE", gateway.responseHeader(settled)); return complete(report, token, config);
    } catch (cause) {
      request.log.error({ event: "verify_release_internal", run_id: run.id, err: cause }, "verify release failed");
      if (paymentId) await repository.updatePayment(paymentId, "VERIFIED", settlementConfirmed ? "SETTLED" : "NOT_SETTLED", undefined, undefined, settlementConfirmed, "PREFLIGHT_INTERNAL").catch(() => undefined);
      const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight failed before a report could be published.", "INTERNAL", 500, settlementConfirmed ? "SETTLED" : "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
  });

  app.get("/api/v1/reports/:reportId", async (request, reply) => {
    if (!repository) return reply.code(503).send(error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true).body);
    const reportId = (request.params as { reportId: string }).reportId; const authorization = request.headers.authorization; const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report) return reply.code(404).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_NOT_FOUND", "Private report is unavailable.", "REPORT_ACCESS", 404).body);
    if (run.report_expires_at && run.report_expires_at <= new Date()) return reply.code(410).header("Cache-Control", "private, no-store").send(error(request.id, "REPORT_EXPIRED", "Private report has expired.", "REPORT_ACCESS", 410).body);
    return reply.header("Cache-Control", "private, no-store").send(complete(run.report, token, config));
  });
  return { ...state, stop() { if (reconciliationTimer) clearInterval(reconciliationTimer); } };
}
