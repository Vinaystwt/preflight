import type { Config } from "../config.js";
import type { CriterionResult, JourneyStepV1, ReceiptScopeV1, VerifyReleaseResponseV1, VerifyReleaseResponseV2 } from "../contracts/release-gate.js";

const short = (value: unknown): string | null => typeof value === "string" ? value : value === null || value === undefined ? null : JSON.stringify(value);
const elapsed = (start: number) => Math.max(0, Date.now() - start);
export const receiptScope = (report: Omit<VerifyReleaseResponseV1, "report_access">): ReceiptScopeV1 => ({
  proves: ["issuer_authenticity", "payload_integrity", "snapshot_binding", "policy_binding"],
  does_not_prove: ["semantic_correctness_of_delivery", "future_behaviour", "security_of_target", "marketplace_endorsement"],
  policy_version: report.policy_version, snapshot_hash: report.runtime_snapshot.snapshot_hash, valid_until: report.report_expires_at
});

function journeyFor(report: Omit<VerifyReleaseResponseV1, "report_access">, start: number, listing?: { agentId?: string; serviceId?: string; name?: string | null }): JourneyStepV1[] {
  const criteria = report.criterion_groups.flatMap((group) => group.criteria);
  const state = (codes: string[]) => criteria.find((criterion) => codes.includes(criterion.code));
  const status = (criterion: CriterionResult | undefined): JourneyStepV1["status"] => criterion?.state === "MATCH" ? "ok" : criterion?.state === "CONTRADICTION" ? "contradiction" : criterion?.state === "NOT_APPLICABLE" ? "not_applicable" : "unknown";
  const endpoint = state(["TARGET_ENDPOINT", "TARGET_METHOD"]); const mcp = state(["INTERFACE_MODE", "MCP_URL"]); const payment = state(["PAYMENT_MODE"]); const reconcile = state(["LST-01", "LST-02", "LST-03", "LST-04", "LST-05"]) ?? criteria.find((criterion) => criterion.state === "CONTRADICTION");
  const buyer = criteria.find((criterion) => criterion.code === "BUYER_DELIVERY");
  const t = elapsed(start);
  return [
    { step: "resolve_listing", status: listing?.agentId ? "ok" : "not_applicable", observed: listing?.agentId ? `Resolved listing for Agent ${listing.agentId}${listing.name ? ` (${listing.name})` : ""}.` : "No marketplace listing was supplied for this check.", t_ms: t },
    { step: "reach_endpoint", status: status(endpoint), observed: endpoint?.state === "MATCH" ? "HTTPS endpoint responded at the declared destination." : endpoint?.consequence ?? "Endpoint reachability could not be established.", t_ms: t },
    { step: "tls_verify", status: endpoint?.state === "MATCH" ? "ok" : endpoint?.state === "CONTRADICTION" ? "failed" : "unknown", observed: endpoint?.state === "MATCH" ? "TLS was verified by guarded HTTPS egress." : "TLS evidence was unavailable with the endpoint observation.", t_ms: t },
    { step: "mcp_handshake", status: status(mcp), observed: mcp?.state === "NOT_APPLICABLE" ? "Route-form service: MCP surface does not apply." : mcp?.state === "MATCH" ? "MCP initialize and tool discovery matched the declaration." : mcp?.limitation ?? "MCP surface could not be established.", t_ms: t },
    { step: "payment_challenge", status: status(payment), observed: payment?.state === "MATCH" ? "Unpaid request exposed the declared payment surface." : payment?.consequence ?? "Payment challenge evidence was unavailable.", t_ms: t },
    { step: "reconcile", status: status(reconcile), observed: reconcile?.state === "MATCH" ? "Declared values matched runtime evidence." : reconcile?.consequence ?? "No listing reconciliation was applicable.", t_ms: t },
    { step: "authorize_payment", status: "ok", observed: "PreFlight payment authorization was verified before the verification run executed.", t_ms: t },
    { step: "settle_payment", status: report.receipt ? "ok" : "unknown", observed: report.receipt ? `Settlement ${report.receipt.payload.settlement_ref} was recorded before report publication.` : "Settlement proof is not available in this report.", t_ms: t },
    { step: "replay_request", status: buyer?.state === "MATCH" ? "ok" : buyer?.state === "NOT_APPLICABLE" ? "skipped" : buyer?.state === "CONTRADICTION" ? "contradiction" : "skipped", observed: buyer?.state === "MATCH" ? "Authorized buyer proof delivered and duplicate replay was rejected." : buyer?.limitation ?? "Buyer proof was not authorized for this run.", t_ms: t },
    { step: "inspect_delivery", status: buyer?.state === "MATCH" ? "ok" : buyer?.state === "CONTRADICTION" ? "contradiction" : "skipped", observed: buyer?.state === "MATCH" ? "Paid delivery was observed." : buyer?.limitation ?? "No paid delivery was inspected.", t_ms: t },
    { step: "seal_receipt", status: report.receipt ? "ok" : "unknown", observed: report.receipt ? `PreFlight Signed Receipt ${report.receipt.receipt_id} binds this policy and runtime snapshot.` : "A signed receipt is not available yet.", t_ms: t }
  ];
}

