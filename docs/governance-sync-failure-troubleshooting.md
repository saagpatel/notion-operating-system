# Governance Sync Failure Troubleshooting

Updated: 2026-04-14

## Purpose

Use this guide when a governance refresh or related write command feels off, especially:

- `npx tsx src/cli.ts governance action-request-sync --live`
- `npm run governance:audit`
- `npm run governance:actuation-audit`
- `npm run governance:health-report`

This is a fast triage guide, not a deep architecture doc.

## Start Here

Run the compact snapshot first:

```bash
npm run governance:health-report
```

If that is clean, move to the specific failing command.
If that shows warnings, fix the warnings before assuming the sync command itself is broken.

## Common Failure Shapes

### 1. Missing credential or secret warnings

Symptoms:

- `Missing VERCEL_TOKEN`
- missing GitHub App env vars
- missing webhook secret env vars
- health report shows `missing_credentials`

What it usually means:

- the runtime performing the command does not have the live auth it needs

What to do:

1. run `npm run governance:health-report`
2. confirm which env vars are missing
3. restore the missing env vars
4. rerun the original command

Stop here if live credentials are missing. Do not keep retrying live commands.

### 2. `action-request-sync --live` reports skipped project pages

Symptoms:

- output contains `failedProjectPageCount`
- output lists `failedProjectPageIds`
- one or more pages were skipped but the overall command still completed

What it usually means:

- a specific project page has markdown that could not be updated cleanly
- the fail-soft behavior protected the rest of the run

What to do:

1. note the affected page ids from `failedProjectPageIds`
2. rerun the sync once to confirm it is repeatable
3. inspect the specific page content or managed section markers
4. fix the single page issue instead of treating the whole portfolio as broken

Important:

- a non-zero `failedProjectPageCount` is a page-level issue, not automatically a system-wide sync failure

### 3. `action-request-sync --live` reports skipped summary targets

Symptoms:

- output contains `failedSummaryTargets`

What it usually means:

- one of the shared summary surfaces could not be updated cleanly

What to do:

1. rerun `npm run governance:health-report`
2. run `npm run governance:audit`
3. run `npm run governance:actuation-audit`
4. inspect the named summary targets in the command output
5. fix the specific target instead of widening the blast radius

Stop and escalate if multiple summary targets fail in the same run.

### 4. Audit looks clean but dry run is blocked

Symptoms:

- `governance:health-report` is mostly healthy
- the request still will not reach `Ready for Live`

What it usually means:

- the problem is request-specific, not posture-wide

What to do:

1. run `npx tsx src/cli.ts governance action-dry-run --request <page-id>`
2. read the request-specific validation notes
3. confirm:
   - request status
   - allowed source type
   - target repo or provider target
   - any pinned provider request key requirements

### 5. Live execution succeeded but reconcile or confirmation did not

Symptoms:

- the write was accepted
- reconcile status is not `Confirmed`
- execution status is `Compensation Needed` or mismatch-like

What it usually means:

- the provider accepted the mutation but the system could not prove the expected final state

What to do:

1. verify the provider state directly
2. compare it with the request and dry-run packet
3. treat the execution as unresolved until the target state is proven

Do not paper over this by manually marking the request healthy.

## Safe Command Ladder

Use this order when triaging:

1. `npm run governance:health-report`
2. `npm run governance:audit`
3. `npm run governance:actuation-audit`
4. `npx tsx src/cli.ts governance action-request-sync --live`
5. `npx tsx src/cli.ts governance action-dry-run --request <page-id>`
6. `npx tsx src/cli.ts governance action-runner --mode live --request <page-id>`

Do not skip directly to live execution when the earlier steps already show warnings.

## When To Stop Immediately

Stop and fix the underlying issue before continuing if:

- required credentials are missing
- the health report shows blocked live-safe targets
- the dry run cannot resolve a target
- the request is not actually `Ready for Live`
- reconcile cannot confirm the provider result

## Rule Of Thumb

Treat sync problems as one of three categories:

- posture problem: health report and audits are warning
- page problem: a specific page or summary target is skipped
- request problem: one action request cannot graduate or confirm

Classify the problem first, then fix the smallest thing that explains it.
