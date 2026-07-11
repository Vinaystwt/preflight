import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import type { Config } from "../config.js";
import type { AttestationJob, Database } from "../db/client.js";
import type { ReportEnvelope } from "../types.js";

export const ATTESTATION_ABI = [{
  type: "function",
  name: "attest",
  stateMutability: "nonpayable",
  inputs: [{ name: "h", type: "bytes32" }],
  outputs: []
}] as const;

function canonicalValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalReportHash(report: ReportEnvelope): Hex {
  return keccak256(stringToHex(stableStringify(report)));
}

export interface AttestationQueueState {
  enabled: boolean;
  status: "disabled" | "idle" | "processing" | "ok" | "error";
  lastError: string | null;
}

interface QueueLogger {
  info(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export type AttestationSubmitter = (job: AttestationJob) => Promise<Hex>;

export function startAttestationQueue(config: Config, database: Database | null, logger: QueueLogger, submitter?: AttestationSubmitter): { state: AttestationQueueState; stop(): void } {
  const state: AttestationQueueState = { enabled: false, status: "disabled", lastError: null };
  if (!database || !config.DEPLOYER_PRIVATE_KEY || !config.ATTESTATION_CONTRACT_ADDRESS) return { state, stop() {} };
  state.enabled = true;
  state.status = "idle";
  const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY as Hex);
  const transport = http(config.X_LAYER_RPC_URL);
  const publicClient = createPublicClient({ chain: xLayer, transport });
  const walletClient = createWalletClient({ account, chain: xLayer, transport });
  const submit = submitter ?? (async (job: AttestationJob): Promise<Hex> => {
    const transaction = await walletClient.writeContract({ address: config.ATTESTATION_CONTRACT_ADDRESS as Hex, abi: ATTESTATION_ABI, functionName: "attest", args: [job.report_hash as Hex] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transaction, confirmations: 1, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("attestation transaction reverted");
    return transaction;
  });
  let stopped = false;
  let running = false;

  const processJob = async (job: AttestationJob): Promise<void> => {
    try {
      const transaction = await submit(job);
      logger.info({ event: "attestation_submitted", check_id: job.check_id, report_hash: job.report_hash, tx_hash: transaction }, "attestation transaction submitted");
      await database.completeAttestation(job.id, job.check_id, transaction);
      state.status = "ok";
      state.lastError = null;
      logger.info({ event: "attestation_confirmed", check_id: job.check_id, report_hash: job.report_hash, tx_hash: transaction }, "attestation confirmed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown attestation error";
      const backoffSeconds = Math.min(3_600, 2 ** Math.min(job.attempts, 10));
      await database.retryAttestation(job.id, message, backoffSeconds);
      state.status = "error";
      state.lastError = message;
      logger.error({ event: "attestation_failed", check_id: job.check_id, report_hash: job.report_hash, retry_in_s: backoffSeconds, err: error }, "attestation attempt failed");
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const jobs = await database.claimAttestations(1);
      if (!jobs.length && state.status !== "error") state.status = "idle";
      for (const job of jobs) {
        state.status = "processing";
        await processJob(job);
      }
    } catch (error) {
      state.status = "error";
      state.lastError = error instanceof Error ? error.message : "unknown queue error";
      logger.error({ event: "attestation_queue_error", err: error }, "attestation queue tick failed");
    } finally { running = false; }
  };

  void tick();
  const timer = setInterval(() => void tick(), config.ATTESTATION_POLL_INTERVAL_MS);
  timer.unref();
  return { state, stop() { stopped = true; clearInterval(timer); } };
}
