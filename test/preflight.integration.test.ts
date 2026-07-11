import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { runPreflight, type PreflightServices } from "../src/preflight.js";
import { evaluateX402Challenge, type ExpectedPayment } from "../src/probes/x402.js";
import { evaluateMcpToolsPayload } from "../src/probes/mcp.js";
import { buildServer } from "../src/server.js";
import type { ProbeResult } from "../src/types.js";
import { deepCheckInput, runCheckEndpoint, runCheckX402, runDeepCheck, type Stage2Services } from "../src/services/tools.js";

type Fixture = { status: number; challenge: Record<string, unknown> | null; transport_finding?: string; mcp_payload?: Record<string, unknown>; mcp_timeout?: boolean };
const cleanTransport: ProbeResult = { findings: [], evidence: { median_latency_ms: 10, tls: { authorized: true } } };
const routeFormMcp: ProbeResult = { applicable: false, findings: [{ code: "SURFACE_ROUTE_FORM", severity: "info", evidence: "MCP initialize unsupported", fix: "No action required for route form." }], evidence: { surface_form: "route" } };

async function fixture(name: string): Promise<Fixture> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;
}

function encode(value: Record<string, unknown> | null): string | undefined {
  return value ? Buffer.from(JSON.stringify(value)).toString("base64url") : undefined;
}

function servicesFor(value: Fixture): PreflightServices {
  return {
    validateTarget: async () => undefined,
    transport: async () => value.transport_finding
      ? { findings: [{ code: value.transport_finding, severity: "high", evidence: "fixture transport failure", fix: "fix fixture transport" }], evidence: { tls: { authorized: false } } }
      : cleanTransport,
    mcp: async (_target, routeFormOnFailure) => {
      if (value.mcp_timeout) return routeFormOnFailure ? routeFormMcp : { findings: [{ code: "MCP_HANDSHAKE_TIMEOUT", severity: "high", evidence: "fixture timeout", fix: "restore MCP handshake" }], evidence: { timeout: true } };
      if (value.mcp_payload) return { findings: [{ code: "SURFACE_MCP_FORM", severity: "info", evidence: "MCP fixture", fix: "No action required." }, ...evaluateMcpToolsPayload(value.mcp_payload)], evidence: { surface_form: "mcp" } };
      return routeFormMcp;
    },
    x402: async (_target: string, expected: ExpectedPayment) => evaluateX402Challenge(value.status, encode(value.challenge), expected)
  };
}

