/*
  TypeScript mirror of the v5 backend contracts. Do not invent fields.
  Confirmed live against api.usepreflight.xyz on 2026-07-17 and against
  docs/CONTRACT_HANDOFF_V5.md. Additive to the frozen v1 contracts.
*/
import type { Decision } from "@/lib/contracts";

/* ---- receipt scope (shared by /verify and /report v2) ---- */
export type ScopeProof =
  | "issuer_authenticity"
  | "payload_integrity"
  | "snapshot_binding"
  | "policy_binding";
export type ScopeNonProof =
  | "semantic_correctness_of_delivery"
  | "future_behaviour"
  | "security_of_target"
  | "marketplace_endorsement";

export interface ReceiptScope {
  proves: ScopeProof[];
  does_not_prove: ScopeNonProof[];
  policy_version: string;
  snapshot_hash: string;
  valid_until: string;
}

/* ---- journey (v2 report + self-check) ---- */
export type JourneyStepName =
  | "resolve_listing"
  | "reach_endpoint"
  | "tls_verify"
  | "mcp_handshake"
  | "payment_challenge"
  | "reconcile"
  | "authorize_payment"
  | "settle_payment"
  | "replay_request"
  | "inspect_delivery"
  | "seal_receipt";
export type JourneyStepStatus =
  | "ok"
  | "contradiction"
  | "unknown"
  | "not_applicable"
  | "skipped"
  | "failed";
export interface JourneyStep {
  step: JourneyStepName;
  status: JourneyStepStatus;
  observed: string;
  t_ms: number;
}

/* ---- verify_release v2 ---- */
export interface ReleaseReportV2 {
  schema_version: "preflight.release-report.v2";
  decision: Decision;
  headline: string;
  what_this_means: string;
  target: { agent_id: string | null; service_id: string | null; endpoint: string; listing_name: string | null };
  summary: { matched: number; blocked: number; unknown: number; not_applicable: number; duration_ms: number };
  primary_blocker: { code: string; declared: string | null; observed: string | null; consequence: string; exact_fix: string } | null;
  buyer_proof: { attempted: boolean; authorized: boolean; settlement_ref: string | null; oklink_url: string | null; delivery_observed: boolean | null };
  receipt: { receipt_id: string | null; signature: string | null; verify_url: string | null; pubkeys_url: string };
  report_url: string;
  scope: ReceiptScope;
  journey: JourneyStep[];
  checked_at: string;
  policy_version: string;
  docs_url: string;
  detail: unknown; // unchanged v1.1 report (rendered by existing report-view)
}

/* ---- public receipt verifier ---- */
export interface VerifyReceiptResult {
  signature_valid: boolean;
  issuer: string;
  key_id: string;
  key_status: string;
  payload_hash_matches: boolean;
  not_expired: boolean;
  snapshot_binding: { manifest_hash: string; snapshot_hash: string };
  policy_version: string;
  scope: ReceiptScope;
  verified_at: string;
  how_to_verify_offline: string;
}

/* ---- cohort ---- */
export interface CohortConforming { agent_id: string; name: string; last_checked: string; permalink: string }
export interface CohortContradiction { criterion_code: string; count: number; plain: string }
export interface CohortV1 {
  schema_version: "preflight.cohort.v1";
  generated_at: string;
  policy_version: string;
  totals: { listed_asps: number; with_runtime_evidence: number; conforming: number; with_contradictions: number; unknown: number; unreachable: number };
  conforming: CohortConforming[];
  contradiction_summary: CohortContradiction[];
  drift_events_24h: number;
}

/* ---- per-ASP ---- */
export interface AspConforming {
  schema_version: "preflight.asp.v1";
  agent_id: string;
  runtime_evidence: "conforming";
  name?: string | null;
  category_code?: string | null;
  last_checked: string;
  decision?: Decision;
  detail?: unknown;
  latest_receipt_id?: string | null;
}
export interface AspEvidence {
  schema_version: "preflight.asp.v1";
  agent_id: string;
  runtime_evidence: "available";
  name?: string | null;
  category_code?: string | null;
  last_checked: string;
  criterion_codes: string[];
  owner_claim_cta: string;
}
export interface AspNone {
  schema_version: "preflight.asp.v1";
  agent_id: string;
  runtime_evidence: "none";
  message?: string;
}
export type AspV1 = AspConforming | AspEvidence | AspNone;

/* ---- passport ---- */
export interface PassportV1 {
  schema_version: "preflight.passport.v1";
  state: "active" | "stale" | "none";
  message?: string;
  agent_id?: string;
  decision?: Decision;
  receipt_id?: string | null;
  policy_version?: string;
  valid_until?: string;
  issued_at?: string;
}

/* ---- benchmark ---- */
export interface BenchmarkCase {
  case_id: string;
  seeded_fault: string;
  expected_decision: Decision;
  expected_codes: string[];
  actual_decision: Decision;
  actual_codes: string[];
  passes: boolean;
  why_it_matters?: string;
}
export interface BenchmarkV1 {
  schema_version: "preflight.benchmark.v1";
  state?: "not_generated";
  policy_version: string;
  generated_at: string;
  total_fixtures: number;
  passing: number;
  cases: BenchmarkCase[];
}

/* ---- self-check ---- */
export interface SelfCheckV1 {
  schema_version: "preflight.self-check.v1";
  report_id: string;
  receipt_id: string;
  decision: Decision;
  settlement_ref: string | null;
  label: string;
  customer_demand: false;
  published_at: string;
  verify_url?: string;
  evidence?: { journey?: JourneyStep[] };
}

/* ---- resolve (each field {value,source,confidence}) ---- */
export interface ResolvedField<T = string> { value: T; source: string; confidence: string }
export interface ResolveV1 {
  agent_id: string;
  name?: ResolvedField;
  description?: ResolvedField;
  category_code?: ResolvedField;
  status?: ResolvedField;
  fee?: ResolvedField;
  asset?: ResolvedField;
  endpoint?: ResolvedField;
  [k: string]: unknown;
}
