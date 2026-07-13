#!/usr/bin/env node
import { randomUUID } from "node:crypto";
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
}

function usage(exitCode = 0): never {
  const text = `Usage:
  preflight verify <endpoint> [--agent-id <id>] [--authorize-buyer-proof] [--include-in-gallery] [--wallet-key <hex>] [--json]

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
  if (options.command !== "verify") usage(1);
  options.endpoint = argv.shift();
  if (!options.endpoint) usage(1);
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--agent-id") options.agentId = argv.shift();
    else if (flag === "--authorize-buyer-proof") options.authorizeBuyerProof = true;
    else if (flag === "--include-in-gallery") options.includeInGallery = true;
    else if (flag === "--wallet-key") options.walletKey = argv.shift() as `0x${string}` | undefined;
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

async function main() {
  const options = parse(process.argv.slice(2));
  const walletKey = options.walletKey ?? process.env.PREFLIGHT_WALLET_KEY as `0x${string}` | undefined;
  if (!walletKey || !/^0x[a-fA-F0-9]{64}$/.test(walletKey)) throw new Error("Provide --wallet-key or PREFLIGHT_WALLET_KEY with a 32-byte hex private key.");
  const apiBase = (process.env.PREFLIGHT_API_BASE ?? "https://api.usepreflight.xyz").replace(/\/$/, "");
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
    process.exit(2);
  }
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else {
    const access = payload.report_access as { report_url?: string; access_token?: string } | undefined;
    console.log(`decision=${payload.decision}`);
    console.log(`report_id=${payload.report_id}`);
    if (payload.receipt && typeof payload.receipt === "object") console.log(`receipt_id=${(payload.receipt as { receipt_id?: string }).receipt_id}`);
    if (access?.report_url && access.access_token) console.log(`capability_url=${access.report_url}#access_token=${access.access_token}`);
  }
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
