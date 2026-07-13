/*
  TypeScript mirror of the frozen backend contracts (do not invent fields):
  - preflight.discovery.v1        (/api/v1/discover)
  - preflight.run-status.v1       (run-stage events → execution rail)
  - preflight.machine-report.v1   (blockers + evidence)
  Confirmed live from GET /api/v1/contracts/{discovery,run-events,machine-report}/v1.
*/

export type Decision = "RELEASE" | "BLOCK" | "UNKNOWN";
export type CriterionState = "MATCH" | "CONTRADICTION" | "UNKNOWN" | "NOT_APPLICABLE";
export type Provenance = "OPERATOR_SUPPLIED" | "OBSERVED" | "DERIVED" | "UNAVAILABLE";

export type InterfaceMode =
  | "FREE_HTTP"
  | "X402_HTTP"
  | "MCP_PLUS_FREE_HTTP"
  | "MCP_PLUS_X402_HTTP";

/** Real run-stage enum from run-status.v1 (drives the execution rail). */
export type RunStage =
  | "reachable"
  | "mcp_discovered"
  | "challenge_parsed"
  | "surface_reconstructed"
  | "intent_reconciled"
  | "decision_sealed"
  | "authorized"
  | "paid"
  | "settled"
  | "replayed"
  | "delivered";

export type RunEventStatus =
  | "pending"
  | "active"
  | "match"
  | "contradiction"
  | "unknown"
  | "na";

export interface RunEvent {
  stage: RunStage;
  status: RunEventStatus;
  observed_value?: unknown;
  evidence_ref?: string;
  timestamp: string;
}

export interface RunStatusV1 {
  schema_version: "preflight.run-status.v1";
  run_id: string;
  events: RunEvent[];
}

export interface X402Accept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: unknown;
}

export interface ObservedSurface {
  transport?: unknown;
  mcp?: unknown;
  x402: {
    status?: number;
    parse_error: string | null;
    accepts: X402Accept[] | null;
  };
}

export interface ProposedField {
  value: unknown;
  source: "LISTING" | "RUNTIME" | "MCP" | "OPERATOR" | "INFERRED" | string;
  confidence: number;
  requires_confirmation: boolean;
}

export interface DiscoveryV1 {
  schema_version: "preflight.discovery.v1";
  endpoint: string;
  observed_surface: ObservedSurface;
  proposed_manifest: {
    manifest: Record<string, unknown>;
    fields: Record<string, ProposedField>;
  };
}

export interface EvidenceRef {
  id: string;
  source: string;
  captured_at: string;
  digest?: string;
  summary?: string;
  freshness_seconds?: number;
}

export interface Criterion {
  code: string;
  group: string;
  state: CriterionState;
  mandatory: boolean;
  expected?: unknown;
  observed?: unknown;
  provenance: Provenance[];
  comparison_rule: string;
  consequence?: string;
  remediation?: string;
  evidence_refs: EvidenceRef[];
  limitation?: string;
}

export interface CriterionGroup {
  code: string;
  label: string;
  criteria: Criterion[];
}

/* ── v4 trust artifacts ────────────────────────────────────────────────── */

export interface ReceiptPayload {
  type: "preflight.receipt.v1";
  receipt_id: string;
  report_id: string;
  decision: Decision;
  manifest_hash: string;
  snapshot_hash: string;
  policy_version: string;
  settlement_ref?: string | null;
  payer: string | null;
  price_usdt: string;
  target_fingerprint: string;
  issued_at: string;
  key_id: string;
  chain_anchor: { tx: string; contract: string } | null;
}

export interface Receipt {
  receipt_id: string;
  payload: ReceiptPayload;
  signature: string;
  signature_alg: "Ed25519";
  key_id: string;
  verify: {
    canonicalization: "preflight.canonical-json.v1";
    payload_hash: string;
    pubkeys_url: string;
  };
}

export interface PublicKey {
  key_id: string;
  algorithm: "Ed25519";
  public_key_base64: string;
  status: "active" | "retired";
  created_at: string;
}
export interface PubkeysV1 {
  schema_version: "preflight.pubkeys.v1";
  keys: PublicKey[];
}

export interface GalleryEntry {
  schema_version: "preflight.gallery-entry.v1";
  gallery_id: string;
  report_id: string;
  decision: "BLOCK" | "UNKNOWN";
  policy_version: string;
  criterion_codes: string[];
  why: string[];
  fix: string[];
  generated_at: string;
}
export interface GalleryV1 {
  schema_version: "preflight.gallery.v1";
  entries: GalleryEntry[];
}

/** Human report envelope returned by GET /api/v1/reports/{id}. */
export interface ReleaseReport {
  receipt?: Receipt | null;
  badge_url?: string | null;
  chain_anchor_tx?: string | null;
  schema_version: string;
  report_id: string;
  decision: Decision;
  manifest: { schema_version: string; manifest_hash: string; canonical_manifest: Record<string, unknown> };
  runtime_snapshot: {
    snapshot_hash: string;
    captured_at: string;
    requested_url: string;
    final_url?: string;
    build_identifier?: string;
  };
  policy_version: string;
  summary: { matched: number; contradictions: number; unknown: number; not_applicable: number };
  criterion_groups: CriterionGroup[];
  run_status?: RunStatusV1;
  limitations: string[];
  generated_at: string;
  report_expires_at: string;
  report_access?: { report_url: string; access_token: string };
}
