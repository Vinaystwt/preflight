import { describe, expect, it } from "vitest";
import { SafeEgressClient, type RawResponse } from "../src/egress/safe-client.js";
import { mcpAdapter, x402Adapter } from "../src/release/adapters.js";

const resolver = { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] };
const response = (status: number, body: string, headers: RawResponse["headers"] = {}): RawResponse => ({ status, headers, compressedBody: Buffer.from(body) });

describe("evidence probe adapters", () => {
  it("captures a missing unpaid 402 without inventing payment data", async () => {
    const client = new SafeEgressClient({ resolver, requestOnce: async () => response(200, "{}") });
    const artifact = await x402Adapter(client, "https://example.com/pay", {});
    expect(artifact.normalized).toEqual({ status: 200, x402_version: null, accepts: null, parse_error: null });
  });

  it("captures malformed PAYMENT-REQUIRED as evidence", async () => {
    const client = new SafeEgressClient({ resolver, requestOnce: async () => response(402, "{}", { "payment-required": "not-base64-json" }) });
    const artifact = await x402Adapter(client, "https://example.com/pay", {});
    expect(artifact.normalized).toMatchObject({ status: 402, accepts: null, parse_error: "PAYMENT_REQUIRED_MALFORMED" });
  });

  it("parses x402 v2 accepts arrays verbatim", async () => {
    const challenge = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:196", amount: "100000", asset: "asset", payTo: "wallet", maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } }] };
    const client = new SafeEgressClient({ resolver, requestOnce: async () => response(402, "{}", { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") }) });
    expect((await x402Adapter(client, "https://example.com/pay", {})).normalized).toMatchObject({ x402_version: 2, accepts: challenge.accepts });
  });

  it("treats a non-array accepts field as malformed evidence", async () => {
    const challenge = { x402Version: 2, accepts: { network: "eip155:196" } };
    const client = new SafeEgressClient({ resolver, requestOnce: async () => response(402, "{}", { "payment-required": Buffer.from(JSON.stringify(challenge)).toString("base64") }) });
    expect((await x402Adapter(client, "https://example.com/pay", {})).normalized).toMatchObject({ status: 402, accepts: null });
  });

  it("is tolerant of MCP text/event-stream responses", async () => {
    const bodies = [
      'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n\n',
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"verify_release","description":"Release gate","inputSchema":{"type":"object"}}]}}\n\n'
    ];
    const client = new SafeEgressClient({ resolver, requestOnce: async () => response(200, bodies.shift()!) });
    const artifact = await mcpAdapter(client, "https://example.com/mcp");
    expect(artifact.normalized).toMatchObject({ protocol_version: "2025-03-26", tools_status: 200 });
    expect((artifact.normalized as { tools: unknown[] }).tools).toHaveLength(1);
  });
});
