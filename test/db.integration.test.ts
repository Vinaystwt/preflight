import { describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { loadConfig } from "../src/config.js";
import { createDatabase, normalizeUndefined } from "../src/db/client.js";
import type { ReportEnvelope } from "../src/types.js";

describe("database undefined normalization", () => {
  it("coalesces nested undefined values to null", () => {
    expect(normalizeUndefined({ top: undefined, nested: [1, undefined, { value: undefined }] })).toEqual({ top: null, nested: [1, null, { value: null }] });
  });

  it.runIf(Boolean(process.env.DATABASE_URL))("persists and retrieves a report with absent attestation and undefined JSON", async () => {
    const database = createDatabase(loadConfig());
    expect(database).not.toBeNull();
    if (!database) return;
    const suffix = ulid();
    const reportId = `pf_db_${suffix}`;
    const endpoint = `https://db-${suffix.toLowerCase()}.example/run`;
    const report = {
      report_id: reportId,
      tool: "run_preflight",
      target: endpoint,
      verdict: "GO",
      score: 100,
      findings: [],
      report_url: `https://usepreflight.xyz/r/${reportId}`,
      generated_at: new Date().toISOString()
    } as unknown as ReportEnvelope;
    try {
      await database.persist(report, undefined, { optional: undefined });
      const retrieved = await database.getReport(reportId);
      expect(retrieved).toMatchObject({ report_id: reportId, attestation_tx: null, verdict: "GO", score: 100, generated_at: report.generated_at });
    } finally {
      await database.sql`DELETE FROM pending_attestations WHERE check_id = ${reportId}`;
      await database.sql`DELETE FROM checks WHERE id = ${reportId}`;
      await database.sql`DELETE FROM targets WHERE endpoint_url = ${endpoint}`;
      await database.close();
    }
  });
});
