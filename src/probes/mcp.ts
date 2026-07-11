import type { Finding, ProbeResult } from "../types.js";
import { assertPublicHttps, httpsRequest, type HttpResult } from "./transport.js";

const PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"] as const;
const json = (method: string, params: Record<string, unknown>, id: number) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

function parseProtocolBody(response: HttpResult): Record<string, unknown> | null {
  const contentType = String(response.headers["content-type"] ?? "");
  const candidates = contentType.includes("text/event-stream")
    ? response.body.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]")
    : [response.body];
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch { /* Try the next SSE data event. */ }
  }
  return null;
}

export function evaluateMcpToolsPayload(payload: Record<string, unknown>): Finding[] {
  const result = payload.result;
  if (!result || typeof result !== "object") return [{ code: "MCP_NO_TOOLS", severity: "high", evidence: "tools/list had no JSON-RPC result", fix: "Implement MCP tools/list." }];
  const tools = (result as Record<string, unknown>).tools;
  if (!Array.isArray(tools) || tools.length === 0) return [{ code: "MCP_NO_TOOLS", severity: "high", evidence: "tools/list returned no tools", fix: "Expose at least one documented MCP tool." }];
  const findings: Finding[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") {
      findings.push({ code: "SCHEMA_INVALID_TOOL", severity: "high", evidence: "tools/list contains a non-object entry", fix: "Return valid MCP tool objects." });
      continue;
    }
    const value = tool as Record<string, unknown>;
    const schema = value.inputSchema as Record<string, unknown> | undefined;
    const required = schema?.required;
    const properties = schema?.properties;
    const requiredIsValid = required === undefined || (Array.isArray(required) && required.every((name) => typeof name === "string" && properties && Object.hasOwn(properties, name)));
    if (typeof value.name !== "string" || !value.name.trim()
      || typeof value.description !== "string" || !value.description.trim()
      || !schema || schema.type !== "object"
      || (properties !== undefined && (!properties || typeof properties !== "object" || Array.isArray(properties)))
      || !requiredIsValid) {
      findings.push({ code: "SCHEMA_INVALID_TOOL", severity: "high", evidence: `Invalid tool declaration: ${JSON.stringify(value)}`, fix: "Provide name, non-empty description, and a sane object JSON Schema for every tool." });
    }
  }
  return findings;
}

function unavailable(message: string, routeFormOnFailure: boolean, evidence: Record<string, unknown>): ProbeResult {
  return routeFormOnFailure
    ? { applicable: false, findings: [{ code: "SURFACE_ROUTE_FORM", severity: "info", evidence: message, fix: "No MCP fix is required for a registered route-form A2MCP service." }], evidence: { ...evidence, surface_form: "route", mcp_applicable: false } }
    : { findings: [{ code: "MCP_HANDSHAKE_TIMEOUT", severity: "high", evidence: message, fix: "Make the declared mcp_url reachable and implement Streamable HTTP initialize." }], evidence };
}

export async function probeMcp(target: string, routeFormOnFailure = false): Promise<ProbeResult> {
  try {
    const url = await assertPublicHttps(target);
    let initialized: HttpResult | undefined;
    let init: Record<string, unknown> | null = null;
    let negotiatedVersion: string | undefined;
    for (const version of PROTOCOL_VERSIONS) {
      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": version };
      const response = await httpsRequest(url, { method: "POST", headers, body: json("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "PreFlight", version: "1.0" } }, 1) });
      const parsed = parseProtocolBody(response);
      initialized = response;
      if (response.status >= 200 && response.status < 300 && parsed?.result) {
        init = parsed;
        negotiatedVersion = version;
        break;
      }
    }
    if (!initialized || !init || !negotiatedVersion) {
      const status = initialized?.status ?? 0;
      return unavailable(`MCP initialize was not supported (last HTTP ${status})`, routeFormOnFailure, { initialize_status: status });
    }

    const session = initialized.headers["mcp-session-id"];
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": negotiatedVersion };
    if (typeof session === "string") headers["mcp-session-id"] = session;
    // Stateful servers expect the initialized notification; stateless servers may return 202 or ignore it.
    await httpsRequest(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    const tools = await httpsRequest(url, { method: "POST", headers, body: json("tools/list", {}, 2) });
    const list = parseProtocolBody(tools);
    if (!list) return { findings: [{ code: "MCP_NO_TOOLS", severity: "high", evidence: "tools/list response was neither JSON nor parseable SSE", fix: "Return a valid JSON-RPC tools/list result." }], evidence: { initialize_status: initialized.status, tools_status: tools.status } };
    const findings: Finding[] = [{ code: "SURFACE_MCP_FORM", severity: "info", evidence: `MCP initialize succeeded with protocol ${negotiatedVersion}.`, fix: "No action required." }, ...evaluateMcpToolsPayload(list)];
    return { findings, evidence: { surface_form: "mcp", protocol_version: negotiatedVersion, initialize_status: initialized.status, tools_status: tools.status, initialize: init, tools: list } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown MCP error";
    return unavailable(message, routeFormOnFailure, { error: message });
  }
}
