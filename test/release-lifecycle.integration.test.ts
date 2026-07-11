import { randomUUID } from "node:crypto";
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
import { mountReleaseGate } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationUrl = new URL("../src/db/migrations/001_release_gate_v2.sql", import.meta.url);
const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } };
const challenge = { x402Version: 2, accepts: [requirement] };
const paymentPayload = { x402Version: 2, accepted: requirement, payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } } };

function gateway(overrides: Partial<ReleasePaymentGateway> = {}): ReleasePaymentGateway {
  return {
    requirements: vi.fn(async () => [requirement] as never), challenge: vi.fn(async () => Buffer.from(JSON.stringify(challenge)).toString("base64")),
    decode: vi.fn(() => paymentPayload as never), match: vi.fn(() => requirement as never), verify: vi.fn(async () => ({ valid: true, payer: paymentPayload.payload.authorization.from })),
    settle: vi.fn(async () => ({ success: true, status: "success", transaction: "0xsettled", network: requirement.network, payer: paymentPayload.payload.authorization.from } as never)),
    responseHeader: vi.fn(() => "settled-header"), ...overrides
  };
}
function egress() {
  return new SafeEgressClient({ resolver: { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] }, requestOnce: async () => ({ status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") }, compressedBody: Buffer.from("{}") }) });
}

async function harness(test: (app: ReturnType<typeof Fastify>, repository: ReleaseRepository, config: Config) => Promise<void>) {
  const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_lifecycle_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
  try {
    await sql.unsafe(`SET search_path TO ${schema}`); await sql.unsafe(await readFile(migrationUrl, "utf8"));
    const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
    const app = Fastify(); await test(app, new ReleaseRepository(sql, config.REPORT_TOKEN_SECRET!), config); await app.close();
  } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
}

describe.skipIf(!databaseUrl)("settlement-before-publication lifecycle", () => {
  it("publishes only after confirmed settlement and retrieves by bearer capability", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_route_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await sql.unsafe(await readFile(migrationUrl, "utf8"));
      const config = loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", DATABASE_URL: databaseUrl!, OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2", REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes" });
      const app = Fastify(); const fake = gateway(); mountReleaseGate(app, config, { sql } as unknown as Database, { gateway: fake, egress: egress() });
      const requestBody = { schema_version: "preflight.verify-release-request.v1", manifest: manifestFixture };
      const draft = await app.inject({ method: "POST", url: "/api/v1/release-manifests/draft", payload: manifestFixture }); expect(draft.statusCode).toBe(200); expect(draft.json()).toMatchObject({ complete: true, verdict: null });
      const unpaid = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001" }, payload: requestBody }); expect(unpaid.statusCode).toBe(402); expect(unpaid.headers).toHaveProperty("payment-required");
      const paid = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001", "payment-signature": "paid" }, payload: requestBody });
      expect(paid.statusCode).toBe(200); expect(paid.headers["payment-response"]).toBe("settled-header"); const report = paid.json(); expect(report).toMatchObject({ schema_version: "preflight.release-report.v1", report_id: expect.any(String), report_access: { access_token: expect.any(String) } });
      expect(fake.settle).toHaveBeenCalledTimes(1);
      const denied = await app.inject({ method: "GET", url: `/api/v1/reports/${report.report_id}` }); expect(denied.statusCode).toBe(404);
      const retrieved = await app.inject({ method: "GET", url: `/api/v1/reports/${report.report_id}`, headers: { authorization: `Bearer ${report.report_access.access_token}` } }); expect(retrieved.statusCode).toBe(200); expect(retrieved.headers["cache-control"]).toBe("private, no-store");
      const replay = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0001", "payment-signature": "paid" }, payload: requestBody }); expect(replay.statusCode).toBe(200); expect(fake.settle).toHaveBeenCalledTimes(1);
      const reusedPayment = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "release-test-identity-0002", "payment-signature": "paid" }, payload: requestBody }); expect(reusedPayment.statusCode).toBe(409); expect(reusedPayment.json()).toMatchObject({ error: { code: "PAYMENT_REPLAY" } }); expect(fake.settle).toHaveBeenCalledTimes(1);
      await app.close();
    } finally { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); }
  }, 30_000);

  it("does not settle or publish after an internal probe failure", async () => {
    const sql = postgres(databaseUrl!, { max: 1 }); const schema = `release_failure_${randomUUID().replaceAll("-", "")}`; await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`); await sql.unsafe(await readFile(migrationUrl, "utf8"));
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
    const now = new Date(); const report = { schema_version: "preflight.release-report.v1" as const, report_id: run.id, decision: "UNKNOWN" as const, manifest: { schema_version: manifestFixture.schema_version, manifest_hash: "sha256:" + "1".repeat(64), canonical_manifest: manifestFixture }, runtime_snapshot: { snapshot_hash: "sha256:" + "2".repeat(64), captured_at: now.toISOString(), requested_url: manifestFixture.target.endpoint }, policy_version: "preflight.release-policy.v1", summary: { matched: 0, contradictions: 0, unknown: 1, not_applicable: 0 }, criterion_groups: [], limitations: [], generated_at: now.toISOString(), report_expires_at: new Date(now.getTime() + 1000).toISOString() };
    await repository.transition(run.id, ["REQUEST_VALIDATED"], "PAYMENT_VERIFIED"); await repository.transition(run.id, ["PAYMENT_VERIFIED"], "PROBING"); await repository.prepareReport(run.id, report, {}, "sha256:" + "2".repeat(64)); await repository.transition(run.id, ["REPORT_PREPARED"], "SETTLEMENT_PENDING"); await repository.transition(run.id, ["SETTLEMENT_PENDING"], "PAYMENT_SETTLED");
    expect((await repository.getRun(run.id)).published_at).toBeNull(); expect(await repository.recoverSettledUnpublished()).toBe(1); expect((await repository.getRun(run.id)).status).toBe("REPORT_PUBLISHED");
  }), 30_000);

  it("rejects publication before settlement", async () => harness(async (_app, repository) => {
    const manifestId = await repository.storeManifest(manifestFixture, "sha256:" + "3".repeat(64)); const { run } = await repository.beginRun(manifestId, "request", "premature-publication-key", "preflight.release-policy.v1", "abcdef1");
    await expect(repository.publish(run.id)).rejects.toThrow("before settlement"); expect((await repository.getRun(run.id)).published_at).toBeNull();
  }), 30_000);
});
