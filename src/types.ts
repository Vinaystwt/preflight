export type Severity = "high" | "med" | "low" | "info";
export type Verdict = "GO" | "HOLD" | "NO-GO";

export interface Finding {
  code: string;
  severity: Severity;
  evidence: string;
  fix: string;
}

export interface ProbeResult {
  findings: Finding[];
  evidence: Record<string, unknown>;
  /** False means the module was not applicable and must not affect the score denominator. */
  applicable?: boolean;
}

export interface ReportEnvelope {
  report_id: string;
  tool: string;
  target: string;
  verdict: Verdict;
  score: number;
  findings: Finding[];
  attestation_tx: string | null;
  report_url: string;
  generated_at: string;
}
