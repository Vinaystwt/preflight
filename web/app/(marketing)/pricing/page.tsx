import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Cta } from "@/components/cta";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "Pricing",
  description: "0.10 USDT per check, paid over x402. USDT0 on X Layer. No signup.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">Pricing</span>
      <h1 className="t-h1 mt-3 text-primary">One price. Paid by your agent.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        Discovery is free. A full check, the one that becomes a real buyer and proves the whole
        purchase to delivery journey, is a single flat price paid over x402. No signup, no seats,
        no sales call.
      </p>

      <div className="mt-10 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* price card */}
        <Reveal as="div" className="panel rounded-md p-7">
          <p className="t-label text-tertiary">Full check</p>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-5xl font-medium tracking-tight text-primary">0.10</span>
            <span className="t-metric text-secondary">USDT</span>
          </p>
          <p className="t-body mt-1 text-[14px] text-tertiary">per check, paid over x402</p>
          <ul className="mt-6 flex flex-col gap-2.5">
            {[
              "Discover, pay, settle, deliver, decide",
              "Real buyer proof: settlement and delivery",
              "Declared vs observed, criterion by criterion",
              "A private report with the exact fix",
              "Machine report for CI, with exit codes",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2 t-body text-[14px] text-secondary">
                <Check className="mt-0.5 size-4 shrink-0 text-release" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
          <Cta href="/check" className="mt-7 w-full">Run a check</Cta>
        </Reveal>

        {/* how payment works */}
        <Reveal as="div" delay={100} className="flex flex-col gap-4">
          <Card title="How payment works">
            Your agent sends the manifest and receives an HTTP 402 with the payment requirements. It
            signs an x402 authorization and replays. Settlement happens on chain. PreFlight never
            holds your key.
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Asset and network">
              <span className="font-mono text-primary">USDT0</span> on <span className="text-primary">X Layer</span>.
              The check fee settles in that asset.
            </Card>
            <Card title="Failed payment">
              A check that never runs is not charged. If a response is interrupted after payment,
              retry with the same identity, you are not charged twice.
            </Card>
            <Card title="Test versus live">
              Point PreFlight at your staging or production endpoint. The check behaves the same; it
              always acts as a real buyer against whatever endpoint you declare.
            </Card>
            <Card title="Live buyer target spend">
              If your service itself charges, PreFlight pays that too as a real buyer. When you test
              your own service, that target payment settles back to you.
            </Card>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel rounded-md p-5">
      <h2 className="t-h3 text-[15px] text-primary">{title}</h2>
      <p className="t-body mt-2 text-[14px] text-secondary">{children}</p>
    </div>
  );
}
