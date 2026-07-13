import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = {
  title: "Docs",
  description: "Quickstart, core concepts, the check criteria, the verify_release API, machine report and CI exit codes, and security.",
};

const SECTIONS = [
  ["quickstart", "Quickstart"],
  ["concepts", "Core concepts"],
  ["criteria", "Check criteria"],
  ["agent-id", "Agent ID import"],
  ["endpoint", "Endpoint checks"],
  ["x402", "x402 and payment"],
  ["settlement", "Settlement verification"],
  ["delivery", "Delivery verification"],
  ["api", "verify_release API"],
  ["machine", "Machine report and CI"],
  ["receipts", "Signed receipts"],
  ["mcp", "MCP server"],
  ["report", "Report schema"],
  ["troubleshooting", "Troubleshooting"],
  ["security", "Security"],
] as const;

const DISCOVER_REQ = `POST https://api.usepreflight.xyz/api/v1/discover
content-type: application/json

{ "endpoint": "https://api.your-service.com/mcp" }`;

const VERIFY_REQ = `POST https://api.usepreflight.xyz/api/v1/verify-release
content-type: application/json

{
  "schema_version": "preflight.verify-release-request.v1",
  "manifest": {
    "schema_version": "preflight.release-manifest.v1",
    "release": { "service_name": "quote-svc", "release_version": "2026.07.1" },
    "target": {
      "endpoint": "https://api.your-service.com/mcp",
      "method": "POST",
      "interface_mode": "X402_HTTP",
      "redirect_policy": "NONE"
    },
    "payment": {
      "mode": "X402",
      "network": "eip155:196",
      "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      "amount_atomic": "100000",
      "pay_to": "0xYOUR_DECLARED_ADDRESS"
    }
  }
}`;

const REPORT_SHAPE = `{
  "schema_version": "preflight.release-report.v1",
  "report_id": "pfr_…",
  "decision": "RELEASE | BLOCK | UNKNOWN",
  "summary": { "matched": 11, "contradictions": 0, "unknown": 0, "not_applicable": 3 },
  "criterion_groups": [
    { "code": "buyer_proof", "label": "Buyer proof", "criteria": [
      { "code": "BUYER_SETTLEMENT", "state": "MATCH", "mandatory": true,
        "expected": true, "observed": { "status": "DELIVERED" },
        "provenance": ["OPERATOR_SUPPLIED","OBSERVED","DERIVED"],
        "comparison_rule": "authorized outbound x402 proof settles to the declared target payTo",
        "evidence_refs": [ { "id": "…", "digest": "sha256:…", "captured_at": "…" } ] }
    ] }
  ],
  "runtime_snapshot": { "snapshot_hash": "sha256:…", "captured_at": "…", "requested_url": "…" },
  "policy_version": "preflight.release-policy.v1",
  "report_expires_at": "…"
}`;

const CI = `$ preflight verify https://api.example.com/mcp
# exit code carries the decision:
#   0  RELEASE
#   1  BLOCK
#   2  UNKNOWN
#   3  infrastructure error (could not run)`;

const RECEIPT_SHAPE = `{
  "receipt_id": "rcpt_…",
  "payload": {
    "type": "preflight.receipt.v1",
    "report_id": "pfr_…",
    "decision": "RELEASE",
    "manifest_hash": "sha256:…",
    "snapshot_hash": "sha256:…",
    "policy_version": "preflight.release-policy.v1",
    "issued_at": "…",
    "key_id": "preflight-v4-production-20260713"
  },
  "signature": "base64…",
  "signature_alg": "Ed25519",
  "key_id": "preflight-v4-production-20260713",
  "verify": {
    "canonicalization": "preflight.canonical-json.v1",
    "payload_hash": "sha256:…",
    "pubkeys_url": "https://api.usepreflight.xyz/api/v1/pubkeys"
  }
}`;

const RECEIPT_VERIFY = `# 1. canonicalize the payload (sorted keys, no whitespace)
# 2. sha256 the canonical bytes  -> must equal verify.payload_hash
# 3. fetch the matching key from verify.pubkeys_url by key_id
# 4. Ed25519 verify(signature, canonical_bytes, public_key)
preflight verify-receipt rcpt_…   # exit 0 when authentic`;

const MCP_TOOL = `// PreFlight exposed as an MCP tool
{
  "name": "verify_release",
  "description": "Prove a live agent service is sellable end to end.",
  "input_schema": {
    "type": "object",
    "properties": { "endpoint": { "type": "string" } },
    "required": ["endpoint"]
  }
}
// returns { decision, report_id, receipt_id, badge_url }`;

