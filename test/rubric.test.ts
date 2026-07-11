import { describe, expect, it } from "vitest";
import { scoreFindings, scoreModules } from "../src/engine/rubric.js";

describe("deterministic rubric", () => {
  it("returns GO for no findings", () => expect(scoreFindings([])).toEqual({ score: 100, verdict: "GO" }));
  it("returns HOLD for a fixable high", () => expect(scoreFindings([{ code: "X", severity: "high", evidence: "e", fix: "f" }])).toEqual({ score: 80, verdict: "HOLD" }));
  it("returns NO-GO for a high infrastructure gate", () => expect(scoreFindings([{ code: "TLS_INVALID", severity: "high", evidence: "e", fix: "f" }])).toEqual({ score: 80, verdict: "NO-GO" }));
  it("excludes N/A modules from the score denominator", () => expect(scoreModules(
    { findings: [], evidence: {} },
    { applicable: false, findings: [{ code: "SURFACE_ROUTE_FORM", severity: "info", evidence: "route", fix: "none" }], evidence: {} }
  )).toMatchObject({ score: 100, verdict: "GO" }));
});
