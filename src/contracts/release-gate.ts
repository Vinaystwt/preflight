import { z } from "zod";
import { canonicalHash, type JsonValue } from "./canonical.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "public HTTPS URL required");
const jsonPrimitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([jsonPrimitive, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]));

export type SupportedJsonSchemaSubset = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  description?: string;
  properties?: Record<string, SupportedJsonSchemaSubset>;
  required?: string[];
  items?: SupportedJsonSchemaSubset;
  enum?: JsonValue[];
  const?: JsonValue;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

export const supportedJsonSchemaSubsetSchema: z.ZodType<SupportedJsonSchemaSubset> = z.lazy(() => z.object({
  type: z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]).optional(),
  description: z.string().max(2_000).optional(),
  properties: z.record(z.string(), supportedJsonSchemaSubsetSchema).optional(),
  required: z.array(z.string()).max(100).optional(),
  items: supportedJsonSchemaSubsetSchema.optional(),
  enum: z.array(jsonValueSchema).max(100).optional(),
  const: jsonValueSchema.optional(),
  additionalProperties: z.boolean().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional()
}).strict());

export const releaseManifestV1Schema = z.object({
  schema_version: z.literal("preflight.release-manifest.v1"),
  release: z.object({ service_name: z.string().min(1).max(120), release_version: z.string().min(1).max(120).optional() }).strict(),
  target: z.object({
    endpoint: httpsUrl,
    method: z.literal("POST"),
    interface_mode: z.enum(["FREE_HTTP", "X402_HTTP", "MCP_PLUS_FREE_HTTP", "MCP_PLUS_X402_HTTP"]),
    mcp_url: httpsUrl.optional(),
    redirect_policy: z.enum(["NONE", "SAME_ORIGIN"]).optional()
  }).strict().superRefine((target, context) => {
    const requiresMcp = target.interface_mode.startsWith("MCP_PLUS_");
    if (requiresMcp && !target.mcp_url) context.addIssue({ code: "custom", path: ["mcp_url"], message: "mcp_url is required for MCP interface modes" });
    if (!requiresMcp && target.mcp_url) context.addIssue({ code: "custom", path: ["mcp_url"], message: "mcp_url is only allowed for MCP interface modes" });
  }),
  payment: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("FREE") }).strict(),
    z.object({ mode: z.literal("X402"), network: z.string().min(1), asset: z.string().min(1), amount_atomic: z.string().regex(/^\d+$/), pay_to: hexAddress }).strict()
  ]),
  request_contract: z.object({ content_type: z.literal("application/json"), schema: supportedJsonSchemaSubsetSchema }).strict().optional(),
  response_contract: z.object({ required: z.boolean(), schema: supportedJsonSchemaSubsetSchema, observable_via: z.enum(["MCP_OUTPUT_SCHEMA", "FREE_RESPONSE"]) }).strict().optional()
}).strict();
export type ReleaseManifestV1 = z.infer<typeof releaseManifestV1Schema>;

export const manifestExpectationV1Schema = z.object({
  release: z.object({ service_name: z.string().min(1).max(120).optional(), release_version: z.string().min(1).max(120).optional() }).strict().optional(),
  target: z.object({
    endpoint: httpsUrl.optional(),
    method: z.literal("POST").optional(),
    interface_mode: z.enum(["FREE_HTTP", "X402_HTTP", "MCP_PLUS_FREE_HTTP", "MCP_PLUS_X402_HTTP"]).optional(),
    mcp_url: httpsUrl.optional(),
    redirect_policy: z.enum(["NONE", "SAME_ORIGIN"]).optional()
  }).strict().optional(),
  payment: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("FREE") }).strict(),
    z.object({ mode: z.literal("X402"), network: z.string().min(1).optional(), asset: z.string().min(1).optional(), amount_atomic: z.string().regex(/^\d+$/).optional(), pay_to: hexAddress.optional() }).strict()
  ]).optional(),
  request_contract: z.object({ content_type: z.literal("application/json"), schema: supportedJsonSchemaSubsetSchema }).strict().optional(),
  response_contract: z.object({ required: z.boolean(), schema: supportedJsonSchemaSubsetSchema, observable_via: z.enum(["MCP_OUTPUT_SCHEMA", "FREE_RESPONSE"]) }).strict().optional()
}).strict();
export type ManifestExpectationV1 = z.infer<typeof manifestExpectationV1Schema>;

