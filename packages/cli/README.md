# PreFlight CLI

Command-line client for PreFlight Release Gate.

Package: `@vinaystwt/preflight-cli`
Binary: `preflight`

```bash
preflight verify https://api.example.com/paid-route --wallet-key 0x... --json
preflight verify-receipt rcpt_... --json
```

The `verify` command pays PreFlight's x402 challenge from the provided wallet and returns the private report envelope. The `verify-receipt` command checks a public receipt's canonical payload hash and Ed25519 signature against PreFlight's published public keys.

Exit codes:

- `0`: `RELEASE`, or receipt valid
- `1`: `BLOCK`
- `2`: `UNKNOWN`
- `3`: infrastructure or verification error

Environment:

- `PREFLIGHT_API_BASE`: defaults to `https://api.usepreflight.xyz`
- `PREFLIGHT_WALLET_KEY`: alternative to `--wallet-key`
