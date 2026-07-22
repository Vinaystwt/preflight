import type { CriterionResult, CriterionState, ReleaseDecision, ReleaseManifestV1 } from "../contracts/release-gate.js";
import type { JsonValue } from "../contracts/canonical.js";
import type { EvidenceArtifact } from "./evidence.js";

export const POLICY_VERSION = "preflight.release-policy.v1";
type ManifestPath = "target.endpoint" | "target.method" | "target.interface_mode" | "target.mcp_url" | "target.redirect_policy" | "payment.mode" | "payment.network" | "payment.asset" | "payment.amount_atomic" | "payment.pay_to" | "request_contract.schema" | "response_contract.schema" | "buyer_proof.settlement" | "buyer_proof.delivery";
interface CriterionDefinition { code: string; group: string; path: ManifestPath; mandatory: boolean; evidence: EvidenceArtifact["kind"]; comparison_rule: string; consequence: string; remediation: string }

export const criterionRegistry: readonly CriterionDefinition[] = Object.freeze([
  { code: "TARGET_ENDPOINT", group: "target", path: "target.endpoint", mandatory: true, evidence: "TRANSPORT", comparison_rule: "normalized final URL equals manifest endpoint unless an approved same-origin redirect applies", consequence: "Users may call a different resource than the operator approved.", remediation: "Deploy the intended endpoint or update and reconfirm the manifest." },
  { code: "TARGET_METHOD", group: "target", path: "target.method", mandatory: true, evidence: "TRANSPORT", comparison_rule: "observable POST request completes with an HTTP response", consequence: "The declared invocation method is not usable.", remediation: "Expose the service through POST as declared." },
  { code: "INTERFACE_MODE", group: "interface", path: "target.interface_mode", mandatory: true, evidence: "MCP", comparison_rule: "MCP evidence is present exactly when the declared mode includes MCP", consequence: "Agents will invoke the wrong interface form.", remediation: "Expose the declared MCP interface or confirm an HTTP-only manifest." },
  { code: "MCP_URL", group: "interface", path: "target.mcp_url", mandatory: true, evidence: "MCP", comparison_rule: "MCP initialize and tools/list succeed at the confirmed MCP URL", consequence: "MCP discovery cannot establish the declared tool surface.", remediation: "Fix the MCP endpoint and Streamable HTTP responses." },
  { code: "REDIRECT_POLICY", group: "target", path: "target.redirect_policy", mandatory: true, evidence: "TRANSPORT", comparison_rule: "observed redirects comply with NONE or SAME_ORIGIN", consequence: "The runtime destination differs from the approved release boundary.", remediation: "Remove the redirect or keep every hop on the approved origin." },
  { code: "PAYMENT_MODE", group: "payment", path: "payment.mode", mandatory: true, evidence: "X402", comparison_rule: "FREE has no 402; X402 has status 402 and a parseable accepts array", consequence: "The live payment mode contradicts the intended release.", remediation: "Configure the route to expose the confirmed payment mode." },
  { code: "PAYMENT_NETWORK", group: "payment", path: "payment.network", mandatory: true, evidence: "X402", comparison_rule: "at least one accepts entry has the exact network", consequence: "Payment may occur on an unintended network.", remediation: "Set the x402 network to the confirmed manifest value." },
  { code: "PAYMENT_ASSET", group: "payment", path: "payment.asset", mandatory: true, evidence: "X402", comparison_rule: "at least one accepts entry has the exact asset", consequence: "The service may charge an unintended asset.", remediation: "Set the x402 asset to the confirmed contract address." },
  { code: "PAYMENT_AMOUNT", group: "payment", path: "payment.amount_atomic", mandatory: true, evidence: "X402", comparison_rule: "at least one accepts entry has the exact atomic amount", consequence: "The live price differs from operator intent.", remediation: "Set the x402 atomic amount to the confirmed value." },
  { code: "PAYMENT_PAY_TO", group: "payment", path: "payment.pay_to", mandatory: true, evidence: "X402", comparison_rule: "at least one accepts entry has the exact payTo address", consequence: "Funds may settle to an unintended wallet.", remediation: "Set payTo to the confirmed recipient wallet." },
  { code: "REQUEST_SCHEMA", group: "contract", path: "request_contract.schema", mandatory: true, evidence: "MCP", comparison_rule: "declared request schema equals the observable MCP input schema", consequence: "Agents may construct invalid requests.", remediation: "Align the declared and live input schemas." },
  { code: "RESPONSE_SCHEMA", group: "contract", path: "response_contract.schema", mandatory: true, evidence: "MCP", comparison_rule: "required response schema equals safely observable output schema", consequence: "The promised response contract cannot be established.", remediation: "Expose the declared output schema or make the criterion optional in a new confirmed manifest." },
  { code: "BUYER_SETTLEMENT", group: "buyer_proof", path: "buyer_proof.settlement", mandatory: false, evidence: "BUYER_PROOF", comparison_rule: "authorized outbound x402 proof settles to the declared target payTo", consequence: "PreFlight could not prove that a real buyer can complete payment.", remediation: "Fix the target payment replay/settlement flow and rerun with buyer proof authorized." },
  { code: "BUYER_DELIVERY", group: "buyer_proof", path: "buyer_proof.delivery", mandatory: false, evidence: "BUYER_PROOF", comparison_rule: "authorized outbound x402 proof delivers a successful paid response and rejects duplicate replay", consequence: "A paid buyer may not receive the promised resource or duplicate payment replay is unsafe.", remediation: "Return a successful paid response and reject duplicate payment payloads." }
]);

