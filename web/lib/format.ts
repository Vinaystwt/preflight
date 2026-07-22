import type { RunEventStatus } from "@/lib/contracts";

/** Present a normalized criterion value. Objects render compact; empties honest. */
export function formatValue(value: unknown): { text: string; absent: boolean } {
  if (value === undefined || value === null) return { text: "not observed", absent: true };
  if (typeof value === "boolean") return { text: value ? "true" : "false", absent: false };
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: "not observed", absent: true };
    return { text: value.map((v) => scalar(v)).join(", "), absent: false };
  }
  if (typeof value === "object") return { text: compactObject(value as Record<string, unknown>), absent: false };
  return { text: String(value), absent: false };
}

function scalar(v: unknown): string {
  return v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v);
}

function compactObject(o: Record<string, unknown>): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${scalar(v)}`)
    .join(" · ");
}

/** Middle-truncate a hash/address; full value stays available via title. */
export function middleTruncate(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function shortDigest(digest: string): string {
  const body = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return `sha256:${body.slice(0, 8)}…${body.slice(-6)}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** Relative time like "3m ago" / "2h ago" / "5d ago". Falls back to a date. */
export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${d.toISOString().slice(0, 10)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Extract a 0x tx hash from any string, if present (for OKLink linking). */
export function findTxHash(...values: unknown[]): string | null {
  for (const v of values) {
    const s = typeof v === "string" ? v : v && typeof v === "object" ? JSON.stringify(v) : "";
    const m = s.match(/0x[a-fA-F0-9]{64}/);
    if (m) return m[0];
  }
  return null;
}

export const OKLINK_TX = (tx: string) => `https://www.oklink.com/xlayer/tx/${tx}`;

export const RUN_STATUS_LABEL: Record<RunEventStatus, string> = {
  pending: "Pending",
  active: "In progress",
  match: "Verified",
  contradiction: "Contradiction",
  unknown: "Unknown",
  na: "Not applicable",
};
