# API

Production base URL:

```text
https://api.usepreflight.xyz
```

## Discovery

```http
POST /api/v1/discover
content-type: application/json

{ "endpoint": "https://api.example.com/paid-route" }
```

Discovery is free. It observes the live surface and returns a proposed manifest with field-level provenance.

## Paid release verification

```http
POST /api/v1/verify-release
content-type: application/json

{
  "schema_version": "preflight.verify-release-request.v1",
  "endpoint": "https://api.example.com/paid-route"
}
```

This endpoint is x402-gated. An unpaid request returns HTTP 402 and a `PAYMENT-REQUIRED` challenge. A funded agent replays with `PAYMENT-SIGNATURE`.

The response is a private report envelope containing the decision, criterion evidence, receipt metadata, and a capability report link.

## Reports

Reports are private bearer-capability resources. The server receives the token through the `Authorization` header; browser links keep tokens in the URL fragment so they are not sent as referrers.

```http
GET /api/v1/reports/{report_id}
Authorization: Bearer <capability-token>
```

## Public proof surfaces

```text
GET /api/v1/pubkeys
GET /api/v1/receipts/{receipt_id}
GET /api/v1/verify-receipt?receipt_id={receipt_id}
POST /api/v1/verify-receipt
GET /api/v1/gallery
GET /api/v1/passport/{agent_id}
GET /api/v1/badge/{agent_id}.svg
GET /api/v1/asp/{agent_id}
GET /api/v1/cohort
GET /api/v1/benchmark
GET /api/v1/self-check
```

`GET /api/v1/receipts/{receipt_id}` returns the signed receipt envelope.
`GET /api/v1/verify-receipt?receipt_id=...` returns the public verification result used by durable receipt links.
`POST /api/v1/verify-receipt` accepts JSON clients that prefer a request body.

Passport badges are public only for eligible Agent-ID RELEASE passports. Gallery publication is opt-in.

## Contracts

```text
GET /api/v1/contracts/release-manifest/v1
GET /api/v1/contracts/discovery/v1
GET /api/v1/contracts/run-events/v1
GET /api/v1/contracts/machine-report/v1
```

The `v1` path segments are public contract versions and are intentionally retained.

## Errors

Errors use a typed envelope with a stable error code, category, HTTP status, and retryability signal. Payment errors distinguish not-charged validation failures from charged settlement/report states.

## Privacy

PreFlight stores release manifests, runtime snapshots, evidence, payment attempts, audit events, and receipts required to prove the decision. Reports are not public by report ID alone.
