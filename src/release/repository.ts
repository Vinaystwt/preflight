import { createHash, createHmac } from "node:crypto";
import { ulid } from "ulid";
import type { Sql } from "postgres";
import type { JsonValue } from "../contracts/canonical.js";
import type { ReleaseManifestV1, VerifyReleaseResponseV1 } from "../contracts/release-gate.js";

export type RunStatus = "REQUEST_VALIDATED" | "PAYMENT_VERIFIED" | "PROBING" | "REPORT_PREPARED" | "SETTLEMENT_PENDING" | "PAYMENT_SETTLED" | "REPORT_PUBLISHED" | "PAYMENT_FAILED" | "RECOVERY_REQUIRED";
export interface StoredRun { id: string; status: RunStatus; report: Omit<VerifyReleaseResponseV1, "report_access"> | null; report_token_hash: string | null; report_expires_at: Date | null; published_at: Date | null }

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class ReleaseRepository {
  constructor(private readonly sql: Sql, private readonly tokenSecret: string) {}
  tokenFor(runId: string): string { return createHmac("sha256", this.tokenSecret).update(`preflight-report:${runId}`).digest("base64url"); }
  tokenHash(token: string): string { return hash(token); }

  async reserveRateLimit(scope: string, key: string, limit: number, window: "day" | "hour" | "minute" = "day"): Promise<{ allowed: boolean; count: number }> {
    const keyHash = hash(key); const interval = window === "day" ? "day" : window === "hour" ? "hour" : "minute";
    const rows = await this.sql<Array<{ count: number }>>`
      INSERT INTO rate_limit_counters (scope, key_hash, window_start, count)
      VALUES (${scope}, ${keyHash}, date_trunc(${interval}, now()), 1)
      ON CONFLICT (scope, key_hash, window_start) DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = now()
      RETURNING count`;
    const count = rows[0]?.count ?? limit + 1; return { allowed: count <= limit, count };
  }
  async concurrencyAvailable(target: string, targetLimit = 3, globalLimit = 20): Promise<boolean> {
    const rows = await this.sql<Array<{ target_active: number; global_active: number }>>`
      SELECT count(*) FILTER (WHERE rm.canonical_manifest->'target'->>'endpoint' = ${target})::int AS target_active,
             count(*)::int AS global_active
      FROM verification_runs vr JOIN release_manifests rm ON rm.id = vr.manifest_id
      WHERE vr.lifecycle_status IN ('PAYMENT_VERIFIED','PROBING','REPORT_PREPARED','SETTLEMENT_PENDING')`;
    return (rows[0]?.target_active ?? globalLimit) < targetLimit && (rows[0]?.global_active ?? globalLimit) < globalLimit;
  }
  async claimPaidConcurrency(runId: string, target: string, targetLimit = 3, globalLimit = 20): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext('preflight:paid:global'))`;
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${'preflight:paid:target:' + target}))`;
      const rows = await transaction<Array<{ target_active: number; global_active: number }>>`
        SELECT count(*) FILTER (WHERE rm.canonical_manifest->'target'->>'endpoint' = ${target})::int AS target_active,
               count(*)::int AS global_active
        FROM verification_runs vr JOIN release_manifests rm ON rm.id = vr.manifest_id
        WHERE vr.lifecycle_status IN ('PAYMENT_VERIFIED','PROBING','REPORT_PREPARED','SETTLEMENT_PENDING')`;
      if ((rows[0]?.target_active ?? targetLimit) >= targetLimit || (rows[0]?.global_active ?? globalLimit) >= globalLimit) return false;
      const claimed = await transaction`UPDATE verification_runs SET lifecycle_status='PAYMENT_VERIFIED', updated_at=now() WHERE id=${runId} AND lifecycle_status='REQUEST_VALIDATED' RETURNING id`;
      if (!claimed.length) return false;
      await transaction`INSERT INTO audit_events (run_id, event_type, safe_metadata) VALUES (${runId}, 'PAYMENT_VERIFIED', '{}'::jsonb)`;
      return true;
    });
  }
  async claimDraftConcurrency(target: string, requestId: string, limit = 2): Promise<boolean> {
    const scope = `draft_active:${hash(target)}`; const key = hash(requestId);
    return this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${'preflight:' + scope}))`;
      await transaction`DELETE FROM rate_limit_counters WHERE scope=${scope} AND updated_at < now() - interval '2 minutes'`;
      const active = await transaction<Array<{ count: number }>>`SELECT count(*)::int AS count FROM rate_limit_counters WHERE scope=${scope}`;
      if ((active[0]?.count ?? limit) >= limit) return false;
      await transaction`INSERT INTO rate_limit_counters (scope, key_hash, window_start, count) VALUES (${scope}, ${key}, now(), 1)`;
      return true;
    });
  }
  async releaseDraftConcurrency(target: string, requestId: string): Promise<void> {
    await this.sql`DELETE FROM rate_limit_counters WHERE scope=${'draft_active:' + hash(target)} AND key_hash=${hash(requestId)}`;
  }

  async storeManifest(manifest: ReleaseManifestV1, manifestHash: string): Promise<string> {
    const rows = await this.sql<Array<{ id: string }>>`
      INSERT INTO release_manifests (id, schema_version, manifest_hash, canonical_manifest)
      VALUES (${ulid()}, ${manifest.schema_version}, ${manifestHash}, ${this.sql.json(manifest as unknown as JsonValue)})
      ON CONFLICT (manifest_hash) DO UPDATE SET manifest_hash = EXCLUDED.manifest_hash RETURNING id`;
    if (!rows[0]) throw new Error("manifest persistence failed"); return rows[0].id;
  }

  async beginRun(manifestId: string, requestIdentity: string, idempotencyKey: string, policyVersion: string, buildSha: string): Promise<{ run: StoredRun; duplicate: boolean }> {
    const idempotencyHash = hash(idempotencyKey);
    const existing = await this.sql<Array<{ id: string }>>`SELECT id FROM verification_runs WHERE idempotency_key_hash = ${idempotencyHash}`;
    if (existing[0]) return { run: await this.getRun(existing[0].id), duplicate: true };
    const id = `pfr_${ulid()}`;
    await this.sql`INSERT INTO verification_runs (id, manifest_id, request_identity, idempotency_key_hash, lifecycle_status, policy_version, build_sha)
      VALUES (${id}, ${manifestId}, ${requestIdentity}, ${idempotencyHash}, 'REQUEST_VALIDATED', ${policyVersion}, ${buildSha})`;
    await this.audit(id, "REQUEST_VALIDATED", {}); return { run: await this.getRun(id), duplicate: false };
  }

  async getRun(id: string): Promise<StoredRun> {
    const rows = await this.sql<Array<{ id: string; lifecycle_status: RunStatus; report: Omit<VerifyReleaseResponseV1, "report_access"> | null; report_token_hash: string | null; report_expires_at: Date | null; published_at: Date | null }>>`
      SELECT id, lifecycle_status, report, report_token_hash, report_expires_at, published_at FROM verification_runs WHERE id = ${id}`;
    const row = rows[0]; if (!row) throw new Error("run not found"); return { id: row.id, status: row.lifecycle_status, report: row.report, report_token_hash: row.report_token_hash, report_expires_at: row.report_expires_at, published_at: row.published_at };
  }

  async transition(runId: string, from: RunStatus[], to: RunStatus, metadata: Record<string, JsonValue> = {}): Promise<void> {
    const rows = await this.sql`UPDATE verification_runs SET lifecycle_status = ${to}, updated_at = now() WHERE id = ${runId} AND lifecycle_status IN ${this.sql(from)} RETURNING id`;
    if (!rows.length) throw new Error(`invalid run transition to ${to}`); await this.audit(runId, to, metadata);
  }

  async createPayment(runId: string, values: { payloadHash: string; identifier?: string; network: string; asset: string; amount: string; payTo: string; payer?: string }): Promise<string | null> {
    const id = `pay_${ulid()}`;
    const rows = await this.sql`INSERT INTO payment_attempts (id, run_id, payment_identifier, payment_payload_hash, network, asset, amount_atomic, pay_to, payer, verification_state, settlement_state)
      VALUES (${id}, ${runId}, ${values.identifier ?? null}, ${values.payloadHash}, ${values.network}, ${values.asset}, ${values.amount}, ${values.payTo}, ${values.payer ?? null}, 'PENDING', 'NOT_STARTED')
      ON CONFLICT (payment_payload_hash) WHERE payment_payload_hash IS NOT NULL DO NOTHING RETURNING id`;
    return rows.length ? id : null;
  }
  async updatePayment(id: string, verification: string, settlement: string, reference?: string, transaction?: string, refundOwed = false, safeError?: string): Promise<void> {
    await this.sql`UPDATE payment_attempts SET verification_state=${verification}, settlement_state=${settlement}, settlement_reference=${reference ?? null}, transaction_hash=${transaction ?? null}, refund_owed=${refundOwed}, safe_error_code=${safeError ?? null}, updated_at=now() WHERE id=${id}`;
  }
  async prepareReport(runId: string, report: Omit<VerifyReleaseResponseV1, "report_access">, snapshot: JsonValue, snapshotHash: string): Promise<void> {
    await this.sql`UPDATE verification_runs SET lifecycle_status='REPORT_PREPARED', report=${this.sql.json(report as unknown as JsonValue)}, runtime_snapshot=${this.sql.json(snapshot)}, runtime_snapshot_hash=${snapshotHash}, criterion_groups=${this.sql.json(report.criterion_groups as unknown as JsonValue)}, decision=${report.decision}, report_expires_at=${new Date(report.report_expires_at)}, updated_at=now() WHERE id=${runId}`;
    await this.audit(runId, "REPORT_PREPARED", { decision: report.decision });
  }
  async publish(runId: string): Promise<string> {
    const token = this.tokenFor(runId); const tokenHash = this.tokenHash(token);
    const rows = await this.sql`UPDATE verification_runs SET lifecycle_status='REPORT_PUBLISHED', report_token_hash=${tokenHash}, published_at=now(), updated_at=now() WHERE id=${runId} AND lifecycle_status='PAYMENT_SETTLED' AND report IS NOT NULL RETURNING id`;
    if (!rows.length) throw new Error("report cannot publish before settlement"); await this.audit(runId, "REPORT_PUBLISHED", {}); return token;
  }
  async retrieve(reportId: string, token: string): Promise<StoredRun | null> {
    const run = await this.getRun(reportId).catch(() => null); if (!run || run.status !== "REPORT_PUBLISHED" || !run.report_token_hash || this.tokenHash(token) !== run.report_token_hash) return null;
    return run;
  }
  async recoverSettledUnpublished(): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`SELECT id FROM verification_runs WHERE lifecycle_status='PAYMENT_SETTLED' AND report IS NOT NULL AND published_at IS NULL FOR UPDATE SKIP LOCKED`;
    for (const row of rows) await this.publish(row.id); return rows.length;
  }
  async audit(runId: string, event: string, metadata: Record<string, JsonValue>): Promise<void> { await this.sql`INSERT INTO audit_events (run_id, event_type, safe_metadata) VALUES (${runId}, ${event}, ${this.sql.json(metadata)})`; }
}
