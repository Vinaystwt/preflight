"use client";

import { useState, useCallback, useEffect } from "react";
import { Check, X, Search, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { verifyReceipt } from "@/lib/api/endpoints";
import { ApiError, TransportError, API_BASE } from "@/lib/api/client";
import { middleTruncate, formatTimestamp } from "@/lib/format";
import { ScopeBlock } from "@/components/scope-block";
import { CodeBlock } from "@/components/code-block";
import type { VerifyReceiptResult } from "@/lib/contracts-v5";

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: VerifyReceiptResult }
  | { phase: "error"; message: string };

export function VerifyWorkspace({ initialReceiptId }: { initialReceiptId?: string }) {
  const [value, setValue] = useState(initialReceiptId ?? "");
  const [state, setState] = useState<State>({ phase: "idle" });

  const run = useCallback(async (raw: string) => {
    const input = raw.trim();
    if (!input) return;
    setState({ phase: "loading" });
    // A receipt_id is a short token; a full receipt is JSON. Detect which.
    let body: { receipt_id: string } | { payload: unknown; signature: string; key_id: string };
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input) as { payload?: unknown; signature?: string; key_id?: string };
        if (!parsed.payload || !parsed.signature || !parsed.key_id) {
          setState({ phase: "error", message: "Pasted JSON must include payload, signature, and key_id." });
          return;
        }
        body = { payload: parsed.payload, signature: parsed.signature, key_id: parsed.key_id };
      } catch {
        setState({ phase: "error", message: "That does not parse as receipt JSON." });
        return;
      }
    } else {
      body = { receipt_id: input };
    }
    try {
      const result = await verifyReceipt(body);
      setState({ phase: "done", result });
    } catch (e) {
      if (e instanceof ApiError) setState({ phase: "error", message: e.message });
      else if (e instanceof TransportError) setState({ phase: "error", message: "Could not reach the verifier. It is public and safe to retry." });
      else setState({ phase: "error", message: "Verification failed." });
    }
  }, []);

  // Auto-run when a receipt_id is prefilled from the query string.
  useEffect(() => {
    if (initialReceiptId) void run(initialReceiptId);
  }, [initialReceiptId, run]);

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); void run(value); }}
        className="rounded-md border border-border p-4 sm:p-5"
        style={{ background: "var(--surface-1)" }}
      >
        <label htmlFor="receipt-input" className="t-label text-tertiary">Receipt ID or receipt JSON</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="receipt-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="rcpt_… or paste receipt JSON"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-border bg-base px-3 py-2.5 font-mono text-[13px] text-primary placeholder:text-tertiary focus-visible:outline-2 focus-visible:outline-accent-focus"
          />
          <button
            type="submit"
            disabled={state.phase === "loading" || !value.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-5 py-2.5 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {state.phase === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            Verify
          </button>
        </div>
        <p className="t-evidence mt-2.5 text-tertiary">Public verifier. No account, no token. Nothing you paste is stored.</p>
      </form>

      {state.phase === "idle" && !initialReceiptId && (
        <div className="mt-6 rounded-md border border-border p-5" style={{ background: "var(--surface-1)" }}>
          <p className="t-body text-[15px] leading-[1.6] text-secondary">
            Paste a receipt ID or a full receipt. The verifier confirms the signature against PreFlight&apos;s
            published keys, checks the payload has not been altered, and reports the runtime snapshot and policy
            version the receipt is bound to. You can fetch the public keys yourself at{" "}
            <a href={`${API_BASE}/api/v1/pubkeys`} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-primary">
              /api/v1/pubkeys
            </a>{" "}
            and run the offline command below to check it without trusting this page.
          </p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="mt-6 rounded-md border border-block-border p-5" style={{ background: "var(--block-bg)" }}>
          <p className="t-body text-[15px] text-primary">{state.message}</p>
        </div>
      )}

      {state.phase === "done" && <Result result={state.result} />}
    </div>
  );
}

function Result({ result }: { result: VerifyReceiptResult }) {
  const pills: { label: string; ok: boolean; fact: string }[] = [
    { label: "Signature valid", ok: result.signature_valid, fact: `key ${result.key_id}` },
    { label: "Payload intact", ok: result.payload_hash_matches, fact: middleTruncate(result.snapshot_binding.snapshot_hash, 12, 6) },
    { label: "Not expired", ok: result.not_expired, fact: `policy ${result.policy_version}` },
    { label: "Issuer recognized", ok: result.key_status === "active" || result.key_status === "retired", fact: result.issuer.replace(/^https?:\/\//, "") },
  ];
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-2 lg:grid-cols-4" style={{ background: "var(--border)" }}>
        {pills.map((p) => (
          <div key={p.label} className="bg-surface-1 p-4">
            <div className="flex items-center gap-2">
              <span
                className={cn("inline-flex size-6 items-center justify-center rounded-full", p.ok ? "text-release" : "text-block")}
                style={{ background: p.ok ? "var(--release-bg)" : "var(--block-bg)" }}
              >
                {p.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
              </span>
              <span className="t-ui text-primary">{p.label}</span>
            </div>
            <p className="t-evidence mt-2 truncate font-mono text-tertiary" title={p.fact}>{p.fact}</p>
          </div>
        ))}
      </div>

      <dl className="grid gap-x-6 gap-y-2 rounded-md border border-border px-5 py-4 t-evidence sm:grid-cols-2" style={{ background: "var(--surface-1)" }}>
        <Row t="Key ID" v={result.key_id} />
        <Row t="Key status" v={result.key_status} />
        <Row t="Policy version" v={result.policy_version} />
        <Row t="Verified at" v={formatTimestamp(result.verified_at)} />
        <Row t="Snapshot hash" v={middleTruncate(result.snapshot_binding.snapshot_hash, 14, 8)} />
        <Row t="Manifest hash" v={middleTruncate(result.snapshot_binding.manifest_hash, 14, 8)} />
      </dl>

      <div>
        <h2 className="t-h3 text-[18px] text-primary">What this receipt covers</h2>
        <p className="t-body mt-1.5 text-[14px] text-secondary">
          Anyone can verify that this receipt was issued by PreFlight, has not been altered, and applies to the
          identified runtime snapshot and policy version.
        </p>
        <div className="mt-4"><ScopeBlock scope={result.scope} /></div>
      </div>

      <div>
        <h2 className="t-h3 text-[18px] text-primary">Verify it yourself, offline</h2>
        <p className="t-body mt-1.5 text-[14px] text-secondary">Run this to verify without trusting our server.</p>
        <CodeBlock className="mt-3" code={result.how_to_verify_offline} label="offline verify" />
        <a href={`${API_BASE}/api/v1/pubkeys`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 t-ui text-accent hover:text-primary">
          Public signing keys <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}

function Row({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="t-label text-tertiary">{t}</dt>
      <dd className="mt-0.5 break-all font-mono text-secondary">{v}</dd>
    </div>
  );
}
