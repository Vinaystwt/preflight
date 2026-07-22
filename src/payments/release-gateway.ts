import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SettleStatusResponse } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { Config } from "../config.js";
import { canonicalHash, type JsonValue } from "../contracts/canonical.js";

export type ReleasePaymentProtocol = "v2" | "v1";

export interface ReleasePaymentAuthorization {
  protocol: ReleasePaymentProtocol;
  requestHeaderName: "PAYMENT-SIGNATURE" | "X-PAYMENT";
  responseHeaderName: "PAYMENT-RESPONSE" | "X-PAYMENT-RESPONSE";
  payload: PaymentPayload;
  fingerprint: string;
}

type IncomingHeaders = Record<string, string | string[] | number | undefined>;

function singleHeader(headers: IncomingHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function decodeBase64Json(header: string): unknown {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(header)) throw new Error("malformed_header");
  const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLegacyXPayment(header: string, requirements: PaymentRequirements[]): PaymentPayload {
  const decoded = decodeBase64Json(header);
  if (!isRecord(decoded)) throw new Error("malformed_header");
  if (decoded.x402Version !== 1) throw new Error("unsupported_protocol_version");
  if (typeof decoded.scheme !== "string" || typeof decoded.network !== "string" || !isRecord(decoded.payload)) throw new Error("malformed_header");
  if (typeof decoded.payload.signature !== "string" || !isRecord(decoded.payload.authorization)) throw new Error("malformed_header");
  const matched = requirements.find((item) => item.scheme === decoded.scheme && item.network === decoded.network);
  if (!matched) throw new Error("requirements_mismatch");
  return {
    x402Version: 2,
    accepted: matched,
    payload: {
      signature: decoded.payload.signature,
      authorization: decoded.payload.authorization
    }
  } as PaymentPayload;
}

function fingerprint(payload: PaymentPayload): string {
  return canonicalHash({ accepted: payload.accepted, payload: payload.payload } as unknown as JsonValue);
}

export function decodeReleasePaymentAuthorization(headers: IncomingHeaders, requirements: PaymentRequirements[], decodeV2: (header: string) => PaymentPayload = decodePaymentSignatureHeader): ReleasePaymentAuthorization | null {
  const v2Header = singleHeader(headers, "payment-signature");
  const v1Header = singleHeader(headers, "x-payment");
  if (!v2Header && !v1Header) return null;
  const decoded: ReleasePaymentAuthorization[] = [];
  if (v2Header) {
    const payload = decodeV2(v2Header);
    decoded.push({ protocol: "v2", requestHeaderName: "PAYMENT-SIGNATURE", responseHeaderName: "PAYMENT-RESPONSE", payload, fingerprint: fingerprint(payload) });
  }
  if (v1Header) {
    const payload = normalizeLegacyXPayment(v1Header, requirements);
    decoded.push({ protocol: "v1", requestHeaderName: "X-PAYMENT", responseHeaderName: "X-PAYMENT-RESPONSE", payload, fingerprint: fingerprint(payload) });
  }
  if (decoded.length === 2 && decoded[0]!.fingerprint !== decoded[1]!.fingerprint) throw new Error("conflicting_payment_headers");
  return decoded[0] ?? null;
}

export interface ReleasePaymentGateway {
  requirements(resourceUrl: string): Promise<PaymentRequirements[]>;
  challenge(requirements: PaymentRequirements[], resourceUrl: string): Promise<string>;
  decode(signature: string): PaymentPayload;
  decodeAuthorization(headers: IncomingHeaders, requirements: PaymentRequirements[]): ReleasePaymentAuthorization | null;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ valid: boolean; payer?: string }>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  settlementStatus(reference: string): Promise<SettleStatusResponse>;
  responseHeader(result: SettleResponse): string;
  match(requirements: PaymentRequirements[], payload: PaymentPayload): PaymentRequirements | undefined;
}

export function createReleasePaymentGateway(config: Config): ReleasePaymentGateway | null {
  if (!config.OPERATOR_WALLET || !config.OKX_API_KEY || !config.OKX_SECRET_KEY || !config.OKX_PASSPHRASE) return null;
  const facilitator = new OKXFacilitatorClient({ apiKey: config.OKX_API_KEY, secretKey: config.OKX_SECRET_KEY, passphrase: config.OKX_PASSPHRASE, syncSettle: true });
  const server = new x402ResourceServer(facilitator).register(config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, new ExactEvmScheme());
  let initialized: Promise<void> | null = null;
  const ensureInitialized = () => initialized ??= server.initialize();
  return {
    async requirements(resourceUrl) {
      await ensureInitialized();
      return server.buildPaymentRequirementsFromOptions([{ scheme: "exact", network: config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, payTo: config.OPERATOR_WALLET!, price: `$${config.PRICE_VERIFY_RELEASE}`, maxTimeoutSeconds: 300 }], { resourceUrl });
    },
    async challenge(requirements, resourceUrl) { return encodePaymentRequiredHeader(await server.createPaymentRequiredResponse(requirements, { url: resourceUrl, description: "PreFlight Agent Service Release Gate", mimeType: "application/json" })); },
    decode: decodePaymentSignatureHeader,
    decodeAuthorization: (headers, requirements) => decodeReleasePaymentAuthorization(headers, requirements),
    async verify(payload, requirements) { const result = await server.verifyPayment(payload, requirements); return { valid: result.isValid, payer: result.payer }; },
    settle: (payload, requirements) => server.settlePayment(payload, requirements),
    settlementStatus: (reference) => facilitator.getSettleStatus(reference),
    responseHeader: encodePaymentResponseHeader,
    match: (requirements, payload) => server.findMatchingRequirements(requirements, payload)
  };
}
