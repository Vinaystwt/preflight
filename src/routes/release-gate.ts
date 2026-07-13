import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";
import { CONTRACT_VERSIONS, apiErrorV1Schema, discoveryResponseV1Schema, galleryResponseV1Schema, machineReportV1Schema, manifestHash, pubkeysResponseV1Schema, receiptEnvelopeV1Schema, releaseManifestV1Schema, runStatusV1Schema, runtimeSnapshotHash, verifyReleaseRequestV1Schema, type ApiErrorV1, type CriterionResult, type RunStageEventV1, type VerifyReleaseResponseV1 } from "../contracts/release-gate.js";
import type { Database } from "../db/client.js";
import { EgressPolicyError, SafeEgressClient } from "../egress/safe-client.js";
import { createBuyerProofClient, type BuyerProofClient } from "../payments/buyer.js";
import { createReleasePaymentGateway, type ReleasePaymentGateway } from "../payments/release-gateway.js";
import { mcpAdapter, transportAdapter, x402Adapter } from "../release/adapters.js";
import { aggregateDecision, evaluateCriteria, POLICY_VERSION } from "../release/criteria.js";
import { defaultDiscoveryProbeInput, discoverReleaseSurface } from "../release/discovery.js";
import { evidenceArtifact } from "../release/evidence.js";
import { ReleaseRepository } from "../release/repository.js";
import { createReceiptSigner, type ReceiptEnvelopeV1, type ReceiptSigner } from "../receipts/signer.js";

function error(requestId: string, code: string, message: string, category: ApiErrorV1["error"]["category"], status: number, charge: ApiErrorV1["error"]["charge_status"] = "NOT_CHARGED", retryable = false) {
  return { status, body: apiErrorV1Schema.parse({ schema_version: "preflight.error.v1", error: { code, message, category, retryable, charge_status: charge, request_id: requestId } }) };
}
function group(criteria: CriterionResult[]) {
  return [...new Set(criteria.map((criterion) => criterion.group))].map((code) => ({ code, label: code[0]!.toUpperCase() + code.slice(1), criteria: criteria.filter((criterion) => criterion.group === code) }));
}
function payer(payload: unknown): string | undefined { const value = (payload as { payload?: { authorization?: { from?: unknown } } })?.payload?.authorization?.from; return typeof value === "string" ? value : undefined; }
function complete(report: Omit<VerifyReleaseResponseV1, "report_access">, token: string, config: Config): VerifyReleaseResponseV1 {
  const badge_url = config.BADGES_ENABLED && report.decision === "RELEASE" && report.receipt ? `https://${config.PUBLIC_DOMAIN}/api/v1/badge/${report.report_id}.svg?token=${encodeURIComponent(token)}` : (report.badge_url ?? null);
  return { ...report, badge_url, report_access: { report_url: `https://${config.PUBLIC_DOMAIN}/api/v1/reports/${report.report_id}`, access_token: token } };
}
function bearer(request: { headers: { authorization?: string | string[] }; query?: unknown }): string {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7);
  const token = (request.query as { token?: unknown } | undefined)?.token;
  return typeof token === "string" ? token : "";
}
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

