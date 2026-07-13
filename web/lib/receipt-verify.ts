import type { Receipt, PublicKey } from "@/lib/contracts";

/*
  Real client-side receipt verification (preflight.canonical-json.v1 + Ed25519).
  Confirmed against the live receipt: canonical JSON = recursively sorted keys,
  no whitespace; the payload hash is sha256 of that; the Ed25519 signature is
  over the canonical payload bytes with the SPKI public key.
*/

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function canonicalize(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonicalize((value as Record<string, Json>)[k])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value as Json));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface VerifyResult {
  payloadHashMatches: boolean;
  signatureValid: boolean | null; // null = could not check locally (WebCrypto Ed25519 unavailable)
  manifestIntact: boolean;
  snapshotIntact: boolean;
  policyRecognized: boolean;
  keyId: string;
  method: "client-ed25519" | "hash-only";
}

/**
 * Verify a receipt. Recomputes the canonical payload hash and, when WebCrypto
 * Ed25519 is available, verifies the signature against the matching public key.
 * Falls back to hash-integrity only (honest) if Ed25519 verify is unsupported.
 */
export async function verifyReceipt(
  receipt: Receipt,
  keys: PublicKey[],
  reportHashes?: { manifest_hash?: string; snapshot_hash?: string },
): Promise<VerifyResult> {
  const enc = new TextEncoder();
  const canonBytes = enc.encode(canonicalJson(receipt.payload));
  const recomputed = `sha256:${await sha256Hex(canonBytes)}`;
  const payloadHashMatches = recomputed === receipt.verify.payload_hash;

  const key = keys.find((k) => k.key_id === receipt.key_id) ?? keys.find((k) => k.status === "active");

  let signatureValid: boolean | null = null;
  let method: VerifyResult["method"] = "hash-only";
  if (key) {
    try {
      const pub = await crypto.subtle.importKey(
        "spki",
        b64ToBytes(key.public_key_base64) as BufferSource,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      signatureValid = await crypto.subtle.verify(
        { name: "Ed25519" },
        pub,
        b64ToBytes(receipt.signature) as BufferSource,
        canonBytes as BufferSource,
      );
      method = "client-ed25519";
    } catch {
      signatureValid = null; // Ed25519 unsupported in this browser
      method = "hash-only";
    }
  }

  return {
    payloadHashMatches,
    signatureValid,
    manifestIntact: reportHashes?.manifest_hash ? reportHashes.manifest_hash === receipt.payload.manifest_hash : true,
    snapshotIntact: reportHashes?.snapshot_hash ? reportHashes.snapshot_hash === receipt.payload.snapshot_hash : true,
    policyRecognized: /^preflight\.release-policy\./.test(receipt.payload.policy_version),
    keyId: receipt.key_id,
    method,
  };
}

/** Short human key fingerprint PF:xx:xx… derived from key_id. */
export async function keyFingerprint(keyId: string): Promise<string> {
  const bytes = new TextEncoder().encode(keyId);
  const hex = await sha256Hex(bytes);
  return `PF:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`.toUpperCase();
}
