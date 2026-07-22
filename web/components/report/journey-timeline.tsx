import { Check, X, CircleHelp, Minus, SkipForward, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/reveal";
import type { JourneyStep, JourneyStepName, JourneyStepStatus } from "@/lib/contracts-v5";

/* Human-readable step labels. The raw enum is never shown. */
const LABEL: Record<JourneyStepName, string> = {
  resolve_listing: "Resolve listing",
  reach_endpoint: "Reach endpoint",
  tls_verify: "Verify TLS",
  mcp_handshake: "MCP handshake",
  payment_challenge: "Read payment challenge",
  reconcile: "Reconcile declared against observed",
  authorize_payment: "Authorize payment",
  settle_payment: "Settle payment",
  replay_request: "Test replay rejection",
  inspect_delivery: "Inspect delivery",
  seal_receipt: "Seal receipt",
};

const STATUS: Record<JourneyStepStatus, { Icon: typeof Check; tone: string; border: string }> = {
  ok: { Icon: Check, tone: "text-release", border: "var(--release-border)" },
  contradiction: { Icon: X, tone: "text-block", border: "var(--block-border)" },
  unknown: { Icon: CircleHelp, tone: "text-warning", border: "var(--warning-border)" },
  not_applicable: { Icon: Minus, tone: "text-tertiary", border: "var(--sep)" },
  skipped: { Icon: SkipForward, tone: "text-tertiary", border: "var(--sep)" },
  failed: { Icon: AlertTriangle, tone: "text-block", border: "var(--block-border)" },
};

/*
  Replay of a sealed report's buyer journey. This is history, not live probing:
  every row renders in one pass with a small staggered fade (capped so the whole
  set settles fast). No fake sequential resolution.
*/
export function JourneyTimeline({ steps }: { steps: JourneyStep[] }) {
  return (
    <section aria-label="Buyer journey">
      <h2 className="t-h3 text-[18px] text-primary">Buyer journey</h2>
      <p className="t-evidence mt-1 text-tertiary">What PreFlight observed, in order, as it acted as a buyer. Replay of sealed events.</p>
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => {
          const meta = STATUS[s.status] ?? STATUS.not_applicable;
          const Icon = meta.Icon;
          const muted = s.status === "not_applicable" || s.status === "skipped";
          return (
            <Reveal as="li" key={`${s.step}-${i}`} delay={Math.min(i * 60, 200)} className="relative flex gap-4 pb-4 last:pb-0">
              {/* connector */}
              {i < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px" style={{ background: "var(--sep)" }} aria-hidden />}
              <span className={cn("relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full border", meta.tone)} style={{ background: "var(--surface-1)", borderColor: meta.border }}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className={cn("min-w-0 flex-1 rounded-md border px-4 py-2.5", muted && "opacity-70")} style={{ background: "var(--surface-1)", borderColor: "var(--border)", borderLeftWidth: s.status === "contradiction" ? 3 : 1, borderLeftColor: s.status === "contradiction" ? "var(--block-fg)" : s.status === "unknown" ? "var(--warning-fg)" : undefined }}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-ui text-primary">{LABEL[s.step] ?? s.step}</span>
                  <span className="t-evidence shrink-0 font-mono tabular-nums text-tertiary">{s.t_ms} ms</span>
                </div>
                <p className="t-evidence mt-1 font-mono text-secondary">{s.observed}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}
