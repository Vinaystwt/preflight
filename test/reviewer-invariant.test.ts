import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { EgressPolicyError, SafeEgressClient, type RawResponse } from "../src/egress/safe-client.js";
import { verifyReleaseRequestV1Schema } from "../src/contracts/release-gate.js";
import { mountMcp } from "../src/mcp/server.js";
import { decodeReleasePaymentAuthorization, type ReleasePaymentGateway } from "../src/payments/release-gateway.js";
import { mountReleaseGate, verifyReleaseGetQueryToBody } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } } as const;
const challenge = { x402Version: 2, accepts: [requirement] };
const paymentPayload = { x402Version: 2, accepted: requirement, payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } } };

function gateway(overrides: Partial<ReleasePaymentGateway> = {}): ReleasePaymentGateway {
  const base = {
    requirements: vi.fn(async () => [requirement] as never),
    challenge: vi.fn(async () => Buffer.from(JSON.stringify(challenge)).toString("base64")),
    decode: vi.fn((signature) => { if (signature !== "paid") throw new Error("invalid payment"); return paymentPayload as never; }),
    match: vi.fn(() => requirement as never),
    verify: vi.fn(async () => ({ valid: true, payer: paymentPayload.payload.authorization.from })),
    settle: vi.fn(),
    settlementStatus: vi.fn(),
    responseHeader: vi.fn(),
    ...overrides
  } as ReleasePaymentGateway;
  base.decodeAuthorization = overrides.decodeAuthorization ?? vi.fn((headers) => {
    const v2 = headers["payment-signature"];
    const v1 = headers["x-payment"];
    const v2Value = typeof v2 === "string" ? v2 : undefined;
    const v1Value = typeof v1 === "string" ? v1 : undefined;
    if (!v2Value && !v1Value) return null;
    if (v2Value && v1Value && v2Value !== v1Value) throw new Error("conflicting_payment_headers");
    const protocol = v1Value && !v2Value ? "v1" as const : "v2" as const;
    const payload = base.decode(v2Value ?? v1Value!);
    return { protocol, requestHeaderName: protocol === "v1" ? "X-PAYMENT" as const : "PAYMENT-SIGNATURE" as const, responseHeaderName: protocol === "v1" ? "X-PAYMENT-RESPONSE" as const : "PAYMENT-RESPONSE" as const, payload, fingerprint: `test:${JSON.stringify(payload.payload)}` };
  });
  return base;
}

const resolver = { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] };
const rawResponse = (status: number, body = "{}", headers: RawResponse["headers"] = {}): RawResponse => ({ status, headers, compressedBody: Buffer.from(body) });
function egress(responses: RawResponse[]) {
  return new SafeEgressClient({ resolver, requestOnce: async () => responses.shift() ?? rawResponse(404) });
}

async function app(testGateway: ReleasePaymentGateway = gateway(), options: { egress?: SafeEgressClient } = {}) {
  const fastify = Fastify();
  const config = loadConfig({
    NODE_ENV: "test",
    BUILD_SHA: "abcdef1",
    OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2",
    REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes",
    COHORT_ENABLED: "false"
  });
  mountReleaseGate(fastify, config, { sql: (() => undefined) } as unknown as Database, { gateway: testGateway, buyerProof: null, ...(options.egress ? { egress: options.egress } : {}) });
  mountMcp(fastify, config);
  await fastify.ready();
  return fastify;
}

function decoded(response: { headers: Record<string, string | string[] | number | undefined> }) {
  return JSON.parse(Buffer.from(String(response.headers["payment-required"]), "base64").toString("utf8"));
}

