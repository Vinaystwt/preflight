"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copyable IBM Plex Mono code block on --surface-1. Copy → check, "Copied". */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)} style={{ background: "var(--surface-1)" }}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5" style={{ background: "var(--surface-2)" }}>
        <span className="t-label text-tertiary">{label ?? "code"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          className={cn("inline-flex items-center gap-1.5 rounded px-2 py-1 t-ui transition-colors", copied ? "text-accent" : "text-tertiary hover:text-primary")}
          style={copied ? { boxShadow: "inset 0 0 0 1px var(--accent-border)" } : undefined}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0} className="overflow-x-auto p-3 t-evidence leading-[1.6] text-secondary focus-visible:outline-2 focus-visible:outline-accent-focus" aria-label={label ?? "code"}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
