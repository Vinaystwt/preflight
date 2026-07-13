/*
  Capability tokens travel in the URL fragment (#access_token=…) so they never
  reach a server, log, referrer, or analytics. Read client-side, sent as bearer.
*/
const KEY = "access_token";

export function readReportToken(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const token = new URLSearchParams(hash).get(KEY);
  return token && token.length > 0 ? token : null;
}

export function buildReportLink(origin: string, id: string, token: string): string {
  return `${origin}/report/${encodeURIComponent(id)}#${KEY}=${token}`;
}

export function stripTokenFromUrl(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}
