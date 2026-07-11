import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const legacy = [
  ["POST", "/api/v1/check_endpoint"], ["POST", "/api/v1/check_x402"],
  ["POST", "/api/v1/run_preflight"], ["POST", "/api/v1/deep_check"],
  ["POST", "/api/v1/preflight_certified"], ["POST", "/api/v1/watch_endpoint"],
  ["POST", "/api/v1/get_watch_report"], ["POST", "/api/v1/playground_check"],
  ["GET", "/api/v1/health_index"], ["GET", "/badge/example.svg"], ["GET", "/r/pf_example"]
] as const;

describe("Release Gate security shutdown", () => {
  it.each(legacy)("returns typed 410 for %s %s", async (method, url) => {
    const { app } = await buildServer({ NODE_ENV: "test", BUILD_SHA: "abcdef1" });
    try {
      const response = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual({
        schema_version: "preflight.error.v1",
        error: { code: "LEGACY_ROUTE_GONE", message: "This legacy PreFlight surface is no longer available.", category: "DEPENDENCY", retryable: false, charge_status: "NOT_CHARGED" }
      });
    } finally { await app.close(); }
  });

  it("reports only current readiness components", async () => {
    const { app } = await buildServer({ NODE_ENV: "test", BUILD_SHA: "abcdef1" });
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.json()).toEqual({ ok: true, build_sha: "abcdef1", db: "disabled", settlement_listener: "disabled", release_reconciliation: "disabled" });
      expect(health.body).not.toContain("attestation");
      expect(health.body).not.toContain("monitor");
      expect((await app.inject({ method: "GET", url: "/livez" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
    } finally { await app.close(); }
  });

  it("refuses a production boot without immutable provenance", async () => {
    await expect(buildServer({ NODE_ENV: "production" })).rejects.toThrow("immutable BUILD_SHA");
  });
});