const verifyReleaseSchemaVersion = z.literal("preflight.verify-release-request.v1").optional().default("preflight.verify-release-request.v1");
const targetAliases = ["endpoint", "url", "target_url", "targetUrl", "service_url", "service_endpoint", "agent_url"] as const;

const manifestVerifyReleaseRequestV1Schema = z.object({
  schema_version: verifyReleaseSchemaVersion,
  manifest: releaseManifestV1Schema,
  probe_input: jsonValueSchema.optional(),
  authorize_buyer_proof: z.literal(true).optional(),
  owner_attestation: z.literal(true).optional(),
  include_in_gallery: z.boolean().default(false).optional()
}).strict();

const discoveryVerifyReleaseRequestV1Schema = z.object({
  schema_version: verifyReleaseSchemaVersion,
  endpoint: httpsUrl.optional(),
  url: httpsUrl.optional(),
  target_url: httpsUrl.optional(),
  targetUrl: httpsUrl.optional(),
  service_url: httpsUrl.optional(),
  service_endpoint: httpsUrl.optional(),
  agent_url: httpsUrl.optional(),
  target: z.object({ endpoint: httpsUrl }).strict().optional(),
  agent_id: z.string().min(1).max(200).optional(),
  expected: manifestExpectationV1Schema.optional(),
  // Used only when the authenticated OKX resolver is unavailable. It is
  // explicitly caller-supplied and is never presented as listing observation.
  listing_override: z.object({
    name: z.string().min(1).max(200).optional(),
    services: z.array(z.object({ service_id: z.string().min(1), name: z.string().min(1).optional(), type: z.string().min(1), fee: z.string().regex(/^\d+(?:\.\d{1,6})?$/).optional(), endpoint: httpsUrl, asset_contract: hexAddress.optional() }).strict()).min(1)
  }).strict().optional(),
  probe_input: jsonValueSchema.optional(),
  authorize_buyer_proof: z.literal(true).optional(),
  owner_attestation: z.literal(true).optional(),
  include_in_gallery: z.boolean().default(false).optional()
}).strict().superRefine((value, context) => {
  const endpointValues = [...targetAliases.map((field) => ({ field, value: value[field] })), { field: "target.endpoint", value: value.target?.endpoint }].filter((item): item is { field: string; value: string } => typeof item.value === "string");
  const uniqueEndpoints = [...new Set(endpointValues.map((item) => item.value))];
  if (uniqueEndpoints.length > 1) {
    context.addIssue({ code: "custom", path: ["endpoint"], message: `Conflicting endpoint aliases supplied: ${endpointValues.map((item) => item.field).join(", ")}` });
    return;
  }
  const count = [uniqueEndpoints[0], value.agent_id].filter(Boolean).length;
  if (count !== 1) context.addIssue({ code: "custom", path: ["endpoint"], message: "Provide exactly one of endpoint or agent_id" });
}).transform((value) => {
  const endpoint = value.endpoint ?? value.url ?? value.target_url ?? value.targetUrl ?? value.service_url ?? value.service_endpoint ?? value.agent_url ?? value.target?.endpoint;
  return {
    schema_version: value.schema_version,
    ...(endpoint ? { endpoint } : {}),
    ...(value.agent_id ? { agent_id: value.agent_id } : {}),
    ...(value.expected ? { expected: value.expected } : {}),
    ...(value.listing_override ? { listing_override: value.listing_override } : {}),
    ...(value.probe_input !== undefined ? { probe_input: value.probe_input } : {}),
    ...(value.authorize_buyer_proof === true ? { authorize_buyer_proof: true as const } : {}),
    ...(value.owner_attestation === true ? { owner_attestation: true as const } : {}),
    include_in_gallery: value.include_in_gallery ?? false
  };
});

export const verifyReleaseRequestV1Schema = z.union([manifestVerifyReleaseRequestV1Schema, discoveryVerifyReleaseRequestV1Schema]);
export type VerifyReleaseRequestV1 = z.infer<typeof verifyReleaseRequestV1Schema>;

