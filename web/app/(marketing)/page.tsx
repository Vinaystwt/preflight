import { ArrowRight, Radar, CreditCard, ShieldCheck, PackageCheck, Scale, Lock, GitBranch } from "lucide-react";
import { Cta } from "@/components/cta";
import { HeroLoop } from "@/components/hero/hero-loop";
import { DeclaredObserved } from "@/components/matrix/declared-observed";
import { VerdictStamp } from "@/components/verdict-stamp";
import { VerdictTravels } from "@/components/home/verdict-travels";
import { Reveal } from "@/components/reveal";

const EXAMPLE_ROWS = [
  {
    code: "PAY-04",
    label: "PAY-04",
    declared: <>payTo 0x71A8…45E2</>,
    observed: <>payTo 0x442B…9C07</>,
    state: "CONTRADICTION" as const,
    diagnosis: "Buyers would settle to an address you did not declare. Funds leave to the wrong wallet.",
    fix: "Point the endpoint payTo to your declared address, then rerun.",
  },
  {
    code: "PAY-01",
    label: "PAY-01",
    declared: <>0.10 USDT</>,
    observed: <>0.10 USDT</>,
    state: "MATCH" as const,
  },
  {
    code: "DEL-02",
    label: "DEL-02",
    declared: <>quote_id present</>,
    observed: <>quote_id present</>,
    state: "MATCH" as const,
  },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;

  return (
    <>
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="tech-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div
          className="pointer-events-none absolute right-[8%] top-[-10%] h-[520px] w-[520px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(155,140,255,0.16), transparent 62%)" }}
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-[1520px] px-5 py-16 sm:px-6 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,42%)_minmax(0,58%)]">
            <div>
              <span className="t-label inline-flex items-center gap-2 rounded-full border border-accent-border px-3 py-1 text-accent" style={{ background: "var(--accent-muted-bg)" }}>
                A release gate that behaves like a real customer
              </span>
              <h1 className="t-hero mt-6 text-primary">Deployed is not sellable.</h1>
              <p className="t-lead mt-6 max-w-xl text-secondary">
                A service can be live and still be impossible to buy: wrong price,
                wrong payee, broken delivery. PreFlight becomes a real paying
                buyer, proves the whole purchase to delivery journey, and returns
                a verdict with the exact fix.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Cta href="/check">
                  Run a check
                  <ArrowRight className="size-4" aria-hidden />
                </Cta>
                <Cta href="/demo" variant="secondary">
                  Watch the demo
                </Cta>
              </div>
              <p className="t-ui mt-5 text-tertiary">
                Free discovery. 0.10 USDT per full check, paid over x402.
              </p>
              <p className="t-ui mt-2 text-tertiary">
                Every check ends with a signed receipt anyone can verify.
              </p>
            </div>

            <HeroLoop demo={demo === "1"} />
          </div>
        </div>
      </section>

      {/* ===== WHAT IT PROVES ===== */}
      <Section
        kicker="What PreFlight proves"
        title="Anyone can check that a service responds. PreFlight checks that it sells."
      >
        <div className="grid gap-px overflow-hidden rounded-md border border-border md:grid-cols-3" style={{ background: "var(--border)" }}>
          <Prove
            Icon={CreditCard}
            title="The payment is real"
            body="The x402 challenge parses, the price and asset match what you declared, and the payee is your address, not someone else's."
          />
          <Prove
            Icon={ShieldCheck}
            title="The settlement lands"
            body="PreFlight authorizes and settles a real payment on X Layer, then verifies the transaction, so you know money actually moves."
          />
          <Prove
            Icon={PackageCheck}
            title="The delivery arrives"
            body="After paying, PreFlight inspects what the service returns and checks it against your declared response contract."
          />
        </div>
      </Section>

      {/* ===== WORKFLOW ===== */}
      <Section kicker="The journey" title="Discover, pay, settle, deliver, decide.">
        <ol className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-5" style={{ background: "var(--border)" }}>
          {[
            { Icon: Radar, n: "01", t: "Discover", d: "Observe the live transport, MCP contract, and x402 challenge." },
            { Icon: CreditCard, n: "02", t: "Pay", d: "Authorize a real x402 payment as a buyer would." },
            { Icon: ShieldCheck, n: "03", t: "Settle", d: "Confirm settlement on X Layer with the transaction." },
            { Icon: PackageCheck, n: "04", t: "Deliver", d: "Inspect the delivered result against the contract." },
            { Icon: Scale, n: "05", t: "Decide", d: "Compare all of it to what you declared. Verdict + fix." },
          ].map((s) => (
            <li key={s.n} className="bg-surface-1 p-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex size-8 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
                  <s.Icon className="size-4 text-accent" aria-hidden />
                </span>
                <span className="t-evidence text-tertiary">{s.n}</span>
              </div>
              <p className="t-h3 mt-4 text-[17px] text-primary">{s.t}</p>
              <p className="t-body mt-1 text-[14px] text-secondary">{s.d}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ===== DECLARED VS OBSERVED ===== */}
      <Section
        kicker="The evidence"
        title="Declared against observed, one criterion at a time."
        lead="No two unrelated cards side by side. Three stable columns share a baseline per row. On a mismatch, only the changed value is highlighted, the row is marked BLOCK, and the exact fix sits beside the diagnosis."
      >
        <DeclaredObserved rows={EXAMPLE_ROWS} />
      </Section>

      {/* ===== SAMPLE VERDICT CARD ===== */}
      <Section kicker="The result" title="A verdict a teammate can read in one glance.">
        <div className="panel overflow-hidden rounded-md">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <VerdictStamp decision="BLOCK" size="lg" />
              <div>
                <p className="t-evidence text-secondary">quote-svc · release 2026.07.1</p>
                <p className="t-evidence text-tertiary">report pf_01KX6VF2…KVJ</p>
              </div>
            </div>
            <div className="flex gap-6">
              <Metric label="Matched" value="8" />
              <Metric label="Blocked" value="1" tone="block" />
              <Metric label="Unknown" value="0" />
            </div>
          </div>
          <div className="grid gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[112px_1fr]">
            <span className="t-label text-tertiary">Blocked by</span>
            <span className="t-evidence text-primary">PAY-04 · payment recipient contradicts the declared address</span>
            <span className="t-label text-tertiary">Snapshot</span>
            <span className="t-evidence text-secondary">sha256:6e7a0c45…efd17de1 · policy v1</span>
          </div>
        </div>
      </Section>

      {/* ===== THE VERDICT TRAVELS ===== */}
      <VerdictTravels />

      {/* ===== TRUST STRIP ===== */}
      <Section kicker="Trust boundaries" title="Verifiable, private, and honest about what it cannot prove.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Trust Icon={GitBranch} title="Evidence, not opinion" body="Every criterion links the observed value, its provenance, and a snapshot hash. The decision applies to that snapshot." />
          <Trust Icon={Lock} title="Private by default" body="Reports open only with their capability link. No public index. Tokens travel in the URL fragment, never to a server." />
          <Trust Icon={Scale} title="Honest limits" body="PreFlight verifies observable public runtime. It does not guarantee security or marketplace approval." />
        </div>
      </Section>

      {/* ===== FINAL CTA ===== */}
      <section className="mx-auto w-full max-w-[1520px] px-5 pb-8 sm:px-6">
        <div className="panel flex flex-col items-start justify-between gap-6 rounded-md px-6 py-8 sm:flex-row sm:items-center sm:px-8">
          <div>
            <h2 className="t-h2 text-primary">Prove it sells before it ships.</h2>
            <p className="t-body mt-2 text-secondary">Discovery is free. A full check is 0.10 USDT, paid from your agent over x402.</p>
          </div>
          <Cta href="/check" size="md" className="shrink-0">
            Run a check
            <ArrowRight className="size-4" aria-hidden />
          </Cta>
        </div>
      </section>
    </>
  );
}

