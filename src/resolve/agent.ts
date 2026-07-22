import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentResolutionV1 } from "../contracts/release-gate.js";

const execFileAsync = promisify(execFile);

type Confidence = "observed" | "inferred" | "unknown";
const observed = (value: unknown) => ({ value: value === undefined ? null : value as string | number | boolean | null, source: "OKX OnchainOS CLI", confidence: (value === undefined || value === null ? "unknown" : "observed") as Confidence });

export class AgentResolutionUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "AgentResolutionUnavailable"; }
}

export interface AgentResolver {
  resolve(agentId: string): Promise<AgentResolutionV1>;
}

/**
 * The listing API used by the OnchainOS CLI is bearer-session protected.
 * Calling the CLI is therefore the deliberately conservative integration:
 * it uses its documented `agent get-agents` and `agent service-list` commands
 * instead of pretending there is a public unauthenticated registry endpoint.
 */
export class OnchainOsAgentResolver implements AgentResolver {
  constructor(private readonly command = process.env.ONCHAINOS_COMMAND || "onchainos") {}

  async resolve(agentId: string): Promise<AgentResolutionV1> {
    try {
      const [profileRun, servicesRun] = await Promise.all([
        execFileAsync(this.command, ["agent", "get-agents", "--agent-ids", agentId], { timeout: 20_000, maxBuffer: 2_000_000 }),
        execFileAsync(this.command, ["agent", "service-list", "--agent-id", agentId], { timeout: 20_000, maxBuffer: 8_000_000 })
      ]);
      const profileEnvelope = JSON.parse(profileRun.stdout) as { ok?: boolean; data?: unknown[] };
      const servicesEnvelope = JSON.parse(servicesRun.stdout) as { ok?: boolean; data?: unknown[] };
      const profile = profileEnvelope.ok ? profileEnvelope.data?.[0] as Record<string, unknown> | undefined : undefined;
      const page = servicesEnvelope.ok ? servicesEnvelope.data?.[0] as { list?: unknown[] } | undefined : undefined;
      if (!profile) throw new AgentResolutionUnavailable(`OKX returned no listing for agent ${agentId}.`);
      // Current CLI emits `data[0].list` directly. Older builds wrapped a
      // paginated service list once more, so accept both documented shapes.
      const first = Array.isArray(page?.list) ? page.list[0] as { list?: unknown[] } | undefined : undefined;
      const services = Array.isArray(page?.list) && first && "serviceName" in first ? page.list : Array.isArray(first?.list) ? first.list : [];
      return {
        agent_id: String(profile.agentId ?? agentId), name: observed(profile.name), description: observed(profile.profileDescription),
        category_code: observed(Array.isArray(profile.categoryCode) ? profile.categoryCode.join(",") : profile.categoryCode),
        status: observed(profile.statusLabel ?? profile.status),
        services: services.map((item) => {
          const service = item as Record<string, unknown>;
          return { service_id: observed(service.id), name: observed(service.serviceName), type: observed(service.serviceType), fee: observed(service.fee), endpoint: observed(service.endpoint), asset_contract: observed(service.contractAddress) };
        }),
        resolved_at: new Date().toISOString(), resolution_source: "onchainos-cli:agent-get-agents+service-list"
      };
    } catch (cause) {
      if (cause instanceof AgentResolutionUnavailable) throw cause;
      throw new AgentResolutionUnavailable("OKX listing resolution requires the authenticated OnchainOS CLI session. Supply a confirmed manual listing override or configure the resolver runtime.");
    }
  }
}

export function selectA2McpService(resolution: AgentResolutionV1): { service_id: string; name: string | null; endpoint: string; fee: string | null; asset_contract: string | null; type: string | null } | null {
  const selected = resolution.services.find((service) => service.type.value === "A2MCP" && typeof service.endpoint.value === "string" && service.endpoint.value.startsWith("https://"));
  if (!selected || typeof selected.endpoint.value !== "string" || (typeof selected.service_id.value !== "string" && typeof selected.service_id.value !== "number")) return null;
  return { service_id: String(selected.service_id.value), name: typeof selected.name.value === "string" ? selected.name.value : null, endpoint: selected.endpoint.value, fee: typeof selected.fee.value === "string" ? selected.fee.value : null, asset_contract: typeof selected.asset_contract.value === "string" ? selected.asset_contract.value : null, type: typeof selected.type.value === "string" ? selected.type.value : null };
}
