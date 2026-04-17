# Script Surface Classification

Updated: 2026-03-29

## Purpose

This note records which commands belong in the shared CLI and which scripts are intentionally left outside the durable operator surface.

Use this file when deciding whether a legacy script should be migrated, kept as a compatibility wrapper, or left as a one-off internal utility.

Preferred operator surface:

- `notion-os ...`
- modern npm aliases such as `control-tower:sync`, `governance:audit`, `signals:sync`, and `rollout:operational`

Legacy `portfolio-audit:*` script names remain compatibility aliases where they still matter, but they are no longer the recommended default surface.

## Shared CLI

These commands are part of the durable shared CLI surface and should stay discoverable through `notion-os` and `src/cli.ts`.

### Core

- `publish`
- `doctor`
- `destinations check`
- `destinations resolve`
- `profiles list`
- `profiles show`
- `profiles migrate`
- `profiles export`
- `profiles import`

### Control Tower

- `control-tower sync`
- `control-tower review-packet`
- `control-tower phase-closeout`
- `control-tower views-plan`
- `control-tower views-validate`

### Execution

- `execution sync`
- `execution weekly-plan`
- `execution views-validate`

### Intelligence

- `intelligence sync`
- `intelligence recommendation-run`
- `intelligence link-suggestions-sync`
- `intelligence views-validate`

### Signals

- `signals sync`
- `signals seed-mappings`
- `signals activity-refresh`
- `signals views-validate`
- `signals provider-expansion-audit`

### Governance

- `governance action-request-sync`
- `governance action-dry-run`
- `governance action-runner`
- `governance audit`
- `governance views-validate`
- `governance actuation-audit`
- `governance webhook-shadow-drain`
- `governance webhook-reconcile`

### Rollout

- `rollout operational`
- `rollout cohort`
- `rollout vercel-readiness`

## Compatibility Wrappers

These legacy script entrypoints still matter for npm-script compatibility, but they should delegate to the shared CLI instead of growing their own command surface again.

- existing wrapper entrypoints from Phases 2 through 6
- modern npm aliases for durable workflows should point at `tsx src/cli.ts ...`
- legacy `portfolio-audit:*` aliases should prefer `tsx src/cli.ts ...` whenever an equivalent shared subcommand exists
- direct `src/notion/*.ts` execution is no longer the preferred compatibility surface for migrated workflows

## One-Off Or Internal Scripts

These scripts are intentionally left outside the shared CLI in Phase 6. They may still be useful, but they are not part of the durable operator surface.

### Batch, Backfill, Manual, Or Refresh Utilities

- all `batch-*` scripts
- all `backfill-*` scripts
- all `manual-*` scripts
- all `refresh-*truth` scripts

### Narrow Or Historical Utilities

- `audit-batch-1`
- `catch-up-selected-github-projects`
- `close-selected-batch-loop`
- `overhaul-local-portfolio`
- `phase2-overhaul-notion`
- `phase3-overhaul-notion`
- `phase4-overhaul-notion`
- `phase5-overhaul-notion`
- `phase6-overhaul-notion`
- `phase7-overhaul-notion`
- `phase8-overhaul-notion`
- `schema-migrate`
- `schema-migrate-probe`
- `upgrade-operating-databases`
- `native-overlay-audit`
- `fill-empty-local-project-fields`
- `github-notion-catch-up`
- `notion-hygiene-pass`
- `validate-local-portfolio-actuation-views`
- `validate-local-portfolio-github-views`
- `validate-local-portfolio-native-dashboards`
- `webhook-shadow-server`
- `portfolio-audit:generate`
- `portfolio-audit:publish-notion`

The clearest internal-only legacy utilities are now quarantined under:

- `src/internal/portfolio-audit/`
- `src/internal/notion-maintenance/`

They still have compatibility scripts where needed, but they are not part of the recommended operator surface.

## Default Rule For Future Work

Before promoting any legacy script into the shared CLI, confirm that it is:

- durable
- operator-facing
- worth documenting
- worth testing through the central command system

If it is batch-specific, migration-specific, or mainly useful for one narrow recovery job, keep it out of the shared CLI unless a later roadmap phase explicitly changes that decision.
