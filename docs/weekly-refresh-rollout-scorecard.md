# Weekly Refresh Rollout Scorecard

Use this scorecard during the remaining rollout and cutover work for the weekly refresh lane.

## 1. Reliability Hardening Checkpoint

Required commands:

```bash
npm run portfolio-audit:github-support-maintenance
npm run execution:sync
npm run intelligence:sync
npm run maintenance:weekly-refresh
```

Pass only if all of the following are true:

- none of the commands fail with a bare transport error
- `maintenance:weekly-refresh` finishes preflight with no `failed` steps
- the output distinguishes clean state from real drift

## 2. Shadow Run Review

Review the first `weekly-refresh-shadow` run and mark each item pass or fail:

- no failed steps
- no partial steps
- runtime is bounded for a weekly dry run
- the report clearly separates clean steps from drift steps
- external-signals dry run remains bounded
- the lane looks understandable enough to trust as the default weekly report

If any item fails, fix the issue and require a second healthy shadow cycle before live promotion.

## 3. Manual Live Pilot

Run only after the reliability checkpoint passes and at least one healthy shadow run exists.

```bash
npm run maintenance:weekly-refresh -- --live
```

Pass only if:

- no operator interruption is needed
- overall status is `completed` or `clean`
- no step ends `failed` or `partial`
- freshness-by-layer state persists correctly

Follow immediately with:

```bash
npm run maintenance:weekly-refresh
```

The follow-up dry run passes only if:

- there are no `failed` or `partial` steps
- `needsLiveWrite` is false or any remaining drift is small and clearly explainable

## 4. Cutover Review

Approve cutover only when all of the following are true:

- implementation verification still passes
- reliability hardening checkpoint passed
- one healthy shadow run exists
- a second healthy shadow run exists if the first one was noisy
- one healthy manual live pilot exists
- one healthy post-pilot dry run exists

## 5. Final Completion Review

After cutover, verify:

- the new live weekly-refresh automation is active
- `weekly-github-notion-maintenance` is paused
- `weekly-refresh-shadow` is paused or intentionally retained as inactive rollback scaffolding
- `weekly-command-center` is still active and unchanged
- the docs reflect the new default weekly operating rhythm
- the rollback posture is documented clearly

Document the closeout with four short sections:

- what Phase 2 shipped
- what was validated during rollout
- what changed at cutover
- what remains as post-cutover follow-up work
