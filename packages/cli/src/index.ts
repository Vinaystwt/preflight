#!/usr/bin/env node
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import { wrapFetchWithPaymentFromConfig } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";

interface Options {
  command?: string;
  endpoint?: string;
  agentId?: string;
  authorizeBuyerProof: boolean;
  includeInGallery: boolean;
  walletKey?: `0x${string}`;
  json: boolean;
  receiptIdOrPath?: string;
  pubkeysUrl?: string;
  pubkeysPath?: string;
}

function usage(exitCode = 0): never {
  const text = `Usage:
  preflight verify <endpoint> [--agent-id <id>] [--authorize-buyer-proof] [--include-in-gallery] [--wallet-key <hex>] [--json]
  preflight verify-receipt <receipt-id-or-json-file> [--pubkeys-url <url>] [--pubkeys-file <path>] [--json]

Environment:
  PREFLIGHT_API_BASE     Defaults to https://api.usepreflight.xyz
  PREFLIGHT_WALLET_KEY   Alternative to --wallet-key
`;
  (exitCode ? console.error : console.log)(text);
  process.exit(exitCode);
}

function parse(argv: string[]): Options {
  const options: Options = { authorizeBuyerProof: false, includeInGallery: false, json: false };
  options.command = argv.shift();
  if (!options.command || options.command === "--help" || options.command === "-h") usage(0);
  if (options.command === "verify") {
    if (argv[0] === "--help" || argv[0] === "-h") usage(0);
    options.endpoint = argv.shift();
    if (!options.endpoint) usage(1);
  } else if (options.command === "verify-receipt") {
    if (argv[0] === "--help" || argv[0] === "-h") usage(0);
    options.receiptIdOrPath = argv.shift();
    if (!options.receiptIdOrPath) usage(1);
  } else {
    usage(1);
  }
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--agent-id") options.agentId = argv.shift();
    else if (flag === "--authorize-buyer-proof") options.authorizeBuyerProof = true;
    else if (flag === "--include-in-gallery") options.includeInGallery = true;
    else if (flag === "--wallet-key") options.walletKey = argv.shift() as `0x${string}` | undefined;
    else if (flag === "--pubkeys-url") options.pubkeysUrl = argv.shift();
    else if (flag === "--pubkeys-file") options.pubkeysPath = argv.shift();
    else if (flag === "--json") options.json = true;
    else if (flag === "--help" || flag === "-h") usage(0);
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return options;
}

function createPaidFetch(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: xLayer, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  return wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:196", client: new ExactEvmScheme(signer) }] });
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function canonicalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, Json>)[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value as Json));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function loadReceipt(input: string, apiBase: string): Promise<Record<string, unknown>> {
  if (input.endsWith(".json") || input.startsWith("/") || input.startsWith(".")) return await readJson(input) as Record<string, unknown>;
  const response = await fetch(`${apiBase}/api/v1/receipts/${encodeURIComponent(input)}`);
  if (!response.ok) throw new Error(`Receipt fetch failed: HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function loadPubkeys(options: Options, receipt: Record<string, unknown>, apiBase: string): Promise<Array<Record<string, unknown>>> {
  if (options.pubkeysPath) {
    const file = await readJson(options.pubkeysPath) as { keys?: Array<Record<string, unknown>> };
    return file.keys ?? [];
  }
  const verify = receipt.verify as { pubkeys_url?: string } | undefined;
  const url = options.pubkeysUrl ?? verify?.pubkeys_url ?? `${apiBase}/api/v1/pubkeys`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Public key fetch failed: HTTP ${response.status}`);
  const payload = await response.json() as { keys?: Array<Record<string, unknown>> };
  return payload.keys ?? [];
}

