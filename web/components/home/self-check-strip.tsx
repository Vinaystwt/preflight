"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getSelfCheck } from "@/lib/api/endpoints";
import { middleTruncate, relativeTime } from "@/lib/format";
import type { SelfCheckV1 } from "@/lib/contracts-v5";

/* Reads /api/v1/self-check on mount. The customer_demand:false label is shown
   verbatim; the strip is dogfooding evidence, not demand evidence. Renders
   nothing at all if the endpoint fails, so the home never fabricates a run. */
export function SelfCheckStrip() {
  const [data, setData] = useState<SelfCheckV1 | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    getSelfCheck(ac.signal).then(setData).catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  if (failed || !data) return null;

  return (
    <section className="mx-auto w-full max-w-[1520px] px-5 sm:px-6">
      <div className="rounded-md border border-border p-5 sm:p-6" style={{ background: "var(--surface-1)" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-release-border text-release" style={{ background: "var(--release-bg)" }} aria-hidden>
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="t-ui text-primary">
                PreFlight verified its own release <span className="text-secondary">{relativeTime(data.published_at)}</span>.
                <span className="ml-2 inline-flex items-center rounded border border-release-border px-2 py-0.5 t-label text-release" style={{ background: "var(--release-bg)" }}>{data.decision}</span>
              </p>
              <p className="mt-1 font-mono text-[13px] text-tertiary" title={data.receipt_id}>Receipt {middleTruncate(data.receipt_id, 12, 6)}</p>
              <p className="t-evidence mt-1 text-tertiary">Operator-funded self-check. customer_demand: false.</p>
            </div>
          </div>
          <Link
            href={`/verify?receipt_id=${encodeURIComponent(data.receipt_id)}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 t-ui text-accent transition-colors hover:bg-surface-2 hover:text-primary"
          >
            Verify this receipt <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
