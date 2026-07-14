# Security

PreFlight is a verifier for paid agent services. It does not custody user funds, and production secrets are supplied only through runtime environment variables or platform secret storage.

## Reporting

Please report suspected vulnerabilities privately to the repository owner. Do not open public issues that include secrets, private endpoints, capability tokens, payment credentials, or exploit details.

## Public review boundary

This repository is source-available for review. It intentionally excludes private operational artifacts, production secrets, database exports, deployment logs, and historical internal handoff material.

## Local safety

- Never commit `.env` files, `.npmrc`, private keys, wallet keys, database URLs, or capability tokens.
- Use `.env.example` only as a placeholder reference.
- Do not run paid production checks from tests or CI.
- Do not add deployment credentials to GitHub Actions.

## Supported surfaces

- Production web: `https://usepreflight.xyz`
- Production API: `https://api.usepreflight.xyz`
- npm CLI: `@vinaystwt/preflight-cli`
