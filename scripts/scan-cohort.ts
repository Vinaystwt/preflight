import { loadConfig } from "../src/config.js";
import { FreeCohortScanner } from "../src/cohort.js";
import { createDatabase } from "../src/db/client.js";
import { SafeEgressClient } from "../src/egress/safe-client.js";
import { ReleaseRepository } from "../src/release/repository.js";
import { OnchainOsAgentResolver } from "../src/resolve/agent.js";

const config = loadConfig();
const database = createDatabase(config);
if (!database || !config.REPORT_TOKEN_SECRET) throw new Error("DATABASE_URL and REPORT_TOKEN_SECRET are required for a persisted cohort scan.");
const ids = config.COHORT_SEED_AGENT_IDS.split(",").map((value) => value.trim()).filter(Boolean);
if (!ids.length) throw new Error("COHORT_SEED_AGENT_IDS is required because OKX.AI roster enumeration is not available to this deployment.");
const repository = new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET);
if (process.env.COHORT_FORCE_REFRESH === "true") await Promise.all(ids.map((id) => repository.invalidateAgentResolution(id)));
const scanner = new FreeCohortScanner(repository, new OnchainOsAgentResolver(config.ONCHAINOS_COMMAND), new SafeEgressClient(), config);
try {
  const scan = await scanner.scan(ids);
  console.log(JSON.stringify({
    scan_id: scan.scan_id,
    totals: { scanned: scan.results.length, release: scan.results.filter((result) => result.decision === "RELEASE").length, block: scan.results.filter((result) => result.decision === "BLOCK").length, unknown: scan.results.filter((result) => result.decision === "UNKNOWN").length },
    results: scan.results.map((result) => ({ agent_id: result.agent_id, decision: result.decision, criterion_codes: result.criterion_codes, reachable: result.reachable }))
  }, null, 2));
} finally { await database.close(); }