export const verifyReleaseRequestV1JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://api.usepreflight.xyz/api/v1/contracts/verify-release-request/v1",
  title: "PreFlight verify_release request",
  description: "Canonical public input for PreFlight Release Gate. Generic buyers only need endpoint. schema_version is optional and defaults internally to preflight.verify-release-request.v1.",
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", const: "preflight.verify-release-request.v1", description: "Optional; defaults internally when omitted." },
    endpoint: { type: "string", format: "uri", description: "Canonical target field. Must be a public HTTPS service endpoint, for example https://target-service.example/path." },
    agent_id: { type: "string", minLength: 1, maxLength: 200, description: "Optional alternative to endpoint: resolve an OKX.AI Agent ID and verify its A2MCP service." },
    manifest: { description: "Advanced operator-confirmed manifest request. Use endpoint for generic buyer integrations.", $ref: "#/$defs/releaseManifestV1" },
    expected: { description: "Optional caller expectations compared against observed release behavior." },
    probe_input: { description: "Optional JSON payload used only for discovery/probe requests." },
    authorize_buyer_proof: { type: "boolean", description: "Optional; defaults to false. When true, PreFlight may make a bounded outbound buyer-proof payment to the target." },
    owner_attestation: { type: "boolean", description: "Required and must be true only when authorize_buyer_proof is true." },
    include_in_gallery: { type: "boolean", description: "Optional; defaults to false. Opts BLOCK/UNKNOWN redacted results into the public gallery." }
  },
  oneOf: [
    { required: ["endpoint"], not: { anyOf: [{ required: ["agent_id"] }, { required: ["manifest"] }] } },
    { required: ["agent_id"], not: { anyOf: [{ required: ["endpoint"] }, { required: ["manifest"] }] } },
    { required: ["manifest"], not: { anyOf: [{ required: ["endpoint"] }, { required: ["agent_id"] }] } }
  ],
  allOf: [
    {
      if: { properties: { authorize_buyer_proof: { const: true } }, required: ["authorize_buyer_proof"] },
      then: { properties: { owner_attestation: { const: true } }, required: ["owner_attestation"] }
    }
  ],
  examples: [{ endpoint: "https://target-service.example/path" }, { agent_id: "5161" }],
  $defs: { releaseManifestV1: z.toJSONSchema(releaseManifestV1Schema) }
} as const;

export const proposedManifestFieldV1Schema = z.object({
  value: jsonValueSchema.optional(),
  source: z.enum(["listing", "runtime", "mcp_schema", "x402_challenge", "operator", "inferred"]),
  confidence: z.enum(["observed", "inferred", "unknown"]),
  requires_confirmation: z.boolean()
}).strict();
export type ProposedManifestFieldV1 = z.infer<typeof proposedManifestFieldV1Schema>;

export const observedPaymentSurfaceV1Schema = z.object({
  status: z.number().int().nonnegative().optional(),
  parse_error: z.string().nullable(),
  accepts: z.array(z.object({
    scheme: z.string().optional(),
    network: z.string().optional(),
    asset: z.string().optional(),
    amount: z.string().optional(),
    payTo: z.string().optional(),
    maxTimeoutSeconds: z.number().optional(),
    extra: jsonValueSchema.optional()
  }).strict()).nullable()
}).strict();
export type ObservedPaymentSurfaceV1 = z.infer<typeof observedPaymentSurfaceV1Schema>;

export const releaseDecisionSchema = z.enum(["RELEASE", "BLOCK", "UNKNOWN"]);
export const criterionStateSchema = z.enum(["MATCH", "CONTRADICTION", "UNKNOWN", "NOT_APPLICABLE"]);
export const evidenceProvenanceSchema = z.enum(["OPERATOR_SUPPLIED", "OBSERVED", "DERIVED", "UNAVAILABLE"]);
export type ReleaseDecision = z.infer<typeof releaseDecisionSchema>;
export type CriterionState = z.infer<typeof criterionStateSchema>;
export type EvidenceProvenance = z.infer<typeof evidenceProvenanceSchema>;

