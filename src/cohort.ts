import { ulid } from "ulid";
import type { Config } from "./config.js";
import type { JsonValue } from "./contracts/canonical.js";
import type { AgentResolutionV1, CriterionResult, ReleaseDecision } from "./contracts/release-gate.js";
import { SafeEgressClient } from "./egress/safe-client.js";
import { aggregateDecision, POLICY_VERSION } from "./release/criteria.js";
import { discoverReleaseSurface } from "./release/discovery.js";
import { ReleaseRepository } from "./release/repository.js";
import { selectA2McpService, type AgentResolver } from "./resolve/agent.js";

const usdtAtomic = (fee: string | null): string | null => {
  if (!fee || !/^\d+(?:\.\d+)?$/.test(fee)) return null;
  const [whole, fraction = ""] = fee.split(".");
  return `${whole}${(fraction + "000000").slice(0, 6)}`.replace(/^0+(?=\d)/, "");
};
const criterion = (code: string, state: CriterionResult["state"], expected: JsonValue | undefined, observed: JsonValue | undefined, consequence: string, remediation: string): CriterionResult => ({
  code, group: "listing", state, mandatory: true, expected, observed, provenance: ["OBSERVED", "DERIVED"], comparison_rule: "OKX listing declaration is compared with unauthenticated runtime discovery.",
  consequence: state === "CONTRADICTION" ? consequence : undefined, remediation: state === "CONTRADICTION" || state === "UNKNOWN" ? remediation : undefined, evidence_refs: [], limitation: state === "UNKNOWN" ? "The listing declaration or runtime observation was unavailable." : undefined
});

export interface CohortResult {
  agent_id: string; name: string | null; decision: ReleaseDecision; criterion_codes: string[]; criteria: CriterionResult[]; declared: JsonValue; observed: JsonValue; reachable: boolean; checked_at: string;
}

