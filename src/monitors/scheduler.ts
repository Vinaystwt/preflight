import type { Config } from "../config.js";
import type { Database, MonitorJob } from "../db/client.js";
import { scoreModules } from "../engine/rubric.js";
import { defaultServices, type PreflightServices } from "../preflight.js";

export interface MonitorSchedulerState {
  enabled: boolean;
  status: "disabled" | "idle" | "running" | "ok" | "error";
  lastError: string | null;
}

interface SchedulerLogger {
  info(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export function startMonitorScheduler(config: Config, database: Database | null, logger: SchedulerLogger, services: PreflightServices = defaultServices): { state: MonitorSchedulerState; stop(): void } {
  const state: MonitorSchedulerState = { enabled: Boolean(database), status: database ? "idle" : "disabled", lastError: null };
  if (!database) return { state, stop() {} };
  let stopped = false;
  let running = false;

  const probe = async (job: MonitorJob): Promise<void> => {
    try {
      await services.validateTarget(job.target);
      const [transport, mcp, x402] = await Promise.all([services.transport(job.target), services.mcp(job.target, true), services.x402(job.target, undefined)]);
      const result = scoreModules(transport, mcp, x402);
      const latency = typeof transport.evidence.median_latency_ms === "number" ? transport.evidence.median_latency_ms : null;
      await database.recordMonitorProbe(job.id, result.verdict === "GO", latency, result.findings.map((finding) => finding.code));
      state.status = "ok";
      state.lastError = null;
      logger.info({ event: "monitor_probe_complete", monitor_id: job.id, target: job.target, verdict: result.verdict, score: result.score, latency_ms: latency,
        finding_codes: result.findings.map((finding) => finding.code) }, "monitor probe completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown monitor probe error";
      await database.recordMonitorProbe(job.id, false, null, ["MONITOR_PROBE_FAILED"]);
      state.status = "error";
      state.lastError = message;
      logger.error({ event: "monitor_probe_failed", monitor_id: job.id, target: job.target, err: error }, "monitor probe failed");
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    state.status = "running";
    try {
      const jobs = await database.claimDueMonitors(config.MONITOR_CONCURRENCY);
      await Promise.all(jobs.map(probe));
      if (!jobs.length) state.status = "idle";
    } catch (error) {
      state.status = "error";
      state.lastError = error instanceof Error ? error.message : "unknown scheduler error";
      logger.error({ event: "monitor_scheduler_error", err: error }, "monitor scheduler tick failed");
    } finally { running = false; }
  };

  void tick();
  const timer = setInterval(() => void tick(), config.MONITOR_SCHEDULER_TICK_MS);
  timer.unref();
  return { state, stop() { stopped = true; clearInterval(timer); } };
}
