import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { mountMcp } from "../src/mcp/server.js";
import type { PreflightServices } from "../src/preflight.js";
import { mountPublicCors } from "../src/routes/cors.js";
import { mountHealthIndex } from "../src/routes/health-index.js";
import { mountPlayground } from "../src/routes/playground.js";

const clean = { findings: [], evidence: { median_latency_ms: 12 } };
const routeMcp = { applicable: false, findings: [{ code: "SURFACE_ROUTE_FORM", severity: "info" as const, evidence: "route", fix: "none" }], evidence: {} };
const routeX402 = { findings: [{ code: "SURFACE_X402_ROUTE_FORM", severity: "info" as const, evidence: "route", fix: "none" }], evidence: {} };

function services(): PreflightServices {
  return { validateTarget: vi.fn(async () => undefined), transport: vi.fn(async () => clean), mcp: vi.fn(async () => routeMcp), x402: vi.fn(async () => routeX402) };
}

describe("public routes", () => {
  it("runs only the three free playground modules and returns the envelope flag", async () => {
    const app = Fastify();
    const database = { reservePlaygroundCheck: vi.fn(async () => "ok"), persist: vi.fn(async () => undefined) } as unknown as Database;
    const probes = services();
    mountPlayground(app, database, loadConfig({ NODE_ENV: "test" }), () => true, probes);
    const response = await app.inject({ method: "POST", url: "/api/v1/playground_check", payload: { target: "https://golden.example/run" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ tool: "playground_check", verdict: "GO", score: 100, playground: true, attestation_tx: null });
    expect(probes.transport).toHaveBeenCalledTimes(1);
    expect(probes.mcp).toHaveBeenCalledTimes(1);
    expect(probes.x402).toHaveBeenCalledTimes(1);
    expect(database.reservePlaygroundCheck).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), 3, 200);
    await app.close();
  });

  it("returns a friendly typed 429 when the IP cap is reached", async () => {
    const app = Fastify();
    const database = { reservePlaygroundCheck: vi.fn(async () => "ip_cap"), persist: vi.fn() } as unknown as Database;
    const probes = services();
    mountPlayground(app, database, loadConfig({ NODE_ENV: "test" }), () => true, probes);
    const response = await app.inject({ method: "POST", url: "/api/v1/playground_check", payload: { target: "https://golden.example/run" } });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { code: "PLAYGROUND_IP_DAILY_CAP", message: "You've used your 3 free playground checks for today. Please come back tomorrow." } });
    expect(probes.transport).not.toHaveBeenCalled();
    await app.close();
  });

  it("scopes CORS to approved origins and public routes", async () => {
    const app = Fastify();
    mountPublicCors(app, ["https://preflight.vercel.app", "https://preflight-*-vinaystwts-projects.vercel.app"]);
    app.get("/health", async () => ({ ok: true }));
    app.get("/private", async () => ({ ok: true }));
    const allowed = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://usepreflight.xyz" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://usepreflight.xyz");
    const disallowed = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(disallowed.headers).not.toHaveProperty("access-control-allow-origin");
    const privateRoute = await app.inject({ method: "GET", url: "/private", headers: { origin: "https://usepreflight.xyz" } });
    expect(privateRoute.headers).not.toHaveProperty("access-control-allow-origin");
    const preflight = await app.inject({ method: "OPTIONS", url: "/api/v1/playground_check", headers: { origin: "https://www.usepreflight.xyz" } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("https://www.usepreflight.xyz");
    expect(preflight.headers["access-control-allow-headers"]).toBe("Authorization, Content-Type, X-Client-Request-Id");
    const releasePreflight = await app.inject({ method: "OPTIONS", url: "/api/v1/reports/pf_test", headers: { origin: "https://preflight.vercel.app" } });
    expect(releasePreflight.statusCode).toBe(204);
    expect(releasePreflight.headers["access-control-allow-origin"]).toBe("https://preflight.vercel.app");
    const receiptPreflight = await app.inject({ method: "OPTIONS", url: "/api/v1/receipts/rcpt_test", headers: { origin: "https://preflight.vercel.app" } });
    expect(receiptPreflight.headers["access-control-allow-origin"]).toBe("https://preflight.vercel.app");
    const badgePreflight = await app.inject({ method: "OPTIONS", url: "/api/v1/badge/pfr_test.svg", headers: { origin: "https://preflight.vercel.app" } });
    expect(badgePreflight.headers["access-control-allow-origin"]).toBe("https://preflight.vercel.app");
    const galleryPreflight = await app.inject({ method: "OPTIONS", url: "/api/v1/gallery", headers: { origin: "https://preflight.vercel.app" } });
    expect(galleryPreflight.headers["access-control-allow-origin"]).toBe("https://preflight.vercel.app");
    const previewPreflight = await app.inject({ method: "OPTIONS", url: "/api/v1/discover", headers: { origin: "https://preflight-feature-vinaystwts-projects.vercel.app" } });
    expect(previewPreflight.statusCode).toBe(204);
    expect(previewPreflight.headers["access-control-allow-origin"]).toBe("https://preflight-feature-vinaystwts-projects.vercel.app");
    const unconfiguredVercel = await app.inject({ method: "OPTIONS", url: "/api/v1/reports/pf_test", headers: { origin: "https://untrusted.vercel.app" } });
    expect(unconfiguredVercel.headers).not.toHaveProperty("access-control-allow-origin");
    await app.close();
  });

  it("serves the latest cached Health Index snapshot", async () => {
    const app = Fastify();
    const snapshot = { scanned: 3, pct_go: 66.67, top_finding_codes: [{ code: "X402_MISSING", count: 1 }], median_latency_ms: 42,
      go_targets: ["https://one.example/run", "https://two.example/run"], generated_at: "2026-07-11T00:00:00.000Z" };
    mountHealthIndex(app, { getLatestHealthIndex: vi.fn(async () => snapshot) } as unknown as Database);
    const response = await app.inject({ method: "GET", url: "/api/v1/health_index" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=600");
    expect(response.json()).toEqual(snapshot);
    await app.close();
  });

  it("returns an MCP paid pointer for unpaid verify_release calls", async () => {
    const app = Fastify();
    mountMcp(app, loadConfig({ NODE_ENV: "test", PUBLIC_DOMAIN: "api.usepreflight.xyz", MCP_TOOL_ENABLED: "true" }));
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_release", arguments: { schema_version: "preflight.verify-release-request.v1", endpoint: "https://example.com/api" } } }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: { structuredContent: { paid: true, price_usdt: "0.10", endpoint: "POST https://api.usepreflight.xyz/api/v1/verify-release" } } });
    await app.close();
  });
});
