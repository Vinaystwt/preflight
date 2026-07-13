import { Cta } from "@/components/cta";
import { CodeBlock } from "@/components/code-block";
import { Terminal, type OutLine } from "@/components/cli/terminal";

const VERIFY_OUT: OutLine[] = [
  { text: "→ discovering  https://api.quote.example/mcp" },
  { text: "✓ reachable · MCP 2025-03-26 · x402 challenge parsed", tone: "secondary" },
  { text: "→ acting as buyer  authorize → broadcast → settled", tone: "secondary" },
  { text: "✓ settlement 0x8E47…C44F confirmed on X Layer", tone: "secondary" },
  { text: "✓ delivery 200 · duplicate replay rejected (409)", tone: "secondary" },
  { text: "" },
  { text: "BLOCK  1 mandatory criterion contradicts live", tone: "block" },
  { text: "  PAY-04  declared payTo 0x71A8…45E2  observed 0x442B…9C07", tone: "primary" },
  { text: "  fix: point the endpoint payTo to your declared address", tone: "secondary" },
  { text: "" },
  { text: "receipt rcpt_df8dc…10cff · Ed25519 · signature valid", tone: "accent" },
  { text: "exit code 1", tone: "block" },
];

const RECEIPT_OUT: OutLine[] = [
  { text: "→ fetching public key  preflight-v4-production-20260713", tone: "secondary" },
  { text: "✓ payload hash matches  sha256:f1afc114…2bde0fc8", tone: "secondary" },
  { text: "✓ Ed25519 signature valid", tone: "release" },
  { text: "✓ manifest intact · snapshot intact · policy recognized", tone: "release" },
  { text: "receipt is authentic", tone: "release" },
];

const GHA = `# .github/workflows/preflight.yml
name: preflight
on: [deployment_status]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: preflight verify \${{ vars.ENDPOINT }}
        # exit 0 RELEASE · 1 BLOCK · 2 UNKNOWN · 3 infrastructure`;

const JSON_OUT = `$ preflight verify <endpoint> --json
{
  "decision": "RELEASE",
  "report_id": "pfr_…",
  "receipt_id": "rcpt_…",
  "receipt_signature": "…",
  "badge_url": "https://api.usepreflight.xyz/api/v1/badge/pfr_….svg",
  "chain_anchor_tx": null
}`;

export default function CliPage() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-16 sm:px-6 lg:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <span className="t-label text-accent">Command line</span>
          <h1 className="t-h1 mt-3 text-primary">Run PreFlight anywhere releases happen.</h1>
          <p className="t-lead mt-4 max-w-xl text-secondary">
            The same check, from your terminal or your pipeline. The exit code carries the decision,
            so a release can gate on it. Every run issues the same signed receipt.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Cta href="#exit-codes">See exit codes</Cta>
            <Cta href="/docs#api" variant="secondary">API reference</Cta>
          </div>
        </div>
        <Terminal command="preflight verify https://api.quote.example/mcp" output={VERIFY_OUT} />
      </div>

      <Section id="install" title="Installation">
        <P>The hosted web, API, and MCP surfaces are live. The CLI package is prepared in the public repository and will use the <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">preflight</code> binary once npm publication is verified.</P>
        <CodeBlock className="mt-3" code={`git clone https://github.com/Vinaystwt/preflight.git
cd preflight
npm run build --prefix packages/cli
node packages/cli/dist/index.js --help`} label="source checkout" />
      </Section>

      <Section id="verify-endpoint" title="Verify an endpoint">
        <P>Point it at a live endpoint. PreFlight discovers, pays as a buyer, and decides.</P>
        <CodeBlock className="mt-3" code={`preflight verify https://api.quote.example/mcp`} label="shell" />
      </Section>

      <Section id="verify-manifest" title="Verify from a manifest">
        <P>The current CLI verifies an endpoint or Agent ID. Manifest-file input is planned for the same release-gate contract, but the hosted API already accepts confirmed manifests.</P>
        <CodeBlock className="mt-3" code={`curl -i https://api.usepreflight.xyz/api/v1/verify-release`} label="paid API endpoint" />
      </Section>

      <Section id="exit-codes" title="Exit codes">
        <P>The process exit code is the contract a pipeline gates on.</P>
        <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-4" style={{ background: "var(--border)" }}>
          {[["0", "RELEASE", "text-release"], ["1", "BLOCK", "text-block"], ["2", "UNKNOWN", "text-warning"], ["3", "INFRASTRUCTURE", "text-tertiary"]].map(([code, label, tone]) => (
            <div key={code} className="bg-surface-1 p-5">
              <p className="font-mono text-3xl font-medium text-primary">{code}</p>
              <p className={`mt-2 t-label ${tone}`}>{label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="verify-receipt" title="Verify a signed receipt">
        <P>Anyone can check a receipt against PreFlight&apos;s published Ed25519 key, offline of the report.</P>
        <div className="mt-3">
          <Terminal command="preflight verify-receipt rcpt_df8dc…10cff" output={RECEIPT_OUT} />
        </div>
      </Section>

      <Section id="gha" title="GitHub Actions">
        <CodeBlock code={GHA} label="yaml" />
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2" style={{ background: "var(--surface-1)" }}>
          <span className="t-ui text-secondary">Result</span>
          <span className="inline-flex items-center gap-1.5 rounded border border-block-border px-2 py-0.5 font-mono text-[12px] text-block" style={{ background: "var(--block-bg)" }}>BLOCK · exit 1</span>
        </div>
      </Section>

      <Section id="other-ci" title="Other CI">
        <P>Any runner works: the command returns the decision as its exit code and machine JSON on stdout.</P>
      </Section>

      <Section id="json" title="JSON output">
        <CodeBlock code={JSON_OUT} label="shell" />
      </Section>

      <Section id="payment" title="Payment behavior">
        <P>A check is 0.10 USDT over x402. Your agent or CI wallet pays. A run that never completes is not charged, and a safe retry does not charge twice.</P>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <P>A non-zero exit with code 3 means PreFlight could not run the check (network, endpoint unreachable). Codes 0 to 2 are real decisions. Use <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-primary">--json</code> for machine parsing.</P>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border py-10">
      <h2 className="t-h2 text-[26px] text-primary">{title}</h2>
      <div className="mt-4 max-w-[70ch]">{children}</div>
    </section>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="t-body text-[15px] leading-[1.65] text-secondary">{children}</p>;
}
