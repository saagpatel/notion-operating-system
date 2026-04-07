# Weekly Refresh Maintenance

This is the operator guide for the broader weekly Notion refresh lane.

## Purpose

Use this lane when you want the portfolio operating system to refresh as one ordered workflow instead of running support maintenance, command-center refreshes, and review publishing by hand.

It is intentionally broader than `github-support-maintenance`, but still narrower than a full overhaul.

It covers:

- GitHub-backed support maintenance
- control-tower derived field refresh
- execution sync
- intelligence sync
- weekly review packet refresh
- GitHub external-signal sync
- freshness-by-layer state updates for the Command Center

The weekly GitHub external-signals slice is intentionally bounded:

- it uses a limited source wave
- it uses a capped event fetch per source
- it is designed for steady weekly progress, not full historical re-harvesting every run

For now, the weekly lane runs the GitHub external-signal step as a bounded first-wave slice using the configured Phase 5 source limit, not a full all-sources sweep.

It does not cover:

- `overhaul-notion`
- rollout commands
- governance actuation
- risky support cleanup beyond the already approved hygiene lane
- non-GitHub provider expansion

## Default Command

```bash
npm run maintenance:weekly-refresh
```

This command is dry-run by default.

It preflights the full weekly lane and reports:

- which steps are clean
- which steps would change live state
- whether a live run is needed
- whether any step failed or was only partially healthy

## Live Command

```bash
npm run maintenance:weekly-refresh -- --live
```

Live mode always performs its own internal dry-run first.

If the preflight is already clean, it exits without a live Notion write sequence.

If the preflight finds approved in-scope drift and no blocking failures, it runs the live steps in this fixed order:

1. GitHub support maintenance
2. control-tower sync
3. execution sync
4. intelligence sync
5. review packet
6. GitHub external-signal sync

By default, the orchestrator runs that final GitHub external-signals step with a bounded source limit and a conservative event cap per source so the weekly lane stays operationally safe.

## Failure Rules

- Support maintenance runs first and is isolated.
- If control-tower sync fails, the downstream page-refresh steps are skipped.
- Execution and intelligence failures do not automatically block later independent steps.
- External-signal failures mark the run partial or failed instead of pretending success.

## Freshness Rules

The Command Center now exposes freshness by layer:

- support maintenance
- control tower
- execution
- intelligence
- external signals
- weekly review
- last weekly refresh result

This is driven by `config/local-portfolio-control-tower.json` plus a final freshness-section refresh at the end of a live weekly run.

## Rollout Posture

The intended rollout is:

1. manual dry-run
2. manual live pilot
3. shadow automation
4. cut over to the weekly refresh automation
5. pause the old support-only live automation after the new lane proves stable

Until cutover is complete, keep the older support-only live automation available as the rollback lane.
