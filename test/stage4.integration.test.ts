import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import type { Database } from "../src/db/client.js";
import { startMonitorScheduler } from "../src/monitors/scheduler.js";
import type { PreflightServices } from "../src/preflight.js";
import { mountBadge } from "../src/routes/badge.js";
import { scanMarket } from "../src/scanner.js";
import { runGetWatchReport, runWatchEndpoint } from "../src/services/tools.js";
import type { ProbeResult } from "../src/types.js";

const transport: ProbeResult = { findings: [], evidence: { median_latency_ms: 12 } };
const mcp: ProbeResult = { applicable: false, findings: [{ code: "SURFACE_ROUTE_FORM", severity: "info", evidence: "route", fix: "none" }], evidence: {} };
const x402: ProbeResult = { findings: [{ code: "SURFACE_X402_ROUTE_FORM", severity: "info", evidence: "route", fix: "none" }], evidence: {} };
const services: PreflightServices = { validateTarget: async () => undefined, transport: async () => transport, mcp: async () => mcp, x402: async () => x402 };

describe("Stage 4", () => {
  it("registers a watch and returns history in immutable envelopes", async () => {
    const database = {
      ensureMonitor: vi.fn(async () => "mon_1"),
      persist: vi.fn(async () => undefined),
      getWatchReportData: vi.fn(async () => ({ monitor_id: "mon_1", status: "active", expires_at: new Date("2026-07-17T00:00:00Z"), uptime_pct: 100,
        latency_series: [{ ts: "2026-07-10T00:00:00.000Z", latency_ms: 12 }], finding_history: [] }))
    } as unknown as Database;
    const config = loadConfig({ NODE_ENV: "test", MONITOR_INTERVAL_S: "1" });
    const registered = await runWatchEndpoint({ target: "https://golden.example/run" }, database, config, services);
    const history = await runGetWatchReport({ target: "https://golden.example/run" }, database, services);
    expect(registered).toMatchObject({ tool: "watch_endpoint", verdict: "GO", score: 100 });
    expect(history).toMatchObject({ tool: "get_watch_report", verdict: "GO", score: 100 });
    expect(history.findings[0]?.code).toBe("WATCH_REPORT");
  });

  it("claims and fires a compressed-interval monitor without a paid call", async () => {
    const recordMonitorProbe = vi.fn(async () => undefined);
    const claimDueMonitors = vi.fn().mockResolvedValueOnce([{ id: "mon_1", target: "https://golden.example/run", interval_s: 1, expires_at: new Date(Date.now() + 60_000) }]).mockResolvedValue([]);
    const database = { claimDueMonitors, recordMonitorProbe } as unknown as Database;
    const config = loadConfig({ NODE_ENV: "test", MONITOR_SCHEDULER_TICK_MS: "10", MONITOR_CONCURRENCY: "1" });
    const scheduler = startMonitorScheduler(config, database, { info: vi.fn(), error: vi.fn() }, services);
    await vi.waitFor(() => expect(recordMonitorProbe).toHaveBeenCalledWith("mon_1", true, 12, ["SURFACE_ROUTE_FORM", "SURFACE_X402_ROUTE_FORM"]));
    scheduler.stop();
  });

  it("renders a five-minute cached GO badge and hides non-GO targets", async () => {
    const app = Fastify();
    const getBadgeData = vi.fn(async (targetId: string) => targetId === "target_GO1" ? { target_id: targetId, report_id: "pf_latest", verdict: "GO" as const, verified_at: new Date("2026-07-10T00:00:00Z"), badge_eligible: true } : null);
    mountBadge(app, { getBadgeData } as unknown as Database, loadConfig());
    const badge = await app.inject({ method: "GET", url: "/badge/target_GO1.svg" });
    expect(badge.statusCode).toBe(200);
    expect(badge.headers["cache-control"]).toBe("public, max-age=300");
    expect(badge.body).toContain("PREFLIGHT CERTIFIED");
    expect(badge.body).toContain("/r/pf_latest");
    expect((await app.inject({ method: "GET", url: "/badge/target_BAD.svg" })).statusCode).toBe(404);
    await app.close();
  });

  it("scanner reports aggregates and never names failing targets", async () => {
    const bad = "https://failing-secret.example/run";
    const scanServices: PreflightServices = { ...services, x402: async (target) => target === bad
      ? { findings: [{ code: "X402_MISSING", severity: "high", evidence: "no 402", fix: "add x402" }], evidence: {} }
      : x402 };
    const result = await scanMarket(["https://golden.example/run", bad], scanServices, 0);
    expect(result).toEqual({ scanned: 2, pct_go: 50, top_finding_codes: [{ code: "X402_MISSING", count: 1 }], median_latency_ms: 12, go_targets: ["https://golden.example/run"] });
    expect(JSON.stringify(result)).not.toContain(bad);
  });
});
