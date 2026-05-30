# Notion Operating System Handoff

## Current state

Latest checkpoint: 2026-05-30.

The repo is on `main` after the dependency-maintenance PRs were merged and the local branch was fast-forwarded from `origin/main`. The active operating phase is Phase 12: managed write reliability and daily-driver hardening.

Repo-state note: do not treat this file as the source of truth for the current branch or working tree. Check `git status --short --branch` before acting on branch state.

The May 30 targeted maintenance pass repaired the live weekly operating surfaces without running a broad weekly live refresh:

- Review recovery was run live for 2026-05-30 and the follow-up dry-run reports 0 overdue reviews, 0 missing Next Move rows, and 0 missing Last Active rows.
- Control Tower sync was run live for 2026-05-30 and the follow-up dry-run reports 0 derived-row changes and 0 Command Center drift.
- Execution, Intelligence, and External Signals sync lanes were run as targeted `weekly-refresh --only ... --fast` live repairs with `--max-project-pages 119`; each follow-up dry-run reports clean.
- The current weekly page is `Week of 2026-05-25`, page ID `370c21f1-caf0-8145-b44b-ff0a118fea31`.
- Morning Brief and Daily Focus were repatched live after the weekly review page refresh. Daily Focus dry-run is clean and points at DevToolsTranslator, GPT_RAG, and Phantom Frequencies as the top Now items.
- `control-tower:managed-section-audit` finds the Daily Focus managed markers on the current weekly page and keeps the recommended write mode on markdown REST until block replacement is rollback-safe.
- Final weekly fast preflight reports 6 clean lanes and 0 drift after the Phase 12 Daily Focus preservation fix.
- Weekly managed-section preservation is now centralized in `WEEKLY_REVIEW_MANAGED_SECTIONS`, including External Signals, Morning Brief, Trend Analysis, and Daily Focus.

## Verified today

- `npm ci` completed and ran the prepare/build step successfully.
- `npm run typecheck` passed.
- `npm test` passed with 59 test files and 401 tests.
- `npm audit --json` now reports only the known moderate `exceljs -> uuid` exception; the prior high `tmp` and moderate `qs` advisories were cleared by merged Dependabot PRs.
- `gh pr list --state open` returns no open PRs.
- GitHub CI for the latest main merge commit is green. The Dependabot advisory workflow still fails on the accepted `uuid` path.

## Active follow-up

1. Use `npm run control-tower:operator-brief -- --today 2026-05-30 --packet-stale-days 14` to pick the next real product follow-through packet.
2. Current packet staleness remains the main operator queue: 8 stale packets and 8 at-risk packets, led by Nocturne, DevToolsTranslator, IncidentWorkbench, JobCommandCenter, and GPT_RAG.
3. Use targeted lane repair commands for narrow drift. Do not use broad weekly live refresh as the default repair tool.
4. Use `npm run sandbox:smoke` before risky advanced workflow changes that touch control-tower, signals, governance, rollout, or profile portability paths.

## Cross-repo operator reminders

The current Daily Focus queue points at DevToolsTranslator, GPT_RAG, Phantom Frequencies, Recall, and JobCommandCenter. Re-check those repos directly before acting; this file is only a pointer, not live truth for other workspaces.

## Restart order

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/notion-roadmap.md`
4. `README.md`
5. `npm run control-tower:operator-brief -- --today 2026-05-30 --packet-stale-days 14`
