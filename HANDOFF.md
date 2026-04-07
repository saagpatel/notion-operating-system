# Notion Operating System Handoff

## Current repo state

- Repo: `/Users/d/Notion`
- Remote: `saagpatel/notion-operating-system`
- Branch: `main`
- Package version: `0.2.0`
- Package posture:
  - GitHub-installable
  - not published to npm
  - root toolkit first, `./advanced` secondary and repo-specific

## Structural work completed

The repo has completed the Phase 1 through Phase 10 cleanup and product-shape program:

1. CI, runtime config, env guidance, doctor, and package identity cleanup
2. shared CLI, help output, standardized flag parsing, onboarding docs, and wrapper compatibility
3. workspace profiles, profile portability, installable `notion-os` bin, and core versus advanced package separation
4. shared command observability, stronger verification, built-package coverage, and git-hook hygiene
5. advanced workflow hardening for governance, provider-edge, webhook, and rollout flows
6. script reduction and shared CLI coverage for durable audit and validation commands
7. deeper observability and operator diagnosis with recent-run inspection
8. profile portability, bootstrap, diff, clone, upgrade, and config lifecycle support
9. product-shape cleanup, modern npm aliases, and internal utility quarantine
10. GitHub installability plus manual release readiness

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

## Remaining backlog

- no required structural phase remains after Phase 10
- current follow-up work is operational maturity:
  - dependency review and override cleanup as upstream fixes land
  - continued docs accuracy
  - sandbox smoke rehearsal discipline for risky advanced workflows
  - optional future public npm distribution only if explicitly desired later
- the recurring maintenance cadence now lives in `docs/maintenance-playbook.md`
- the sandbox rehearsal workflow now lives in `docs/sandbox-rehearsal-runbook.md`

## Known assumptions

- compatibility remains the default: legacy npm scripts still exist where the repo intentionally preserves them
- shared run summaries improve logs first and do not intentionally break existing JSON stdout contracts
- secrets remain operator-managed in local env files and must never be committed
- profile portability stays preview-first and never exports or overwrites live secret values
- the current script-surface source of truth lives in `docs/script-surface-classification.md`
