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

## Phase 2A Reliability Hardening

After the initial weekly orchestrator rollout work, a focused reliability-hardening pass tightened the dry-run path before cutover.

That follow-up work:

- moved key data-source reads and page queries onto the shared `DirectNotionClient` HTTP path so they use the same Notion retry and timeout policy
- reduced broad Notion fetch bursts in the heaviest dry-run commands by staging the schema and dataset loads instead of fetching every dataset at once
- limited markdown read fan-out in the GitHub support audit
- added step-level failure categorization in the weekly orchestrator output so transport and timeout failures are easier to interpret
- retried and rewrapped raw Notion transport failures centrally instead of surfacing only a bare `fetch failed`

Result of the hardening pass on April 7, 2026:

- `github-support-maintenance` now completes cleanly in dry-run mode
- `execution:sync` now completes in dry-run drift mode
- `intelligence:sync` now completes in dry-run drift mode
- `maintenance:weekly-refresh` now completes preflight with drift only and no failed steps

This means the remaining work before cutover is operational rollout validation, not more core reliability architecture.
