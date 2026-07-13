# Development

## Backend

```bash
npm ci
npm run typecheck
npm run build
npm test -- --run
```

Run migrations:

```bash
npm run migrate
```

Start production build:

```bash
npm start
```

## Web

```bash
cd web
npm ci
npm run lint
npm run build
npx tsc --noEmit
npx playwright test --reporter=list
```

## CLI

```bash
npm run build --prefix packages/cli
(cd packages/cli && npm pack --dry-run)
```

The CLI package is prepared under `packages/cli`. npm publication depends on verified access to the intended npm scope.
