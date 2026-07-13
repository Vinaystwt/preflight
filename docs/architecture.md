# Architecture

PreFlight is a Fastify backend, a hosted Next.js web app, a hosted MCP endpoint, and a small CLI package.

```mermaid
flowchart LR
  Browser[Web app] --> API[Fastify API]
  Agent[MCP client] --> MCP[Streamable HTTP MCP]
  CLI[CLI] --> API
  MCP --> API
  API --> Seller[x402 seller]
  API --> Discovery[Discovery + safe egress]
  API --> Buyer[Bounded buyer proof]
  Discovery --> Target[Target service]
  Buyer --> Target
  Seller --> X402[x402 facilitator / X Layer]
  Buyer --> X402
  API --> Engine[Criterion engine]
  Engine --> DB[(Postgres)]
  API --> Signer[Ed25519 receipt signer]
  Signer --> Proof[Receipts, badges, gallery]
```

The release decision is deterministic for a given observed snapshot and manifest. The service prefers explicit `UNKNOWN` states over unsafe inference.
