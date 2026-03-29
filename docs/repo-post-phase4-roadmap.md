# Repo Roadmap After Phase 4

Updated: 2026-03-28

## Purpose

This roadmap is for the repo itself.

It is separate from `docs/notion-roadmap.md`, which tracks the Notion operating-system phases inside the portfolio data model. This document tracks the software and repo follow-up work after the local Phase 1 through Phase 4 repo-improvement program.

## Current Position

The repo has already completed four structural phases:

1. CI, shared runtime config, expanded env guidance, doctor, and package identity cleanup
2. Shared CLI, help output, standardized flag parsing, onboarding docs, and wrapper compatibility
3. Workspace profiles, installable `notion-os` bin, profile import/export, and core vs advanced package separation
4. Shared command observability, stronger verification, built-package CI coverage, optional git hooks, and doc/handoff cleanup

That means the project now has a stable base. The next work should focus on capability and trust, not rescue-level cleanup.

## Decision Principles

Use these rules for future repo work:

- Keep compatibility-first behavior unless a break is clearly worth it
- Prefer moving high-value workflows into the shared CLI over adding more one-off scripts
- Raise trust in advanced workflows before expanding to entirely new surfaces
- Keep the repo as the canonical memory, not chat history
- Treat public release work as optional until the private operator experience feels complete

## Backlog Buckets

### A. Command coverage and script reduction

Goal: reduce the long tail of legacy commands that still sit outside the shared operator surface.

Work in this bucket:

- identify high-value batch, backfill, and repair commands that still matter operationally
- move the durable ones into the shared CLI with help text and consistent flags
- quarantine or retire truly one-off scripts so they stop looking like core product surface area
- remove remaining custom argument parsing where shared parsing can replace it safely

### B. Advanced-path trust and verification

Goal: make the riskiest workflows easier to trust before expanding scope.

Work in this bucket:

- expand tests for governance, webhook, rollout, and provider-edge behavior
- deepen duplicate-suppression and reconciliation coverage
- improve external-signal and provider-expansion error handling tests
- add more built-CLI smoke coverage for representative advanced commands

### C. Observability and diagnosis

Goal: make failures easier to explain, not just easier to log.

Work in this bucket:

- add richer command-specific run summaries for advanced workflows
- standardize warning categories and partial-success reporting
- add better failure classification across providers and webhook flows
- add a lightweight way to inspect recent run summaries without opening JSONL files manually
- improve live-write change summaries for sync commands

### D. Profile portability and config lifecycle

Goal: make multi-machine and multi-workspace operation smoother.

Work in this bucket:

- add safer profile diffing and preview flows
- add profile cloning and bootstrap helpers
- add config versioning and migration support
- broaden import/export support for repo-owned state that matters operationally

### E. Product-shape cleanup

Goal: decide how clearly the repo should separate reusable publishing from the operator-specific system.

Work in this bucket:

- keep clarifying the core publishing toolkit versus advanced operating workflows
- reduce older narrow publisher naming that still survives in corners of the repo
- decide whether more internals should move behind `./advanced`
- clean up stale docs and historical artifacts that no longer help future sessions

### F. Optional public release track

Goal: make the project installable and distributable beyond the local repo, only if that becomes worth the extra overhead.

Work in this bucket:

- release/versioning discipline
- changelog and publish workflow
- external install docs
- package hardening for outside consumers
- clearer support boundaries between private advanced workflows and public core features

This track is optional and should stay behind the trust and cleanup work above.

## Recommended Phase Sequence

## Phase 5: Advanced Workflow Hardening

Recommended first because it attacks the highest-risk part of the repo.

Primary outcomes:

- stronger advanced-path tests
- better duplicate-suppression and reconciliation confidence
- more representative built-CLI smoke checks
- safer failure handling around providers, webhooks, and rollout flows

Docket:

- governance/action-runner duplicate and failure-path expansion
- provider-expansion and external-signal credential/error-path coverage
- webhook shadow and reconcile edge-case tests
- rollout follow-up sequencing and failure isolation tests
- extra built CLI smoke commands for one control-tower flow, one governance flow, and one signals flow

Exit criteria:

- the main advanced workflows have targeted failure-path tests instead of only happy-path coverage
- built package smoke coverage goes beyond `--help`
- the riskiest operator flows have clearer confidence before we expand scope again

## Phase 6: Script Reduction and Shared CLI Coverage

Primary outcomes:

- fewer important commands live outside the shared CLI
- less script sprawl
- cleaner operator discovery and docs

Docket:

- audit the remaining one-off scripts by keep, migrate, or retire
- move the highest-value retained scripts into the shared CLI
- remove duplicated parsing and normalize help text for the migrated flows

## Phase 7: Deeper Observability and Operator Diagnosis

Primary outcomes:

- easier explanation of partial success, warnings, and live-write impact
- easier log inspection

Docket:

- richer command summaries
- warning/failure taxonomy
- recent-run inspection helper
- clearer change summaries for live sync commands

## Phase 8: Profile Portability and Config Lifecycle

Primary outcomes:

- smoother multi-machine operation
- safer profile migration and bootstrap

Docket:

- profile clone/bootstrap helpers
- profile diff previews
- config versioning and migrations
- broader non-secret state import/export support

## Phase 9: Product-Shape Cleanup

Primary outcomes:

- clearer boundary between reusable toolkit and operator-specific system
- less historical clutter

Docket:

- cleanup of stale docs and old naming
- clearer `core` vs `advanced` boundary decisions
- removal or quarantine of low-value internal artifacts

## Optional Phase 10: Public Release Readiness

Only do this if the project should become more than a repo-local operator tool.

Primary outcomes:

- distributable CLI posture
- versioning and release process
- public install and usage guidance

## Recommended Immediate Next Phase

The next phase should be **Phase 5: Advanced Workflow Hardening**.

Why this should come next:

- the foundation is already strong enough
- the most meaningful remaining risk is in the advanced workflows, not the CLI shell
- expanding trust first makes later command migration and product cleanup much safer

## Immediate Phase 5 Docket

If planning starts now, use this as the working docket:

1. Add targeted tests for `action-runner`, `action-dry-run`, and governance duplicate suppression
2. Add targeted tests for external-signal/provider failure paths, partial credentials, and unsupported providers
3. Add targeted tests for webhook shadow and reconcile edge cases
4. Add targeted tests for rollout follow-up sequencing and failure isolation
5. Add built CLI smoke checks for representative advanced commands
6. Review the resulting gaps and only then decide whether some old scripts need to move sooner into the shared CLI

## Not Yet Recommended

These are real options, but they should not come first:

- broad public release work
- major breaking CLI redesign
- large-scale doc rewrites of historical audit artifacts
- sweeping conversion of every legacy one-off script before the advanced workflows are more trusted
