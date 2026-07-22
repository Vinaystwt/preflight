import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

export function mountBadge(app: FastifyInstance, database: Database | null, config: Config): void {
  app.get<{ Params: { target_id: string } }>("/badge/:target_id.svg", async (request, reply) => {
    if (!database || !/^[A-Za-z0-9_-]{8,64}$/.test(request.params.target_id)) return reply.header("cache-control", "private, no-store").code(404).send();
    const badge = await database.getBadgeData(request.params.target_id);
    if (!badge || !badge.badge_eligible || badge.verdict !== "GO") return reply.header("cache-control", "private, no-store").code(404).send();
    const date = badge.verified_at.toISOString().slice(0, 10);
    const reportUrl = `https://${config.PUBLIC_DOMAIN}/r/${encodeURIComponent(badge.report_id)}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" role="img" aria-label="PreFlight GO, verified ${escapeXml(date)}">
  <a href="${escapeXml(reportUrl)}" target="_blank">
    <rect width="360" height="96" rx="8" fill="#101613" stroke="#32453b" stroke-width="2"/>
    <rect x="16" y="16" width="92" height="64" rx="4" fill="#103b26" stroke="#42f58d"/>
    <text x="62" y="59" fill="#42f58d" font-family="ui-monospace,monospace" font-size="34" font-weight="700" text-anchor="middle">GO</text>
    <text x="128" y="39" fill="#d7e1db" font-family="ui-monospace,monospace" font-size="17" font-weight="700">PREFLIGHT RELEASE</text>
    <text x="128" y="64" fill="#87a293" font-family="ui-monospace,monospace" font-size="13">LAST VERIFIED ${escapeXml(date)}</text>
  </a>
</svg>`;
    return reply.header("content-type", "image/svg+xml; charset=utf-8").header("cache-control", "public, max-age=300").send(svg);
  });
}