function expectedAt(manifest: ReleaseManifestV1, path: ManifestPath): JsonValue | undefined {
  if (path === "buyer_proof.settlement" || path === "buyer_proof.delivery") return true;
  const [root, field] = path.split(".") as [keyof ReleaseManifestV1, string];
  const object = manifest[root] as unknown as Record<string, unknown>;
  return object?.[field] as JsonValue | undefined;
}
function accepts(artifact: EvidenceArtifact | undefined): Array<Record<string, unknown>> {
  const value = artifact?.normalized as Record<string, unknown> | undefined; return Array.isArray(value?.accepts) ? value.accepts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}
function evidenceRefs(artifact: EvidenceArtifact | undefined) {
  return artifact ? [{ id: artifact.id, source: artifact.source, captured_at: artifact.captured_at, digest: artifact.digest, summary: `${artifact.kind} runtime evidence`, freshness_seconds: 0 }] : [];
}
function safeDuplicateReplay(normalized: Record<string, unknown>): boolean {
  if (normalized.duplicate_replay_safe === true) return true;
  const duplicateStatus = Number(normalized.duplicate_replay_status);
  if (duplicateStatus === 409) return normalized.duplicate_replay_payment_response !== true;
  if (duplicateStatus === 402) return normalized.duplicate_replay_payment_required === true && normalized.duplicate_replay_payment_response !== true;
  return false;
}
function stateFor(definition: CriterionDefinition, expected: JsonValue | undefined, artifact: EvidenceArtifact | undefined, manifest: ReleaseManifestV1): { state: CriterionState; observed?: JsonValue; limitation?: string } {
  if (expected === undefined) return { state: "NOT_APPLICABLE" };
  if (!artifact) return { state: "UNKNOWN", limitation: `Required ${definition.evidence} evidence is unavailable.` };
  const normalized = artifact.normalized as Record<string, unknown>;
  if (definition.code === "TARGET_ENDPOINT") return { state: normalized.final_url === expected ? "MATCH" : "CONTRADICTION", observed: normalized.final_url as JsonValue };
  if (definition.code === "TARGET_METHOD") {
    const status = Number(normalized.status); const valid = status >= 200 && status < 400 || (manifest.payment.mode === "X402" && status === 402);
    return { state: valid ? "MATCH" : status ? "CONTRADICTION" : "UNKNOWN", observed: status, limitation: status ? undefined : "No HTTP response was established." };
  }
  if (definition.code === "REDIRECT_POLICY") { const redirects = Array.isArray(normalized.redirects) ? normalized.redirects : []; const ok = expected === "SAME_ORIGIN" || redirects.length === 0; return { state: ok ? "MATCH" : "CONTRADICTION", observed: redirects as JsonValue }; }
  if (definition.code === "INTERFACE_MODE") { const wants = String(expected).startsWith("MCP_PLUS_"); const works = Array.isArray(normalized.tools); return { state: wants === works ? "MATCH" : "CONTRADICTION", observed: works ? "MCP" : "HTTP" }; }
  if (definition.code === "MCP_URL") { const works = Array.isArray(normalized.tools) && Number(normalized.initialize_status) === 200; return { state: works ? "MATCH" : "UNKNOWN", observed: artifact.source, limitation: works ? undefined : "MCP handshake or tools/list was not established." }; }
  if (definition.code === "REQUEST_SCHEMA" || definition.code === "RESPONSE_SCHEMA") return { state: "UNKNOWN", limitation: "Schema normalization adapter is not yet able to establish an exact supported-subset comparison." };
  if (definition.code === "BUYER_SETTLEMENT") {
    const authorized = normalized.authorized === true;
    if (!authorized) return { state: "UNKNOWN", limitation: "Buyer proof was not authorized for this run." };
    if (normalized.status === "BUYER_CAP_EXCEEDED" || normalized.status === "BUYER_TERMS_CHANGED") return { state: "CONTRADICTION", observed: normalized.status as JsonValue };
    const settled = typeof normalized.settlement_reference === "string" && (normalized.receipt_status === "success" || normalized.status === "DELIVERED");
    return { state: settled ? "MATCH" : "CONTRADICTION", observed: { status: normalized.status, settlement_reference: normalized.settlement_reference ?? null } as JsonValue };
  }
  if (definition.code === "BUYER_DELIVERY") {
    const authorized = normalized.authorized === true;
    if (!authorized) return { state: "UNKNOWN", limitation: "Buyer proof was not authorized for this run." };
    if (normalized.status === "BUYER_CAP_EXCEEDED" || normalized.status === "BUYER_TERMS_CHANGED") return { state: "CONTRADICTION", observed: normalized.status as JsonValue };
    const deliveryStatus = Number(normalized.delivery_status);
    const delivered = normalized.status === "DELIVERED" && deliveryStatus >= 200 && deliveryStatus < 300 && safeDuplicateReplay(normalized);
    return { state: delivered ? "MATCH" : "CONTRADICTION", observed: { status: normalized.status, delivery_status: normalized.delivery_status ?? null, duplicate_replay_status: normalized.duplicate_replay_status ?? null, duplicate_replay_payment_required: normalized.duplicate_replay_payment_required ?? null, duplicate_replay_payment_response: normalized.duplicate_replay_payment_response ?? null, duplicate_replay_safe: normalized.duplicate_replay_safe ?? null } as JsonValue };
  }
  if (definition.code === "PAYMENT_MODE") { const x402 = Number(normalized.status) === 402 && accepts(artifact).length > 0; const match = manifest.payment.mode === "X402" ? x402 : !x402; return { state: match ? "MATCH" : "CONTRADICTION", observed: x402 ? "X402" : "FREE" }; }
  const field = definition.code === "PAYMENT_NETWORK" ? "network" : definition.code === "PAYMENT_ASSET" ? "asset" : definition.code === "PAYMENT_AMOUNT" ? "amount" : "payTo";
  const values = accepts(artifact).map((entry) => entry[field]).filter((value): value is string => typeof value === "string");
  return { state: values.includes(String(expected)) ? "MATCH" : values.length ? "CONTRADICTION" : "UNKNOWN", observed: values as JsonValue, limitation: values.length ? undefined : `No ${field} value was observable.` };
}

