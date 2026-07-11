import { z } from "zod";
import type { Database } from "./db/client.js";
import { buildReport } from "./engine/report.js";
import { probeMcp } from "./probes/mcp.js";
import { expectedPayment, probeX402 } from "./probes/x402.js";
import { assertPublicHttps, probeTransport } from "./probes/transport.js";
import type { ProbeResult } from "./types.js";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "target must use https");
export const preflightInput = z.object({ target: httpsUrl, mcp_url: httpsUrl.optional(), expected: expectedPayment });
export type PreflightInput = z.infer<typeof preflightInput>;

export interface PreflightServices {
  validateTarget(target: string): Promise<unknown>;
  transport(target: string): Promise<ProbeResult>;
  mcp(target: string, routeFormOnFailure: boolean): Promise<ProbeResult>;
  x402(target: string, expected: PreflightInput["expected"]): Promise<ProbeResult>;
}

export const defaultServices: PreflightServices = {
  validateTarget: assertPublicHttps,
  transport: probeTransport,
  mcp: probeMcp,
  x402: probeX402
};

export async function validatePreflightInput(input: unknown, services: Pick<PreflightServices, "validateTarget"> = defaultServices): Promise<PreflightInput> {
  const validated = preflightInput.parse(input);
  await services.validateTarget(validated.target);
  if (validated.mcp_url) await services.validateTarget(validated.mcp_url);
  return validated;
}

export async function runPreflight(input: PreflightInput, database: Database | null, services: PreflightServices = defaultServices) {
  const validated = await validatePreflightInput(input, services);
  const mcpTarget = validated.mcp_url ?? validated.target;
  const [transport, x402, mcp] = await Promise.all([
    services.transport(validated.target),
    services.x402(validated.target, validated.expected),
    services.mcp(mcpTarget, !validated.mcp_url)
  ]);
  return buildReport({ tool: "run_preflight", target: validated.target, expected: validated.expected, modules: [transport, mcp, x402], database });
}
