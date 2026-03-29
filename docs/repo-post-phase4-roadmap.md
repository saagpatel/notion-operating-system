# Repo Roadmap After Phase 4

Updated: 2026-03-29

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

Status: Completed on the local Phase 5 branch state.

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

Status: Completed on the local Phase 6 branch state.

Primary outcomes:

- fewer important commands live outside the shared CLI
- less script sprawl
- cleaner operator discovery and docs

Docket:

- audit the remaining one-off scripts by keep, migrate, or retire
- move the highest-value retained scripts into the shared CLI
- remove duplicated parsing and normalize help text for the migrated flows
- record the shared-cli, wrapper, and one-off split in repo memory

Completed outcomes:

- promoted durable audit and validation commands into the existing `governance`, `execution`, `intelligence`, and `signals` families
- kept their legacy source entrypoints as compatibility wrappers for npm-script stability
- left batch, backfill, manual, overhaul, native-overlay, and other narrow utilities outside the shared CLI on purpose
- recorded the durable command-surface decisions in `docs/script-surface-classification.md`

## Phase 7: Deeper Observability and Operator Diagnosis

Status: Completed on the local Phase 7 branch state.

Primary outcomes:

- easier explanation of partial success, warnings, and live-write impact
- easier log inspection

Docket:

- richer command summaries
- warning/failure taxonomy
- recent-run inspection helper
- clearer change summaries for live sync commands

Completed outcomes:

- enriched shared run summaries with status and category fields instead of counts alone
- added the bounded warning and failure taxonomy for the first operator diagnosis slice
- improved Notion HTTP classification so recovered retries and terminal failures surface more clearly in run logs
- added `logs recent` as the read-only CLI entrypoint for recent run inspection
- kept existing JSON stdout contracts stable while making the run logs more decision-useful

## Phase 8: Profile Portability and Config Lifecycle

Status: Completed on the local Phase 8 branch state.

Primary outcomes:

- smoother multi-machine operation
- safer profile migration and bootstrap

Completed outcomes:

- extended the existing `profiles` family with `diff`, `clone`, `bootstrap`, and `upgrade`
- added preview-first profile portability flows that never export or overwrite secrets
- introduced profile descriptor config versioning plus a first migration path from legacy unversioned descriptors and bundles
- centralized the portable profile asset manifest so export, import, diff, clone, bootstrap, and upgrade all use the same file set

## Phase 9: Product-Shape Cleanup

Status: Completed on the local Phase 9 branch state.

Primary outcomes:

- clearer boundary between reusable toolkit and operator-specific system
- less historical clutter

Completed outcomes:

- added modern npm aliases for the durable advanced workflow families while keeping the older `portfolio-audit:*` script names as compatibility aliases
- tightened the root package surface so reusable toolkit exports stay in `src/index.ts` and repo-specific operating-system exports stay behind `./advanced`
- quarantined the clearest internal-only historical utilities under `src/internal/portfolio-audit/` without broad script churn
- refreshed the main docs so the preferred operator surface is `notion-os ...` plus modern npm aliases, with legacy script names documented as compatibility only

## Optional Phase 10: Public Release Readiness

Only do this if the project should become more than a repo-local operator tool.

Primary outcomes:

- distributable CLI posture
- versioning and release process
- public install and usage guidance

## Recommended Immediate Next Track

There is no required structural Phase 10 after this cleanup. The next track should be **Optional Phase 10: Public Release Readiness**, but only if the project is intended to become more than a repo-local operator tool.

Why this is optional now:

- the repo now has a clearer product shape after Phase 9, so the remaining work is no longer rescue or cleanup work
- public release overhead only makes sense if outside installation, versioning, and support boundaries are actually desired
- if the repo stays private/operator-local, the current shape is already much healthier and does not require another mandatory cleanup phase

## Optional Phase 10 Docket

If public-release planning starts later, use this as the working docket:

1. define package versioning and changelog expectations
2. add public install and upgrade guidance for `notion-os`
3. harden package metadata and consumer-facing exports for outside use
4. decide how much of the advanced operating-system layer stays private versus public
5. add release workflow automation only after the support boundary is clear

## Not Yet Recommended

These are real options, but they should not come first:

- broad public release work
- major breaking CLI redesign
- large-scale doc rewrites of historical audit artifacts
- sweeping conversion of every legacy one-off script before the advanced workflows are more trusted
