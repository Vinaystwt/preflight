import { describe, expect, it } from "vitest";
import { SafeEgressClient, type RawResponse } from "../src/egress/safe-client.js";
import { discoverReleaseSurface } from "../src/release/discovery.js";
import { manifestFixture } from "./helpers/manifest.js";

const resolver = { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] };
const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300, extra: { name: "USDt0", version: "1" } };
const challenge = { x402Version: 2, accepts: [requirement] };
const response = (status: number, body = "{}", headers: RawResponse["headers"] = {}): RawResponse => ({ status, headers, compressedBody: Buffer.from(body) });
const paymentHeaders = { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") };

function client(responses: RawResponse[]) {
  return new SafeEgressClient({ resolver, requestOnce: async () => responses.shift() ?? response(404) });
}

describe("Release Gate discovery", () => {
  it("synthesizes an observed X402 route-form manifest with field provenance", async () => {
    const discovery = await discoverReleaseSurface({ endpoint: manifestFixture.target.endpoint, client: client([response(402, "{}", paymentHeaders), response(402, "{}", paymentHeaders), response(404), response(404)]) });
    expect(discovery.observed_surface.x402.accepts?.[0]).toMatchObject({ network: requirement.network, asset: requirement.asset, amount: requirement.amount, payTo: requirement.payTo });
    expect(discovery.proposed_manifest.manifest).toMatchObject({ target: { interface_mode: "X402_HTTP" }, payment: { mode: "X402", amount_atomic: "100000", pay_to: requirement.payTo } });
    expect(discovery.proposed_manifest.fields["payment.amount_atomic"]).toMatchObject({ source: "x402_challenge", confidence: "observed", requires_confirmation: false });
    expect(discovery.proposed_manifest.fields["request_contract.schema"]).toMatchObject({ confidence: "unknown", requires_confirmation: true });
  });

  it("marks MCP as non-applicable for route-form targets instead of blocking discovery", async () => {
    const discovery = await discoverReleaseSurface({ endpoint: manifestFixture.target.endpoint, client: client([response(402, "{}", paymentHeaders), response(402, "{}", paymentHeaders), response(404), response(404)]) });
    expect(discovery.proposed_manifest.manifest?.target.interface_mode).toBe("X402_HTTP");
  });

  it("does not invent payment fields when 402 challenge parsing fails", async () => {
    const discovery = await discoverReleaseSurface({ endpoint: manifestFixture.target.endpoint, client: client([response(402, "{}", { "payment-required": "not-json" }), response(402, "{}", { "payment-required": "not-json" }), response(404), response(404)]) });
    expect(discovery.observed_surface.x402.parse_error).toBe("PAYMENT_REQUIRED_MALFORMED");
    expect(discovery.proposed_manifest.manifest).toBeUndefined();
    expect(discovery.proposed_manifest.fields["payment.mode"]).toMatchObject({ confidence: "unknown", requires_confirmation: true });
  });

  it("captures missing 402 as an observed free HTTP surface", async () => {
    const discovery = await discoverReleaseSurface({ endpoint: "https://free.example/run", client: client([response(200), response(200), response(404), response(404)]) });
    expect(discovery.proposed_manifest.manifest).toMatchObject({ target: { interface_mode: "FREE_HTTP" }, payment: { mode: "FREE" } });
  });
});
