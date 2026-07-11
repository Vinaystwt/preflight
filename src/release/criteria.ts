import type { CriterionResult, CriterionState, ReleaseDecision, ReleaseManifestV1 } from "../contracts/release-gate.js";
import type { JsonValue } from "../contracts/canonical.js";
import type { EvidenceArtifact } from "./evidence.js";

export const POLICY_VERSION = "preflight.release-policy.v1";
type ManifestPath = "target.endpoint" | "target.method" | "target.interface_mode" | "target.mcp_url" | "target.redirect_policy" | "payment.mode" | "payment.network" | "payment.asset" | "payment.amount_atomic" | "payment.pay_to" | "request_contract.schema" | "response_contract.schema";
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
  { code: "RESPONSE_SCHEMA", group: "contract", path: "response_contract.schema", mandatory: true, evidence: "MCP", comparison_rule: "required response schema equals safely observable output schema", consequence: "The promised response contract cannot be established.", remediation: "Expose the declared output schema or make the criterion optional in a new confirmed manifest." }
]);

function expectedAt(manifest: ReleaseManifestV1, path: ManifestPath): JsonValue | undefined {
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
  if (definition.code === "PAYMENT_MODE") { const x402 = Number(normalized.status) === 402 && accepts(artifact).length > 0; const match = manifest.payment.mode === "X402" ? x402 : !x402; return { state: match ? "MATCH" : "CONTRADICTION", observed: x402 ? "X402" : "FREE" }; }
  const field = definition.code === "PAYMENT_NETWORK" ? "network" : definition.code === "PAYMENT_ASSET" ? "asset" : definition.code === "PAYMENT_AMOUNT" ? "amount" : "payTo";
  const values = accepts(artifact).map((entry) => entry[field]).filter((value): value is string => typeof value === "string");
  return { state: values.includes(String(expected)) ? "MATCH" : values.length ? "CONTRADICTION" : "UNKNOWN", observed: values as JsonValue, limitation: values.length ? undefined : `No ${field} value was observable.` };
}

export function evaluateCriteria(manifest: ReleaseManifestV1, artifacts: EvidenceArtifact[]): CriterionResult[] {
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  return criterionRegistry.map((definition) => {
    const expected = expectedAt(manifest, definition.path);
    const artifact = definition.code === "INTERFACE_MODE" && !manifest.target.interface_mode.startsWith("MCP_PLUS_") ? byKind.get("TRANSPORT") : byKind.get(definition.evidence);
    const evaluated = stateFor(definition, expected, artifact, manifest);
    return { code: definition.code, group: definition.group, state: evaluated.state, mandatory: definition.mandatory, expected, observed: evaluated.observed,
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
