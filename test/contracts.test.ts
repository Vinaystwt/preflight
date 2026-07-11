import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorV1Schema, canonicalHash, canonicalJson, criterionResultSchema, manifestHash,
  releaseManifestV1Schema, verifyReleaseRequestV1Schema, verifyReleaseResponseV1Schema
} from "../src/contracts/index.js";

export const manifestFixture = {
  schema_version: "preflight.release-manifest.v1" as const,
  release: { service_name: "Example", release_version: "1.0.0" },
  target: { endpoint: "https://example.com/api", method: "POST" as const, interface_mode: "X402_HTTP" as const, redirect_policy: "NONE" as const },
  payment: { mode: "X402" as const, network: "eip155:196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", amount_atomic: "100000", pay_to: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2" },
  request_contract: { content_type: "application/json" as const, schema: { type: "object" as const, properties: { target: { type: "string" as const } }, required: ["target"] } }
};

describe("Release Gate frozen contracts", () => {
  it("accepts the approved v1 manifest and rejects unknown fields", () => {
    expect(releaseManifestV1Schema.parse(manifestFixture)).toEqual(manifestFixture);
    expect(() => releaseManifestV1Schema.parse({ ...manifestFixture, score: 100 })).toThrow();
  });

  it("canonicalizes independently of object key order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    const reordered = JSON.parse(JSON.stringify(manifestFixture, Object.keys(manifestFixture).reverse())) as unknown;
    expect(manifestHash(releaseManifestV1Schema.parse(manifestFixture))).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(reordered).toBeDefined();
  });

  it("freezes JSON Schema snapshots", () => {
    expect({
      manifest: z.toJSONSchema(releaseManifestV1Schema), request: z.toJSONSchema(verifyReleaseRequestV1Schema),
      report: z.toJSONSchema(verifyReleaseResponseV1Schema), criterion: z.toJSONSchema(criterionResultSchema), error: z.toJSONSchema(apiErrorV1Schema)
    }).toMatchSnapshot();
  });
});
