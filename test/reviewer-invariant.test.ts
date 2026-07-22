import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import type { ReleasePaymentGateway } from "../src/payments/release-gateway.js";
import { mountReleaseGate } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const requirement = { scheme: "exact", network: "eip155:196", amount: "100000", asset: manifestFixture.payment.asset, payTo: manifestFixture.payment.pay_to, maxTimeoutSeconds: 300 };
const challenge = { x402Version: 2, accepts: [requirement] };
const paymentPayload = { x402Version: 2, accepted: requirement, payload: { authorization: { from: "0x1111111111111111111111111111111111111111" } } };

function gateway(): ReleasePaymentGateway {
  return {
    requirements: vi.fn(async () => [requirement] as never),
    challenge: vi.fn(async () => Buffer.from(JSON.stringify(challenge)).toString("base64")),
    decode: vi.fn((signature) => { if (signature !== "paid") throw new Error("invalid payment"); return paymentPayload as never; }),
    match: vi.fn(() => requirement as never),
    verify: vi.fn(async () => ({ valid: true, payer: paymentPayload.payload.authorization.from })),
    settle: vi.fn(),
    settlementStatus: vi.fn(),
    responseHeader: vi.fn()
  };
}

async function app() {
  const fastify = Fastify();
  const config = loadConfig({
    NODE_ENV: "test",
    BUILD_SHA: "abcdef1",
    OPERATOR_WALLET: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2",
    REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes",
    COHORT_ENABLED: "false"
  });
  mountReleaseGate(fastify, config, { sql: (() => undefined) } as unknown as Database, { gateway: gateway(), buyerProof: null });
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
    const server = await app();
    const malformed = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: "{" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "VERIFY_REQUEST_INVALID", charge_status: "NOT_CHARGED" } });

    const invalid = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "application/json" }, payload: "{}" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "VERIFY_REQUEST_INVALID", charge_status: "NOT_CHARGED" } });

    const wrongContentType = await server.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "payment-signature": "paid", "content-type": "text/plain" }, payload: JSON.stringify({ endpoint: manifestFixture.target.endpoint }) });
    expect(wrongContentType.statusCode).toBe(400);
    expect(wrongContentType.json()).toMatchObject({ error: { code: "VERIFY_REQUEST_INVALID", charge_status: "NOT_CHARGED" } });
    await server.close();
  });
});
