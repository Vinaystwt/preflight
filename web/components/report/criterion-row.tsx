import { Check, X, CircleHelp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Criterion, CriterionState } from "@/lib/contracts";
import { formatValue } from "@/lib/format";
import { EvidenceDisclosure } from "./evidence-disclosure";

const META: Record<CriterionState, { label: string; Icon: typeof Check; tone: string; bg: string; border: string }> = {
  MATCH: { label: "MATCH", Icon: Check, tone: "text-release", bg: "var(--release-bg)", border: "var(--release-border)" },
  CONTRADICTION: { label: "BLOCK", Icon: X, tone: "text-block", bg: "var(--block-bg)", border: "var(--block-border)" },
  UNKNOWN: { label: "UNKNOWN", Icon: CircleHelp, tone: "text-warning", bg: "var(--warning-bg)", border: "var(--warning-border)" },
  NOT_APPLICABLE: { label: "N/A", Icon: Minus, tone: "text-tertiary", bg: "var(--surface-1)", border: "var(--border)" },
};

/* One criterion: DECLARED | OBSERVED LIVE | VERDICT sharing a baseline, with
   WHY/FIX beneath and the evidence inspector. Full untruncated values wrap. */
export function CriterionRow({ criterion }: { criterion: Criterion }) {
  const m = META[criterion.state];
  const Icon = m.Icon;
  const declared = formatValue(criterion.expected);
  const observed = formatValue(criterion.observed);
  const attention = criterion.state === "CONTRADICTION" || criterion.state === "UNKNOWN";

  return (
    <li className="border-b border-sep px-4 py-4 last:border-b-0 sm:px-5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] items-baseline gap-x-4">
        <div className="min-w-0">
          <span className="t-label mb-1 block text-tertiary">{criterion.code}</span>
          <span className={cn("t-evidence block break-words", declared.absent ? "italic text-tertiary" : "text-secondary")}>{declared.text}</span>
        </div>
        <span className={cn("t-evidence min-w-0 break-words", observed.absent ? "italic text-tertiary" : "text-secondary")}>{observed.text}</span>
        <span className="flex items-center justify-end gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-full border" style={{ background: m.bg, borderColor: m.border }} aria-hidden>
            <Icon className={cn("size-3", m.tone)} />
          </span>
          <span className={cn("t-label", m.tone)}>{m.label}</span>
        </span>
      </div>

      <p className="mt-2 t-evidence text-tertiary">{criterion.comparison_rule}</p>

      {attention && (criterion.consequence || criterion.remediation || criterion.limitation) && (
        <div className="mt-2 grid gap-x-4 gap-y-1.5 rounded-md p-3 sm:grid-cols-2" style={{ background: criterion.state === "CONTRADICTION" ? "var(--block-bg)" : "var(--warning-bg)" }}>
          {(criterion.consequence || criterion.limitation) && (
            <p className="t-body text-[13px] text-secondary">
              <span className={cn("t-label mr-2", m.tone)}>{criterion.state === "UNKNOWN" ? "WHY UNKNOWN" : "WHY"}</span>
              {criterion.consequence ?? criterion.limitation}
            </p>
          )}
          {criterion.remediation && (
            <p className="t-body text-[13px] text-primary">
              <span className="t-label mr-2 text-accent">FIX</span>
              {criterion.remediation}
            </p>
          )}
        </div>
      )}

      <EvidenceDisclosure evidence={criterion.evidence_refs} provenance={criterion.provenance} />
    </li>
  );
}
