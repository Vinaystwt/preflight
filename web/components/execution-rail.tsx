import { Check, X, CircleHelp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type RailState =
  | "pending"
  | "active"
  | "done"
  | "match"
  | "block"
  | "unknown"
  | "na";

export interface RailNode {
  key: string;
  label: string;
  state: RailState;
}

/*
  The execution rail. A narrow vertical spine: LISTING → DISCOVERY → REQUEST →
  402 → PAYMENT → SETTLEMENT → DELIVERY → VERDICT (or the real run stages on the
  run/report pages). Only the CURRENT node is violet and animates; completed
  nodes are neutral checks; a node turns green only when its evidence verifies,
  red on contradiction, amber on unknown. Status is always icon + text.
*/
export function ExecutionRail({
  nodes,
  className,
}: {
  nodes: RailNode[];
  className?: string;
}) {
  return (
    <ol className={cn("relative flex flex-col", className)} aria-label="Execution stages">
      {nodes.map((n, i) => (
        <li key={n.key} className="relative flex items-start gap-3 pb-5 last:pb-0">
          {i < nodes.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px"
              style={{
                background:
                  n.state === "done" || n.state === "match"
                    ? "var(--border-strong)"
                    : "var(--border)",
              }}
            />
          )}
          <RailDot state={n.state} />
          <div className="min-w-0 pt-0.5">
            <span
              className={cn(
                "t-label block",
                n.state === "active"
                  ? "text-accent"
                  : n.state === "match"
                    ? "text-release"
                    : n.state === "block"
                      ? "text-block"
                      : n.state === "unknown"
                        ? "text-warning"
                        : n.state === "pending"
                          ? "text-tertiary"
                          : "text-secondary",
              )}
            >
              {n.label}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RailDot({ state }: { state: RailState }) {
  const base =
    "relative flex size-[23px] shrink-0 items-center justify-center rounded-full border";
  if (state === "active") {
    return (
      <span
        className={cn(base, "border-accent-focus")}
        style={{ background: "var(--accent-muted-bg)" }}
        role="img" aria-label="in progress"
      >
        <span
          className="animate-rail-pulse absolute inset-0 rounded-full"
          style={{ background: "var(--accent)" }}
          aria-hidden
        />
        <span className="size-2 rounded-full" style={{ background: "var(--accent)" }} />
      </span>
    );
  }
  if (state === "match") {
    return (
      <span className={cn(base, "border-release-border")} style={{ background: "var(--release-bg)" }} role="img" aria-label="verified">
        <Check className="size-3.5 text-release" aria-hidden />
      </span>
    );
  }
  if (state === "block") {
    return (
      <span className={cn(base, "border-block-border")} style={{ background: "var(--block-bg)" }} role="img" aria-label="blocked">
        <X className="size-3.5 text-block" aria-hidden />
      </span>
    );
  }
  if (state === "unknown") {
    return (
      <span className={cn(base, "border-warning-border")} style={{ background: "var(--warning-bg)" }} role="img" aria-label="unknown">
        <CircleHelp className="size-3.5 text-warning" aria-hidden />
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className={cn(base, "border-border-strong")} style={{ background: "var(--surface-2)" }} role="img" aria-label="complete">
        <Check className="size-3.5 text-secondary" aria-hidden />
      </span>
    );
  }
  if (state === "na") {
    return (
      <span className={cn(base, "border-border")} style={{ background: "var(--surface-1)" }} role="img" aria-label="not applicable">
        <Minus className="size-3.5 text-tertiary" aria-hidden />
      </span>
    );
  }
  // pending
  return (
    <span className={cn(base, "border-border")} style={{ background: "var(--surface-1)" }} role="img" aria-label="pending">
      <span className="size-1.5 rounded-full" style={{ background: "var(--text-disabled)" }} />
    </span>
  );
}
