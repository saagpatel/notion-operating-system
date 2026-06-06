# Notion Operating System Handoff

## Current state

Latest checkpoint: 2026-06-06.

The repo is not currently a clean `main` checkout. At this checkpoint, `git fetch --prune origin` had been run and the active branch was `codex/fix/notion-autolink-markdown-normalization`, tracking `origin/main` and reporting `ahead 5, behind 2`. The active operating phase remains Phase 12: managed write reliability and daily-driver hardening.

Repo-state note: do not treat this file as the source of truth for the current branch or working tree. Check `git status --short --branch` before acting on branch state.

The June 6 audit found the project operationally healthy but not ready to treat as settled branch truth:

- Local validation passed across TypeScript, tests, build, CLI smoke checks, governance health, doctor checks, destination checks, view schema validation, Codex evals, and hook/MCP checks.
- The working tree contained four uncommitted code/test files: `src/notion/external-signal-sync.ts`, `src/notion/weekly-refresh.ts`, `tests/external-signal-sync.test.ts`, and `tests/weekly-refresh.test.ts`.
- Those active edits appear focused on stored external-signal brief retry hardening and live external-signal project-page batch splitting. Review and verify them before staging or committing.
- `npm audit --json` currently reports a moderate `hono` advisory path through `@modelcontextprotocol/sdk -> hono@4.12.18`. Open Dependabot PR #99 updates `hono`; PR #94 updates `tsx`.
- The old ExcelJS/UUID audit exception is no longer the current npm audit story and should not be used as the active security posture.
- A fast weekly dry-run for 2026-06-06 completed with `failed=0` and `partial=0`, but reported `needsLiveWrite=true` across `control-tower-sync`, `execution-sync`, `intelligence-sync`, and `review-packet`. No live Notion writes were run during the audit.

## Verified today

- `npm run typecheck` passed.
- `npm test` passed with 59 test files and 426 tests.
- `npm run build` passed.
- `npm run smoke:built-cli`, `npm run smoke:packed-install`, and `npm run smoke:git-install` passed.
- `git diff --check` passed.
- `npm run governance:health-report` reports healthy governance and actuation posture.
- `npm run doctor -- --json`, `npm run destinations:check`, and all configured `*:views-validate` checks passed.
- Codex evals passed 19/19, and the hook/MCP bundle checks passed.
- `gh run list --branch main` showed the current `main` CI/Dependabot runs green after fetch.

## Active follow-up

1. Reconcile the branch with `origin/main` before shipping. Preserve the current dirty code/test changes; do not reset or overwrite them.
2. Review the active code/test changes, run focused verification, then decide whether they should be committed on the current branch.
3. Merge or otherwise handle Dependabot PR #99 to clear the current `hono` advisory path; review PR #94 separately.
4. If the user approves live Notion repair, run each drifting weekly lane as targeted dry-run -> live -> same dry-run. Do not use broad weekly live refresh as the repair tool.
5. Use `npm run sandbox:smoke` before risky advanced workflow changes that touch control-tower, signals, governance, rollout, or profile portability paths.

## Cross-repo operator reminders

The current Daily Focus and packet queues should be re-checked from live Notion before acting. This file is only a restart pointer, not live truth for other workspaces.

## Restart order

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/notion-roadmap.md`
4. `README.md`
5. `git status --short --branch`
6. `npm run governance:health-report`
7. Targeted dry-runs for the lane you intend to repair or ship