export interface ReleaseRouteOptions { gateway?: ReleasePaymentGateway | null; egress?: SafeEgressClient; buyerProof?: BuyerProofClient | null }
export function mountReleaseGate(app: FastifyInstance, config: Config, database: Database | null, options: ReleaseRouteOptions = {}): { reconciliation: "disabled" | "idle" | "error"; stop(): void } {
  const state: { reconciliation: "disabled" | "idle" | "error" } = { reconciliation: "disabled" };
  const repository = database && config.REPORT_TOKEN_SECRET ? new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET) : null;
  const gateway = options.gateway === undefined ? createReleasePaymentGateway(config) : options.gateway;
  const buyerProof = options.buyerProof === undefined && repository ? createBuyerProofClient(config, repository) : options.buyerProof;
  const egress = options.egress ?? new SafeEgressClient();
  const receiptSigner = createReceiptSigner(config);
  if (repository && receiptSigner) {
    void repository.upsertPubkey({ keyId: receiptSigner.keyId, publicKeyBase64: receiptSigner.publicKeyBase64 }).catch((cause) => {
      app.log.error({ event: "receipt_pubkey_upsert_failed", err: cause }, "receipt public key registration failed");
    });
  }
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
      if (receiptSigner) {
        for (const run of await repository.settledUnpublishedRuns()) {
          if (!run.report) continue;
          const finalReport = await issueReceiptForReport(run.report, receiptSigner);
          if (finalReport !== run.report) await repository.updateReportAddenda(run.id, finalReport);
          await repository.publish(run.id);
        }
      } else await repository.recoverSettledUnpublished();
    };
    void reconcile().catch((cause) => { state.reconciliation = "error"; app.log.error({ event: "release_reconciliation_failed", err: cause }, "release reconciliation failed"); });
    reconciliationTimer = setInterval(() => { void reconcile().catch((cause) => { state.reconciliation = "error"; app.log.error({ event: "release_reconciliation_failed", err: cause }, "release reconciliation failed"); }); }, 5_000);
    reconciliationTimer.unref();
  }

  app.get("/api/v1/service", async () => ({ schema_version: "preflight.service.v1", service: "verify_release", purpose: "Compare an operator-confirmed release manifest with observable production behavior.", price_usdt: config.PRICE_VERIFY_RELEASE, network: config.RELEASE_PAYMENT_NETWORK, asset: config.RELEASE_PAYMENT_ASSET, endpoint: `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`, contracts: "/api/v1/contracts/release-manifest/v1", decisions: ["RELEASE", "BLOCK", "UNKNOWN"], limitations: ["Public HTTPS only", "No target payment", "No security or listing-approval guarantee"] }));
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
      chain_anchor: null
    });
    await repository.storeReceipt(report.report_id, receipt);
    await repository.audit(report.report_id, "RECEIPT_SIGNED", { receipt_id: receipt.receipt_id, key_id: receipt.key_id, chain_anchor: null });
    return { ...report, receipt, chain_anchor_tx: null };
  };

  app.post("/api/v1/discover", async (request, reply) => {
    try {
      if (!repository) { const failure = error(request.id, "RELEASE_STORE_UNAVAILABLE", "Release storage is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const parsed = z.object({ endpoint: z.string().url().refine((value) => new URL(value).protocol === "https:", "public HTTPS URL required") }).strict().parse(request.body);
      const target = new URL(parsed.endpoint).hostname;
      const concurrent = await repository.claimDraftConcurrency(target, request.id);
      if (!concurrent) { const failure = error(request.id, "DISCOVERY_CONCURRENCY_LIMITED", "Too many discovery requests are active for this target. Try again shortly.", "RATE_LIMIT", 429, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
      const checks = await Promise.all([repository.reserveRateLimit("discover_ip_day", request.ip, config.FREE_DRAFT_IP_DAILY), repository.reserveRateLimit("discover_target_day", target, config.FREE_DRAFT_TARGET_DAILY), repository.reserveRateLimit("discover_global_day", "global", config.FREE_DRAFT_GLOBAL_DAILY)]);
      if (checks.some((check) => !check.allowed)) { await repository.releaseDraftConcurrency(target, request.id); const failure = error(request.id, "DISCOVERY_RATE_LIMITED", "The free discovery limit has been reached. Try again after the daily reset.", "RATE_LIMIT", 429); return reply.code(failure.status).send(failure.body); }
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
    const buyerRequested = "authorize_buyer_proof" in parsed && parsed.authorize_buyer_proof === true;
    const includeInGallery = "include_in_gallery" in parsed && parsed.include_in_gallery === true;
    if (buyerRequested && (!("owner_attestation" in parsed) || parsed.owner_attestation !== true)) {
      const failure = error(request.id, "BUYER_OWNER_ATTESTATION_REQUIRED", "Buyer proof requires owner_attestation:true before any outbound payment can be attempted.", "VALIDATION", 400);
      return reply.code(failure.status).send(failure.body);
    }
    if (!repository || !gateway) { const failure = error(request.id, "PAYMENT_SERVICE_UNAVAILABLE", "Paid verification is not ready.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16) { const failure = error(request.id, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key must contain at least 16 characters.", "VALIDATION", 400); return reply.code(failure.status).send(failure.body); }
    if ("agent_id" in parsed && parsed.agent_id) { const failure = error(request.id, "AGENT_DISCOVERY_UNAVAILABLE", "Agent ID discovery is not available until an authoritative listing resolver is configured.", "DEPENDENCY", 503, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body); }
    let resolved: { manifest: import("../contracts/release-gate.js").ReleaseManifestV1; probeInput?: unknown; discovery?: import("../contracts/release-gate.js").DiscoveryResponseV1 };
    try {
      resolved = "manifest" in parsed ? { manifest: parsed.manifest, probeInput: parsed.probe_input } : await (async () => {
        const endpointProbeInput = parsed.probe_input ?? defaultDiscoveryProbeInput(parsed.endpoint!);
        const discovered = await discoverReleaseSurface({ endpoint: parsed.endpoint!, expected: parsed.expected, probeInput: endpointProbeInput, client: egress });
        if (!discovered.proposed_manifest.manifest) throw new Error("discovery incomplete");
        return { manifest: discovered.proposed_manifest.manifest, probeInput: endpointProbeInput, discovery: discovered };
      })();
    } catch (cause) {
      if (cause instanceof Error && cause.message === "discovery incomplete") { const failure = error(request.id, "DISCOVERY_INCOMPLETE", "Discovery could not synthesize a complete manifest for this endpoint.", "VALIDATION", 400); return reply.code(failure.status).send(failure.body); }
      request.log.error({ event: "verify_release_discovery_failed", err: cause }, "verify release discovery failed"); const failure = error(request.id, "PREFLIGHT_INTERNAL", "PreFlight could not discover the endpoint.", "INTERNAL", 500, "NOT_CHARGED", true); return reply.code(failure.status).send(failure.body);
    }
    const digest = manifestHash(resolved.manifest); const manifestId = await repository.storeManifest(resolved.manifest, digest);
    const { run, duplicate } = await repository.beginRun(manifestId, request.id, idempotencyKey, POLICY_VERSION, config.BUILD_SHA);
    if (duplicate && run.status !== "REQUEST_VALIDATED") {
      if (run.status === "REPORT_PUBLISHED" && run.report) return complete(run.report, repository.tokenFor(run.id), config);
      const failure = error(request.id, "RUN_IN_PROGRESS", "This idempotent verification is still reconciling. Retry with the same key.", "PAYMENT", 409, "UNKNOWN", true); return reply.code(failure.status).send(failure.body);
    }
    if (!duplicate && resolved.discovery) {
      await repository.audit(run.id, "REACHABLE", { evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("transport_"))?.id ?? null });
      await repository.audit(run.id, "MCP_DISCOVERED", { applicable: Boolean(resolved.discovery.observed_surface.mcp), evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("mcp_"))?.id ?? null });
      await repository.audit(run.id, "CHALLENGE_PARSED", { evidence_ref: resolved.discovery.evidence_refs.find((item) => item.id.startsWith("x402_"))?.id ?? null, parse_error: resolved.discovery.observed_surface.x402.parse_error });
      await repository.audit(run.id, "SURFACE_RECONSTRUCTED", { payment_mode: resolved.manifest.payment.mode });
      await repository.audit(run.id, "INTENT_RECONCILED", { manifest_hash: digest });
    }
    const resourceUrl = `https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`; const requirements = await gateway.requirements(resourceUrl);
    const signature = request.headers["payment-signature"];
    if (typeof signature !== "string") { reply.header("PAYMENT-REQUIRED", await gateway.challenge(requirements, resourceUrl)); return reply.code(402).send(error(request.id, "PAYMENT_REQUIRED", "Payment authorization is required.", "PAYMENT", 402).body); }
    let paymentId: string | null = null; let settlementConfirmed = false;
    try {
      const payload = gateway.decode(signature); const matched = gateway.match(requirements, payload);
      if (!matched) { const failure = error(request.id, "PAYMENT_REQUIREMENTS_MISMATCH", "Payment does not match this service.", "PAYMENT", 402); return reply.code(failure.status).send(failure.body); }
      paymentId = await repository.createPayment(run.id, { payloadHash: canonicalHash(payload as unknown as JsonValue), identifier: idempotencyKey, network: matched.network, asset: matched.asset, amount: matched.amount, payTo: matched.payTo, payer: payer(payload) });
      if (!paymentId) { await repository.audit(run.id, "PAYMENT_REPLAY_REJECTED", {}); const failure = error(request.id, "PAYMENT_REPLAY", "This payment payload has already been used.", "PAYMENT", 409, "NOT_CHARGED"); return reply.code(failure.status).send(failure.body); }
      const verified = await gateway.verify(payload, matched);
      if (!verified.valid) { await repository.updatePayment(paymentId, "REJECTED", "NOT_STARTED", undefined, undefined, false, "PAYMENT_INVALID"); await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_FAILED"); const failure = error(request.id, "PAYMENT_INVALID", "Payment verification failed.", "PAYMENT", 402); return reply.code(failure.status).send(failure.body); }
      const payerKey = verified.payer ?? payer(payload) ?? "unknown";
      const [payerLimit, targetLimit] = await Promise.all([
        repository.reserveRateLimit("paid_payer_minute", payerKey, 30, "minute"), repository.reserveRateLimit("paid_target_hour", resolved.manifest.target.endpoint, 10, "hour")
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
      const criteria = evaluateCriteria(resolved.manifest, artifacts, { buyerAuthorized: buyerRequested }); const decision = aggregateDecision(criteria); const capturedAt = new Date().toISOString();
      await repository.audit(run.id, "DECISION_SEALED", { decision });
      const snapshot = { captured_at: capturedAt, requested_url: resolved.manifest.target.endpoint, artifacts, discovery: "discovery" in resolved ? resolved.discovery : undefined } as unknown as JsonValue; const snapshotHash = runtimeSnapshotHash(snapshot);
      const expiresAt = new Date(Date.now() + config.REPORT_RETENTION_DAYS * 86_400_000).toISOString();
      const report: Omit<VerifyReleaseResponseV1, "report_access"> = { schema_version: "preflight.release-report.v1", report_id: run.id, decision,
        manifest: { schema_version: resolved.manifest.schema_version, manifest_hash: digest, canonical_manifest: resolved.manifest }, runtime_snapshot: { snapshot_hash: snapshotHash, captured_at: capturedAt, requested_url: resolved.manifest.target.endpoint, final_url: (artifacts.find((artifact) => artifact.kind === "TRANSPORT")?.normalized as { final_url?: string } | undefined)?.final_url, build_identifier: config.BUILD_SHA }, policy_version: POLICY_VERSION,
        summary: { matched: criteria.filter((item) => item.state === "MATCH").length, contradictions: criteria.filter((item) => item.state === "CONTRADICTION").length, unknown: criteria.filter((item) => item.state === "UNKNOWN").length, not_applicable: criteria.filter((item) => item.state === "NOT_APPLICABLE").length }, criterion_groups: group(criteria), limitations: buyerRequested ? ["Observable public runtime only", `PreFlight service fee: ${config.PRICE_VERIFY_RELEASE} USDT; target buyer-proof spend is disclosed separately in buyer_proof criteria.`, "Decision applies only to this runtime snapshot"] : ["Observable public runtime only", "Target buyer-proof payment was not authorized; settlement/delivery criteria are UNKNOWN.", "Decision applies only to this runtime snapshot"], generated_at: capturedAt, report_expires_at: expiresAt };
      await repository.prepareReport(run.id, report, snapshot, snapshotHash); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.updatePayment(paymentId, "VERIFIED", "PENDING");
      let settled = await gateway.settle(payload, matched);
      for (let attempt = 0; !settled.success && settled.transaction && attempt < 60; attempt += 1) {
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
      const token = await repository.publish(run.id); reply.header("PAYMENT-RESPONSE", gateway.responseHeader(settled)); return complete(finalReport, token, config);
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
    return { schema_version: "preflight.badge.v1", badge_url: `https://${config.PUBLIC_DOMAIN}/api/v1/badge/${reportId}.svg?token=${encodeURIComponent(token)}` };
  });
  app.get("/api/v1/badge/:reportId.svg", async (request, reply) => {
    if (!repository) return reply.code(503).type("text/plain").send("PreFlight unavailable");
    if (!config.BADGES_ENABLED) return reply.code(404).type("text/plain").send("Badges disabled");
    const reportId = (request.params as { reportId: string }).reportId; const token = bearer(request);
    const run = await repository.retrieve(reportId, token);
    if (!run || !run.report || run.report.decision !== "RELEASE") return reply.code(404).type("text/plain").send("Badge unavailable");
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
      receipt_id: run.report.receipt?.receipt_id ?? null, receipt_signature: run.report.receipt?.signature ?? null, badge_url: run.report.decision === "RELEASE" && run.report.receipt ? `https://${config.PUBLIC_DOMAIN}/api/v1/badge/${reportId}.svg?token=${encodeURIComponent(token)}` : null, chain_anchor_tx: run.report.chain_anchor_tx ?? null,
      exit_code: machineExit(run.report.decision)
    }));
  });
  return { ...state, stop() { if (reconciliationTimer) clearInterval(reconciliationTimer); } };
}