export default function DocsPage() {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-12 sm:px-6 md:grid-cols-[210px_1fr]">
      <aside className="md:sticky md:top-20 md:h-fit">
        <p className="t-label mb-3 text-tertiary">Documentation</p>
        <nav aria-label="Docs sections">
          <ul className="flex flex-col gap-0.5 border-l border-border">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-3 t-ui text-secondary transition-colors hover:border-border-strong hover:text-primary">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 max-w-[68ch]">
        <h1 className="t-h1 text-primary">Documentation</h1>
        <p className="t-lead mt-3 text-secondary">Everything to prepare, run, and read a PreFlight check, plus the frozen API and CI integration.</p>

        <Doc id="quickstart" title="Quickstart">
          <P>Discovery is free and needs no account. Point it at a public endpoint:</P>
          <CodeBlock className="my-4" code={DISCOVER_REQ} label="discover" />
          <P>Discovery returns the observed surface and a proposed manifest with per field provenance. Confirm the manifest, then run the paid check from your agent (below). You receive a private report link.</P>
        </Doc>

        <Doc id="concepts" title="Core concepts">
          <List items={[
            ["Release manifest", "What you intend to publish: endpoint, interface, payment terms, request and response contracts."],
            ["Observed surface", "What the live service actually exposes right now."],
            ["Criterion", "One comparison of declared against observed, with a state and evidence."],
            ["Buyer proof", "The steps where PreFlight pays and takes delivery as a real customer."],
            ["Decision", "RELEASE, BLOCK, or UNKNOWN, scoped to a single runtime snapshot."],
          ]} />
        </Doc>

        <Doc id="criteria" title="Check criteria">
          <P>Criteria are grouped: target, interface, payment, contract, and buyer proof. Each carries a stable code (for example PAY-04), a state, the declared and observed values, provenance, the consequence, and the exact fix.</P>
        </Doc>

        <Doc id="agent-id" title="Agent ID import">
          <P>You can pass an OKX.AI Agent ID or a raw endpoint. When an Agent ID is given, PreFlight resolves the listing to its live endpoint and pre fills the manifest fields it can observe, marking each with its source.</P>
        </Doc>

        <Doc id="endpoint" title="Endpoint checks">
          <P>PreFlight confirms the declared endpoint resolves over HTTPS, answers the declared method, and follows only the declared redirect policy. A method or redirect mismatch contradicts the release.</P>
        </Doc>

        <Doc id="x402" title="x402 and payment">
          <P>For a paid service, PreFlight reads the HTTP 402 challenge and checks that its mode, network, asset, amount, and payTo match your declaration. It then authorizes a real x402 payment as a buyer.</P>
        </Doc>

        <Doc id="settlement" title="Settlement verification">
          <P>After authorizing, PreFlight confirms the payment settles on X Layer, rather than trusting a claim. The BUYER_SETTLEMENT criterion carries the settlement evidence.</P>
        </Doc>

        <Doc id="delivery" title="Delivery verification">
          <P>Once paid, PreFlight takes delivery and checks the returned result against your response contract, and confirms a duplicate payment replay is rejected. The BUYER_DELIVERY criterion carries the delivery evidence.</P>
        </Doc>

        <Doc id="api" title="verify_release API">
          <P>The paid check. Your agent posts the confirmed manifest and completes the x402 challenge.</P>
          <CodeBlock className="my-4" code={VERIFY_REQ} label="verify-release request" />
          <P>The response is the report envelope (see Report schema). The private report URL and its access token are returned in <Code>report_access</Code>.</P>
        </Doc>

        <Doc id="machine" title="Machine report and CI">
          <P>A compact machine report is available for CI. The process exit code carries the decision, so a pipeline can gate a release:</P>
          <CodeBlock className="my-4" code={CI} label="ci" />
        </Doc>

        <Doc id="receipts" title="Signed receipts">
          <P>Every check issues an Ed25519 signed receipt. It carries the decision, the manifest and snapshot hashes it judged, the policy version, and the signing key ID. Anyone can verify it against PreFlight&apos;s published keys, offline of the report.</P>
          <CodeBlock className="my-4" code={RECEIPT_SHAPE} label="receipt.v1" />
          <P>Verification is four steps, and the report page runs them in your browser:</P>
          <CodeBlock className="my-4" code={RECEIPT_VERIFY} label="verify" />
          <P>Public keys are served at <Code>/api/v1/pubkeys</Code>, and a receipt envelope by ID at <Code>/api/v1/receipts/&#123;id&#125;</Code>. A RELEASE also issues an embeddable badge; see <Link href="/cli" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">the CLI</Link> to verify from a terminal.</P>
        </Doc>

        <Doc id="mcp" title="MCP server">
          <P>PreFlight ships an MCP wrapper so an agent can run a release check as a tool. The tool takes an endpoint and returns the decision, the report ID, and the receipt ID.</P>
          <CodeBlock className="my-4" code={MCP_TOOL} label="mcp tool" />
          <P>The same 0.10 USDT x402 payment applies. The agent&apos;s wallet pays, and the signed receipt comes back with the result.</P>
        </Doc>

        <Doc id="report" title="Report schema">
          <P>The report envelope, abbreviated:</P>
          <CodeBlock className="my-4" code={REPORT_SHAPE} label="release-report.v1" />
        </Doc>

        <Doc id="troubleshooting" title="Troubleshooting">
          <List items={[
            ["429 on discovery", "Free discovery is rate limited per IP. Wait and retry, or run the full check from your agent."],
            ["Report link does not open", "Reports expire after 30 days and open only with the full capability link, including the part after the #."],
            ["A decision looks wrong", "Open the evidence under the criterion. If the observed value does not match your understanding of production, send the report ID, never the token."],
          ]} />
        </Doc>

        <Doc id="security" title="Security">
          <List items={[
            ["Capability tokens", "Sent in the URL fragment, never to a server, log, or analytics."],
            ["Keys", "PreFlight signs its own buyer payments. Your agent signs yours. No key you hold reaches PreFlight."],
            ["Scope", "Public runtime only, over the declared method. No authentication bypass."],
          ]} />
          <P className="mt-4">See <Link href="/legal/privacy" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">privacy</Link> for retention and storage.</P>
        </Doc>
      </div>
    </div>
  );
}

function Doc({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border py-10 first:border-t-0 first:pt-6">
      <h2 className="t-h2 text-[26px] text-primary">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`t-body text-[15px] leading-[1.65] text-secondary ${className ?? ""}`}>{children}</p>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">{children}</code>;
}
function List({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map(([t, d]) => (
        <div key={t} className="grid gap-x-4 sm:grid-cols-[180px_1fr]">
          <dt className="t-ui text-primary">{t}</dt>
          <dd className="t-body text-[15px] text-secondary">{d}</dd>
        </div>
      ))}
    </dl>
  );
}
