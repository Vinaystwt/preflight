import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { Config } from "../config.js";
import { canonicalJson, type JsonValue } from "../contracts/canonical.js";
import type { ReleaseDecision } from "../contracts/release-gate.js";

export interface ReceiptPayloadV1 {
  type: "preflight.receipt.v1";
  receipt_id: string;
  report_id: string;
  decision: ReleaseDecision;
  manifest_hash: string;
  snapshot_hash: string;
  policy_version: string;
  settlement_ref: string;
  payer: string | null;
  price_usdt: string;
  target_fingerprint: string;
  issued_at: string;
  key_id: string;
  chain_anchor: { tx: string; contract: string } | null;
}

export interface ReceiptEnvelopeV1 {
  receipt_id: string;
  payload: ReceiptPayloadV1;
  signature: string;
  signature_alg: "Ed25519";
  key_id: string;
  verify: {
    canonicalization: "preflight.canonical-json.v1";
    payload_hash: string;
    pubkeys_url: string;
  };
}

export interface ReceiptInput {
  report_id: string;
  decision: ReleaseDecision;
  manifest_hash: string;
  snapshot_hash: string;
  policy_version: string;
  settlement_ref: string;
  payer?: string | null;
  price_usdt: string;
  target_endpoint: string;
  pay_to?: string | null;
  issued_at?: string;
  chain_anchor?: { tx: string; contract: string } | null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadHash(payload: JsonValue): string {
  return `sha256:${sha256Hex(canonicalJson(payload))}`;
}

function targetFingerprint(endpoint: string, payTo?: string | null): string {
  const url = new URL(endpoint);
  return `sha256:${sha256Hex(`${url.protocol}//${url.host}|${payTo?.toLowerCase() ?? "no-payto"}`)}`;
}

function privateKeyFromBase64(value: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
}

export class ReceiptSigner {
  private readonly privateKey: KeyObject;
  readonly publicKeyBase64: string;
  readonly algorithm = "Ed25519" as const;

  constructor(readonly keyId: string, privateKeyBase64: string, private readonly publicDomain: string) {
    this.privateKey = privateKeyFromBase64(privateKeyBase64);
    this.publicKeyBase64 = createPublicKey(this.privateKey).export({ format: "der", type: "spki" }).toString("base64");
  }

  issue(input: ReceiptInput): ReceiptEnvelopeV1 {
    const issuedAt = input.issued_at ?? new Date().toISOString();
    const base = {
      type: "preflight.receipt.v1" as const,
      report_id: input.report_id,
      decision: input.decision,
      manifest_hash: input.manifest_hash,
      snapshot_hash: input.snapshot_hash,
      policy_version: input.policy_version,
      settlement_ref: input.settlement_ref,
      payer: input.payer ?? null,
      price_usdt: input.price_usdt,
      target_fingerprint: targetFingerprint(input.target_endpoint, input.pay_to),
      issued_at: issuedAt,
      key_id: this.keyId,
      chain_anchor: input.chain_anchor ?? null
    };
    const receiptId = `rcpt_${sha256Hex(canonicalJson(base as unknown as JsonValue)).slice(0, 32)}`;
    const payload: ReceiptPayloadV1 = { ...base, receipt_id: receiptId };
    const canonical = canonicalJson(payload as unknown as JsonValue);
    const signature = sign(null, Buffer.from(canonical), this.privateKey).toString("base64");
    return {
      receipt_id: receiptId,
      payload,
      signature,
      signature_alg: "Ed25519",
      key_id: this.keyId,
      verify: {
        canonicalization: "preflight.canonical-json.v1",
        payload_hash: payloadHash(payload as unknown as JsonValue),
        pubkeys_url: `https://${this.publicDomain}/api/v1/pubkeys`
      }
    };
  }
}

export function createReceiptSigner(config: Config): ReceiptSigner | null {
  if (!config.RECEIPTS_ENABLED || !config.RECEIPT_SIGNING_KEY) return null;
  return new ReceiptSigner(config.RECEIPT_KEY_ID, config.RECEIPT_SIGNING_KEY, config.PUBLIC_DOMAIN);
}

export function verifyReceiptSignature(payload: ReceiptPayloadV1, signatureBase64: string, publicKeyBase64: string): boolean {
  const publicKey = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
  return verify(null, Buffer.from(canonicalJson(payload as unknown as JsonValue)), publicKey, Buffer.from(signatureBase64, "base64"));
}
