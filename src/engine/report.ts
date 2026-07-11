import { ulid } from "ulid";
import type { Database } from "../db/client.js";
import type { ReportEnvelope, ProbeResult } from "../types.js";
import { scoreModules } from "./rubric.js";

export async function buildReport(input: { tool: string; target: string; expected: unknown; modules: ProbeResult[]; database: Database | null }): Promise<ReportEnvelope> {
  const result = scoreModules(...input.modules);
  const report: ReportEnvelope = { report_id: `pf_${ulid()}`, tool: input.tool, target: input.target, verdict: result.verdict, score: result.score,
    findings: result.findings, attestation_tx: null, report_url: "", generated_at: new Date().toISOString() };
  report.report_url = `https://usepreflight.xyz/r/${report.report_id}`;
  if (input.database) await input.database.persist(report, input.expected, input.modules.map((module) => module.evidence));
  return report;
}
