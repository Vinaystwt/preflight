"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    head: "Product",
    links: [
      { href: "/check", label: "Run a check" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/demo", label: "Demo" },
    ],
  },
  {
    head: "Evidence",
    links: [
      { href: "/cohort", label: "Cohort" },
      { href: "/verify", label: "Verify a receipt" },
      { href: "/benchmark", label: "Benchmark" },
      { href: "/gallery", label: "Gallery" },
    ],
  },
  {
    head: "Developers",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/cli", label: "CLI" },
      { href: "/docs#api", label: "verify_release API" },
      { href: "/docs#mcp", label: "MCP server" },
    ],
  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const firstLink = panelRef.current?.querySelector("a");
    firstLink?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 items-center justify-center rounded-md text-secondary transition-colors hover:text-primary sm:hidden"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 motion-safe:animate-[fadeIn_150ms_ease-out]"
            aria-hidden
            onClick={close}
          />
          <div
            ref={panelRef}
            id="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 right-0 z-50 flex w-[280px] flex-col overflow-y-auto border-l border-border motion-safe:animate-[slideIn_200ms_ease-out]"
            style={{ background: "var(--base)" }}
          >
            <div className="flex h-14 items-center justify-end px-5">
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="inline-flex size-9 items-center justify-center rounded-md text-secondary transition-colors hover:text-primary"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <nav aria-label="Mobile navigation" className="flex-1 px-5 pb-8">
              {SECTIONS.map((s) => (
                <div key={s.head} className="mt-6 first:mt-0">
                  <p className="t-label text-tertiary">{s.head}</p>
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {s.links.map((l) => {
                      const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href.split("#")[0]));
                      return (
                        <li key={l.href}>
                          <Link
                            href={l.href}
                            className={cn(
                              "block rounded-md px-3 py-2 text-sm transition-colors",
                              active ? "bg-surface-2 text-primary" : "text-secondary hover:text-primary",
                            )}
                            aria-current={active ? "page" : undefined}
                          >
                            {l.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
