"use client";

import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OutLine {
  text: string;
  tone?: "primary" | "secondary" | "release" | "block" | "warning" | "accent";
}

/* A single terminal. The command is shown immediately (never typewriter). On
   "Run example", output lines reveal one by one (opacity, not per-character). */
export function Terminal({
  title = "preflight — zsh — 80×24",
  command,
  output,
  autoRun = false,
}: {
  title?: string;
  command: string;
  output: OutLine[];
  autoRun?: boolean;
}) {
  const [shown, setShown] = useState(autoRun ? output.length : 0);
  const running = shown > 0 && shown < output.length;

  function run() {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(output.length);
      return;
    }
    setShown(0);
    output.forEach((_, i) => setTimeout(() => setShown(i + 1), 90 + i * 150));
  }

  return (
    <div className="overflow-hidden rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5" style={{ background: "var(--surface-2)" }}>
        <span className="font-mono text-[11px] text-tertiary">{title}</span>
        <button
          type="button"
          onClick={shown >= output.length ? () => setShown(0) : run}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 t-ui text-tertiary transition-colors hover:bg-hover hover:text-primary"
        >
          {shown >= output.length && output.length > 0 ? <RotateCcw className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {shown >= output.length && output.length > 0 ? "Reset" : "Run example"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.65]" tabIndex={0} aria-label={title}>
        <span className="text-tertiary">$ </span>
        <span className="text-primary">{command}</span>
        {"\n"}
        {output.slice(0, shown).map((l, i) => (
          <span
            key={i}
            className={cn(
              "block",
              l.tone === "release" ? "text-release" : l.tone === "block" ? "text-block" : l.tone === "warning" ? "text-warning" : l.tone === "accent" ? "text-accent" : l.tone === "primary" ? "text-primary" : "text-secondary",
            )}
          >
            {l.text}
          </span>
        ))}
        {running && <span className="inline-block h-3.5 w-2 animate-pulse bg-tertiary align-middle" aria-hidden />}
      </pre>
    </div>
  );
}
