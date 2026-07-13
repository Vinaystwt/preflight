import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createReceiptSigner, verifyReceiptSignature } from "../src/receipts/signer.js";

function privateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

describe("receipt signer", () => {
  it("signs canonical receipt payloads with a verifiable detached Ed25519 signature", () => {
    const config = loadConfig({ NODE_ENV: "test", RECEIPT_SIGNING_KEY: privateKeyBase64(), RECEIPT_KEY_ID: "test-key-1" });
    const signer = createReceiptSigner(config);
    expect(signer).not.toBeNull();
    const receipt = signer!.issue({
      report_id: "pfr_01KTESTRECEIPT000000000000",
      decision: "RELEASE",
      manifest_hash: `sha256:${"1".repeat(64)}`,
      snapshot_hash: `sha256:${"2".repeat(64)}`,
      policy_version: "preflight.release-policy.v1",
      settlement_ref: `0x${"3".repeat(64)}`,
      payer: "0x1111111111111111111111111111111111111111",
      price_usdt: "0.10",
      target_endpoint: "https://api.example.com/verify",
      pay_to: "0x7bb9c4d6e06b9dee783eb31ff73d9345803efbd2",
      issued_at: "2026-07-13T00:00:00.000Z"
    });
    expect(receipt).toMatchObject({ receipt_id: expect.stringMatching(/^rcpt_[a-f0-9]{32}$/), signature_alg: "Ed25519", key_id: "test-key-1" });
    expect(verifyReceiptSignature(receipt.payload, receipt.signature, signer!.publicKeyBase64)).toBe(true);
    expect(receipt.verify.payload_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is disabled when RECEIPTS_ENABLED=false", () => {
    const config = loadConfig({ NODE_ENV: "test", RECEIPTS_ENABLED: "false", RECEIPT_SIGNING_KEY: privateKeyBase64() });
    expect(createReceiptSigner(config)).toBeNull();
  });
});
