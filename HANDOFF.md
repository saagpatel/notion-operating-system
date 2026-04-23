# Notion Operating System Handoff

## Current repo state

- Repo: `/Users/d/Notion`
- Package version: `0.2.0`
- Package posture:
  - GitHub-installable
  - not published to npm
  - root toolkit first, `./advanced` secondary and repo-specific
  - shared CLI is the preferred operator surface; direct source entrypoints remain for compatibility only
- Repo-state note:
  - do not treat this file as the source of truth for the current branch or working tree
  - check `git status --short --branch` when you need live repo state
  - the broad cleanup and hardening work landed on `main` on 2026-04-17; treat any future work as normal product or maintenance follow-through, not as an in-progress rescue branch
  - the restart docs were refreshed again after the final confidence pass on 2026-04-17 so they describe the merged repo state, not the pre-merge branch state
  - the 2026-04-23 remediation pass repaired the `--dry-run` CLI alias, bridge-db MCP structured-result parsing, bridge-db `--db-path` forwarding, and the two primary-profile local-provider source rows; that work is merged on `main`
  - the 2026-04-23 dependency cleanup merged the GitHub Actions, production dependency, TypeScript/Node types, and Vitest updates; `dotenv` 17 output is silenced through the repo loader so JSON CLI output stays parseable
  - the 2026-04-23 branch cleanup deleted fully merged stale remote refs and local feature refs; only `origin/main` remains as a remote branch after pruning

## Structural work completed

The repo has completed the Phase 1 through Phase 9 cleanup and product-shape program, with Phase 10 work active but not yet closed in the roadmap:

1. CI, runtime config, env guidance, doctor, and package identity cleanup
2. shared CLI, help output, standardized flag parsing, onboarding docs, and wrapper compatibility
3. workspace profiles, profile portability, installable `notion-os` bin, and core versus advanced package separation
4. shared command observability, stronger verification, built-package coverage, and git-hook hygiene
5. advanced workflow hardening for governance, provider-edge, webhook, and rollout flows
6. script reduction and shared CLI coverage for durable audit and validation commands
7. deeper observability and operator diagnosis with recent-run inspection
8. profile portability, bootstrap, diff, clone, upgrade, and config lifecycle support
9. product-shape cleanup, modern npm aliases, and internal utility quarantine
10. early Phase 10 signal wiring, morning-brief, orphan classification, trend analysis, and bridge-db integration work is now present in the codebase, with the `notification-hub` and `repo-auditor` adapters proven in sandbox and primary-profile dry-run mode; remaining Phase 10 work is now operator-surface productization and signal-quality cleanup

## Post-Phase-10 hardening track

The repo now also includes the operational hardening pass that landed after Phase 10:

- protected-branch posture for `main` with pull-request-first governance
- CI lanes for:
  - workflow linting
  - source quality gates
  - built CLI smoke
  - packed-install smoke
  - git-ref install smoke
  - fresh workspace verification
- scheduled dependency hygiene via weekly audit workflow plus Dependabot
- explicit sandbox-profile discipline for risky advanced workflow changes
- sandbox doctor enforcement for token isolation, target isolation, and env-path masking
- refreshed docs around consumer install modes, release readiness, and merged-main reality

## Current cleanup state

The repo also completed a broad audit-and-prune pass focused on maintainability, command-surface clarity, and safer internal tooling behavior.

What changed materially:

- maintenance-only and historical utilities were pushed behind `src/internal/notion-maintenance/` or `src/internal/portfolio-audit/` instead of living beside durable operator modules
- the shared CLI and modern npm aliases are now the intended public operator surface
- legacy `portfolio-audit:*` aliases still exist where compatibility matters, but they now point either to the shared CLI or to explicitly internal maintenance entrypoints
- public npm scripts no longer point directly at `src/notion/*.ts`
- several internal maintenance scripts now support safe `--help` inspection and no longer perform real work just because they were probed
- Vercel rollout readiness is now a real shared rollout command via `rollout:vercel-readiness`
- historical schema migration utilities remain available, but are now clearly marked as historical/internal rather than part of the durable operator surface

Current confidence state:

