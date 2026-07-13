import { canonicalHash, type JsonValue } from "../contracts/canonical.js";

export interface EvidenceArtifact { id: string; kind: "TRANSPORT" | "MCP" | "X402" | "BUYER_PROOF"; source: string; captured_at: string; normalized: JsonValue; digest: string }
export function evidenceArtifact(kind: EvidenceArtifact["kind"], source: string, normalized: JsonValue, capturedAt = new Date().toISOString()): EvidenceArtifact {
  return { id: `${kind.toLowerCase()}_${canonicalHash(normalized).slice(7, 23)}`, kind, source, captured_at: capturedAt, normalized, digest: canonicalHash(normalized) };
}
