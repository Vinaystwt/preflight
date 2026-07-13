# Deployment

Production surfaces:

```text
Backend: https://api.usepreflight.xyz
Web:     https://preflight-web-bice.vercel.app
MCP:     https://api.usepreflight.xyz/mcp
```

## Backend

Railway deploys the Fastify backend from the repository root. The runtime build SHA is exposed in:

```text
GET /health
GET /livez
GET /readyz
```

Migrations are additive and recorded in `schema_migrations`.

## Web

Vercel project:

```text
preflight-web
```

Project root:

```text
web
```

Production alias:

```text
https://preflight-web-bice.vercel.app
```

Do not create a new Vercel project for routine releases.
