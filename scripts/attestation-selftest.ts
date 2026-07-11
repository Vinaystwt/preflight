import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { ATTESTATION_ABI, canonicalReportHash } from "../src/chain/attest.js";
import type { ReportEnvelope } from "../src/types.js";

const rpc = process.env.X_LAYER_RPC_URL ?? "http://127.0.0.1:8545";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const address = process.env.ATTESTATION_CONTRACT_ADDRESS as Hex | undefined;
if (!privateKey || !address) throw new Error("DEPLOYER_PRIVATE_KEY and ATTESTATION_CONTRACT_ADDRESS are required");
const chainId = Number(process.env.CHAIN_ID ?? "31337");
const chain = defineChain({ id: chainId, name: "Attestation self-test", nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const account = privateKeyToAccount(privateKey);
const transport = http(rpc);
const wallet = createWalletClient({ account, chain, transport });
const publicClient = createPublicClient({ chain, transport });
const report: ReportEnvelope = { report_id: "pf_local_attestation", tool: "run_preflight", target: "https://golden.example/run", verdict: "GO", score: 100,
  findings: [], attestation_tx: null, report_url: "https://usepreflight.xyz/r/pf_local_attestation", generated_at: "2026-07-10T00:00:00.000Z" };
const reportHash = canonicalReportHash(report);
const transaction = await wallet.writeContract({ address, abi: ATTESTATION_ABI, functionName: "attest", args: [reportHash] });
const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction });
if (receipt.status !== "success") throw new Error("local attestation reverted");
const eventAbi = [{ type: "event", name: "Attested", inputs: [{ indexed: true, name: "reportHash", type: "bytes32" }, { indexed: true, name: "attester", type: "address" }, { indexed: false, name: "ts", type: "uint256" }] }] as const;
const decoded = receipt.logs.map((log) => { try { return decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics }); } catch { return null; } }).find(Boolean);
if (!decoded || decoded.args.reportHash !== reportHash || decoded.args.attester.toLowerCase() !== account.address.toLowerCase()) throw new Error("Attested event did not match the canonical report hash and sender");
console.log(JSON.stringify({ result: "PASS", chain_id: chainId, contract: address, transaction, report_hash: reportHash, attester: account.address }));
