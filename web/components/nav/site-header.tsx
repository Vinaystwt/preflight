import Link from "next/link";
import { Cta } from "@/components/cta";
import { Wordmark } from "./wordmark";
import { DevelopersMenu } from "./developers-menu";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border" style={{ background: "color-mix(in srgb, var(--canvas) 86%, transparent)", backdropFilter: "blur(8px)" }}>
      <div className="mx-auto flex h-14 w-full max-w-[1520px] items-center justify-between gap-4 px-5 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-1" aria-label="Primary">
          <Link
            href="/how-it-works"
            className="hidden rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:text-primary sm:inline-block"
          >
            How it works
          </Link>
          <DevelopersMenu />
          <Link
            href="/pricing"
            className="hidden rounded-md px-3 py-2 text-sm text-secondary transition-colors hover:text-primary sm:inline-block"
          >
            Pricing
          </Link>
          <Cta href="/check" size="sm" className="ml-1">
            Run a check
          </Cta>
        </nav>
      </div>
    </header>
  );
}
