# Maintenance Playbook

Use this as the default maintenance rhythm now that the numbered structural phases are complete.

## Weekly

- Review incoming Dependabot pull requests.
- Review the latest `Dependency Hygiene` workflow run.
- Triage any failed workflow, audit finding, install-smoke regression, or release-gate failure within the same week.
- Review the weekly `weekly-notion-maintenance` inbox item as the default Notion maintenance signal.
- Run `npm run maintenance:weekly-refresh -- --summary-first` first when you need a compact weekly preflight.
- Run `npm run maintenance:weekly-refresh -- --live --confirm-full-live --summary-first` manually only when that weekly digest recommends a full live refresh.

## Fast Notion Repair Rule

Use targeted lane repair for debugging and fixes:

1. Run the lane dry-run.
2. Run the same lane live only if the dry-run proves the exact needed write.
3. Re-run the lane dry-run and stop when it is clean.

Do not use broad weekly live refresh to repair a single lane. It runs support maintenance, Control Tower, execution, intelligence, review packet, and external-signal work together, so one project-page markdown failure can turn a targeted repair into a long multi-lane run.

Examples:

```bash
npm run control-tower:sync -- --today 2026-05-03
npm run control-tower:sync -- --today 2026-05-03 --live
npm run control-tower:sync -- --today 2026-05-03
```

The weekly orchestrator can also run a bounded single-step preflight when you need quick triage:

```bash
npm run maintenance:weekly-refresh -- --today 2026-05-03 --only execution-sync --step-timeout-minutes 5 --max-step-attempts 2 --summary-first
npm run maintenance:weekly-refresh -- --today 2026-05-03 --only external-signals --max-project-pages 10 --project-offset 0 --summary-first
```

Execution and intelligence project-page repairs also support direct batching:

```bash
npm run execution:sync -- --today 2026-05-03 --project-limit 1 --project-offset 0
npm run intelligence:sync -- --today 2026-05-03 --project-limit 1 --project-offset 0
```

Run full weekly live only for full weekly maintenance:

```bash
npm run maintenance:weekly-refresh -- --today 2026-05-03 --signal-source-limit 5 --signal-max-events-per-source 5 --live --confirm-full-live --summary-first
```

If the full weekly live command fails in `execution-sync`, `intelligence-sync`, or `external-signals`, continue with that lane's targeted command instead of rerunning the full weekly sequence.

## Monthly

- Run `npm run release:prepare`.
- Run `npm run verify:fresh-clone`.
- Review `package.json` overrides and remove any mitigation that upstream no longer needs.
- If you changed a risky advanced workflow recently, run `npm run sandbox:smoke`.

## Quarterly

- Review GitHub Actions major versions and update workflow pins when needed.
- Confirm the required branch-protection checks still match the active workflow names:
  - `workflow-lint`
  - `quality-gates`
  - `fresh-clone-verify`
- Re-check both supported install paths:
  - GitHub ref install
  - GitHub release tarball install

## After workflow or package-surface changes

- Run `npm run verify`.
- Run `npm run release:prepare` if install, package, or release behavior changed.
- Update `README.md` if operator or consumer behavior changed materially.
- Update `HANDOFF.md` so the next session inherits the current reality instead of stale assumptions.
- If a workflow name changed, update GitHub branch protection so the required checks still match.

## GitHub Support Maintenance

- Use [github-support-maintenance.md](./github-support-maintenance.md) as the operator guide for the Notion support-maintenance lane.
- Use [weekly-notion-maintenance-operating-model.md](./weekly-notion-maintenance-operating-model.md) as the operator guide for the current weekly Notion maintenance model.
- Use [weekly-refresh-maintenance.md](./weekly-refresh-maintenance.md), [weekly-refresh-rollout-scorecard.md](./weekly-refresh-rollout-scorecard.md), and [weekly-refresh-cutover-review.md](./weekly-refresh-cutover-review.md) only as historical references for the abandoned live-cutover path.
- Keep `github-support-maintenance` as the narrow sub-lane for safe GitHub-backed refreshes and approved hygiene only.
- Use `stale-support-audit` and `project-support-coverage-audit` as review-first commands before introducing broader cleanup or coverage work.
- Use [weak-support-review-second-pass.md](./weak-support-review-second-pass.md) when the stale-support queue is down to specialist rows and you need to decide what should stay intentionally single-project.

## Dependency maintenance note

- Dependabot is the default updater for npm and GitHub Actions dependencies.
- Keep dependency updates review-driven. Do not auto-merge by default.
- Treat npm `overrides` as temporary mitigations, not permanent architecture.
- When upstream packages land the needed fix cleanly, remove the matching override and validate with `npm run verify` before merge.
- Current accepted audit exception: `exceljs@4.4.0` still depends on `uuid@8.3.2`, which triggers the moderate `uuid` advisory path reported by `npm audit`. Do not downgrade `exceljs`; keep the risk limited to workbook import/export utilities and revisit replacement or isolation when a maintained upstream fix exists.
- Current Dependabot posture after the 2026-04-23 cleanup: package and GitHub Actions update PRs are merged, but the `uuid` advisory workflow is still expected to fail until the accepted `exceljs` path is replaced, isolated, or fixed upstream.

## CI maintenance note

- `npm run release:prepare` is a release gate, not a substitute for CI.
- When CI workflow names or job names change, update branch-protection required checks in the same change window.
- Keep the current confidence layers intact:
  - source correctness
  - built CLI correctness
  - packed-install correctness
  - git-ref install correctness
  - fresh-workspace correctness

## Sandbox rule

Use the `sandbox` profile before live changes that touch:

- `control-tower`
- `signals`
- `governance`
- `rollout`
- profile clone, bootstrap, import, export, or upgrade flows

Treat `notion-os --profile sandbox doctor` as the proof gate for live sandbox safety.

For a fuller rehearsal before risky live work:

```bash
npm run sandbox:smoke
```

If the doctor or sandbox smoke path reports token overlap, target overlap, path masking, or mixed-result failures you do not understand, fix the sandbox state first instead of continuing to the primary profile.
