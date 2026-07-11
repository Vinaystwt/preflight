import { scoreModules } from "./engine/rubric.js";
import { defaultServices, type PreflightServices } from "./preflight.js";

export interface MarketScanResult {
  scanned: number;
  pct_go: number;
  top_finding_codes: Array<{ code: string; count: number }>;
  median_latency_ms: number | null;
  go_targets: string[];
}

export async function scanMarket(targets: string[], services: PreflightServices = defaultServices, delayMs = 250): Promise<MarketScanResult> {
  const unique = [...new Set(targets)];
  const counts = new Map<string, number>();
  const latencies: number[] = [];
  const goTargets: string[] = [];
  for (let index = 0; index < unique.length; index += 1) {
    const target = unique[index]!;
    try {
      await services.validateTarget(target);
      const [transport, mcp, x402] = await Promise.all([services.transport(target), services.mcp(target, true), services.x402(target, undefined)]);
      const scored = scoreModules(transport, mcp, x402);
      if (scored.verdict === "GO") goTargets.push(target);
      for (const finding of scored.findings.filter((item) => item.severity !== "info")) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
      if (typeof transport.evidence.median_latency_ms === "number") latencies.push(transport.evidence.median_latency_ms);
    } catch {
      counts.set("SCAN_FAILED", (counts.get("SCAN_FAILED") ?? 0) + 1);
    }
    if (delayMs > 0 && index < unique.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  latencies.sort((left, right) => left - right);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null;
  return {
    scanned: unique.length,
    pct_go: unique.length ? Math.round(goTargets.length * 10_000 / unique.length) / 100 : 0,
    top_finding_codes: [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 10).map(([code, count]) => ({ code, count })),
    median_latency_ms: median,
    go_targets: goTargets
  };
}
