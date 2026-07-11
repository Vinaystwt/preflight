import { createDatabase } from "../src/db/client.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const database = createDatabase(config);
if (!database) throw new Error("DATABASE_URL is required");
const target = process.env.STAGE4_PROBE_TARGET ?? `https://${config.PUBLIC_DOMAIN}/api/v1/run_preflight`;

try {
  const expiresAt = new Date(Date.now() + config.MONITOR_DURATION_DAYS * 86_400_000);
  const monitorId = await database.ensureMonitor(target, Math.max(360, config.MONITOR_INTERVAL_S), expiresAt);
  await database.markBadgeEligible(target, true);
  const targets = await database.sql<Array<{ id: string }>>`SELECT id FROM targets WHERE endpoint_url = ${target}`;
  const targetId = targets[0]?.id;
  if (!targetId) throw new Error("self target id was not persisted");

  const deadline = Date.now() + 60_000;
  let history = await database.getWatchReportData(target);
  while (Date.now() < deadline && !history?.latency_series.length) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    history = await database.getWatchReportData(target);
  }
  if (!history?.latency_series.length) throw new Error("production scheduler did not record a monitor probe within 60 seconds");
  const badgeUrl = `https://${config.PUBLIC_DOMAIN}/badge/${targetId}.svg`;
  const badge = await fetch(badgeUrl);
  if (!badge.ok || !(await badge.text()).includes("PREFLIGHT CERTIFIED")) throw new Error(`badge proof returned HTTP ${badge.status}`);
  console.log(JSON.stringify({ result: "PASS", monitor_id: monitorId, target_id: targetId, status: history.status, uptime_pct: history.uptime_pct,
    samples: history.latency_series.length, latest_latency_ms: history.latency_series.at(-1)?.latency_ms, finding_history: history.finding_history, badge_url: badgeUrl }));
} finally {
  await database.close();
}