export const evidenceRefSchema = z.object({
  id: z.string().min(1), source: z.string().min(1), captured_at: z.string().datetime(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), summary: z.string().min(1), freshness_seconds: z.number().int().nonnegative()
}).strict();
export const discoveryResponseV1Schema = z.object({
  schema_version: z.literal("preflight.discovery.v1"),
  endpoint: httpsUrl,
  observed_surface: z.object({
    transport: jsonValueSchema.optional(),
    mcp: jsonValueSchema.optional(),
    x402: observedPaymentSurfaceV1Schema
  }).strict(),
  proposed_manifest: z.object({
    manifest: releaseManifestV1Schema.optional(),
    fields: z.record(z.string(), proposedManifestFieldV1Schema)
  }).strict(),
  evidence_refs: z.array(evidenceRefSchema),
  generated_at: z.string().datetime()
}).strict();
export type DiscoveryResponseV1 = z.infer<typeof discoveryResponseV1Schema>;
export const criterionResultSchema = z.object({
  code: z.string().min(1), group: z.string().min(1), state: criterionStateSchema, mandatory: z.boolean(),
  expected: jsonValueSchema.optional(), observed: jsonValueSchema.optional(), provenance: z.array(evidenceProvenanceSchema).min(1),
  comparison_rule: z.string().min(1), consequence: z.string().min(1).optional(), remediation: z.string().min(1).optional(),
  evidence_refs: z.array(evidenceRefSchema), limitation: z.string().min(1).optional()
}).strict();
export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const criterionGroupResultSchema = z.object({ code: z.string().min(1), label: z.string().min(1), criteria: z.array(criterionResultSchema) }).strict();
export const receiptPayloadV1Schema = z.object({
  type: z.literal("preflight.receipt.v1"),
  receipt_id: z.string().regex(/^rcpt_[a-f0-9]{32}$/),
  report_id: z.string().min(16),
  decision: releaseDecisionSchema,
  manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policy_version: z.string().min(1),
  settlement_ref: z.string().min(1),
  payer: z.string().nullable(),
  price_usdt: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
  target_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  issued_at: z.string().datetime(),
  key_id: z.string().min(1),
  chain_anchor: z.object({ tx: z.string().regex(/^0x[a-fA-F0-9]{64}$/), contract: hexAddress }).strict().nullable(),
  // Optional only so historically issued v1 receipts remain independently verifiable.
  // All newly issued receipts carry this explicit bounded-claim declaration.
  scope: z.object({
    proves: z.array(z.enum(["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"])),
    does_not_prove: z.array(z.enum(["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"])),
    policy_version: z.string().min(1),
    snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    valid_until: z.string().datetime()
  }).strict().optional()
}).strict();
export type ReceiptPayloadV1Contract = z.infer<typeof receiptPayloadV1Schema>;

export const receiptEnvelopeV1Schema = z.object({
  receipt_id: z.string().regex(/^rcpt_[a-f0-9]{32}$/),
  payload: receiptPayloadV1Schema,
  signature: z.string().min(32),
  signature_alg: z.literal("Ed25519"),
  key_id: z.string().min(1),
  verify: z.object({
    canonicalization: z.literal("preflight.canonical-json.v1"),
    payload_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    pubkeys_url: httpsUrl
  }).strict()
}).strict();
export type ReceiptEnvelopeV1Contract = z.infer<typeof receiptEnvelopeV1Schema>;

export const verifyReleaseResponseV1Schema = z.object({
  schema_version: z.literal("preflight.release-report.v1"), report_id: z.string().min(16), decision: releaseDecisionSchema,
  manifest: z.object({ schema_version: z.string(), manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), canonical_manifest: releaseManifestV1Schema }).strict(),
  runtime_snapshot: z.object({ snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), captured_at: z.string().datetime(), requested_url: httpsUrl, final_url: httpsUrl.optional(), build_identifier: z.string().optional() }).strict(),
  policy_version: z.string().min(1),
  summary: z.object({ matched: z.number().int().nonnegative(), contradictions: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), not_applicable: z.number().int().nonnegative() }).strict(),
  criterion_groups: z.array(criterionGroupResultSchema), limitations: z.array(z.string()), generated_at: z.string().datetime(), report_expires_at: z.string().datetime(),
  receipt: receiptEnvelopeV1Schema.optional(),
  badge_url: httpsUrl.nullable().optional(),
  chain_anchor_tx: z.string().regex(/^0x[a-fA-F0-9]{64}$/).nullable().optional(),
  report_access: z.object({ report_url: httpsUrl, access_token: z.string().min(43) }).strict()
}).strict();
export type VerifyReleaseResponseV1 = z.infer<typeof verifyReleaseResponseV1Schema>;

