"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar, Hash, Scale, PenLine, FileCheck2, ShieldCheck, ArrowRight, Terminal, Code2, Boxes } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { getPubkeys, getGallery } from "@/lib/api/endpoints";
import { REFERENCE } from "@/lib/gallery-reference";

const CHAIN = [
  { Icon: Radar, t: "Live runtime", d: "The service as it answers right now" },
  { Icon: Hash, t: "Snapshot hash", d: "What was observed, frozen" },
  { Icon: Scale, t: "Policy decision", d: "RELEASE, BLOCK, or UNKNOWN" },
  { Icon: PenLine, t: "Ed25519 signature", d: "Signed by PreFlight's key" },
  { Icon: FileCheck2, t: "Portable receipt", d: "A verdict that travels" },
  { Icon: ShieldCheck, t: "Independent check", d: "Anyone verifies it, offline of us" },
];

export function VerdictTravels() {
  const [keyId, setKeyId] = useState<string | null>(null);
  const [publicCount, setPublicCount] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getPubkeys(ac.signal)
      .then((k) => setKeyId(k.keys.find((x) => x.status === "active")?.key_id ?? k.keys[0]?.key_id ?? null))
      .catch(() => {});
    getGallery(ac.signal)
      .then((g) => setPublicCount(g.entries.length))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const previews = REFERENCE.slice(0, 3);

  return (
    <section className="mx-auto w-full max-w-[1520px] px-5 py-16 sm:px-6 lg:py-20">
      <div className="max-w-3xl">
        <span className="t-label text-accent">The verdict travels</span>
        <h2 className="t-h2 mt-3 text-primary">A decision you can hand to anyone.</h2>
        <p className="t-lead mt-4 text-secondary">
          Every completed full verification issues a signed receipt. It carries the snapshot it judged
          and PreFlight&apos;s Ed25519 signature, so a buyer, an auditor, or a marketplace can verify
          that PreFlight issued an unaltered receipt for that snapshot and policy version.
        </p>
      </div>

      {/* trust chain */}
      <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-2 lg:grid-cols-6" style={{ background: "var(--border)" }}>
        {CHAIN.map((c, i) => (
          <Reveal key={c.t} delay={i * 60} className="bg-surface-1 p-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
                <c.Icon className="size-4 text-accent" aria-hidden />
              </span>
              <span className="t-evidence text-tertiary">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <p className="t-h3 mt-3 text-[15px] text-primary">{c.t}</p>
            <p className="t-body mt-1 text-[13px] leading-[1.5] text-secondary">{c.d}</p>
          </Reveal>
        ))}
      </div>

      {/* live signing key */}
      <Reveal className="mt-6">
        <div className="flex flex-col gap-3 rounded-md border border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--surface-1)" }}>
          <div className="flex items-center gap-3">
            <span className="inline-flex size-2 rounded-full" style={{ background: "var(--release-fg)" }} aria-hidden />
            <p className="t-ui text-secondary">
              Live signing key
              {keyId ? (
                <>
                  {" "}
                  <span className="font-mono text-primary">{keyId}</span>
                </>
              ) : (
                <span className="text-tertiary"> loading…</span>
              )}
            </p>
          </div>
          <Link href="/docs#mcp" className="t-ui text-accent underline underline-offset-2 hover:text-primary">
            How verification works
          </Link>
        </div>
      </Reveal>

      {/* gallery preview + dev strip */}
      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* gallery preview */}
        <Reveal>
          <div className="flex items-baseline justify-between">
            <h3 className="t-h3 text-[18px] text-primary">From the failure gallery</h3>
            <Link href="/gallery" className="t-ui inline-flex items-center gap-1 text-accent hover:text-primary">
              Open gallery <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <p className="t-evidence mt-1 text-tertiary">
            {publicCount === null
              ? "Reference archetypes · synthetic"
              : `${publicCount} public opt-in case${publicCount === 1 ? "" : "s"} · plus reference archetypes (synthetic)`}
          </p>
          <ul className="mt-4 overflow-hidden rounded-md border border-border" style={{ background: "var(--surface-1)" }}>
            {previews.map((r) => (
              <li key={r.id} className="flex items-center gap-4 border-b border-sep px-5 py-3 last:border-b-0">
                <span className="font-mono text-[13px] text-secondary">{r.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-primary">{r.title}</span>
                  <span className="t-evidence block truncate text-tertiary">{r.why}</span>
                </span>
                <span className="inline-flex shrink-0 items-center rounded border border-block-border px-2 py-0.5 t-label text-block" style={{ background: "var(--block-bg)" }}>
                  {r.decision}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        {/* dev integration strip */}
        <Reveal delay={80}>
          <h3 className="t-h3 text-[18px] text-primary">Wire it into your release</h3>
          <p className="t-evidence mt-1 text-tertiary">Same check, same signed receipt, wherever releases happen.</p>
          <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-md border border-border" style={{ background: "var(--border)" }}>
            <DevRow Icon={Terminal} href="/cli" title="CLI" hint="Gate a pipeline on the exit code" />
            <DevRow Icon={Code2} href="/docs#api" title="verify_release API" hint="One call returns machine JSON" />
            <DevRow Icon={Boxes} href="/docs#mcp" title="MCP server" hint="Give an agent the check as a tool" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function DevRow({ Icon, href, title, hint }: { Icon: typeof Radar; href: string; title: string; hint: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 bg-surface-1 px-5 py-4 transition-colors hover:bg-surface-2">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border" style={{ background: "var(--surface-2)" }}>
        <Icon className="size-4 text-accent" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-primary">{title}</span>
        <span className="t-evidence block text-tertiary">{hint}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-secondary" aria-hidden />
    </Link>
  );
}
