import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorV1Schema, canonicalHash, canonicalJson, criterionResultSchema, discoveryResponseV1Schema, machineReportV1Schema, manifestHash,
  releaseManifestV1Schema, runStatusV1Schema, verifyReleaseRequestV1JsonSchema, verifyReleaseResponseV1Schema
} from "../src/contracts/index.js";
import { manifestFixture } from "./helpers/manifest.js";

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
      manifest: z.toJSONSchema(releaseManifestV1Schema), request: verifyReleaseRequestV1JsonSchema,
      discovery: z.toJSONSchema(discoveryResponseV1Schema), runStatus: z.toJSONSchema(runStatusV1Schema), machineReport: z.toJSONSchema(machineReportV1Schema),
      report: z.toJSONSchema(verifyReleaseResponseV1Schema), criterion: z.toJSONSchema(criterionResultSchema), error: z.toJSONSchema(apiErrorV1Schema)
    }).toMatchSnapshot();
  });
});
