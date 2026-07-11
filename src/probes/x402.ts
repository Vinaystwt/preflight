import { z } from "zod";
import type { Finding, ProbeResult } from "../types.js";
import { assertPublicHttps, httpsRequest } from "./transport.js";

// Frozen from @okxweb3/x402-core@0.1.0 dist/cjs/httpFacilitatorClient-XO4WH8NI.d.ts:649-670.
// Header names are frozen from dist/cjs/client/index.js:519,529,542.
export const X402_V2_REQUIREMENTS_FIELDS = ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"] as const;
export const X402_HEADERS = { challenge: "payment-required", credential: "payment-signature", receipt: "payment-response" } as const;
export const X_LAYER_NETWORK = "eip155:196";
export const X_LAYER_USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const USDT0_EIP712_DOMAIN = { name: "USD₮0", version: "1" } as const;

const requirements = z.object({
  scheme: z.string().min(1),
  network: z.string().regex(/^.+:.+$/),
  asset: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown())
});
const challenge = z.object({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: z.object({ url: z.string().min(1), description: z.string().optional(), mimeType: z.string().optional() }),
  accepts: z.array(requirements).min(1),
  extensions: z.record(z.string(), z.unknown()).optional()
});

export const expectedPayment = z.object({
  amount: z.string().regex(/^\d+$/).optional(),
  asset: z.string().min(1).optional(),
  network: z.string().min(1).optional(),
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
}).optional();
export type ExpectedPayment = z.infer<typeof expectedPayment>;

function sameDomain(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 2 && value.name === USDT0_EIP712_DOMAIN.name && value.version === USDT0_EIP712_DOMAIN.version;
}

export function evaluateX402Challenge(status: number, encoded: string | undefined, expected?: ExpectedPayment): ProbeResult {
  if (status !== 402) {
    return { findings: [{ code: "X402_MISSING", severity: "high", evidence: `Unpaid HTTP POST returned HTTP ${status}`, fix: "Protect the registered service route with x402 middleware and return HTTP 402 before execution." }], evidence: { status } };
  }
  if (!encoded) {
    return { findings: [{ code: "X402_MALFORMED", severity: "high", evidence: "402 response omitted PAYMENT-REQUIRED", fix: "Return a base64url PAYMENT-REQUIRED header containing x402 v2 JSON." }], evidence: { status: 402 } };
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch {
    return { findings: [{ code: "X402_MALFORMED", severity: "high", evidence: "PAYMENT-REQUIRED was not base64url JSON", fix: "Encode the x402 v2 challenge in PAYMENT-REQUIRED." }], evidence: {} };
  }
  const parsed = challenge.safeParse(value);
  if (!parsed.success) {
    return { findings: [{ code: "X402_MALFORMED", severity: "high", evidence: parsed.error.message, fix: `Include an accepts[] entry with all required fields: ${X402_V2_REQUIREMENTS_FIELDS.join(", ")}.` }], evidence: { challenge: value } };
  }

  const wantedNetwork = expected?.network ?? X_LAYER_NETWORK;
  const wantedAsset = (expected?.asset ?? X_LAYER_USDT0).toLowerCase();
  const candidates = parsed.data.accepts.filter((item) => item.scheme === "exact");
  const selected = candidates.find((item) => item.network === wantedNetwork
    && item.asset.toLowerCase() === wantedAsset
    && (!expected?.amount || item.amount === expected.amount)
    && (!expected?.payTo || item.payTo.toLowerCase() === expected.payTo.toLowerCase()))
    ?? candidates[0] ?? parsed.data.accepts[0]!;
  const findings: Finding[] = [{
    code: "SURFACE_X402_ROUTE_FORM",
    severity: "info",
    evidence: "Registered HTTP route returned an x402 v2 challenge to a plain JSON POST.",
    fix: "No action required; this is the canonical paid A2MCP route form."
  }];
  if (expected?.amount && selected.amount !== expected.amount) findings.push({ code: "X402_AMOUNT_MISMATCH", severity: "high", evidence: `Expected ${expected.amount}, got ${selected.amount}`, fix: "Configure the advertised atomic-unit amount correctly." });
  if (selected.asset.toLowerCase() !== wantedAsset) findings.push({ code: "X402_WRONG_ASSET", severity: "high", evidence: `Expected ${expected?.asset ?? X_LAYER_USDT0}, got ${selected.asset}`, fix: "Configure the X Layer USD₮0 settlement asset." });
  if (selected.network !== wantedNetwork) findings.push({ code: "X402_WRONG_NETWORK", severity: "high", evidence: `Expected ${wantedNetwork}, got ${selected.network}`, fix: "Use the expected CAIP-2 network identifier." });
  if (expected?.payTo && selected.payTo.toLowerCase() !== expected.payTo.toLowerCase()) findings.push({ code: "X402_PAYTO_MISMATCH", severity: "high", evidence: `Expected ${expected.payTo}, got ${selected.payTo}`, fix: "Configure the intended payTo wallet." });
  if (!sameDomain(selected.extra)) findings.push({ code: "X402_BAD_EIP712_DOMAIN", severity: "high", evidence: `Expected ${JSON.stringify(USDT0_EIP712_DOMAIN)}, got ${JSON.stringify(selected.extra)}`, fix: "Configure the exact USD₮0 EIP-712 domain." });
  return { findings, evidence: { status: 402, surface_form: "x402_route", payment_requirements: selected, accepts: parsed.data.accepts } };
}

export async function probeX402(target: string, expected?: ExpectedPayment): Promise<ProbeResult> {
  try {
    const url = await assertPublicHttps(target);
    const response = await httpsRequest(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}" });
    const raw = response.headers[X402_HEADERS.challenge];
    const encoded = Array.isArray(raw) ? raw[0] : raw;
    return evaluateX402Challenge(response.status, encoded, expected);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown x402 error";
    return { findings: [{ code: "X402_MALFORMED", severity: "high", evidence: message, fix: "Expose a public HTTPS x402 endpoint." }], evidence: { error: message } };
  }
}
