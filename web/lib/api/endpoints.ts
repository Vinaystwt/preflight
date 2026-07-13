import { apiRequest } from "./client";
import type { DiscoveryV1, ReleaseReport, PubkeysV1, GalleryV1, Receipt } from "@/lib/contracts";

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
