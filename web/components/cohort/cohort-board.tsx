"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCohort } from "@/lib/api/endpoints";
import { relativeTime } from "@/lib/format";
import type { CohortV1, CohortContradiction } from "@/lib/contracts-v5";

/* The contradictions section must NEVER name an ASP. contradiction_summary is
   contractually codes + counts only; we additionally strip and warn if the API
   ever regresses and includes an identifying field. */
const ID_KEYS = ["name", "agent_id", "agentId", "asp", "listing_name", "permalink", "service_id"];
function sanitizeContradiction(raw: CohortContradiction): CohortContradiction {
  const extra = ID_KEYS.filter((k) => k in (raw as unknown as Record<string, unknown>));
  if (extra.length) console.warn(`[cohort] contradiction_summary regressed with identifying field(s): ${extra.join(", ")}; stripped client-side`);
  return { criterion_code: raw.criterion_code, count: raw.count, plain: raw.plain };
}

type State =
  | { phase: "loading" }
  | { phase: "done"; data: CohortV1 }
  | { phase: "error" };

export function CohortBoard() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    getCohort(ac.signal)
      .then((data) => setState({ phase: "done", data }))
      .catch(() => setState({ phase: "error" }));
    return () => ac.abort();
  }, []);

  if (state.phase === "loading") return <p className="mt-8 t-ui text-tertiary">Loading the cohort…</p>;
  if (state.phase === "error") return <p className="mt-8 t-ui text-tertiary">Could not reach the cohort. It is public and safe to retry.</p>;

  const { totals, conforming, contradiction_summary, drift_events_24h, generated_at } = state.data;
  const contradictions = [...contradiction_summary].map(sanitizeContradiction).sort((a, b) => b.count - a.count);

  return (
    <div className="mt-8">
      {/* stat tiles */}
      <div className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-2 lg:grid-cols-4" style={{ background: "var(--border)" }}>
        <Stat label="Listed ASPs" value={totals.listed_asps} />
        <Stat label="With runtime evidence" value={totals.with_runtime_evidence} />
        <Stat label="Conforming" value={totals.conforming} />
        <Stat label="Drift events, 24h" value={drift_events_24h} />
      </div>
      <p className="t-evidence mt-2 text-tertiary">Generated {relativeTime(generated_at)}. Refreshes on page load.</p>

      {/* conforming */}
      <section className="mt-12">
        <h2 className="t-h2 text-[22px] text-primary">Conforming services</h2>
        <p className="t-body mt-1.5 text-[14px] text-secondary">Services whose live surface matched their listing at the last free scan.</p>
        {conforming.length === 0 ? (
          <div className="mt-4 rounded-md border border-border p-6" style={{ background: "var(--surface-1)" }}>
            <p className="t-body text-[15px] leading-[1.6] text-secondary">
              No services in the scanned cohort are conforming yet. This is a live count from free discovery, not a
              curated list. When a listing matches its observed surface, it appears here with a link to its evidence.
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {conforming.map((c) => (
              <li key={c.agent_id}>
                <Link
                  href={`/asp/${encodeURIComponent(c.agent_id)}`}
                  className="group flex items-center gap-4 rounded-md border border-border p-4 transition-colors hover:bg-surface-2"
                  style={{ background: "var(--surface-1)" }}
                >
                  <span className="inline-flex size-2 shrink-0 rounded-full" style={{ background: "var(--release-fg)" }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-primary">{c.name}</span>
                    <span className="t-evidence block text-tertiary">agent {c.agent_id} · checked {relativeTime(c.last_checked)}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-secondary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* contradictions — codes + counts ONLY, never a name */}
      <section className="mt-12">
        <h2 className="t-h2 text-[22px] text-primary">Contradictions found</h2>
        <p className="t-body mt-1.5 text-[14px] text-secondary">
          Aggregate criterion codes across the cohort. Individual services are never named here.
        </p>
        <div className="mt-4 overflow-x-auto rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="t-label px-5 py-3 text-tertiary">Criterion</th>
                <th scope="col" className="t-label px-5 py-3 text-tertiary">What it means</th>
                <th scope="col" className="t-label px-5 py-3 text-right text-tertiary">Count</th>
              </tr>
            </thead>
            <tbody>
              {contradictions.map((c) => (
                <tr key={c.criterion_code} className="border-b border-sep last:border-b-0">
                  <td className="px-5 py-3 align-top font-mono text-[13px] text-secondary">{c.criterion_code}</td>
                  <td className="px-5 py-3 align-top t-body text-[14px] text-secondary">{c.plain}</td>
                  <td className="px-5 py-3 text-right align-top font-mono tabular-nums text-[14px] text-primary">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-1 px-5 py-5">
      <p className="t-label text-tertiary">{label}</p>
      <p className="mt-1 font-mono text-[28px] font-medium tabular-nums text-primary">{value}</p>
    </div>
  );
}