describe("full conformance fixtures", () => {
  const cases = [
    { name: "golden", expected: undefined, verdict: "GO", codes: ["SURFACE_ROUTE_FORM", "SURFACE_X402_ROUTE_FORM"] },
    { name: "no-402", expected: undefined, verdict: "HOLD", codes: ["SURFACE_ROUTE_FORM", "X402_MISSING"] },
    { name: "wrong-amount", expected: { amount: "100000" }, verdict: "HOLD", codes: ["SURFACE_ROUTE_FORM", "SURFACE_X402_ROUTE_FORM", "X402_AMOUNT_MISMATCH"] },
    { name: "bad-payto", expected: { payTo: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2" }, verdict: "HOLD", codes: ["SURFACE_ROUTE_FORM", "SURFACE_X402_ROUTE_FORM", "X402_PAYTO_MISMATCH"] },
    { name: "missing-field", expected: undefined, verdict: "HOLD", codes: ["SURFACE_ROUTE_FORM", "X402_MALFORMED"] },
    { name: "bad-tls", expected: undefined, verdict: "NO-GO", codes: ["TLS_INVALID", "SURFACE_ROUTE_FORM", "SURFACE_X402_ROUTE_FORM"] },
    { name: "malformed-tool-schema", expected: undefined, mcpUrl: true, verdict: "HOLD", codes: ["SURFACE_MCP_FORM", "SCHEMA_INVALID_TOOL", "SURFACE_X402_ROUTE_FORM"] },
    { name: "handshake-timeout", expected: undefined, mcpUrl: true, verdict: "HOLD", codes: ["MCP_HANDSHAKE_TIMEOUT", "SURFACE_X402_ROUTE_FORM"] }
  ] as const;

  for (const value of cases) {
    it(`${value.name} returns the exact verdict and finding codes`, async () => {
      const data = await fixture(value.name);
      const report = await runPreflight({ target: `https://${value.name}.example/run`, mcp_url: "mcpUrl" in value ? `https://${value.name}.example/mcp` : undefined, expected: value.expected }, null, servicesFor(data));
      expect(report.verdict).toBe(value.verdict);
      expect(report.findings.map((finding) => finding.code)).toEqual(value.codes);
    });
  }
});

describe("PreFlight dogfood", () => {
  it("advertises only the Release Gate discovery tool", async () => {
    const { app } = await buildServer({ NODE_ENV: "test", PUBLIC_DOMAIN: "api.usepreflight.xyz" });
    try {
      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" };
      const listed = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
      const listPayload = listed.json() as Record<string, unknown>;
      expect(evaluateMcpToolsPayload(listPayload)).toEqual([]);
      const toolNames = ((listPayload.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
      expect(toolNames).toEqual(["preflight_service_info"]);
      const called = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "preflight_service_info", arguments: {} } } });
      const pointer = (called.json() as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
      expect(pointer).toMatchObject({ service: "verify_release", status: "contract_frozen", price_usdt: "0.10" });

      const golden = await fixture("golden");
      const services: PreflightServices = {
        validateTarget: async () => undefined,
        transport: async () => cleanTransport,
        x402: async (_target, expected) => evaluateX402Challenge(golden.status, encode(golden.challenge), expected),
        mcp: async () => ({ findings: [{ code: "SURFACE_MCP_FORM", severity: "info", evidence: "PreFlight tools/list is valid", fix: "No action required." }], evidence: { surface_form: "mcp" } })
      };
      const report = await runPreflight({ target: "https://api.usepreflight.xyz/api/v1/run_preflight", mcp_url: "https://api.usepreflight.xyz/mcp" }, null, services);
      expect(report.verdict).toBe("GO");
      expect(report.score).toBe(100);
    } finally { await app.close(); }
  });

  it("returns typed 410 before parsing any legacy route input", async () => {
    const { app } = await buildServer({ NODE_ENV: "test" });
    try {
      for (const target of ["http://example.com/run", "https://127.0.0.1/run"]) {
        const response = await app.inject({ method: "POST", url: "/api/v1/run_preflight", payload: { target } });
        expect(response.statusCode).toBe(410);
        expect(response.json()).toMatchObject({ error: { code: "LEGACY_ROUTE_GONE", charge_status: "NOT_CHARGED" } });
      }
    } finally { await app.close(); }
  });
});

function databaseStub(overrides: Partial<Database> = {}): Database {
  return {
    persist: vi.fn(async () => undefined),
    reserveSpend: vi.fn(async () => "spend_1"),
    completeSpend: vi.fn(async () => undefined),
    recordCall: vi.fn(async () => "call_1"),
    findReportSince: vi.fn(async () => null),
    ...overrides
  } as unknown as Database;
}

describe("Stage 2 paid tool behavior", () => {
  it("returns exact standalone-tool envelopes", async () => {
    const golden = await fixture("golden");
    const services = servicesFor(golden);
    const endpoint = await runCheckEndpoint({ target: "https://golden.example/run" }, null, services);
    const x402 = await runCheckX402({ target: "https://golden.example/run" }, null, services);
    expect({ tool: endpoint.tool, verdict: endpoint.verdict, score: endpoint.score }).toEqual({ tool: "check_endpoint", verdict: "GO", score: 100 });
    expect({ tool: x402.tool, verdict: x402.verdict, score: x402.score }).toEqual({ tool: "check_x402", verdict: "GO", score: 100 });
  });

  it("rejects missing owner attestation before any deep call", () => {
    expect(() => deepCheckInput.parse({ target: "https://golden.example/run" })).toThrow();
  });

  it("returns DEEP_CHECK_CAP_EXCEEDED and never pays when the persisted cap rejects", async () => {
    const golden = await fixture("golden");
    const paidCall = vi.fn();
    const services: Stage2Services = { ...servicesFor(golden), paidCall };
    const database = databaseStub({ reserveSpend: vi.fn(async () => null) });
    const report = await runDeepCheck({ target: "https://golden.example/run", owner_attestation: true }, database, loadConfig(), services);
    expect(report.findings.map((finding) => finding.code)).toContain("DEEP_CHECK_CAP_EXCEEDED");
    expect(paidCall).not.toHaveBeenCalled();
  });

  it("records one successful outbound paid call with owner attestation", async () => {
    const golden = await fixture("golden");
    const paidCall = vi.fn(async () => ({ ok: true, status: 200, body: { ok: true }, parseable: true, payer: "0x1111111111111111111111111111111111111111", latencyMs: 12,
      receipt: { success: true, transaction: "0xtest", status: "success", network: "eip155:196" } }));
    const database = databaseStub();
    const services: Stage2Services = { ...servicesFor(golden), paidCall };
    const config = loadConfig({});
    const report = await runDeepCheck({ target: "https://golden.example/run", owner_attestation: true }, database, config, services);
    expect(report.verdict).toBe("GO");
    expect(paidCall).toHaveBeenCalledTimes(1);
    expect(database.recordCall).toHaveBeenCalledWith(expect.objectContaining({ direction: "out", priceUsdt: "0.1", ownerAttestation: true, settleRef: "0xtest" }));
  });

  it("returns typed 410 for the retired deep-check route", async () => {
    const { app } = await buildServer({ NODE_ENV: "test" });
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/deep_check", payload: { target: "https://example.com/run" } });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({ error: { code: "LEGACY_ROUTE_GONE" } });
    } finally { await app.close(); }
  });
});
