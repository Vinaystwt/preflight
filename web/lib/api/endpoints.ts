import { apiRequest } from "./client";
import type { DiscoveryV1, ReleaseReport, PubkeysV1, GalleryV1, Receipt } from "@/lib/contracts";
import type { CohortV1, BenchmarkV1, SelfCheckV1, AspV1, PassportV1, VerifyReceiptResult, ResolveV1 } from "@/lib/contracts-v5";

/** Signing public keys (for independent receipt verification). Safe to retry. */
export function getPubkeys(signal?: AbortSignal): Promise<PubkeysV1> {
  return apiRequest((d) => d as PubkeysV1, { path: "/api/v1/pubkeys", signal });
}

/** Public failure corpus. Safe to retry. */
export function getGallery(signal?: AbortSignal): Promise<GalleryV1> {
  return apiRequest((d) => d as GalleryV1, { path: "/api/v1/gallery", signal });
}

/** Public receipt envelope for third-party verification. */
export function getPublicReceipt(receiptId: string, signal?: AbortSignal): Promise<Receipt> {
  return apiRequest((d) => d as Receipt, { path: `/api/v1/receipts/${encodeURIComponent(receiptId)}`, signal });
}

/** FREE discovery: observed surface + proposed manifest. Rate-limited (429). */
export function discover(endpoint: string, signal?: AbortSignal): Promise<DiscoveryV1> {
  return apiRequest((d) => d as DiscoveryV1, {
    method: "POST",
    path: "/api/v1/discover",
    body: { endpoint },
    signal,
  });
}

/** Private report with bearer capability token (from the URL fragment). */
export function getReport(id: string, bearer: string, signal?: AbortSignal): Promise<ReleaseReport> {
  return apiRequest((d) => d as ReleaseReport, {
    path: `/api/v1/reports/${encodeURIComponent(id)}`,
    bearer,
    signal,
  });
}

/* ---------------- public endpoints ---------------- */

/** Public receipt verifier. No auth. receipt_id or {payload,signature,key_id}. */
export function verifyReceipt(
  input: { receipt_id: string } | { payload: unknown; signature: string; key_id: string },
  signal?: AbortSignal,
): Promise<VerifyReceiptResult> {
  return apiRequest((d) => d as VerifyReceiptResult, { method: "POST", path: "/api/v1/verify-receipt", body: input, signal });
}

/** Public cohort aggregate. Only `conforming` may be named. Safe to retry. */
export function getCohort(signal?: AbortSignal): Promise<CohortV1> {
  return apiRequest((d) => d as CohortV1, { path: "/api/v1/cohort", signal });
}

/** Public per-ASP runtime evidence. Safe to retry. */
export function getAsp(agentId: string, signal?: AbortSignal): Promise<AspV1> {
  return apiRequest((d) => d as AspV1, { path: `/api/v1/asp/${encodeURIComponent(agentId)}`, signal });
}

/** Public passport (state:none is a normal empty state). Safe to retry. */
export function getPassport(agentId: string, signal?: AbortSignal): Promise<PassportV1> {
  return apiRequest((d) => d as PassportV1, { path: `/api/v1/passport/${encodeURIComponent(agentId)}`, signal });
}

/** Public adversarial-benchmark result. Safe to retry. */
export function getBenchmark(signal?: AbortSignal): Promise<BenchmarkV1> {
  return apiRequest((d) => d as BenchmarkV1, { path: "/api/v1/benchmark", signal });
}

/** Public operator-funded self-check (customer_demand:false). Safe to retry. */
export function getSelfCheck(signal?: AbortSignal): Promise<SelfCheckV1> {
  return apiRequest((d) => d as SelfCheckV1, { path: "/api/v1/self-check", signal });
}

/** FREE listing resolution by OKX agent_id. 10/IP/hour. May 503 if the
    upstream OnchainOS session is unprovisioned; callers must handle that. */
export function resolveAgent(agentId: string, signal?: AbortSignal): Promise<ResolveV1> {
  return apiRequest((d) => d as ResolveV1, { method: "POST", path: "/api/v1/resolve", body: { agent_id: agentId }, signal });
}
