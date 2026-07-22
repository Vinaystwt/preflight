"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getGallery } from "@/lib/api/endpoints";
import type { GalleryEntry } from "@/lib/contracts";
import { REFERENCE, FAMILIES, familyOf, type GalleryFamily, type ReferenceArchetype } from "@/lib/gallery-reference";

type Filter = "ALL" | GalleryFamily;

export function GalleryFeed() {
  const [real, setReal] = useState<GalleryEntry[] | null>(null);
  const [version, setVersion] = useState<string>("preflight.gallery.v1");
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    getGallery()
      .then((g) => { setReal(g.entries); setVersion(g.schema_version); })
      .catch(() => setFailed(true));
  }, []);

  const realFiltered = (real ?? []).filter((e) => filter === "ALL" || e.criterion_codes.some((c) => familyOf(c) === filter));
  const refFiltered = REFERENCE.filter((r) => filter === "ALL" || r.family === filter);

  return (
    <div>
      {/* counters */}
      <div className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-3" style={{ background: "var(--border)" }}>
        <Counter label="Public archetypes" value={real === null ? "…" : String(real.length)} />
        <Counter label="Reference archetypes" value={`${REFERENCE.length} · synthetic`} />
        <Counter label="Corpus version" value={version.replace("preflight.", "")} mono />
      </div>

      {/* filters */}
      <div className="mt-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Criterion family">
        {(["ALL", ...FAMILIES] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn("h-8 rounded-md border px-3 t-label transition-colors", filter === f ? "text-accent" : "border-border text-tertiary hover:text-secondary")}
            style={filter === f ? { background: "var(--accent-muted-bg)", borderColor: "var(--accent-border)" } : undefined}
          >
            {f}
          </button>
        ))}
      </div>

      {/* real corpus */}
      <section className="mt-8">
        <h2 className="t-label mb-3 text-tertiary">Public corpus</h2>
        {real === null && !failed && <p className="t-ui text-tertiary">Loading…</p>}
        {failed && <p className="t-ui text-tertiary">Could not reach the corpus. It is public and safe to retry.</p>}
        {real !== null && realFiltered.length === 0 && (
          <div className="rounded-md border border-border p-6" style={{ background: "var(--surface-1)" }}>
            <p className="t-body text-[15px] text-secondary">
              No opt-in public cases in this category yet. PreFlight reports are private by default; a
              failure appears here only when its owner explicitly contributes an anonymized archetype.
            </p>
          </div>
        )}
        {realFiltered.length > 0 && (
          <ul className="overflow-hidden rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
            {realFiltered.map((e) => (
              <RealRow key={e.gallery_id} entry={e} />
            ))}
          </ul>
        )}
      </section>

      {/* synthetic reference */}
      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="size-4 text-tertiary" aria-hidden />
          <h2 className="t-label text-tertiary">Reference archetypes · synthetic</h2>
        </div>
        <p className="mb-3 t-ui text-tertiary">Synthetic taxonomy examples, not real reports, for understanding what each failure family looks like.</p>
        <ul className="overflow-hidden rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
          {refFiltered.map((r) => (
            <RefRow key={r.id} archetype={r} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Counter({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface-1 px-5 py-4">
      <p className="t-label text-tertiary">{label}</p>
      <p className={cn("mt-1 tabular-nums", mono ? "font-mono text-[15px] text-secondary" : "t-metric text-primary")}>{value}</p>
    </div>
  );
}

function RealRow({ entry }: { entry: GalleryEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-sep last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-[64px] w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2">
        <span className="font-mono text-[13px] text-secondary">{entry.criterion_codes[0] ?? "—"}</span>
        <span className="min-w-0 flex-1">
          <span className="t-body block truncate text-[14px] text-primary">{entry.why[0] ?? "Archetype"}</span>
        </span>
        <StatusChip decision={entry.decision} />
        <ChevronRight className={cn("size-4 shrink-0 text-tertiary transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open && <Detail codes={entry.criterion_codes} why={entry.why} fix={entry.fix} policy={entry.policy_version} />}
    </li>
  );
}

function RefRow({ archetype }: { archetype: ReferenceArchetype }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-sep last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-[64px] w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-2">
        <span className="font-mono text-[13px] text-secondary">{archetype.code}</span>
        <span className="min-w-0 flex-1">
          <span className="t-body block truncate text-[14px] text-primary">{archetype.title}</span>
          <span className="t-evidence block truncate text-tertiary">{archetype.why}</span>
        </span>
        <span className="t-label shrink-0 text-tertiary" title="Synthetic reference archetype, not a real report">SYNTHETIC</span>
        <StatusChip decision={archetype.decision} />
        <ChevronRight className={cn("size-4 shrink-0 text-tertiary transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-x-6 gap-y-2 border-t border-sep px-5 py-4 t-evidence sm:grid-cols-2" style={{ background: "var(--base)" }}>
          <D t="Declared" v={archetype.declared} />
          <D t="Observed" v={archetype.observed} />
          <D t="Why" v={archetype.why} />
          <D t="Fix" v={archetype.fix} accent />
          <p className="sm:col-span-2 t-evidence text-tertiary">Synthetic reference · not a real report · targets are illustrative.</p>
        </div>
      )}
    </li>
  );
}

function Detail({ codes, why, fix, policy }: { codes: string[]; why: string[]; fix: string[]; policy: string }) {
  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-sep px-5 py-4 t-evidence sm:grid-cols-2" style={{ background: "var(--base)" }}>
      <D t="Criterion codes" v={codes.join(", ")} />
      <D t="Policy" v={policy} />
      <D t="Why" v={why.join(" · ")} />
      <D t="Fix" v={fix.join(" · ")} accent />
      <p className="sm:col-span-2 t-evidence text-tertiary">Anonymized: no endpoint, full address, payer, or report link is published.</p>
    </div>
  );
}

function D({ t, v, accent }: { t: string; v: string; accent?: boolean }) {
  return (
    <div>
      <dt className="t-label text-tertiary">{t}</dt>
      <dd className={cn("mt-0.5", accent ? "text-accent" : "text-secondary")}>{v}</dd>
    </div>
  );
}

function StatusChip({ decision }: { decision: "BLOCK" | "UNKNOWN" }) {
  const block = decision === "BLOCK";
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded border px-2 py-0.5 t-label", block ? "text-block" : "text-warning")} style={{ background: block ? "var(--block-bg)" : "var(--warning-bg)", borderColor: block ? "var(--block-border)" : "var(--warning-border)" }}>
      {decision}
    </span>
  );
}
