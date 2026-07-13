import Link from "next/link";
import { Compass } from "lucide-react";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-start px-5 py-24 sm:px-6">
        <span className="inline-flex size-11 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
          <Compass className="size-5 text-tertiary" aria-hidden />
        </span>
        <h1 className="t-h1 mt-5 text-primary">This page does not exist</h1>
        <p className="t-body mt-3 text-secondary">
          The address may be mistyped, or the page may have moved. If you were opening a report, use
          the full private link you were given. Report links are not reachable from here.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" className="inline-flex h-10 items-center rounded-md bg-accent px-4 t-ui font-medium text-inverse hover:bg-accent-hover">Home</Link>
          <Link href="/docs" className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 t-ui text-primary hover:bg-hover">Docs</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
