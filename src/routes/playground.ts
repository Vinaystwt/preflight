import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import { buildReport } from "../engine/report.js";
import { defaultServices, preflightInput, validatePreflightInput, type PreflightServices } from "../preflight.js";
import { TargetRejectedError } from "../probes/transport.js";

function hashIp(ip: string): string {
  return createHash("sha256").update(`preflight-playground:${ip}`).digest("hex");
}

export function mountPlayground(app: FastifyInstance, database: Database | null, config: Config, allowTarget: (target: string) => boolean, services: PreflightServices = defaultServices): void {
  app.post("/api/v1/playground_check", async (request, reply) => {
    try {
      const input = await validatePreflightInput(preflightInput.parse(request.body), services);
      if (!database) return reply.code(503).send({ error: { code: "PLAYGROUND_UNAVAILABLE", message: "The free playground is temporarily unavailable. Please try again shortly." } });
      if (!allowTarget(input.target)) return reply.code(429).send({ error: { code: "TARGET_RATE_LIMITED", message: "This endpoint has already been checked too often this hour. Please try another target or come back later." } });
      const reservation = await database.reservePlaygroundCheck(hashIp(request.ip), config.PLAYGROUND_PER_IP_DAILY, config.PLAYGROUND_GLOBAL_DAILY);
      if (reservation !== "ok") {
        const global = reservation === "global_cap";
        return reply.code(429).send({ error: { code: global ? "PLAYGROUND_GLOBAL_DAILY_CAP" : "PLAYGROUND_IP_DAILY_CAP",
          message: global ? "Today's free playground capacity has been used. Please come back tomorrow." : "You've used your 3 free playground checks for today. Please come back tomorrow." } });
      }
      const mcpTarget = input.mcp_url ?? input.target;
      const [transport, mcp, x402] = await Promise.all([
        services.transport(input.target),
        services.mcp(mcpTarget, !input.mcp_url),
        services.x402(input.target, input.expected)
      ]);
      const report = await buildReport({ tool: "playground_check", target: input.target, expected: input.expected, modules: [transport, mcp, x402], database });
      return { ...report, playground: true as const };
    } catch (error) {
      if (error instanceof ZodError || error instanceof TargetRejectedError) {
        request.log.info({ event: "playground_input_rejected", err: error }, "playground input rejected");
        return reply.code(400).send({ error: { code: "TARGET_REJECTED", message: error instanceof Error ? error.message : "invalid playground request" } });
      }
      request.log.error({ event: "playground_failed", err: error }, "playground execution failed");
      return reply.code(500).send({ error: { code: "PLAYGROUND_INTERNAL_ERROR", message: "The playground check failed safely. Please try again." } });
    }
  });
}
