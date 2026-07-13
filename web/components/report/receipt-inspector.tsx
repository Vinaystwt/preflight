"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Copy, Check, Download, KeyRound, Loader2, ExternalLink } from "lucide-react";
import type { Receipt, PublicKey } from "@/lib/contracts";
import { getPubkeys } from "@/lib/api/endpoints";
import { verifyReceipt, keyFingerprint, type VerifyResult } from "@/lib/receipt-verify";
import { middleTruncate, formatTimestamp, OKLINK_TX } from "@/lib/format";
import { VerdictStamp } from "@/components/verdict-stamp";

type VState =
  | { k: "idle" }
  | { k: "verifying" }
  | { k: "done"; result: VerifyResult }
  | { k: "error"; message: string };

export function ReceiptInspector({
  receipt,
  reportHashes,
}: {
  receipt: Receipt;
  reportHashes?: { manifest_hash?: string; snapshot_hash?: string };
}) {
  const [v, setV] = useState<VState>({ k: "idle" });
  const [fp, setFp] = useState<string>("");
  const [keys, setKeys] = useState<PublicKey[] | null>(null);
  const [showKey, setShowKey] = useState(false);
  const p = receipt.payload;

  useEffect(() => {
    keyFingerprint(receipt.key_id).then(setFp);
  }, [receipt.key_id]);

  async function ensureKeys(): Promise<PublicKey[]> {
    if (keys) return keys;
    const pub = await getPubkeys();
    setKeys(pub.keys);
    return pub.keys;
  }

  async function runVerify() {
    setV({ k: "verifying" });
    try {
      const k = await ensureKeys();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) await new Promise((r) => setTimeout(r, 520));
      const result = await verifyReceipt(receipt, k, reportHashes);
      setV({ k: "done", result });
    } catch {
      setV({ k: "error", message: "Could not reach the public key service to verify. Try again." });
    }
  }

  return (
    <section id="receipt" className="scroll-mt-20">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="size-4 text-accent" aria-hidden />
        <h2 className="t-h3 text-[17px] text-primary">Signed receipt</h2>
        <span className="t-ui text-tertiary">Portable proof anyone can verify</span>
      </div>

      <div className="mx-auto max-w-[820px] overflow-hidden rounded-lg" style={{ background: "var(--surface-1)", border: "1px solid var(--border-strong)", boxShadow: "inset 0 1px 0 0 var(--top-highlight)" }}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <p className="t-label text-tertiary">PreFlight · Signed receipt</p>
            <p className="t-evidence text-tertiary">BILL_OF_LADING · {p.type}</p>
          </div>
          <VerdictStamp decision={p.decision} size="sm" />
        </div>

        {/* identity */}
        <dl className="grid gap-x-6 gap-y-2.5 border-b border-sep px-5 py-4 sm:grid-cols-2">
          <Field label="Receipt ID" value={p.receipt_id} copy />
          <Field label="Report ID" value={p.report_id} copy />
          <Field label="Policy version" value={p.policy_version} />
          <Field label="Issued at" value={formatTimestamp(p.issued_at)} />
          <Field label="Payer" value={p.payer ?? "not recorded"} copy={!!p.payer} />
          <Field label="Price" value={`${p.price_usdt} USDT`} />
          <Field label="Target fingerprint" value={p.target_fingerprint} copy full />
        </dl>

        {/* hashes */}
        <div className="grid gap-px border-b border-sep sm:grid-cols-2" style={{ background: "var(--sep)" }}>
          <HashCell label="Manifest hash" value={p.manifest_hash} />
          <HashCell label="Snapshot hash" value={p.snapshot_hash} />
        </div>

        {/* signature block */}
        <div className="border-b border-sep px-5 py-4">
          <p className="t-label mb-2 text-tertiary">Signature</p>
          <div className="relative overflow-hidden rounded-md border border-border p-3" style={{ background: "var(--base)" }}>
            {/* scan line during verify */}
            {v.k === "verifying" && (
              <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-receipt-scan" style={{ background: "linear-gradient(90deg, transparent, rgba(155,140,255,0.22), transparent)" }} aria-hidden />
            )}
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Field label="Algorithm" value={receipt.signature_alg} />
              <Field label="Key fingerprint" value={fp || "…"} />
              <Field label="Payload hash" value={receipt.verify.payload_hash} copy full />
              <Field label="Signature" value={receipt.signature} copy full />
            </dl>
          </div>

          {/* verify results */}
          <div className="mt-3" aria-live="polite">
            {v.k === "done" && <VerifyResults r={v.result} />}
            {v.k === "error" && <p className="t-ui text-block">{v.message}</p>}
          </div>
        </div>

        {/* verify command hint */}
        <div className="border-b border-sep px-5 py-3">
          <CopyLine text={`preflight verify-receipt ${p.receipt_id}`} />
        </div>

        {/* actions, ordered by trust value */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <button
            type="button"
            onClick={runVerify}
            disabled={v.k === "verifying"}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {v.k === "verifying" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
            {v.k === "verifying" ? "Verifying" : "Verify receipt"}
          </button>
          <ActionBtn icon={Download} label="Download JSON" onClick={() => downloadJson(receipt)} />
          <ActionBtn icon={KeyRound} label="View public key" onClick={async () => { await ensureKeys(); setShowKey((s) => !s); }} />
          {p.chain_anchor && (
            <a href={OKLINK_TX(p.chain_anchor.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 t-ui text-tertiary transition-colors hover:bg-surface-2 hover:text-secondary">
              Anchor on-chain <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>

        {showKey && keys && (
          <div className="border-t border-sep px-5 py-3">
            {keys.filter((k) => k.key_id === receipt.key_id || k.status === "active").map((k) => (
              <div key={k.key_id} className="t-evidence">
                <p className="text-tertiary">{k.key_id} · {k.algorithm} · {k.status}</p>
                <p className="mt-1 break-all text-secondary">{k.public_key_base64}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VerifyResults({ r }: { r: VerifyResult }) {
  const rows: [string, boolean | null][] = [
    ["Signature valid", r.signatureValid],
    ["Manifest intact", r.manifestIntact],
    ["Snapshot intact", r.snapshotIntact],
    ["Policy recognized", r.policyRecognized],
    ["Payload hash matches", r.payloadHashMatches],
  ];
  return (
    <div className="rounded-md border p-3" style={{ background: "var(--release-bg)", borderColor: "var(--release-border)" }}>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rows.map(([label, ok]) => (
          <li key={label} className="flex items-center gap-2 t-ui">
            {ok === null ? (
              <span className="text-warning">◦</span>
            ) : ok ? (
              <Check className="size-3.5 text-release" aria-hidden />
            ) : (
              <span className="text-block" aria-hidden>×</span>
            )}
            <span className={ok === false ? "text-block" : "text-secondary"}>
              {label}
              {ok === null && label === "Signature valid" ? " (checked by hash; Ed25519 not available in this browser)" : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 t-evidence text-tertiary">
        {r.method === "client-ed25519"
          ? "Verified in your browser against PreFlight's published Ed25519 key."
          : "Payload integrity verified in your browser; signature attested by PreFlight's public key service."}
      </p>
    </div>
  );
}

function Field({ label, value, copy, full }: { label: string; value: string; copy?: boolean; full?: boolean }) {
  const [c, setC] = useState(false);
  const display = full ? middleTruncate(value, 10, 8) : value.length > 34 ? middleTruncate(value, 14, 10) : value;
  return (
    <div className="min-w-0">
      <dt className="t-label text-tertiary">{label}</dt>
      <dd className="mt-0.5 flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-[13px] text-secondary" title={value}>{display}</span>
        {copy && (
          <button type="button" aria-label={`Copy ${label}`} onClick={() => { navigator.clipboard.writeText(value); setC(true); setTimeout(() => setC(false), 1400); }} className="inline-flex size-5 shrink-0 items-center justify-center rounded text-tertiary transition-colors hover:bg-hover hover:text-primary">
            {c ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          </button>
        )}
      </dd>
    </div>
  );
}

function HashCell({ label, value }: { label: string; value: string }) {
  const [c, setC] = useState(false);
  return (
    <div className="bg-surface-1 px-5 py-3">
      <p className="t-label text-tertiary">{label}</p>
      <button type="button" onClick={() => { navigator.clipboard.writeText(value); setC(true); setTimeout(() => setC(false), 1400); }} className="mt-1 flex w-full items-center gap-1.5 text-left" title={value}>
        <span className="min-w-0 truncate font-mono text-[13px] text-secondary">{value}</span>
        {c ? <Check className="size-3 shrink-0 text-accent" aria-hidden /> : <Copy className="size-3 shrink-0 text-tertiary" aria-hidden />}
      </button>
    </div>
  );
}

function CopyLine({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1400); }} className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-surface-2" style={{ background: "var(--base)" }}>
      <code className="min-w-0 truncate font-mono text-[13px] text-secondary">{text}</code>
      <span className="inline-flex items-center gap-1 t-ui text-tertiary">{c ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{c ? "Copied" : "Copy"}</span>
    </button>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Download; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 t-ui text-secondary transition-colors hover:bg-surface-2 hover:text-primary">
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function downloadJson(receipt: Receipt) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${receipt.receipt_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
