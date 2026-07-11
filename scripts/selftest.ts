import { createDatabase } from "../src/db/client.js";
import { loadConfig } from "../src/config.js";
import { createPaymentBuyer } from "../src/payments/buyer.js";
import type { ReportEnvelope } from "../src/types.js";
import { resolveSelftestTarget } from "../src/selftest-target.js";

type Result = { gate: string; result: "PASS" | "PARTIAL-PASS" | "FAIL" | "BLOCKED"; detail: string };
const results: Result[] = [];
const pass = (gate: string, detail: string) => results.push({ gate, result: "PASS", detail });
const partial = (gate: string, detail: string) => results.push({ gate, result: "PARTIAL-PASS", detail });
const fail = (gate: string, detail: string) => results.push({ gate, result: "FAIL", detail });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const config = loadConfig();
const required = ["SELFTEST_BUYER_PRIVATE_KEY", "DATABASE_URL"] as const;
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.table([{ gate: "real x402 self-test", result: "BLOCKED", detail: `Set ${missing.join(", ")}; no synthetic payment is accepted.` }]);
  process.exitCode = 2;
} else {
  const serviceUrl = resolveSelftestTarget(process.env.SELFTEST_TARGET, config.PUBLIC_DOMAIN);
  const probeTarget = process.env.SELFTEST_PROBE_TARGET ?? `${serviceUrl.origin}/api/v1/run_preflight`;
  const mcpUrl = process.env.SELFTEST_MCP_URL ?? `${serviceUrl.origin}/mcp`;
  const requestBody = { target: probeTarget, mcp_url: mcpUrl };

  const unpaid = await fetch(serviceUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(requestBody) });
  const challenge = unpaid.headers.get("payment-required");
  if (unpaid.status === 402 && challenge) pass("unpaid challenge", `HTTP 402 + PAYMENT-REQUIRED at ${serviceUrl}`);
  else fail("unpaid challenge", `HTTP ${unpaid.status} at ${serviceUrl}; PAYMENT-REQUIRED=${challenge ? "present" : "missing"}`);

  let report: ReportEnvelope | null = null;
  let buyerAddress: string | null = null;
  let receipt: Awaited<ReturnType<ReturnType<typeof createPaymentBuyer>["postJson"]>>["receipt"] = null;
  try {
    const buyer = createPaymentBuyer(process.env.SELFTEST_BUYER_PRIVATE_KEY as `0x${string}`);
    buyerAddress = buyer.address;
    const paid = await buyer.postJson<ReportEnvelope>(serviceUrl.toString(), requestBody);
    const candidate = paid.body;
    receipt = paid.receipt;
    if (paid.response.ok) pass("paid replay", `HTTP ${paid.response.status}; payer ${buyer.address}`);
    else fail("paid replay", `HTTP ${paid.response.status}`);
    if (candidate.report_id?.startsWith("pf_") && ["GO", "HOLD", "NO-GO"].includes(candidate.verdict)) {
      report = candidate;
      pass("uniform envelope", `${candidate.report_id} ${candidate.verdict}/${candidate.score}`);
    } else fail("uniform envelope", "missing report_id or verdict");
    if (receipt?.transaction) pass("payment receipt", `${receipt.status ?? "unknown"} ${receipt.transaction}`);
    else fail("payment receipt", "PAYMENT-RESPONSE or settlement reference missing");
  } catch (error) {
    fail("paid replay", error instanceof Error ? error.message : String(error));
  }

  const database = createDatabase(config);
  if (!database) fail("database", "DATABASE_URL did not create a database client");
  else {
    try {
      if (report) {
        const persisted = await database.getReport(report.report_id);
        if (persisted) pass("report persisted", report.report_id); else fail("report persisted", "checks row missing");
        const served = await fetch(`${serviceUrl.origin}/r/${report.report_id}`);
        const servedBody = served.ok ? await served.json() as ReportEnvelope : null;
        if (served.ok && servedBody?.report_id === report.report_id) pass("report route", `HTTP ${served.status}`); else fail("report route", `HTTP ${served.status}`);

        const timeoutAt = Date.now() + Number(process.env.SELFTEST_SETTLEMENT_TIMEOUT_S ?? 120) * 1_000;
        let call = await database.getCallByCheck(report.report_id);
        while (call && call.settle_status === "pending" && Date.now() < timeoutAt) {
          await wait(3_000);
          call = await database.getCallByCheck(report.report_id);
        }
        const payerMatches = Boolean(call?.payer && buyerAddress && call.payer.toLowerCase() === buyerAddress.toLowerCase());
        if (call?.settle_ref && payerMatches && ["confirmed", "success"].includes(call.settle_status)) {
          pass("call audit + settlement", `${call.settle_status} ${call.settle_ref}; payer ${call.payer}`);
        } else if (call?.settle_ref && payerMatches && call.settle_status === "pending") {
          const health: { settlement_listener?: string } = await fetch(`${serviceUrl.origin}/health`)
            .then((response) => response.json() as Promise<{ settlement_listener?: string }>)
            .catch(() => ({}));
          partial("call audit + settlement", `pending after timeout; settle_ref=${call.settle_ref}; payer ${call.payer}; listener=${health.settlement_listener ?? "unknown"}`);
        } else {
          fail("call audit + settlement", call ? `${call.settle_status}; settle_ref=${call.settle_ref ?? "missing"}; payer=${call.payer ?? "missing"}` : "calls row missing");
        }
        if (config.ATTESTATION_CONTRACT_ADDRESS && config.DEPLOYER_PRIVATE_KEY) {
          const attestationTimeout = Date.now() + 120_000;
          let attested = await database.getReport(report.report_id);
          while (!attested?.attestation_tx && Date.now() < attestationTimeout) {
            await wait(3_000);
            attested = await database.getReport(report.report_id);
          }
          if (attested?.attestation_tx) pass("on-chain attestation", attested.attestation_tx);
          else fail("on-chain attestation", "queue did not backfill attestation_tx within 120 seconds");
        }
      } else {
        fail("report persisted", "no valid report envelope to query");
        fail("report route", "no valid report_id to request");
        fail("call audit + settlement", "no valid report_id to query");
        if (config.ATTESTATION_CONTRACT_ADDRESS && config.DEPLOYER_PRIVATE_KEY) fail("on-chain attestation", "no valid report_id to attest");
      }
    } finally { await database.close(); }
  }

  console.table(results);
  if (results.some((result) => result.result === "FAIL")) process.exitCode = 1;
}
