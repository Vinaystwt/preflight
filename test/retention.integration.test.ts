import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { ReleaseRepository } from "../src/release/repository.js";

const databaseUrl = process.env.DATABASE_URL;
const migrations = ["001_release_gate_v2.sql", "002_buyer_proof_v3.sql", "003_receipts_and_badges_v4.sql", "004_cohort_and_passports_v5.sql", "005_self_check_v5.sql"].map((name) => new URL(`../src/db/migrations/${name}`, import.meta.url));
const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
const expired = new Date(Date.now() - 60 * 60 * 1000);
const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
const hash = `sha256:${"a".repeat(64)}`;

async function migrationsFor(sql: postgres.Sql): Promise<void> {
  for (const migration of migrations) await sql.unsafe(await readFile(migration, "utf8"));
}

describe.skipIf(!databaseUrl)("retention sweep", () => {
  it("deletes only expired, unprotected report trees and stale bounded-history rows", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schema = `retention_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    try {
      await sql.unsafe(`SET search_path TO ${schema}`);
      await migrationsFor(sql);
      const repository = new ReleaseRepository(sql, "test-secret-that-is-longer-than-thirty-two-bytes");
      await sql`INSERT INTO pubkeys (key_id, algorithm, public_key_base64) VALUES ('key', 'Ed25519', 'test')`;
      await sql`INSERT INTO release_manifests (id, schema_version, manifest_hash, canonical_manifest, created_at) VALUES ('manifest-expired', 'preflight.release-manifest.v1', ${hash}, ${sql.json({})}, ${old})`;
      await sql`INSERT INTO verification_runs (id, manifest_id, request_identity, lifecycle_status, policy_version, build_sha, report, report_token_hash, report_expires_at, published_at, created_at) VALUES ('expired-run', 'manifest-expired', 'test', 'REPORT_PUBLISHED', 'policy', 'abcdef1', ${sql.json({})}, 'token', ${expired}, ${old}, ${old})`;
      await sql`INSERT INTO payment_attempts (id, run_id, payment_payload_hash, network, asset, amount_atomic, pay_to, verification_state, settlement_state) VALUES ('payment-expired', 'expired-run', 'payload-expired', 'eip155:196', 'asset', '100000', 'payto', 'VALID', 'SETTLED')`;
      await sql`INSERT INTO audit_events (run_id, payment_attempt_id, event_type) VALUES ('expired-run', 'payment-expired', 'REPORT_PUBLISHED')`;
      await sql`INSERT INTO buyer_proof_spend (id, run_id, target_url, amount_atomic, amount_usdt, terms_hash, idempotency_key_hash, status) VALUES ('buyer-expired', 'expired-run', 'https://example.test', 100000, 0.1, 'terms', 'buyer-key', 'settled')`;
      await sql`INSERT INTO receipts (id, report_id, key_id, payload, signature, created_at) VALUES ('receipt-expired', 'expired-run', 'key', ${sql.json({})}, 'signature', ${old})`;
      await sql`INSERT INTO badge_events (id, report_id, receipt_id, status, created_at) VALUES ('badge-expired', 'expired-run', 'receipt-expired', 'issued', ${old})`;
      await sql`INSERT INTO gallery_entries (id, report_id, decision, policy_version, redacted_report, created_at) VALUES ('gallery-expired', 'expired-run', 'BLOCK', 'policy', ${sql.json({})}, ${old})`;
      await sql`INSERT INTO self_checks (id, report_id, receipt_id, decision, label, payload, published_at) VALUES ('self-expired', 'expired-run', 'receipt-expired', 'BLOCK', 'test', ${sql.json({})}, ${old})`;

      await sql`INSERT INTO release_manifests (id, schema_version, manifest_hash, canonical_manifest, created_at) VALUES ('manifest-passport', 'preflight.release-manifest.v1', ${`sha256:${"b".repeat(64)}`}, ${sql.json({})}, ${old})`;
      await sql`INSERT INTO verification_runs (id, manifest_id, request_identity, lifecycle_status, policy_version, build_sha, report, report_token_hash, report_expires_at, published_at, created_at) VALUES ('passport-run', 'manifest-passport', 'test', 'REPORT_PUBLISHED', 'policy', 'abcdef1', ${sql.json({})}, 'token-passport', ${expired}, ${old}, ${old})`;
      await sql`INSERT INTO receipts (id, report_id, key_id, payload, signature, created_at) VALUES ('receipt-passport', 'passport-run', 'key', ${sql.json({})}, 'signature', ${old})`;
      await sql`INSERT INTO passports (agent_id, receipt_id, decision, policy_version, issued_at, expires_at, asserted_fields) VALUES ('agent', 'receipt-passport', 'RELEASE', 'policy', ${old}, ${future}, ${sql.json({})})`;

      await sql`INSERT INTO cohort_scans (scan_id, started_at, completed_at, policy_version) VALUES ('scan-old', ${old}, ${old}, 'policy'), ('scan-new', now(), now(), 'policy')`;
      await sql`INSERT INTO cohort_results (id, scan_id, agent_id, decision, criterion_codes, declared, observed, reachable, checked_at) VALUES ('cohort-old', 'scan-old', 'agent', 'UNKNOWN', '{}', ${sql.json({})}, ${sql.json({})}, true, ${old}), ('cohort-new', 'scan-new', 'agent', 'RELEASE', '{}', ${sql.json({})}, ${sql.json({})}, true, now())`;
      await sql`INSERT INTO drift_events (id, agent_id, field, scan_id, detected_at) VALUES ('drift-old', 'agent', 'surface', 'scan-old', now() - interval '91 days')`;
      await sql`INSERT INTO rate_limit_counters (scope, key_hash, window_start, count) VALUES ('old', 'key', now() - interval '3 days', 1)`;

      const result = await repository.purgeRetention(30);
      expect(result.verification_runs).toBe(1);
      expect(result.rate_limit_counters).toBe(1);
      expect(result.cohort_results).toBe(1);
      expect(result.drift_events).toBe(1);
      expect((await sql`SELECT id FROM verification_runs WHERE id='expired-run'`)).toHaveLength(0);
      expect((await sql`SELECT id FROM payment_attempts WHERE id='payment-expired'`)).toHaveLength(0);
      expect((await sql`SELECT id FROM receipts WHERE id='receipt-expired'`)).toHaveLength(0);
      expect((await sql`SELECT id FROM verification_runs WHERE id='passport-run'`)).toHaveLength(1);
      expect((await sql`SELECT agent_id FROM passports WHERE agent_id='agent'`)).toHaveLength(1);
      expect((await sql`SELECT id FROM cohort_results WHERE id='cohort-new'`)).toHaveLength(1);
    } finally {
      await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await sql.end();
    }
  }, 30_000);
});
