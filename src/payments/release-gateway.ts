import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@okxweb3/x402-core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import type { Config } from "../config.js";

export interface ReleasePaymentGateway {
  requirements(resourceUrl: string): Promise<PaymentRequirements[]>;
  challenge(requirements: PaymentRequirements[], resourceUrl: string): Promise<string>;
  decode(signature: string): PaymentPayload;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ valid: boolean; payer?: string }>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  responseHeader(result: SettleResponse): string;
  match(requirements: PaymentRequirements[], payload: PaymentPayload): PaymentRequirements | undefined;
}

export function createReleasePaymentGateway(config: Config): ReleasePaymentGateway | null {
  if (!config.OPERATOR_WALLET || !config.OKX_API_KEY || !config.OKX_SECRET_KEY || !config.OKX_PASSPHRASE) return null;
  const facilitator = new OKXFacilitatorClient({ apiKey: config.OKX_API_KEY, secretKey: config.OKX_SECRET_KEY, passphrase: config.OKX_PASSPHRASE, syncSettle: true });
  const server = new x402ResourceServer(facilitator).register(config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, new ExactEvmScheme());
  return {
    requirements: (resourceUrl) => server.buildPaymentRequirementsFromOptions([{ scheme: "exact", network: config.RELEASE_PAYMENT_NETWORK as `eip155:${string}`, payTo: config.OPERATOR_WALLET!, price: `$${config.PRICE_VERIFY_RELEASE}`, maxTimeoutSeconds: 300 }], { resourceUrl }),
    async challenge(requirements, resourceUrl) { return encodePaymentRequiredHeader(await server.createPaymentRequiredResponse(requirements, { url: resourceUrl, description: "PreFlight Agent Service Release Gate", mimeType: "application/json" })); },
    decode: decodePaymentSignatureHeader,
    async verify(payload, requirements) { const result = await server.verifyPayment(payload, requirements); return { valid: result.isValid, payer: result.payer }; },
    settle: (payload, requirements) => server.settlePayment(payload, requirements),
    responseHeader: encodePaymentResponseHeader,
    match: (requirements, payload) => server.findMatchingRequirements(requirements, payload)
  };
}
