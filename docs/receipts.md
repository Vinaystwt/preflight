# Signed receipts

PreFlight receipts are portable proof that a specific release decision was issued for a specific manifest and runtime snapshot.

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

## Drift

A receipt proves what PreFlight observed at the time of the report. It does not guarantee the target service has not changed since. Badges can expire when newer evidence contradicts an older release state.
