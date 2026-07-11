# Retain, refactor, rewrite, or delete

| Asset | Decision | Evidence-led rationale | Preconditions/target state |
|---|---|---|---|
| Fastify server | Refactor | [VERIFIED-LOCAL] small, legible runtime; [BROKEN] mixed readiness and in-memory controls | Separate route modules, dependency readiness, signals, distributed limits |
| MCP discovery | Retain/refactor | [VERIFIED-LIVE] valid initialize/list/pointers | Mount supported methods only; version output; make pointer naming explicit |
| Paid-route architecture | Refactor | [VERIFIED-LIVE] OKX-compliant route-form challenges | Durable settlement-first state machine and idempotency |
| Seller payments | Refactor | [VERIFIED-LIVE] self-test transfers/challenges; [BROKEN] reconciliation | Durable pending settlement worker, unique payment ID, compensation |
| Buyer payments | Rewrite | [BROKEN] arbitrary payee/ownership, egress gaps | Authenticated ownership, allowlists, bounded hardened transport |
| Transport probe | Refactor | [VERIFIED-LOCAL] useful DNS/rebinding design | Standards-based IP classifier, size/deadline/status semantics |
| MCP probe | Retain/refactor | [VERIFIED-LOCAL] useful negotiation/schema checks | Response limits, more protocol/client compatibility fixtures |
| x402 probe | Retain/refactor | [VERIFIED-LIVE] matches live v2 challenge | SDK-version compatibility, option-selection policy, replay/receipt module |
| Route-vs-MCP detection | Retain | [VERIFIED-LOCAL] prevents route-form false negatives | Keep explicit `mcp_url` semantics and tests |
| Rubric | Rewrite | [BROKEN] empty/N/A can score 100; no published weights | Versioned gates, unknown state, per-tool applicability, confidence |
| Findings | Refactor | [VERIFIED-LOCAL] actionable code/evidence/fix shape | Registry/version, safe evidence, documented severities |
| Report envelope | Retain/refactor | [VERIFIED-LIVE] coherent frontend-friendly core | Add `schema_version`, module states, payment/attestation status, canonical payload link |
| Postgres access | Refactor | [CODE-PRESENT] parameterized and concise | Versioned migrations, transactions, constraints, timeouts, retention |
| Spend reservation | Retain after rewrite | [CODE-PRESENT] advisory lock is atomic | It must enforce authorized policy, not substitute for authorization |
| Monitoring scheduler | Refactor | [CODE-PRESENT] DB `SKIP LOCKED` claiming is sound | Unique active monitor, auth, renewal, alerts, SLO and long-run tests |
| Attestation queue | Refactor or delete | [VERIFIED-LIVE] works; [BROKEN] public verification ambiguous | Keep only with versioned canonical payload, authorized attester, idempotency |
| Solidity contract | Rewrite or delete | [VERIFIED-LIVE] exact minimal bytecode; [BROKEN] anyone can emit, no state | Decide whether event-only attestation has real user value |
| Badge | Rewrite | [VERIFIED-LIVE] false certification | Bind exact certification record/hash/expiry, never latest arbitrary check |
| Health Index | Rewrite/rename | [VERIFIED-LIVE] one self target/manual snapshot | Registry source, sampling methodology, schedule, freshness, thin-state disclaimer |
| Rate limiting | Rewrite | [CODE-PRESENT] per-process maps | Distributed store, authenticated dimensions, bounded keys |
| SSRF layer | Refactor | [PARTIAL] probes hardened, buyer not | One shared egress policy for every network call |
| Error handling | Refactor | [VERIFIED-LIVE] behavior exists but inconsistent | Stable typed error v1 and request correlation |
| Observability | Build | [NOT-IMPLEMENTED] logs only | Metrics/traces/alerts/reconciliation dashboards |
| Railway/Docker | Refactor | [VERIFIED-LIVE] API/TLS work | immutable SHA, readiness, graceful drain, rollback/backup runbook |
| Backend docs | Rewrite | [BROKEN] contradictions and unsupported claims | Generate from frozen contracts/evidence |
| Existing frontend | Delete/rebuild as requested | [BROKEN] DNS, hardcoded truth fallbacks and claims | Use `FRONTEND_API_CONTRACT.md`; explicit unavailable/unknown states |
| Backend tests | Retain/expand | [VERIFIED-LOCAL] 32 pass | Ephemeral Postgres, adversarial HTTPS, settlement faults, multi-instance jobs |
| Hardcoded frontend fallbacks | Delete | [MOCKED] old report/index presented during API failure | Show error/stale state, never fabricated live truth |
| `STATE.md` as authoritative truth | Delete designation, retain archive | [BROKEN] materially contradicted | Replace with generated, dated, evidence-linked status |
| `VERIFICATION_REPORT.md` | Retain archive | [CODE-PRESENT] useful protocol research but stale | Label historical and superseded |

## Sequenced technical decision

1. [BROKEN] Immediately disable `deep_check`, `preflight_certified`, and certification badge output.
2. [BROKEN] Restore public DNS and source/deployment identity.
3. [PARTIAL] Freeze a report/error/service-catalog contract and remove claims that are not contract facts.
4. [BROKEN] Rebuild payment sequencing, authorization, idempotency, egress, and reconciliation.
5. [PARTIAL] Rebuild DB migrations/constraints and observability, then run fault-injection and long-duration monitoring.
6. [PARTIAL] Decide whether attestation and Health Index survive a user-value review; delete them if their operational risk exceeds value.
7. [BLOCKED] Rebuild frontend only against the verified contract.
8. [NOT-IMPLEMENTED] Register/list only after an independent external canary and evidence review.

