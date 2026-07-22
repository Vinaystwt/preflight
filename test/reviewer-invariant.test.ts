import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { verifyReleaseRequestV1Schema } from "../src/contracts/release-gate.js";
import { mountMcp } from "../src/mcp/server.js";
import type { ReleasePaymentGateway } from "../src/payments/release-gateway.js";
import { mountReleaseGate } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300 };
const challenge = { x402Version: 2, accepts: [requirement] };
const paymentPayload = { x402Version: 2, accepted: requirement, payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } } };

function gateway(overrides: Partial<ReleasePaymentGateway> = {}): ReleasePaymentGateway {
  return {
    requirements: vi.fn(async () => [requirement] as never),
    challenge: vi.fn(async () => Buffer.from(JSON.stringify(challenge)).toString("base64")),
    decode: vi.fn((signature) => { if (signature !== "paid") throw new Error("invalid payment"); return paymentPayload as never; }),
    match: vi.fn(() => requirement as never),
    verify: vi.fn(async () => ({ valid: true, payer: paymentPayload.payload.authorization.from })),
    settle: vi.fn(),
    settlementStatus: vi.fn(),
    responseHeader: vi.fn(),
    ...overrides
  };
}

async function app(testGateway: ReleasePaymentGateway = gateway()) {
  const fastify = Fastify();
  const config = loadConfig({
    NODE_ENV: "test",
    BUILD_SHA: "abcdef1",
    OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2",
    REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes",
    COHORT_ENABLED: "false"
  });
  mountReleaseGate(fastify, config, { sql: (() => undefined) } as unknown as Database, { gateway: testGateway, buyerProof: null });
  mountMcp(fastify, config);
  await fastify.ready();
  return fastify;
}

function decoded(response: { headers: Record<string, string | string[] | number | undefined> }) {
  return JSON.parse(Buffer.from(String(response.headers["payment-required"]), "base64").toString("utf8"));
}

