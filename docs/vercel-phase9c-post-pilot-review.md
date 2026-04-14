# Vercel Phase 9C Post-Pilot Review

Updated: 2026-04-14

## Summary

Phase 9C succeeded.

The repo now has a proven bounded Vercel rollback lane:

- provider: `Vercel`
- action family: `vercel.rollback`
- pilot target: `evolutionsandbox`
- rollback posture: pinned-target dry run, exact pin-match live gating, provider-side confirmation
- approval posture: `Single Approval`

The live pilot rolled `evolutionsandbox` back to the pinned previous production deployment and intentionally left the project in the rolled-back state after verification.

## Pilot Outcome

- request: `Rollback evolutionsandbox (Phase 9C pilot)`
- pinned rollback target: `dpl_Assb8HTLaYqeA6Ljio6ewgi62mUi`
- final production URL: `https://evolutionsandbox-1p7mwsamx-saagars-projects-b7dca8e2.vercel.app`
- final state: production moved to the pinned target

## What Changed During Phase 9C

- `vercel.rollback` replaced the old bundled placeholder lane.
- Dry run now pins one exact rollback target in `providerRequestKey`.
- Live rollback refuses to run if the fresh provider preflight no longer matches the pinned target.
- Rollback execution now uses Vercel's project rollback endpoint with exact project and team scope.
- Rollback verification now treats the most recently aliased deployment as current production, which fixed the false failure we saw during the pilot.

## What Happened During The Pilot

- The governed dry run succeeded and pinned the rollback target.
- The live rollback executed against the pinned target.
- Vercel moved production to the pinned earlier deployment.
- The first verification pass marked the execution as failed because the app was still treating `aliasAssigned` as a simple yes/no flag instead of a timestamped production-assignment signal.
- That verification bug was fixed immediately afterward, the provider state was rechecked, and the execution records were reconciled to the true successful outcome.

## What Phase 9C Proved

- The repo can safely govern one bounded Vercel rollback action without adding new schema or a parallel workflow.
- Pinned-target dry runs are the right protection against dry-run/live drift for recovery actions.
- Recovery actions need stronger verification than forward-only redeploys.
- The current solo-maintainer governance posture still works for recovery-oriented Vercel control.

## What Phase 9C Did Not Prove

- Promotion or rollback undo flows
- Wider rollback coverage beyond one pilot target
- Whether rollback should be allowlisted for the widened Phase 9B projects
- Webhook-based confirmation for Vercel recovery actions

## Decision

Phase 9C should be treated as complete.

The repo now has one proven redeploy lane and one proven rollback lane for Vercel.

## Recommendation

Proceed to **Phase 9D: bounded `vercel.promote` or rollback-undo pilot** on `evolutionsandbox`.

Why promote next:

- Phase 9C intentionally left the pilot project rolled back.
- Vercel rollback disables normal production auto-assignment until a later undo or promote step.
- The clean next trust question is whether the repo can restore forward motion with the same level of safety and explicit confirmation.

Keep the following out of the next slice:

- wider rollback rollout
- broader Vercel provider expansion
- webhook-driven Vercel execution trust
