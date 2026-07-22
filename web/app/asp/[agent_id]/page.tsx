import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, FileSearch, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";
import { getAsp, getPassport } from "@/lib/api/endpoints";
import { relativeTime } from "@/lib/format";
import type { AspV1, AspConforming, AspEvidence, PassportV1 } from "@/lib/contracts-v5";

export const dynamic = "force-dynamic";

async function load(agentId: string): Promise<AspV1 | null> {
  try {
    return await getAsp(agentId);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ agent_id: string }> }): Promise<Metadata> {
  const { agent_id } = await params;
  const asp = await load(agent_id);
  const conforming = asp?.runtime_evidence === "conforming";
  // Only conforming permalinks are indexable; evidence/none states are noindex
  // so agent owners are not surfaced by a search for a contradiction page.
  return {
    title: `Agent ${agent_id}, runtime evidence`,
    description: "Runtime evidence gathered by PreFlight free discovery for this OKX.AI agent service.",
    robots: conforming ? undefined : { index: false, follow: false },
  };
}

export default async function AspPage({ params }: { params: Promise<{ agent_id: string }> }) {
  const { agent_id } = await params;
  const asp = await load(agent_id);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-[1000px] px-5 py-16 sm:px-6 lg:py-20">
          {!asp || asp.runtime_evidence === "none" ? (
            <NoneState agentId={agent_id} />
          ) : asp.runtime_evidence === "conforming" ? (
            <ConformingState asp={asp} passport={await getPassport(agent_id).catch(() => null)} />
          ) : (
            <EvidenceState asp={asp} />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Header({ agentId, name, category, lastChecked }: { agentId: string; name?: string | null; category?: string | null; lastChecked?: string }) {
  return (
    <div>
      <span className="t-label text-accent">OKX.AI agent {agentId}</span>
      <h1 className="t-h1 mt-3 text-primary">{name ?? `Agent ${agentId}`}</h1>
      <p className="t-evidence mt-3 text-tertiary">
        {category ? `${category} · ` : ""}{lastChecked ? `last checked ${relativeTime(lastChecked)}` : "not yet checked"}
      </p>
    </div>
  );
}

function ConformingState({ asp, passport }: { asp: AspConforming; passport: PassportV1 | null }) {
  const hasPassport = passport?.state === "active";
  return (
    <div>
      <Header agentId={asp.agent_id} name={asp.name} category={asp.category_code} lastChecked={asp.last_checked} />
      <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-release-border px-3 py-1.5" style={{ background: "var(--release-bg)" }}>
        <ShieldCheck className="size-4 text-release" aria-hidden />
        <span className="t-ui text-release">Live surface conforms to the listing</span>
      </div>
      <p className="t-body mt-6 max-w-2xl text-[15px] leading-[1.6] text-secondary">
        The declared listing matched the observed runtime surface at the last free scan. This states what was seen at
        that runtime snapshot under the current policy. It is not a certification or an endorsement of the service.
      </p>
      {hasPassport && passport?.receipt_id && (
        <div className="mt-8">
          <Link
            href={`/verify?receipt_id=${encodeURIComponent(passport.receipt_id)}`}
            className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover"
            style={{ background: "var(--accent)" }}
          >
            Verify this agent&apos;s receipt <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

function EvidenceState({ asp }: { asp: AspEvidence }) {
  return (
    <div>
      <Header agentId={asp.agent_id} name={asp.name} category={asp.category_code} lastChecked={asp.last_checked} />
      <div className="mt-6 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5" style={{ background: "var(--surface-1)" }}>
        <FileSearch className="size-4 text-tertiary" aria-hidden />
        <span className="t-ui text-secondary">Runtime evidence exists for this service</span>
      </div>
      <p className="t-body mt-6 max-w-2xl text-[15px] leading-[1.6] text-secondary">
        Free discovery observed this service&apos;s live surface. Criterion codes surfaced at the last scan:
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {asp.criterion_codes.map((c) => (
          <li key={c} className="rounded border border-border px-2.5 py-1 font-mono text-[13px] text-secondary" style={{ background: "var(--surface-1)" }}>{c}</li>
        ))}
      </ul>
      <div className="mt-8 rounded-md border border-border p-6" style={{ background: "var(--surface-1)" }}>
        <h2 className="t-h3 text-[17px] text-primary">Are you the owner?</h2>
        <p className="t-body mt-2 max-w-xl text-[14px] leading-[1.6] text-secondary">{asp.owner_claim_cta}</p>
        <Link
          href={`/check?agent_id=${encodeURIComponent(asp.agent_id)}`}
          className="mt-4 inline-flex items-center gap-2 rounded-md px-5 py-2.5 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover"
          style={{ background: "var(--accent)" }}
        >
          Authorize a full check <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function NoneState({ agentId }: { agentId: string }) {
  return (
    <div>
      <Header agentId={agentId} />
      <div className="mt-6 rounded-md border border-border p-6" style={{ background: "var(--surface-1)" }}>
        <p className="t-body text-[15px] leading-[1.6] text-secondary">
          No runtime evidence yet for this agent. Enter this agent ID at{" "}
          <Link href={`/check?agent_id=${encodeURIComponent(agentId)}`} className="text-accent underline underline-offset-2 hover:text-primary">/check</Link>{" "}
          to run free discovery. No account and no payment are needed for discovery.
        </p>
      </div>
    </div>
  );
}
