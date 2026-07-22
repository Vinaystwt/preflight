import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { verifyReleaseRequestV1Schema } from "../contracts/release-gate.js";

const SERVICE = {
  service: "verify_release",
  status: "contract_frozen",
  purpose: "Compare an operator-confirmed release manifest with observable production behavior.",
  paid_endpoint: "/api/v1/verify-release",
  price_usdt: "0.10",
  decisions: ["RELEASE", "BLOCK", "UNKNOWN"],
  manifest_schema: "preflight.release-manifest.v1",
  report_schema: "preflight.release-report.v1",
  limitations: ["Public HTTPS endpoints only", "No target payment", "No listing-approval or security guarantee"]
} as const;

function createDiscoveryServer(config: Config): McpServer {
  const server = new McpServer({ name: "PreFlight Release Gate", version: config.BUILD_SHA });
  server.registerTool("preflight_service_info", {
    description: "Returns discovery information for the single PreFlight Release Gate service.",
    inputSchema: {}
  }, () => {
    const value = { ...SERVICE, price_usdt: config.PRICE_VERIFY_RELEASE, paid_endpoint: `https://${config.PUBLIC_DOMAIN}${SERVICE.paid_endpoint}` };
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
  });
  if (config.MCP_TOOL_ENABLED) {
    server.registerTool("verify_release", {
      title: "Verify Release",
      description: "Paid Release Gate verification. Unpaid MCP calls return a pointer to the canonical x402 HTTP service.",
      inputSchema: verifyReleaseRequestV1Schema,
      annotations: { readOnlyHint: true }
    }, () => {
      const pointer = paidPointer(config);
      return { content: [{ type: "text" as const, text: JSON.stringify(pointer) }], structuredContent: pointer };
    });
  }
  return server;
}

export function mountMcp(app: FastifyInstance, config: Config): void {
  app.all("/mcp", async (request, reply) => {
    const body = request.body as { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } } | undefined;
    if (request.method === "POST" && body?.method === "initialize") {
      return reply.send({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "PreFlight Release Gate", version: config.BUILD_SHA } } });
    }
    if (request.method === "POST" && body?.method === "notifications/initialized") return reply.code(202).send();
    if (request.method === "POST" && body?.method === "tools/list") {
      return reply.send({ jsonrpc: "2.0", id: body.id, result: { tools: toolDefinitions(config) } });
    }
    if (request.method === "POST" && body?.method === "tools/call" && body.params?.name === "preflight_service_info") {
      const value = serviceInfo(config);
      return reply.send(jsonRpcResult(body.id, value));
    }
    if (config.MCP_TOOL_ENABLED && request.method === "POST" && body?.method === "tools/call" && body.params?.name === "verify_release") {
      const signature = request.headers["payment-signature"];
      if (typeof signature !== "string") return reply.send(jsonRpcResult(body.id, paidPointer(config)));
      const inject = app.inject as unknown as (options: {
        method: string; url: string; headers: Record<string, string>; payload: string;
      }) => Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }>;
      const injected = await inject({
        method: "POST",
        url: "/api/v1/verify-release",
        headers: {
          "content-type": "application/json",
          "payment-signature": signature,
          "idempotency-key": typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : `mcp-${String(body.id ?? Date.now())}`
        },
        payload: JSON.stringify(body.params.arguments ?? {})
      });
      const paymentResponse = injected.headers["payment-response"];
      if (paymentResponse) reply.header("PAYMENT-RESPONSE", paymentResponse);
      const parsed = safeJson(injected.body);
      if (injected.statusCode >= 400) return reply.code(injected.statusCode).send(jsonRpcResult(body.id, parsed, true));
      return reply.send(jsonRpcResult(body.id, parsed));
    }
    const server = createDiscoveryServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    try { await transport.handleRequest(request.raw, reply.raw, request.body); }
    finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });
}

function paidPointer(config: Config) {
  return {
    paid: true,
    price_usdt: config.PRICE_VERIFY_RELEASE,
    endpoint: `POST https://${config.PUBLIC_DOMAIN}/api/v1/verify-release`,
    how: "x402 v2: expect 402 + PAYMENT-REQUIRED, replay with PAYMENT-SIGNATURE"
  };
}
function serviceInfo(config: Config) {
  return { ...SERVICE, price_usdt: config.PRICE_VERIFY_RELEASE, paid_endpoint: `https://${config.PUBLIC_DOMAIN}${SERVICE.paid_endpoint}` };
}
function toolDefinitions(config: Config) {
  const tools = [{
    name: "preflight_service_info",
    description: "Returns discovery information for the single PreFlight Release Gate service.",
    inputSchema: { type: "object", additionalProperties: false }
  }];
  return config.MCP_TOOL_ENABLED ? [...tools, {
    name: "verify_release",
    title: "Verify Release",
    description: "Paid Release Gate verification. Unpaid MCP calls return a pointer to the canonical x402 HTTP service.",
    inputSchema: zodJsonSchemaPlaceholder()
  }] : tools;
}
function zodJsonSchemaPlaceholder() {
  return { type: "object" };
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function jsonRpcResult(id: unknown, value: unknown, isError = false) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
      structuredContent: value,
      isError
    }
  };
}
