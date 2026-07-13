import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms", description: "What PreFlight verifies, what it charges, and what it does not guarantee." };

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-6">
      <h1 className="t-h1 text-primary">Terms</h1>
      <p className="t-ui mt-2 text-tertiary">Plain terms that match how the service behaves.</p>
      <div className="mt-8 flex flex-col gap-8">
        <Block title="What the service does">
          <li>PreFlight compares a release manifest you confirm against the observable runtime of the endpoint you declare, acting as a real buyer.</li>
          <li>It returns RELEASE, BLOCK, or UNKNOWN with per criterion evidence. The decision applies only to the runtime snapshot named in the report.</li>
        </Block>
        <Block title="What it does not guarantee">
          <li>It verifies observable public runtime only, not private behavior.</li>
          <li>It does not guarantee security, correctness beyond the checked criteria, or approval by any marketplace.</li>
          <li>A RELEASE decision is not a certification and is not described as safe or approved.</li>
        </Block>
        <Block title="Payment and charges">
          <li>A full check is 0.10 USDT, paid per call over x402 in USDT0 on X Layer.</li>
          <li>A check that runs is charged once. A request that never runs is not charged, and a safe retry of an interrupted call does not charge twice.</li>
          <li>If your service charges, PreFlight pays that target spend as a real buyer. A self testing operator receives their own target payment back.</li>
          <li>Because each decision applies to a single snapshot, a completed check that returns a decision you did not want is not refundable.</li>
        </Block>
        <Block title="Acceptable use">
          <li>Submit only endpoints you own or are authorized to verify.</li>
          <li>PreFlight probes public runtime over the declared method and does not attempt to bypass authentication.</li>
        </Block>
      </div>
      <p className="t-body mt-10 text-[14px] text-tertiary">
        See <Link href="/how-it-works" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">how it works</Link> for trust boundaries and the wallet model.
      </p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="t-h3 text-[17px] text-primary">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2 t-body text-[15px] text-secondary [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:left-1 [&>li]:before:text-tertiary [&>li]:before:content-['–']">
        {children}
      </ul>
    </section>
  );
}
