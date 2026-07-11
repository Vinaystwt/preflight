# Architecture map

## Runtime and trust boundaries

```text
Browser/agent
  | HTTPS, global Fastify rate limit
  v
Railway Fastify process (`src/server.ts`)
  +-- free: /health, /mcp, /r/:id, /badge/:id.svg, /api/v1/health_index
  +-- free-write: /api/v1/playground_check
  +-- paid: seven POST /api/v1/* routes
          | x402 verify before handler, settle in onSend after handler
          v
      probes + rubric + report persistence
          |                     |
          v                     v
      arbitrary target HTTPS   Neon Postgres
          |                     +-- reports/calls/spend
          | deep_check          +-- monitors/probes
          v                     +-- attestation jobs/index
      PreFlight buyer wallet
          |
          v
      OKX facilitator + X Layer USD₮0

Background loops in every process
  +-- attestation queue -> X Layer contract
  +-- monitor scheduler -> arbitrary target probes
```

- [CODE-PRESENT] Server bootstrap is `src/server.ts:32-87`; `src/index.ts` simply imports it.
- [VERIFIED-LIVE] Railway terminates TLS and identifies as `railway-hikari`; the certificate was valid from 2026-07-10 to 2026-10-08.
- [BLOCKED] No checked-out Git identity can be connected to the Railway deployment; production reports `build_sha:"dev"`.

## Subsystems

| Subsystem | Entry/main files | Storage | External calls | Failure behavior | Paid hot path | Judgment |
|---|---|---|---|---|---|---|
| Fastify/server | `src/server.ts`, `src/index.ts` | in-memory limit maps | none directly | handler maps validation to 400, unknown to 500 | Yes | Refactor |
| MCP | `src/mcp/server.ts` | none; fresh server/transport per request | none | SDK JSON-RPC errors | No | Retain/refactor |
| Seller x402 | `src/payments/seller.ts` | calls table + in-memory poll timers | OKX facilitator | challenge/verify/settle errors; async pending | Yes | Refactor |
| Buyer x402 | `src/payments/buyer.ts` | spend/calls via caller | arbitrary HTTPS, X Layer RPC | throws; caller marks reservation failed | Yes, deep tools | Rewrite |
| Transport probe | `src/probes/transport.ts` | evidence in report | DNS + arbitrary HTTPS | finding, usually no throw | Yes | Refactor |
| MCP probe | `src/probes/mcp.ts` | evidence in report | arbitrary HTTPS MCP | route N/A or high finding | Yes | Retain/refactor |
| x402 probe | `src/probes/x402.ts` | challenge evidence | arbitrary HTTPS | malformed/high finding | Yes | Retain/refactor |
| Rubric/report | `src/engine/*` | checks/pending job | none | DB error fails request | Yes | Refactor |
| Database | `src/db/*` | Postgres/Neon claimed | Postgres | errors bubble except fire-and-forget call audit | Yes | Refactor |
| Monitoring | `src/monitors/scheduler.ts` | monitors/probes | arbitrary HTTPS | records failed sample | Background | Refactor |
| Attestation | `src/chain/attest.ts` | queue + check tx | X Layer RPC | exponential retry forever | Background | Refactor/remove |
| Badge | `src/routes/badge.ts` | target flag/latest check | none | 404 | No | Rewrite |
| Health Index | scanner/script/route | snapshots | arbitrary HTTPS on manual script | scan failure aggregate | No | Rewrite |
| Logging | Fastify/Pino + explicit audit logs | platform logs only | Railway logging | no alerting | Yes | Build observability |
| Frontend APIs | health/playground/report/index/badge | backend | API CORS/direct/proxy | hardcoded fallbacks mask failure | No | Rebuild |

## Route inventory

| Method/path | Access/price | Request | Success | Errors/writes/external calls |
|---|---|---|---|---|
| GET `/health` | Free | none | health object | DB health query; always 200; `ok` false only on DB down |
| ALL `/mcp` | Free | MCP JSON-RPC | initialize/list/pointers | global rate limit; fresh stateless transport |
| GET `/r/:id` | Free | path ID | report envelope | 404 string error, 503 DB; DB read |
| GET `/badge/:target_id.svg` | Free | constrained ID | SVG | 404/no-store; DB read |
| GET `/api/v1/health_index` | Free | none | snapshot | 404 not ready, 503 DB; DB read |
| OPTIONS/POST `/api/v1/playground_check` | Free/capped | preflight input | envelope + `playground:true` | 400/429/503/500; DB cap/check writes; target probes |
| POST `/api/v1/check_endpoint` | $0.02 | preflight input | report | x402; target probes; DB report/job/call |
| POST `/api/v1/check_x402` | $0.05 | preflight input | report | x402; target probes; DB report/job/call |
| POST `/api/v1/run_preflight` | $0.10 | preflight input | report | x402; target probes; DB report/job/call |
| POST `/api/v1/deep_check` | $0.50 | deep input | report | x402 in + arbitrary x402 out; DB spend/report/jobs/calls |
| POST `/api/v1/preflight_certified` | $10.00 | deep input | report | deep path + monitor + badge flag; daily cached report |
| POST `/api/v1/watch_endpoint` | $1.00 | preflight input | report | DB monitor/report/job |
| POST `/api/v1/get_watch_report` | $0.02 | preflight input | report containing history as finding/evidence | DB reads and new report/job |

## Input schemas

`PreflightInput` current behavior:

```json
{
  "target": "https://required.example/path",
  "mcp_url": "https://optional.example/mcp",
  "expected": {
    "amount": "optional atomic decimal string",
    "asset": "optional string",
    "network": "optional string",
    "payTo": "optional 0x address"
  }
}
```

`deep_check` and `preflight_certified` additionally require `"owner_attestation": true`.

- [CODE-PRESENT] Zod strips unknown object keys by default; no explicit maximum URL/body-field lengths are declared beyond Fastify's default body limit.
- [BROKEN] Paid routes have no published machine-readable HTTP request/response schema or OpenAPI document.

## Persistence model and transaction boundaries

- [CODE-PRESENT] `targets.endpoint_url` is unique. Checks reference targets; pending attestations are unique per check.
- [BROKEN] Report persistence inserts/updates the target, then inserts the check, then inserts the job without a surrounding transaction (`src/db/client.ts:57-74`). Partial state is possible.
- [CODE-PRESENT] Spend reservation and playground counters use transactions/advisory locks.
- [CODE-PRESENT] Attestation completion updates job/check atomically.
- [BROKEN] Monitor ensure is not transactional and has no uniqueness constraint for one active monitor per target.
- [BROKEN] No migration version ledger, rollback, retention, partitioning, backup/restore evidence, or sensitive-data lifecycle is present.
- [PARTIAL] Pool max is five with 20-second idle timeout; no statement/connect timeout is configured.

## External dependencies and trust

- [CODE-PRESENT] OKX facilitator is trusted for verify/settle/replay behavior.
- [CODE-PRESENT] X Layer RPC is trusted for buyer signing context and attestations.
- [CODE-PRESENT] DNS, public CAs, and arbitrary target servers are hostile inputs.
- [BROKEN] Caller-supplied target ownership is not authenticated.
- [BROKEN] Railway/Vercel/Neon operational controls, backups, alerts, and deploy provenance are unverified.

