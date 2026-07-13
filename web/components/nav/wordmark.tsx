import Link from "next/link";
import { cn } from "@/lib/utils";

/** PreFlight wordmark. Mark = a declared line and an observed line meeting at a
 *  verdict node — the product's idea in one glyph. */
export function Wordmark({ href = "/", className }: { href?: string | null; className?: string }) {
  const inner = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="shrink-0">
        <path d="M2 7 H12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        <path d="M2 13 H9" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="15.5" cy="10" r="2.5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <span className="font-display text-[17px] font-medium tracking-[-0.02em] text-primary">PreFlight</span>
    </span>
  );
  if (href === null) return inner;
  return (
    <Link href={href} aria-label="PreFlight home" className="rounded-md">
      {inner}
    </Link>
  );
}
