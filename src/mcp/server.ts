import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";

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
  return server;
}

export function mountMcp(app: FastifyInstance, config: Config): void {
  app.all("/mcp", async (request, reply) => {
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
