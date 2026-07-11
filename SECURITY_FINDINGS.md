# Security findings

## P0 blockers

### PF-SEC-001: unauthenticated arbitrary outbound spending

- Status: [BROKEN]
- Location: `src/services/tools.ts:9,82-151`; `src/db/client.ts:105-124`
- Evidence: `owner_attestation` is merely the literal boolean `true`. The target's x402 challenge supplies the amount and `payTo`; no identity, ownership signature, allowlist, per-call ceiling, incoming/outgoing value ratio, or recipient policy is enforced.
- Impact: a caller can pay 0.50 USDT to invoke `deep_check`, operate an x402 target paying the caller, and induce PreFlight to transfer up to the configured 2 USDT/target and 10 USDT/global rolling-day defaults. `preflight_certified` has the same buyer path.
- Existing mitigation: [CODE-PRESENT] persisted advisory-locked caps bound daily loss.
- Required remediation: disable both routes; require cryptographic target ownership, immutable allowlisted payee/asset/network, low per-call ceiling, quote binding, and settlement-before-outbound sequencing.

### PF-SEC-002: public report origin is unavailable

- Status: [BROKEN]
- Location: `src/engine/report.ts:10`; frontend/domain configuration
- Evidence: [VERIFIED-LIVE] `dig` returned no A/AAAA/CNAME for `usepreflight.xyz` or `www.usepreflight.xyz`; curl failed DNS.
- Impact: every API report envelope directs users to a dead URL. Marketplace reviewers and customers cannot consume delivery.
- Required remediation: restore DNS/TLS, then monitor it externally.

## P1 major findings

### PF-SEC-003: incoming settlement is not atomic with effects

- Status: [BROKEN]
- Evidence: the Fastify adapter verifies before handler and calls settlement in `onSend` after successful handler execution. PreFlight writes reports/jobs, badge/monitor state, and can pay outbound during the handler.
- Impact: a settlement error can leave durable unpaid effects; an outbound payment cannot be rolled back.
- Required remediation: separate quote/authorize/settle/execute state machine or compensating durable workflow; never make outbound payment before incoming settlement finality.

### PF-SEC-004: pending settlement reconciliation is process-local

- Status: [BROKEN]
- Location: `src/payments/seller.ts:98-118`
- Evidence: `setTimeout` polls 60 times; no pending-call startup scanner exists.
- Impact: deploy/restart loses reconciliation; financial rows can remain pending forever.
- Required remediation: durable settlement jobs, retry/backoff, dead-letter state, startup reconciliation, uniqueness by settlement/payment identity.

### PF-SEC-005: buyer SSRF/rebinding/redirect controls are absent

- Status: [BROKEN]
- Location: `src/payments/buyer.ts:20-41`
- Evidence: initial target validation/probe is separate from global `fetch`; paid fetch follows redirects and resolves DNS independently without private-IP/final-origin enforcement.
- Impact: time-of-check/time-of-use DNS changes or redirects can reach prohibited services and expose signed payment behavior.
- Required remediation: shared pinned-address transport, redirect-by-redirect validation, same-origin policy, final URL verification, and no credential forwarding across origins.

### PF-SEC-006: unbounded target response buffering and weak timeout budgets

- Status: [BROKEN]
- Location: `src/probes/transport.ts:60-75`; `src/payments/buyer.ts:33-40`; MCP/x402 probes
- Evidence: all chunks/text are buffered with no byte ceiling; buyer fetch has no explicit abort timeout.
- Impact: memory exhaustion, slowloris resource consumption, paid worker starvation.
- Required remediation: byte limits, streaming cancellation, decompression ratio cap, total deadline propagated across DNS/TLS/probes/payment.

### PF-SEC-007: false certification badge

- Status: [BROKEN]
- Evidence: [VERIFIED-LIVE] certified badge target `01KX6975GFQK03FCV5KXVERTW3` points to free unattested `playground_check` `pf_01KX7CBZY0ZN6AC594TXMRXXAM`.
- Impact: materially misleading trust signal.
- Required remediation: disable badge; model immutable certification records bound to exact certified report, attestation confirmation, target identity, and expiry.

