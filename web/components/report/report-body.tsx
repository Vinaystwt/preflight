"use client";

import { useState } from "react";
import { ChevronRight, Handshake } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Criterion, ReleaseReport } from "@/lib/contracts";
import { CriterionRow } from "./criterion-row";

const byMandatory = (a: Criterion, b: Criterion) => Number(b.mandatory) - Number(a.mandatory);

export function ReportBody({ report }: { report: ReleaseReport }) {
  const all = report.criterion_groups.flatMap((g) => g.criteria);
  const buyer = all.filter((c) => c.group === "buyer_proof");
  const rest = all.filter((c) => c.group !== "buyer_proof");

  const attention = rest.filter((c) => c.state === "CONTRADICTION" || c.state === "UNKNOWN").sort(byMandatory);
  const matches = rest.filter((c) => c.state === "MATCH");
  const na = rest.filter((c) => c.state === "NOT_APPLICABLE");

  return (
    <div className="flex flex-col gap-8">
      {buyer.length > 0 && (
        <section aria-labelledby="buyer-proof">
          <div className="mb-3 flex items-center gap-2">
            <Handshake className="size-4 text-accent" aria-hidden />
            <h2 id="buyer-proof" className="t-h3 text-[17px] text-primary">Buyer proof</h2>
            <span className="t-ui text-tertiary">PreFlight paid and took delivery as a real buyer</span>
          </div>
          <div className="panel overflow-hidden rounded-md">
            <MatrixHeader />
            <ul>{buyer.map((c) => <CriterionRow key={c.code} criterion={c} />)}</ul>
          </div>
        </section>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attention">
          <h2 id="attention" className="t-h3 mb-3 text-[17px] text-primary">
            Needs attention <span className="t-evidence font-normal text-tertiary">{attention.length}</span>
          </h2>
          <div className="panel overflow-hidden rounded-md">
            <MatrixHeader />
            <ul>{attention.map((c) => <CriterionRow key={c.code} criterion={c} />)}</ul>
          </div>
        </section>
      )}

      {matches.length > 0 && <CollapsedGroup id="matches" title="Matches" criteria={matches} />}
      {na.length > 0 && <CollapsedGroup id="na" title="Not applicable" criteria={na} muted />}
    </div>
  );
}

function MatrixHeader() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px] gap-x-4 border-b border-border px-4 py-2.5 sm:px-5">
      <span className="t-label text-tertiary">Declared</span>
      <span className="t-label text-tertiary">Observed live</span>
      <span className="t-label text-right text-tertiary">Verdict</span>
    </div>
  );
}

function CollapsedGroup({ id, title, criteria, muted }: { id: string; title: string; criteria: Criterion[]; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={`${id}-h`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger id={`${id}-h`} className="flex w-full items-center gap-2 rounded-md text-left">
          <ChevronRight className={cn("size-4 text-tertiary transition-transform", open && "rotate-90")} aria-hidden />
          <span className={cn("t-h3 text-[17px]", muted ? "text-tertiary" : "text-primary")}>{title}</span>
          <span className="t-evidence text-tertiary">{criteria.length}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="panel mt-3 overflow-hidden rounded-md">
            <MatrixHeader />
            <ul>{criteria.map((c) => <CriterionRow key={c.code} criterion={c} />)}</ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
