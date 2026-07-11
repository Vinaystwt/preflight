import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { paidServices, type PaidTool } from "../payments/seller.js";

function paidPointer(config: Config, tool: PaidTool) {
  const service = paidServices(config).find((candidate) => candidate.tool === tool)!;
  return {
    paid: true,
    price_usdt: Number(service.price),
    endpoint: `POST https://${config.PUBLIC_DOMAIN}${service.path}`,
    how: "x402 v2: expect 402 + PAYMENT-REQUIRED, replay with PAYMENT-SIGNATURE"
  };
}

function createDiscoveryServer(config: Config): McpServer {
  const server = new McpServer({ name: "PreFlight", version: "0.1.0" });
  const pointer = (tool: PaidTool) => () => {
    const value = paidPointer(config, tool);
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
  };
  const services = paidServices(config).map((service) => ({ tool: service.tool, ...paidPointer(config, service.tool) }));
  server.registerTool("service_info", { description: "Returns all paid PreFlight service endpoints and x402 instructions", inputSchema: {} }, () => {
    const value = { services };
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
  });
  const baseInput = {
      target: z.string().url().optional(),
      mcp_url: z.string().url().optional(),
      expected: z.object({ amount: z.string().optional(), asset: z.string().optional(), network: z.string().optional(), payTo: z.string().optional() }).optional()
  };
  for (const service of paidServices(config)) {
    const requiresOwner = service.tool === "deep_check" || service.tool === "preflight_certified";
    server.registerTool(service.tool, {
      description: `Discovery-only pointer to the paid ${service.tool} HTTP service. This MCP tool never executes a scan.`,
      inputSchema: requiresOwner ? { ...baseInput, owner_attestation: z.literal(true).optional() } : baseInput
    }, pointer(service.tool));
  }
  return server;
}

/** Stateless discovery-only MCP endpoint. A fresh transport prevents cross-request reuse failures. */
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
