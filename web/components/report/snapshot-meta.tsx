"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ReleaseReport } from "@/lib/contracts";
import { formatTimestamp, shortDigest } from "@/lib/format";

/* Reproducibility anchors, subordinate: small, collapsed, never competing with
   the decision. */
export function SnapshotMeta({ report }: { report: ReleaseReport }) {
  const [open, setOpen] = useState(false);
  const s = report.runtime_snapshot;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-md t-ui text-tertiary transition-colors hover:text-secondary">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        Snapshot and reproducibility
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-md border border-border p-4 t-evidence sm:grid-cols-[160px_1fr]" style={{ background: "var(--surface-1)" }}>
          <Row t="Policy version" v={report.policy_version} />
          <Row t="Report ID" v={report.report_id} />
          <Row t="Snapshot hash" v={shortDigest(s.snapshot_hash)} full={s.snapshot_hash} />
          {report.manifest?.manifest_hash && <Row t="Manifest hash" v={shortDigest(report.manifest.manifest_hash)} full={report.manifest.manifest_hash} />}
          {s.build_identifier && <Row t="Build" v={s.build_identifier} />}
          <Row t="Requested URL" v={s.requested_url} />
          {s.final_url && s.final_url !== s.requested_url && <Row t="Final URL" v={s.final_url} />}
          <Row t="Captured" v={formatTimestamp(s.captured_at)} />
          <Row t="Report expires" v={formatTimestamp(report.report_expires_at)} />
        </dl>
        {report.limitations.length > 0 && (
          <div className="mt-3 rounded-md border border-border p-4" style={{ background: "var(--surface-1)" }}>
            <p className="t-label text-tertiary">Limitations</p>
            <ul className="mt-1.5 flex flex-col gap-1 t-evidence text-tertiary">
              {report.limitations.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Row({ t, v, full }: { t: string; v: string; full?: string }) {
  return (
    <>
      <dt className="text-tertiary">{t}</dt>
      <dd className="min-w-0 break-words text-secondary" title={full}>{v}</dd>
    </>
  );
}
