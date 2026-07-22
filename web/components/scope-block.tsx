import { Check, Ban } from "lucide-react";
import type { ReceiptScope, ScopeProof, ScopeNonProof } from "@/lib/contracts-v5";

/* Human-readable scope copy. Wording follows the locked trust rules:
   verification establishes issuance, integrity, and binding to a snapshot and
   policy. It never endorses the target or claims semantic correctness. */
const PROVES: Record<ScopeProof, string> = {
  issuer_authenticity: "PreFlight issued this receipt",
  payload_integrity: "The receipt has not been altered",
  snapshot_binding: "It applies to the identified runtime snapshot",
  policy_binding: "It applies to the stated policy version",
};
const NOT_PROVES: Record<ScopeNonProof, string> = {
  semantic_correctness_of_delivery: "That the delivered result is semantically correct",
  future_behaviour: "How the service will behave in the future",
  security_of_target: "The security of the target service",
  marketplace_endorsement: "Any marketplace listing or endorsement",
};

export function ScopeBlock({ scope }: { scope: ReceiptScope }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-border sm:grid-cols-2" style={{ background: "var(--border)" }}>
      <div className="bg-surface-1 p-5">
        <h3 className="t-label text-release">This receipt proves</h3>
        <ul className="mt-3 flex flex-col gap-2.5">
          {scope.proves.map((p) => (
            <li key={p} className="flex items-start gap-2.5 t-body text-[14px] text-secondary">
              <Check className="mt-0.5 size-4 shrink-0 text-release" aria-hidden />
              {PROVES[p] ?? p}
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-surface-1 p-5">
        <h3 className="t-label text-warning">This receipt does not prove</h3>
        <ul className="mt-3 flex flex-col gap-2.5">
          {scope.does_not_prove.map((p) => (
            <li key={p} className="flex items-start gap-2.5 t-body text-[14px] text-secondary">
              <Ban className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {NOT_PROVES[p] ?? p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