/** Free-only scanner: it accepts only SafeEgressClient and never imports any payment/buyer client. */
export class FreeCohortScanner {
  private readonly lastTargetRequestAt = new Map<string, number>();
  constructor(private readonly repository: ReleaseRepository, private readonly resolver: AgentResolver, private readonly egress: SafeEgressClient, private readonly config: Config, private readonly pause: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {}

  private rateLimitedEgress(): SafeEgressClient {
    const scanner = this;
    // Discovery makes three distinct unpaid requests (transport, x402, MCP).
    // Pace every one, rather than merely spacing different ASPs, so a target
    // never receives more than one scanner request in a ten-second window.
    return {
      async postJson(target: string, value: unknown, redirectPolicy: "NONE" | "SAME_ORIGIN" = "NONE") {
        const previous = scanner.lastTargetRequestAt.get(target);
        const now = Date.now();
        if (previous !== undefined) {
          const remaining = 10_000 - (now - previous);
          if (remaining > 0) await scanner.pause(remaining);
        }
        scanner.lastTargetRequestAt.set(target, Date.now());
        return scanner.egress.postJson(target, value, redirectPolicy, { userAgent: "PreFlight/1.0 (+https://usepreflight.xyz; free discovery)" });
      }
    } as SafeEgressClient;
  }

  async scan(agentIds: string[]): Promise<{ scan_id: string; results: CohortResult[] }> {
    const scanId = await this.repository.beginCohortScan(POLICY_VERSION); const results: CohortResult[] = [];
    for (const agentId of [...new Set(agentIds.filter(Boolean))]) {
      const result = await this.scanAgent(agentId, scanId); results.push(result);
    }
    await this.repository.completeCohortScan(scanId, results.length); return { scan_id: scanId, results };
  }
  async scanAgent(agentId: string, scanId = `adhoc_${ulid()}`): Promise<CohortResult> {
    let resolution: AgentResolutionV1;
    try { resolution = await this.repository.cachedAgentResolution(agentId) ?? await this.resolver.resolve(agentId); await this.repository.cacheAgentResolution(resolution, this.config.AGENT_RESOLUTION_TTL_SECONDS); }
    catch {
      const result: CohortResult = { agent_id: agentId, name: null, decision: "UNKNOWN", criterion_codes: ["LST-05"], criteria: [criterion("LST-05", "UNKNOWN", undefined, undefined, "A buyer cannot establish that the listed service is reachable.", "Restore listing resolution and rerun free discovery.")], declared: {}, observed: {}, reachable: false, checked_at: new Date().toISOString() };
      await this.repository.recordCohortResult(scanId, { agentId, decision: result.decision, criterionCodes: result.criterion_codes, declared: result.declared, observed: result.observed, reachable: false }); return result;
    }
    const service = selectA2McpService(resolution);
    if (!service) {
      const result: CohortResult = { agent_id: agentId, name: typeof resolution.name.value === "string" ? resolution.name.value : null, decision: "UNKNOWN", criterion_codes: ["LST-05"], criteria: [criterion("LST-05", "UNKNOWN", "A2MCP service", undefined, "A buyer cannot reach a declared A2MCP service.", "Publish an HTTPS A2MCP service endpoint in the listing.")], declared: resolution as unknown as JsonValue, observed: {}, reachable: false, checked_at: new Date().toISOString() };
      await this.repository.recordCohortResult(scanId, { agentId, decision: result.decision, criterionCodes: result.criterion_codes, declared: result.declared, observed: result.observed, reachable: false }); return result;
    }
    const cohortLimit = await this.repository.reserveRateLimit("cohort_global_day", "global", this.config.COHORT_GLOBAL_DAILY);
    if (!cohortLimit.allowed) {
      const result: CohortResult = { agent_id: agentId, name: typeof resolution.name.value === "string" ? resolution.name.value : null, decision: "UNKNOWN", criterion_codes: ["LST-05"], criteria: [criterion("LST-05", "UNKNOWN", service.endpoint, undefined, "The cohort scanner has reached its separate free-scan capacity, so no visitor allowance was consumed.", "Wait for the cohort scanner budget to reset.")], declared: { service }, observed: {}, reachable: false, checked_at: new Date().toISOString() };
      await this.repository.recordCohortResult(scanId, { agentId, decision: result.decision, criterionCodes: result.criterion_codes, declared: result.declared, observed: result.observed, reachable: false }); return result;
    }
    const targetLimit = await this.repository.reserveRateLimit("cohort_target_hour", service.endpoint, this.config.COHORT_TARGET_HOURLY, "hour");
    if (!targetLimit.allowed) {
      const result: CohortResult = { agent_id: agentId, name: typeof resolution.name.value === "string" ? resolution.name.value : null, decision: "UNKNOWN", criterion_codes: ["LST-05"], criteria: [criterion("LST-05", "UNKNOWN", service.endpoint, undefined, "The target's free-discovery hourly allowance has been reached, so no further probe was sent.", "Wait for the hourly reset before running another free cohort scan.")], declared: { service }, observed: {}, reachable: false, checked_at: new Date().toISOString() };
      await this.repository.recordCohortResult(scanId, { agentId, decision: result.decision, criterionCodes: result.criterion_codes, declared: result.declared, observed: result.observed, reachable: false }); return result;
    }
    let discovery;
    try { discovery = await discoverReleaseSurface({ endpoint: service.endpoint, client: this.rateLimitedEgress() }); }
    catch {
      const result: CohortResult = { agent_id: agentId, name: typeof resolution.name.value === "string" ? resolution.name.value : null, decision: "UNKNOWN", criterion_codes: ["LST-05"], criteria: [criterion("LST-05", "UNKNOWN", service.endpoint, undefined, "A buyer cannot establish that the declared service responds.", "Restore the declared HTTPS endpoint and rerun discovery.")], declared: { service }, observed: {}, reachable: false, checked_at: new Date().toISOString() };
      await this.repository.recordCohortResult(scanId, { agentId, decision: result.decision, criterionCodes: result.criterion_codes, declared: result.declared, observed: result.observed, reachable: false }); return result;
    }
    const accepts = discovery.observed_surface.x402.accepts ?? [];
    const runtime = discovery.proposed_manifest.manifest;
    const amount = usdtAtomic(service.fee); const observedAmounts = accepts.map((entry) => entry.amount).filter((value): value is string => typeof value === "string");
    const observedAssets = accepts.map((entry) => entry.asset).filter((value): value is string => typeof value === "string");
    const finalEndpoint = (discovery.observed_surface.transport as { final_url?: unknown } | undefined)?.final_url;
    const mode = runtime?.target.interface_mode ?? "UNKNOWN";
    const reachable = Boolean(finalEndpoint || discovery.observed_surface.x402.status);
    const criteria = [
      criterion("LST-01", amount ? (observedAmounts.includes(amount) ? "MATCH" : observedAmounts.length ? "CONTRADICTION" : "UNKNOWN") : "UNKNOWN", amount ?? undefined, observedAmounts, "A buyer could be charged a different amount than the listing declares.", "Align the listing fee and the x402 challenge amount."),
      criterion("LST-02", service.asset_contract ? (observedAssets.some((asset) => asset.toLowerCase() === service.asset_contract!.toLowerCase()) ? "MATCH" : observedAssets.length ? "CONTRADICTION" : "UNKNOWN") : "UNKNOWN", service.asset_contract ?? undefined, observedAssets, "A buyer could be charged an asset different from the listing declaration.", "Align the listing asset contract and the x402 challenge asset."),
      criterion("LST-03", typeof finalEndpoint === "string" ? (finalEndpoint === service.endpoint ? "MATCH" : "CONTRADICTION") : "UNKNOWN", service.endpoint, typeof finalEndpoint === "string" ? finalEndpoint : undefined, "A buyer could reach a destination different from the listed endpoint.", "Set the listing endpoint to the responding HTTPS service."),
      criterion("LST-04", mode === "UNKNOWN" ? "UNKNOWN" : (mode.includes("MCP") ? "MATCH" : "CONTRADICTION"), service.type ?? "A2MCP", mode, "Agents could be offered an A2MCP listing whose observed surface is not MCP.", "Expose the declared MCP surface or correct the listing service type."),
      criterion("LST-05", reachable ? "MATCH" : "CONTRADICTION", service.endpoint, typeof finalEndpoint === "string" ? finalEndpoint : undefined, "A buyer cannot call the service declared in the listing.", "Restore the declared endpoint before offering the service.")
    ];
    const decision = aggregateDecision(criteria); const declared = { service, resolution_source: resolution.resolution_source } as unknown as JsonValue; const observed = { discovery, surface_form: mode } as unknown as JsonValue;
    const previous = await this.repository.cohortRow(agentId);
    if (previous && JSON.stringify(previous.observed) !== JSON.stringify(observed)) { await this.repository.recordDrift(agentId, "runtime_surface", previous.observed, observed, scanId); await this.repository.revokePassportsForDrift(agentId, "Observed runtime surface changed during free cohort re-scan."); }
    const result: CohortResult = { agent_id: agentId, name: typeof resolution.name.value === "string" ? resolution.name.value : null, decision, criterion_codes: criteria.filter((item) => item.state !== "MATCH").map((item) => item.code), criteria, declared, observed, reachable, checked_at: new Date().toISOString() };
    await this.repository.recordCohortResult(scanId, { agentId, decision, criterionCodes: result.criterion_codes, declared, observed, reachable }); return result;
  }
}

export function cohortPublicPayload(rows: Array<{ agent_id: string; decision: "RELEASE" | "BLOCK" | "UNKNOWN"; criterion_codes: string[]; reachable: boolean; checked_at: Date; name: string | null }>, generatedAt: string, driftEvents24h = 0): JsonValue {
  const contradictory = rows.filter((row) => row.decision === "BLOCK");
  const codeCounts = new Map<string, number>(); for (const row of contradictory) for (const code of row.criterion_codes) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  const plain: Record<string, string> = { "LST-01": "Listing fee differs from the price the endpoint demands", "LST-02": "Listing asset differs from the asset the endpoint demands", "LST-03": "Listing endpoint differs from the responding endpoint", "LST-04": "Listing service type differs from the observed surface form", "LST-05": "A listed service did not respond" };
  return { schema_version: "preflight.cohort.v1", generated_at: generatedAt, policy_version: POLICY_VERSION,
    totals: { listed_asps: rows.length, with_runtime_evidence: rows.filter((row) => row.reachable).length, conforming: rows.filter((row) => row.decision === "RELEASE").length, with_contradictions: contradictory.length, unknown: rows.filter((row) => row.decision === "UNKNOWN").length, unreachable: rows.filter((row) => !row.reachable).length },
    // Passing names only. Failed rows are intentionally absent from every public array.
    conforming: rows.filter((row) => row.decision === "RELEASE").map((row) => ({ agent_id: row.agent_id, name: row.name ?? "Unnamed ASP", last_checked: row.checked_at.toISOString(), permalink: `/asp/${row.agent_id}` })),
    contradiction_summary: [...codeCounts.entries()].map(([criterion_code, count]) => ({ criterion_code, count, plain: plain[criterion_code] ?? "Observed listing/runtime contradiction" })), drift_events_24h: driftEvents24h } as unknown as JsonValue;
}
