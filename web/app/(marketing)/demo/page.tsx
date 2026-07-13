import type { Metadata } from "next";
import { Cta } from "@/components/cta";
import { HeroLoop } from "@/components/hero/hero-loop";

export const metadata: Metadata = {
  title: "Demo",
  description: "A controlled example: one service, one known mismatch, BLOCK to fix to rerun to RELEASE.",
};

const BEATS = [
  ["Intended", "The operator declares a release for quote-svc: price 0.10 USDT, paid to their own wallet, a required token input."],
  ["Observed", "PreFlight becomes a buyer. Discovery, the 402, payment, settlement, and delivery all pass."],
  ["Block", "One criterion contradicts: the live payTo is a different address than declared. Funds would leave to the wrong wallet, so the release is blocked."],
  ["Fix", "The operator fixes the deployment, not the manifest. The endpoint payTo now matches what was declared."],
  ["Release", "The same manifest is rerun. Every mandatory criterion matches the new snapshot. The release is sellable."],
];

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-14 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="t-label inline-flex items-center rounded-full border border-border px-2.5 py-1 text-tertiary" style={{ background: "var(--surface-2)" }}>
          Controlled example
        </span>
        <span className="t-ui text-tertiary">One preconfigured service, one known mismatch</span>
      </div>
      <h1 className="t-h1 mt-4 max-w-3xl text-primary">Watch a release get blocked, then fixed, then released.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        This runs the same instrument you get on a real report. The failure is deliberate: an
        all green demo proves nothing. The block proves PreFlight catches a real consequence.
      </p>

      <div className="mt-10">
        <HeroLoop demo />
      </div>

      <section className="mt-16">
        <h2 className="t-h2 text-primary">The story, one beat at a time.</h2>
        <ol className="mt-6 grid gap-px overflow-hidden rounded-md border border-border md:grid-cols-5" style={{ background: "var(--border)" }}>
          {BEATS.map(([t, d], i) => (
            <li key={t} className="bg-surface-1 p-5">
              <span className="t-evidence text-tertiary">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="t-h3 mt-2 text-[16px] text-primary">{t}</h3>
              <p className="t-body mt-1.5 text-[13px] text-secondary">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-14 panel flex flex-col items-start justify-between gap-5 rounded-md px-6 py-7 sm:flex-row sm:items-center">
        <div>
          <h2 className="t-h3 text-primary">Every value here maps to a real report.</h2>
          <p className="t-body mt-1.5 text-[14px] text-secondary">Run a check on your own service to get the private report and the exact fix.</p>
        </div>
        <Cta href="/check" className="shrink-0">Run a check</Cta>
      </div>
    </div>
  );
}
