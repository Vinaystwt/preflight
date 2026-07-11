import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { apiErrorV1Schema, releaseManifestV1Schema, verifyReleaseRequestV1Schema, verifyReleaseResponseV1Schema } from "../src/contracts/index.js";

const document = {
  openapi: "3.1.0", info: { title: "PreFlight Release Gate API", version: "1.0.0" },
  servers: [{ url: "https://api.usepreflight.xyz" }],
  paths: {
    "/livez": { get: { responses: { "200": { description: "Process is live" } } } },
    "/readyz": { get: { responses: { "200": { description: "Dependencies are ready" }, "503": { description: "Not ready" } } } },
    "/api/v1/service": { get: { responses: { "200": { description: "Service metadata" } } } },
    "/api/v1/contracts/release-manifest/v1": { get: { responses: { "200": { description: "Frozen Release Manifest JSON Schema" } } } },
    "/api/v1/release-manifests/draft": { post: { requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReleaseManifestV1" } } } }, responses: { "200": { description: "Validated draft; never a verdict" }, "400": { $ref: "#/components/responses/Error" }, "429": { $ref: "#/components/responses/Error" } } } },
    "/api/v1/verify-release": { post: { parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: 16 } }, { in: "header", name: "PAYMENT-SIGNATURE", required: false, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyReleaseRequestV1" } } } }, responses: { "200": { description: "Settlement-confirmed private report", content: { "application/json": { schema: { $ref: "#/components/schemas/VerifyReleaseResponseV1" } } } }, "402": { description: "x402 v2 challenge", headers: { "PAYMENT-REQUIRED": { schema: { type: "string" } } } }, "400": { $ref: "#/components/responses/Error" } } } },
    "/api/v1/reports/{report_id}": { get: { security: [{ bearerCapability: [] }], parameters: [{ in: "path", name: "report_id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Private report" }, "404": { $ref: "#/components/responses/Error" }, "410": { $ref: "#/components/responses/Error" } } } }
  },
  components: { schemas: { ReleaseManifestV1: z.toJSONSchema(releaseManifestV1Schema), VerifyReleaseRequestV1: z.toJSONSchema(verifyReleaseRequestV1Schema), VerifyReleaseResponseV1: z.toJSONSchema(verifyReleaseResponseV1Schema), ApiErrorV1: z.toJSONSchema(apiErrorV1Schema) }, responses: { Error: { description: "Typed API error", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorV1" } } } } }, securitySchemes: { bearerCapability: { type: "http", scheme: "bearer" } } }
};
await writeFile(new URL("../docs/openapi.release-gate.v1.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
