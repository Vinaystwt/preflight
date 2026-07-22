"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/cohort", label: "Cohort", hint: "Runtime evidence across OKX.AI ASPs" },
  { href: "/verify", label: "Verify a receipt", hint: "Public receipt verifier" },
  { href: "/benchmark", label: "Benchmark", hint: "What PreFlight catches" },
  { href: "/cli", label: "CLI", hint: "Run it from your terminal or CI" },
  { href: "/docs#api", label: "verify_release API", hint: "One call, machine JSON" },
  { href: "/docs#mcp", label: "MCP server", hint: "Wire it into an agent" },
  { href: "/gallery", label: "Gallery", hint: "Anonymized failure corpus" },
];

export function DevelopersMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden sm:block" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:text-primary"
      >
        Developers
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full w-[280px] pt-2">
          <div className="overflow-hidden rounded-lg border border-border shadow-lg" style={{ background: "var(--surface-1)" }}>
            {ITEMS.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block border-b border-sep px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <span className="block text-sm text-primary">{it.label}</span>
                <span className="t-evidence block text-tertiary">{it.hint}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
