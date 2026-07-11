import { describe, expect, it } from "vitest";
import type { CriterionResult } from "../src/contracts/release-gate.js";
import { aggregateDecision, evaluateCriteria } from "../src/release/criteria.js";
import { evidenceArtifact } from "../src/release/evidence.js";

const manifestFixture = {
  schema_version: "preflight.release-manifest.v1" as const, release: { service_name: "Example" },
  target: { endpoint: "https://example.com/api", method: "POST" as const, interface_mode: "X402_HTTP" as const, redirect_policy: "NONE" as const },
  payment: { mode: "X402" as const, network: "eip155:196", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", amount_atomic: "100000", pay_to: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2" }
};

const criterion = (state: CriterionResult["state"], mandatory = true): CriterionResult => ({ code: "TEST", group: "test", state, mandatory, provenance: ["DERIVED"], comparison_rule: "fixture", evidence_refs: [] });

describe("deterministic Release Gate aggregation", () => {
  it("mandatory contradiction blocks", () => expect(aggregateDecision([criterion("MATCH"), criterion("CONTRADICTION")])).toBe("BLOCK"));
  it("mandatory unknown never releases", () => expect(aggregateDecision([criterion("MATCH"), criterion("UNKNOWN")])).toBe("UNKNOWN"));
  it("all mandatory applicable matches release", () => expect(aggregateDecision([criterion("MATCH"), criterion("NOT_APPLICABLE")])).toBe("RELEASE"));
  it("empty/non-applicable module set yields UNKNOWN, never RELEASE", () => expect(aggregateDecision([criterion("NOT_APPLICABLE")])).toBe("UNKNOWN"));
  it("HTTP failure yields BLOCK or UNKNOWN, never RELEASE", () => {
    const artifacts = [evidenceArtifact("TRANSPORT", manifestFixture.target.endpoint, { status: 0, final_url: manifestFixture.target.endpoint, redirects: [], latency_ms: 0, resolved_addresses: [] })];
    expect(aggregateDecision(evaluateCriteria(manifestFixture, artifacts))).not.toBe("RELEASE");
  });
  it("HTTP 500 is a blocking contradiction", () => {
    const artifacts = [evidenceArtifact("TRANSPORT", manifestFixture.target.endpoint, { status: 500, final_url: manifestFixture.target.endpoint, redirects: [], latency_ms: 1, resolved_addresses: ["93.184.216.34"] })];
    const criteria = evaluateCriteria(manifestFixture, artifacts);
    expect(criteria.find((item) => item.code === "TARGET_METHOD")?.state).toBe("CONTRADICTION");
    expect(aggregateDecision(criteria)).toBe("BLOCK");
  });
  it("a missing MCP handshake for an MCP manifest is UNKNOWN, never RELEASE", () => {
    const mcpManifest = { ...manifestFixture, target: { ...manifestFixture.target, interface_mode: "MCP_PLUS_X402_HTTP" as const, mcp_url: "https://example.com/mcp" } };
    expect(aggregateDecision(evaluateCriteria(mcpManifest, []))).toBe("UNKNOWN");
  });
  it("treats a route-form X402 service as a matching non-MCP interface", () => {
    const artifacts = [evidenceArtifact("TRANSPORT", manifestFixture.target.endpoint, { status: 402, final_url: manifestFixture.target.endpoint, redirects: [], latency_ms: 1, resolved_addresses: ["93.184.216.34"] })];
    expect(evaluateCriteria(manifestFixture, artifacts).find((item) => item.code === "INTERFACE_MODE")?.state).toBe("MATCH");
  });
  it("wrong x402 amount, asset, network and payTo are explicit contradictions", () => {
    const artifacts = [
      evidenceArtifact("TRANSPORT", manifestFixture.target.endpoint, { status: 402, final_url: manifestFixture.target.endpoint, redirects: [], latency_ms: 1, resolved_addresses: ["93.184.216.34"] }),
      evidenceArtifact("X402", manifestFixture.target.endpoint, { status: 402, x402_version: 2, accepts: [{ network: "wrong", asset: "wrong", amount: "999", payTo: "0x0000000000000000000000000000000000000000" }], parse_error: null })
    ];
    const criteria = evaluateCriteria(manifestFixture, artifacts);
    for (const code of ["PAYMENT_NETWORK", "PAYMENT_ASSET", "PAYMENT_AMOUNT", "PAYMENT_PAY_TO"]) expect(criteria.find((item) => item.code === code)?.state).toBe("CONTRADICTION");
    expect(aggregateDecision(criteria)).toBe("BLOCK");
  });
});
