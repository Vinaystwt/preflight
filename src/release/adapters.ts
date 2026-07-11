import { Buffer } from "node:buffer";
import { SafeEgressClient } from "../egress/safe-client.js";
import { evidenceArtifact, type EvidenceArtifact } from "./evidence.js";

function parseJsonOrSse(body: Buffer): unknown {
  const text = body.toString("utf8").trim();
  if (text.startsWith("data:")) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find((line) => line && line !== "[DONE]");
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}
function paymentRequired(headers: Record<string, string | string[] | undefined>): string | undefined {
  const value = headers["payment-required"] ?? headers["PAYMENT-REQUIRED"]; return Array.isArray(value) ? value[0] : value;
}

export async function transportAdapter(client: SafeEgressClient, endpoint: string, probeInput: unknown): Promise<EvidenceArtifact> {
  const response = await client.postJson(endpoint, probeInput ?? {});
  return evidenceArtifact("TRANSPORT", response.finalUrl, { status: response.status, final_url: response.finalUrl, redirects: response.redirects, latency_ms: response.durationMs, resolved_addresses: response.resolvedAddresses });
}
export async function x402Adapter(client: SafeEgressClient, endpoint: string, probeInput: unknown): Promise<EvidenceArtifact> {
  const response = await client.postJson(endpoint, probeInput ?? {});
  const encoded = paymentRequired(response.headers); let challenge: unknown = null; let parse_error: string | null = null;
  if (encoded) try { challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch { parse_error = "PAYMENT_REQUIRED_MALFORMED"; }
  const object = challenge as { x402Version?: unknown; accepts?: unknown } | null;
  const version = typeof object?.x402Version === "string" || typeof object?.x402Version === "number" ? object.x402Version : null;
  return evidenceArtifact("X402", response.finalUrl, { status: response.status, x402_version: version, accepts: Array.isArray(object?.accepts) ? object.accepts as import("../contracts/canonical.js").JsonValue[] : null, parse_error });
}
export async function mcpAdapter(client: SafeEgressClient, mcpUrl: string): Promise<EvidenceArtifact> {
  const initialize = await client.postJson(mcpUrl, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "PreFlight", version: "2.0" } } });
  const initialized = parseJsonOrSse(initialize.body) as { result?: { protocolVersion?: unknown } };
  const toolsResponse = await client.postJson(mcpUrl, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = parseJsonOrSse(toolsResponse.body) as { result?: { tools?: unknown } };
  const protocol = typeof initialized?.result?.protocolVersion === "string" ? initialized.result.protocolVersion : null;
  return evidenceArtifact("MCP", toolsResponse.finalUrl, { initialize_status: initialize.status, protocol_version: protocol, tools_status: toolsResponse.status, tools: Array.isArray(listed?.result?.tools) ? listed.result.tools as import("../contracts/canonical.js").JsonValue[] : null });
}
