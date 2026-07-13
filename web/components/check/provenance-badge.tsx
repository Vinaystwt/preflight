import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = {
  LISTING: "Listing",
  RUNTIME: "Runtime",
  MCP: "MCP",
  OPERATOR: "Operator",
  INFERRED: "Inferred",
  X402_CHALLENGE: "x402",
  X402: "x402",
};

/* Neutral provenance chips (never verdict colors) marking where a proposed
   value came from. */
export function ProvenanceBadge({ source }: { source: string }) {
  const label = LABEL[source] ?? source;
  const accent = source === "INFERRED";
  return (
    <span
      className={cn("inline-flex items-center rounded border px-1.5 py-0.5 t-label", accent ? "text-accent" : "text-tertiary")}
      style={{ background: accent ? "var(--accent-muted-bg)" : "var(--surface-2)", borderColor: accent ? "var(--accent-border)" : "var(--border)" }}
    >
      {label}
    </span>
  );
}
