import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy", description: "What PreFlight stores, for how long, and how report privacy works." };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-6">
      <h1 className="t-h1 text-primary">Privacy</h1>
      <p className="t-ui mt-2 text-tertiary">Written to match what the product does, not to hedge.</p>
      <div className="mt-8 flex flex-col gap-8">
        <Block title="What we store">
          <li>The canonical release manifest you confirmed, and the report produced from it.</li>
          <li>Operational records needed to run and settle a paid check.</li>
          <li>No wallet private key, seed, or payment signature is received or stored. A probe input, if provided, is transient and represented only by a digest in evidence, never stored raw.</li>
        </Block>
        <Block title="Report privacy">
          <li>Reports open only with their capability token, which travels in the URL fragment and is never sent to our servers, logs, or analytics.</li>
          <li>There is no public index of reports and no dynamic public report page.</li>
          <li>Anyone with a full link can read that report, so share links deliberately.</li>
        </Block>
        <Block title="Retention">
          <li>Reports are retained for 30 days and then removed.</li>
          <li>After removal the link resolves to an unavailable state that reveals nothing about the former report.</li>
          <li>Download the report JSON if you need a durable copy.</li>
        </Block>
        <Block title="Probing">
          <li>PreFlight observes only the public runtime you declare, over the declared method, and pays as a real buyer.</li>
          <li>It does not attempt to bypass authentication.</li>
        </Block>
      </div>
      <p className="t-body mt-10 text-[14px] text-tertiary">
        Questions go to <Link href="/how-it-works" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">how it works</Link>, or reach the maintainer at{" "}
        <a href="https://x.com/vinaystwt" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">@vinaystwt</a>.
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
