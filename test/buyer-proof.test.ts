import Fastify from "fastify";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import { loadConfig } from "../src/config.js";
import { createBuyerProofClient } from "../src/payments/buyer.js";
import { evaluateCriteria } from "../src/release/criteria.js";
import type { ReleaseRepository } from "../src/release/repository.js";
import { mountReleaseGate } from "../src/routes/release-gate.js";
import { manifestFixture } from "./helpers/manifest.js";

const buyerKey = `0x${createHash("sha256").update("preflight-test-buyer-key").digest("hex")}` as `0x${string}`;
const payTo = "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2";
const requirement = (amount = "100000") => ({ scheme: "exact", network: "eip155:196", amount, asset: manifestFixture.payment.asset, payTo, maxTimeoutSeconds: 300, extra: { name: "USD₮0", version: "1" } });
const header = (amount = "100000") => Buffer.from(JSON.stringify({ x402Version: 2, accepts: [requirement(amount)] })).toString("base64");
const receipt = encodePaymentResponseHeader({ success: true, status: "success", transaction: "0xsettled", network: "eip155:196", payer: "0x1111111111111111111111111111111111111111" } as never);

function config(overrides: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: "test", BUILD_SHA: "abcdef1", OPERATOR_WALLET: payTo, REPORT_TOKEN_SECRET: "test-secret-that-is-longer-than-thirty-two-bytes", BUYER_WALLET_KEY: buyerKey, ...overrides });
}
function repository(reserve: ReleaseRepository["reserveBuyerProofSpend"] = vi.fn(async () => ({ ok: true, id: "bps_1", amountUsdt: "0.100000" } as const))) {
  return {
    reserveBuyerProofSpend: reserve,
    updateBuyerProofSpend: vi.fn(async () => undefined)
  } as unknown as ReleaseRepository;
}

describe("buyer proof guardrails", () => {
  it("records authorization, pays, settles, delivers, and proves duplicate replay rejection", async () => {
    const events: string[] = []; const signed: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? (_input instanceof Request ? _input.headers : undefined));
      const signature = headers.get("payment-signature");
      if (!signature) return new Response(JSON.stringify({ error: "pay" }), { status: 402, headers: { "payment-required": header() } });
      signed.push(signature);
      if (headers.get("idempotency-key")?.includes("duplicate")) return new Response(JSON.stringify({ error: { code: "PAYMENT_REPLAY" } }), { status: 409 });
      return new Response(JSON.stringify({ schema_version: "target.result.v1", ok: true }), { status: 200, headers: { "payment-response": receipt } });
    });
    const buyer = createBuyerProofClient(config(), repository(), fetcher as typeof fetch)!;
    const artifact = await buyer.prove({ runId: "pfr_test", target: manifestFixture.target.endpoint, body: { ok: true }, audit: async (event) => { events.push(event); } });
    expect(artifact.normalized).toMatchObject({ authorized: true, status: "DELIVERED", delivery_status: 200, duplicate_replay_status: 409, settlement_reference: "0xsettled" });
    expect(events).toEqual(["BUYER_AUTHORIZED", "BUYER_PAID", "BUYER_SETTLED", "BUYER_REPLAYED", "BUYER_DELIVERED"]);
    expect(signed).toHaveLength(2);
  });

  it("aborts before signing if challenge terms change after authorization", async () => {
    let challengeCount = 0; let signed = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? (_input instanceof Request ? _input.headers : undefined));
      if (headers.get("payment-signature")) signed = true;
      challengeCount += 1;
      return new Response(JSON.stringify({ error: "pay" }), { status: 402, headers: { "payment-required": header(challengeCount === 1 ? "100000" : "200000") } });
    });
    const events: string[] = [];
    const buyer = createBuyerProofClient(config(), repository(), fetcher as typeof fetch)!;
    const artifact = await buyer.prove({ runId: "pfr_terms", target: manifestFixture.target.endpoint, body: { ok: true }, audit: async (event) => { events.push(event); } });
    expect(artifact.normalized).toMatchObject({ authorized: true, status: "BUYER_TERMS_CHANGED" });
    expect(events).toContain("BUYER_TERMS_CHANGED");
    expect(signed).toBe(false);
  });

  it("enforces caps before any outbound payment signature is generated", async () => {
    let signed = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers ?? (_input instanceof Request ? _input.headers : undefined)).get("payment-signature")) signed = true;
      return new Response(JSON.stringify({ error: "pay" }), { status: 402, headers: { "payment-required": header() } });
    });
    const reserve = vi.fn(async () => ({ ok: false, reason: "BUYER_CAP_EXCEEDED", amountUsdt: "0.100000", targetSpent: "0.000000", globalSpent: "0.000000" } as const));
    const buyer = createBuyerProofClient(config({ BUYER_TARGET_DAILY_CAP_USDT: "0.01" }), repository(reserve as never), fetcher as typeof fetch)!;
    const artifact = await buyer.prove({ runId: "pfr_cap", target: manifestFixture.target.endpoint, body: { ok: true }, audit: async () => undefined });
    expect(artifact.normalized).toMatchObject({ authorized: true, status: "BUYER_CAP_EXCEEDED" });
    expect(signed).toBe(false);
  });

  it("keeps unauthorised buyer proof criteria UNKNOWN and non-mandatory", () => {
    const criteria = evaluateCriteria(manifestFixture, []);
    const buyerCriteria = criteria.filter((item) => item.group === "buyer_proof");
    expect(buyerCriteria.map((item) => [item.code, item.state, item.mandatory])).toEqual([
      ["BUYER_SETTLEMENT", "UNKNOWN", false],
      ["BUYER_DELIVERY", "UNKNOWN", false]
    ]);
  });

  it("rejects authorize_buyer_proof without owner_attestation before payment", async () => {
    const app = Fastify();
    mountReleaseGate(app, config(), null, { gateway: null, buyerProof: null });
    const response = await app.inject({ method: "POST", url: "/api/v1/verify-release", headers: { "idempotency-key": "buyer-owner-test-0001" }, payload: { schema_version: "preflight.verify-release-request.v1", endpoint: manifestFixture.target.endpoint, authorize_buyer_proof: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BUYER_OWNER_ATTESTATION_REQUIRED", charge_status: "NOT_CHARGED" } });
    await app.close();
  });
});
