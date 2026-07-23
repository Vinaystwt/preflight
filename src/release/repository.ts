import { createHash, createHmac } from "node:crypto";
import { ulid } from "ulid";
import type { Sql } from "postgres";
import type { JsonValue } from "../contracts/canonical.js";
import type { AgentResolutionV1, ReleaseManifestV1, VerifyReleaseResponseV1 } from "../contracts/release-gate.js";
import type { ReceiptEnvelopeV1 } from "../receipts/signer.js";

export type RunStatus = "REQUEST_VALIDATED" | "PAYMENT_VERIFIED" | "PROBING" | "REPORT_PREPARED" | "SETTLEMENT_PENDING" | "PAYMENT_SETTLED" | "REPORT_PUBLISHED" | "PAYMENT_FAILED" | "RECOVERY_REQUIRED";
export interface StoredRun { id: string; status: RunStatus; report: Omit<VerifyReleaseResponseV1, "report_access"> | null; report_token_hash: string | null; report_expires_at: Date | null; published_at: Date | null }
export interface StoredAuditEvent { event_type: string; safe_metadata: Record<string, JsonValue>; created_at: Date }
export interface StoredPubkey { key_id: string; algorithm: "Ed25519"; public_key_base64: string; status: "active" | "retired"; created_at: Date }
export interface StoredReceipt { id: string; report_id: string; key_id: string; payload: ReceiptEnvelopeV1["payload"]; signature: string; chain_anchor_tx: string | null; created_at: Date }
export interface StoredGalleryEntry { id: string; report_id: string; decision: "BLOCK" | "UNKNOWN"; policy_version: string; redacted_report: JsonValue; created_at: Date }
export interface StoredSelfCheck { id: string; report_id: string; receipt_id: string | null; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; settlement_ref: string | null; label: string; customer_demand: boolean; payload: JsonValue; published_at: Date }
export interface RetentionPurgeResult {
  verification_runs: number;
  payment_attempts: number;
  audit_events: number;
  buyer_proof_spend: number;
  receipts: number;
  badge_events: number;
  gallery_entries: number;
  self_checks: number;
  release_manifests: number;
  cohort_results: number;
  cohort_scans: number;
  drift_events: number;
  rate_limit_counters: number;
}

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

  /**
   * Enforces the published retention limits without a separate worker. A run is
   * never eligible while its report is still valid, while settlement can still
   * be in flight, or while a non-revoked passport still relies on its receipt.
   */
  async purgeRetention(retentionDays: number): Promise<RetentionPurgeResult> {
    return this.sql.begin(async (transaction) => {
      const result: RetentionPurgeResult = {
        verification_runs: 0, payment_attempts: 0, audit_events: 0, buyer_proof_spend: 0, receipts: 0,
        badge_events: 0, gallery_entries: 0, self_checks: 0, release_manifests: 0, cohort_results: 0,
        cohort_scans: 0, drift_events: 0, rate_limit_counters: 0
      };
      const candidates = await transaction<Array<{ id: string }>>`
        SELECT vr.id
        FROM verification_runs vr
        WHERE vr.created_at < now() - (${retentionDays} * interval '1 day')
          AND (vr.report_expires_at IS NULL OR vr.report_expires_at < now())
          AND vr.lifecycle_status NOT IN ('PAYMENT_VERIFIED', 'PROBING', 'REPORT_PREPARED', 'SETTLEMENT_PENDING')
          AND NOT EXISTS (
            SELECT 1
            FROM receipts r JOIN passports p ON p.receipt_id = r.id
            WHERE r.report_id = vr.id AND p.revoked_at IS NULL AND p.expires_at > now()
          )
        FOR UPDATE`;
      const runIds = candidates.map((row) => row.id);
      if (runIds.length) {
        const receiptRows = await transaction<Array<{ id: string }>>`SELECT id FROM receipts WHERE report_id IN ${transaction(runIds)}`;
        const receiptIds = receiptRows.map((row) => row.id);
        result.self_checks = (await transaction`DELETE FROM self_checks WHERE report_id IN ${transaction(runIds)} RETURNING id`).length;
        result.badge_events = (await transaction`DELETE FROM badge_events WHERE report_id IN ${transaction(runIds)} RETURNING id`).length;
        result.gallery_entries = (await transaction`DELETE FROM gallery_entries WHERE report_id IN ${transaction(runIds)} RETURNING id`).length;
        if (receiptIds.length) {
          // Candidate selection excludes active passports. Retired/expired
          // passport rows cannot keep an otherwise expired report alive.
          await transaction`DELETE FROM passports WHERE receipt_id IN ${transaction(receiptIds)} AND (revoked_at IS NOT NULL OR expires_at <= now())`;
        }
        result.audit_events = (await transaction`
          DELETE FROM audit_events
          WHERE run_id IN ${transaction(runIds)}
             OR payment_attempt_id IN (SELECT id FROM payment_attempts WHERE run_id IN ${transaction(runIds)})
          RETURNING id`).length;
        result.buyer_proof_spend = (await transaction`DELETE FROM buyer_proof_spend WHERE run_id IN ${transaction(runIds)} RETURNING id`).length;
        result.payment_attempts = (await transaction`DELETE FROM payment_attempts WHERE run_id IN ${transaction(runIds)} RETURNING id`).length;
        result.receipts = (await transaction`DELETE FROM receipts WHERE report_id IN ${transaction(runIds)} RETURNING id`).length;
        result.verification_runs = (await transaction`DELETE FROM verification_runs WHERE id IN ${transaction(runIds)} RETURNING id`).length;
      }
      result.badge_events += (await transaction`DELETE FROM badge_events WHERE created_at < now() - interval '30 days' RETURNING id`).length;
      result.cohort_results = (await transaction`
        DELETE FROM cohort_results older
        WHERE older.checked_at < now() - interval '7 days'
          AND EXISTS (SELECT 1 FROM cohort_results newer WHERE newer.agent_id = older.agent_id AND newer.checked_at > older.checked_at)
        RETURNING id`).length;
      result.drift_events = (await transaction`DELETE FROM drift_events WHERE detected_at < now() - interval '90 days' RETURNING id`).length;
      result.cohort_scans = (await transaction`
        DELETE FROM cohort_scans scan
        WHERE COALESCE(scan.completed_at, scan.started_at) < now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM cohort_results result WHERE result.scan_id = scan.scan_id)
          AND NOT EXISTS (SELECT 1 FROM drift_events drift WHERE drift.scan_id = scan.scan_id)
        RETURNING scan_id`).length;
      result.rate_limit_counters = (await transaction`DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 days' RETURNING scope`).length;
      result.release_manifests = (await transaction`
        DELETE FROM release_manifests manifest
        WHERE manifest.created_at < now() - (${retentionDays} * interval '1 day')
          AND NOT EXISTS (SELECT 1 FROM verification_runs run WHERE run.manifest_id = manifest.id)
        RETURNING id`).length;
      return result;
    });
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

  async auditSystem(event: string, metadata: Record<string, JsonValue>): Promise<void> {
    await this.sql`INSERT INTO audit_events (event_type, safe_metadata) VALUES (${event}, ${this.sql.json(metadata)})`;
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
    if (rows.length) {
      await this.audit(runId, "REPORT_PUBLISHED", {});
      return token;
    }
    const existing = await this.getRun(runId).catch(() => null);
    if (existing?.status === "REPORT_PUBLISHED" && existing.published_at && existing.report_token_hash === tokenHash) return token;
    if (existing?.status === "REPORT_PUBLISHED") throw new Error("report publication token mismatch");
    throw new Error("report cannot publish before settlement is confirmed");
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
  async cacheAgentResolution(value: AgentResolutionV1, ttlSeconds: number): Promise<void> {
    await this.sql`INSERT INTO agent_resolutions (agent_id, name, description, category_code, status, services, resolution_source, resolved_at, expires_at)
      VALUES (${value.agent_id}, ${this.sql.json(value.name)}, ${this.sql.json(value.description)}, ${this.sql.json(value.category_code)}, ${this.sql.json(value.status)}, ${this.sql.json(value.services)}, ${value.resolution_source}, ${new Date(value.resolved_at)}, now() + (${ttlSeconds} * interval '1 second'))
      ON CONFLICT (agent_id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category_code=EXCLUDED.category_code, status=EXCLUDED.status, services=EXCLUDED.services, resolution_source=EXCLUDED.resolution_source, resolved_at=EXCLUDED.resolved_at, expires_at=EXCLUDED.expires_at`;
  }
  async cachedAgentResolution(agentId: string): Promise<AgentResolutionV1 | null> {
    const rows = await this.sql<Array<{ agent_id: string; name: AgentResolutionV1["name"]; description: AgentResolutionV1["description"]; category_code: AgentResolutionV1["category_code"]; status: AgentResolutionV1["status"]; services: AgentResolutionV1["services"]; resolution_source: string; resolved_at: Date }>>`
      SELECT agent_id, name, description, category_code, status, services, resolution_source, resolved_at FROM agent_resolutions WHERE agent_id=${agentId} AND expires_at > now()`;
    const row = rows[0]; return row ? { ...row, resolved_at: row.resolved_at.toISOString() } : null;
  }
  async invalidateAgentResolution(agentId: string): Promise<void> { await this.sql`DELETE FROM agent_resolutions WHERE agent_id=${agentId}`; }
  async beginCohortScan(policyVersion: string): Promise<string> {
    const id = `coh_${ulid()}`; await this.sql`INSERT INTO cohort_scans (scan_id, started_at, policy_version) VALUES (${id}, now(), ${policyVersion})`; return id;
  }
  async recordCohortResult(scanId: string, value: { agentId: string; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; criterionCodes: string[]; declared: JsonValue; observed: JsonValue; reachable: boolean }): Promise<void> {
    await this.sql`INSERT INTO cohort_results (id, scan_id, agent_id, decision, criterion_codes, declared, observed, reachable) VALUES (${`chr_${ulid()}`}, ${scanId}, ${value.agentId}, ${value.decision}, ${this.sql.array(value.criterionCodes)}, ${this.sql.json(value.declared)}, ${this.sql.json(value.observed)}, ${value.reachable})`;
  }
  async completeCohortScan(scanId: string, count: number): Promise<void> { await this.sql`UPDATE cohort_scans SET completed_at=now(), asps_scanned=${count} WHERE scan_id=${scanId}`; }
  async latestCohortRows(): Promise<Array<{ agent_id: string; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; criterion_codes: string[]; declared: JsonValue; observed: JsonValue; reachable: boolean; checked_at: Date; name: string | null }>> {
    return this.sql`SELECT DISTINCT ON (cr.agent_id) cr.agent_id, cr.decision, cr.criterion_codes, cr.declared, cr.observed, cr.reachable, cr.checked_at, ar.name->>'value' AS name FROM cohort_results cr LEFT JOIN agent_resolutions ar ON ar.agent_id=cr.agent_id ORDER BY cr.agent_id, cr.checked_at DESC`;
  }
  async cohortRow(agentId: string): Promise<{ agent_id: string; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; criterion_codes: string[]; declared: JsonValue; observed: JsonValue; reachable: boolean; checked_at: Date; name: string | null } | null> {
    const rows = await this.sql<Array<{ agent_id: string; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; criterion_codes: string[]; declared: JsonValue; observed: JsonValue; reachable: boolean; checked_at: Date; name: string | null }>>`SELECT cr.agent_id, cr.decision, cr.criterion_codes, cr.declared, cr.observed, cr.reachable, cr.checked_at, ar.name->>'value' AS name FROM cohort_results cr LEFT JOIN agent_resolutions ar ON ar.agent_id=cr.agent_id WHERE cr.agent_id=${agentId} ORDER BY cr.checked_at DESC LIMIT 1`; return rows[0] ?? null;
  }
  async recordDrift(agentId: string, field: string, before: JsonValue, after: JsonValue, scanId: string): Promise<void> { await this.sql`INSERT INTO drift_events (id, agent_id, field, before_value, after_value, scan_id) VALUES (${`drf_${ulid()}`}, ${agentId}, ${field}, ${this.sql.json(before)}, ${this.sql.json(after)}, ${scanId})`; }
  async revokePassportsForDrift(agentId: string, reason: string): Promise<void> { await this.sql`UPDATE passports SET revoked_at=now(), revocation_reason=${reason} WHERE agent_id=${agentId} AND revoked_at IS NULL`; }
  async driftEventsLast24h(): Promise<number> { const rows = await this.sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM drift_events WHERE detected_at >= now() - interval '24 hours'`; return rows[0]?.count ?? 0; }
  async latestCohortScan(): Promise<{ generated_at: Date; policy_version: string } | null> { const rows = await this.sql<Array<{ generated_at: Date; policy_version: string }>>`SELECT completed_at AS generated_at, policy_version FROM cohort_scans WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`; return rows[0] ?? null; }
  async getPassport(agentId: string): Promise<{ agent_id: string; receipt_id: string; decision: "RELEASE"; policy_version: string; issued_at: Date; expires_at: Date; revoked_at: Date | null; revocation_reason: string | null; asserted_fields: JsonValue } | null> { const rows = await this.sql<Array<{ agent_id: string; receipt_id: string; decision: "RELEASE"; policy_version: string; issued_at: Date; expires_at: Date; revoked_at: Date | null; revocation_reason: string | null; asserted_fields: JsonValue }>>`SELECT * FROM passports WHERE agent_id=${agentId}`; return rows[0] ?? null; }
  async upsertPassport(agentId: string, receiptId: string, policyVersion: string, assertedFields: JsonValue, expiresAt: Date): Promise<void> { await this.sql`INSERT INTO passports (agent_id, receipt_id, decision, policy_version, issued_at, expires_at, asserted_fields) VALUES (${agentId}, ${receiptId}, 'RELEASE', ${policyVersion}, now(), ${expiresAt}, ${this.sql.json(assertedFields)}) ON CONFLICT (agent_id) DO UPDATE SET receipt_id=EXCLUDED.receipt_id, decision='RELEASE', policy_version=EXCLUDED.policy_version, issued_at=now(), expires_at=EXCLUDED.expires_at, revoked_at=NULL, revocation_reason=NULL, asserted_fields=EXCLUDED.asserted_fields`; }
  async recordBenchmark(cases: JsonValue, total: number, passing: number, policyVersion: string): Promise<void> { await this.sql`INSERT INTO benchmark_runs (run_id, policy_version, generated_at, total, passing, cases) VALUES (${`bnc_${ulid()}`}, ${policyVersion}, now(), ${total}, ${passing}, ${this.sql.json(cases)})`; }
  async latestBenchmark(): Promise<{ policy_version: string; generated_at: Date; total: number; passing: number; cases: JsonValue } | null> { const rows = await this.sql<Array<{ policy_version: string; generated_at: Date; total: number; passing: number; cases: JsonValue }>>`SELECT policy_version, generated_at, total, passing, cases FROM benchmark_runs ORDER BY generated_at DESC LIMIT 1`; return rows[0] ?? null; }
  async recordSelfCheck(value: { reportId: string; receiptId?: string | null; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; settlementRef?: string | null; label: string; customerDemand: boolean; payload: JsonValue }): Promise<void> {
    await this.sql`INSERT INTO self_checks (id, report_id, receipt_id, decision, settlement_ref, label, customer_demand, payload)
      VALUES (${`sch_${ulid()}`}, ${value.reportId}, ${value.receiptId ?? null}, ${value.decision}, ${value.settlementRef ?? null}, ${value.label}, ${value.customerDemand}, ${this.sql.json(value.payload)})
      ON CONFLICT (id) DO NOTHING`;
  }
  async latestSelfCheck(): Promise<StoredSelfCheck | null> {
    const rows = await this.sql<StoredSelfCheck[]>`SELECT id, report_id, receipt_id, decision, settlement_ref, label, customer_demand, payload, published_at FROM self_checks ORDER BY published_at DESC LIMIT 1`;
    return rows[0] ?? null;
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
