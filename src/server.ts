import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { createDatabase } from "./db/client.js";
import { loadConfig } from "./config.js";
import { mountMcp } from "./mcp/server.js";
import { mountSellerPayments, PAID_ENDPOINTS, type PaidTool } from "./payments/seller.js";
import { preflightInput, runPreflight, validatePreflightInput, type PreflightInput } from "./preflight.js";
import { TargetRejectedError } from "./probes/transport.js";
import { mountReports } from "./routes/reports.js";
import { deepCheckInput, defaultStage2Services, runCertified, runCheckEndpoint, runCheckX402, runDeepCheck, runGetWatchReport, runWatchEndpoint, type DeepCheckInput } from "./services/tools.js";
import { mountBadge } from "./routes/badge.js";
import { mountPublicCors } from "./routes/cors.js";
import { mountHealthIndex } from "./routes/health-index.js";
import { mountPlayground } from "./routes/playground.js";
import { mountReleaseGate } from "./routes/release-gate.js";

function createTargetLimiter(max: number) {
  const entries = new Map<string, number[]>();
  return (target: string): boolean => {
    const now = Date.now();
    const active = (entries.get(target) ?? []).filter((time) => time > now - 3_600_000);
    if (active.length >= max) return false;
    active.push(now);
    entries.set(target, active);
    return true;
  };
}

const LEGACY_GONE = {
  schema_version: "preflight.error.v1",
  error: { code: "LEGACY_ROUTE_GONE", message: "This legacy PreFlight surface is no longer available.", category: "DEPENDENCY", retryable: false, charge_status: "NOT_CHARGED" }
} as const;

function mountLegacyGone(app: FastifyInstance): void {
  for (const path of Object.values(PAID_ENDPOINTS)) app.post(path, async (_request, reply) => reply.code(410).send(LEGACY_GONE));
  app.post("/api/v1/playground_check", async (_request, reply) => reply.code(410).send(LEGACY_GONE));
  app.get("/api/v1/health_index", async (_request, reply) => reply.code(410).send(LEGACY_GONE));
  app.get("/badge/*", async (_request, reply) => reply.code(410).send(LEGACY_GONE));
  app.get("/r/*", async (_request, reply) => reply.code(410).send(LEGACY_GONE));
}

export async function buildServer(source: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(source);
  const app = Fastify({ trustProxy: true, logger: { level: source.LOG_LEVEL ?? "info" } });
  mountPublicCors(app);
  const database = createDatabase(config);
  const allowTarget = createTargetLimiter(config.TARGET_RATE_LIMIT_PER_HOUR);
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW });
  const payments = mountSellerPayments(app, config, database, config.LEGACY_ROUTES_ENABLED);

  if (config.LEGACY_ROUTES_ENABLED) {
    for (const [tool, path] of Object.entries(PAID_ENDPOINTS) as Array<[PaidTool, string]>) {
      app.post(path, async (request, reply) => {
        try {
          const input = tool === "deep_check" || tool === "preflight_certified" ? deepCheckInput.parse(request.body) : preflightInput.parse(request.body);
          await validatePreflightInput(input);
          if (!payments.enabled) return reply.code(503).send({ error: { code: "PAYMENTS_UNAVAILABLE", message: "x402 seller configuration missing" } });
          if (!allowTarget(input.target)) return reply.code(429).send({ error: { code: "TARGET_RATE_LIMITED", message: "target exceeds 10 checks per hour" } });
          const audit = (entry: import("./services/tools.js").OutboundPaymentAudit) => request.log.info(entry, "x402 outbound payment audit");
          if (tool === "check_endpoint") return await runCheckEndpoint(input as PreflightInput, database);
          if (tool === "check_x402") return await runCheckX402(input as PreflightInput, database);
          if (tool === "run_preflight") return await runPreflight(input as PreflightInput, database);
          if (tool === "deep_check") return await runDeepCheck(input as DeepCheckInput, database, config, defaultStage2Services, { audit });
          if (tool === "preflight_certified") return await runCertified(input as DeepCheckInput, database, config, defaultStage2Services, audit);
          if (tool === "watch_endpoint") return await runWatchEndpoint(input as PreflightInput, database, config);
          return await runGetWatchReport(input as PreflightInput, database);
        } catch (error) {
          if (error instanceof ZodError || error instanceof TargetRejectedError) return reply.code(400).send({ error: { code: "TARGET_REJECTED", message: error instanceof Error ? error.message : "invalid request" } });
          request.log.error({ event: "legacy_preflight_failed", tool, err: error }, "legacy preflight execution failed");
          return reply.code(500).send({ error: { code: "PREFLIGHT_INTERNAL_ERROR", message: "preflight execution failed" } });
        }
      });
    }
    mountPlayground(app, database, config, allowTarget);
    mountReports(app, database);
    mountBadge(app, database, config);
    mountHealthIndex(app, database);
  } else mountLegacyGone(app);
  const releaseGate = mountReleaseGate(app, config, database);

  const health = async () => {
    let db = "disabled";
    if (database) { try { await database.health(); db = "ok"; } catch { db = "down"; } }
    return { ok: db !== "down", build_sha: config.BUILD_SHA, db, settlement_listener: payments.listenerStatus, release_reconciliation: releaseGate.reconciliation };
  };
  app.get("/health", health);
  app.get("/livez", async () => ({ ok: true, build_sha: config.BUILD_SHA }));
  app.get("/readyz", async (_request, reply) => {
    const status = await health();
    const ready = status.db === "ok" && status.settlement_listener !== "disabled" && status.settlement_listener !== "error";
    return reply.code(ready ? 200 : 503).send({ ...status, ok: ready });
  });
  mountMcp(app, config);
  app.addHook("onClose", async () => { releaseGate.stop(); if (database) await database.close(); });
  return { app, config, database };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, config } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}
