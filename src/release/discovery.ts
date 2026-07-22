import { EgressPolicyError, SafeEgressClient } from "../egress/safe-client.js";
import {
  discoveryResponseV1Schema,
  releaseManifestV1Schema,
  type DiscoveryResponseV1,
  type ManifestExpectationV1,
  type ObservedPaymentSurfaceV1,
  type ProposedManifestFieldV1,
  type ReleaseManifestV1
} from "../contracts/release-gate.js";
import type { JsonValue } from "../contracts/canonical.js";
import { mcpAdapter, transportAdapter, x402Adapter } from "./adapters.js";
import { evidenceArtifact, type EvidenceArtifact } from "./evidence.js";

function evidenceRefs(artifacts: EvidenceArtifact[]) {
  return artifacts.map((artifact) => ({ id: artifact.id, source: artifact.source, captured_at: artifact.captured_at, digest: artifact.digest, summary: `${artifact.kind} runtime evidence`, freshness_seconds: 0 }));
}

function field(value: JsonValue | undefined, source: ProposedManifestFieldV1["source"], confidence: ProposedManifestFieldV1["confidence"], requires_confirmation: boolean): ProposedManifestFieldV1 {
  return value === undefined ? { source, confidence, requires_confirmation } : { value, source, confidence, requires_confirmation };
}

function firstAccept(surface: ObservedPaymentSurfaceV1): Record<string, unknown> | undefined {
  return surface.accepts?.find((entry) => entry && typeof entry === "object");
}

function paymentSurface(x402: EvidenceArtifact | undefined): ObservedPaymentSurfaceV1 {
  const normalized = x402?.normalized as Record<string, unknown> | undefined;
  const rawAccepts = Array.isArray(normalized?.accepts) ? normalized.accepts : null;
  const accepts = rawAccepts?.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      ...(typeof item.scheme === "string" ? { scheme: item.scheme } : {}),
      ...(typeof item.network === "string" ? { network: item.network } : {}),
      ...(typeof item.asset === "string" ? { asset: item.asset } : {}),
      ...(typeof item.amount === "string" ? { amount: item.amount } : {}),
      ...(typeof item.payTo === "string" ? { payTo: item.payTo } : {}),
      ...(typeof item.maxTimeoutSeconds === "number" ? { maxTimeoutSeconds: item.maxTimeoutSeconds } : {}),
      ...(item.extra !== undefined ? { extra: item.extra as JsonValue } : {})
    };
  }) ?? null;
  return { status: typeof normalized?.status === "number" ? normalized.status : undefined, parse_error: typeof normalized?.parse_error === "string" ? normalized.parse_error : null, accepts };
}

function operatorOverride<T>(operator: T | undefined, observed: T | undefined): { value: T | undefined; source: ProposedManifestFieldV1["source"]; confidence: ProposedManifestFieldV1["confidence"]; requiresConfirmation: boolean } {
  if (operator !== undefined) return { value: operator, source: "operator", confidence: "observed", requiresConfirmation: false };
  if (observed !== undefined) return { value: observed, source: "runtime", confidence: "observed", requiresConfirmation: false };
  return { value: undefined, source: "inferred", confidence: "unknown", requiresConfirmation: true };
}
function paymentModeField(expected: ManifestExpectationV1 | undefined, paymentMode: "X402" | undefined, status: number | undefined): ProposedManifestFieldV1 {
  if (expected?.payment?.mode) return field(expected.payment.mode, "operator", "observed", false);
  if (paymentMode) return field(paymentMode, "runtime", "observed", false);
  if (status !== undefined) return field(undefined, "runtime", "unknown", true);
  return field(undefined, "inferred", "unknown", true);
}

function applyExpected(manifest: ReleaseManifestV1, expected?: ManifestExpectationV1): ReleaseManifestV1 {
  if (!expected) return manifest;
  const next: ReleaseManifestV1 = {
    ...manifest,
    release: { ...manifest.release, ...expected.release },
    target: { ...manifest.target, ...expected.target },
    payment: expected.payment ? { ...manifest.payment, ...expected.payment } as ReleaseManifestV1["payment"] : manifest.payment,
    request_contract: expected.request_contract ?? manifest.request_contract,
    response_contract: expected.response_contract ?? manifest.response_contract
  };
  return releaseManifestV1Schema.parse(next);
}

