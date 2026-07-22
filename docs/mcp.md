# MCP

PreFlight exposes a hosted MCP server over Streamable HTTP:

```text
https://api.usepreflight.xyz/mcp
```

Installing the CLI is not required to use MCP.

## Client configuration

```json
{
  "mcpServers": {
    "preflight": {
      "url": "https://api.usepreflight.xyz/mcp"
    }
  }
}
```

## Discovery

`tools/list` is free and returns the available PreFlight service information.

The `verify_release` tool advertises the full input schema. The canonical generic-buyer request is:

```json
{ "endpoint": "https://public-service.example/path" }
```

`schema_version` is optional and defaults internally. `agent_id` may be used instead of `endpoint`, but callers must provide exactly one target.

## Paid tool behavior

The `verify_release` tool points agents to the paid HTTP surface:

```text
POST https://api.usepreflight.xyz/api/v1/verify-release
```

An unpaid call returns a structured pointer explaining that the tool is x402 paid and must be replayed through the paid endpoint with `PAYMENT-SIGNATURE`.

This keeps discovery safe while preserving the same settlement-before-publication behavior as the API route.

## Transport notes

- Transport: Streamable HTTP
- Accepts JSON and `text/event-stream` responses where applicable
- No local npm package is required for the hosted server
- Paid execution requires an x402-capable agent wallet