describe("reviewer x402 challenge invariant", () => {
  it("mirrors the OKX listing-review probe by returning a full challenge on GET and POST", async () => {
    const server = await app();
    const get = await server.inject({ method: "GET", url: "/api/v1/verify-release" });
    expect(get.statusCode).toBe(402);
    expect(get.headers.allow).toBe("POST");
    expect(decoded(get).accepts[0]).toMatchObject(requirement);

    const post = await server.inject({ method: "POST", url: "/api/v1/verify-release", payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }), headers: { "content-type": "application/json" } });
    expect(post.statusCode).toBe(402);
    expect(decoded(post).accepts[0]).toMatchObject(requirement);
    await server.close();
  });

  it("challenges unauthorized requests before body parsing or request validation", async () => {
    const server = await app();
    const cases = [
      { name: "no body", payload: undefined, headers: undefined },
      { name: "valid json", payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }), headers: { "content-type": "application/json" } },
      { name: "malformed json", payload: "{", headers: { "content-type": "application/json" } },
      { name: "empty json", payload: "{}", headers: { "content-type": "application/json" } },
      { name: "wrong content type", payload: "not json", headers: { "content-type": "text/plain" } },
      { name: "large invalid body", payload: JSON.stringify({ padding: "x".repeat(128_000) }), headers: { "content-type": "application/json" } }
    ];
    for (const item of cases) {
      const response = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: item.headers, payload: item.payload });
      expect(response.statusCode, item.name).toBe(402);
      expect(decoded(response).accepts[0]).toMatchObject(requirement);
    }
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "content-type": "application/json" }, payload: index % 2 ? "{" : "{}" })));
    expect(concurrent.every((response) => response.statusCode === 402 && response.headers["payment-required"])).toBe(true);
    await server.close();
  }, 15_000);

  it("validates authorized bodies after payment verification without settling invalid requests", async () => {
    const fake = gateway();
    const server = await app(fake);
    const bigBody = JSON.stringify({ padding: "x".repeat(1_000_001) });
    const cases = [
      { name: "malformed JSON", payload: "{", headers: { "content-type": "application/json" }, issue: { path: "$", code: "invalid_json" } },
      { name: "empty object", payload: "{}", headers: { "content-type": "application/json" }, issue: {} },
      { name: "array", payload: "[]", headers: { "content-type": "application/json" }, issue: {} },
      { name: "scalar", payload: JSON.stringify("endpoint"), headers: { "content-type": "application/json" }, issue: {} },
      { name: "missing target", payload: JSON.stringify({ schema_version: "preflight.verify-release-request.v1" }), headers: { "content-type": "application/json" }, issue: {} },
      { name: "invalid URL", payload: JSON.stringify({ endpoint: "https://not a url" }), headers: { "content-type": "application/json" }, issue: {} },
      { name: "unknown field", payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint, intent: "verify" }), headers: { "content-type": "application/json" }, issue: { path: "intent", code: "unrecognized_keys" } },
      { name: "unsupported content type", payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }), headers: { "content-type": "text/plain" }, issue: { path: "$", code: "invalid_content_type" } },
      { name: "body above 1 MB", payload: bigBody, headers: { "content-type": "application/json" }, issue: { path: "$", code: "body_too_large" } }
    ];
    for (const item of cases) {
      const response = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", ...item.headers }, payload: item.payload });
      expect(response.statusCode, item.name).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        error: {
          code: "VERIFY_REQUEST_INVALID",
          charge_status: "NOT_CHARGED",
          details: {
            issues: [expect.objectContaining(item.issue)],
            accepted_input: {
              canonical_example: { endpoint: "https://public-service.example/path" },
              schema_url: "https://api.usepreflight.xyz/api/v1/contracts/verify-release-request/v1"
            }
          }
        }
      });
      expect(JSON.stringify(body)).not.toMatch(/stack|DATABASE_URL|REPORT_TOKEN_SECRET|RECEIPT_SIGNING_KEY/i);
    }
    const unapprovedBuyerProof = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint, authorize_buyer_proof: true }) });
    expect(unapprovedBuyerProof.statusCode).toBe(400);
    expect(unapprovedBuyerProof.json()).toMatchObject({ error: { code: "BUYER_OWNER_ATTESTATION_REQUIRED", charge_status: "NOT_CHARGED" } });
    expect(fake.settle).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects malformed or mismatched payment authorizations before settlement", async () => {
    const signatures = [
      "invalid signature",
      "expired authorization",
      "wrong amount",
      "wrong payTo",
      "wrong asset",
      "wrong network",
      "malformed payment payload",
      "insufficient authorization value"
    ];
    for (const signature of signatures) {
      const fake = gateway({
        decode: vi.fn(() => signature === "malformed payment payload" ? (() => { throw new Error("malformed"); })() : ({ ...paymentPayload, kind: signature }) as never),
        match: vi.fn(() => signature === "wrong amount" || signature === "wrong payTo" || signature === "wrong asset" || signature === "wrong network" ? undefined : requirement as never),
        verify: vi.fn(async () => signature === "invalid signature" || signature === "expired authorization" || signature === "insufficient authorization value"
          ? ({ valid: false, payer: paymentPayload.payload.authorization.from } as never)
          : ({ valid: true, payer: paymentPayload.payload.authorization.from } as never))
      });
      const server = await app(fake);
      const response = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": signature, "content-type": "application/json" }, payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }) });
      expect(response.statusCode, signature).toBe(402);
      expect(decoded(response).accepts[0]).toMatchObject(requirement);
      expect(fake.settle).not.toHaveBeenCalled();
      await server.close();
    }
  });

  it("accepts the generic buyer endpoint contract and normalizes documented aliases", () => {
    const endpoint = manifestFixture.target.endpoint;
    for (const body of [
      { endpoint },
      { schema_version: "preflight.verify-release-request.v1", endpoint },
      { url: endpoint },
      { target_url: endpoint },
      { targetUrl: endpoint },
      { service_url: endpoint },
      { service_endpoint: endpoint },
      { agent_url: endpoint },
      { target: { endpoint } }
    ]) {
      expect(verifyReleaseRequestV1Schema.parse(body)).toMatchObject({ schema_version: "preflight.verify-release-request.v1", endpoint, include_in_gallery: false });
    }
    expect(verifyReleaseRequestV1Schema.parse({ agent_id: "2013" })).toMatchObject({ schema_version: "preflight.verify-release-request.v1", agent_id: "2013" });
    expect(() => verifyReleaseRequestV1Schema.parse({ endpoint, agent_id: "2013" })).toThrow(/exactly one/i);
    expect(() => verifyReleaseRequestV1Schema.parse({ endpoint, url: "https://other.example/service" })).toThrow(/conflicting/i);
    expect(() => verifyReleaseRequestV1Schema.parse({ endpoint, intent: "verify" })).toThrow(/Unrecognized key/);
    expect(() => verifyReleaseRequestV1Schema.parse({ endpoint: "http://example.com/service" })).toThrow(/HTTPS/i);
    expect("authorize_buyer_proof" in verifyReleaseRequestV1Schema.parse({ endpoint })).toBe(false);
    expect(verifyReleaseRequestV1Schema.parse({ target: { endpoint } })).toMatchObject({ endpoint });
    expect(() => verifyReleaseRequestV1Schema.parse({ target: { endpoint }, endpoint: "https://other.example/service" })).toThrow(/conflicting/i);
  });

  it("keeps public discovery contracts equivalent across service, OpenAPI, contracts, and MCP", async () => {
    const server = await app();
    const service = await server.inject({ method: "GET", url: "/api/v1/service" });
    expect(service.statusCode).toBe(200);
    expect(service.json()).toMatchObject({
      input: {
        canonical_example: { endpoint: "https://public-service.example/path" },
        schema_url: "https://api.usepreflight.xyz/api/v1/contracts/verify-release-request/v1",
        json_schema: { type: "object", properties: { endpoint: { type: "string" } } }
      }
    });
    const contract = await server.inject({ method: "GET", url: "/api/v1/contracts/verify-release-request/v1" });
    expect(contract.statusCode).toBe(200);
    expect(contract.json()).toMatchObject({ canonical_example: { endpoint: "https://public-service.example/path" }, json_schema: { properties: { endpoint: { type: "string" } } } });
    const openapi = JSON.parse(readFileSync(new URL("../docs/openapi.release-gate.v1.json", import.meta.url), "utf8")) as { paths: Record<string, { post?: { requestBody?: { content?: { "application/json"?: { examples?: unknown; schema?: unknown } } } } }> };
    const verifyReleasePath = openapi.paths["/api/v1/verify-release"];
    expect(verifyReleasePath?.post?.requestBody?.content?.["application/json"]?.examples).toMatchObject({ canonical: { value: { endpoint: "https://public-service.example/path" } } });
    const mcp = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    const tool = mcp.json().result.tools.find((item: { name: string }) => item.name === "verify_release");
    expect(tool.inputSchema).toMatchObject(contract.json().json_schema);
    await server.close();
  });

  it("exposes the full verify_release inputSchema through raw MCP tools/list", async () => {
    const server = await app();
    const response = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(response.statusCode).toBe(200);
    const tool = response.json().result.tools.find((item: { name: string }) => item.name === "verify_release");
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      properties: { endpoint: { type: "string" }, agent_id: { type: "string" }, authorize_buyer_proof: { type: "boolean" } },
      examples: [{ endpoint: "https://public-service.example/path" }]
    });
    expect(tool.inputSchema).not.toEqual({ type: "object" });
    await server.close();
  });

  it("returns valid MCP initialize, actionable errors, and no private material", async () => {
    const server = await app();
    const initialize = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "reviewer-test", version: "1" } } } });
    expect(initialize.statusCode).toBe(200);
    expect(initialize.json()).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } });
    const invalidToolArgs = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "verify_release", arguments: [] } } });
    expect(invalidToolArgs.statusCode).toBe(200);
    expect(invalidToolArgs.json()).toMatchObject({ result: { structuredContent: { paid: true, input: { canonical_example: { endpoint: "https://public-service.example/path" } } } } });
    const unknownTool = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "missing_tool", arguments: {} } } });
    expect(unknownTool.statusCode).toBe(200);
    expect(unknownTool.json()).toMatchObject({ jsonrpc: "2.0", id: 3, error: { code: expect.any(Number), message: expect.stringMatching(/tool|not found|unknown/i) } });
    expect(`${initialize.body}\n${invalidToolArgs.body}\n${unknownTool.body}`).not.toMatch(/REPORT_TOKEN_SECRET|RECEIPT_SIGNING_KEY|access_token|\\.onchainos|DATABASE_URL/i);
    await server.close();
  });
});
