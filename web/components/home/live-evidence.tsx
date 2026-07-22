"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCohort } from "@/lib/api/endpoints";
import type { CohortV1 } from "@/lib/contracts-v5";

/* Reads /api/v1/cohort on mount and renders three tabular-nums stat cards.
   No counter animation. Falls back to the strip-hidden state on error, so
   nothing on the home hero renders a fabricated number. */
export function LiveEvidence() {
  const [data, setData] = useState<CohortV1 | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    getCohort(ac.signal).then(setData).catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  if (failed) return null;

  const totals = data?.totals;
  const contradictions = data?.contradiction_summary.reduce((sum, c) => sum + c.count, 0) ?? null;

  return (
    <section className="mx-auto w-full max-w-[1520px] px-5 sm:px-6">
      <div className="rounded-md border border-border p-6 sm:p-8" style={{ background: "var(--surface-1)" }}>
        <div className="flex items-baseline justify-between gap-4">
          <span className="t-label text-accent">Live evidence</span>
          <Link href="/cohort" className="inline-flex items-center gap-1 t-ui text-accent hover:text-primary">
            Explore the cohort <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="mt-5 grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-3" style={{ background: "var(--border)" }}>
          <Stat
            headline={data ? `${totals!.with_runtime_evidence} of ${totals!.listed_asps}` : null}
            label="OKX.AI ASPs scanned with runtime evidence"
          />
          <Stat
            headline={data ? `${totals!.conforming}` : null}
            label={"Conforming to their listing"}
          />
          <Stat
            headline={contradictions !== null ? `${contradictions}` : null}
            label="Contradictions surfaced"
          />
        </div>
      </div>
    </section>
  );
}

function Stat({ headline, label }: { headline: string | null; label: string }) {
  return (
    <div className="bg-surface-1 px-5 py-5">
      <p className="font-mono text-[32px] font-medium leading-none tabular-nums text-primary">{headline ?? "…"}</p>
      <p className="mt-2 t-body text-[14px] leading-[1.4] text-secondary">{label}</p>
    </div>
  );
}
