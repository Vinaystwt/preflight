"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { ExecutionRail, type RailNode, type RailState } from "@/components/execution-rail";
import { VerdictStamp } from "@/components/verdict-stamp";
import { cn } from "@/lib/utils";

const RAIL_LABELS = [
  "LISTING",
  "DISCOVERY",
  "REQUEST",
  "402",
  "PAYMENT",
  "SETTLEMENT",
  "DELIVERY",
  "VERDICT",
] as const;

/* Per step (0..10): the rail node state for each of the 8 rail nodes.
   The payment settles and delivery arrives even in the failing run — the
   contradiction is a reconciliation failure, so only VERDICT turns red. */
function railForStep(step: number): RailNode[] {
  const done = [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 8][step] ?? 0; // matched up to this index
  const active = [0, 1, 2, 3, 4, 5, 6, 7, -1, -1, 7, -1][step] ?? -1; // VERDICT active during rerun
  const blocked = step === 8 || step === 9; // VERDICT shows the block
  return RAIL_LABELS.map((label, i) => {
    let state: RailState = "pending";
    if (i < done) state = "match";
    else if (i === active) state = "active";
    if (blocked && i === 7) state = "block";
    if (step >= 11) state = "match";
    return { key: label, label, state };
  });
}

/* Scripted readout line per step. Amounts are internally consistent with the
   0.10 USDT product price so the hero never contradicts /pricing. */
const READOUT: { label: string; value: string; tone?: "block" | "release" }[] = [
  { label: "TARGET", value: "okx://agent/quote-svc" },
  { label: "LISTING", value: "quote-svc · x402 · X Layer" },
  { label: "ENDPOINT", value: "200 OK · MCP 2025-03-26" },
  { label: "CHALLENGE", value: "402 Payment Required · 0.10 USDT" },
  { label: "PAYMENT", value: "authorized · permit signed" },
  { label: "SETTLEMENT", value: "0x82da5fab4fdeebc1…1627e819d4d55b54" },
  { label: "DELIVERY", value: "200 · quote_id present" },
  { label: "INSPECTING", value: "payment recipient…" },
  { label: "DECISION", value: "mandatory criterion contradicts live", tone: "block" },
  { label: "FIX", value: "point endpoint payTo to declared address" },
  { label: "RERUN", value: "same manifest, recipient corrected" },
  { label: "RELEASE", value: "recipient matches declared, sellable", tone: "release" },
];