function b64(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
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
    expect(post.json()).toMatchObject({
      error: {
        code: "PAYMENT_REQUIRED",
        charge_status: "NOT_CHARGED",
        details: {
          accepted_payment_headers: ["PAYMENT-SIGNATURE", "X-PAYMENT"],
          protocol_versions: { "PAYMENT-SIGNATURE": 2, "X-PAYMENT": 1 },
          reason: "missing_header"
        }
      }
    });
    await server.close();
  });

  it("normalizes legacy X-PAYMENT v1 without trusting client-declared commercial terms", () => {
    const legacy = b64({ x402Version: 1, scheme: "exact", network: "eip155:196", payload: { signature: "0x" + "1".repeat(130), authorization: { from: paymentPayload.payload.authorization.from, value: "999999999" } } });
    const auth = decodeReleasePaymentAuthorization({ "x-payment": legacy }, [requirement]);
    expect(auth).toMatchObject({
      protocol: "v1",
      requestHeaderName: "X-PAYMENT",
      responseHeaderName: "X-PAYMENT-RESPONSE",
      payload: {
        x402Version: 2,
        accepted: requirement,
        payload: {
          signature: "0x" + "1".repeat(130),
          authorization: { from: paymentPayload.payload.authorization.from, value: "999999999" }
        }
      }
    });
    const same = decodeReleasePaymentAuthorization({ "payment-signature": "paid", "x-payment": legacy }, [requirement], () => auth!.payload);
    expect(same?.protocol).toBe("v2");
    expect(() => decodeReleasePaymentAuthorization({ "payment-signature": "paid", "x-payment": legacy }, [requirement], () => ({ ...auth!.payload, payload: { authorization: { from: "0x2222222222222222222222222222222222222222" } } } as never))).toThrow(/conflicting_payment_headers/);
    expect(() => decodeReleasePaymentAuthorization({ "x-payment": b64({ x402Version: 7, scheme: "exact", network: "eip155:196", payload: { signature: "0x", authorization: {} } }) }, [requirement])).toThrow(/unsupported_protocol_version/);
    expect(() => decodeReleasePaymentAuthorization({ "x-payment": "not-json" }, [requirement])).toThrow();
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
              canonical_example: { endpoint: "https://target-service.example/path" },
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

  it("recognizes X-PAYMENT before body validation and rejects malformed/conflicting aliases without charge", async () => {
    const fake = gateway();
    const server = await app(fake);
    const validV1 = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "x-payment": "paid", "content-type": "application/json" }, payload: "{" });
    expect(validV1.statusCode).toBe(400);
    expect(validV1.json()).toMatchObject({ error: { code: "VERIFY_REQUEST_INVALID", charge_status: "NOT_CHARGED" } });
    expect(fake.verify).toHaveBeenCalledTimes(1);
    expect(fake.settle).not.toHaveBeenCalled();

    const malformed = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "x-payment": "not-a-payment", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }) });
    expect(malformed.statusCode).toBe(402);
    expect(malformed.json()).toMatchObject({ error: { code: "PAYMENT_AUTHORIZATION_INVALID", charge_status: "NOT_CHARGED", details: { supplied_payment_header: true, reason: "malformed_header" } } });

    const conflict = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "x-payment": "different-paid", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }) });
    expect(conflict.statusCode).toBe(402);
    expect(conflict.json()).toMatchObject({ error: { code: "PAYMENT_AUTHORIZATION_INVALID", charge_status: "NOT_CHARGED", details: { reason: "conflicting_payment_headers" } } });
    expect(fake.settle).not.toHaveBeenCalled();
    await server.close();
  });

  it("recognizes reviewer-style GET payment headers instead of issuing another missing-header challenge", async () => {
    const fake = gateway();
    const server = await app(fake);
    const cases = [
      { name: "legacy X-PAYMENT", headers: { "x-payment": "paid" } },
      { name: "PAYMENT-SIGNATURE", headers: { "payment-signature": "paid" } }
    ];
    for (const item of cases) {
      const response = await server.inject({ method: "GET", url: "/api/v1/verify-release", headers: item.headers });
      expect(response.statusCode, item.name).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: "VERIFY_REQUEST_INVALID",
          charge_status: "NOT_CHARGED",
          details: {
            accepted_input: {
              canonical_example: { endpoint: "https://target-service.example/path" }
            }
          }
        }
      });
    }
    expect(fake.verify).toHaveBeenCalledTimes(2);
    expect(fake.settle).not.toHaveBeenCalled();

    const malformed = await server.inject({ method: "GET", url: "/api/v1/verify-release?endpoint=https%3A%2F%2Fapi.usepreflight.xyz%2Fapi%2Fv1%2Fverify-release", headers: { "x-payment": "not-a-payment" } });
    expect(malformed.statusCode).toBe(402);
    expect(malformed.json()).toMatchObject({ error: { code: "PAYMENT_AUTHORIZATION_INVALID", charge_status: "NOT_CHARGED", details: { supplied_payment_header: true, reason: "malformed_header" } } });
    expect(malformed.json().error.details.reason).not.toBe("missing_header");
    await server.close();
  });

  it("returns a terminal NO-GO deliverable for authorized targets that do not expose x402", async () => {
    const fake = gateway();
    const server = await app(fake, { egress: egress([rawResponse(200), rawResponse(200), rawResponse(404), rawResponse(404)]) });
    const response = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: "https://example.com" }) });
    expect(response.statusCode).toBe(200);
    expect(response.headers["payment-response"]).toBeUndefined();
    expect(response.headers["x-payment-response"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      schema_version: "preflight.terminal-no-go.v1",
      decision: "BLOCK",
      verdict: "NO-GO",
      target: { endpoint: "https://example.com" },
      primary_blocker: { code: "TARGET_X402_MISSING", observed: "Target returned HTTP 200; no valid x402 payment challenge was observed." },
      payment: { authorization_verified: true, settled: false, charge_status: "NOT_CHARGED", refund_required: false },
      retryable: false
    });
    expect(JSON.stringify(response.json())).not.toMatch(/DISCOVERY_INCOMPLETE|stack|PAYMENT-SIGNATURE|X-PAYMENT:/i);
    expect(fake.verify).toHaveBeenCalledTimes(1);
    expect(fake.settle).not.toHaveBeenCalled();
    await server.close();
  });

  it("returns terminal NO-GO for reviewer-style signed GET when target discovery cannot synthesize a manifest", async () => {
    const fake = gateway();
    const server = await app(fake, { egress: egress([rawResponse(404), rawResponse(404), rawResponse(404), rawResponse(404)]) });
    const response = await server.inject({ method: "GET", url: "/api/v1/verify-release?endpoint=https%3A%2F%2Fexample.com", headers: { "x-payment": "paid" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-payment-response"]).toBeUndefined();
    expect(response.json()).toMatchObject({
      schema_version: "preflight.terminal-no-go.v1",
      decision: "BLOCK",
      verdict: "NO-GO",
      primary_blocker: { code: "TARGET_X402_MISSING" },
      payment: { charge_status: "NOT_CHARGED" }
    });
    expect(fake.verify).toHaveBeenCalledTimes(1);
    expect(fake.settle).not.toHaveBeenCalled();
    await server.close();
  });

  it("classifies malformed 402 and temporary discovery failures without charging", async () => {
    const malformedGateway = gateway();
    const malformedServer = await app(malformedGateway, { egress: egress([rawResponse(402, "{}", { "payment-required": "not-json" }), rawResponse(402, "{}", { "payment-required": "not-json" }), rawResponse(404), rawResponse(404)]) });
    const malformed = await malformedServer.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: "https://example.com" }) });
    expect(malformed.statusCode).toBe(200);
    expect(malformed.json()).toMatchObject({ decision: "BLOCK", verdict: "NO-GO", primary_blocker: { code: "TARGET_X402_MALFORMED" }, payment: { charge_status: "NOT_CHARGED" }, retryable: false });
    expect(malformedGateway.settle).not.toHaveBeenCalled();
    await malformedServer.close();

    const timeoutGateway = gateway();
    const timeoutServer = await app(timeoutGateway, { egress: new SafeEgressClient({ resolver, requestOnce: async () => { throw new EgressPolicyError("TIMEOUT", "Target request exceeded total deadline"); } }) });
    const timeout = await timeoutServer.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: JSON.stringify({ endpoint: "https://example.com" }) });
    expect(timeout.statusCode).toBe(200);
    expect(timeout.json()).toMatchObject({ decision: "UNKNOWN", verdict: "NO-GO", primary_blocker: { code: "TARGET_TEMPORARILY_UNAVAILABLE" }, payment: { charge_status: "NOT_CHARGED" }, retryable: true });
    expect(timeoutGateway.settle).not.toHaveBeenCalled();
    await timeoutServer.close();
  });

  it("normalizes GET query targets through the same verify_release input schema", () => {
    const endpoint = manifestFixture.target.endpoint;
    expect(verifyReleaseGetQueryToBody({ endpoint })).toEqual({ endpoint });
    expect(verifyReleaseGetQueryToBody({ "target.endpoint": endpoint })).toEqual({ target: { endpoint } });
    expect(verifyReleaseGetQueryToBody({ agent_id: "2013" })).toEqual({ agent_id: "2013" });
    expect(verifyReleaseRequestV1Schema.parse(verifyReleaseGetQueryToBody({ url: endpoint }))).toMatchObject({ endpoint });
    expect(verifyReleaseRequestV1Schema.parse(verifyReleaseGetQueryToBody({ agent_id: "2013" }))).toMatchObject({ agent_id: "2013" });
    expect(() => verifyReleaseRequestV1Schema.parse(verifyReleaseGetQueryToBody({ endpoint, agent_id: "2013" }))).toThrow(/exactly one/i);
    expect(() => verifyReleaseRequestV1Schema.parse(verifyReleaseGetQueryToBody({ endpoint, url: "https://other.example/service" }))).toThrow(/conflicting/i);
    expect(() => verifyReleaseRequestV1Schema.parse(verifyReleaseGetQueryToBody({ endpoint: "https://not a url" }))).toThrow(/url/i);
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
        canonical_example: { endpoint: "https://target-service.example/path" },
        schema_url: "https://api.usepreflight.xyz/api/v1/contracts/verify-release-request/v1",
        json_schema: { type: "object", properties: { endpoint: { type: "string" } } }
      }
    });
    const contract = await server.inject({ method: "GET", url: "/api/v1/contracts/verify-release-request/v1" });
    expect(contract.statusCode).toBe(200);
    expect(contract.json()).toMatchObject({ canonical_example: { endpoint: "https://target-service.example/path" }, json_schema: { properties: { endpoint: { type: "string" } } } });
    const openapi = JSON.parse(readFileSync(new URL("../docs/openapi.release-gate.v1.json", import.meta.url), "utf8")) as { paths: Record<string, { post?: { requestBody?: { content?: { "application/json"?: { examples?: unknown; schema?: unknown } } } } }> };
    const verifyReleasePath = openapi.paths["/api/v1/verify-release"];
    expect(verifyReleasePath?.post?.requestBody?.content?.["application/json"]?.examples).toMatchObject({ canonical: { value: { endpoint: "https://target-service.example/path" } } });
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
      examples: [{ endpoint: "https://target-service.example/path" }, { agent_id: "5161" }]
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
    expect(invalidToolArgs.json()).toMatchObject({ result: { structuredContent: { paid: true, input: { canonical_example: { endpoint: "https://target-service.example/path" } } } } });
    const unknownTool = await server.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "missing_tool", arguments: {} } } });
    expect(unknownTool.statusCode).toBe(200);
    expect(unknownTool.json()).toMatchObject({ jsonrpc: "2.0", id: 3, error: { code: expect.any(Number), message: expect.stringMatching(/tool|not found|unknown/i) } });
    expect(`${initialize.body}\n${invalidToolArgs.body}\n${unknownTool.body}`).not.toMatch(/REPORT_TOKEN_SECRET|RECEIPT_SIGNING_KEY|access_token|\\.onchainos|DATABASE_URL/i);
    await server.close();
  });
});
