# Weekly Refresh Orchestrator Review

This review captures what changed when the weekly refresh orchestrator was introduced.

## What Was Implemented

- Added a shared weekly-step contract so the core refresh commands now report:
  - `status`
  - `wouldChange`
  - `summaryCounts`
  - `warnings`
- Hardened full-page publishing so the Command Center and weekly review preserve managed sections instead of silently overwriting them.
- Added the new durable command:

```bash
npm run maintenance:weekly-refresh
```

- Added the legacy compatibility alias:

```bash
npm run portfolio-audit:weekly-refresh
```

- Added weekly maintenance state to `config/local-portfolio-control-tower.json`.
- Added a final freshness-section refresh so the Command Center reflects the latest weekly-run state after a live run.
- Added per-step timeouts so unattended runs fail cleanly instead of hanging forever on a slow step.
- Bounded the weekly GitHub external-signals slice by source count and event count so the live weekly lane stays operationally safe.
- Bounded the weekly external-signals step to the configured first-wave source limit so the weekly lane stays operationally safe during rollout.
- Added multi-attempt retry handling with backoff for transient step-level network failures inside the orchestrator.

## Workflow Changes

Before this change, the safe automated lane only covered GitHub-backed support maintenance.

After this change:

- support maintenance remains the first step
- the broader control-tower, execution, intelligence, review, and GitHub external-signal steps can now be preflighted together
- one runner decides whether a live write is necessary
- partial failures and skipped steps are reported explicitly

## Intentionally Deferred

- GitHub Actions as the live scheduler
- non-GitHub provider expansion in the weekly lane
- `overhaul-notion`
- governance actuation
- rollout commands
- official Notion Views API migration

## Rollback Posture

If the new weekly lane behaves badly:

1. pause the weekly-refresh automation
2. re-enable or keep the support-only live automation
3. fall back to the individual commands manually
4. fix the orchestrator and return it to shadow mode before another live cutover

## Stable Operating Rhythm

- Weekly: run `maintenance:weekly-refresh`
- Review-first: use `stale-support-audit` and `project-support-coverage-audit` for broader cleanup or coverage work
- Monthly: keep using the repo maintenance and verification cadence in `maintenance-playbook.md`
