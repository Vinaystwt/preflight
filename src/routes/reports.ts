import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";

export function mountReports(app: FastifyInstance, database: Database | null): void {
  app.get("/r/:id", async (request, reply) => {
    if (!database) return reply.code(503).send({ error: "database unavailable" });
    const id = (request.params as { id: string }).id;
    const report = await database.getReport(id);
    return report ? report : reply.code(404).send({ error: "report not found" });
  });
}
