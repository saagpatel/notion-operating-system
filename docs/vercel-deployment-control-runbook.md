# Vercel Deployment Control Runbook

Updated: 2026-04-14

## Purpose

Use this runbook for the governed Vercel deployment-control lane in Notion.

Current proven actions:

- `vercel.redeploy`
- `vercel.rollback`
- `vercel.promote`

Current proven recovery target:

- `evolutionsandbox`

Current widened redeploy targets:

- `premise-debate`
- `neural-network-playground`
- `sovereign-sim`

## Core Rule

Always use the governed Notion request flow:

1. create or update the action request
2. run dry run
3. confirm the request is `Ready for Live`
4. run one live execution
5. verify the provider result directly

Do not skip dry run for Vercel deployment control.

## When To Use Each Action

### `vercel.redeploy`

Use when:

- production is healthy enough to stay on the same deployment basis
- you want to re-trigger a known production deployment
- the project is already in the widened redeploy allowlist

Do not use when:

- you need to move production back to an earlier deployment
- you need to undo a rollback

### `vercel.rollback`

Use when:

- production needs to move back to the immediately previous eligible production deployment
- the current production deployment is the problem
- the project is explicitly allowlisted for rollback

Do not use when:

- you only need to re-trigger the same production deployment
- the project is not in the bounded recovery allowlist

Important:

- rollback leaves production auto-assignment disabled until a later explicit promote or undo step

### `vercel.promote`

Use when:

- production is intentionally rolled back and you need to restore forward production flow
- dry run can pin the exact promote candidate
- the project is explicitly allowlisted for promote

Do not use when:

- dry run cannot pin a promote candidate
- the request is still only in `Dry Run`

## Pre-Flight Checklist

Before any live Vercel deployment-control action:

- the request status is `Approved`
- the source type is `Manual`
- the request is `Ready for Live`
- the `Provider Request Key` is populated for rollback or promote
- the target project and source row match exactly
- `VERCEL_TOKEN` is available in the runtime performing the action

## Action-Specific Checks

### Redeploy

Confirm dry run shows:

- the exact deployment id that will be redeployed
- the deployment is for the expected project and environment

### Rollback

Confirm dry run shows:

- current production deployment id
- pinned rollback target deployment id
- that the target is a previous eligible production deployment

### Promote

Confirm dry run shows:

- current rolled-back production deployment id
- pinned promote target deployment id
- that the target is the bounded undo-rollback candidate for the same project

## Post-Action Verification

After any live Vercel action:

- read the provider state directly
- confirm the expected deployment id is now the effective production deployment
- confirm the project id and environment still match
- confirm the execution record shows `Succeeded` and `Confirmed`

Do not trust request status alone without provider confirmation.

## Stop Conditions

Stop immediately if:

- dry run cannot resolve a candidate
- the pinned target changes between dry run and live
- the action is no longer `Ready for Live`
- Vercel accepts the write but production cannot be confirmed on the pinned target
- the request resolves to the wrong project or environment

## Current Recommendation

Do not widen rollback or promote by default.

If another project genuinely needs recovery control, treat it as a new bounded slice and add:

- one additional project
- one dry-run pinning pass
- one live execution
- one provider confirmation
