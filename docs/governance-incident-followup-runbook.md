# Governance Incident Follow-Up Runbook

Updated: 2026-04-14

## Purpose

Use this runbook when the governance command center or the actuation lane shows something that needs operator follow-up now, especially:

- `Compensation Needed`
- repeated `Failed` executions
- requests that should be ready but keep getting blocked
- health-report warnings tied to missing credentials or unsafe targets

This is the small follow-up playbook for the bounded governance system, not a full incident handbook.

## Start Here

Run these in order:

1. `npm run governance:health-report`
2. `npm run governance:action-request-sync -- --live`
3. read the command-center sections:
   - `Governance Health`
   - `Action Attention`

Then classify the issue.

## Issue Types

### 1. Compensation-needed execution

What it means:

- the system attempted the write
- the final provider state could not be confirmed safely

What to do:

1. open the latest execution record
2. read:
   - `Response Summary`
   - `Reconcile Status`
   - `Compensation Plan`
3. verify the provider result directly
4. decide whether the provider already reflects the intended state

If the provider does match the intended state:

- create a corrective follow-up note or request rather than silently assuming the system is fine

If the provider does not match the intended state:

- follow the compensation plan
- create the smallest corrective request that restores the intended state

Do not hand-edit Notion records just to make the incident disappear.

### 2. Failed execution

What it means:

- the write did not complete successfully enough to count as a partial state change

What to do:

1. inspect the execution record
2. confirm whether the failure is:
   - auth
   - permission
   - validation
   - transient provider issue
3. fix the underlying cause first
4. rerun only after the dry run is still clean

### 3. Ready-for-live request that should not wait

What it means:

- there is actionable work sitting in the lane

What to do:

1. confirm the request is still `Ready for Live`
2. confirm the operator packet still reflects the current target state
3. run one live execution only
4. re-sync the summaries after the run

Keep the lane serial. Do not batch live actions just because several requests are ready.

### 4. Health warnings caused by credentials or target safety gaps

What it means:

- the system is warning before a live action goes wrong

What to do:

1. fix missing env vars or webhook secrets
2. fix blocked actuation targets before new live use
3. rerun `npm run governance:health-report`
4. rerun `npm run governance:action-request-sync -- --live`

## Follow-Up Rules

- Fix the smallest thing that explains the signal.
- Prefer a new corrective governed request over manual provider drift.
- Re-run sync after meaningful follow-up so the command center reflects the current truth.
- If you cannot prove the provider end-state, treat the incident as still open.

## Useful Commands

```bash
npm run governance:health-report
npm run governance:audit
npm run governance:actuation-audit
npx tsx src/cli.ts governance action-dry-run --request <page-id>
npx tsx src/cli.ts governance action-runner --mode live --request <page-id>
npx tsx src/cli.ts governance action-request-sync --live
```

## Rule Of Thumb

The command center should answer:

- what is unhealthy
- what needs attention now
- what should happen next

If it cannot answer those three questions after sync, stop and tighten the incident trail before taking another live action.
