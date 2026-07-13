import Link from "next/link";
import { Lock, FileQuestion, ServerCrash, Clock } from "lucide-react";
import { Wordmark } from "@/components/nav/wordmark";
import { ExecutionRail, type RailNode } from "@/components/execution-rail";
import { Skeleton } from "@/components/ui/skeleton";

const RAIL: RailNode[] = ["LISTING", "DISCOVERY", "REQUEST", "402", "PAYMENT", "SETTLEMENT", "DELIVERY", "VERDICT"].map(
  (label, i) => ({ key: label, label, state: i === 0 ? "active" : "pending" }),
);

function Bare() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center px-5 sm:px-6"><Wordmark /></div>
    </header>
  );
}

/* Instrument-stage loading: fixed shell matching the real geometry, with the
   honest access phase (P2.3). No fake criterion resolution. */
export function ReportLoading({ label = "Validating access" }: { label?: string }) {
  return (
    <>
      <Bare />
      <main id="main" className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-6" role="status" aria-label="Loading report">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_180px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 w-full rounded-md" style={{ background: "var(--surface-2)" }} />
            <Skeleton className="h-40 w-full rounded-md" style={{ background: "var(--surface-2)" }} />
          </div>
          <div className="panel h-fit rounded-md px-4 py-4">
            <span className="t-label mb-3 block text-tertiary">EXECUTION</span>
            <ExecutionRail nodes={RAIL} />
          </div>
        </div>
        <p className="mt-4 t-ui text-tertiary">{label.toUpperCase()}…</p>
      </main>
    </>
  );
}

function Problem({ Icon, title, body, requestId }: { Icon: typeof Lock; title: string; body: string; requestId?: string }) {
  return (
    <>
      <Bare />
      <main id="main" className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-start px-5 py-20 sm:px-6">
        <span className="inline-flex size-11 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
          <Icon className="size-5 text-tertiary" aria-hidden />
        </span>
        <h1 className="t-h2 mt-5 text-primary">{title}</h1>
        <p className="t-body mt-3 text-secondary">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/check" className="inline-flex h-10 items-center rounded-md bg-accent px-4 t-ui font-medium text-inverse hover:bg-accent-hover">Run a check</Link>
          <Link href="/how-it-works" className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 t-ui text-primary hover:bg-hover">How it works</Link>
        </div>
        {requestId && <p className="mt-8 t-evidence text-tertiary">Request ID: {requestId}</p>}
      </main>
    </>
  );
}

export const ReportNeedsLink = () => (
  <Problem Icon={Lock} title="This report is private" body="PreFlight reports open only with their capability link. Ask whoever shared it for the full link, including the part after the # (that part never leaves your browser)." />
);
export const ReportExpired = ({ requestId }: { requestId?: string }) => (
  <Problem Icon={Clock} title="This report has expired" body="Reports are retained for 30 days and then removed. Run the check again to produce a fresh report." requestId={requestId} />
);
export const ReportUnavailable = ({ requestId }: { requestId?: string }) => (
  <Problem Icon={FileQuestion} title="This report is unavailable" body="The link may be invalid or the report may no longer exist. Nothing about the report can be shown without a valid link." requestId={requestId} />
);
export const ReportFailed = ({ requestId }: { requestId?: string }) => (
  <Problem Icon={ServerCrash} title="Could not load this report" body="The report service did not respond. This is on our side, not your link. Wait a moment and reload." requestId={requestId} />
);
