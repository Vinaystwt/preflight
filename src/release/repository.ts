import { createHash, createHmac } from "node:crypto";
import { ulid } from "ulid";
import type { Sql } from "postgres";
import type { JsonValue } from "../contracts/canonical.js";
import type { ReleaseManifestV1, VerifyReleaseResponseV1 } from "../contracts/release-gate.js";
import type { ReceiptEnvelopeV1 } from "../receipts/signer.js";

export type RunStatus = "REQUEST_VALIDATED" | "PAYMENT_VERIFIED" | "PROBING" | "REPORT_PREPARED" | "SETTLEMENT_PENDING" | "PAYMENT_SETTLED" | "REPORT_PUBLISHED" | "PAYMENT_FAILED" | "RECOVERY_REQUIRED";
export interface StoredRun { id: string; status: RunStatus; report: Omit<VerifyReleaseResponseV1, "report_access"> | null; report_token_hash: string | null; report_expires_at: Date | null; published_at: Date | null }
export interface StoredAuditEvent { event_type: string; safe_metadata: Record<string, JsonValue>; created_at: Date }
export interface StoredPubkey { key_id: string; algorithm: "Ed25519"; public_key_base64: string; status: "active" | "retired"; created_at: Date }
export interface StoredReceipt { id: string; report_id: string; key_id: string; payload: ReceiptEnvelopeV1["payload"]; signature: string; chain_anchor_tx: string | null; created_at: Date }
export interface StoredGalleryEntry { id: string; report_id: string; decision: "BLOCK" | "UNKNOWN"; policy_version: string; redacted_report: JsonValue; created_at: Date }

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
  async reserveBuyerProofSpend(runId: string, values: { target: string; amountAtomic: string; termsHash: string; idempotencyKey: string; targetCapUsdt: number; globalCapUsdt: number }): Promise<{ ok: true; id: string; amountUsdt: string } | { ok: false; reason: "BUYER_CAP_EXCEEDED"; amountUsdt: string; targetSpent: string; globalSpent: string }> {
    const amountUsdtNumber = Number(values.amountAtomic) / 1_000_000;
    const amountUsdt = amountUsdtNumber.toFixed(6);
    const id = `bps_${ulid()}`;
    const keyHash = hash(values.idempotencyKey);
    return this.sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext('preflight:buyer-proof-spend'))`;
      const rows = await transaction<Array<{ target_spent: string; global_spent: string }>>`
        SELECT COALESCE(SUM(amount_usdt) FILTER (WHERE target_url=${values.target}), 0)::text AS target_spent,
               COALESCE(SUM(amount_usdt), 0)::text AS global_spent
        FROM buyer_proof_spend
        WHERE created_at > now() - interval '1 day' AND status IN ('reserved','settled')`;
      const targetSpent = Number(rows[0]?.target_spent ?? 0);
      const globalSpent = Number(rows[0]?.global_spent ?? 0);
      if (targetSpent + amountUsdtNumber > values.targetCapUsdt || globalSpent + amountUsdtNumber > values.globalCapUsdt) {
        return { ok: false, reason: "BUYER_CAP_EXCEEDED", amountUsdt, targetSpent: targetSpent.toFixed(6), globalSpent: globalSpent.toFixed(6) } as const;
      }
      await transaction`
        INSERT INTO buyer_proof_spend (id, run_id, target_url, amount_atomic, amount_usdt, terms_hash, idempotency_key_hash, status)
        VALUES (${id}, ${runId}, ${values.target}, ${values.amountAtomic}, ${amountUsdt}, ${values.termsHash}, ${keyHash}, 'reserved')`;
      return { ok: true, id, amountUsdt } as const;
    });
  }
  async updateBuyerProofSpend(id: string, status: "settled" | "failed" | "aborted", settlementReference?: string): Promise<void> {
    await this.sql`UPDATE buyer_proof_spend SET status=${status}, settlement_reference=${settlementReference ?? null}, updated_at=now() WHERE id=${id}`;
  }
  async updatePayment(id: string, verification: string, settlement: string, reference?: string, transaction?: string, refundOwed = false, safeError?: string): Promise<void> {
    await this.sql`UPDATE payment_attempts SET verification_state=${verification}, settlement_state=${settlement}, settlement_reference=${reference ?? null}, transaction_hash=${transaction ?? null}, refund_owed=${refundOwed}, safe_error_code=${safeError ?? null}, updated_at=now() WHERE id=${id}`;
  }
  async settledPaymentForRun(runId: string): Promise<{ settlement_reference: string; payer: string | null; amount_atomic: string; pay_to: string } | null> {
    const rows = await this.sql<Array<{ settlement_reference: string; payer: string | null; amount_atomic: string; pay_to: string }>>`
      SELECT settlement_reference, payer, amount_atomic, pay_to
      FROM payment_attempts
      WHERE run_id=${runId} AND settlement_state='SETTLED' AND settlement_reference IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`;
    return rows[0] ?? null;
  }
  async prepareReport(runId: string, report: Omit<VerifyReleaseResponseV1, "report_access">, snapshot: JsonValue, snapshotHash: string): Promise<void> {
    await this.sql`UPDATE verification_runs SET lifecycle_status='REPORT_PREPARED', report=${this.sql.json(report as unknown as JsonValue)}, runtime_snapshot=${this.sql.json(snapshot)}, runtime_snapshot_hash=${snapshotHash}, criterion_groups=${this.sql.json(report.criterion_groups as unknown as JsonValue)}, decision=${report.decision}, report_expires_at=${new Date(report.report_expires_at)}, updated_at=now() WHERE id=${runId}`;
    await this.audit(runId, "REPORT_PREPARED", { decision: report.decision });
  }
  async updateReportAddenda(runId: string, report: Omit<VerifyReleaseResponseV1, "report_access">): Promise<void> {
    await this.sql`UPDATE verification_runs SET report=${this.sql.json(report as unknown as JsonValue)}, updated_at=now() WHERE id=${runId}`;
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
  async upsertPubkey(values: { keyId: string; publicKeyBase64: string }): Promise<void> {
    await this.sql`
      INSERT INTO pubkeys (key_id, algorithm, public_key_base64, status)
      VALUES (${values.keyId}, 'Ed25519', ${values.publicKeyBase64}, 'active')
      ON CONFLICT (key_id) DO UPDATE SET public_key_base64=EXCLUDED.public_key_base64, status='active', retired_at=NULL`;
  }
  async listPubkeys(): Promise<StoredPubkey[]> {
    return this.sql<StoredPubkey[]>`SELECT key_id, algorithm, public_key_base64, status, created_at FROM pubkeys ORDER BY created_at DESC`;
  }
  async storeReceipt(reportId: string, receipt: ReceiptEnvelopeV1): Promise<StoredReceipt> {
    const rows = await this.sql<StoredReceipt[]>`
      INSERT INTO receipts (id, report_id, key_id, payload, signature, chain_anchor_tx)
      VALUES (${receipt.receipt_id}, ${reportId}, ${receipt.key_id}, ${this.sql.json(receipt.payload as unknown as JsonValue)}, ${receipt.signature}, ${receipt.payload.chain_anchor?.tx ?? null})
      ON CONFLICT (report_id) DO UPDATE SET report_id=EXCLUDED.report_id
      RETURNING id, report_id, key_id, payload, signature, chain_anchor_tx, created_at`;
    const row = rows[0]; if (!row) throw new Error("receipt persistence failed"); return row;
  }
  async getReceipt(id: string): Promise<StoredReceipt | null> {
    const rows = await this.sql<StoredReceipt[]>`SELECT id, report_id, key_id, payload, signature, chain_anchor_tx, created_at FROM receipts WHERE id=${id}`;
    return rows[0] ?? null;
  }
  async getReceiptByReport(reportId: string): Promise<StoredReceipt | null> {
    const rows = await this.sql<StoredReceipt[]>`SELECT id, report_id, key_id, payload, signature, chain_anchor_tx, created_at FROM receipts WHERE report_id=${reportId}`;
    return rows[0] ?? null;
  }
  async hasNewerDrift(reportId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ drift: boolean }>>`
      WITH current AS (
        SELECT id, created_at,
          report->'manifest'->>'manifest_hash' AS manifest_hash,
          report->'runtime_snapshot'->>'snapshot_hash' AS snapshot_hash,
          report->'manifest'->'canonical_manifest'->'target'->>'endpoint' AS endpoint
        FROM verification_runs WHERE id=${reportId} AND report IS NOT NULL
      )
      SELECT EXISTS (
        SELECT 1 FROM verification_runs newer, current
        WHERE newer.report IS NOT NULL
          AND newer.published_at IS NOT NULL
          AND newer.created_at > current.created_at
          AND newer.report->'manifest'->'canonical_manifest'->'target'->>'endpoint' = current.endpoint
          AND (
            newer.report->'manifest'->>'manifest_hash' <> current.manifest_hash
            OR newer.report->'runtime_snapshot'->>'snapshot_hash' <> current.snapshot_hash
          )
      ) AS drift`;
    return rows[0]?.drift ?? false;
  }
  async recordBadgeEvent(reportId: string, receiptId: string | null, status: "issued" | "denied" | "expired", metadata: Record<string, JsonValue> = {}): Promise<void> {
    await this.sql`INSERT INTO badge_events (id, report_id, receipt_id, status, safe_metadata) VALUES (${`badge_${ulid()}`}, ${reportId}, ${receiptId}, ${status}, ${this.sql.json(metadata)})`;
  }
  async insertGalleryEntry(reportId: string, decision: "BLOCK" | "UNKNOWN", policyVersion: string, redacted: JsonValue): Promise<void> {
    await this.sql`
      INSERT INTO gallery_entries (id, report_id, decision, policy_version, redacted_report)
      VALUES (${`gal_${ulid()}`}, ${reportId}, ${decision}, ${policyVersion}, ${this.sql.json(redacted)})
      ON CONFLICT (report_id) DO NOTHING`;
  }
  async listGalleryEntries(limit = 50): Promise<StoredGalleryEntry[]> {
    return this.sql<StoredGalleryEntry[]>`SELECT id, report_id, decision, policy_version, redacted_report, created_at FROM gallery_entries ORDER BY created_at DESC LIMIT ${limit}`;
  }
  async events(runId: string): Promise<StoredAuditEvent[]> {
    return this.sql<StoredAuditEvent[]>`SELECT event_type, safe_metadata, created_at FROM audit_events WHERE run_id=${runId} ORDER BY created_at`;
  }
  async recoverSettledUnpublished(): Promise<number> {
    const rows = await this.sql<Array<{ id: string }>>`SELECT id FROM verification_runs WHERE lifecycle_status='PAYMENT_SETTLED' AND report IS NOT NULL AND published_at IS NULL FOR UPDATE SKIP LOCKED`;
    for (const row of rows) await this.publish(row.id); return rows.length;
  }
  async settledUnpublishedRuns(): Promise<StoredRun[]> {
    const rows = await this.sql<Array<{ id: string }>>`SELECT id FROM verification_runs WHERE lifecycle_status='PAYMENT_SETTLED' AND report IS NOT NULL AND published_at IS NULL ORDER BY updated_at FOR UPDATE SKIP LOCKED`;
    return Promise.all(rows.map((row) => this.getRun(row.id)));
  }
  async ambiguousSettlements(): Promise<Array<{ paymentId: string; runId: string; reference: string }>> {
    return this.sql<Array<{ paymentId: string; runId: string; reference: string }>>`
      SELECT pa.id AS "paymentId", pa.run_id AS "runId", pa.settlement_reference AS reference
      FROM payment_attempts pa JOIN verification_runs vr ON vr.id = pa.run_id
      WHERE pa.settlement_reference IS NOT NULL AND pa.settlement_state IN ('pending', 'timeout') AND vr.lifecycle_status = 'SETTLEMENT_PENDING'`;
  }
  async reconcileConfirmedSettlement(paymentId: string, runId: string, reference: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`UPDATE payment_attempts SET settlement_state='SETTLED', transaction_hash=${reference}, safe_error_code=null, updated_at=now() WHERE id=${paymentId} AND settlement_reference=${reference}`;
      const transitioned = await transaction`UPDATE verification_runs SET lifecycle_status='PAYMENT_SETTLED', updated_at=now() WHERE id=${runId} AND lifecycle_status='SETTLEMENT_PENDING' RETURNING id`;
      if (transitioned.length) await transaction`INSERT INTO audit_events (run_id, payment_attempt_id, event_type, safe_metadata) VALUES (${runId}, ${paymentId}, 'PAYMENT_SETTLED_RECONCILED', ${transaction.json({ settlement_reference: reference })})`;
    });
  }
  async audit(runId: string, event: string, metadata: Record<string, JsonValue>): Promise<void> { await this.sql`INSERT INTO audit_events (run_id, event_type, safe_metadata) VALUES (${runId}, ${event}, ${this.sql.json(metadata)})`; }
}
