# PreFlight Main Promotion and Old Deployment Cleanup

Generated: 2026-07-14 00:50 IST

## Executive result

PASS.

- Canonical branch `release/preflight-v4-canonical` was merged into `main` through PR #1.
- `origin/main` contains canonical commit `08bddd6282ce357ebd25adf462a963e039942a6b`.
- Obsolete Vercel deployment behind `https://preflight-release-gate.vercel.app` was removed.
- Current frontend `https://preflight-web-bice.vercel.app` remains live.
- Backend `https://api.usepreflight.xyz` remains healthy and still serves canonical runtime build SHA `08bddd6282ce357ebd25adf462a963e039942a6b`.
- No OKX listing activation, DNS change, paid production check, CLI publication, product-scope change, or runtime redeploy was performed.

## 1. Repository promotion

Repository:

```text
https://github.com/Vinaystwt/preflight.git
```

Promotion PR:

```text
https://github.com/Vinaystwt/preflight/pull/1
```

Source branch:

```text
release/preflight-v4-canonical
08bddd6282ce357ebd25adf462a963e039942a6b
```

Target branch before merge:

```text
origin/main
931ba59d84559b5de31c403c034b839cd6292554
```

Merge commit:

```text
0da16aef60fd920532b848c21a9d6b97319d68e9
```

Merge method:

```text
GitHub merge commit via gh pr merge --merge
```

The release branch was kept as a reference branch.

## 2. Pre-merge checks

Confirmed before merge:

```text
git status --short: clean
origin/release/preflight-v4-canonical: 08bddd6282ce357ebd25adf462a963e039942a6b
local release/preflight-v4-canonical: 08bddd6282ce357ebd25adf462a963e039942a6b
origin/main: 931ba59d84559b5de31c403c034b839cd6292554
```

GitHub PR status:

```text
mergeStateStatus: CLEAN
mergeable: MERGEABLE
checks: no GitHub checks configured/reported
```

Required verification therefore relies on the canonical-lock validation and the local/prod checks already run:

```text
Backend: typecheck/build/tests passed; 79 passed / 8 skipped
Targeted CORS public-routes test: 5 passed
Frontend: lint/build/typecheck passed
Frontend Playwright: 312 passed
Production backend/frontend smoke: passed
```

## 3. PR diff review

Reviewed full PR diff from `origin/main...origin/release/preflight-v4-canonical`.

Findings:

- Secrets: no raw runtime secret values found. Keyword scan hits were variable names, fixture/test terminology, or documentation concepts such as `privateKey`, `capability`, `Authorization`, and `PAYMENT-SIGNATURE`.
- Generated files: no tracked `.next`, `node_modules`, `test-results`, `playwright-report`, or `frontend-v3/tests/shots`.
- Obsolete frontend source: not present as a full source tree.
- Audit artifacts: no `preflight-audit-artifacts/` files in the PR.
- Expected archival artifact: historical `archive/frontend-efis-rejected.bundle` was already part of the prior approved archival posture.
- Unexpected product changes: none beyond the canonical Release Gate v4 source already locked and deployed.

## 4. Main branch state after merge

After merge and fast-forwarding local `main`:

```text
origin/main: 0da16aef60fd920532b848c21a9d6b97319d68e9
main contains canonical commit 08bddd6282ce357ebd25adf462a963e039942a6b: yes
```

This report file is a post-merge documentation artifact and does not change runtime source behavior.

## 5. Obsolete Vercel deployment cleanup

Inspected obsolete URL:

```text
https://preflight-release-gate.vercel.app
```

Vercel inspection showed it was not the current frontend project:

```text
Project: preflight-release-gate
Deployment: dpl_Bs4rg3GLZFHEmdZL27uiXdas8y4j
Deployment URL: preflight-release-gate-a5escsbyo-vinaystwts-projects.vercel.app
Aliases:
  preflight-release-gate.vercel.app
  preflight-release-gate-vinaystwts-projects.vercel.app
  preflight-release-gate-vinaystwt-vinaystwts-projects.vercel.app
```

Current frontend project was separately confirmed:

```text
Project: preflight-web
Deployment: dpl_sc1sJb3hyB5KowVtYPX6zkCk2az3
Aliases:
  preflight-web-bice.vercel.app
  preflight-web-vinaystwts-projects.vercel.app
  preflight-web-vinaystwt-vinaystwts-projects.vercel.app
```

Cleanup action performed:

```bash
vercel remove dpl_Bs4rg3GLZFHEmdZL27uiXdas8y4j --yes
```

