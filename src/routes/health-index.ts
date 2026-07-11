import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";

export function mountHealthIndex(app: FastifyInstance, database: Database | null): void {
  app.get("/api/v1/health_index", async (_request, reply) => {
    if (!database) return reply.code(503).send({ error: { code: "HEALTH_INDEX_UNAVAILABLE", message: "Health Index data is temporarily unavailable." } });
    const latest = await database.getLatestHealthIndex();
    if (!latest) return reply.code(404).send({ error: { code: "HEALTH_INDEX_NOT_READY", message: "The first Health Index scan has not been published yet." } });
    return reply.header("cache-control", "public, max-age=600").send(latest);
  });
}
