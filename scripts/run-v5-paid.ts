import { randomUUID } from "node:crypto";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";
import type { JsonValue } from "../src/contracts/canonical.js";
import { ReleaseRepository } from "../src/release/repository.js";

type PaidResponse = {
  schema_version?: string;
  report_id?: string;
  decision?: "RELEASE" | "BLOCK" | "UNKNOWN";
  receipt?: { receipt_id?: string; payload?: { settlement_ref?: string }; verify?: { pubkeys_url?: string } };
  report_access?: { access_token?: string; report_url?: string };
  journey?: Array<{ step?: string; status?: string }>;
  detail?: {
    report_id?: string;
    decision?: "RELEASE" | "BLOCK" | "UNKNOWN";
    receipt?: { receipt_id?: string; payload?: { settlement_ref?: string }; verify?: { pubkeys_url?: string } };
    report_access?: { access_token?: string; report_url?: string };
  };
};

const config = loadConfig();
const base = process.env.V5_PAID_BASE_URL ?? `https://${config.PUBLIC_DOMAIN}`;
const mode = process.env.V5_PAID_MODE ?? "self-check";
const signerValue = process.env.RELEASE_SELFTEST_SIGNER ?? process.env.BUYER_WALLET_KEY;
if (!signerValue || !/^0x[a-fA-F0-9]{64}$/.test(signerValue)) throw new Error("RELEASE_SELFTEST_SIGNER or BUYER_WALLET_KEY is required at runtime.");
const label = process.env.V5_CANARY_LABEL ?? (mode === "agent-id" ? "CANARY_V5_AGENT_ID_INPUT" : "SELF_CHECK_PRODUCTION");
const customerDemand = process.env.CUSTOMER_DEMAND === "true";
const requestBody = mode === "agent-id"
  ? { schema_version: "preflight.verify-release-request.v1", agent_id: process.env.V5_AGENT_ID ?? "2013" }
  : { schema_version: "preflight.verify-release-request.v1", endpoint: new URL("/api/v1/verify-release", base).toString() };

const endpoint = new URL("/api/v1/verify-release", base);
const account = privateKeyToAccount(signerValue as `0x${string}`);
const publicClient = createPublicClient({ chain: xLayer, transport: http(config.X_LAYER_RPC_URL) });
const balance = await publicClient.getBalance({ address: account.address });
const usdt = await publicClient.readContract({ address: config.RELEASE_PAYMENT_ASSET as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
if (usdt < 100_000n) throw new Error("Signer USDT0 balance is below the 0.10 USDT verify_release price.");

let capturedPaymentSignature: string | null = null;
const capturedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const signature = headers.get("payment-signature");
  if (signature) capturedPaymentSignature = signature;
  return fetch(input, init);
};
const paidFetch = wrapFetchWithPaymentFromConfig(capturedFetch, { schemes: [{ network: config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, client: new ExactEvmScheme(toClientEvmSigner(account, publicClient)) }] });

const idempotency = randomUUID();
const unpaid = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-unpaid` }, body: JSON.stringify(requestBody) });
if (unpaid.status !== 402 || !unpaid.headers.get("payment-required")) throw new Error(`unpaid challenge failed: HTTP ${unpaid.status}`);

let paid = await paidFetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-paid` }, body: JSON.stringify(requestBody) });
for (let attempt = 0; [409, 503].includes(paid.status) && attempt < 45; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  // A synchronous seller may briefly return while settlement is reconciling.
  // Reuse the original authorization for the same idempotency key; a bare retry
  // would correctly receive a fresh 402 and hide a subsequently published report.
  if (!capturedPaymentSignature) break;
  paid = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${idempotency}-paid`, "payment-signature": capturedPaymentSignature }, body: JSON.stringify(requestBody) });
}
const paymentResponse = paid.headers.get("payment-response");
const settlement = paymentResponse ? decodePaymentResponseHeader(paymentResponse) as { transaction?: string; status?: string } : null;
const report = await paid.json() as PaidResponse;
const reportId = report.report_id ?? report.detail?.report_id;
const decision = report.decision ?? report.detail?.decision;
if (!paid.ok || !reportId || !decision) throw new Error(`paid verify_release failed: HTTP ${paid.status} ${JSON.stringify(report)}`);

const receiptId = report.receipt?.receipt_id ?? report.detail?.receipt?.receipt_id;
const settlementRef = settlement?.transaction ?? report.receipt?.payload?.settlement_ref ?? report.detail?.receipt?.payload?.settlement_ref ?? null;
const verifyUrl = receiptId ? new URL(`/api/v1/verify-receipt?receipt_id=${encodeURIComponent(receiptId)}`, base).toString() : null;
let verifyReceipt: unknown = null;
if (verifyUrl) {
  const verified = await fetch(verifyUrl);
  verifyReceipt = await verified.json();
  if (!verified.ok || !(verifyReceipt as { signature_valid?: boolean; payload_hash_matches?: boolean }).signature_valid || !(verifyReceipt as { signature_valid?: boolean; payload_hash_matches?: boolean }).payload_hash_matches) throw new Error(`receipt verification failed: HTTP ${verified.status}`);
}

const database = createDatabase(config);
if (!database || !config.REPORT_TOKEN_SECRET) throw new Error("DATABASE_URL and REPORT_TOKEN_SECRET are required to record paid v5 evidence.");
const repository = new ReleaseRepository(database.sql, config.REPORT_TOKEN_SECRET);
try {
  await repository.audit(reportId, label, { customer_demand: customerDemand, mode, agent_id: mode === "agent-id" ? process.env.V5_AGENT_ID ?? "2013" : null });
  if (mode === "self-check") await repository.recordSelfCheck({
    reportId,
    receiptId: receiptId ?? null,
    decision,
    settlementRef,
    label,
    customerDemand,
    payload: { verify_url: verifyUrl, journey: report.journey ?? [], request: requestBody, receipt_verification: verifyReceipt } as unknown as JsonValue
  });
} finally {
  await database.close();
}

const finalBalance = await publicClient.getBalance({ address: account.address });
const finalUsdt = await publicClient.readContract({ address: config.RELEASE_PAYMENT_ASSET as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
console.log(JSON.stringify({
  label,
  mode,
  report_id: reportId,
  decision,
  receipt_id: receiptId ?? null,
  settlement_ref: settlementRef,
  verify_url: verifyUrl,
  journey: report.journey?.map((entry) => `${entry.step}:${entry.status}`) ?? [],
  payment_signature_captured: Boolean(capturedPaymentSignature),
  balances: { address: account.address, okb: formatEther(finalBalance), usdt0: formatUnits(finalUsdt, 6) }
}, null, 2));