Result:

```text
Removed 1 deployment:
preflight-release-gate-a5escsbyo-vinaystwts-projects.vercel.app
```

Post-cleanup verification:

```text
https://preflight-release-gate.vercel.app -> 404 DEPLOYMENT_NOT_FOUND
https://preflight-release-gate-vinaystwts-projects.vercel.app -> 404 DEPLOYMENT_NOT_FOUND
https://preflight-web-bice.vercel.app -> 200
https://api.usepreflight.xyz/health -> 200
```

No `preflight-web`, `preflight-web-bice.vercel.app`, or `api.usepreflight.xyz` alias was removed or modified.

## 6. Backend verification

Verified after cleanup:

```text
GET https://api.usepreflight.xyz/health
200 {"ok":true,"build_sha":"08bddd6282ce357ebd25adf462a963e039942a6b","db":"ok","settlement_listener":"idle","release_reconciliation":"idle"}
```

`readyz` is also verified in final command output after this report is committed.

No backend redeploy was performed because the merge did not create a runtime deployment mismatch.

## 7. Frontend verification

Verified after obsolete-deployment removal:

```text
https://preflight-web-bice.vercel.app -> 200
```

Current Vercel inspection:

```text
Project: preflight-web
Deployment: dpl_sc1sJb3hyB5KowVtYPX6zkCk2az3
readyState: READY
```

Critical-route verification is recorded in final command output after this report is committed.

No frontend redeploy was performed because the merge did not create a runtime deployment mismatch.

## 8. Dependency security triage

Command:

```bash
cd frontend-v3
npm audit --json
```

Summary:

```text
moderate: 2
high: 0
critical: 0
```

### Finding A: postcss

Package:

```text
postcss
```

Dependency path:

```text
frontend-v3 -> next@15.5.20 -> postcss@8.4.31
```

Dependency type:

```text
Transitive production dependency, pulled by direct production dependency next.
```

Advisory:

```text
GHSA-qx2v-qp2m-jg93
PostCSS has XSS via unescaped </style> in CSS stringify output
Severity: moderate
Affected range: <8.5.10
```

Reachable impact:

```text
Low-to-moderate for current PreFlight usage. The app does not expose user-authored CSS stringify as a public feature; exposure is primarily through build/tooling paths controlled by repository source. Still worth tracking because Next embeds the vulnerable version.
```

Safe patched version:

```text
postcss >= 8.5.10
```

Expected regression risk:

```text
Unknown if forced through npm overrides because next@15.5.20 and next@latest both declare postcss 8.4.31. A forced transitive override could affect Next build internals and requires a full frontend regression pass.
```

Action:

```text
No patch applied in this run.
```

Reason:

```text
npm audit reports fixAvailable via next@9.3.3 with isSemVerMajor=true, which is not a safe forward patch for this app. npm view next@latest still reports dependencies.postcss=8.4.31, so a normal safe Next patch was not available at inspection time.
```

### Finding B: next

Package:

```text
next
```

Dependency path:

```text
frontend-v3 -> next@15.5.20
```

Dependency type:

```text
Direct production dependency
```

Advisory:

```text
Moderate via embedded postcss advisory GHSA-qx2v-qp2m-jg93
```

Reachable impact:

```text
Inherited from postcss. No separate direct Next advisory was shown in the audit JSON.
```

Safe patched version:

```text
No safe patched Next version identified. npm view next@latest returned 16.2.10, but next@latest still declares postcss 8.4.31.
```

Expected regression risk:

```text
High for a major Next upgrade during a promotion/cleanup task; not authorized without a dedicated upgrade/test window.
```

Action:

```text
No patch applied.
```

## 9. Tests run

No dependency patch was applied, so the full frontend suite was not rerun in this cleanup step.

Verification relied on:

- canonical-lock full test evidence;
- PR mergeability/no configured CI checks;
- live backend/frontend smoke after merge and obsolete-deployment cleanup;
- npm audit inspection.

## 10. Remaining risks

1. Frontend npm audit still reports two moderate findings through Next's embedded PostCSS dependency.
2. Vercel project `preflight-release-gate` may still exist as an empty project even though its active obsolete deployment was removed. Its public obsolete URLs now return 404.
3. GitHub has no required CI checks configured for this repository; local/prod validation remains the proof path.

## 11. Exact next manual action

Recommended next manual action:

```text
Configure GitHub branch protection / required checks for main so future promotions cannot merge without automated backend and frontend verification.
```

Do not activate ASP #5161 until the operator explicitly starts the listing activation task.

