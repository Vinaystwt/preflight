import { randomUUID } from "node:crypto";
import { wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";

const base = process.env.RELEASE_SELFTEST_BASE_URL;
const signerValue = process.env.RELEASE_SELFTEST_SIGNER;
const manifestFile = process.env.RELEASE_SELFTEST_MANIFEST_JSON;
if (!base || !signerValue || !manifestFile) throw new Error("RELEASE_SELFTEST_BASE_URL, RELEASE_SELFTEST_SIGNER and RELEASE_SELFTEST_MANIFEST_JSON are required at runtime");
if (!/^0x[a-fA-F0-9]{64}$/.test(signerValue)) throw new Error("release selftest signer is invalid");
const manifest = JSON.parse(manifestFile) as unknown;
const request = { schema_version: "preflight.verify-release-request.v1", manifest };
const endpoint = new URL("/api/v1/verify-release", base); const idempotency = randomUUID(); const gates: Array<{ gate: string; result: "PASS" | "FAIL"; detail: string }> = [];
const draft = await fetch(new URL("/api/v1/release-manifests/draft", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manifest) }); gates.push({ gate: "draft", result: draft.ok ? "PASS" : "FAIL", detail: `HTTP ${draft.status}` });
const unpaid = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-unpaid` }, body: JSON.stringify(request) }); gates.push({ gate: "unpaid challenge", result: unpaid.status === 402 && Boolean(unpaid.headers.get("payment-required")) ? "PASS" : "FAIL", detail: `HTTP ${unpaid.status}` });
const account = privateKeyToAccount(signerValue as `0x${string}`); const publicClient = createPublicClient({ chain: xLayer, transport: http() }); const paidFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:196", client: new ExactEvmScheme(toClientEvmSigner(account, publicClient)) }] });
let paid = await paidFetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-paid` }, body: JSON.stringify(request) });
for (let attempt = 0; [409, 503].includes(paid.status) && attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  paid = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-paid` }, body: JSON.stringify(request) });
}
const report = await paid.json() as { report_id?: string; decision?: string; report_access?: { access_token?: string; report_url?: string } };
gates.push({ gate: "paid report", result: paid.ok && Boolean(report.report_id && report.decision) ? "PASS" : "FAIL", detail: `HTTP ${paid.status}; decision=${report.decision ?? "missing"}` }); gates.push({ gate: "settlement receipt", result: Boolean(paid.headers.get("payment-response")) || paid.ok ? "PASS" : "FAIL", detail: paid.headers.get("payment-response") ? "present" : paid.ok ? "reconciled settlement" : "missing" });
const retrieval = report.report_id && report.report_access?.access_token ? await fetch(new URL(`/api/v1/reports/${report.report_id}`, base), { headers: { authorization: `Bearer ${report.report_access.access_token}` } }) : null; gates.push({ gate: "private retrieval", result: retrieval?.ok ? "PASS" : "FAIL", detail: retrieval ? `HTTP ${retrieval.status}` : "missing capability" });
console.table(gates); if (gates.some((gate) => gate.result === "FAIL")) process.exitCode = 1;
