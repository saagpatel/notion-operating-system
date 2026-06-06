# Weekly Notion Maintenance Operating Model

Updated: Saturday, June 6, 2026

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

- Friday evening opportunistic check plus Sunday catch-up cadence
- dedicated worktree execution
- report-only behavior
- exactly three report sections:
  - `Priority Summary`
  - `Dry-Run Drift`
  - `Manual Follow-Up`

The weekly method is defined in the repo-local Codex skill:

- [`weekly-notion-maintenance` skill](/Users/d/Projects/Notion/.agents/skills/weekly-notion-maintenance/SKILL.md)

## Schedule Policy

This automation is intentionally not daily. The machine is often unavailable on weekday mornings and afternoons, so the schedule should not depend on daily execution to preserve trust.

Active schedule:

- Friday 5:00 PM local time: opportunistic report-only check before the weekend work window.
- Sunday 5:00 PM local time: report-only catch-up after missed weekday maintenance windows.

If the automation reports drift, use targeted dry-run -> live -> dry-run repair for the drifting lane. Do not promote this lane to unattended live writes.

## Manual Live Policy

Live weekly refreshes are manual operator actions.

Use this command only when the weekly digest recommends it:

```bash
npm run maintenance:weekly-refresh -- --live --confirm-full-live --summary-first
```

Decision rules:

- If both dry runs are clean and `needsLiveWrite=false`, no live run is needed.
- If weekly refresh drifts but has no failed or partial steps, a manual live run is the normal follow-up.
- If any weekly-refresh step is failed or partial, do not run live; diagnose with targeted dry-run commands first.
- If the task is a repair to one lane, do not run full weekly live. Use that lane's dry-run/live/dry-run loop and stop when it is clean.

## Targeted Repair Mode

For repairs, the expected sequence is:

```bash
npm run <lane-command> -- --today <date>
npm run <lane-command> -- --today <date> --live
npm run <lane-command> -- --today <date>
```

Use lane commands such as:

- `npm run control-tower:sync`
- `npm run execution:sync`
- `npm run intelligence:sync`
- `npm run maintenance:weekly-refresh -- --only execution-sync --step-timeout-minutes 5 --max-step-attempts 2 --summary-first`
- `npm run maintenance:weekly-refresh -- --only external-signals --max-project-pages 10 --project-offset 0 --summary-first`
- `npm run signals:sync`
- `npm run control-tower:review-packet`

The broad weekly live command is intentionally guarded because it can spend a long time in project-page markdown write loops. Treat it as a full maintenance action, not a repair shortcut.

## External Signal Refresh Recovery

If `signals:sync -- --live` is interrupted by Notion transport errors after signal events and sync runs have already reconciled, do not rerun a broad full live sync first. Use scoped refreshes so retries do not create duplicate provider sync-run rows.

Start with a dry-run:

```bash
npm run signals:sync
```

If the remaining drift is project briefs or command-center sections, refresh project pages in deterministic batches:

```bash
npm run signals:sync -- --write-scope project-pages --project-limit 10 --project-offset 0
npm run signals:sync -- --live --write-scope project-pages --project-limit 10 --project-offset 0
npm run signals:sync
```

Repeat offsets `10`, `20`, `30`, and so on until project brief drift clears. Then refresh the portfolio sections:

```bash
npm run signals:sync -- --write-scope portfolio-sections
npm run signals:sync -- --live --write-scope portfolio-sections
npm run signals:sync
```

Current recovery note: the 2026-04-25 live recovery reduced project brief drift from 117 to 38, but stopped on managed-markdown convergence failures for `Phantom Frequencies` and `Recall`. Inspect those project brief sections before continuing live page batches. Do not run `portfolio-sections` live until project-page drift is either cleared or explicitly documented as benign residual drift.

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

- [`weekly-refresh-phase-2-handoff.md`](/Users/d/Projects/Notion/docs/weekly-refresh-phase-2-handoff.md)
- [`weekly-refresh-maintenance.md`](/Users/d/Projects/Notion/docs/weekly-refresh-maintenance.md)
- [`weekly-refresh-rollout-scorecard.md`](/Users/d/Projects/Notion/docs/weekly-refresh-rollout-scorecard.md)
- [`weekly-refresh-cutover-review.md`](/Users/d/Projects/Notion/docs/weekly-refresh-cutover-review.md)

Use those only to understand how the earlier cutover plan evolved. Do not use them as the current weekly operating guide.
