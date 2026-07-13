# PreFlight CLI

Publish-ready v0.1.0 CLI for the PreFlight Release Gate.

```bash
preflight verify https://api.example.com/paid-route --wallet-key 0x... --json
```

Environment alternatives:

- `PREFLIGHT_API_BASE` defaults to `https://api.usepreflight.xyz`
- `PREFLIGHT_WALLET_KEY` can supply the x402 buyer key instead of `--wallet-key`

The CLI pays the PreFlight verification fee with the OKX x402 fetch wrapper, then prints the private capability URL and decision.
