import { createDatabase } from "../src/db/client.js";
import { loadConfig } from "../src/config.js";
import { createPaymentBuyer } from "../src/payments/buyer.js";
import type { ReportEnvelope } from "../src/types.js";

const config = loadConfig();
const privateKey = config.SELFTEST_BUYER_PRIVATE_KEY;
if (!privateKey) throw new Error("SELFTEST_BUYER_PRIVATE_KEY is required");
const database = createDatabase(config);
if (!database) throw new Error("DATABASE_URL is required");

const serviceBase = `https://${config.PUBLIC_DOMAIN}`;
const deepUrl = process.env.STAGE2_SELFTEST_TARGET ?? `${serviceBase}/api/v1/deep_check`;
const probeTarget = process.env.STAGE2_PROBE_TARGET ?? `${serviceBase}/api/v1/run_preflight`;
const mcpUrl = process.env.STAGE2_MCP_URL ?? `${serviceBase}/mcp`;
const buyer = createPaymentBuyer(privateKey as `0x${string}`);

try {
  const paid = await buyer.postJson<ReportEnvelope>(deepUrl, { target: probeTarget, mcp_url: mcpUrl, owner_attestation: true });
  if (!paid.response.ok) throw new Error(`deep_check replay returned HTTP ${paid.response.status}`);
  if (!paid.body.report_id?.startsWith("pf_") || paid.body.tool !== "deep_check") throw new Error("deep_check returned an invalid envelope");
  if (paid.body.verdict !== "GO" || paid.body.score !== 100) throw new Error(`deep_check was ${paid.body.verdict}/${paid.body.score}`);

  const deadline = Date.now() + 60_000;
  let calls = await database.getCallsByCheck(paid.body.report_id);
  while (Date.now() < deadline && (!calls.some((call) => call.direction === "out") || !calls.some((call) => call.direction === "in"))) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    calls = await database.getCallsByCheck(paid.body.report_id);
  }
  const outbound = calls.find((call) => call.direction === "out");
  const inbound = calls.find((call) => call.direction === "in");
  if (!outbound?.settle_ref || outbound.owner_attestation !== true) throw new Error("outbound call audit row is incomplete");
  if (!inbound?.settle_ref || !inbound.payer) throw new Error("incoming deep_check audit row is incomplete");

  console.log("Stage 2 real-payment gate: PASS");
  console.table([
    { gate: "Paid deep_check replay", result: "PASS", evidence: `HTTP ${paid.response.status}` },
    { gate: "Deep envelope", result: "PASS", evidence: `${paid.body.report_id} ${paid.body.verdict}/${paid.body.score}` },
    { gate: "Incoming audit", result: "PASS", evidence: `${inbound.settle_status} ${inbound.settle_ref}` },
    { gate: "Outbound spend audit", result: "PASS", evidence: `${outbound.price_usdt} USDT ${outbound.settle_status} ${outbound.settle_ref}` },
    { gate: "Owner attestation", result: "PASS", evidence: String(outbound.owner_attestation) }
  ]);
  console.log(`Report: ${serviceBase}/r/${paid.body.report_id}`);
} finally {
  await database.close();
}
