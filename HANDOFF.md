# Notion Operating System Handoff

## Current repo state

- Repo: `/Users/d/Notion`
- Remote: `saagpatel/notion-operating-system`
- Branch: `codex/phase-6-cli-coverage`
- Base remote commit on `main`: `39e4cdd`
- The worktree now contains the accumulated local Phase 1 through Phase 6 changes on top of that base

## Completed roadmap phases

### Phase 1

- GitHub Actions CI for `npm ci`, `npm run typecheck`, and `npm test`
- shared runtime config and environment validation
- expanded `.env.example`
- `doctor` command
- package identity aligned to `Notion Operating System`

### Phase 2

- shared CLI registry and central command runner
- built-in help and standardized flag parsing
- compatibility wrappers for covered legacy entrypoints
- onboarding docs, contributor guide, and architecture overview

### Phase 3

- workspace profiles and profile-aware path resolution
- profile bundle import/export and migration commands
- installable `notion-os` package bin
- clearer core package exports vs `./advanced`

### Phase 4

- shared command lifecycle logging with:
  - `command_started`
  - `command_completed`
  - `command_failed`
- shared run summary recording for the covered CLI workflow families
- richer Notion HTTP retry, timeout, and failure logging
- canonical `npm run verify` release gate
- CI build coverage plus built-CLI smoke check
- optional pre-commit hook flow in `.githooks/`
- updated operator docs around profiles, verify, logs, and hooks

### Phase 5

- targeted hardening tests for:
  - `action-runner`
  - `action-dry-run`
  - external-signal/provider edge handling
  - webhook shadow/reconcile behavior
  - rollout follow-up sequencing and failure isolation
- low-risk internal helpers to keep advanced failure-path behavior testable without broad CLI redesign
- safer webhook helper imports by guarding direct execution in:
  - `webhook-shadow-drain`
  - `webhook-reconcile`
- stronger built-package smoke verification via `npm run smoke:built-cli`
- `npm run verify` now covers:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run smoke:built-cli`
- CI now runs the stronger built CLI smoke script instead of only `node dist/src/cli.js --help`

### Phase 6

- migrated durable audit and validation commands into the shared CLI under the existing families:
  - `governance audit`
  - `governance views-validate`
  - `governance actuation-audit`
  - `governance webhook-shadow-drain`
  - `governance webhook-reconcile`
  - `execution views-validate`
  - `intelligence views-validate`
  - `signals views-validate`
  - `signals provider-expansion-audit`
- kept the old script entrypoints as compatibility wrappers so existing npm scripts still work
- documented the shared-cli vs wrapper vs one-off script split in `docs/script-surface-classification.md`
- expanded CLI help, wrapper coverage, and built-cli smoke checks for the migrated command set

### Phase 7

- enriched shared run summaries with:
  - `status`
  - `warningCategories`
  - `failureCategories`
- standardized the first bounded observability taxonomy for warnings and failures
- improved HTTP retry and timeout classification so recovered retries and terminal failures show up more clearly in run logs
- added `logs recent` as a read-only operator command for inspecting recent command outcomes from the active log directory
- upgraded representative advanced workflows so their run summaries are more explicit about warnings, partial success, and diagnosis

## Verification checklist for this branch

Run these before landing or after pulling onto a new machine:

```bash
npm run typecheck
npm test
npm run build
npm run verify
npm run doctor -- --json
node dist/src/cli.js --help
```

## Useful operator commands

```bash
notion-os --help
notion-os profiles show
npm run doctor
npm run verify
npm run hooks:install
```

## Remaining backlog after Phase 7

- The concrete post-Phase-4 repo roadmap now lives in `docs/repo-post-phase4-roadmap.md`
- Recommended next repo phase: **Phase 8 - Profile Portability and Config Lifecycle**
- Later roadmap buckets include:
  - profile portability and config lifecycle
  - product-shape cleanup
  - optional public release readiness

## Verified on this branch

These should be rerun successfully before landing the Phase 7 branch:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:built-cli
npm run verify
node dist/src/cli.js --help
node dist/src/cli.js logs recent --help
node dist/src/cli.js governance audit --help
node dist/src/cli.js signals sync --help
```

## Known assumptions and risks

- Compatibility remains the default: legacy npm scripts still exist and many excluded one-off scripts still lean on the older default-path assumptions
- The shared run summaries improve logs first; they do not intentionally change existing JSON stdout contracts
- Secrets still remain operator-managed in local env files and must never be committed
- The local README rewrite was preserved and extended instead of being replaced
- The current script surface classification lives in `docs/script-surface-classification.md`
- `logs recent` is the operator-facing entrypoint for recent run inspection in this phase
