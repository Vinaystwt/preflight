# OKX.AI marketplace readiness

## Verdict

[BROKEN] Not ready to register or submit for listing.

- [VERIFIED-LIVE] The backend exposes paid x402 HTTP endpoints in a form current OKX guidance describes as eligible for paid A2MCP standardized API services.
- [BROKEN] Eligibility of the transport shape is not readiness: outbound-spend authorization, settlement atomicity, public DNS, certification integrity, and reliability evidence fail release gates.
- [NOT-IMPLEMENTED] Human-confirmed baseline: no Onchain OS/Agentic Wallet setup evidence in the repository, Agent Identity, ASP registration, A2MCP/A2A service registration, Agent ID, submission, approval, marketplace page, third-party order, qualified revenue, rating, or review.

## Current official requirements observed on 2026-07-11

- [VERIFIED-LIVE] OKX's ASP tutorial describes A2MCP as standardized API services, fixed price per call, either free direct-result endpoints or paid x402 endpoints: `https://www.okx.ai/tutorial/asp`.
- [VERIFIED-LIVE] Official Onchain OS docs require an EVM recipient wallet, OKX Developer Portal API key, and business backend; the Payment SDK performs 402 verification and settlement: `https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk`.
- [VERIFIED-LIVE] Official listing flow requires Agent Identity/ASP registration, service information including pricing/interface address, submission, review, and result notification: `https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction`.
- [PARTIAL] Current docs contain inconsistent review timing language (24 hours in the tutorial versus two business days in the introduction). Do not promise a review SLA.

## Proposed service registration data after remediation

| Service | Endpoint | Current challenge price | Readiness |
|---|---|---:|---|
| check_endpoint | `POST https://api.usepreflight.xyz/api/v1/check_endpoint` | 0.02 USDT | [PARTIAL] status/body safety corrections required |
| check_x402 | `POST https://api.usepreflight.xyz/api/v1/check_x402` | 0.05 USDT | [PARTIAL] contract/limits required |
| run_preflight | `POST https://api.usepreflight.xyz/api/v1/run_preflight` | 0.10 USDT | [PARTIAL] flagship candidate after report URL/reconciliation fixes |
| deep_check | `POST https://api.usepreflight.xyz/api/v1/deep_check` | 0.50 USDT | [BROKEN] do not register |
| preflight_certified | `POST https://api.usepreflight.xyz/api/v1/preflight_certified` | 10.00 USDT | [BROKEN] do not register |
| watch_endpoint | `POST https://api.usepreflight.xyz/api/v1/watch_endpoint` | 1.00 USDT | [PARTIAL] no production reliability/auth contract |
| get_watch_report | `POST https://api.usepreflight.xyz/api/v1/get_watch_report` | 0.02 USDT | [PARTIAL] awkward paid envelope and no auth |

- [VERIFIED-LIVE] `/mcp` is free and discovery-only. It returns pointers rather than executing paid tools.
- [PARTIAL] Register the actual paid HTTP route for each service, not `/mcp`, unless OKX registration tooling explicitly expects a discovery MCP URL in addition. The current official tutorial permits standardized API endpoints, so pointer-only MCP is not evidence of incompatibility.

## Release gates before registration

| Gate | Current state | Success condition |
|---|---|---|
| Outbound fund safety | [BROKEN] | cryptographic ownership/payee policy; loss tests; per-call cap |
| Settlement atomicity | [BROKEN] | no durable effect/outbound payment before settled authorization; reconciliation |
| Public product DNS | [BROKEN] | apex and `www` resolve with monitored TLS |
| Report contract | [PARTIAL] | versioned schema/errors/freshness and live report URLs |
| Badge/certification | [BROKEN] | exact attested certified report, expiry, no playground substitution |
| Attestation | [PARTIAL] | public canonical payload and authorized attester; old backlog disposition |
| Monitoring | [PARTIAL] | seven-day evidence, alerts, restart/multi-instance/failure tests |
| Health Index claims | [BROKEN] | registry-backed representative population or feature removed |
| Dependency/security | [PARTIAL] | frontend PostCSS advisory resolved; hardened headers/egress |
| Source provenance | [BLOCKED] | Git commit equals `/health.build_sha` and deployment |
| Backup/recovery | [BLOCKED] | documented successful restore rehearsal |
| External canary | [NOT-IMPLEMENTED] | third-party-controlled trivial-value order with reconciled evidence |

## Later manual process

1. [BLOCKED] Install current Onchain OS skills in the operator's controlled environment: `npx skills add okx/onchainos-skills --yes -g`.
2. [BLOCKED] Log in to Agentic Wallet interactively with the operator's email. Never expose OTP, seed, or keys.
3. [BLOCKED] Prompt: `Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS`.
4. [BLOCKED] Provide final service name, bounded factual description, exact routes, fixed prices, schemas, timeout, rate limit, support/contact, and public website/privacy terms.
5. [BLOCKED] Verify the returned Agent ID and every endpoint/price before submission.
6. [BLOCKED] Prompt only after all gates pass: `Help me list my ASP on OKX.AI using Onchain OS`.
7. [BLOCKED] Preserve review feedback and first real order evidence, clearly separating operator-funded tests from qualified revenue.

## Claims safe for a future listing

- [VERIFIED-LIVE] “Returns an x402 v2 challenge on X Layer for the registered paid endpoint.”
- [VERIFIED-LOCAL] “Checks public HTTPS transport, MCP discovery when explicitly supplied, and x402 challenge shape.”
- [VERIFIED-LIVE] “Returns a typed report with finding codes, evidence, fixes, score, and verdict.”

Do not currently claim certification, every-report attestation, continuous monitoring reliability, marketplace-wide index coverage, unlimited use, gasless operation without qualification, likely reviewer outcomes, no human operations, customer revenue, or reviews.