/* ---- section helpers ---- */

function Section({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-[1520px] px-5 py-16 sm:px-6 lg:py-20">
      <Reveal className="max-w-3xl">
        <span className="t-label text-accent">{kicker}</span>
        <h2 className="t-h2 mt-3 text-primary">{title}</h2>
        {lead && <p className="t-lead mt-4 text-secondary">{lead}</p>}
      </Reveal>
      <Reveal delay={80} className="mt-8">{children}</Reveal>
    </section>
  );
}

function Prove({ Icon, title, body }: { Icon: typeof Radar; title: string; body: string }) {
  return (
    <div className="bg-surface-1 p-6">
      <span className="inline-flex size-9 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
        <Icon className="size-4.5 text-accent" aria-hidden />
      </span>
      <h3 className="t-h3 mt-4 text-[18px] text-primary">{title}</h3>
      <p className="t-body mt-2 text-[14px] text-secondary">{body}</p>
    </div>
  );
}

function Trust({ Icon, title, body }: { Icon: typeof Radar; title: string; body: string }) {
  return (
    <div className="panel rounded-md p-6">
      <span className="inline-flex size-9 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
        <Icon className="size-4.5 text-accent" aria-hidden />
      </span>
      <h3 className="t-h3 mt-4 text-[17px] text-primary">{title}</h3>
      <p className="t-body mt-2 text-[14px] text-secondary">{body}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "block" }) {
  return (
    <div className="text-right">
      <p className="t-label text-tertiary">{label}</p>
      <p className={`t-metric ${tone === "block" ? "text-block" : "text-primary"}`}>{value}</p>
    </div>
  );
}
