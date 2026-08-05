# Maintenance Playbook

Use this as the default maintenance rhythm now that the numbered structural phases are complete.

## Weekly

- Review incoming Dependabot pull requests.
- Review the latest `Dependency Hygiene` workflow run.
- Triage any failed workflow, audit finding, install-smoke regression, or release-gate failure within the same week.
- Review the weekly `weekly-notion-maintenance` inbox item as the default Notion maintenance signal.
- Run `npm run maintenance:weekly-refresh -- --fast` first when you need a compact weekly preflight.
- Read the compact timing summary before taking action. It reports total runtime, longest lane, slow lanes, and every lane sorted from slowest to fastest.
- Run `npm run maintenance:weekly-refresh -- --fast --live --confirm-full-live --support-approval <path>` manually only when that weekly digest recommends a full live refresh and support preflight reports hygiene effects. Omit the approval flag when hygiene has zero effects.

## Fast Notion Repair Rule

Use targeted lane repair for debugging and fixes:

1. Run the lane dry-run.
2. Run the same lane live only if the dry-run proves the exact needed write.
3. Re-run the lane dry-run and stop when it is clean.

Do not use broad weekly live refresh to repair a single lane. It runs support maintenance, Control Tower, execution, intelligence, review packet, and external-signal work together, so one project-page markdown failure can turn a targeted repair into a long multi-lane run.

Examples:

```bash
npm run control-tower:sync -- --today 2026-05-04
npm run control-tower:sync -- --today 2026-05-04 --live
npm run control-tower:sync -- --today 2026-05-04
```

For review backlog recovery, use the dedicated review command instead of a
broad weekly write:

```bash
npm run control-tower:review-recovery -- --today 2026-05-10 --include-metadata-gaps --limit 120
npm run control-tower:review-recovery -- --today 2026-05-10 --include-metadata-gaps --limit 120 --live
npm run control-tower:sync -- --today 2026-05-10
```

The weekly orchestrator can also run a bounded single-step preflight when you need quick triage:

```bash
npm run maintenance:weekly-refresh -- --today 2026-05-04 --only execution-sync --fast
npm run maintenance:weekly-refresh -- --today 2026-05-04 --only external-signals --fast --max-project-pages 10 --project-offset 0
```

Execution, intelligence, and external-signal project brief repairs support bounded concurrency through the weekly orchestrator:

```bash
npm run maintenance:weekly-refresh -- --today 2026-05-04 --only intelligence-sync --fast --max-project-pages 117 --project-concurrency 2 --live --confirm-full-live
npm run maintenance:weekly-refresh -- --today 2026-05-04 --only intelligence-sync --fast --max-project-pages 117
```

Lower `--project-concurrency` to `1` if Notion starts returning rate limits or retryable transport errors.

Run full weekly live only for full weekly maintenance:

```bash
npm run maintenance:weekly-refresh -- --today 2026-05-04 --fast --live --confirm-full-live --support-approval /path/to/IrreversibleActionEnvelopeV1.json
```

If the full weekly live command fails in `execution-sync`, `intelligence-sync`, or `external-signals`, continue with that lane's targeted command instead of rerunning the full weekly sequence.

## Daily Driver Refresh

Use this order when refreshing the operator-facing weekly page after packet, morning-brief, or review-packet drift:

1. Publish the specific queue report, such as `npm run control-tower:packet-follow-through -- --today <date> --live`.
2. Refresh the weekly review packet only if its dry-run reports drift: `npm run control-tower:review-packet -- --today <date> --include-next-phase --live`.
3. Repatch managed sections that the review packet should preserve but may disturb: `npm run signals:morning-brief -- --today <date> --lookback-days 7 --live`, then `npm run control-tower:today -- --today <date> --live`.
4. Verify convergence with `npm run control-tower:review-packet -- --today <date> --include-next-phase`, `npm run control-tower:today -- --today <date>`, and `npm run control-tower:managed-section-audit -- --today <date>`.

Do not create duplicate recovery tasks for stale packets that already have open tasks. Publish the queue report, preserve the existing task trail, and recover the actual blocked task in the project repo.

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