export const receiptScopeV1Schema = z.object({
  proves: z.array(z.enum(["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"])),
  does_not_prove: z.array(z.enum(["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"])),
  policy_version: z.string().min(1),
  snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  valid_until: z.string().datetime()
}).strict();
export type ReceiptScopeV1 = z.infer<typeof receiptScopeV1Schema>;

export const journeyStepV1Schema = z.object({
  step: z.enum(["resolve_listing", "reach_endpoint", "tls_verify", "mcp_handshake", "payment_challenge", "reconcile", "authorize_payment", "settle_payment", "replay_request", "inspect_delivery", "seal_receipt"]),
  status: z.enum(["ok", "contradiction", "unknown", "not_applicable", "skipped", "failed"]),
  observed: z.string().min(1),
  t_ms: z.number().int().nonnegative()
}).strict();
export type JourneyStepV1 = z.infer<typeof journeyStepV1Schema>;

export const verifyReleaseResponseV2Schema = z.object({
  schema_version: z.literal("preflight.release-report.v2"),
  decision: releaseDecisionSchema,
  headline: z.string().min(1),
  what_this_means: z.string().min(1),
  target: z.object({ agent_id: z.string().nullable(), service_id: z.string().nullable(), endpoint: httpsUrl, listing_name: z.string().nullable() }).strict(),
  summary: z.object({ matched: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), not_applicable: z.number().int().nonnegative(), duration_ms: z.number().int().nonnegative() }).strict(),
  primary_blocker: z.object({ code: z.string(), declared: z.string().nullable(), observed: z.string().nullable(), consequence: z.string(), exact_fix: z.string() }).strict().nullable(),
  buyer_proof: z.object({ attempted: z.boolean(), authorized: z.boolean(), settlement_ref: z.string().nullable(), oklink_url: httpsUrl.nullable(), delivery_observed: z.boolean().nullable() }).strict(),
  receipt: z.object({ receipt_id: z.string().nullable(), signature: z.string().nullable(), verify_url: httpsUrl.nullable(), pubkeys_url: httpsUrl }).strict(),
  report_url: httpsUrl,
  scope: receiptScopeV1Schema,
  journey: z.array(journeyStepV1Schema),
  checked_at: z.string().datetime(),
  policy_version: z.string().min(1),
  docs_url: httpsUrl,
  detail: verifyReleaseResponseV1Schema
}).strict();
export type VerifyReleaseResponseV2 = z.infer<typeof verifyReleaseResponseV2Schema>;

export const listingProvenanceValueSchema = z.object({ value: jsonValueSchema.nullable(), source: z.string().min(1), confidence: z.enum(["observed", "inferred", "unknown"]) }).strict();
export const agentResolutionV1Schema = z.object({
  agent_id: z.string().min(1), name: listingProvenanceValueSchema, description: listingProvenanceValueSchema,
  category_code: listingProvenanceValueSchema, status: listingProvenanceValueSchema,
  services: z.array(z.object({ service_id: listingProvenanceValueSchema, name: listingProvenanceValueSchema, type: listingProvenanceValueSchema, fee: listingProvenanceValueSchema, endpoint: listingProvenanceValueSchema, asset_contract: listingProvenanceValueSchema }).strict()),
  resolved_at: z.string().datetime(), resolution_source: z.string().min(1)
}).strict();
export type AgentResolutionV1 = z.infer<typeof agentResolutionV1Schema>;

