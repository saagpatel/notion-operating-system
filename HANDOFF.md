# Notion Operating System Handoff

## Current state

Latest checkpoint: 2026-05-16.

The repo is in a healthy maintenance posture. Phase 10 is closed, Phase 11 is defined, and the next useful work is product follow-through rather than another broad cleanup pass.

Repo-state note: do not treat this file as the source of truth for the current branch or working tree. Check `git status --short --branch` before acting on branch state.

The current closeout lane is PR #70, `chore/post-live-state-update`, which carries the post-live config state and the architecture memo for Devil's Advocate and DecisionStressTest. If that PR is already merged when you read this, treat `main` as the starting point. If it is still open, finish that PR before beginning new Phase 11 work.

## Verified today

- Governance health report is healthy with 0 warnings.
- Actuation policy coverage is healthy across GitHub and Vercel supported actions.
- Operator brief reports 117 projects, 7 overdue reviews, 0 stale active projects, 3 actionable orphans, and 1 orphan already routed to a kickoff packet.

## Recently completed

- Weekly live refresh cleared the prior drift lanes and produced a clean 6-lane post-live dry run.
- Phase 10 closed and Phase 11 was defined.
- PR #69 merged the Phase 10/11 docs and related ignore-file cleanup.
- PR #70 adds the post-live config state and architecture decision memo.

## Active follow-up

1. Finish PR #70 if it is still open.
2. Run `npm run maintenance:weekly-refresh -- --fast` for the next weekly health check.
3. Start Phase 11 with a packet-prioritizer slice that uses existing signal severity, recommendation score, and evidence-staleness fields. Do not add new Notion fields for the first pass.
4. Use `npm run control-tower:operator-brief` to pick the next portfolio pressure from live data.
5. Use `npm run sandbox:smoke` before risky advanced workflow changes that touch control-tower, signals, governance, rollout, or profile portability paths.

## Cross-repo operator reminders

- Terroir still needed its local App Store branch work pushed as of the May 12 checkpoint.
- TideEngine still needed the widget signing commit cherry-picked and pushed as of the May 12 checkpoint.
- Recall Session 6 still needed a Godot QA pass before merging its minimap/save-load branch as of the May 12 checkpoint.

Re-check those repos directly before acting; this file is only a pointer, not live truth for other workspaces.

## Restart order

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/notion-roadmap.md`
4. `README.md`
5. `npm run control-tower:operator-brief`
