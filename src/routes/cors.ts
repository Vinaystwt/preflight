import type { FastifyInstance } from "fastify";

const ALLOWED_ORIGINS = new Set(["https://usepreflight.xyz", "https://www.usepreflight.xyz"]);

function corsPath(path: string): boolean {
  return path === "/health" || path === "/api/v1/playground_check" || path === "/api/v1/health_index" || path.startsWith("/r/") || path.startsWith("/badge/");
}

export function mountPublicCors(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (origin && ALLOWED_ORIGINS.has(origin) && corsPath(path)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("access-control-allow-headers", "Content-Type");
      reply.header("access-control-max-age", "86400");
    }
  });
  app.options("/api/v1/playground_check", async (_request, reply) => reply.code(204).send());
}
