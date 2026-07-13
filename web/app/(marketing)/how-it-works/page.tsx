import type { Metadata } from "next";
import { Cta } from "@/components/cta";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "How it works",
  description: "The nine-step buyer journey PreFlight runs, and exactly what it can and cannot prove.",
};

const STEPS = [
  ["Declare", "You confirm a release manifest: the endpoint, interface, payment terms, and the request and response contracts you intend to publish."],
  ["Discover", "PreFlight observes the live transport, resolves the MCP contract, and reads the x402 challenge from the running service."],
  ["Reconcile", "It compares the observed surface against your declaration, one criterion at a time, and records where they agree or diverge."],
  ["Authorize", "Acting as a buyer, PreFlight authorizes a real x402 payment for the declared price to the declared payee."],
  ["Settle", "The payment settles on X Layer. PreFlight verifies the settlement rather than trusting a claim."],
  ["Deliver", "After paying, PreFlight takes delivery and inspects the returned result against your response contract."],
  ["Replay guard", "It confirms a duplicate payment replay is rejected, so a buyer cannot be double charged."],
  ["Seal", "Every criterion, its evidence, provenance, and a snapshot hash are sealed into a report."],
  ["Decide", "PreFlight returns RELEASE, BLOCK, or UNKNOWN, with the consequence and the exact fix for anything that failed."],
];

const CAN = [
  "That the live x402 challenge parses and matches your declared price, asset, network, and payee",
  "That a real payment settles on chain to the address you declared",
  "That delivery arrives and matches your declared response contract",
  "That a duplicate payment replay is rejected",
];
const CANNOT = [
  "Private or authenticated behavior it cannot observe as a public buyer",
  "Correctness beyond the criteria you declared",
  "Security of your service, or approval by any marketplace",
  "Behavior of a different build than the one live at the snapshot time",
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-16 sm:px-6 lg:py-20">
      <span className="t-label text-accent">How it works</span>
      <h1 className="t-h1 mt-3 max-w-3xl text-primary">PreFlight runs the buyer journey, then tells you what happened.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        A service can respond and still be impossible to buy. PreFlight walks the whole path a paying
        customer walks, and seals every step as evidence.
      </p>

      {/* journey */}
      <ol className="mt-12 grid gap-px overflow-hidden rounded-md border border-border md:grid-cols-3" style={{ background: "var(--border)" }}>
        {STEPS.map(([t, d], i) => (
          <Reveal key={t} as="li" delay={Math.min(i, 6) * 50} className="bg-surface-1 p-6">
            <span className="t-evidence text-secondary">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="t-h3 mt-2 text-[17px] text-primary">{t}</h2>
            <p className="t-body mt-1.5 text-[14px] text-secondary">{d}</p>
          </Reveal>
        ))}
      </ol>

      {/* can / cannot */}
      <Reveal className="mt-16 grid gap-6 md:grid-cols-2">
        <Boundary title="What PreFlight proves" items={CAN} tone="release" />
        <Boundary title="What it does not prove" items={CANNOT} tone="tertiary" />
      </Reveal>

      {/* trust model */}
      <Reveal className="mt-16 grid gap-6 md:grid-cols-3">
        <Card title="Wallet and signing">
          PreFlight uses its own buyer wallet to pay the check fee and any target spend. Your agent
          signs its own payments. No private key you hold ever reaches PreFlight.
        </Card>
        <Card title="Private by default">
          Reports open only with their capability link. The token travels in the URL fragment and is
          never sent to a server, log, or analytics. There is no public index of reports.
        </Card>
        <Card title="Retention">
          Reports are retained for 30 days, then removed. The canonical manifest and the report are
          stored; no wallet key or raw secret is. Download the report JSON for a durable copy.
        </Card>
      </Reveal>

      {/* failure taxonomy */}
      <Reveal as="section" className="mt-16">
        <h2 className="t-h2 text-primary">Failure taxonomy</h2>
        <p className="t-lead mt-3 max-w-2xl text-secondary">Every criterion resolves to one of four states.</p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-2 lg:grid-cols-4" style={{ background: "var(--border)" }}>
          {[
            ["MATCH", "Declared and observed agree.", "text-release"],
            ["CONTRADICTION", "They disagree. This blocks the release, and the report shows both values and the fix.", "text-block"],
            ["UNKNOWN", "The value could not be observed without guessing, so it is reported as unknown.", "text-warning"],
            ["NOT APPLICABLE", "The criterion does not apply to this manifest.", "text-tertiary"],
          ].map(([t, d, tone]) => (
            <div key={t} className="bg-surface-1 p-5">
              <span className={`t-label ${tone}`}>{t}</span>
              <p className="t-body mt-2 text-[14px] text-secondary">{d}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <div className="mt-16">
        <Cta href="/check">Run a check</Cta>
      </div>
    </div>
  );
}

function Boundary({ title, items, tone }: { title: string; items: string[]; tone: "release" | "tertiary" }) {
  return (
    <div className="panel rounded-md p-6">
      <h2 className="t-h3 text-[17px] text-primary">{title}</h2>
      <ul className="mt-4 flex flex-col gap-2.5">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2.5 t-body text-[14px] text-secondary">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${tone === "release" ? "bg-release" : "bg-tertiary"}`} aria-hidden />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel rounded-md p-6">
      <h2 className="t-h3 text-[16px] text-primary">{title}</h2>
      <p className="t-body mt-2 text-[14px] text-secondary">{children}</p>
    </div>
  );
}
