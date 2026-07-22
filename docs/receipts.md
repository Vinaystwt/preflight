# PreFlight Signed Receipts

Anyone can verify that a PreFlight Signed Receipt was issued by PreFlight, has not been altered, and applies to the identified runtime snapshot and policy version. It does not prove the semantic correctness of delivery, future behaviour, target security, or marketplace endorsement.

## Envelope

Receipts include:

- `receipt_id`
- report ID
- decision
- manifest hash
- runtime snapshot hash
- policy version
- settlement reference when available
- price and payer metadata when recorded
- target fingerprint
- signing key ID
- Ed25519 signature

## Verification

Verification steps:

1. Canonicalize the payload with `preflight.canonical-json.v1`.
2. SHA-256 hash the canonical bytes.
3. Compare the hash to `verify.payload_hash`.
4. Fetch the public key from `GET /api/v1/pubkeys`.
5. Verify the Ed25519 signature over the canonical payload bytes.

The web report page runs these checks in the browser. The CLI also includes a receipt verifier in source form.

Public endpoints:

```text
GET /api/v1/receipts/{receipt_id}
GET /api/v1/verify-receipt?receipt_id={receipt_id}
POST /api/v1/verify-receipt
GET /api/v1/pubkeys
```

The durable public verifier link uses `GET /api/v1/verify-receipt?receipt_id=...`.
`POST /api/v1/verify-receipt` is retained for JSON clients.

## Drift

A receipt does not prove that PreFlight observed correctly. It binds the signed payload to the stated snapshot and policy version; the target may change after that snapshot. Badges can expire when newer evidence contradicts an older release state.
