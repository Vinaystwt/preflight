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

export const verifyReleaseRequestV1Schema = z.object({
  schema_version: z.literal("preflight.verify-release-request.v1"),
  manifest: releaseManifestV1Schema,
  probe_input: jsonValueSchema.optional()
}).strict();
export type VerifyReleaseRequestV1 = z.infer<typeof verifyReleaseRequestV1Schema>;

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
export const criterionResultSchema = z.object({
  code: z.string().min(1), group: z.string().min(1), state: criterionStateSchema, mandatory: z.boolean(),
  expected: jsonValueSchema.optional(), observed: jsonValueSchema.optional(), provenance: z.array(evidenceProvenanceSchema).min(1),
  comparison_rule: z.string().min(1), consequence: z.string().min(1).optional(), remediation: z.string().min(1).optional(),
  evidence_refs: z.array(evidenceRefSchema), limitation: z.string().min(1).optional()
}).strict();
export type CriterionResult = z.infer<typeof criterionResultSchema>;

export const criterionGroupResultSchema = z.object({ code: z.string().min(1), label: z.string().min(1), criteria: z.array(criterionResultSchema) }).strict();
export const verifyReleaseResponseV1Schema = z.object({
  schema_version: z.literal("preflight.release-report.v1"), report_id: z.string().min(16), decision: releaseDecisionSchema,
  manifest: z.object({ schema_version: z.string(), manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), canonical_manifest: releaseManifestV1Schema }).strict(),
  runtime_snapshot: z.object({ snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/), captured_at: z.string().datetime(), requested_url: httpsUrl, final_url: httpsUrl.optional(), build_identifier: z.string().optional() }).strict(),
  policy_version: z.string().min(1),
  summary: z.object({ matched: z.number().int().nonnegative(), contradictions: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(), not_applicable: z.number().int().nonnegative() }).strict(),
  criterion_groups: z.array(criterionGroupResultSchema), limitations: z.array(z.string()), generated_at: z.string().datetime(), report_expires_at: z.string().datetime(),
  report_access: z.object({ report_url: httpsUrl, access_token: z.string().min(43) }).strict()
}).strict();
export type VerifyReleaseResponseV1 = z.infer<typeof verifyReleaseResponseV1Schema>;

export const apiErrorV1Schema = z.object({
  schema_version: z.literal("preflight.error.v1"),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), category: z.enum(["VALIDATION", "PAYMENT", "RATE_LIMIT", "DEPENDENCY", "INTERNAL", "REPORT_ACCESS"]), retryable: z.boolean(), charge_status: z.enum(["NOT_CHARGED", "SETTLED", "UNKNOWN"]), request_id: z.string().min(1), details: z.record(z.string(), z.unknown()).optional() }).strict()
}).strict();
export type ApiErrorV1 = z.infer<typeof apiErrorV1Schema>;

export function manifestHash(manifest: ReleaseManifestV1): string { return canonicalHash(releaseManifestV1Schema.parse(manifest) as JsonValue); }
export function runtimeSnapshotHash(snapshot: JsonValue): string { return canonicalHash(snapshot); }

export const CONTRACT_VERSIONS = Object.freeze({ manifest: "preflight.release-manifest.v1", request: "preflight.verify-release-request.v1", report: "preflight.release-report.v1", error: "preflight.error.v1", policy: "preflight.release-policy.v1" });