### PF-SEC-008: attestation authorization and verification contract are underspecified

- Status: [BROKEN]
- Location: `contracts/Attestation.sol:4-9`; `src/chain/attest.ts:16-31`
- Evidence: anyone can emit; public report hash differs after tx backfill; old reports are unattested.
- Impact: naive consumers can accept attacker events or fail to reproduce legitimate hashes.
- Required remediation: publish versioned payload/canonicalization/authorized attester; consider access control/storage or remove contract.

### PF-SEC-009: distributed rate limits are ineffective

- Status: [PARTIAL]
- Location: `src/server.ts:20-29`; `src/payments/seller.ts:67-77`
- Evidence: target and payer maps are per process; global Fastify rate limit is also memory-backed by default; `trustProxy:true` is unconditional.
- Impact: scaling/restarts reset limits; proxy header spoofing may bypass IP limits depending on Railway behavior; maps can grow.
- Required remediation: Redis/Postgres-backed keys, bounded cardinality, explicit trusted proxy hops, payer/payment identity enforcement.

### PF-SEC-010: database integrity constraints and idempotency are incomplete

- Status: [BROKEN]
- Location: `src/db/schema.sql`
- Evidence: no verdict/score/kind/status constraints for several tables, no unique settlement reference, no active-monitor uniqueness, no migration ledger.
- Impact: duplicate financial records/monitors, invalid states, migration drift.
- Required remediation: versioned migrations, constraints, uniqueness/idempotency keys, reconciliation views.

## P2 findings

### PF-SEC-011: missing HTTP security headers

- Status: [VERIFIED-LIVE]
- Evidence: API responses exposed no HSTS, CSP, `X-Content-Type-Options`, or frame policy during audit.
- Impact: weaker browser hardening and downgrade policy.
- Required remediation: add HSTS after domain validation, `nosniff`, appropriate CSP/frame/referrer policies.

### PF-SEC-012: health/readiness semantics mask subsystem failure

- Status: [BROKEN]
- Location: `src/server.ts:71-75`
- Evidence: `ok` depends only on DB not being down.
- Impact: Railway can keep routing paid traffic while settlement, attestation, or scheduler reports error.
- Required remediation: separate liveness/readiness/dependency status; paid readiness must fail closed.

### PF-SEC-013: public errors are inconsistent and leak validator detail

- Status: [PARTIAL]
- Evidence: paid/playground errors embed raw Zod messages; report errors are untyped strings.
- Impact: unstable frontend contracts and unnecessary implementation detail.
- Required remediation: versioned error schema, field-level safe errors, correlation ID.

### PF-SEC-014: sensitive operational metadata has no retention policy

- Status: [PARTIAL]
- Evidence: payer addresses, target URLs, findings, settlement refs, and hashed IP usage persist without retention documentation.
- Impact: privacy/operational exposure grows indefinitely.
- Required remediation: classification, retention/deletion schedule, access audit, redaction.

## Checked and not found

- [VERIFIED-LOCAL] SQL values use tagged parameterization; the only `.unsafe` call executes the repository schema file, not user input.
- [VERIFIED-LOCAL] Badge XML interpolations are escaped and the target ID is restricted.
- [VERIFIED-LOCAL] No debug/admin route was registered.
- [VERIFIED-LOCAL] Secret-pattern scanning found no confirmed real private key; test private keys and public hashes/addresses were correctly distinguishable. Git history was unavailable.
- [VERIFIED-LOCAL] `npm audit --package-lock-only --omit=dev` reported zero known production vulnerabilities at 2026-07-11T06:19:24Z. This does not prove absence of unpublished vulnerabilities.
- [BROKEN] The separate frontend production audit reported two moderate entries rooted in PostCSS `<8.5.10` through Next 15.5.20 (`GHSA-qx2v-qp2m-jg93`); upgrade through a supported fixed Next/PostCSS dependency path rather than applying npm's anomalous downgrade suggestion.
- [PARTIAL] The probe transport revalidates redirects and DNS answers; this protection does not extend to the payment buyer.
