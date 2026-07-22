import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = {
  title: "Docs",
  description: "Quickstart, core concepts, the check criteria, the verify_release API, machine report and CI exit codes, and security.",
};

const SECTIONS = [
  ["quickstart", "Quickstart"],
  ["prerequisites", "Prerequisites"],
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
  ["verify-receipt", "Public receipt verifier"],
  ["mcp", "MCP server"],
  ["report", "Report schema"],
  ["cohort", "Cohort endpoint"],
  ["asp", "Per-ASP endpoint"],
  ["passport", "Passport endpoint"],
  ["benchmark", "Benchmark endpoint"],
  ["self-check", "Self-check endpoint"],
  ["badge", "Public badge embed"],
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

const VERIFY_RECEIPT_REQ = `POST https://api.usepreflight.xyz/api/v1/verify-receipt
content-type: application/json

{ "receipt_id": "rcpt_..." }

// or GET https://api.usepreflight.xyz/api/v1/verify-receipt?receipt_id=rcpt_...

// response
{
  "signature_valid": true,
  "issuer": "https://api.usepreflight.xyz",
  "key_id": "preflight-v4-production-20260713",
  "key_status": "active",
  "payload_hash_matches": true,
  "not_expired": true,
  "snapshot_binding": { "manifest_hash": "sha256:...", "snapshot_hash": "sha256:..." },
  "policy_version": "preflight.release-policy.v1",
  "scope": {
    "proves": ["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"],
    "does_not_prove": ["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"],
    "policy_version": "preflight.release-policy.v1",
    "snapshot_hash": "sha256:...",
    "valid_until": "..."
  },
  "verified_at": "...",
  "how_to_verify_offline": "node --input-type=module -e '...' "
}`;

const COHORT_SHAPE = `GET https://api.usepreflight.xyz/api/v1/cohort

{
  "schema_version": "preflight.cohort.v1",
  "generated_at": "...",
  "policy_version": "preflight.release-policy.v1",
  "totals": {
    "listed_asps": 25,
    "with_runtime_evidence": 14,
    "conforming": 0,
    "with_contradictions": 13,
    "unknown": 12,
    "unreachable": 11
  },
  "conforming": [
    { "agent_id": "...", "name": "...", "last_checked": "...", "permalink": "/asp/..." }
  ],
  "contradiction_summary": [
    { "criterion_code": "LST-04", "count": 13, "plain": "Listing service type differs from the observed surface form" }
  ],
  "drift_events_24h": 2
}`;

const ASP_SHAPE = `GET https://api.usepreflight.xyz/api/v1/asp/{agent_id}

// non-conforming (evidence exists)
{
  "schema_version": "preflight.asp.v1",
  "agent_id": "2013",
  "runtime_evidence": "available",
  "last_checked": "...",
  "criterion_codes": ["LST-01", "LST-04"],
  "owner_claim_cta": "Are you the owner? Authorize a full check..."
}

// conforming
{
  "schema_version": "preflight.asp.v1",
  "agent_id": "...",
  "runtime_evidence": "conforming",
  "name": "...",
  "category_code": "...",
  "last_checked": "...",
  "detail": { ...declared vs observed evidence... },
  "latest_receipt_id": "rcpt_..."
}

// never scanned
{ "schema_version": "preflight.asp.v1", "agent_id": "...", "runtime_evidence": "none" }`;

const PASSPORT_SHAPE = `GET https://api.usepreflight.xyz/api/v1/passport/{agent_id}

// empty state (normal)
{ "schema_version": "preflight.passport.v1", "state": "none",
  "message": "No owner-authorized passport has been issued." }

// active
{ "schema_version": "preflight.passport.v1", "state": "active",
  "agent_id": "...", "decision": "RELEASE",
  "receipt_id": "rcpt_...", "policy_version": "preflight.release-policy.v1",
  "valid_until": "...", "issued_at": "..." }`;

const BENCHMARK_SHAPE = `GET https://api.usepreflight.xyz/api/v1/benchmark

{
  "schema_version": "preflight.benchmark.v1",
  "policy_version": "preflight.release-policy.v1",
  "generated_at": "...",
  "total_fixtures": 5,
  "passing": 4,
  "cases": [
    {
      "case_id": "wrong_amount",
      "seeded_fault": "x402 amount differs from manifest",
      "expected_decision": "BLOCK",
      "expected_codes": ["PAYMENT_AMOUNT"],
      "actual_decision": "BLOCK",
      "actual_codes": ["PAYMENT_AMOUNT"],
      "passes": true
    }
  ]
}`;

const SELF_CHECK_SHAPE = `GET https://api.usepreflight.xyz/api/v1/self-check

{
  "schema_version": "preflight.self-check.v1",
  "report_id": "pfr_...",
  "receipt_id": "rcpt_...",
  "decision": "RELEASE",
  "settlement_ref": "0x...",
  "label": "SELF_CHECK_PRODUCTION",
  "customer_demand": false,
  "published_at": "...",
  "evidence": { "journey": [ { "step": "reach_endpoint", "status": "ok", "observed": "...", "t_ms": 1 } ] }
}`;

const BADGE_EMBED = `<!-- 88x28 SVG, no capability token required -->
<img src="https://api.usepreflight.xyz/api/v1/badge/{agent_id}.svg"
     width="88" height="28" alt="PreFlight passport" />

<!-- markdown -->
![PreFlight passport](https://api.usepreflight.xyz/api/v1/badge/{agent_id}.svg)`;

export default function DocsPage() {
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-12 sm:px-6 md:grid-cols-[minmax(0,210px)_minmax(0,1fr)]">
      <aside className="min-w-0 md:sticky md:top-20 md:max-h-[calc(100vh-5rem)] md:overflow-y-auto">
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

      <div className="min-w-0 w-full max-w-[68ch]">
        <h1 className="t-h1 text-primary">Documentation</h1>
        <p className="t-lead mt-3 text-secondary">Everything to prepare, run, and read a PreFlight check, plus the frozen API and CI integration.</p>

        <Doc id="quickstart" title="Quickstart">
          <P>Discovery is free and needs no account. Point it at a public endpoint:</P>
          <CodeBlock className="my-4" code={DISCOVER_REQ} label="discover" />
          <P>Discovery returns the observed surface and a proposed manifest with per field provenance. Confirm the manifest, then run the paid check from your agent (below). You receive a private report link.</P>
        </Doc>

        <Doc id="prerequisites" title="Prerequisites">
          <P className="mb-4">What you need before running a full, paid check.</P>
          <List items={[
            ["Network and asset", "X Layer (eip155:196), USDT0 at 0x779ded0c9e1022225f8e0630b35a9b54be713736. All amounts are in this asset."],
            ["Wallet funding", "Your agent's wallet needs 0.10 USDT on X Layer to pay the check fee over x402. This fee is separate from any target spend below."],
            ["Client flow", "Run the check from your agent (verify_release API), the CLI, or an MCP-connected agent. Free discovery works from a browser; the paid check requires a wallet, so it does not run from the website."],
            ["Owner attestation", "To have PreFlight act as a real buyer against your target (settlement and delivery proof), set authorize_buyer_proof and owner_attestation to true in the request. Without both, buyer-proof does not run and settlement and delivery are reported UNKNOWN."],
            ["Target spend cap", "When buyer-proof is authorized, PreFlight's own buyer wallet pays your target. Spend is capped at 2 USDT per target and 10 USDT globally per day, isolated from the 0.10 USDT service fee."],
            ["Retry and failure", "A check that never runs is not charged. If settlement does not confirm, retry with the same idempotency key rather than a new request."],
          ]} />
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

        <Doc id="receipts" title="PreFlight Signed Receipt v1">
          <P>Every completed full verification issues a PreFlight Signed Receipt v1 (Ed25519). Free discovery does not issue a receipt. A receipt carries the decision, the manifest and snapshot hashes it judged, the policy version, and the signing key ID. Anyone can verify that this receipt was issued by PreFlight, has not been altered, and applies to the identified runtime snapshot and policy version, offline of the report.</P>
          <CodeBlock className="my-4" code={RECEIPT_SHAPE} label="receipt.v1" />
          <P>Verification is four steps, and the report page runs them in your browser:</P>
          <CodeBlock className="my-4" code={RECEIPT_VERIFY} label="verify" />
          <P>Public keys are served at <Code>/api/v1/pubkeys</Code>, and a receipt envelope by ID at <Code>/api/v1/receipts/&#123;id&#125;</Code>. A RELEASE also issues an embeddable badge; see <Link href="/cli" className="text-accent underline underline-offset-2 decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:decoration-accent">the CLI</Link> to verify from a terminal.</P>
        </Doc>

        <Doc id="verify-receipt" title="Public receipt verifier">
          <P>The public verifier lets anyone confirm a receipt without an account or a capability token. Point a browser at <Link href="/verify" className="text-accent underline underline-offset-2 hover:text-primary">/verify</Link>, or call the API directly:</P>
          <CodeBlock className="my-4" code={VERIFY_RECEIPT_REQ} label="verify-receipt" />
          <P>The response reports signature validity, whether the payload has been altered, expiration, and the scope: what a receipt proves and, deliberately, what it does not.</P>
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

        <Doc id="cohort" title="Cohort endpoint">
          <P>Aggregate runtime evidence across every listed OKX.AI ASP, gathered by free discovery. <Code>conforming</Code> may name each service; <Code>contradiction_summary</Code> is criterion codes and counts only. A named ASP will never appear in the contradictions section.</P>
          <CodeBlock className="my-4" code={COHORT_SHAPE} label="cohort.v1" />
          <P>Rendered at <Link href="/cohort" className="text-accent underline underline-offset-2 hover:text-primary">/cohort</Link>.</P>
        </Doc>

        <Doc id="asp" title="Per-ASP endpoint">
          <P><Code>GET /api/v1/asp/&#123;agent_id&#125;</Code> returns the runtime evidence state for one listed service. A conforming service exposes its declared/observed detail. A non-conforming service exposes only the criterion codes that surfaced at the last scan and an owner-claim CTA. No names are shamed.</P>
          <CodeBlock className="my-4" code={ASP_SHAPE} label="asp.v1" />
          <P>Permalinks live at <Link href="/asp/2013" className="text-accent underline underline-offset-2 hover:text-primary">/asp/&#123;agent_id&#125;</Link>.</P>
        </Doc>

        <Doc id="passport" title="Passport endpoint">
          <P><Code>GET /api/v1/passport/&#123;agent_id&#125;</Code> returns an owner-authorized, scoped passport when one exists, or an honest empty state. A passport carries the latest receipt, the policy version, and the expiry.</P>
          <CodeBlock className="my-4" code={PASSPORT_SHAPE} label="passport.v1" />
        </Doc>

        <Doc id="benchmark" title="Benchmark endpoint">
          <P>The adversarial corpus: seeded faults with expected decisions, run against the current policy. Every fixture appears with its expected and actual result. Failing fixtures render as failing. A benchmark that only shows green is not evidence.</P>
          <CodeBlock className="my-4" code={BENCHMARK_SHAPE} label="benchmark.v1" />
          <P>Rendered at <Link href="/benchmark" className="text-accent underline underline-offset-2 hover:text-primary">/benchmark</Link>.</P>
        </Doc>

        <Doc id="self-check" title="Self-check endpoint">
          <P>The last operator-funded PreFlight self-verification. It is dogfooding evidence, not demand evidence, and the API returns <Code>customer_demand:false</Code> on purpose.</P>
          <CodeBlock className="my-4" code={SELF_CHECK_SHAPE} label="self-check.v1" />
        </Doc>

        <Doc id="badge" title="Public badge embed">
          <P><Code>GET /api/v1/badge/&#123;agent_id&#125;.svg</Code> serves an 88×28 SVG badge for services whose owner has authorized a passport. No capability token is required. A missing passport returns <Code>404</Code>; an expired or revoked one returns a <Code>STALE</Code> badge.</P>
          <CodeBlock className="my-4" code={BADGE_EMBED} label="badge.svg" />
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
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-primary break-all">{children}</code>;
}
function List({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-3">
      {items.map(([t, d]) => (
        <div key={t} className="grid gap-x-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <dt className="min-w-0 t-ui text-primary">{t}</dt>
          <dd className="min-w-0 break-words t-body text-[15px] text-secondary">{d}</dd>
        </div>
      ))}
    </dl>
  );
}
