import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";
import { evidenceArtifact, type EvidenceArtifact } from "../release/evidence.js";
import type { ReleaseRepository } from "../release/repository.js";

interface AcceptsEntry {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: JsonValue;
}
interface ChallengeBody { x402Version?: number; accepts?: AcceptsEntry[] }
interface AuthorizationRecord {
  wallet_address: string;
  amount_atomic: string;
  amount_usdt: string;
  payTo: string;
  network: string;
  asset: string;
  target_daily_cap_usdt: number;
  global_daily_cap_usdt: number;
  terms_hash: string;
}
export interface BuyerProofClient {
  walletAddress: string;
  prove(input: { runId: string; target: string; body: unknown; audit: (event: string, metadata: Record<string, JsonValue>) => Promise<void> }): Promise<EvidenceArtifact>;
}

function paymentRequired(response: Response): string | null {
  return response.headers.get("payment-required") ?? response.headers.get("PAYMENT-REQUIRED");
}
function decodeChallenge(encoded: string): ChallengeBody {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ChallengeBody;
}
function selectTerms(challenge: ChallengeBody, config: Config): AcceptsEntry | null {
  return challenge.accepts?.find((entry) => entry.network === config.RELEASE_PAYMENT_NETWORK && entry.asset?.toLowerCase() === config.RELEASE_PAYMENT_ASSET.toLowerCase() && typeof entry.amount === "string" && typeof entry.payTo === "string") ?? null;
}
function safeJson(text: string): JsonValue {
  try {
    const parsed = JSON.parse(text) as JsonValue;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const object = parsed as Record<string, JsonValue>;
      return { schema_version: object.schema_version, report_id: object.report_id, decision: object.decision } as JsonValue;
    }
    return parsed;
  } catch {
    return { unparseable: true, bytes: text.length };
  }
}
function artifact(target: string, normalized: Record<string, JsonValue>) {
  return evidenceArtifact("BUYER_PROOF", target, normalized as JsonValue);
}
function replaySafe(status: number | null, paymentRequiredHeader: boolean, paymentResponseHeader: boolean): boolean {
  if (status === 409) return !paymentResponseHeader;
  if (status === 402) return paymentRequiredHeader && !paymentResponseHeader;
  return false;
}