- package surface, script surface, and docs are much more aligned than before this cleanup track
- the repo has passed repeated `npm test`, `npm run typecheck`, and `npm run build` verification loops after these changes
- the merged 2026-04-17 confidence pass also verified `npm run verify` end to end with 44 passing test files and 284 passing tests
- the 2026-04-23 remediation pass verified `npm run typecheck`, `npm test` with 44 passing files and 299 passing tests, `npm run build`, `npm run dry-run:example`, `npm run bridge-db:status`, `npm run bridge-db:sync`, `npm run signals:seed-mappings -- --live --limit 2`, and both provider-specific signal sync dry-runs
- the 2026-04-23 dependency cleanup verified `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:built-cli`, `npm run smoke:packed-install`, `npm run smoke:git-install`, `npm run dry-run:example`, `npm run bridge-db:status`, `npm run bridge-db:sync`, both provider-specific signal sync dry-runs, and `npm audit --json`
- the 2026-04-23 post-merge confidence pass verified a fresh clone from GitHub with `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:built-cli`, `npm run smoke:packed-install`, and `npm run smoke:git-install`
- hosted Dependabot checks ran successfully on the final merged dependency heads; Dependabot's `uuid` advisory workflow still fails as expected because of the accepted `exceljs -> uuid` exception
- a 2026-04-17 confidence pass also verified:
  - `npm run control-tower:trend-analysis` returns a clean dry-run report
  - `npm run governance:orphan-classify` returns a dry-run classification table
  - `npm run bridge-db:status` returns a healthy read-only bridge-db snapshot
- `npm run signals:morning-brief` now returns a clean dry-run report
- the `notification-hub` and `repo-auditor` adapters are implemented, sandbox-proven, and now have active primary-profile local-provider source rows
  - manual seeds may omit `localProjectId` for those global providers when they include a stable `identifier`
  - `notification-hub` is intentionally project-only in v1 and skips null or unmatched project events with note counts
  - `repo-auditor` now resolves through active GitHub source identifiers first, then project-title fallback
- the sandbox profile provider config now includes `notification_hub` and `repo_auditor`, and the Phase 5 live schema now includes `Notification Hub`, `Repo Auditor`, `Event Log`, `Notification`, and `Audit` select options
- sandbox live proof on 2026-04-17 now includes:
  - global source rows for `Notification Hub - Event Log` and `GithubRepoAuditor - Audit Reports`
  - one bounded `Notification Hub` event written through the real sync path
  - one bounded `Repo Auditor` audit event written through the real sync path
  - matching `External Signal Sync Runs` rows for both providers
  - `signals:morning-brief -- --profile sandbox` now surfaces the notification-hub proof event
- primary-profile dry-runs on 2026-04-23 now exercise both providers with `syncedSourceCount: 1`
  - `notification_hub` still reports data-quality skips for one event with no project value and 19 unmatched project names
  - `repo_auditor` reports the current audit input date as `2026-03-29` with 25 audits in file
- `npm audit --json` currently reports the accepted moderate `exceljs -> uuid` exception; do not downgrade `exceljs` for that advisory
- `governance:orphan-classify --live --create-packets` now builds structured `work_packets` records with execution fields and `Local Project` relations instead of generic markdown-only packet publishes
- `governance:orphan-classify` now also supports an approval-backed orphan flow via `--request-approval`, optional `--approve`, and `--create-approved-packets`
- `notion-os --profile sandbox doctor --json` now passes all sandbox isolation checks
- `npm run sandbox:smoke` now passes end to end
- the sandbox GitHub lane is now sufficiently proven in live mode against `portfolio-actuation-sandbox`
  - `github.create_issue` created issue `#3`
  - `github.add_issue_comment` created comment `4266814277` on issue `#3`
  - `github.update_issue` updated issue `#3`
- `src/notion/local-portfolio-actuation.ts` now normalizes quoted GitHub App PEM values before signing, closing the private-key decoding failure that initially blocked live sandbox runs
- `src/notion/operational-rollout.ts` now includes a generic `ensureGitHubActionRequest(...)` helper so non-create GitHub action requests no longer require one-off eval scripts
- no obvious structural cleanup pass remains; further work should be treated as normal maintenance or product work, not rescue-level repo cleanup

## What this cleanup actually settled

The broad cleanup is no longer an active project in itself. It settled these repo-shape questions:

- the shared CLI plus modern npm aliases are the public operator surface
- internal maintenance and historical migration tools now live behind `src/internal/*`
- sandbox proving is trustworthy again for dry-run and live-safe rehearsal
- the GitHub action lane is proven deeply enough that the next work should be productization, not more sandbox mutation depth
- restart docs now anchor to merged reality instead of branch-local cleanup notes

## Canonical local verification

Run these before shipping or after pulling onto a new machine:

```bash
npm run typecheck
npm test
npm run build
npm run verify
npm run verify:fresh-clone
npm run release:prepare
npm run doctor -- --json
node dist/src/cli.js --help
```

## Useful operator commands

```bash
notion-os --help
notion-os doctor
notion-os profiles show
notion-os profiles diff --against-profile default
notion-os profiles clone --source default --target sandbox --write
notion-os profiles bootstrap --target sandbox --write
notion-os --profile sandbox profiles show
notion-os --profile sandbox doctor
npm run sandbox:smoke
notion-os logs recent
npm run control-tower:sync
npm run governance:audit
npm run signals:sync
npm run rollout:vercel-readiness
npm run verify
npm run release:prepare
npm run verify:fresh-clone
```

