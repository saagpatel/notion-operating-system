# Weekly Refresh Cutover Review

Updated: Tuesday, April 7, 2026 at 9:52 AM PDT

This document turns the weekly-refresh rollout work into a concrete cutover decision and execution checklist.

Use it after a clean shadow run and before changing the live automation posture.

## Current Recommendation

Status: conditional go

Interpretation:

- engineering readiness is pass
- rollout readiness is almost pass
- final promotion should wait for one clean scheduled `weekly-refresh-shadow` run

Do not cut over today unless the scheduled-shadow requirement is intentionally waived.

## Evidence Snapshot

The following evidence is already in hand:

- `main` includes the weekly refresh implementation and the automation worktree bootstrap fix
- manual shadow pass completed clean on Tuesday, April 7, 2026
- automation-style detached worktree validation completed clean on Tuesday, April 7, 2026
- manual live pilot previously completed successfully
- immediate post-pilot dry rerun previously completed clean

Clean manual shadow result on Tuesday, April 7, 2026:

- `clean=6`
- `drift=0`
- `failed=0`
- `partial=0`
- `needsLiveWrite=false`

Current automation posture on Tuesday, April 7, 2026:

- `weekly-refresh-shadow`: `ACTIVE`
- `weekly-github-notion-maintenance`: `ACTIVE`
- `weekly-command-center`: `ACTIVE`
- `shadow-run-today`: `PAUSED`

Next scheduled runs:

- `weekly-github-notion-maintenance`: Tuesday, April 7, 2026 at 7:00 PM PDT
- `weekly-command-center`: Monday, April 13, 2026 at 8:00 AM PDT
- `weekly-refresh-shadow`: Monday, April 13, 2026 at 7:15 PM PDT

## Gate Review

### Gate 1: Implementation Verification

Status: pass

Pass basis:

- weekly-refresh implementation merged on `main`
- automation worktree bootstrap fix merged on `main`
- the repo is back on `main` and clean

### Gate 2: Reliability Hardening Checkpoint

Status: pass

Pass basis:

- no remaining bare transport-failure blocker
- weekly-refresh dry run now completes without failed or partial steps
- output distinguishes clean state from real drift

### Gate 3: Healthy Shadow Evidence

Status: partial pass

Pass basis already available:

- manual shadow pass is clean
- detached automation worktree run is clean after the runner fix

Still pending:

- one clean scheduled `weekly-refresh-shadow` inbox run

Decision:

- treat this as enough evidence to prepare cutover
- do not treat it as enough evidence to execute cutover yet

### Gate 4: Manual Live Pilot

Status: pass

Pass basis:

- manual live pilot completed successfully in the hardening phase
- the immediate dry rerun after the live pilot returned clean convergence

### Gate 5: Cutover Approval

Status: not yet approved

Blocking condition:

- the clean scheduled `weekly-refresh-shadow` run has not happened yet

## Cutover Approval Rule

Approve cutover immediately after the next clean scheduled `weekly-refresh-shadow` run if all of the following are true:

- no step is `failed`
- no step is `partial`
- runtime is operationally reasonable
- the report remains readable and bounded
- the automation environment behaves the same way as the validated manual worktree run

If the scheduled shadow run is noisy but understandable:

- fix the issue
- require one more healthy shadow cycle
- do not promote on ambiguous evidence

## Promotion Checklist

Run this checklist only after cutover approval is granted.

### 1. Final Pre-Cutover Review

- confirm [`docs/weekly-refresh-rollout-scorecard.md`](/Users/d/Notion/docs/weekly-refresh-rollout-scorecard.md) still reads as pass
- confirm `main` is clean locally
- confirm `weekly-refresh-shadow` is still `ACTIVE`
- confirm `weekly-github-notion-maintenance` is still `ACTIVE`
- confirm `weekly-command-center` is still unchanged and `ACTIVE`

### 2. Create The New Live Automation

Create a new live weekly-refresh automation rather than mutating `weekly-refresh-shadow`.

Required properties:

- name should clearly indicate live weekly refresh
- run on the intended Monday weekly slot
- use `/Users/d/Notion` as the working checkout
- run `npm run maintenance:weekly-refresh -- --live`
- produce exactly one inbox item with the weekly-refresh summary

Do not reuse `weekly-refresh-shadow` as the live job.

### 3. Activate The New Live Automation

- enable the new live weekly-refresh automation
- verify it is present in runtime state as `ACTIVE`
- leave `weekly-refresh-shadow` active for now as rollback scaffolding
- leave `weekly-github-notion-maintenance` active until the new live job exists

### 4. Pause The Old Support-Only Lane

After the new live weekly-refresh automation is active:

- pause `weekly-github-notion-maintenance`
- verify runtime state shows it as `PAUSED`

Do not pause the old support-only lane before the new live weekly-refresh automation is active.

### 5. First Live Automated Run Review

After the first live weekly-refresh automation run:

- confirm overall status is `completed` or `clean`
- confirm no step is `failed` or `partial`
- confirm freshness-by-layer data updated correctly
- confirm the inbox/report output is readable enough to serve as the new default weekly report

### 6. Pause Shadow After Live Success

Only after the first live automated weekly-refresh run succeeds:

- pause `weekly-refresh-shadow`
- verify runtime state shows it as `PAUSED`

If you want to keep it for rollback/debug visibility, keep the definition but keep it inactive.

## Rollback Checklist

Use this if the first live automated weekly-refresh run is partial, failed, or operationally confusing.

### Immediate Response

- pause the new live weekly-refresh automation
- keep or re-enable `weekly-refresh-shadow` for dry-run diagnosis
- re-enable `weekly-github-notion-maintenance` if it was paused

### Stabilization Review

- review the failing live automation report
- compare it to the clean shadow evidence
- decide whether the issue is automation-environment drift, data drift, or live-write logic regression
- do not retry live promotion until the failure is understood

### Return-To-Promotion Rule

Only attempt promotion again after:

- the cause is fixed
- a clean shadow run exists again
- a clean manual live validation exists again if the failure touched live-write behavior

## Final Completion Review Template

When cutover is complete, write a short closeout with these four sections:

### 1. What Phase 2 Shipped

- weekly refresh orchestrator
- shared weekly-step contract
- managed-section preservation
- freshness-by-layer tracking
- CLI and package wiring
- tests and rollout docs
- automation worktree bootstrap hardening

### 2. What Was Validated During Rollout

- reliability hardening checkpoint
- clean shadow evidence
- clean live pilot
- clean post-pilot dry rerun
- clean first live automation run

### 3. What Changed At Cutover

- new live weekly-refresh automation activated
- old support-only automation paused
- shadow automation paused or retained as inactive rollback scaffolding
- command-center automation left unchanged

### 4. Post-Cutover Follow-Up Work

- monitor the first few live weekly reports for clarity and bounded runtime
- decide whether shadow automation should remain as a dormant debug lane
- consider future GitHub signal collection improvements without blocking this cutover