export function createBuyerProofClient(config: Config, repository: ReleaseRepository, fetchImplementation: typeof fetch = fetch): BuyerProofClient | null {
  if (!config.BUYER_WALLET_KEY) return null;
  const account = privateKeyToAccount(config.BUYER_WALLET_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: xLayer, transport: http(config.X_LAYER_RPC_URL) });
  const signer = toClientEvmSigner(account, publicClient);

  return {
    walletAddress: account.address,
    async prove(input) {
      const idempotency = `buyer-proof-${randomUUID()}`;
      const challengeResponse = await fetchImplementation(input.target, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": `${idempotency}-challenge` },
        body: JSON.stringify(input.body)
      });
      const encoded = paymentRequired(challengeResponse);
      if (challengeResponse.status !== 402 || !encoded) {
        await input.audit("BUYER_PROOF_FAILED", { reason: "BUYER_CHALLENGE_MISSING", status: challengeResponse.status });
        return artifact(input.target, { authorized: false, status: "BUYER_CHALLENGE_MISSING", delivery_status: challengeResponse.status });
      }
      const challenge = decodeChallenge(encoded);
      const terms = selectTerms(challenge, config);
      const termsHash = canonicalHash(challenge as unknown as JsonValue);
      if (!terms?.amount || !terms.payTo || !terms.network || !terms.asset) {
        await input.audit("BUYER_PROOF_FAILED", { reason: "BUYER_TERMS_INVALID", terms_hash: termsHash });
        return artifact(input.target, { authorized: false, status: "BUYER_TERMS_INVALID", terms_hash: termsHash });
      }
      const amountUsdt = (Number(terms.amount) / 1_000_000).toFixed(6);
      const authorization: AuthorizationRecord = {
        wallet_address: account.address, amount_atomic: terms.amount, amount_usdt: amountUsdt, payTo: terms.payTo, network: terms.network, asset: terms.asset,
        target_daily_cap_usdt: config.BUYER_TARGET_DAILY_CAP_USDT, global_daily_cap_usdt: config.BUYER_GLOBAL_DAILY_CAP_USDT, terms_hash: termsHash
      };
      await input.audit("BUYER_AUTHORIZED", authorization as unknown as Record<string, JsonValue>);
      const reservation = await repository.reserveBuyerProofSpend(input.runId, { target: input.target, amountAtomic: terms.amount, termsHash, idempotencyKey: idempotency, targetCapUsdt: config.BUYER_TARGET_DAILY_CAP_USDT, globalCapUsdt: config.BUYER_GLOBAL_DAILY_CAP_USDT });
      if (!reservation.ok) {
        await input.audit("BUYER_CAP_EXCEEDED", { amount_usdt: reservation.amountUsdt, target_spent_usdt: reservation.targetSpent, global_spent_usdt: reservation.globalSpent });
        return artifact(input.target, { authorized: true, status: "BUYER_CAP_EXCEEDED", ...(authorization as unknown as Record<string, JsonValue>), target_spent_usdt: reservation.targetSpent, global_spent_usdt: reservation.globalSpent });
      }

      let capturedSignature: string | null = null;
      const guardedFetch: typeof fetch = async (resource, init) => {
        const headers = new Headers(init?.headers ?? (resource instanceof Request ? resource.headers : undefined));
        const signature = headers.get("payment-signature");
        if (signature) capturedSignature = signature;
        const response = await fetchImplementation(resource, init);
        const replayedChallenge = paymentRequired(response);
        if (response.status === 402 && replayedChallenge) {
          const replayedHash = canonicalHash(decodeChallenge(replayedChallenge) as unknown as JsonValue);
          if (replayedHash !== termsHash) throw new Error("BUYER_TERMS_CHANGED");
        }
        return response;
      };
      const paidFetch = wrapFetchWithPaymentFromConfig(guardedFetch, { schemes: [{ network: config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, client: new ExactEvmScheme(signer) }] });
      try {
        const paidIdempotency = `${idempotency}-paid`;
        let paid = await paidFetch(input.target, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": paidIdempotency }, body: JSON.stringify(input.body) });
        for (let attempt = 0; [409, 503].includes(paid.status) && attempt < 45; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          paid = await fetchImplementation(input.target, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": paidIdempotency }, body: JSON.stringify(input.body) });
        }
        const text = await paid.text();
        const rawReceipt = paid.headers.get("payment-response");
        const receipt = rawReceipt ? decodePaymentResponseHeader(rawReceipt) : null;
        const settlement = receipt?.transaction ?? (paid.ok ? "target_report_published" : receipt?.status ?? null);
        const receiptStatus = receipt?.status ?? (paid.ok ? "success" : null);
        await repository.updateBuyerProofSpend(reservation.id, paid.ok ? "settled" : "failed", typeof settlement === "string" ? settlement : undefined);
        await input.audit("BUYER_PAID", { status: paid.status, settlement_reference: typeof settlement === "string" ? settlement : null });
        await input.audit("BUYER_SETTLED", { status: receiptStatus ?? "unknown", settlement_reference: typeof settlement === "string" ? settlement : null });
        let duplicateStatus: number | null = null;
        let duplicatePaymentRequired = false;
        let duplicatePaymentResponse = false;
        let duplicateResponse: JsonValue | null = null;
        if (capturedSignature) {
          const duplicate = await fetchImplementation(input.target, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "idempotency-key": `${idempotency}-duplicate`, "payment-signature": capturedSignature }, body: JSON.stringify(input.body) });
          duplicateStatus = duplicate.status;
          duplicatePaymentRequired = Boolean(paymentRequired(duplicate));
          duplicatePaymentResponse = Boolean(duplicate.headers.get("payment-response") ?? duplicate.headers.get("PAYMENT-RESPONSE"));
          duplicateResponse = safeJson(await duplicate.text().catch(() => ""));
        }
        const duplicateReplaySafe = replaySafe(duplicateStatus, duplicatePaymentRequired, duplicatePaymentResponse);
        await input.audit("BUYER_REPLAYED", { duplicate_status: duplicateStatus, duplicate_payment_required: duplicatePaymentRequired, duplicate_payment_response: duplicatePaymentResponse, duplicate_replay_safe: duplicateReplaySafe });
        await input.audit("BUYER_DELIVERED", { status: paid.status });
        return artifact(input.target, { authorized: true, status: paid.ok && duplicateReplaySafe ? "DELIVERED" : paid.ok ? "DUPLICATE_REPLAY_NOT_REJECTED" : "DEEP_CALL_FAILED", ...(authorization as unknown as Record<string, JsonValue>), delivery_status: paid.status, settlement_reference: typeof settlement === "string" ? settlement : null, receipt_status: receiptStatus, duplicate_replay_status: duplicateStatus, duplicate_replay_payment_required: duplicatePaymentRequired, duplicate_replay_payment_response: duplicatePaymentResponse, duplicate_replay_safe: duplicateReplaySafe, duplicate_replay_response: duplicateResponse, response: safeJson(text) });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "BUYER_PROOF_FAILED";
        await repository.updateBuyerProofSpend(reservation.id, message === "BUYER_TERMS_CHANGED" ? "aborted" : "failed");
        await input.audit(message === "BUYER_TERMS_CHANGED" ? "BUYER_TERMS_CHANGED" : "BUYER_PROOF_FAILED", { reason: message });
        return artifact(input.target, { authorized: true, status: message === "BUYER_TERMS_CHANGED" ? "BUYER_TERMS_CHANGED" : "BUYER_PROOF_FAILED", ...(authorization as unknown as Record<string, JsonValue>), error_code: message });
      }
    }
  };
}
