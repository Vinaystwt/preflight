# PreFlight v5 frontend contract

All public fields below are additive. Existing private capability-report and machine-report v1.1 consumers remain supported.

## Judge response: `POST /api/v1/verify-release`

After x402 settlement, the endpoint returns `preflight.release-report.v2`. The first-level fields are intentionally human-readable:

```ts
type ReleaseReportV2 = {
  schema_version: "preflight.release-report.v2";
  decision: "RELEASE" | "BLOCK" | "UNKNOWN";
  headline: string;
  what_this_means: string;
  target: { agent_id: string | null; service_id: string | null; endpoint: string; listing_name: string | null };
  summary: { matched: number; blocked: number; unknown: number; not_applicable: number; duration_ms: number };
  primary_blocker: { code: string; declared: string | null; observed: string | null; consequence: string; exact_fix: string } | null;
  buyer_proof: { attempted: boolean; authorized: boolean; settlement_ref: string | null; oklink_url: string | null; delivery_observed: boolean | null };
  receipt: { receipt_id: string | null; signature: string | null; verify_url: string | null; pubkeys_url: string };
  report_url: string; // capability token is in URL fragment
  scope: ReceiptScope;
  journey: JourneyStep[];
  checked_at: string;
  policy_version: string;
  docs_url: string;
  detail: ReleaseReportV1; // unchanged existing report shape
};
```

`JourneyStep.step` is one of: `resolve_listing`, `reach_endpoint`, `tls_verify`, `mcp_handshake`, `payment_challenge`, `reconcile`, `authorize_payment`, `settle_payment`, `replay_request`, `inspect_delivery`, `seal_receipt`.

`JourneyStep.status` is one of: `ok`, `contradiction`, `unknown`, `not_applicable`, `skipped`, `failed`.

Render the timeline in order; `observed` is evidence narration, not marketing copy. Never derive a score.

## Receipt scope and public verifier

`POST /api/v1/verify-receipt` accepts `{receipt_id}` or `{payload,signature,key_id}`. `GET /api/v1/verify-receipt?receipt_id=...` is the public click-through form. Neither requires a capability token.

```ts
type ReceiptScope = {
  proves: ("issuer_authenticity" | "payload_integrity" | "snapshot_binding" | "policy_binding")[];
  does_not_prove: ("semantic_correctness_of_delivery" | "future_behaviour" | "security_of_target" | "marketplace_endorsement")[];
  policy_version: string;
  snapshot_hash: `sha256:${string}`;
  valid_until: string;
};
```

The UI must preserve this distinction: signature verification says PreFlight issued an unaltered payload for a stated snapshot and policy. It does not endorse the target or establish semantic correctness.

## Agent and cohort discovery

- `POST /api/v1/resolve` body `{agent_id}` — free, 10/IP/hour; each field is `{value,source,confidence}`.
- `GET /api/v1/cohort` — public aggregate. Only entries in `conforming` may be named. Never attempt to identify an ASP from `contradiction_summary`.
- `GET /api/v1/asp/{agent_id}` — a conforming agent receives declared/observed detail. A non-conforming agent receives only an evidence-exists state, timestamp, criterion codes, and owner-claim CTA.
- `GET /api/v1/passport/{agent_id}` — public, empty state is normal. A passport is only owner-authorized and is scoped to its receipt/policy/expiry.
- `GET /api/v1/badge/{agent_id}.svg` — public 88×28 passport badge. `404` means no passport; `STALE` means revoked or expired.

## Benchmark and self-check

- `GET /api/v1/benchmark` shows the latest persisted adversarial-test result. Treat `state:not_generated` as an honest unavailable state.
- `GET /api/v1/self-check` is public only when an operator-funded self-check exists. Render `customer_demand:false` as supplied; it is dogfooding evidence, not demand evidence.

## Existing contracts

The frozen schemas remain at:

- `/api/v1/contracts/release-manifest/v1`
- `/api/v1/contracts/discovery/v1`
- `/api/v1/contracts/run-events/v1`
- `/api/v1/contracts/machine-report/v1`

`preflight.machine-report.v1.1` remains unchanged.
