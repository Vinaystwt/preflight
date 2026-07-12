import type { FastifyInstance } from "fastify";

const DEFAULT_ALLOWED_ORIGINS = ["https://usepreflight.xyz", "https://www.usepreflight.xyz"];

function corsPath(path: string): boolean {
  return path === "/health"
    || path === "/api/v1/playground_check"
    || path === "/api/v1/health_index"
    || path === "/api/v1/service"
    || path.startsWith("/api/v1/contracts/")
    || path === "/api/v1/release-manifests/draft"
    || path.startsWith("/api/v1/reports/")
    || path.startsWith("/r/")
    || path.startsWith("/badge/");
}

export function mountPublicCors(app: FastifyInstance, frontendOrigins: readonly string[] = []): void {
  const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...frontendOrigins]);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (origin && allowedOrigins.has(origin) && corsPath(path)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("access-control-allow-headers", "Authorization, Content-Type");
      reply.header("access-control-max-age", "86400");
    }
  });
  app.options("/*", async (_request, reply) => reply.code(204).send());
}
