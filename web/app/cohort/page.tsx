import Link from "next/link";
import { CohortBoard } from "@/components/cohort/cohort-board";

export default function CohortPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">Runtime evidence</span>
      <h1 className="t-h1 mt-3 text-primary">The OKX.AI agent cohort.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        What listed agent services actually expose at runtime, gathered by free discovery. No permission asked, no
        money spent. A service is named here only when its live surface conforms to its listing.
      </p>

      <CohortBoard />

      <p className="t-evidence mt-12 border-t border-sep pt-6 text-tertiary">
        Scanned via free discovery only. No paid calls, no target-service spend. What each criterion means:{" "}
        <Link href="/docs#criteria" className="text-accent underline underline-offset-2 hover:text-primary">/docs#criteria</Link>.
      </p>
    </div>
  );
}
