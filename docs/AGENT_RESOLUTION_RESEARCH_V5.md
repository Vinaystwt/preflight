# Agent-resolution research — v5

Verified 2026-07-17 using the official OnchainOS CLI installed on the
operator workstation.

## Authoritative read commands

```sh
onchainos agent get-agents --agent-ids 2013
onchainos agent service-list --agent-id 2013
```

The first command returned the Agent profile fields `agentId`, `name`,
`profileDescription`, `categoryCode`, `statusLabel`,
`approvalDisplayStatus`, and `serviceList`. The second returned service
records with `id`, `serviceName`, `serviceType`, `fee`, `endpoint`, and
`contractAddress`. Agent `2013` produced a profile and 80 services during
the read-only check.

The production image pins the official v4.2.5 Linux-musl CLI release from
[OKX's onchainos-skills releases](https://github.com/okx/onchainos-skills/releases/tag/v4.2.5), checksum verified in the Dockerfile.

## HTTP/API finding

The CLI's observed registry reads are session-bearer protected. A direct
unauthenticated request to the observed listing endpoint returned the OKX
access-token error rather than public listing data. PreFlight deliberately
does not invent a public registry API: `src/resolve/agent.ts` shells out to
the CLI and preserves every returned field's provenance.

## Runtime limitation and defensive choice

The Railway service contains the pinned executable but not an authenticated
OnchainOS CLI session. It can serve the 15-minute PostgreSQL cache populated
by an authenticated operator-run scan. When the cache is cold or expired,
the public resolver returns `AGENT_DISCOVERY_UNAVAILABLE`; paid
`verify_release` accepts a caller-provided `listing_override` instead of
fabricating listing data. This is intentionally fail-closed.
