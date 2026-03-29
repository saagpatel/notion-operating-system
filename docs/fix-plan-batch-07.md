# Batch 07 Completion Record

## 1. Executive summary

- Batch scope: `prompt-englab`, `SnippetLibrary`, `CryptForge`, `Chronomap`, `Echolocate`
- This record reflects the implementation pass completed on March 24, 2026 using the current batch artifacts plus the merged master fix plan as source of truth.
- Verified complete before implementation: none.
- Fixes completed in this chat:
  - `prompt-englab` local npm baseline restored and main correctness gates rerun successfully
  - `Chronomap` pnpm baseline restored; `typecheck` and `build` passed
  - `Echolocate` pnpm baseline restored; `lint`, `typecheck`, and `build` passed
  - `SnippetLibrary` remote debt rechecked; `origin` is already canonical and `legacy-origin` is already gone
  - `CryptForge` remote and branch truth rechecked; `origin` is already the only remote, local preflight still passes, and GitHub PR/workflow noise was classified
- Verified complete after implementation:
  - `Chronomap`
  - `Echolocate`
- Projects still with findings:
  - `prompt-englab`
  - `SnippetLibrary`
  - `CryptForge`
- Notion placement, duplicate-row posture, and active GitHub source-row posture stayed unchanged for the batch and remain governed by the already-verified batch/master audit state.

## 2. Projects with findings

### `prompt-englab`

- Solved baseline in this chat:
  - `npm ci`
  - `npm run prisma:generate`
  - `npm run typecheck`
  - `npm run lint -- --max-warnings 0`
  - `npx prettier --check .`
  - `npm run test -- --ci --coverage --passWithNoTests=false --detectOpenHandles`
  - `npm run build`
  - `npm audit --audit-level=high --omit=dev`
  - `npm run perf:bundle`
  - `npm run perf:build`
  - `npm run perf:assets`
  - `npm run perf:memory`
  - `npm run perf:summary`
- Corrected readiness truth:
  - the repo is no longer dependency-blocked
  - the main correctness gates pass locally on the current branch
  - finish-proof is still incomplete because `release:verify:readiness` fails at migration status
- Remaining findings:
  - `release:verify:readiness` fails without `DATABASE_URL`, and still fails with `DATABASE_URL=file:./dev.db` because Prisma migration status returns a schema engine error against the local SQLite datasource
  - `legacy-origin` was not removed because two local branches still track it and `origin` is not yet clearly canonical for those branch names

### `SnippetLibrary`

- Solved baseline before this implementation pass:
  - Swift dependency/build baseline was already healthy and no new evidence contradicted that
- Verified in this chat:
  - `origin` is the only configured remote
  - `legacy-origin` is already absent
  - the remaining issue is not setup health
- Remaining findings:
  - the dirty tree is still broad and needs a single bounded landing plan
  - blocker story should stay focused on scope control for the current codex branch, not on dependency or environment recovery

### `CryptForge`

- Verified in this chat:
  - `origin` is already the only configured remote
  - the current branch is already comparing against `origin/main`
  - `npm run verify:preflight` still passes locally
- Corrected Git/GitHub truth:
  - the old `legacy-origin` tracking problem is no longer present in the current local repo state
  - 2 open Dependabot PRs remain:
    - `#1` cargo `rustls-webpki` patch update
    - `#2` npm `rollup` patch update
  - the recent `ci-nightly` failures on March 22, 2026 and March 23, 2026 are both Windows `cross-platform-smoke` failures caused by `doctor-env` reporting `npm` as unavailable/unknown on the runner even after `npm ci` completed
- Remaining findings:
  - the folder path is still `/Users/d/Projects/Fun:GamePrjs/ CryptForge`, and the rename was not attempted because the repo is dirty and the move was not clearly lossless
  - the two Dependabot PRs still need an explicit merge-or-close decision
  - the `ci-nightly` Windows runner issue still needs a workflow or environment follow-up before nightly status can be treated as clean

## 3. Exact fixes needed

### Verified complete before implementation

- None.

### Fixes completed in this chat

- `prompt-englab`
  - restored the local npm baseline with `npm ci`
  - reran the main correctness gates successfully
  - reran the perf/finish tail successfully through `perf:summary`
  - replaced the stale install-blocked story with the current truth: main correctness gates pass locally, but release-readiness is still blocked at migration status
- `Chronomap`
  - restored the pnpm baseline with `pnpm install --frozen-lockfile`
  - reran `pnpm typecheck`
  - reran `pnpm build`
  - replaced the old install-state blocker with a clean local proof result
- `Echolocate`
  - restored the pnpm baseline with `pnpm install --frozen-lockfile`
  - reran `pnpm lint`
  - reran `pnpm typecheck`
  - reran `pnpm build`
  - replaced the old install-state blocker with a clean local proof result
- `SnippetLibrary`
  - rechecked remote truth and confirmed `legacy-origin` is already gone
  - preserved the existing dirty tree without widening it
  - kept the remaining story focused on scope control rather than setup health
- `CryptForge`
  - rechecked remote truth and confirmed `origin` is already canonical in the current local repo state
  - reran local preflight and confirmed the path warning is still advisory, not a local verification failure
  - reviewed the open Dependabot PRs and recent `ci-nightly` failures
  - classified the nightly failures as Windows workflow/environment follow-up, not as a newly reproduced local product blocker

### Remaining open items

- `prompt-englab`
  - make `release:verify:readiness` pass by fixing the Prisma migration-status path against the local datasource
  - repoint or retire the two local branches still tracking `legacy-origin`, then remove `legacy-origin`
- `SnippetLibrary`
  - break the current dirty tree into one clearly bounded execution slice or land it as one deliberate slice
- `CryptForge`
  - decide whether Dependabot PRs `#1` and `#2` should merge, close, or stay open
  - fix the Windows `doctor-env` / `npm` detection problem behind `ci-nightly`
  - rename the local folder only after the dirty tree can be moved losslessly

## 4. Recommended execution order

1. `prompt-englab`
   - highest-value remaining follow-up because release-readiness is the only thing still blocking a strong finish claim
2. `SnippetLibrary`
   - remaining risk is execution-slice sprawl rather than environment health
3. `CryptForge`
   - remaining work is mostly decision-heavy and workflow-heavy, not baseline recovery

## 5. Blockers

- `prompt-englab`
  - `release:verify:readiness` still fails at Prisma migration status, so finish-proof is not yet fully green
  - `legacy-origin` cannot be removed safely until the two local branches that still track it are repointed or intentionally retired
- `SnippetLibrary`
  - no setup blocker remains, but the dirty tree is still broad enough that scope-control follow-through is required before calling the repo slice clean
- `CryptForge`
  - the folder rename is still blocked by move risk while the worktree is dirty
  - the Windows `ci-nightly` failure remains open until the runner-side `npm` detection issue is corrected

## 6. Done definition

- This batch record is done when both batch-07 artifacts agree on the same post-implementation state.
- `verified_complete before implementation` remains empty.
- `fixes completed in this chat` remain explicit:
  - `prompt-englab` baseline restored and main correctness gates reproved
  - `Chronomap` cleared
  - `Echolocate` cleared
  - `SnippetLibrary` remote truth clarified
  - `CryptForge` remote truth and GitHub noise clarified
- `remaining open items` remain explicit:
  - `prompt-englab` release-readiness and legacy-remote retirement
  - `SnippetLibrary` scope-control cleanup
  - `CryptForge` PR/workflow/path follow-up
- `blockers that still require follow-up` remain explicit and are not collapsed back into the old install-state stories.
