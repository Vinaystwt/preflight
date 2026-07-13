# Security and trust boundaries

PreFlight verifies public runtime behavior. It does not request operator private keys and it does not bypass target authentication.

## Private reports

Report IDs are not sufficient for access. Private reports require a bearer capability token. Browser links keep the token in the fragment so the token is not sent to servers as part of normal HTTP requests.

## Settlement before publication

Paid verification does not publish a private report until the required settlement state has been recorded. Durable reconciliation handles late facilitator confirmations.

## Safe egress

Probe traffic is routed through a safe client that rejects private IP space, loopback, link-local addresses, unsafe redirects, oversized bodies, and deadline overruns.

## Buyer proof

Buyer proof is bounded:

- requires owner attestation;
- enforces spend caps;
- checks terms-hash stability before payment;
- rejects duplicate outbound replay;
- records payment, settlement, replay, and delivery stages.

## Honest unknown

If PreFlight cannot safely prove a criterion, it returns `UNKNOWN`. It does not infer a release from missing evidence.
