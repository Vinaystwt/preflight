import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@okxweb3/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@okxweb3/x402-evm";
import type { SettleResponse } from "@okxweb3/x402-core/types";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";

export interface PaidJsonResponse<T> {
  response: Response;
  body: T;
  receipt: SettleResponse | null;
}

export interface PaidTextResponse {
  response: Response;
  text: string;
  receipt: SettleResponse | null;
}

export function createPaymentBuyer(privateKey: `0x${string}`, fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error("buyer private key must be a 32-byte hex value");
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: xLayer, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const paidFetch = wrapFetchWithPaymentFromConfig(fetchImplementation, {
    schemes: [{ network: "eip155:196", client: new ExactEvmScheme(signer) }]
  });
  return {
    address: account.address,
    async postText(target: string, body: unknown): Promise<PaidTextResponse> {
      const url = new URL(target);
      if (url.protocol !== "https:") throw new Error("paid target must use https");
      const response = await paidFetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      const raw = response.headers.get("payment-response");
      const receipt = raw ? decodePaymentResponseHeader(raw) : null;
      return { response, text: await response.text(), receipt };
    },
    async postJson<T>(target: string, body: unknown): Promise<PaidJsonResponse<T>> {
      const paid = await this.postText(target, body);
      return { response: paid.response, body: JSON.parse(paid.text) as T, receipt: paid.receipt };
    }
  };
}
