"use client";

import { useState } from "react";
import { Search, Loader2, TriangleAlert, CircleCheck, AlertCircle } from "lucide-react";
import { discover } from "@/lib/api/endpoints";
import { ApiError, TransportError } from "@/lib/api/client";
import type { DiscoveryV1, ProposedField, X402Accept } from "@/lib/contracts";
import { CodeBlock } from "@/components/code-block";
import { ProvenanceBadge } from "./provenance-badge";
import { ProbingConsole } from "./probing-console";
import { middleTruncate } from "@/lib/format";
import { cn } from "@/lib/utils";

type State =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "ok"; data: DiscoveryV1 }
  | { k: "rate"; retryAfter?: string }
  | { k: "error"; message: string };

export function CheckWorkspace() {
  const [endpoint, setEndpoint] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ k: "idle" });

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const rawEndpoint = String(new FormData(e.currentTarget).get("endpoint") ?? endpoint).trim();
    let url: URL;
    try {
      url = new URL(rawEndpoint);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      setInputError("Enter a full https:// endpoint URL.");
      return;
    }
    setEndpoint(rawEndpoint);
    setInputError(null);
    setState({ k: "loading" });
    try {
      const data = await discover(url.toString());
      setState({ k: "ok", data });
    } catch (err) {
      if (err instanceof ApiError && err.kind === "rate_limit") setState({ k: "rate" });
      else if (err instanceof ApiError) setState({ k: "error", message: err.message });
      else if (err instanceof TransportError) setState({ k: "error", message: "The discovery service could not be reached. Check the endpoint and try again." });
      else setState({ k: "error", message: "Something went wrong. Try again." });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-12 sm:px-6">
      <span className="t-label text-accent">Run a check</span>
      <h1 className="t-h1 mt-3 text-primary">Discover what your service actually does.</h1>
      <p className="t-lead mt-4 max-w-2xl text-secondary">
        Point PreFlight at a public endpoint or Agent ID. Discovery is free: it observes the live
        transport, MCP contract, and x402 challenge, then proposes a release manifest for you to
        confirm. The full paid check runs from your agent.
      </p>

      <form onSubmit={run} className="panel mt-8 rounded-md p-4">
        <label htmlFor="endpoint" className="t-label text-tertiary">Endpoint or Agent ID</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="endpoint"
            name="endpoint"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.your-service.com/mcp"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            aria-invalid={inputError ? true : undefined}
            className="h-11 min-w-0 flex-1 rounded-md border border-border bg-base px-3 font-mono text-[13px] text-primary placeholder:text-tertiary focus:border-accent-focus focus:outline-none"
            style={{ background: "var(--base)" }}
          />
          <button
            type="submit"
            disabled={state.k === "loading"}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 t-ui font-medium text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {state.k === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            {state.k === "loading" ? "Discovering" : "Discover"}
          </button>
        </div>
        {inputError && <p role="alert" className="mt-2 t-ui text-block">{inputError}</p>}
        <p className="mt-2 t-ui text-tertiary">Free. Rate limited per IP. No payment and no signing happen here.</p>
      </form>

      <div aria-live="polite" className="mt-6">
        {state.k === "loading" && <ProbingConsole status="running" />}
        {state.k === "rate" && (
          <Panel tone="warning" Icon={TriangleAlert} title="Discovery rate limit reached">
            You have run several free discoveries recently. Wait a little and try again, or run the
            full check from your agent, which is not rate limited.
          </Panel>
        )}
        {state.k === "error" && (
          <>
            <ProbingConsole status="error" />
            <div className="mt-4">
              <Panel tone="block" Icon={AlertCircle} title="Discovery did not complete">
                {state.message}
              </Panel>
            </div>
          </>
        )}
        {state.k === "ok" && (
          <>
            <ProbingConsole status="done" />
            <div className="mt-8">
              <Discovered data={state.data} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Discovered({ data }: { data: DiscoveryV1 }) {
  const x402 = data.observed_surface?.x402;
  const accepts: X402Accept[] = x402?.accepts ?? [];
  const fields = data.proposed_manifest?.fields ?? {};
  const manifestJson = JSON.stringify(data.proposed_manifest?.manifest ?? {}, null, 2);
  const agentPrompt = [
    "Verify this release with PreFlight before I publish it.",
    "POST the manifest below to https://api.usepreflight.xyz/api/v1/verify-release.",
    "Pay the x402 challenge (0.10 USDT on X Layer) with my agent wallet.",
    "Act as a real buyer: authorize, settle, and take delivery, then return the private report link.",
    "",
    manifestJson,
  ].join("\n");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 text-release" aria-hidden />
        <p className="t-ui text-secondary">Discovered <span className="font-mono text-primary">{data.endpoint}</span></p>
      </div>

      {/* observed surface */}
      <section>
        <h2 className="t-h3 mb-3 text-[17px] text-primary">Observed live surface</h2>
        <div className="panel overflow-hidden rounded-md">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="t-label text-tertiary">x402 challenge</span>
            <span className="t-evidence text-secondary">HTTP {x402?.status ?? "—"}</span>
          </div>
          {x402?.parse_error ? (
            <p className="px-4 py-3 t-evidence text-block">{x402.parse_error}</p>
          ) : accepts.length === 0 ? (
            <p className="px-4 py-3 t-evidence text-tertiary">No x402 accepts observed.</p>
          ) : (
            <ul className="divide-y divide-sep">
              {accepts.map((a, i) => (
                <li key={i} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-2">
                  <SurfaceRow label="Amount" value={`${a.amount} ${a.asset ? middleTruncate(a.asset, 6, 4) : ""}`} />
                  <SurfaceRow label="Network" value={a.network} />
                  <SurfaceRow label="Pay to" value={a.payTo} mono />
                  <SurfaceRow label="Scheme" value={a.scheme} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* proposed manifest with provenance */}
      <section>
        <h2 className="t-h3 mb-1 text-[17px] text-primary">Proposed manifest</h2>
        <p className="t-ui mb-3 text-tertiary">Each value is labelled with where it came from. Values marked to confirm are your call before the paid check.</p>
        <div className="panel overflow-hidden rounded-md">
          <ul className="divide-y divide-sep">
            {Object.entries(fields).map(([path, f]) => (
              <FieldRow key={path} path={path} field={f} />
            ))}
            {Object.keys(fields).length === 0 && <li className="px-4 py-3 t-evidence text-tertiary">No fields proposed.</li>}
          </ul>
        </div>
      </section>

      {/* handoff */}
      <section>
        <h2 className="t-h3 mb-1 text-[17px] text-primary">Run the full check from your agent</h2>
        <p className="t-ui mb-3 text-tertiary">The paid check runs from your agent over x402. Paste this prompt with the manifest.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock code={agentPrompt} label="agent prompt + manifest" />
          <div className="panel rounded-md p-5">
            <h3 className="t-h3 text-[15px] text-primary">Payment disclosure</h3>
            <dl className="mt-3 flex flex-col gap-2.5 t-body text-[14px]">
              <Disc t="PreFlight fee" v="0.10 USDT per check, paid over x402" />
              <Disc t="Network and asset" v="USDT0 on X Layer" />
              <Disc t="Live buyer target spend" v="If your service charges, PreFlight pays it as a real buyer. A self testing operator receives their own target payment back." />
              <Disc t="Signing" v="Your agent signs. No private key reaches PreFlight." />
            </dl>
          </div>
        </div>
      </section>

      {/* mcp */}
      <section>
        <h2 className="t-h3 mb-1 text-[17px] text-primary">Or give your agent the tool directly</h2>
        <p className="t-ui mb-3 text-tertiary">Add PreFlight as an MCP server so the agent can call <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">verify_release</code> itself.</p>
        <CodeBlock code={MCP_CONFIG} label="mcp config" />
      </section>
    </div>
  );
}

const MCP_CONFIG = `{
  "mcpServers": {
    "preflight": {
      "url": "https://api.usepreflight.xyz/mcp"
    }
  }
}`;

function SurfaceRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="t-label w-16 shrink-0 text-tertiary">{label}</span>
      <span className={cn("min-w-0 break-words t-evidence text-secondary", mono && "font-mono")} title={value}>
        {mono ? middleTruncate(value, 10, 6) : value}
      </span>
    </div>
  );
}

function FieldRow({ path, field }: { path: string; field: ProposedField }) {
  const value = typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value ?? "");
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3">
      <div className="min-w-0">
        <span className="t-evidence text-tertiary">{path}</span>
        <p className="t-evidence break-words text-primary">{value}</p>
      </div>
      <div className="flex items-center gap-2">
        {field.requires_confirmation && <span className="t-label text-warning">Confirm</span>}
        <ProvenanceBadge source={field.source} />
      </div>
    </li>
  );
}

function Disc({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="t-label text-tertiary">{t}</dt>
      <dd className="mt-0.5 text-secondary">{v}</dd>
    </div>
  );
}

function Panel({ tone, Icon, title, children }: { tone: "warning" | "block"; Icon: typeof TriangleAlert; title: string; children: React.ReactNode }) {
  const bg = tone === "warning" ? "var(--warning-bg)" : "var(--block-bg)";
  const border = tone === "warning" ? "var(--warning-border)" : "var(--block-border)";
  const text = tone === "warning" ? "text-warning" : "text-block";
  return (
    <div className="rounded-md border p-5" style={{ background: bg, borderColor: border }}>
      <div className={cn("flex items-center gap-2", text)}>
        <Icon className="size-4" aria-hidden />
        <p className="t-h3 text-[15px]">{title}</p>
      </div>
      <p className="mt-2 t-body text-[14px] text-secondary">{children}</p>
    </div>
  );
}
