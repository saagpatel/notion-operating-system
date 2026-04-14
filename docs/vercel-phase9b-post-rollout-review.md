# Vercel Phase 9B Post-Rollout Review

Updated: 2026-04-14

## Summary

Phase 9B succeeded.

The repo now has a widened, still-bounded Vercel deployment-control lane:

- provider: `Vercel`
- action family: `vercel.redeploy`
- rollout posture: serial, approval-backed, dry-run-gated
- webhook posture: shadow/evidence-only
- approval posture: `Single Approval`

The widening step proved that the existing governance and execution model can stay understandable across multiple explicit Vercel projects without broadening into a generic provider framework.

## Rollout Set

The completed primary rollout set was:

1. `premise-debate`
2. `neural-network-playground`
3. `sovereign-sim`

Reserve target retained but not used:

- `how-money-moves`

## What Changed During Phase 9B

- Vercel live gating now fails closed when a request is not actually `Ready for Live`.
- Dry-run summaries now reflect the post-dry-run state correctly instead of reporting false readiness.
- Vercel rollout readiness became manifest-driven and duplicate-aware.
- Vercel target resolution now rejects ambiguous allowlist matches.
- Vercel rollout safety preserves support for both team-scoped and personal-scope targets.
- The Vercel governance model now uses `Single Approval` so live execution matches the actual solo-maintainer operating posture.

## Evidence

### Repo and verification lane

- Targeted rollout and actuation tests passed after the hardening work.
- The fresh-clone verification path passed after the rollout fixes.
- Provider readiness and rollout-readiness checks passed for the selected widening set.

### Live executions

- `premise-debate`
  - deployment id: `dpl_9muwigCGQMfSptp3ASNj1HXddB8C`
  - final state: `READY`
- `neural-network-playground`
  - deployment id: `dpl_ENmu3Vi8W9aLjuvRApPdyHzsAG1c`
  - final state: `READY`
- `sovereign-sim`
  - deployment id: `dpl_5UiSv53nKFbEeiAW8SuPdYaARRme`
  - final state: `READY`

### Governance lane

- The widened projects all followed the same ladder:
  - truthful sync
  - governed request
  - dry run
  - `Ready for Live`
  - one live redeploy
  - confirmed reconciliation

## What Phase 9B Proved

- The Vercel redeploy lane stays understandable across a small explicit allowlist.
- Exact project identity and strict live gating matter more than broader provider abstraction.
- `Single Approval` is the honest governance posture for the current solo-maintainer operating model.
- Serial widening is sufficient to catch operational issues without introducing orchestration complexity.

## What Phase 9B Did Not Prove

- Promotion flows
- Rollback flows
- Webhook-driven trust for Vercel execution
- Whether widening beyond a very small allowlist stays low-noise

## Decision

Phase 9B should be treated as complete.

The next phase should not widen more projects immediately. The safer next move is to add one recovery-oriented deployment-control verb rather than keep expanding outward.

## Recommendation

Proceed to **Phase 9C: bounded `vercel.rollback` design and pilot**.

Why rollback before promote:

- It closes the safety loop around the newly proven redeploy lane.
- It improves incident response posture more than a forward-only promotion verb.
- It keeps Phase 9 focused on operational trust, not convenience expansion.

Keep the following out of the same phase:

- `vercel.promote`
- broader Vercel rollout widening
- webhook-driven execution trust
