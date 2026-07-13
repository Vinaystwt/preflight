import type { FastifyInstance } from "fastify";

const DEFAULT_ALLOWED_ORIGINS = ["https://usepreflight.xyz", "https://www.usepreflight.xyz"];

function corsPath(path: string): boolean {
  return path === "/health"
    || path === "/api/v1/playground_check"
    || path === "/api/v1/health_index"
    || path === "/api/v1/service"
    || path === "/api/v1/pubkeys"
    || path === "/api/v1/gallery"
    || path.startsWith("/api/v1/contracts/")
    || path === "/api/v1/discover"
    || path === "/api/v1/release-manifests/draft"
    || path.startsWith("/api/v1/runs/")
    || path.startsWith("/api/v1/reports/")
    || path.startsWith("/api/v1/receipts/")
    || path.startsWith("/api/v1/badge/")
    || path.startsWith("/r/")
    || path.startsWith("/badge/");
}

export function mountPublicCors(app: FastifyInstance, frontendOrigins: readonly string[] = []): void {
  const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...frontendOrigins].filter((origin) => !origin.includes("*")));
  const wildcardPatterns = frontendOrigins.filter((origin) => origin.includes("*")).map((origin) => {
    const escaped = origin.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[a-z0-9-]+");
    return new RegExp(`^${escaped}$`, "i");
  });
  const allowed = (origin: string) => allowedOrigins.has(origin) || wildcardPatterns.some((pattern) => pattern.test(origin));
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (origin && allowed(origin) && corsPath(path)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("access-control-allow-headers", "Authorization, Content-Type");
      reply.header("access-control-max-age", "86400");
    }
  });
  app.options("/*", async (_request, reply) => reply.code(204).send());
}
