# Frontend API contract: verified current behavior

Base API: `https://api.usepreflight.xyz`  
Contract status: current behavior, not a promise of stability  
Required backend correction: add a versioned OpenAPI/JSON Schema contract before frontend rebuild.

## Global rules

- [VERIFIED-LIVE] JSON success responses use `application/json`; badge uses SVG.
- [PARTIAL] Errors are inconsistent. Most newer routes return `{ "error": { "code", "message" } }`; reports return `{ "error": "..." }`; x402 unpaid responses have body `{}` and the challenge in `PAYMENT-REQUIRED`.
- [CODE-PRESENT] Global default rate limit is 30 requests per “1 minute” per Fastify client key; payer default is 30/60s; target default is 10/hour; these are environment-tunable and per-process for payer/target.
- [VERIFIED-LIVE] Browser CORS is allowed only for `https://usepreflight.xyz` and `https://www.usepreflight.xyz`, and only on health, playground, Health Index, report, and badge paths. Those origins currently do not resolve.
- [PARTIAL] No stable `schema_version`, request ID response field/header contract, OpenAPI, ETag, or deprecation policy exists.
- [BROKEN] Every report's `report_url` points to the non-resolving frontend origin. A new frontend should navigate locally by `report_id` until fixed.

## Shared request

```ts
type ExpectedPayment = {
  amount?: string;   // atomic units, digits only
  asset?: string;
  network?: string;
  payTo?: `0x${string}`; // exactly 40 hex chars
};

type PreflightRequest = {
  target: string;    // absolute credential-free public HTTPS URL
  mcp_url?: string;  // absolute credential-free public HTTPS URL
  expected?: ExpectedPayment;
};

type DeepRequest = PreflightRequest & { owner_attestation: true };
```

Unknown object fields are currently stripped by Zod. Do not rely on that behavior.

## Shared report

```ts
type Severity = "high" | "med" | "low" | "info";
type Verdict = "GO" | "HOLD" | "NO-GO";
type Finding = { code: string; severity: Severity; evidence: string; fix: string };
type ReportEnvelope = {
  report_id: string;
  tool: string;
  target: string;
  verdict: Verdict;
  score: number;             // observed integer 0..100; DB does not constrain it
  findings: Finding[];
  attestation_tx: string | null;
  report_url: string;        // currently broken frontend URL
  generated_at: string;      // ISO timestamp
};
```

Stable enough now: `report_id`, `tool`, `target`, `verdict`, `score`, `findings`, nullable `attestation_tx`, `generated_at`.  
Unstable/unsafe: finding taxonomy, evidence text, report URL origin, relationship between verdict/payment/attestation/certification, additional playground flag.

## GET `/health`

Purpose: process/dependency summary.

Success 200:

```json
{
  "ok": true,
  "build_sha": "dev",
  "db": "ok",
  "settlement_listener": "ok",
  "attestation_queue": "idle",
  "monitor_scheduler": "idle"
}
```

- [VERIFIED-LIVE] No cache header; allowed-origin CORS works.
- [PARTIAL] Treat only as display status, not proof paid calls are safe. `ok` may remain true when non-DB subsystems error.
- Proposed correction: separate `/livez` and `/readyz`, use enums and real immutable SHA, return 503 when paid dependencies are unavailable.

## POST `/api/v1/playground_check`

Purpose: free transport/MCP/x402 surface check. It never intentionally buys or creates an attestation job.

Request: `PreflightRequest`.

Success 200:

```json
{
  "report_id": "pf_...",
  "tool": "playground_check",
  "target": "https://...",
  "verdict": "GO",
  "score": 100,
  "findings": [],
  "attestation_tx": null,
  "report_url": "https://usepreflight.xyz/r/pf_...",
  "generated_at": "2026-07-11T00:00:00.000Z",
  "playground": true
}
```

Errors:

| HTTP | Code | Meaning/UI |
|---|---|---|
| 400 | `TARGET_REJECTED` | invalid/non-HTTPS/private/DNS-invalid input; show safe message |
| 429 | `TARGET_RATE_LIMITED` | target hourly cap; retry later |
| 429 | `PLAYGROUND_IP_DAILY_CAP` | per-IP day cap; current message hardcodes 3 |
| 429 | `PLAYGROUND_GLOBAL_DAILY_CAP` | global daily capacity exhausted |
| 503 | `PLAYGROUND_UNAVAILABLE` | DB absent; unavailable state |
| 500 | `PLAYGROUND_INTERNAL_ERROR` | retryable generic failure |
| 429 | plugin-level rate limit body | global Fastify limiter; schema may differ |

- [CODE-PRESENT] DB work and remote probes happen synchronously; there is no job/polling state. Use a client timeout above the backend's combined probe budget, but add cancellation UI.
- [VERIFIED-LIVE] CORS preflight returns 204; no success live call was made by this audit because it would mutate production.
- Proposed correction: return cap/reset metadata, uniform errors, server request ID, and module states.

## GET `/r/{report_id}`

Purpose: retrieve persisted report.

- Success 200: `ReportEnvelope`.
- 404 current: `{ "error": "report not found" }`.
- 503 current: `{ "error": "database unavailable" }`.
- [VERIFIED-LIVE] No explicit cache/ETag; known reports and 404 work.
- Empty state: 404, not null.
- Attestation polling: a client may poll until `attestation_tx` becomes non-null, but no documented SLA or status endpoint exists. Old reports can remain null permanently.
- Proposed correction: typed error, `attestation:{status,tx,hash,canonicalization_version}`, cache/ETag, and no dead frontend URL.

## GET `/api/v1/health_index`

Success 200 current:

