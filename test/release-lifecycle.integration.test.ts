import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { SafeEgressClient } from "../src/egress/safe-client.js";
import type { ReleasePaymentGateway } from "../src/payments/release-gateway.js";
import { ReleaseRepository } from "../src/release/repository.js";
import { createReceiptSigner } from "../src/receipts/signer.js";
import { mountReleaseGate } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationUrls = ["001_release_gate_v2.sql", "002_buyer_proof_v3.sql", "003_receipts_and_badges_v4.sql", "004_cohort_and_passports_v5.sql", "005_self_check_v5.sql"].map((name) => new URL(`../src/db/migrations/${name}`, import.meta.url));
const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } };
const challenge = { x402Version: 2, accepts: [requirement] };
const paymentPayload = { x402Version: 2, accepted: requirement, payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } } };

async function applyReleaseMigrations(sql: postgres.Sql): Promise<void> {
  for (const migrationUrl of migrationUrls) await sql.unsafe(await readFile(migrationUrl, "utf8"));
}

function gateway(overrides: Partial<ReleasePaymentGateway> = {}): ReleasePaymentGateway {
  const base = {
    requirements: vi.fn(async () => [requirement] as never), challenge: vi.fn(async () => Buffer.from(JSON.stringify(challenge)).toString("base64")),
    decode: vi.fn(() => paymentPayload as never), match: vi.fn(() => requirement as never), verify: vi.fn(async () => ({ valid: true, payer: paymentPayload.payload.authorization.from })),
    settle: vi.fn(async () => ({ success: true, status: "success", transaction: "0xsettled", network: requirement.network, payer: paymentPayload.payload.authorization.from } as never)),
    settlementStatus: vi.fn(async () => ({ status: "success", transaction: "0xsettled" } as never)),
    responseHeader: vi.fn(() => "settled-header"), ...overrides
  } as ReleasePaymentGateway;
  base.decodeAuthorization = overrides.decodeAuthorization ?? vi.fn((headers) => {
    const v2 = headers["payment-signature"];
    const v1 = headers["x-payment"];
    const v2Value = typeof v2 === "string" ? v2 : undefined;
    const v1Value = typeof v1 === "string" ? v1 : undefined;
    if (!v2Value && !v1Value) return null;
    if (v2Value && v1Value && v2Value !== v1Value) throw new Error("conflicting_payment_headers");
    const protocol = v1Value && !v2Value ? "v1" as const : "v2" as const;
    const payload = base.decode(v2Value ?? v1Value!);
    return { protocol, requestHeaderName: protocol === "v1" ? "X-PAYMENT" as const : "PAYMENT-SIGNATURE" as const, responseHeaderName: protocol === "v1" ? "X-PAYMENT-RESPONSE" as const : "PAYMENT-RESPONSE" as const, payload, fingerprint: `test:${JSON.stringify(payload.payload)}` };
  });
  return base;
}
function egress() {
  return new SafeEgressClient({ resolver: { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] }, requestOnce: async () => ({ status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") }, compressedBody: Buffer.from("{}") }) });
}

function releaseReport(reportId: string, decision: "RELEASE" | "BLOCK" | "UNKNOWN" = "UNKNOWN") {
  const now = new Date();
  return {
    schema_version: "preflight.release-report.v1" as const,
    report_id: reportId,
    decision,
    manifest: { schema_version: manifestFixture.schema_version, manifest_hash: "sha256:" + "1".repeat(64), canonical_manifest: manifestFixture },
    runtime_snapshot: { snapshot_hash: "sha256:" + "2".repeat(64), captured_at: now.toISOString(), requested_url: manifestFixture.target.endpoint },
    policy_version: "preflight.release-policy.v1",
    summary: { matched: 0, contradictions: 0, unknown: decision === "UNKNOWN" ? 1 : 0, not_applicable: 0 },
    criterion_groups: [],
    limitations: [],
    generated_at: now.toISOString(),
    report_expires_at: new Date(now.getTime() + 86_400_000).toISOString()
  };
}

function testReceiptSigningKey(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

async function harness(test: (app: ReturnType<typeof Fastify>, repository: ReleaseRepository, config: Config) => Promise<void>) {
  const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_lifecycle_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
  try {
    await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
    const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
    const app = Fastify(); await test(app, new ReleaseRepository(sql, config.REPORT_TOKEN_SECRET!), config); await app.close();
  } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
}

describe.skipIf(!databaseUrl)("settlement-before-publication lifecycle", () => {
  it("challenges before body validation and only validates a request after payment authorization", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_payment_order_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const app = Fastify(); const fake = gateway({ decode: vi.fn((signature) => { if (signature !== "paid") throw new Error("invalid authorization"); return paymentPayload as never; }) }); mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: fake, egress: egress() });
      const validEndpointRequest = { endpoint: manifestFixture.target.endpoint };

      const withBody = await app.inject({ method: "POST", url: "/api/v1/verify-release", payload: validEndpointRequest });
      expect(withBody.statusCode).toBe(402);
      const bodyChallenge = JSON.parse(Buffer.from(String(withBody.headers["payment-required"]), "base64").toString("utf8"));
      expect(bodyChallenge.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", payTo: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", amount: "100000" });

      const withoutBody = await app.inject({ method: "POST", url: "/api/v1/verify-release" });
      expect(withoutBody.statusCode).toBe(402);
      expect(JSON.parse(Buffer.from(String(withoutBody.headers["payment-required"]), "base64").toString("utf8")).accepts[0]).toMatchObject(bodyChallenge.accepts[0]);

      const invalidAuthorization = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "not-a-payment" }, payload: { invalid: true } });
      expect(invalidAuthorization.statusCode).toBe(402);
      expect(invalidAuthorization.headers).toHaveProperty("payment-required");

      const invalidPaidBody = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid" }, payload: { invalid: true } });
      expect(invalidPaidBody.statusCode).toBe(400);
      expect(invalidPaidBody.json()).toMatchObject({ error: { code: "VERIFY_REQUEST_INVALID", charge_status: "NOT_CHARGED", details: { accepted_input: { canonical_example: { endpoint: "https://public-service.example/path" } } } } });
      expect(fake.settle).not.toHaveBeenCalled();

      const unapprovedBuyerProof = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid" }, payload: { ...validEndpointRequest, authorize_buyer_proof: true } });
      expect(unapprovedBuyerProof.statusCode).toBe(400);
      expect(unapprovedBuyerProof.json()).toMatchObject({ error: { code: "BUYER_OWNER_ATTESTATION_REQUIRED", charge_status: "NOT_CHARGED" } });
      expect(fake.settle).not.toHaveBeenCalled();

      const wrongMethod = await app.inject({ method: "GET", url: "/api/v1/verify-release" });
      expect(wrongMethod.statusCode).toBe(402); expect(wrongMethod.headers.allow).toBe("POST");
      expect(JSON.parse(Buffer.from(String(wrongMethod.headers["payment-required"]), "base64").toString("utf8")).accepts[0]).toMatchObject(bodyChallenge.accepts[0]);
      await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("publishes only after confirmed settlement and retrieves by bearer capability", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_route_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const app = Fastify(); const fake = gateway(); mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: fake, egress: egress() });
      const requestBody = { schema_version: "preflight.verify-release-request.v1", manifest: manifestFixture };
      const draft = await app.inject({ method: "POST", url: "/api/v1/release-manifests/draft", payload: manifestFixture }); expect(draft.statusCode).toBe(200); expect(draft.json()).toMatchObject({ complete: true, verdict: null });
      const unpaid = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001" }, payload: requestBody }); expect(unpaid.statusCode).toBe(402); expect(unpaid.headers).toHaveProperty("payment-required");
      const paid = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001", "payment-signature": "paid" }, payload: requestBody });
      expect(paid.statusCode).toBe(200); expect(paid.headers["payment-response"]).toBe("settled-header"); const response = paid.json(); expect(response).toMatchObject({ schema_version: "preflight.release-report.v2", detail: { schema_version: "preflight.release-report.v1", report_id: expect.any(String), report_access: { access_token: expect.any(String) } } }); const report = response.detail;
      expect(fake.settle).toHaveBeenCalledTimes(1);
      const denied = await app.inject({ method: "GET", url: `/api/v1/reports/${report.report_id}` }); expect(denied.statusCode).toBe(404);
      const retrieved = await app.inject({ method: "GET", url: `/api/v1/reports/${report.report_id}`, headers: { authorization: `Bearer ${report.report_access.access_token}` } }); expect(retrieved.statusCode).toBe(200); expect(retrieved.headers["cache-control"]).toBe("private, no-store");
      const replay = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001", "payment-signature": "paid" }, payload: requestBody }); expect(replay.statusCode).toBe(200); expect(fake.settle).toHaveBeenCalledTimes(1);
      const reusedPayment = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0002", "payment-signature": "paid" }, payload: requestBody }); expect(reusedPayment.statusCode).toBe(409); expect(reusedPayment.json()).toMatchObject({ error: { code: "PAYMENT_REPLAY" } }); expect(fake.settle).toHaveBeenCalledTimes(1);
      await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("waits for a pending facilitator settlement before publishing the paid result", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_pending_settlement_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const pending = gateway({
        settle: vi.fn(async () => ({ success: true, status: "pending", transaction: "0xpending", network: requirement.network, payer: paymentPayload.payload.authorization.from } as never)),
        settlementStatus: vi.fn(async () => ({ success: true, status: "success", transaction: "0xsettled" } as never))
      });
      const app = Fastify(); mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: pending, egress: egress() });
      const response = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "pending-settlement-test-0001", "payment-signature": "paid" }, payload: { schema_version: "preflight.verify-release-request.v1", manifest: manifestFixture } });
      expect(response.statusCode).toBe(200); expect(pending.settlementStatus).toHaveBeenCalledWith("0xpending"); expect((await sql`SELECT * FROM verification_runs WHERE published_at IS NOT NULL`)).toHaveLength(1);
      await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("discovers an endpoint-only request, publishes after settlement, and exposes private run events plus machine report", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_endpoint_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const app = Fastify(); const fake = gateway(); mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: fake, egress: egress() });
      const requestBody = { endpoint: manifestFixture.target.endpoint };
      const unpaid = await app.inject({ method: "POST", url: "/api/v1/verify-release", payload: requestBody }); expect(unpaid.statusCode).toBe(402);
      const paid = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid" }, payload: requestBody });
      expect(paid.statusCode).toBe(200); const response = paid.json(); expect(response).toMatchObject({ schema_version: "preflight.release-report.v2", decision: "RELEASE", detail: { manifest: { canonical_manifest: { target: { interface_mode: "X402_HTTP" } } } } }); const report = response.detail;
      expect(fake.settle).toHaveBeenCalledTimes(1);
      const events = await app.inject({ method: "GET", url: `/api/v1/runs/${report.report_id}/events`, headers: { authorization: `Bearer ${report.report_access.access_token}` } });
      expect(events.statusCode).toBe(200); expect(events.json().events.map((item: { stage: string }) => item.stage)).toEqual(expect.arrayContaining(["reachable", "challenge_parsed", "surface_reconstructed", "intent_reconciled", "decision_sealed", "settled", "delivered"]));
      const machine = await app.inject({ method: "GET", url: `/api/v1/reports/${report.report_id}/machine`, headers: { authorization: `Bearer ${report.report_access.access_token}` } });
      expect(machine.statusCode).toBe(200); expect(machine.json()).toMatchObject({ schema_version: "preflight.machine-report.v1.1", decision: "RELEASE", exit_code: 0 });
      const denied = await app.inject({ method: "GET", url: `/api/v1/runs/${report.report_id}/events` }); expect(denied.statusCode).toBe(404);
      const replay = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid" }, payload: requestBody });
      expect(replay.statusCode).toBe(200); expect(replay.json().detail.report_id).toBe(report.report_id); expect(fake.settle).toHaveBeenCalledTimes(1);
      const changedBodySameAuthorization = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid" }, payload: { ...requestBody, include_in_gallery: true } });
      expect(changedBodySameAuthorization.statusCode).toBe(409); expect(changedBodySameAuthorization.json()).toMatchObject({ error: { code: "PAYMENT_REPLAY", charge_status: "NOT_CHARGED" } }); expect(fake.settle).toHaveBeenCalledTimes(1);
      await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("does not settle or publish after an internal probe failure", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_failure_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const app = Fastify(); const fake = gateway(); const broken = new SafeEgressClient({ resolver: { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] }, requestOnce: async () => { throw new Error("internal adapter defect"); } });
      mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: fake, egress: broken });
      const result = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-failure-0001", "payment-signature": "paid" }, payload: { schema_version: "preflight.verify-release-request.v1", manifest: manifestFixture } });
      expect(result.statusCode).toBe(500); expect(result.json()).toMatchObject({ error: { charge_status: "NOT_CHARGED" } }); expect(fake.settle).not.toHaveBeenCalled();
      expect((await sql`SELECT * FROM verification_runs WHERE published_at IS NOT NULL`)).toHaveLength(0); await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("recovers a crash after settlement and before publication", async () => harness(async (_app, repository, _config) => {
    const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "1".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "recovery-idempotency-key", "preflight.release-policy.v1", "abcdef1");
    const report = releaseReport(run.id);
    await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_VERIFIED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING"); await repository.prepareReport(run.id, report, {}, "sha256:" + "2".repeat(64)); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.transition(run.id, ["SETTLEMENT_PENDING"], "PAYMENT_SETTLED");
    expect((await repository.getRun(run.id)).published_at).toBeNull(); expect(await repository.recoverSettledUnpublished()).toBe(1); expect((await repository.getRun(run.id)).status).toBe("REPORT_PUBLISHED");
  }), 30_000);

  it("treats duplicate publication as an idempotent no-op after a publish race", async () => harness(async (_app, repository) => {
    const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "4".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "publish-race-key", "preflight.release-policy.v1", "abcdef1");
    const report = releaseReport(run.id, "RELEASE");
    await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_VERIFIED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING"); await repository.prepareReport(run.id, report, {}, "sha256:" + "2".repeat(64)); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.transition(run.id, ["SETTLEMENT_PENDING"], "PAYMENT_SETTLED");
    const firstToken = await repository.publish(run.id); const secondToken = await repository.publish(run.id);
    expect(secondToken).toBe(firstToken); expect((await repository.getRun(run.id)).status).toBe("REPORT_PUBLISHED");
    expect(await (repository as unknown as { sql: postgres.Sql }).sql`SELECT id FROM verification_runs WHERE id=${run.id} AND lifecycle_status='REPORT_PUBLISHED'`).toHaveLength(1);
    expect(await (repository as unknown as { sql: postgres.Sql }).sql`SELECT event_type FROM audit_events WHERE run_id=${run.id} AND event_type='REPORT_PUBLISHED'`).toHaveLength(1);
  }), 30_000);

  it("stores receipts idempotently and returns the original receipt for a duplicate issue race", async () => harness(async (_app, repository, config) => {
    const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "5".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "receipt-race-key", "preflight.release-policy.v1", "abcdef1");
    const signer = createReceiptSigner({ ...config, RECEIPT_SIGNING_KEY: testReceiptSigningKey(), RECEIPT_KEY_ID: "receipt-race-key" })!;
    await repository.upsertPubkey({ keyId: signer.keyId, publicKeyBase64: signer.publicKeyBase64 });
    const base = { report_id: run.id, decision: "RELEASE" as const, manifest_hash: "sha256:" + "1".repeat(64), snapshot_hash: "sha256:" + "2".repeat(64), policy_version: "preflight.release-policy.v1", settlement_ref: "0xsettled", payer: "0x1111111111111111111111111111111111111111", price_usdt: "0.10", target_endpoint: manifestFixture.target.endpoint, pay_to: manifestFixture.payment.pay_to, chain_anchor: null, valid_until: new Date(Date.now() + 86_400_000).toISOString() };
    const first = signer.issue(base); const second = signer.issue(base);
    const storedFirst = await repository.storeReceipt(run.id, first); const storedSecond = await repository.storeReceipt(run.id, second);
    expect(storedSecond.id).toBe(storedFirst.id); expect(storedSecond.id).toBe(first.receipt_id); expect(storedSecond.id).not.toBe(second.receipt_id);
    expect(await (repository as unknown as { sql: postgres.Sql }).sql`SELECT id FROM receipts WHERE report_id=${run.id}`).toHaveLength(1);
  }), 30_000);

  it("recovers reconciliation health after a transient settlement status failure without duplicate publication", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_reconcile_recovery_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    let app: ReturnType<typeof Fastify> | null = null;
    let gate: ReturnType<typeof mountReleaseGate> | null = null;
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await applyReleaseMigrations(sql);
      const signingKey = testReceiptSigningKey();
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes", RECEIPT_SIGNING_KEY: signingKey, RECEIPT_KEY_ID: "reconcile-test-key", RETENTION_CLEANUP_INTERVAL_MS: "1000000" });
      const repository = new ReleaseRepository(sql, config.REPORT_TOKEN_SECRET!);
      const signer = createReceiptSigner(config)!;
      await repository.upsertPubkey({ keyId: signer.keyId, publicKeyBase64: signer.publicKeyBase64 });
      const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "6".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "reconcile-recovery-key", "preflight.release-policy.v1", "abcdef1");
      await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_VERIFIED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING"); await repository.prepareReport(run.id, releaseReport(run.id, "RELEASE"), {}, "sha256:" + "2".repeat(64)); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING");
      const paymentId = await repository.createPayment(run.id, { payloadHash: "reconcile-recovery-payload", network: requirement.network, asset: requirement.asset, amount: requirement.amount, payTo: requirement.payTo, payer: paymentPayload.payload.authorization.from });
      await repository.updatePayment(paymentId!, "VERIFIED", "pending", "0xreconciled");
      let calls = 0;
      const flakyGateway = gateway({ settlementStatus: vi.fn(async () => { calls += 1; if (calls === 1) throw new Error("transient facilitator timeout"); return { status: "success", transaction: "0xreconciled" } as never; }) });
      app = Fastify(); gate = mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: flakyGateway, egress: egress() });
      await vi.waitFor(async () => { expect(calls).toBeGreaterThanOrEqual(2); expect(gate!.reconciliation).toBe("idle"); expect((await repository.getRun(run.id)).status).toBe("REPORT_PUBLISHED"); }, { timeout: 12_000, interval: 250 });
      expect(await sql`SELECT event_type FROM audit_events WHERE run_id=${run.id} AND event_type='REPORT_PUBLISHED'`).toHaveLength(1);
      expect(await sql`SELECT id FROM receipts WHERE report_id=${run.id}`).toHaveLength(1);
    } finally { gate?.stop(); if (app) await app.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 45_000);

  it("rejects publication before settlement", async () => harness(async (_app, repository) => {
    const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "3".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "premature-publication-key", "preflight.release-policy.v1", "abcdef1");
    await expect(repository.publish(run.id)).rejects.toThrow("before settlement"); expect((await repository.getRun(run.id)).published_at).toBeNull();
  }), 30_000);
});
