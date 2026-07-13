"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReleaseReport } from "@/lib/contracts";
import { API_BASE } from "@/lib/api/client";

type Fmt = "markdown" | "html" | "url";

/* Badge embed, RELEASE reports only. One badge shown in a README context on
   both dark and light backgrounds; format tabs switch the copyable snippet. */
export function BadgeEmbed({ report, token }: { report: ReleaseReport; token: string }) {
  const [fmt, setFmt] = useState<Fmt>("markdown");
  const [copied, setCopied] = useState(false);
  const badgeUrl = `${API_BASE}/api/v1/badge/${report.report_id}.svg?token=${token}`;
  const verifyUrl = `https://usepreflight.xyz/report/${report.report_id}`;

  const snippet =
    fmt === "markdown"
      ? `[![PreFlight RELEASE](${badgeUrl})](${verifyUrl})`
      : fmt === "html"
        ? `<a href="${verifyUrl}"><img src="${badgeUrl}" alt="PreFlight RELEASE" width="88" height="28" /></a>`
        : badgeUrl;

  return (
    <section id="badge" className="scroll-mt-20">
      <h2 className="t-h3 mb-3 text-[17px] text-primary">Live badge</h2>
      <div className="panel overflow-hidden rounded-md">
        {/* previews */}
        <div className="grid gap-px sm:grid-cols-2" style={{ background: "var(--sep)" }}>
          <BadgePreview label="On dark" bg="#0d1117" />
          <BadgePreview label="On light" bg="#ffffff" light />
        </div>
        <p className="border-b border-border px-5 py-2 t-evidence text-tertiary">Rendered at 2×. Actual size 88 × 28.</p>

        {/* format tabs + snippet */}
        <div className="px-5 py-4">
          <div className="flex gap-1" role="tablist" aria-label="Embed format">
            {(["markdown", "html", "url"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={fmt === f}
                onClick={() => setFmt(f)}
                className={cn("h-8 rounded-md px-3 t-ui transition-colors", fmt === f ? "bg-surface-2 text-primary" : "text-tertiary hover:text-secondary")}
              >
                {f === "markdown" ? "Markdown" : f === "html" ? "HTML" : "Direct URL"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
            className="mt-3 flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            style={{ background: "var(--base)", ...(copied ? { boxShadow: "inset 0 0 0 1px var(--accent-border)" } : {}) }}
          >
            <code className="min-w-0 truncate font-mono text-[12.5px] text-secondary">{snippet}</code>
            <span className="inline-flex shrink-0 items-center gap-1 t-ui text-tertiary">{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied ? "Copied" : "Copy"}</span>
          </button>
          <p className="mt-3 t-evidence text-tertiary">
            Linked receipt {report.receipt ? report.receipt.receipt_id.slice(0, 14) + "…" : "issued"} · the badge shows{" "}
            <span className="text-warning">PF | STALE</span> in amber if the release drifts. A stale badge means the receipt is old, not that the new configuration fails.
          </p>
        </div>
      </div>
    </section>
  );
}

function BadgePreview({ label, bg, light }: { label: string; bg: string; light?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 bg-surface-1 px-5 py-6">
      <span className="t-label text-tertiary">{label}</span>
      <div className="rounded-md p-6" style={{ background: bg }}>
        {/* static 2x badge mock: PF | RELEASE */}
        <span className="inline-flex overflow-hidden rounded" style={{ height: 56, border: "1px solid rgba(0,0,0,0.15)" }}>
          <span className="inline-flex items-center px-3 font-mono text-[15px]" style={{ background: "#151a20", color: "#f3f5f7" }}>PF</span>
          <span className="inline-flex items-center gap-1.5 px-3 font-mono text-[15px] font-medium" style={{ background: "#0d2a20", color: "#38d996" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M20 6 9 17l-5-5" stroke="#38d996" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            RELEASE
          </span>
        </span>
      </div>
      <span className={cn("t-evidence", light ? "text-tertiary" : "text-tertiary")}>README on {light ? "light" : "dark"}</span>
    </div>
  );
}