export function judgeResponse(report: VerifyReleaseResponseV1, token: string, config: Config, startedAt = Date.now(), listing?: { agentId?: string; serviceId?: string; name?: string | null }): VerifyReleaseResponseV2 {
  const detail = report; const criteria = detail.criterion_groups.flatMap((group) => group.criteria); const blocker = criteria.find((criterion) => criterion.state === "CONTRADICTION") ?? null;
  const receipt = detail.receipt; const receiptId = receipt?.receipt_id ?? null;
  return {
    schema_version: "preflight.release-report.v2", decision: detail.decision,
    headline: detail.decision === "RELEASE" ? "The mandatory, applicable checks matched this identified runtime snapshot." : detail.decision === "BLOCK" ? "A mandatory declared value contradicted observed runtime evidence." : "The available evidence could not establish every mandatory applicable check.",
    what_this_means: detail.decision === "RELEASE" ? "A buyer can see which declared release properties matched at this moment; this is not a guarantee of future behaviour." : detail.decision === "BLOCK" ? "A buyer should resolve the listed contradiction before relying on this release." : "A buyer should obtain the missing evidence or correct the release declaration before relying on it.",
    target: { agent_id: listing?.agentId ?? null, service_id: listing?.serviceId ?? null, endpoint: detail.runtime_snapshot.requested_url, listing_name: listing?.name ?? null },
    summary: { matched: detail.summary.matched, blocked: detail.summary.contradictions, unknown: detail.summary.unknown, not_applicable: detail.summary.not_applicable, duration_ms: elapsed(startedAt) },
    primary_blocker: blocker ? { code: blocker.code, declared: short(blocker.expected), observed: short(blocker.observed), consequence: blocker.consequence ?? "Observed runtime evidence contradicts a mandatory declaration.", exact_fix: blocker.remediation ?? "Correct the declaration or release and rerun." } : null,
    buyer_proof: { attempted: criteria.some((criterion) => criterion.group === "buyer_proof" && criterion.mandatory), authorized: criteria.some((criterion) => criterion.group === "buyer_proof" && criterion.mandatory), settlement_ref: receipt?.payload.settlement_ref ?? null, oklink_url: receipt ? `https://www.oklink.com/xlayer/tx/${receipt.payload.settlement_ref}` : null, delivery_observed: criteria.find((criterion) => criterion.code === "BUYER_DELIVERY")?.state === "MATCH" ? true : null },
    receipt: { receipt_id: receiptId, signature: receipt?.signature ?? null, verify_url: receiptId ? `https://${config.PUBLIC_DOMAIN}/api/v1/verify-receipt?receipt_id=${encodeURIComponent(receiptId)}` : null, pubkeys_url: `https://${config.PUBLIC_DOMAIN}/api/v1/pubkeys` },
    report_url: `https://${config.PUBLIC_DOMAIN}/api/v1/reports/${detail.report_id}#token=${encodeURIComponent(token)}`,
    scope: receipt?.payload.scope ?? receiptScope(detail), journey: journeyFor(detail, startedAt, listing), checked_at: detail.generated_at, policy_version: detail.policy_version, docs_url: "https://usepreflight.xyz/docs", detail
  };
}
