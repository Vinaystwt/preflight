# CLI

The PreFlight CLI lives in `packages/cli`.

The package is prepared as `@usepreflight/cli` with the binary name `preflight`. npm publication is intentionally not claimed until registry access to the `@usepreflight` scope is verified.

## Local build

```bash
npm ci
npm run build --prefix packages/cli
node packages/cli/dist/index.js --help
(cd packages/cli && npm pack --dry-run)
```

## Verify a release

```bash
preflight verify https://api.example.com/mcp
```

The command calls the hosted PreFlight API. A full paid verification still goes through the x402 payment flow; the CLI is only a client, not a replacement for the hosted service.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | `RELEASE` |
| `1` | `BLOCK` |
| `2` | `UNKNOWN` |
| `3` | infrastructure or client error |

## Verify a signed receipt

```bash
preflight verify-receipt receipt.json --pubkeys-file pubkeys.json
```

Receipt verification checks:

- canonical JSON payload hashing;
- Ed25519 signature validity;
- key ID and public key match;
- payload hash drift.

The hosted public-key endpoint is:

```text
https://api.usepreflight.xyz/api/v1/pubkeys
```
