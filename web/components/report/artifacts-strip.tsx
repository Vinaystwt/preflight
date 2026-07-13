import { FileCheck2, BadgeCheck, Landmark, ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReleaseReport } from "@/lib/contracts";
import { middleTruncate, OKLINK_TX } from "@/lib/format";

/*
  One connected output band below the verdict header: SIGNED RECEIPT, LIVE
  BADGE, SETTLEMENT. Behavior by decision:
    RELEASE → receipt + badge + (settlement if present)
    BLOCK   → receipt, no badge, settlement if present
    UNKNOWN → receipt, no badge
*/
export function ArtifactsStrip({ report }: { report: ReleaseReport }) {
  const receipt = report.receipt ?? null;
  const settlementTx =
    receipt?.payload.settlement_ref && /^0x[a-fA-F0-9]{16,}$/.test(receipt.payload.settlement_ref)
      ? receipt.payload.settlement_ref
      : report.chain_anchor_tx ?? null;
  const badgeAvailable = report.decision === "RELEASE";

  return (
    <div className="grid overflow-hidden rounded-md border border-border sm:grid-cols-3" style={{ background: "var(--surface-1)" }}>
      {/* receipt */}
      <Cell icon={FileCheck2} label="Signed receipt" divide>
        {receipt ? (
          <>
            <Status tone="release" text="Valid" />
            <p className="mt-1 truncate font-mono text-[12px] text-tertiary" title={receipt.receipt_id}>{middleTruncate(receipt.receipt_id, 10, 6)}</p>
            <a href="#receipt" className="mt-2 inline-flex items-center gap-1 t-ui text-accent hover:text-accent-hover">Verify <ArrowRight className="size-3.5" aria-hidden /></a>
          </>
        ) : (
          <p className="mt-1 t-evidence text-tertiary">Not issued for this report.</p>
        )}
      </Cell>

      {/* badge */}
      <Cell icon={BadgeCheck} label="Live badge" divide>
        {badgeAvailable ? (
          <>
            <Status tone="release" text="RELEASE" />
            <p className="mt-1 t-evidence text-tertiary">Embeddable, auto-expires on drift.</p>
            <a href="#badge" className="mt-2 inline-flex items-center gap-1 t-ui text-accent hover:text-accent-hover">Embed <ArrowRight className="size-3.5" aria-hidden /></a>
          </>
        ) : (
          <>
            <Status tone="pending" text="No badge issued" />
            <p className="mt-1 t-evidence text-tertiary">Release did not pass mandatory criteria.</p>
          </>
        )}
      </Cell>

      {/* settlement */}
      <Cell icon={Landmark} label="Settlement">
        {settlementTx ? (
          <>
            <Status tone="release" text="Confirmed" />
            <p className="mt-1 truncate font-mono text-[12px] text-tertiary" title={settlementTx}>{middleTruncate(settlementTx, 8, 4)}</p>
            <a href={OKLINK_TX(settlementTx)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 t-ui text-accent hover:text-accent-hover">OKLink <ExternalLink className="size-3.5" aria-hidden /></a>
          </>
        ) : (
          <p className="mt-1 t-evidence text-tertiary">No settlement recorded.</p>
        )}
      </Cell>
    </div>
  );
}

function Cell({ icon: Icon, label, children, divide }: { icon: typeof FileCheck2; label: string; children: React.ReactNode; divide?: boolean }) {
  return (
    <div className={cn("px-5 py-4", divide && "border-b border-border sm:border-b-0 sm:border-r")}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-tertiary" aria-hidden />
        <span className="t-label text-tertiary">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Status({ tone, text }: { tone: "release" | "pending"; text: string }) {
  return <p className={cn("mt-2 t-ui font-medium", tone === "release" ? "text-release" : "text-pending")}>{text}</p>;
}
