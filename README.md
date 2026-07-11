# PreFlight backend

PreFlight is an x402-paid conformance service for OKX.AI Agent Service Providers. Paid execution is exposed as HTTP `POST /api/v1/*` routes; `/mcp` is free, discovery-only Streamable HTTP and returns paid-route pointers.

## Runtime

```sh
npm ci
npm run build
npm run migrate
npm start
```

The production URL is frozen at `https://api.usepreflight.xyz`. Railway builds the Dockerfile, runs `node dist/db/migrate.js` before deployment, and starts `node dist/server.js`.

## Badge link

A certified GO target can embed `https://api.usepreflight.xyz/badge/<target_id>.svg`. The SVG links to `https://api.usepreflight.xyz/r/<latest_report_id>` using an SVG anchor, so no separate landing-page route or query parameter is required. Unknown, ineligible, and non-GO targets return 404.

## Market scanner

The scanner accepts a JSON array or newline-delimited file of public HTTPS service endpoints. It runs transport, MCP, and x402 probes only; it never constructs a buyer or makes a paid replay.

```sh
npm run scan-market -- endpoints.json
```

Only GO endpoint URLs are emitted. Failing endpoint identities are excluded from aggregate output.
