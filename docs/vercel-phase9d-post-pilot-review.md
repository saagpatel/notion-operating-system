# Vercel Phase 9D Post-Pilot Review

Updated: 2026-04-14

## Summary

Phase 9D succeeded.

The repo now has a proven bounded Vercel promote lane:

- provider: `Vercel`
- action family: `vercel.promote`
- pilot target: `evolutionsandbox`
- promote posture: pinned-target dry run, exact pin-match live gating, provider-side confirmation
- approval posture: `Single Approval`

The live pilot promoted `evolutionsandbox` back to the pinned earlier deployment and restored forward production flow after the intentional Phase 9C rollback.

## Pilot Outcome

- request: `Promote evolutionsandbox - Vercel undo rollback pilot`
- pinned promote target: `dpl_CRVMfPx7eDjjgFwsn6rMNqwZDMvM`
- final production URL: `https://evolutionsandbox-9e4csrwva-saagars-projects-b7dca8e2.vercel.app`
- final state: production moved to the pinned target

## What Changed During Phase 9D

- `vercel.promote` became a first-class deployment-control lane instead of a future placeholder.
- Dry run now pins one exact promote target in `providerRequestKey`.
- Live promote refuses to run if the fresh provider preflight no longer matches the pinned candidate.
- Promote execution now uses Vercel's project promote endpoint with exact project and team scope.
- Promote verification now confirms that the pinned deployment becomes the most recently aliased production deployment.

## What Happened During The Pilot

- The first dry run succeeded and pinned `dpl_CRVMfPx7eDjjgFwsn6rMNqwZDMvM` as the promote candidate.
- The first live attempt failed because the code was calling the wrong Vercel promote endpoint.
- The provider path was corrected to the project promote endpoint, the focused checks were rerun, and the request was refreshed through a new dry run.
- The second live execution succeeded.
- Direct provider verification confirmed that production now points to the pinned target.

## What Phase 9D Proved

- The repo can safely govern one bounded Vercel promote or undo-rollback action without adding new schema or a parallel workflow.
- Pinned-target dry runs remain the right protection against dry-run/live drift for recovery-oriented forward actions.
- The same approval, idempotency, execution-ledger, and compensation posture can carry both rollback and promote behavior for Vercel.
- The `evolutionsandbox` pilot can safely move backward and forward through production state under the governed Notion request model.

## What Phase 9D Did Not Prove

- Wider promote coverage beyond one pilot target
- Whether rollback and promote should be allowlisted for the widened Phase 9B projects
- Broader Vercel provider expansion beyond deployment control
- Webhook-based confirmation for Vercel recovery actions

## Decision

Phase 9D should be treated as complete.

The repo now has one proven redeploy lane plus one proven rollback-and-promote recovery loop for Vercel.

## Recommendation

Do not widen recovery verbs by default.

If a next slice is warranted, treat it as **Phase 9E: selective widening of Vercel recovery coverage** and only proceed when a real operating need exists.

If Phase 9E happens, keep it narrow:

- add rollback and promote to one additional Vercel project at a time
- require the same pinned-target dry run and provider-side verification
- stop immediately on any ambiguity instead of broadening the lane by routine