## Governance and release posture

- `main` is intended to stay protected and pull-request-only
- required checks stay mandatory before merge
- required approval count is intentionally `0` for now because the repo currently operates as a solo-maintainer system
- merge commits remain the preferred merge strategy so the repo history stays readable
- `npm run release:prepare` is the mandatory local release gate
- the `Release` GitHub Actions workflow stays manual through `workflow_dispatch`
- release inputs should match the version already set in `package.json`

## Sandbox profile rule

Use a `sandbox` profile as the default proving ground before live changes that touch:

- `control-tower`
- `signals`
- `governance`
- `rollout`
- profile import, export, clone, bootstrap, or upgrade flows

Stay dry-run first there unless the operator is explicitly rehearsing a live path.

The repo now includes the tracked `sandbox` profile descriptor and profile-owned JSON files, and the intended steady state is an isolated live sandbox workspace. The local operator still needs to supply `.env.sandbox`, which must remain untracked. Shell-level overrides like `NOTION_DESTINATIONS_PATH` still take precedence over profile descriptor paths.

Important safety note: `notion-os --profile sandbox doctor` is the first proof gate and `npm run sandbox:smoke` is the fuller operational rehearsal. The smoke path runs from a temporary workspace copy so repo-tracked files do not get rewritten while the sandbox sequence exercises dry-run, validation, live-safe sync, and recent-log inspection. If the doctor reports token overlap, target overlap, or env-path masking, fix the sandbox before any live rehearsal.

Sandbox local reality from the 2026-04-17 confidence pass:

- `notion-os --profile sandbox doctor --json` now passes `sandbox-path-overrides`, `sandbox-token-isolation`, and `sandbox-target-isolation`
- `npm run sandbox:smoke` now passes end to end
- the sandbox lane is operationally trustworthy again for dry-run and live-safe rehearsal
- the sandbox profile-owned Vercel manual seeds and rollout targets were trimmed to stop pointing at primary-profile project IDs that do not exist in the sandbox workspace

## Remaining backlog

- no required structural phase remains after Phase 10
- current follow-up work is operational maturity:
  - Phase 10 completion and signal-layer productization
  - signal-quality cleanup for `notification-hub` unmatched/null project events and aging `repo_auditor` report input
  - dependency review and the documented `exceljs -> uuid` audit exception as upstream fixes land
  - continued docs accuracy
  - sandbox smoke rehearsal discipline for risky advanced workflows
  - packaging the new generic GitHub action-request helper into whichever higher-level workflows should own comment/update request creation next
  - optional future public npm distribution only if explicitly desired later
- the recurring maintenance cadence now lives in `docs/maintenance-playbook.md`
- the sandbox rehearsal workflow now lives in `docs/sandbox-rehearsal-runbook.md`

## Best next work

If resuming from here, do not start with another repo cleanup pass.

Start with one explicit Phase 10 product slice:

1. clean up signal quality: map or suppress noisy `notification_hub` project misses and refresh the `repo_auditor` audit input if it should be current
2. productize the operator surface on top of the now-proven adapters:
   morning-brief prioritization, command-center synthesis, or a tighter governed orphan routine

The preferred first move is no longer adapter implementation for `notification-hub`, `GithubRepoAuditor`, or `bridge-db`. The best next move is signal-quality cleanup, then operator-surface productization on top of the proven signal lanes.

## Known assumptions

- compatibility remains the default: legacy npm scripts still exist where the repo intentionally preserves them
- shared run summaries improve logs first and do not intentionally break existing JSON stdout contracts
- secrets remain operator-managed in local env files and must never be committed
- profile portability stays preview-first and never exports or overwrites live secret values
- the current script-surface source of truth lives in `docs/script-surface-classification.md`

## Best restart point

If work resumes later, re-ground in this order:

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/notion-roadmap.md`
4. `docs/script-surface-classification.md`
5. `README.md`

The correct current posture is:

- the repo is structurally healthy
- the cleanup and command-surface simplification pass is complete
- several Phase 10 dry-run lanes are already usable (`trend-analysis`, `orphan-classify`, `bridge-db status`, `morning-brief`, `signals sync --provider notification_hub`, `signals sync --provider repo_auditor`)
- the sandbox proving lane is healthy again and `npm run sandbox:smoke` passes
- the `notification-hub` and `repo-auditor` adapters are proven in sandbox live mode and now exercise primary-profile source rows in dry-run mode
- the next meaningful work should start from one explicit Phase 10 productization slice rather than another broad cleanup sweep
