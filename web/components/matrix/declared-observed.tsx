import { Check, X, CircleHelp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CriterionState } from "@/lib/contracts";

export interface MatrixRow {
  code: string;
  label: string;
  declared: React.ReactNode;
  observed: React.ReactNode;
  state: CriterionState;
  diagnosis?: string;
  fix?: string;
}

const STATE_META: Record<
  CriterionState,
  { label: string; Icon: typeof Check; tone: string; markerBg: string; markerBorder: string }
> = {
  MATCH: { label: "MATCH", Icon: Check, tone: "text-release", markerBg: "var(--release-bg)", markerBorder: "var(--release-border)" },
  CONTRADICTION: { label: "BLOCK", Icon: X, tone: "text-block", markerBg: "var(--block-bg)", markerBorder: "var(--block-border)" },
  UNKNOWN: { label: "UNKNOWN", Icon: CircleHelp, tone: "text-warning", markerBg: "var(--warning-bg)", markerBorder: "var(--warning-border)" },
  NOT_APPLICABLE: { label: "N/A", Icon: Minus, tone: "text-tertiary", markerBg: "var(--surface-1)", markerBorder: "var(--border)" },
};

/*
  The Declared vs Observed matrix. Three stable columns sharing a baseline per
  row: DECLARED · OBSERVED LIVE · VERDICT. On mismatch, text stays neutral and
  only the changed substrings are highlighted; the row gets a status marker +
  label; the diagnosis sits beneath the row and the exact fix beside it.
*/
export function DeclaredObserved({ rows, className }: { rows: MatrixRow[]; className?: string }) {
  return (
    <div className={cn("panel overflow-hidden rounded-md", className)}>
      <div className="grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_112px] gap-x-4 border-b border-border px-4 py-2.5">
        <span className="t-label text-tertiary">Declared</span>
        <span className="t-label text-tertiary">Observed live</span>
        <span className="t-label text-right text-tertiary">Verdict</span>
      </div>
      <ul>
        {rows.map((row) => {
          const m = STATE_META[row.state];
          const Icon = m.Icon;
          const show = row.state === "CONTRADICTION" || row.state === "UNKNOWN";
          return (
            <li key={row.code} className="border-b border-sep last:border-b-0">
              <div className="grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_112px] items-baseline gap-x-4 px-4 py-3">
                <div className="min-w-0">
                  <span className="t-label mb-1 block text-tertiary">{row.code}</span>
                  <span className="t-evidence block break-words text-secondary">{row.declared}</span>
                </div>
                <span className="t-evidence min-w-0 break-words text-secondary">{row.observed}</span>
                <span className="flex items-center justify-end gap-1.5">
                  <span
                    className="inline-flex size-5 items-center justify-center rounded-full border"
                    style={{ background: m.markerBg, borderColor: m.markerBorder }}
                    aria-hidden
                  >
                    <Icon className={cn("size-3", m.tone)} />
                  </span>
                  <span className={cn("t-label", m.tone)}>{m.label}</span>
                </span>
              </div>
              {show && (row.diagnosis || row.fix) && (
                <div
                  className="grid gap-x-4 gap-y-1.5 px-4 pb-3 sm:grid-cols-2"
                  style={{ background: row.state === "CONTRADICTION" ? "var(--block-bg)" : "var(--warning-bg)" }}
                >
                  {row.diagnosis && (
                    <p className="t-body pt-2 text-[13px] text-secondary">
                      <span className={cn("t-label mr-2", m.tone)}>WHY</span>
                      {row.diagnosis}
                    </p>
                  )}
                  {row.fix && (
                    <p className="t-body pt-2 text-[13px] text-primary sm:pt-2">
                      <span className="t-label mr-2 text-accent">FIX</span>
                      {row.fix}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
