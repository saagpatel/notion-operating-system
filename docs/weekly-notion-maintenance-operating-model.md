# Weekly Notion Maintenance Operating Model

Updated: Monday, April 13, 2026

This document is the source of truth for the weekly Notion operating model.

## Current Model

Option 2 is the adopted operating model.

The active weekly lane is `weekly-notion-maintenance`, a report-only Codex automation that:

- runs dry-run maintenance checks
- creates one inbox digest
- recommends manual live follow-up only when warranted

The weekly digest is the main signal. It does not perform live weekly-refresh writes on its own.

## Active Weekly Lane

The only active automation in this stream is:

- `weekly-notion-maintenance`

Its steady-state contract is:

- Monday evening cadence
- dedicated worktree execution
- report-only behavior
- exactly three report sections:
  - `Priority Summary`
  - `Dry-Run Drift`
  - `Manual Follow-Up`

The weekly method is defined in the repo-local Codex skill:

- [`weekly-notion-maintenance` skill](/Users/d/Notion/.agents/skills/weekly-notion-maintenance/SKILL.md)

## Manual Live Policy

Live weekly refreshes are manual operator actions.

Use this command only when the weekly digest recommends it:

```bash
npm run maintenance:weekly-refresh -- --live
```

Decision rules:

- If both dry runs are clean and `needsLiveWrite=false`, no live run is needed.
- If weekly refresh drifts but has no failed or partial steps, a manual live run is the normal follow-up.
- If any weekly-refresh step is failed or partial, do not run live; diagnose with targeted dry-run commands first.

## Notion Artifact Freshness

Under this model, the following are live artifacts that may lag between manual refreshes:

- the Command Center page
- the current-week weekly review packet
- execution and intelligence briefs
- external-signal summaries

That lag is expected under Option 2. It is not, by itself, a workflow failure.

## Retired Lanes

These automations are retained as historical artifacts and should stay paused:

- `weekly-refresh-shadow`
- `weekly-github-notion-maintenance`
- `weekly-command-center`

They are not pending cutover work. They are retired lanes from the abandoned live-cutover path.

If future portfolio-level reporting is needed, treat that as a separate project instead of reactivating these lanes implicitly.

## Historical Context

The weekly-refresh implementation and hardening work still matter. The following documents are historical references, not active operating instructions:

- [`weekly-refresh-phase-2-handoff.md`](/Users/d/Notion/docs/weekly-refresh-phase-2-handoff.md)
- [`weekly-refresh-maintenance.md`](/Users/d/Notion/docs/weekly-refresh-maintenance.md)
- [`weekly-refresh-rollout-scorecard.md`](/Users/d/Notion/docs/weekly-refresh-rollout-scorecard.md)
- [`weekly-refresh-cutover-review.md`](/Users/d/Notion/docs/weekly-refresh-cutover-review.md)

Use those only to understand how the earlier cutover plan evolved. Do not use them as the current weekly operating guide.
