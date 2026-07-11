# Technical debt map

| ID | Area | Debt | Evidence status | Risk | Recommendation | Priority | Effort |
|---|---|---|---|---|---|---|---|
| TD-001 | Provenance | Checkout has no Git metadata; live build SHA is `dev` | [BLOCKED] | Cannot reproduce/deploy safely | Restore canonical clone and immutable build identity | P0 | 1-2d |
| TD-002 | Outbound payment | Ownership is a boolean and payee arbitrary | [BROKEN] | Daily fund drain | Rewrite authorization and disable route | P0 | 4-8w |
| TD-003 | Domain | Public report/frontend domain has no DNS | [BROKEN] | Product unusable | Restore DNS/TLS and external monitor | P0 | 1d |
| TD-004 | Certification | Sticky target flag + latest arbitrary check | [BROKEN] | False trust claim | Dedicated immutable certification table/state machine | P0 | 2-3w |
| TD-005 | Settlement | Effects happen before settlement; pending timers in memory | [BROKEN] | Orphans/loss | Durable financial workflow/reconciliation | P0 | 3-6w |
| TD-006 | HTTP client | No size/decompression/final-origin limits | [BROKEN] | SSRF/DoS | Shared hardened egress client | P1 | 2-3w |
| TD-007 | Rubric | Empty/N/A can GO/100; HTTP status unscored | [BROKEN] | Misleading verdict | Versioned rubric with unknown state and gates | P1 | 2-3w |
| TD-008 | Reports | No schema version/raw evidence/payment/attestation state | [PARTIAL] | Contract drift | Versioned report DTO and separate internal evidence | P1 | 2w |
| TD-009 | DB migrations | Idempotent schema script, no ledger/rollback | [PARTIAL] | Drift/unsafe deploy | Adopt versioned migration tool | P1 | 2-4w |
| TD-010 | DB constraints | Financial/monitor uniqueness and state constraints absent | [BROKEN] | Duplicates/corruption | Add constraints after data audit | P1 | 1-2w |
| TD-011 | Monitoring | No ownership, alerts, SLO, long-run proof | [PARTIAL] | Claim/reliability gap | External scheduler/alerts or stronger worker | P1 | 3-6w |
| TD-012 | Health Index | Manual file input, no registry/schedule | [BROKEN] | False marketplace statistics | Registry-backed sampling methodology | P1 | 4-8w |
| TD-013 | Attestation | Mutable served envelope, open emitter, duplicate risk | [BROKEN] | Trust inconsistency | Publish v1 payload/attester or remove | P1 | 2-4w |
| TD-014 | Observability | Logs only; no metrics/traces/alerts | [PARTIAL] | Incidents undetected | Correlation IDs, metrics, dashboards, alerts | P1 | 3-6w |
| TD-015 | Rate limiting | Per-process maps/unbounded cardinality | [PARTIAL] | Bypass/memory growth | Distributed bounded limiter | P1 | 1-2w |
| TD-016 | Shutdown | No explicit SIGTERM graceful close | [CODE-PRESENT] | jobs/polls interrupted | Wire signals and drain deadlines | P1 | 2-3d |
| TD-017 | Tests | Mocks dominate; DB/real integrations conditional | [PARTIAL] | False confidence | Ephemeral Postgres/HTTPS/facilitator fixtures | P1 | 3-5w |
| TD-018 | Coverage/tooling | No lint/format/coverage scripts | [NOT-IMPLEMENTED] | Regression/code hygiene | Add CI gates after contracts freeze | P2 | 1w |
| TD-019 | Dependencies | Node_modules is pnpm-linked while npm lock/Docker use npm | [PARTIAL] | Local/deploy mismatch | Standardize npm or pnpm; clean reproducible install | P2 | 1-2d |
| TD-020 | SDK drift | Installed OKX packages are early 0.1/0.2 releases | [PARTIAL] | Protocol/client drift | Test current official SDK in compatibility branch | P1 | 2-3w |
| TD-021 | Errors | Mixed typed/untyped responses and raw Zod text | [PARTIAL] | Frontend instability | Error envelope v1 | P2 | 1w |
| TD-022 | Caching | Reports/health lack cache/ETag/freshness contract | [PARTIAL] | load/stale UX | Define conditional caching | P2 | 3-5d |
| TD-023 | Frontend truth | Hardcoded live report/index fallbacks | [MOCKED] | Masks outage/stale claims | Delete; show explicit unavailable state | P1 | 1-2d |
| TD-024 | Docs | Marketing claims outrun evidence | [BROKEN] | Reviewer/customer trust | Reconcile claims to verified labels | P0 | 2-4d |
| TD-025 | Frontend dependency | Next bundle resolves vulnerable PostCSS `<8.5.10` | [BROKEN] | CSS-stringification XSS advisory | Upgrade to supported fixed Next/PostCSS tree and retest | P1 | 1-2d |

## Dependency and build observations

- [VERIFIED-LOCAL] Root Node engine is `>=20`; audit ran Node 24.14.0/npm 11.9.0 while Docker uses Node 20 Alpine.
- [VERIFIED-LOCAL] Root lockfile is npm lockfile v3. `npm ci --dry-run` wanted to replace pnpm-linked installed packages and add peer Zod 3.25.76 copies; the working `node_modules` is not an npm-clean install.
- [VERIFIED-LOCAL] Direct installed versions match the lock for application dependencies. `npm ls` reports many extraneous packages because the shared/pnpm-linked layout does not match npm's expected tree.
- [VERIFIED-LOCAL] Production dependency audit reported zero known advisories. Current official OKX docs still show the same unscoped Node package names, while other language examples describe 0.2-era SDKs; compatibility must be retested before upgrade.
- [VERIFIED-LOCAL] Backend strict typecheck, build, 32 tests, frontend production build, and Foundry build passed.
- [NOT-IMPLEMENTED] Root and frontend have no lint/format/test-coverage scripts. Frontend has no automated tests.