export function HeroLoop({ demo = false }: { demo?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [runId, setRunId] = useState(0);

  const restart = useCallback(() => setRunId((n) => n + 1), []);

  // GSAP is imported dynamically so it loads after first paint (the hero DOM is
  // already server-rendered); this keeps it out of the initial bundle.
  useEffect(() => {
    let ctx: { revert: () => void } | undefined;
    let cancelled = false;
    void import("gsap").then(({ default: gsap }) => {
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const scale = demo ? 1.5 : 1;
      const q = gsap.utils.selector(root);

      if (reduce) {
        // Poster frame: land on the BLOCK moment, fully visible, no motion.
        setStep(8);
        gsap.set(q(".matrix"), { opacity: 1, y: 0 });
        gsap.set(q(".verdict-block"), { opacity: 1, scale: 1 });
        gsap.set(q(".verdict-release"), { opacity: 0 });
        gsap.set(q(".fix-drawer"), { opacity: 0, height: 0 });
        gsap.set(q(".scan"), { opacity: 0 });
        gsap.set(q(".status-line"), { scaleX: 1, background: "var(--block-fg)" });
        return;
      }

      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 1.6 * scale,
        defaults: { ease: "power2.out" },
      });

      const at = (i: number, hold: number) => {
        tl.call(() => setStep(i));
        tl.to(q(".readout-value"), { opacity: 0, duration: 0.001 }, "<");
        tl.fromTo(
          q(".readout-value"),
          { opacity: 0, y: 6 },
          { opacity: 1, y: 0, duration: 0.28 * scale },
          "<",
        );
        tl.to({}, { duration: hold * scale });
      };

      // reset visuals at loop start
      tl.set(q(".readout-value"), { filter: "blur(0px)", scale: 1 });
      tl.set(q(".matrix"), { opacity: 0, y: 8 });
      tl.set(q(".verdict-block"), { opacity: 0, scale: 0.96 });
      tl.set(q(".verdict-release"), { opacity: 0, scale: 0.96 });
      tl.set(q(".fix-drawer"), { opacity: 0, height: 0 });
      tl.set(q(".status-line"), { scaleX: 0, background: "var(--accent)" });
      tl.set(q(".scan"), { opacity: 0, y: 0 });
      tl.set(q(".receipt-preview"), { opacity: 0, height: 0 });
      tl.set(q(".diff-hi"), { backgroundColor: "rgba(255,93,102,0)" });

      at(0, 0.7);
      at(1, 0.6);
      at(2, 0.6);
      at(3, 0.75); // 402 locks in
      tl.fromTo(q(".readout-value"), { scale: 1.06 }, { scale: 1, duration: 0.32, transformOrigin: "left center" }, "<");
      at(4, 0.6);
      at(5, 0.8); // settlement hash materializes
      tl.fromTo(q(".readout-value"), { filter: "blur(3px)" }, { filter: "blur(0px)", duration: 0.42 }, "<");
      at(6, 0.7);
      at(7, 0.7);
      // mismatch matrix reveals
      tl.to(q(".matrix"), { opacity: 1, y: 0, duration: 0.34 });
      tl.fromTo(q(".diff-hi"), { backgroundColor: "rgba(255,93,102,0)" }, { backgroundColor: "rgba(255,93,102,0.18)", duration: 0.36 }, "<0.1");
      at(8, 0.5);
      // red status line draws across the failed stage, then BLOCK
      tl.set(q(".status-line"), { background: "var(--block-fg)" });
      tl.to(q(".status-line"), { scaleX: 1, duration: 0.42, ease: "power1.inOut" });
      tl.to(q(".verdict-block"), { opacity: 1, scale: 1, duration: 0.42, ease: "power3.out" }, "<0.1");
      tl.to({}, { duration: 1.1 * scale });
      // fix drawer opens
      at(9, 0.2);
      tl.to(q(".fix-drawer"), { opacity: 1, height: "auto", duration: 0.24 });
      tl.to({}, { duration: 1.0 * scale });
      // RERUN: clear the BLOCK end-state fully before RELEASE renders.
      at(10, 0.2);
      tl.to(q(".verdict-block"), { opacity: 0, scale: 0.96, duration: 0.22 }, "<");
      tl.to(q(".fix-drawer"), { opacity: 0, height: 0, duration: 0.22 }, "<");
      tl.set(q(".status-line"), { scaleX: 0, background: "var(--accent)" });
      tl.to(q(".status-line"), { scaleX: 1, duration: 0.4, ease: "power1.inOut" });
      tl.fromTo(q(".diff-hi"), { backgroundColor: "rgba(255,93,102,0.18)" }, { backgroundColor: "rgba(56,217,150,0.16)", duration: 0.36 }, "<");
      tl.to({}, { duration: 0.8 * scale });
      // RELEASE end-state: quiet single scan line, verdict locks green.
      at(11, 0.15);
      tl.set(q(".status-line"), { background: "var(--release-fg)" });
      tl.fromTo(q(".scan"), { opacity: 0.9, y: 0 }, { y: "100%", opacity: 0, duration: 0.3, ease: "none" });
      tl.to(q(".verdict-release"), { opacity: 1, scale: 1, duration: 0.44, ease: "power3.out" }, "<");
      // receipt issuance: the proof slides up after RELEASE locks (P0.4)
      tl.to(q(".receipt-preview"), { opacity: 1, height: "auto", duration: 0.34, ease: "power2.out" }, "+=0.15");
      tl.to({}, { duration: 1.45 * scale });
      }, root);
    });
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [runId, demo]);

  const rail = railForStep(step);
  const r = READOUT[step];

  return (
    <div
      ref={root}
      className="relative"
      onClick={demo ? restart : undefined}
      role={demo ? "button" : undefined}
      tabIndex={demo ? 0 : undefined}
      aria-label={demo ? "Replay hero sequence" : undefined}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
        {/* two-layer instrument device frame */}
        <div
          className="hero-bezel relative min-w-0 w-full rounded-[12px] p-2"
          style={{ background: "var(--base)", border: "1px solid var(--border)", boxShadow: "0 28px 80px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.045)" }}
        >
          {/* top instrument bar */}
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="font-mono text-[10px] tracking-wide text-tertiary">PREFLIGHT LIVE CHECK</span>
            <span className="font-mono text-[10px] tracking-wide text-tertiary">X LAYER · 00:05.342</span>
          </div>
          {/* inner display */}
          <div className="relative overflow-hidden rounded-[7px]" style={{ background: "var(--surface-1)", border: "1px solid rgba(255,255,255,0.045)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>
          {/* faint scan overlay for the rerun */}
          <span className="scan pointer-events-none absolute inset-x-0 top-0 z-10 h-16" style={{ background: "linear-gradient(to bottom, rgba(56,217,150,0.22), transparent)", opacity: 0 }} aria-hidden />

          {/* header: target line */}
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className="t-evidence truncate text-secondary">okx://agent/quote-svc · https://api.quote.example/mcp</span>
            <span className="t-label shrink-0 text-tertiary">LIVE</span>
          </div>

          {/* readout */}
          <div className="px-4 py-4">
            <div className="flex items-baseline gap-3">
              <span className="t-label w-24 shrink-0 text-tertiary">{r.label}</span>
              <span
                className={cn(
                  "readout-value t-evidence inline-block min-w-0 max-w-full truncate",
                  r.tone === "block" ? "text-block" : r.tone === "release" ? "text-release" : "text-primary",
                )}
              >
                {r.value}
              </span>
            </div>

            {/* declared vs observed mismatch */}
            <div className="matrix mt-4 overflow-hidden rounded-md border border-border" style={{ background: "var(--base)", opacity: 0 }}>
              <div className="grid grid-cols-[80px_1fr] gap-x-3 border-b border-sep px-3 py-2">
                <span className="t-label text-tertiary">DECLARED</span>
                <span className="t-evidence text-secondary">
                  payTo <span className="diff-hi rounded-sm px-1 text-primary">0x71A8…45E2</span>
                </span>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-x-3 px-3 py-2">
                <span className="t-label text-tertiary">OBSERVED</span>
                <span className="t-evidence text-secondary">
                  payTo <span className="diff-hi rounded-sm px-1 text-primary">0x442B…9C07</span>
                </span>
              </div>
            </div>

            {/* fix drawer */}
            <div className="fix-drawer mt-3 overflow-hidden rounded-md border border-accent-focus/40" style={{ background: "var(--accent-muted-bg)", opacity: 0, height: 0 }}>
              <div className="px-3 py-2">
                <span className="t-label text-accent">EXACT FIX · PAY-04</span>
                <p className="t-evidence mt-1 text-secondary">Point the endpoint payTo to your declared address, then rerun.</p>
              </div>
            </div>
          </div>

          {/* signed-receipt preview (issued at RELEASE) */}
          <div className="receipt-preview overflow-hidden border-t border-sep px-4" style={{ opacity: 0, height: 0 }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="t-label text-accent">SIGNED RECEIPT</span>
              <span className="t-evidence text-tertiary">BILL_OF_LADING · pfr_01KXBP…051PN · Ed25519</span>
              <span className="inline-flex items-center gap-1 t-evidence text-release">SIGNATURE VALID</span>
              <span className="t-evidence text-tertiary">sha256:f1afc114…2bde0fc8</span>
            </div>
          </div>

          {/* status line + verdict */}
          <div className="relative border-t border-border px-4 py-3">
            <span className="status-line absolute left-0 top-0 h-px w-full origin-left" style={{ transform: "scaleX(0)" }} aria-hidden />
            <div className="flex items-center justify-between gap-3">
              <span className="t-label text-tertiary">VERDICT</span>
              <span className="relative inline-flex h-7 items-center">
                <span className="verdict-block absolute right-0" style={{ opacity: 0 }}><VerdictStamp decision="BLOCK" size="sm" /></span>
                <span className="verdict-release absolute right-0" style={{ opacity: 0 }}><VerdictStamp decision="RELEASE" size="sm" /></span>
              </span>
            </div>
          </div>
          </div>
        </div>

        {/* execution rail */}
        <div className="panel min-w-0 w-full rounded-md px-4 py-4 sm:w-[168px]">
          <span className="t-label mb-3 block text-tertiary">EXECUTION</span>
          <ExecutionRail nodes={rail} />
        </div>
      </div>
      {demo && (
        <p className="t-ui mt-3 text-tertiary">Demo pacing. Click to replay.</p>
      )}
    </div>
  );
}
