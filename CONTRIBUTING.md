# Contributing

PreFlight is currently source-available for review, but no reuse, modification, or redistribution license is granted unless a license file is added later.

Useful local checks:

```bash
npm ci
npm run typecheck
npm run build
npm test -- --run
```

Web checks:

```bash
cd web
npm ci
npm run lint
npm run build
npx tsc --noEmit
npx playwright test --reporter=list
```

CLI checks:

```bash
cd packages/cli
npm ci
npm run build
npm pack --dry-run --json
```

Please keep changes small, do not introduce production secrets, and do not add paid-production verification to CI.
