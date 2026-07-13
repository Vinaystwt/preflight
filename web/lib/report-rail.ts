import type { Criterion, ReleaseReport } from "@/lib/contracts";
import type { RailNode, RailState } from "@/components/execution-rail";

/*
  Derive the execution rail from a completed report's criterion groups (these
  reports carry no live run_status). Each rail node maps to the criteria that
  prove it; a node blocks if any of its criteria contradict, is unknown if any
  are unknown, otherwise verified.
*/
function worst(criteria: Criterion[]): RailState {
  if (criteria.length === 0) return "na";
  if (criteria.some((c) => c.state === "CONTRADICTION")) return "block";
  if (criteria.some((c) => c.state === "UNKNOWN")) return "unknown";
  if (criteria.every((c) => c.state === "NOT_APPLICABLE")) return "na";
  return "match";
}

export function deriveRail(report: ReleaseReport): RailNode[] {
  const all = report.criterion_groups.flatMap((g) => g.criteria);
  const inGroup = (code: string) => all.filter((c) => c.group === code);
  const byCode = (codes: string[]) => all.filter((c) => codes.includes(c.code));

  const verdictState: RailState =
    report.decision === "RELEASE" ? "match" : report.decision === "BLOCK" ? "block" : "unknown";

  return [
    { key: "LISTING", label: "LISTING", state: worst(byCode(["TARGET_ENDPOINT"])) },
    { key: "DISCOVERY", label: "DISCOVERY", state: worst(inGroup("interface")) },
    { key: "REQUEST", label: "REQUEST", state: worst(byCode(["TARGET_METHOD", "REDIRECT_POLICY"])) },
    { key: "402", label: "402", state: worst(byCode(["PAYMENT_MODE", "PAYMENT_NETWORK", "PAYMENT_ASSET", "PAYMENT_AMOUNT", "PAYMENT_PAY_TO"])) },
    { key: "PAYMENT", label: "PAYMENT", state: worst(byCode(["BUYER_SETTLEMENT"])) },
    { key: "SETTLEMENT", label: "SETTLEMENT", state: worst(byCode(["BUYER_SETTLEMENT"])) },
    { key: "DELIVERY", label: "DELIVERY", state: worst(byCode(["BUYER_DELIVERY", "CONTRACT_RESPONSE", "RESPONSE_SCHEMA"])) },
    { key: "VERDICT", label: "VERDICT", state: verdictState },
  ];
}