function completeX402(values: { network?: unknown; asset?: unknown; amount_atomic?: unknown; pay_to?: unknown }): values is { network: string; asset: string; amount_atomic: string; pay_to: string } {
  return [values.network, values.asset, values.amount_atomic, values.pay_to].every((value) => typeof value === "string" && value.length > 0);
}

export interface DiscoverOptions { endpoint: string; expected?: ManifestExpectationV1; probeInput?: unknown; client?: SafeEgressClient }

export function defaultDiscoveryProbeInput(endpoint: string): JsonValue {
  return {
    schema_version: "preflight.verify-release-request.v1",
    manifest: {
      schema_version: "preflight.release-manifest.v1",
      release: { service_name: "PreFlight discovery probe" },
      target: { endpoint, method: "POST", interface_mode: "X402_HTTP", redirect_policy: "NONE" },
      payment: {
        mode: "X402",
        network: "eip155:196",
        asset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        amount_atomic: "100000",
        pay_to: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2"
      }
    }
  };
}

export async function discoverReleaseSurface(options: DiscoverOptions): Promise<DiscoveryResponseV1> {
  const client = options.client ?? new SafeEgressClient();
  const probeInput = options.probeInput ?? defaultDiscoveryProbeInput(options.endpoint);
  const artifacts: EvidenceArtifact[] = [];
  let transport: EvidenceArtifact | undefined; let x402: EvidenceArtifact | undefined; let mcp: EvidenceArtifact | undefined;
  try { transport = await transportAdapter(client, options.endpoint, probeInput); artifacts.push(transport); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; const artifact = evidenceArtifact("TRANSPORT", options.endpoint, { error: cause.code }); transport = artifact; artifacts.push(artifact); }
  try { x402 = await x402Adapter(client, options.endpoint, probeInput); artifacts.push(x402); } catch (cause) { if (!(cause instanceof EgressPolicyError)) throw cause; const artifact = evidenceArtifact("X402", options.endpoint, { parse_error: cause.code, accepts: null }); x402 = artifact; artifacts.push(artifact); }
  try { mcp = await mcpAdapter(client, options.endpoint); artifacts.push(mcp); } catch (cause) { if (!(cause instanceof EgressPolicyError || cause instanceof SyntaxError)) throw cause; const artifact = evidenceArtifact("MCP", options.endpoint, { error: cause instanceof EgressPolicyError ? cause.code : "MCP_PARSE_ERROR" }); mcp = artifact; artifacts.push(artifact); }

  const surface = paymentSurface(x402);
  const accepted = firstAccept(surface);
  const hasMcp = Array.isArray((mcp?.normalized as Record<string, unknown> | undefined)?.tools);
  const paymentMode = surface.status === 402 && accepted ? "X402" : undefined;
  const releaseName = options.expected?.release?.service_name ?? new URL(options.endpoint).hostname;
  const targetEndpoint = operatorOverride(options.expected?.target?.endpoint, options.endpoint);
  const interfaceMode = operatorOverride(options.expected?.target?.interface_mode, paymentMode ? hasMcp ? (paymentMode === "X402" ? "MCP_PLUS_X402_HTTP" : "MCP_PLUS_FREE_HTTP") : (paymentMode === "X402" ? "X402_HTTP" : "FREE_HTTP") : undefined);
  const redirectPolicy = operatorOverride(options.expected?.target?.redirect_policy, "NONE");
  const network = operatorOverride(options.expected?.payment?.mode === "X402" ? options.expected.payment.network : undefined, typeof accepted?.network === "string" ? accepted.network : undefined);
  const asset = operatorOverride(options.expected?.payment?.mode === "X402" ? options.expected.payment.asset : undefined, typeof accepted?.asset === "string" ? accepted.asset : undefined);
  const amount = operatorOverride(options.expected?.payment?.mode === "X402" ? options.expected.payment.amount_atomic : undefined, typeof accepted?.amount === "string" ? accepted.amount : undefined);
  const payTo = operatorOverride(options.expected?.payment?.mode === "X402" ? options.expected.payment.pay_to : undefined, typeof accepted?.payTo === "string" ? accepted.payTo : undefined);

  const fields: Record<string, ProposedManifestFieldV1> = {
    "release.service_name": field(releaseName, options.expected?.release?.service_name ? "operator" : "inferred", options.expected?.release?.service_name ? "observed" : "inferred", !options.expected?.release?.service_name),
    "target.endpoint": field(targetEndpoint.value, targetEndpoint.source, targetEndpoint.confidence, targetEndpoint.requiresConfirmation),
    "target.method": field("POST", options.expected?.target?.method ? "operator" : "inferred", options.expected?.target?.method ? "observed" : "inferred", false),
    "target.interface_mode": field(interfaceMode.value, interfaceMode.source, interfaceMode.confidence, interfaceMode.requiresConfirmation),
    "target.redirect_policy": field(redirectPolicy.value, redirectPolicy.source, redirectPolicy.confidence, redirectPolicy.requiresConfirmation),
    "payment.mode": paymentModeField(options.expected, paymentMode, surface.status),
    "payment.network": field(network.value, network.source === "runtime" ? "x402_challenge" : network.source, network.confidence, network.requiresConfirmation),
    "payment.asset": field(asset.value, asset.source === "runtime" ? "x402_challenge" : asset.source, asset.confidence, asset.requiresConfirmation),
    "payment.amount_atomic": field(amount.value, amount.source === "runtime" ? "x402_challenge" : amount.source, amount.confidence, amount.requiresConfirmation),
    "payment.pay_to": field(payTo.value, payTo.source === "runtime" ? "x402_challenge" : payTo.source, payTo.confidence, payTo.requiresConfirmation),
    "request_contract.schema": field(undefined, hasMcp ? "mcp_schema" : "inferred", "unknown", true),
    "response_contract.schema": field(undefined, hasMcp ? "mcp_schema" : "inferred", "unknown", true)
  };

  let manifest: ReleaseManifestV1 | undefined;
  const selectedPaymentMode: "X402" | "FREE" | undefined = options.expected?.payment?.mode ?? paymentMode;
  const payment = selectedPaymentMode === "X402" && completeX402({ network: network.value, asset: asset.value, amount_atomic: amount.value, pay_to: payTo.value })
    ? { mode: "X402" as const, network: network.value, asset: asset.value, amount_atomic: amount.value, pay_to: payTo.value }
    : selectedPaymentMode === "FREE" ? { mode: "FREE" as const } : undefined;
  if (!payment) {
    return discoveryResponseV1Schema.parse({
      schema_version: "preflight.discovery.v1",
      endpoint: options.endpoint,
      observed_surface: { transport: transport?.normalized, mcp: mcp?.normalized, x402: surface },
      proposed_manifest: { fields },
      evidence_refs: evidenceRefs(artifacts),
      generated_at: new Date().toISOString()
    });
  }
  const selectedInterface = interfaceMode.value ?? (payment.mode === "X402" ? "X402_HTTP" : selectedPaymentMode === "FREE" ? "FREE_HTTP" : undefined);
  const target = {
    endpoint: targetEndpoint.value ?? options.endpoint,
    method: "POST" as const,
    ...(selectedInterface ? { interface_mode: selectedInterface } : {}),
    ...(selectedInterface && String(selectedInterface).startsWith("MCP_PLUS_") ? { mcp_url: options.expected?.target?.mcp_url ?? options.endpoint } : {}),
    redirect_policy: redirectPolicy.value ?? "NONE"
  };
  const candidate = {
    schema_version: "preflight.release-manifest.v1" as const,
    release: { service_name: releaseName },
    target,
    payment
  };
  const parsed = releaseManifestV1Schema.safeParse(candidate);
  if (parsed.success) {
    try { manifest = applyExpected(parsed.data, options.expected); } catch { manifest = undefined; }
  }

  return discoveryResponseV1Schema.parse({
    schema_version: "preflight.discovery.v1",
    endpoint: options.endpoint,
    observed_surface: { transport: transport?.normalized, mcp: mcp?.normalized, x402: surface },
    proposed_manifest: { manifest, fields },
    evidence_refs: evidenceRefs(artifacts),
    generated_at: new Date().toISOString()
  });
}