```json
{
  "pct_go": 100,
  "scanned": 1,
  "go_targets": ["https://api.usepreflight.xyz/api/v1/run_preflight"],
  "median_latency_ms": 650,
  "top_finding_codes": [],
  "generated_at": "2026-07-10T20:49:59.942Z"
}
```

Errors: 404 `HEALTH_INDEX_NOT_READY`; 503 `HEALTH_INDEX_UNAVAILABLE`.

- [VERIFIED-LIVE] `Cache-Control: public, max-age=600`; allowed-origin CORS.
- [BROKEN] Snapshot source is manual and currently one self target. Frontend must display population, generated time, and a “not representative” thin-state warning; do not label it marketplace-wide.
- `median_latency_ms` can be `null` despite current frontend type declaring number.
- Proposed correction: add registry/source/methodology, sample window, failures, distinct targets, next refresh, freshness status, and minimum publication threshold.

## GET `/badge/{target_id}.svg`

- Success 200: SVG, `Cache-Control: public, max-age=300`.
- Unknown/ineligible/non-GO/invalid: empty 404, `private, no-store`.
- [VERIFIED-LOCAL] XML escaping exists.
- [BROKEN] Do not use as certification UI. Current badge can point to any latest GO check; live badge points to an unattested free playground report.
- Proposed correction: path by immutable certification ID, signed/attested report binding, `valid_until`, and non-SVG JSON metadata endpoint.

## Paid service catalogue

There is no dedicated frontend REST catalogue. Current options:

1. [VERIFIED-LIVE] MCP `service_info` at `/mcp` returns all services.
2. [VERIFIED-LIVE] Each unpaid route returns an x402 challenge containing its exact current price.
3. [BROKEN] Frontend `SERVICES` is hardcoded and can drift.

Proposed endpoint: `GET /api/v1/services` with version, route, method, price atomic/display, network, asset, availability, input schema, output schema, and deprecation state.

## Paid route behavior

All paid routes use POST. An unpaid request returns 402 with empty JSON body and a base64url JSON `PAYMENT-REQUIRED` response header. Browser frontend should not implement wallet payment until CORS exposes payment headers and a supported wallet/user flow exists.

| Route | Price observed | Body | Current success |
|---|---:|---|---|
| `/api/v1/check_endpoint` | 0.02 | `PreflightRequest` | `ReportEnvelope` |
| `/api/v1/check_x402` | 0.05 | `PreflightRequest` | `ReportEnvelope` |
| `/api/v1/run_preflight` | 0.10 | `PreflightRequest` | `ReportEnvelope` |
| `/api/v1/deep_check` | 0.50 | `DeepRequest` | `ReportEnvelope` |
| `/api/v1/preflight_certified` | 10.00 | `DeepRequest` | `ReportEnvelope` |
| `/api/v1/watch_endpoint` | 1.00 | `PreflightRequest` | report with `WATCH_REGISTERED` finding |
| `/api/v1/get_watch_report` | 0.02 | `PreflightRequest` | report with `WATCH_REPORT` finding |

Common application errors after a valid payment credential: 400 `TARGET_REJECTED`; 400 `OWNER_ATTESTATION_REQUIRED`; 429 `TARGET_RATE_LIMITED`; 503 `PAYMENTS_UNAVAILABLE`; 500 `PREFLIGHT_INTERNAL_ERROR`. SDK/facilitator errors may produce 4xx/5xx bodies not frozen here.

- [BROKEN] Do not expose `deep_check` or `preflight_certified` in the new frontend until economic authorization is fixed.
- [PARTIAL] Paid calls are synchronous at HTTP level but settlement can be pending asynchronously. There is no client status endpoint.

## Monitoring frontend contract

Current registration result is encoded inside a finding:

```json
{
  "code": "WATCH_REGISTERED",
  "severity": "info",
  "evidence": "{\"monitor_id\":\"...\",\"interval_s\":1800,\"expires_at\":\"...\"}",
  "fix": "No action required."
}
```

Current history result is similarly encoded as `WATCH_REPORT`, while internal evidence contains:

```ts
type WatchReportData = {
  monitor_id: string;
  status: string;
  expires_at: string;
  uptime_pct: number;
  latency_series: { ts: string; latency_ms: number | null }[];
  finding_history: { ts: string; code: string }[];
};
```

- [BROKEN] This is not suitable as a stable frontend contract; parsing JSON from `finding.evidence` is forbidden.
- Proposed correction: authenticated `POST /monitors`, `GET /monitors/{id}`, `GET /monitors/{id}/samples`, renewal/cancel, direct structured payloads, empty sample state, pagination, ownership, polling interval, and incident schema.

## Attestation frontend state

Current state is only `attestation_tx:null|string`.

- `null` is ambiguous: deliberately not attested (playground), pending, disabled, failed, or permanently missing.
- non-null does not itself expose event hash, canonical payload, attester, confirmation count, or finality.

Proposed:

```ts
type Attestation = {
  status: "not_applicable" | "queued" | "submitted" | "confirmed" | "failed";
  canonicalization_version: "preflight-report-v1";
  report_hash: `0x${string}`;
  tx_hash?: `0x${string}`;
  attester?: `0x${string}`;
  confirmed_at?: string;
  last_error_code?: string;
};
```

## Frontend implementation rules

- Never use hardcoded report/index data as a live fallback.
- Never infer certification from `verdict:"GO"` or a badge response.
- Show score, payment, attestation, monitoring, and certification as independent states.
- Preserve `unknown` and `unavailable`; do not turn missing modules into success.
- Treat evidence/fix as untrusted text and render text-only.
- Do not expose payer addresses, target secrets, or raw internal errors.