export function evaluateCriteria(manifest: ReleaseManifestV1, artifacts: EvidenceArtifact[], options: { buyerAuthorized?: boolean } = {}): CriterionResult[] {
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  return criterionRegistry.map((definition) => {
    const expected = expectedAt(manifest, definition.path);
    const artifact = definition.code === "INTERFACE_MODE" && !manifest.target.interface_mode.startsWith("MCP_PLUS_") ? byKind.get("TRANSPORT") : byKind.get(definition.evidence);
    const evaluated = stateFor(definition, expected, artifact, manifest);
    const mandatory = definition.group === "buyer_proof" ? Boolean(options.buyerAuthorized) : definition.mandatory;
    return { code: definition.code, group: definition.group, state: evaluated.state, mandatory, expected, observed: evaluated.observed,
      provenance: artifact ? ["OPERATOR_SUPPLIED", "OBSERVED", "DERIVED"] : ["OPERATOR_SUPPLIED", "UNAVAILABLE"], comparison_rule: definition.comparison_rule,
      consequence: evaluated.state === "CONTRADICTION" ? definition.consequence : undefined, remediation: evaluated.state === "CONTRADICTION" || evaluated.state === "UNKNOWN" ? definition.remediation : undefined,
      evidence_refs: evidenceRefs(artifact), limitation: evaluated.limitation };
  });
}