function verifyReceipt(receipt: Record<string, unknown>, keys: Array<Record<string, unknown>>) {
  const payload = receipt.payload;
  if (!payload || typeof payload !== "object") throw new Error("Receipt payload is missing.");
  const verify = receipt.verify as { payload_hash?: string } | undefined;
  const canonicalBytes = Buffer.from(canonicalJson(payload), "utf8");
  const payloadHash = `sha256:${sha256Hex(canonicalBytes)}`;
  const payloadHashMatches = payloadHash === verify?.payload_hash;
  const keyId = String(receipt.key_id ?? "");
  const key = keys.find((candidate) => candidate.key_id === keyId) ?? keys.find((candidate) => candidate.status === "active");
  let signatureValid = false;
  if (key?.public_key_base64 && typeof receipt.signature === "string") {
    const publicKey = createPublicKey({ key: Buffer.from(String(key.public_key_base64), "base64"), format: "der", type: "spki" });
    signatureValid = verifySignature(null, canonicalBytes, publicKey, Buffer.from(receipt.signature, "base64"));
  }
  const policyRecognized = /^preflight\.release-policy\./.test(String((payload as { policy_version?: string }).policy_version ?? ""));
  return { payloadHashMatches, signatureValid, policyRecognized, key_id: keyId, payload_hash: payloadHash };
}

function decisionExitCode(decision: unknown): number {
  if (decision === "RELEASE") return 0;
  if (decision === "BLOCK") return 1;
  if (decision === "UNKNOWN") return 2;
  return 3;
}

async function runVerify(options: Options, apiBase: string): Promise<number> {
  const walletKey = options.walletKey ?? process.env.PREFLIGHT_WALLET_KEY as `0x${string}` | undefined;
  if (!walletKey || !/^0x[a-fA-F0-9]{64}$/.test(walletKey)) throw new Error("Provide --wallet-key or PREFLIGHT_WALLET_KEY with a 32-byte hex private key.");
  const body: Record<string, unknown> = {
    schema_version: "preflight.verify-release-request.v1",
    include_in_gallery: options.includeInGallery
  };
  if (options.agentId) body.agent_id = options.agentId;
  else body.endpoint = options.endpoint;
  if (options.authorizeBuyerProof) {
    body.authorize_buyer_proof = true;
    body.owner_attestation = true;
  }
  const paidFetch = createPaidFetch(walletKey);
  const response = await paidFetch(`${apiBase}/api/v1/verify-release`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `cli-${randomUUID()}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    console.error(JSON.stringify(payload, null, 2));
    return 3;
  }
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    const access = payload.report_access as { report_url?: string; access_token?: string } | undefined;
    console.log(`decision=${payload.decision}`);
    console.log(`report_id=${payload.report_id}`);
    if (payload.receipt && typeof payload.receipt === "object") console.log(`receipt_id=${(payload.receipt as { receipt_id?: string }).receipt_id}`);
    if (access?.report_url && access.access_token) console.log(`capability_url=${access.report_url}#access_token=${access.access_token}`);
  }
  return decisionExitCode(payload.decision);
}

async function runVerifyReceipt(options: Options, apiBase: string): Promise<number> {
  const receipt = await loadReceipt(options.receiptIdOrPath!, apiBase);
  const keys = await loadPubkeys(options, receipt, apiBase);
  const result = verifyReceipt(receipt, keys);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`receipt_id=${receipt.receipt_id}`);
    console.log(`payload_hash=${result.payloadHashMatches ? "ok" : "mismatch"}`);
    console.log(`signature=${result.signatureValid ? "valid" : "invalid"}`);
    console.log(`policy=${result.policyRecognized ? "recognized" : "unknown"}`);
    console.log(`key_id=${result.key_id}`);
  }
  return result.payloadHashMatches && result.signatureValid && result.policyRecognized ? 0 : 3;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const apiBase = (process.env.PREFLIGHT_API_BASE ?? "https://api.usepreflight.xyz").replace(/\/$/, "");
  const exitCode = options.command === "verify-receipt" ? await runVerifyReceipt(options, apiBase) : await runVerify(options, apiBase);
  process.exit(exitCode);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(3);
});
