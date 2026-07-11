import type { Finding, ProbeResult, Verdict } from "../types.js";

export const SEVERITY_DEDUCTIONS = { high: 20, med: 8, low: 2, info: 0 } as const;
export const NO_GO_FINDING_CODES = new Set(["TLS_INVALID", "DNS_FAIL", "TIMEOUT", "REDIRECT_LOOP"]);
export function scoreFindings(findings: Finding[]): { score: number; verdict: Verdict } {
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + SEVERITY_DEDUCTIONS[finding.severity], 0));
  const verdict: Verdict = findings.some((finding) => NO_GO_FINDING_CODES.has(finding.code)) || score < 50
    ? "NO-GO"
    : findings.some((finding) => finding.severity === "high") || score < 85 ? "HOLD" : "GO";
  return { score, verdict };
}
export function scoreModules(...modules: ProbeResult[]): { findings: Finding[]; score: number; verdict: Verdict } {
  const findings = modules.flatMap((module) => module.findings);
  const applicable = modules.filter((module) => module.applicable !== false);
  const moduleScores = applicable.map((module) => scoreFindings(module.findings).score);
  const score = moduleScores.length ? Math.round(moduleScores.reduce((sum, value) => sum + value, 0) / moduleScores.length) : 100;
  const verdict: Verdict = findings.some((finding) => NO_GO_FINDING_CODES.has(finding.code)) || score < 50
    ? "NO-GO"
    : findings.some((finding) => finding.severity === "high") || score < 85 ? "HOLD" : "GO";
  return { findings, score, verdict };
}
