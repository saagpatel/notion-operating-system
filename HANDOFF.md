# Notion Operating System Handoff

## Current state

Latest checkpoint: 2026-05-31.

The repo is on `main` and currently matches `origin/main`. The active operating phase is Phase 12: managed write reliability and daily-driver hardening.

Repo-state note: do not treat this file as the source of truth for the current branch or working tree. Check `git status --short --branch` before acting on branch state.

The May 31 targeted maintenance pass repaired the only live weekly operating drift without running a broad weekly live refresh:

- The initial May 31 weekly fast preflight found 5 clean lanes and 1 drift lane: `intelligence-sync`.
- `npm run maintenance:weekly-refresh -- --today 2026-05-31 --only intelligence-sync --fast --live --confirm-full-live --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` updated exactly 1 recommendation brief.
- The matching `intelligence-sync` dry-run returned clean afterward.
- Final weekly fast preflight for 2026-05-31 reports 6 clean lanes, 0 drift, 0 failed/partial steps, and `needsLiveWrite=false`.
- The current weekly page is `Week of 2026-05-25`, page ID `370c21f1-caf0-8145-b44b-ff0a118fea31`.
- Daily Focus dry-run is clean for 2026-05-31 and points at DevToolsTranslator, JobCommandCenter, and Nocturne as the top Now items.
- `control-tower:managed-section-audit` finds the Daily Focus managed markers on the current weekly page and keeps the recommended write mode on markdown REST until block replacement is rollback-safe.
- Operator brief for 2026-05-31 reports 0 overdue reviews, 0 stale active projects, 0 orphan kickoff gaps, 6 stale-task packets, and 6 at-risk packets.
- Weekly managed-section preservation is now centralized in `WEEKLY_REVIEW_MANAGED_SECTIONS`, including External Signals, Morning Brief, Trend Analysis, and Daily Focus.
- Advisory context zip `/Users/d/Documents/Codex/2026-05-31/in-app-browser-the-user-has/outputs/chatgpt-advisory-context-2026-05-31.zip` was reviewed as evidence only. It reinforces the boundary that ChatGPT is advisory, Codex verifies local truth, Drive is not source of truth, and compact receipts should precede any consultation schema.

## Verified today

- `npm ci` completed and ran the prepare/build step successfully.
- `npm run typecheck` passed.
- `npm test` passed with 59 test files and 403 tests.
- `npm run governance:health-report` reports healthy governance and actuation posture with no warnings.
- `npm run control-tower:operator-brief -- --today 2026-05-31 --packet-stale-days 14` reports 0 overdue reviews, 0 stale active projects, 0 actionable orphans, and 6 at-risk packets.
- `npm run control-tower:packet-follow-through -- --today 2026-05-31 --limit 12` surfaces 8 follow-through packets from 9 open packets: 3 blocked and 6 overdue.
- `npm run control-tower:today -- --today 2026-05-31 --limit 5` reports `weeklyReviewWouldChange=false`.
- `npm run control-tower:managed-section-audit -- --today 2026-05-31` finds a 19-block Daily Focus marker span and still recommends markdown REST managed-section writes.
- `npm run maintenance:weekly-refresh -- --today 2026-05-31 --fast --summary-first --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` reports 6 clean lanes and `needsLiveWrite=false` after the targeted intelligence repair.
- `gh pr list --state open` returns no open PRs.
- GitHub CI for the latest main merge commit is green. The Dependabot advisory workflow still fails on the accepted `exceljs -> uuid` path.

## Active follow-up

1. Use `npm run control-tower:operator-brief -- --today 2026-05-31 --packet-stale-days 14` to pick the next real product follow-through packet.
2. Current packet staleness remains the main operator queue: 6 stale packets and 6 at-risk packets, led by Nocturne, JobCommandCenter, Afterimage, bridge-db, and ModelColosseum; Daily Focus ranks DevToolsTranslator highest overall.
3. Use targeted lane repair commands for narrow drift. Do not use broad weekly live refresh as the default repair tool.
4. Use `npm run sandbox:smoke` before risky advanced workflow changes that touch control-tower, signals, governance, rollout, or profile portability paths.
5. Treat the consulted-node advisory workflow as external process guidance until 5-10 real consultations justify schema or repo integration.

## Cross-repo operator reminders

The current Daily Focus queue points at DevToolsTranslator, JobCommandCenter, Nocturne, IncidentWorkbench, and ModelColosseum. Re-check those repos directly before acting; this file is only a pointer, not live truth for other workspaces.

## Restart order

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/notion-roadmap.md`
4. `README.md`
5. `npm run control-tower:operator-brief -- --today 2026-05-31 --packet-stale-days 14`