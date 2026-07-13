"use client";

import { useState } from "react";
import { ChevronRight, Copy, Check, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { EvidenceRef, Provenance } from "@/lib/contracts";
import { formatTimestamp, hostOf, shortDigest, findTxHash, OKLINK_TX } from "@/lib/format";

const PROV_LABEL: Record<Provenance, string> = {
  OPERATOR_SUPPLIED: "Operator",
  OBSERVED: "Observed",
  DERIVED: "Derived",
  UNAVAILABLE: "Unavailable",
};

/* Evidence inspector: progressive disclosure, one level, never nested
   accordions for comparable data. */
export function EvidenceDisclosure({
  evidence,
  provenance,
}: {
  evidence: EvidenceRef[];
  provenance: Provenance[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  if (evidence.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-tertiary transition-colors hover:text-secondary">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        {open ? "Hide evidence" : `Inspect evidence (${evidence.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provenance.map((p) => (
            <span key={p} className="rounded border border-border px-1.5 py-0.5 t-label text-tertiary" style={{ background: "var(--surface-2)" }}>
              {PROV_LABEL[p]}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {evidence.map((e) => {
            const tx = findTxHash(e.summary, e.source, e.id);
            return (
              <div key={e.id} className="rounded-md border border-border p-3" style={{ background: "var(--base)" }}>
                {e.summary && <p className="t-evidence text-secondary">{e.summary}</p>}
                <dl className="mt-2 grid grid-cols-[84px_1fr] gap-x-3 gap-y-1 t-evidence">
                  <dt className="text-tertiary">Source</dt>
                  <dd className="min-w-0 break-words text-secondary">{hostOf(e.source)}</dd>
                  {e.captured_at && (
                    <>
                      <dt className="text-tertiary">Captured</dt>
                      <dd className="text-secondary">{formatTimestamp(e.captured_at)}</dd>
                    </>
                  )}
                  {e.digest && (
                    <>
                      <dt className="text-tertiary">Digest</dt>
                      <dd className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-secondary" title={e.digest}>{shortDigest(e.digest)}</span>
                        <button
                          type="button"
                          aria-label="Copy digest"
                          onClick={() => {
                            navigator.clipboard.writeText(e.digest!);
                            setCopied(e.id);
                            setTimeout(() => setCopied(null), 1400);
                          }}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-tertiary transition-colors hover:bg-hover hover:text-primary"
                        >
                          {copied === e.id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                        </button>
                      </dd>
                    </>
                  )}
                  {tx && (
                    <>
                      <dt className="text-tertiary">Transaction</dt>
                      <dd>
                        <a href={OKLINK_TX(tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:text-accent-hover">
                          {tx.slice(0, 10)}…{tx.slice(-6)} <ExternalLink className="size-3" aria-hidden />
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
