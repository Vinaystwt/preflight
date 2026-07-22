"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBenchmark } from "@/lib/api/endpoints";
import type { BenchmarkV1 } from "@/lib/contracts-v5";

type State = { phase: "loading" } | { phase: "done"; data: BenchmarkV1 } | { phase: "error" } | { phase: "empty" };

export function BenchmarkTable() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    getBenchmark(ac.signal)
      .then((data) => setState(data.state === "not_generated" ? { phase: "empty" } : { phase: "done", data }))
      .catch(() => setState({ phase: "error" }));
    return () => ac.abort();
  }, []);

  if (state.phase === "loading") return <p className="mt-8 t-ui text-tertiary">Loading the benchmark…</p>;
  if (state.phase === "error") return <p className="mt-8 t-ui text-tertiary">Could not reach the benchmark. It is public and safe to retry.</p>;
  if (state.phase === "empty") return <p className="mt-8 t-ui text-tertiary">No benchmark run has been generated yet.</p>;

  const { data } = state;
  const failing = data.total_fixtures - data.passing;

  return (
    <div className="mt-8">
      <div className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-3" style={{ background: "var(--border)" }}>
        <Stat label="Fixtures" value={data.total_fixtures} />
        <Stat label="Passing" value={data.passing} tone="release" />
        <Stat label="Failing" value={failing} tone={failing > 0 ? "block" : undefined} />
      </div>

      <div className="mt-8 overflow-x-auto rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="t-label px-5 py-3 text-tertiary">Fixture</th>
              <th scope="col" className="t-label px-5 py-3 text-tertiary">Seeded fault</th>
              <th scope="col" className="t-label px-5 py-3 text-tertiary">Expected → actual</th>
              <th scope="col" className="t-label px-5 py-3 text-right text-tertiary">Result</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.case_id} className="border-b border-sep last:border-b-0" style={c.passes ? undefined : { background: "var(--block-bg)" }}>
                <td className="px-5 py-3 align-top font-mono text-[13px] text-secondary">{c.case_id}</td>
                <td className="px-5 py-3 align-top t-body text-[14px] text-secondary">
                  {c.seeded_fault === "none" ? "None (golden path)" : c.seeded_fault}
                  {c.why_it_matters ? <span className="t-evidence mt-1 block text-tertiary">{c.why_it_matters}</span> : null}
                </td>
                <td className="px-5 py-3 align-top font-mono text-[13px]">
                  <span className="text-tertiary">{c.expected_decision}</span>
                  <span className="text-tertiary"> → </span>
                  <span className={c.passes ? "text-secondary" : "text-block"}>{c.actual_decision}</span>
                </td>
                <td className="px-5 py-3 text-right align-top">
                  <span className={cn("inline-flex items-center gap-1.5 t-label", c.passes ? "text-release" : "text-block")}>
                    {c.passes ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                    {c.passes ? "PASS" : "FAIL"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="t-evidence mt-6 text-tertiary">Generated from the actual test suite. Policy version {data.policy_version}.</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "release" | "block" }) {
  return (
    <div className="bg-surface-1 px-5 py-5">
      <p className="t-label text-tertiary">{label}</p>
      <p className={cn("mt-1 font-mono text-[28px] font-medium tabular-nums", tone === "release" ? "text-release" : tone === "block" ? "text-block" : "text-primary")}>{value}</p>
    </div>
  );
}