export const runStageEventV1Schema = z.object({
  stage: z.enum(["reachable", "mcp_discovered", "challenge_parsed", "surface_reconstructed", "intent_reconciled", "decision_sealed", "authorized", "paid", "settled", "replayed", "delivered"]),
  status: z.enum(["pending", "active", "match", "contradiction", "unknown", "na"]),
  observed_value: jsonValueSchema.optional(),
  evidence_ref: z.string().optional(),
  timestamp: z.string().datetime()
}).strict();
export type RunStageEventV1 = z.infer<typeof runStageEventV1Schema>;

export const runStatusV1Schema = z.object({
  schema_version: z.literal("preflight.run-status.v1"),
  run_id: z.string().min(16),
  events: z.array(runStageEventV1Schema)
}).strict();
export type RunStatusV1 = z.infer<typeof runStatusV1Schema>;

export const machineReportV1Schema = z.object({
  schema_version: z.literal("preflight.machine-report.v1.1"),
  report_id: z.string().min(16),
  decision: releaseDecisionSchema,
  blockers: z.array(criterionResultSchema),
  criteria: z.array(criterionResultSchema),
  evidence_refs: z.array(evidenceRefSchema),
  remediations: z.array(z.object({ code: z.string().min(1), remediation: z.string().min(1) }).strict()),
  hashes: z.object({ manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  policy_version: z.string().min(1),
  receipt_id: z.string().regex(/^rcpt_[a-f0-9]{32}$/).nullable(),
  receipt_signature: z.string().nullable(),
  badge_url: httpsUrl.nullable(),
  chain_anchor_tx: z.string().regex(/^0x[a-fA-F0-9]{64}$/).nullable(),
  exit_code: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
}).strict();
export type MachineReportV1 = z.infer<typeof machineReportV1Schema>;

export const pubkeyV1Schema = z.object({
  key_id: z.string().min(1),
  algorithm: z.literal("Ed25519"),
  public_key_base64: z.string().min(32),
  status: z.enum(["active", "retired"]),
  created_at: z.string().datetime()
}).strict();
export const pubkeysResponseV1Schema = z.object({ schema_version: z.literal("preflight.pubkeys.v1"), keys: z.array(pubkeyV1Schema) }).strict();

export const galleryEntryV1Schema = z.object({
  schema_version: z.literal("preflight.gallery-entry.v1"),
  gallery_id: z.string().min(1),
  report_id: z.string().min(16),
  decision: z.enum(["BLOCK", "UNKNOWN"]),
  policy_version: z.string().min(1),
  criterion_codes: z.array(z.string()),
  why: z.array(z.string()),
  fix: z.array(z.string()),
  generated_at: z.string().datetime()
}).strict();
export const galleryResponseV1Schema = z.object({ schema_version: z.literal("preflight.gallery.v1"), entries: z.array(galleryEntryV1Schema) }).strict();

export const apiErrorV1Schema = z.object({
  schema_version: z.literal("preflight.error.v1"),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), category: z.enum(["VALIDATION", "PAYMENT", "RATE_LIMIT", "DEPENDENCY", "INTERNAL", "REPORT_ACCESS"]), retryable: z.boolean(), charge_status: z.enum(["NOT_CHARGED", "SETTLED", "UNKNOWN"]), request_id: z.string().min(1), details: z.record(z.string(), z.unknown()).optional() }).strict()
}).strict();
export type ApiErrorV1 = z.infer<typeof apiErrorV1Schema>;

export function manifestHash(manifest: ReleaseManifestV1): string { return canonicalHash(releaseManifestV1Schema.parse(manifest) as JsonValue); }
export function runtimeSnapshotHash(snapshot: JsonValue): string { return canonicalHash(snapshot); }

export const CONTRACT_VERSIONS = Object.freeze({ manifest: "preflight.release-manifest.v1", request: "preflight.verify-release-request.v1", discovery: "preflight.discovery.v1", runStatus: "preflight.run-status.v1", machineReport: "preflight.machine-report.v1.1", report: "preflight.release-report.v1", reportV2: "preflight.release-report.v2", receipt: "preflight.receipt.v1", pubkeys: "preflight.pubkeys.v1", gallery: "preflight.gallery.v1", error: "preflight.error.v1", policy: "preflight.release-policy.v1" });
