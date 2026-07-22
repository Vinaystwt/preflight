import { readFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { FreeCohortScanner, cohortPublicPayload } from "../src/cohort.js";
import { SafeEgressClient } from "../src/egress/safe-client.js";
import { judgeResponse } from "../src/release/judge-response.js";
import { evaluateListingCriteria } from "../src/release/criteria.js";
import { createReceiptSigner, verifyReceiptSignature } from "../src/receipts/signer.js";
import { manifestFixture } from "./helpers/manifest.js";

const key = () => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const config = () => loadConfig({ NODE_ENV: "test", PUBLIC_DOMAIN: "api.usepreflight.xyz", RECEIPT_SIGNING_KEY: key(), RECEIPT_KEY_ID: "v5-test-key" });

describe("v5 judge-facing contracts", () => {
  it("issues a scoped PreFlight Signed Receipt without overstating cryptographic verification", () => {
    const signer = createReceiptSigner(config())!;
    const receipt = signer.issue({ report_id: "pfr_01KTESTRECEIPT000000000000", decision: "RELEASE", manifest_hash: `sha256:${"1".repeat(64)}`, snapshot_hash: `sha256:${"2".repeat(64)}`, policy_version: "preflight.release-policy.v1", settlement_ref: `0x${"3".repeat(64)}`, price_usdt: "0.10", target_endpoint: "https://example.com/run", valid_until: "2026-08-01T00:00:00.000Z" });
    expect(receipt.payload.scope).toEqual(expect.objectContaining({ proves: expect.arrayContaining(["issuer_authenticity", "payload_integrity"]), does_not_prove: expect.arrayContaining(["future_behaviour", "security_of_target"]) }));
    expect(verifyReceiptSignature(receipt.payload, receipt.signature, signer.publicKeyBase64)).toBe(true);
  });

  it("adds a first-class v2 response without changing the nested v1 report", () => {
    const signer = createReceiptSigner(config())!;
    const receipt = signer.issue({ report_id: "pfr_01KTESTRECEIPT000000000000", decision: "RELEASE", manifest_hash: `sha256:${"1".repeat(64)}`, snapshot_hash: `sha256:${"2".repeat(64)}`, policy_version: "preflight.release-policy.v1", settlement_ref: `0x${"3".repeat(64)}`, price_usdt: "0.10", target_endpoint: "https://example.com/run", valid_until: "2026-08-01T00:00:00.000Z" });
    const report = { schema_version: "preflight.release-report.v1" as const, report_id: "pfr_01KTESTRECEIPT000000000000", decision: "RELEASE" as const, manifest: { schema_version: manifestFixture.schema_version, manifest_hash: `sha256:${"1".repeat(64)}`, canonical_manifest: manifestFixture }, runtime_snapshot: { snapshot_hash: `sha256:${"2".repeat(64)}`, captured_at: "2026-07-17T00:00:00.000Z", requested_url: manifestFixture.target.endpoint }, policy_version: "preflight.release-policy.v1", summary: { matched: 1, contradictions: 0, unknown: 0, not_applicable: 2 }, criterion_groups: [], limitations: [], generated_at: "2026-07-17T00:00:00.000Z", report_expires_at: "2026-08-01T00:00:00.000Z", receipt, report_access: { report_url: "https://api.usepreflight.xyz/api/v1/reports/pfr_01KTESTRECEIPT000000000000", access_token: "a".repeat(43) } };
    const response = judgeResponse(report, "a".repeat(43), config());
    expect(response).toMatchObject({ schema_version: "preflight.release-report.v2", detail: { schema_version: "preflight.release-report.v1" }, scope: receipt.payload.scope });
    expect(response.journey.map((entry) => entry.step)).toEqual(["resolve_listing", "reach_endpoint", "tls_verify", "mcp_handshake", "payment_challenge", "reconcile", "authorize_payment", "settle_payment", "replay_request", "inspect_delivery", "seal_receipt"]);
  });

  it("maps listing/runtime fee, asset, endpoint, type and reachability divergence to LST criteria", () => {
    const artifacts = [{ kind: "TRANSPORT", normalized: { final_url: "https://wrong.example/run", status: 402 } }, { kind: "X402", normalized: { status: 402, accepts: [{ amount: "200000", asset: "0x2222222222222222222222222222222222222222" }] } }, { kind: "MCP", normalized: { tools: null } }] as never[];
    const criteria = evaluateListingCriteria({ endpoint: "https://listed.example/run", fee: "0.10", asset: "0x1111111111111111111111111111111111111111", type: "A2MCP" }, artifacts);
    expect(criteria.filter((criterion) => criterion.state === "CONTRADICTION").map((criterion) => criterion.code)).toEqual(expect.arrayContaining(["LST-01", "LST-02", "LST-03", "LST-04"]));
    expect(criteria.find((criterion) => criterion.code === "LST-05")?.state).toBe("MATCH");
  });

  it("never serializes a non-conforming ASP name in the public cohort payload", () => {
    const payload = JSON.stringify(cohortPublicPayload([{ agent_id: "bad-1", decision: "BLOCK", criterion_codes: ["LST-01"], reachable: true, checked_at: new Date("2026-07-17T00:00:00.000Z"), name: "Do Not Publish Me" }, { agent_id: "good-1", decision: "RELEASE", criterion_codes: [], reachable: true, checked_at: new Date("2026-07-17T00:00:00.000Z"), name: "Safe To Name" }], "2026-07-17T00:00:00.000Z"));
    expect(payload).not.toContain("Do Not Publish Me"); expect(payload).toContain("Safe To Name"); expect(payload).toContain("LST-01");
  });

  it("keeps cohort scanning structurally isolated from payment and buyer code", async () => {
    const source = await readFile(new URL("../src/cohort.ts", import.meta.url), "utf8");
    expect(source).toContain("SafeEgressClient"); expect(source).not.toMatch(/payments\/buyer|createBuyerProofClient|paidFetch|settle\(/);
  });

  it("paces every free scanner request for one target and applies the discovery user agent", async () => {
    const challenge = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:196", amount: "100000", asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736", payTo: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2" }] })).toString("base64");
    const bodies = ["{}", "{}", JSON.stringify({ result: { protocolVersion: "2025-03-26" } }), JSON.stringify({ result: { tools: [] } })];
    const userAgents: string[] = [];
    const egress = new SafeEgressClient({ resolver: { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] }, requestOnce: async (_url, _address, _family, _body, _signal, options) => {
      userAgents.push(options.userAgent);
      const index = userAgents.length - 1;
      return { status: index < 2 ? 402 : 200, headers: index < 2 ? { "payment-required": challenge } : {}, compressedBody: Buffer.from(bodies[index]!) };
    } });
    const field = (value: string | null) => ({ value, source: "test", confidence: value === null ? "unknown" as const : "observed" as const });
    const resolution = { agent_id: "1", name: field("Test ASP"), description: field(null), category_code: field(null), status: field(null), services: [{ service_id: field("svc-1"), name: field("Test"), type: field("A2MCP"), fee: field("0.10"), endpoint: field("https://example.com/run"), asset_contract: field("0x779ded0c9e1022225f8e0630b35a9b54be713736") }], resolved_at: "2026-07-17T00:00:00.000Z", resolution_source: "test" };
    const repository = { cachedAgentResolution: async () => resolution, cacheAgentResolution: async () => undefined, reserveRateLimit: async () => ({ allowed: true, count: 1 }), cohortRow: async () => null, recordCohortResult: async () => undefined };
    const pauses: number[] = [];
    const scanner = new FreeCohortScanner(repository as never, { resolve: async () => resolution }, egress, config(), async (milliseconds) => { pauses.push(milliseconds); });
    await scanner.scanAgent("1", "coh_test");
    expect(pauses).toHaveLength(3);
    expect(pauses.every((milliseconds) => milliseconds >= 9_500 && milliseconds <= 10_000)).toBe(true);
    expect(userAgents).toEqual(Array(4).fill("PreFlight/1.0 (+https://usepreflight.xyz; free discovery)"));
  });
});
