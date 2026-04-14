# Vercel Phase 9B Rollout Plan

Updated: 2026-04-13

## Goal

Widen the proven `vercel.redeploy` lane from one project to a very small explicit allowlist without adding new deployment-control verbs.

## Decision

Phase 9B should widen `vercel.redeploy` only.

It should not add:

- `vercel.promote`
- `vercel.rollback`
- multi-provider generalization beyond the current seam

## Exact Rollout Set

The recommended Phase 9B rollout set is:

1. `premise-debate`
2. `neural-network-playground`
3. `sovereign-sim`

## Why These Three

These are the best next candidates from the current Vercel team inventory because they are:

- already present under the same team scope as the pilot
- more recent than the remaining projects in the inventory
- enough to test cross-project rollout behavior without creating a large blast radius

The remaining projects should stay deferred for now:

- `signal-and-noise`
- `how-money-moves`
- `orbit-mechanic`

## Important Constraint

Only `evolutionsandbox` is fully mapped in the current Local Portfolio operating model today.

That means Phase 9B must begin with a mapping step before any of the new projects can be live-capable.

## Required Prerequisites

Before widening the redeploy lane, do all of the following for each of the three selected projects:

1. Create or verify a `Local Portfolio Projects` row.
2. Create or verify one `External Signal Sources` row with:
   - provider `Vercel`
   - explicit project id
   - explicit team scope type
   - explicit team scope id
   - explicit team scope slug
3. Add one allowlisted actuation target with:
   - `vercelProjectId`
   - `vercelTeamId`
   - `vercelTeamSlug`
   - `vercelScopeType`
   - `vercelEnvironment`
   - `allowedActions = ["vercel.redeploy"]`
4. Validate real dry sync coverage for each project before allowing dry-run redeploy requests.

## Phase 9B Verification Ladder

For each new project, use the same ladder as the pilot:

1. Truthful provider sync passes in dry mode.
2. Real Notion action request is created.
3. Dry run passes and reaches `Ready for Live`.
4. One live redeploy succeeds.
5. Reconciliation confirms the resulting Vercel deployment.

## Rollout Order

Recommended order:

1. `premise-debate`
2. `neural-network-playground`
3. `sovereign-sim`

This keeps the widening step serial and easy to observe.

## Phase 9B Exit Criteria

Phase 9B is complete when:

- all three selected projects are fully mapped
- each has passed the full redeploy ladder once
- the operator packet remains easy to understand
- the provider-expansion audit still reads as clean and bounded
- no new abstraction pressure appears that would justify a broader framework rewrite

## What Comes After Phase 9B

Only after the widening step is proven should the project choose between:

- Phase 9C: `vercel.promote`
- Phase 9D: `vercel.rollback`

Those should be designed as separate action families, not added as a bundled `promote_or_rollback` lane.
