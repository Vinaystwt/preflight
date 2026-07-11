import postgres, { type Sql } from "postgres";
import { ulid } from "ulid";
import type { Config } from "../config.js";
import type { ReportEnvelope } from "../types.js";
import type { MarketScanResult } from "../scanner.js";

/** Postgres parameters may never be undefined. Preserve JSON shape by normalizing recursively. */
export function normalizeUndefined(value: unknown): postgres.JSONValue {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeUndefined);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeUndefined(item)])) as postgres.JSONValue;
  }
  return value as postgres.JSONValue;
}

export interface AttestationJob { id: string; check_id: string; report_hash: string; attempts: number }
export interface MonitorJob { id: string; target: string; interval_s: number; expires_at: Date }
export interface WatchReportData { monitor_id: string; status: string; expires_at: Date; uptime_pct: number; latency_series: Array<{ ts: string; latency_ms: number | null }>; finding_history: Array<{ ts: string; code: string }> }
export interface BadgeData { target_id: string; report_id: string; verdict: ReportEnvelope["verdict"]; verified_at: Date; badge_eligible: boolean }
export type PlaygroundReservation = "ok" | "ip_cap" | "global_cap";

export interface Database {
  sql: Sql;
  health(): Promise<boolean>;
  persist(report: ReportEnvelope, expected: unknown, results: unknown): Promise<void>;
  getReport(id: string): Promise<ReportEnvelope | null>;
  recordCall(call: { checkId: string | null; direction: "in" | "out"; tool: string; priceUsdt: string; settleRef: string | null; settleStatus: string; payer: string | null; ownerAttestation?: boolean }): Promise<string>;
  updateCallSettlement(settleRef: string, status: string, replacementRef?: string): Promise<void>;
  getCallByCheck(checkId: string): Promise<{ id: string; settle_ref: string | null; settle_status: string; payer: string | null } | null>;
  getCallsByCheck(checkId: string): Promise<Array<{ id: string; direction: "in" | "out"; tool: string; price_usdt: string; settle_ref: string | null; settle_status: string; payer: string | null; owner_attestation: boolean }>>;
  reserveSpend(target: string, amountUsdt: string, targetCapUsdt: number, globalCapUsdt: number): Promise<string | null>;
  completeSpend(id: string, status: "spent" | "failed", settleRef: string | null): Promise<void>;
  findReportSince(target: string, kind: string, since: Date): Promise<ReportEnvelope | null>;
  ensureMonitor(target: string, intervalS: number, expiresAt: Date): Promise<string>;
  markBadgeEligible(target: string, eligible: boolean): Promise<void>;
  claimAttestations(limit: number): Promise<AttestationJob[]>;
  retryAttestation(id: string, error: string, backoffSeconds: number): Promise<void>;
  completeAttestation(id: string, checkId: string, txHash: string): Promise<void>;
  claimDueMonitors(limit: number): Promise<MonitorJob[]>;
  recordMonitorProbe(monitorId: string, ok: boolean, latencyMs: number | null, findingCodes: string[], timestamp?: Date): Promise<void>;
  getWatchReportData(target: string): Promise<WatchReportData | null>;
  getBadgeData(targetId: string): Promise<BadgeData | null>;
  reservePlaygroundCheck(ipHash: string, perIpCap: number, globalCap: number): Promise<PlaygroundReservation>;
  saveHealthIndex(aggregate: MarketScanResult): Promise<void>;
  getLatestHealthIndex(): Promise<(MarketScanResult & { generated_at: string }) | null>;
  close(): Promise<void>;
}