export function aggregateDecision(criteria: CriterionResult[]): ReleaseDecision {
  const mandatory = criteria.filter((criterion) => criterion.mandatory && criterion.state !== "NOT_APPLICABLE");
  if (!mandatory.length) return "UNKNOWN";
  if (mandatory.some((criterion) => criterion.state === "CONTRADICTION")) return "BLOCK";
  if (mandatory.some((criterion) => criterion.state === "UNKNOWN")) return "UNKNOWN";
  return mandatory.every((criterion) => criterion.state === "MATCH") ? "RELEASE" : "UNKNOWN";
}

function listingCriterion(code: string, state: CriterionState, expected: JsonValue | undefined, observed: JsonValue | undefined, consequence: string, remediation: string): CriterionResult {
  return { code, group: "listing", state, mandatory: true, expected, observed, provenance: ["OPERATOR_SUPPLIED", "OBSERVED", "DERIVED"], comparison_rule: "Listing-declared A2MCP service values equal unauthenticated runtime evidence.", consequence: state === "CONTRADICTION" ? consequence : undefined, remediation: state === "CONTRADICTION" || state === "UNKNOWN" ? remediation : undefined, evidence_refs: [], limitation: state === "UNKNOWN" ? "Listing declaration or runtime evidence was unavailable." : undefined };
}
function atomicFee(fee: string | null): string | null { if (!fee || !/^\d+(?:\.\d+)?$/.test(fee)) return null; const [whole, fraction = ""] = fee.split("."); return `${whole}${(fraction + "000000").slice(0, 6)}`.replace(/^0+(?=\d)/, ""); }
export function evaluateListingCriteria(values: { endpoint: string; fee: string | null; asset: string | null; type: string | null }, artifacts: EvidenceArtifact[]): CriterionResult[] {
  const transport = artifacts.find((artifact) => artifact.kind === "TRANSPORT")?.normalized as Record<string, unknown> | undefined;
  const x402 = artifacts.find((artifact) => artifact.kind === "X402")?.normalized as Record<string, unknown> | undefined;
  const mcp = artifacts.find((artifact) => artifact.kind === "MCP")?.normalized as Record<string, unknown> | undefined;
  const entries = Array.isArray(x402?.accepts) ? x402.accepts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const amounts = entries.map((item) => item.amount).filter((value): value is string => typeof value === "string"); const assets = entries.map((item) => item.asset).filter((value): value is string => typeof value === "string"); const fee = atomicFee(values.fee);
  const finalUrl = typeof transport?.final_url === "string" ? transport.final_url : undefined; const mcpObserved = Array.isArray(mcp?.tools);
  const reachable = Boolean(finalUrl || x402?.status);
  return [
    listingCriterion("LST-01", fee ? (amounts.includes(fee) ? "MATCH" : amounts.length ? "CONTRADICTION" : "UNKNOWN") : "UNKNOWN", fee ?? undefined, amounts, "A buyer could be charged a different amount than the listing declares.", "Align the listing fee and the x402 challenge amount."),
    listingCriterion("LST-02", values.asset ? (assets.some((asset) => asset.toLowerCase() === values.asset!.toLowerCase()) ? "MATCH" : assets.length ? "CONTRADICTION" : "UNKNOWN") : "UNKNOWN", values.asset ?? undefined, assets, "A buyer could be charged an asset different from the listing declaration.", "Align the listing asset contract and the x402 challenge asset."),
    listingCriterion("LST-03", finalUrl ? (finalUrl === values.endpoint ? "MATCH" : "CONTRADICTION") : "UNKNOWN", values.endpoint, finalUrl, "A buyer could reach a destination different from the listed endpoint.", "Set the listing endpoint to the responding HTTPS service."),
    listingCriterion("LST-04", values.type === "A2MCP" ? (mcpObserved ? "MATCH" : "CONTRADICTION") : "NOT_APPLICABLE", values.type ?? undefined, mcpObserved ? "MCP" : "ROUTE_HTTP", "Agents could be offered an A2MCP listing whose observed surface is not MCP.", "Expose the declared MCP surface or correct the listing service type."),
    listingCriterion("LST-05", reachable ? "MATCH" : "CONTRADICTION", values.endpoint, finalUrl, "A buyer cannot call the service declared in the listing.", "Restore the declared endpoint before offering the service.")
  ];
}