export function createDatabase(config: Config): Database | null {
  if (!config.DATABASE_URL) return null;
  const sql = postgres(config.DATABASE_URL, { max: 5, idle_timeout: 20, transform: { undefined: null } });
  return {
    sql,
    async health() { await sql`select 1`; return true; },
    async persist(report, expected, results) {
      const targetId = ulid();
      const rows = await sql<{ id: string }[]>`
        INSERT INTO targets (id, endpoint_url) VALUES (${targetId}, ${report.target})
        ON CONFLICT (endpoint_url) DO UPDATE SET endpoint_url = EXCLUDED.endpoint_url
        RETURNING id`;
      const id = rows[0]?.id;
      if (!id) throw new Error("target persistence failed");
      await sql`
        INSERT INTO checks (id, target_id, kind, expected, results, verdict, score, findings, attestation_tx, created_at)
        VALUES (${report.report_id}, ${id}, ${report.tool}, ${sql.json(normalizeUndefined(expected))}, ${sql.json(normalizeUndefined(results))},
          ${report.verdict}, ${report.score}, ${sql.json(normalizeUndefined(report.findings))}, ${report.attestation_tx}, ${new Date(report.generated_at)})`;
    },
    async getReport(id) {
      const rows = await sql<{ id: string; kind: string; endpoint_url: string; verdict: ReportEnvelope["verdict"]; score: number; findings: ReportEnvelope["findings"]; attestation_tx: string | null; created_at: Date }[]>`
        SELECT c.id, c.kind, t.endpoint_url, c.verdict, c.score, c.findings, c.attestation_tx, c.created_at
        FROM checks c JOIN targets t ON t.id = c.target_id WHERE c.id = ${id}`;
      const row = rows[0];
      return row ? { report_id: row.id, tool: row.kind, target: row.endpoint_url, verdict: row.verdict,
        score: row.score, findings: row.findings, attestation_tx: row.attestation_tx,
        report_url: `https://usepreflight.xyz/r/${row.id}`, generated_at: row.created_at.toISOString() } : null;
    },
    async recordCall(call) {
      const id = ulid();
      await sql`
        INSERT INTO calls (id, check_id, direction, tool, price_usdt, settle_ref, settle_status, payer, owner_attestation)
        VALUES (${id}, ${call.checkId}, ${call.direction}, ${call.tool}, ${call.priceUsdt}, ${call.settleRef}, ${call.settleStatus}, ${call.payer}, ${call.ownerAttestation ?? false})`;
      return id;
    },
    async updateCallSettlement(settleRef, status, replacementRef) {
      await sql`UPDATE calls SET settle_status = ${status}, settle_ref = ${replacementRef ?? settleRef} WHERE settle_ref = ${settleRef}`;
    },
    async getCallByCheck(checkId) {
      const rows = await sql<{ id: string; settle_ref: string | null; settle_status: string; payer: string | null }[]>`
        SELECT id, settle_ref, settle_status, payer FROM calls WHERE check_id = ${checkId} ORDER BY created_at DESC LIMIT 1`;
      return rows[0] ?? null;
    },
    async getCallsByCheck(checkId) {
      return sql<Array<{ id: string; direction: "in" | "out"; tool: string; price_usdt: string; settle_ref: string | null; settle_status: string; payer: string | null; owner_attestation: boolean }>>`
        SELECT id, direction, tool, price_usdt::text, settle_ref, settle_status, payer, owner_attestation
        FROM calls WHERE check_id = ${checkId} ORDER BY created_at ASC`;
    },
    async reserveSpend(target, amountUsdt, targetCapUsdt, globalCapUsdt) {
      return sql.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext('preflight_deep_check_spend'))`;
        const rows = await transaction<Array<{ target_spend: string; global_spend: string }>>`
          SELECT
            COALESCE(SUM(amount_usdt) FILTER (WHERE target_url = ${target}), 0)::text AS target_spend,
            COALESCE(SUM(amount_usdt), 0)::text AS global_spend
          FROM spend_ledger
          WHERE created_at >= now() - interval '24 hours' AND status IN ('reserved', 'spent')`;
        const targetSpend = Number(rows[0]?.target_spend ?? 0);
        const globalSpend = Number(rows[0]?.global_spend ?? 0);
        const amount = Number(amountUsdt);
        if (targetSpend + amount > targetCapUsdt || globalSpend + amount > globalCapUsdt) return null;
        const id = ulid();
        await transaction`INSERT INTO spend_ledger (id, target_url, amount_usdt, status) VALUES (${id}, ${target}, ${amountUsdt}, 'reserved')`;
        return id;
      });
    },
    async completeSpend(id, status, settleRef) {
      await sql`UPDATE spend_ledger SET status = ${status}, settle_ref = ${settleRef}, updated_at = now() WHERE id = ${id}`;
    },
    async findReportSince(target, kind, since) {
      const rows = await sql<Array<{ id: string; kind: string; endpoint_url: string; verdict: ReportEnvelope["verdict"]; score: number; findings: ReportEnvelope["findings"]; attestation_tx: string | null; created_at: Date }>>`
        SELECT c.id, c.kind, t.endpoint_url, c.verdict, c.score, c.findings, c.attestation_tx, c.created_at
        FROM checks c JOIN targets t ON t.id = c.target_id
        WHERE t.endpoint_url = ${target} AND c.kind = ${kind} AND c.created_at >= ${since}
        ORDER BY c.created_at DESC LIMIT 1`;
      const row = rows[0];
      return row ? { report_id: row.id, tool: row.kind, target: row.endpoint_url, verdict: row.verdict, score: row.score, findings: row.findings,
        attestation_tx: row.attestation_tx, report_url: `https://usepreflight.xyz/r/${row.id}`, generated_at: row.created_at.toISOString() } : null;
    },
    async ensureMonitor(target, intervalS, expiresAt) {
      const targetId = ulid();
      const targets = await sql<Array<{ id: string }>>`
        INSERT INTO targets (id, endpoint_url) VALUES (${targetId}, ${target})
        ON CONFLICT (endpoint_url) DO UPDATE SET endpoint_url = EXCLUDED.endpoint_url RETURNING id`;
      const id = targets[0]?.id;
      if (!id) throw new Error("monitor target persistence failed");
      const existing = await sql<Array<{ id: string }>>`
        SELECT id FROM monitors WHERE target_id = ${id} AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`;
      if (existing[0]?.id) return existing[0].id;
      const monitorId = ulid();
      await sql`INSERT INTO monitors (id, target_id, interval_s, expires_at, status) VALUES (${monitorId}, ${id}, ${intervalS}, ${expiresAt}, 'active')`;
      return monitorId;
    },
    async markBadgeEligible(target, eligible) {
      await sql`UPDATE targets SET badge_eligible = ${eligible} WHERE endpoint_url = ${target}`;
    },
    async claimAttestations(limit) {
      return sql.begin(async (transaction) => {
        await transaction`UPDATE pending_attestations SET status = 'pending', next_attempt_at = now(), updated_at = now()
          WHERE status = 'processing' AND updated_at < now() - interval '5 minutes'`;
        return transaction<AttestationJob[]>`
          WITH picked AS (
            SELECT id FROM pending_attestations
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT ${limit}
          )
          UPDATE pending_attestations p SET status = 'processing', attempts = attempts + 1, updated_at = now()
          FROM picked WHERE p.id = picked.id
          RETURNING p.id, p.check_id, p.report_hash, p.attempts`;
      });
    },
    async retryAttestation(id, error, backoffSeconds) {
      await sql`UPDATE pending_attestations SET status = 'pending', last_error = ${error.slice(0, 2_000)},
        next_attempt_at = now() + (${backoffSeconds} * interval '1 second'), updated_at = now() WHERE id = ${id}`;
    },
    async completeAttestation(id, checkId, txHash) {
      await sql.begin(async (transaction) => {
        await transaction`UPDATE pending_attestations SET status = 'confirmed', tx_hash = ${txHash}, last_error = null, updated_at = now() WHERE id = ${id}`;
        await transaction`UPDATE checks SET attestation_tx = ${txHash} WHERE id = ${checkId}`;
      });
    },
    async claimDueMonitors(limit) {
      return sql.begin(async (transaction) => {
        await transaction`UPDATE monitors SET status = 'expired' WHERE status = 'active' AND expires_at <= now()`;
        return transaction<MonitorJob[]>`
          WITH picked AS (
            SELECT id FROM monitors WHERE status = 'active' AND expires_at > now() AND next_run_at <= now()
            ORDER BY next_run_at ASC FOR UPDATE SKIP LOCKED LIMIT ${limit}
          )
          UPDATE monitors m SET last_run_at = now(), next_run_at = now() + (m.interval_s * interval '1 second')
          FROM picked, targets t WHERE m.id = picked.id AND t.id = m.target_id
          RETURNING m.id, t.endpoint_url AS target, m.interval_s, m.expires_at`;
      });
    },
    async recordMonitorProbe(monitorId, ok, latencyMs, findingCodes, timestamp = new Date()) {
      const codes: Array<string | null> = findingCodes.length ? findingCodes : [null];
      await sql`INSERT INTO probes ${sql(codes.map((findingCode) => ({ monitor_id: monitorId, ts: timestamp, ok, latency_ms: latencyMs, finding_code: findingCode })))}`;
    },
    async getWatchReportData(target) {
      const monitors = await sql<Array<{ id: string; status: string; expires_at: Date }>>`
        SELECT m.id, m.status, m.expires_at FROM monitors m JOIN targets t ON t.id = m.target_id
        WHERE t.endpoint_url = ${target} ORDER BY m.expires_at DESC LIMIT 1`;
      const monitor = monitors[0];
      if (!monitor) return null;
      const samples = await sql<Array<{ ts: Date; ok: boolean; latency_ms: number | null; codes: string[] }>>`
        SELECT ts, bool_and(ok) AS ok, max(latency_ms) AS latency_ms,
          COALESCE(array_agg(finding_code) FILTER (WHERE finding_code IS NOT NULL), ARRAY[]::text[]) AS codes
        FROM probes WHERE monitor_id = ${monitor.id} GROUP BY ts ORDER BY ts ASC`;
      const successes = samples.filter((sample) => sample.ok).length;
      return { monitor_id: monitor.id, status: monitor.status, expires_at: monitor.expires_at,
        uptime_pct: samples.length ? Math.round(successes * 10_000 / samples.length) / 100 : 0,
        latency_series: samples.map((sample) => ({ ts: sample.ts.toISOString(), latency_ms: sample.latency_ms })),
        finding_history: samples.flatMap((sample) => sample.codes.map((code) => ({ ts: sample.ts.toISOString(), code }))) };
    },
    async getBadgeData(targetId) {
      const rows = await sql<Array<BadgeData>>`
        SELECT t.id AS target_id, t.badge_eligible, c.id AS report_id, c.verdict, c.created_at AS verified_at
        FROM targets t JOIN LATERAL (
          SELECT id, verdict, created_at FROM checks WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
        ) c ON true WHERE t.id = ${targetId}`;
      return rows[0] ?? null;
    },
    async reservePlaygroundCheck(ipHash, perIpCap, globalCap) {
      return sql.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext('preflight_playground_daily'))`;
        const rows = await transaction<Array<{ usage_key: string; count: number }>>`
          SELECT usage_key, count FROM playground_usage
          WHERE day = current_date AND usage_key IN ('global', ${`ip:${ipHash}`})`;
        const globalCount = rows.find((row) => row.usage_key === "global")?.count ?? 0;
        const ipCount = rows.find((row) => row.usage_key === `ip:${ipHash}`)?.count ?? 0;
        if (globalCount >= globalCap) return "global_cap" as const;
        if (ipCount >= perIpCap) return "ip_cap" as const;
        await transaction`
          INSERT INTO playground_usage (day, usage_key, count)
          VALUES (current_date, 'global', 1), (current_date, ${`ip:${ipHash}`}, 1)
          ON CONFLICT (day, usage_key) DO UPDATE SET count = playground_usage.count + 1`;
        return "ok" as const;
      });
    },
    async saveHealthIndex(aggregate) {
      await sql`INSERT INTO health_index_snapshots (id, aggregate) VALUES (${ulid()}, ${sql.json(normalizeUndefined(aggregate))})`;
    },
    async getLatestHealthIndex() {
      const rows = await sql<Array<{ aggregate: MarketScanResult; created_at: Date }>>`
        SELECT aggregate, created_at FROM health_index_snapshots ORDER BY created_at DESC LIMIT 1`;
      const row = rows[0];
      return row ? { ...row.aggregate, generated_at: row.created_at.toISOString() } : null;
    },
    async close() { await sql.end({ timeout: 5 }); }
  };
}
