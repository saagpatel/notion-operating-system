# GitHub Support Maintenance

This is the operator guide for the GitHub-backed support-maintenance lane in `Local Portfolio Projects`.

## Purpose

Use this lane to keep the support databases aligned with live GitHub repo evidence without running a broader portfolio overhaul.

It currently covers:

- GitHub-backed support rows in the skills, research, and AI tools databases
- repo-backed summary refreshes for existing support rows
- project relation backfills for the GitHub-backed support slice
- support-database hygiene for exact duplicates, approved near-duplicate merges, and low-risk sandbox clutter

It does not currently cover:

- broad project-page narrative rewrites
- non-GitHub support discovery for thinly linked projects
- risky archiving of weakly linked support rows

## Default Command

```bash
npm run portfolio-audit:github-support-maintenance
```

Run this first in dry-run mode. It combines:

- `npm run portfolio-audit:github-knowledge-audit`
- `npm run portfolio-audit:support-database-hygiene-pass`

## When To Run Live

Use live mode only when the dry run shows real work to do:

- missing GitHub-backed skill, research, or tool rows
- repo-backed summary drift on existing support rows
- missing project relations in the GitHub-backed support slice
- known duplicate cleanup already covered by the hygiene pass

Live command:

```bash
npm run portfolio-audit:github-support-maintenance -- --live
```

## Safe Cleanup Rules

The automated live lane is intentionally narrow. Safe cleanup currently means:

- refresh repo-backed markdown and mapped properties for supported rows
- backfill project relations for the GitHub-backed slice
- archive exact-duplicate support rows
- archive low-risk sandbox rehearsal rows
- apply only explicitly approved near-duplicate merges already encoded in the repo

The lane should not automatically:

- archive weakly linked or zero-linked support rows
- invent placeholder skills, research, or tools
- run broader portfolio refresh commands
- touch unrelated Notion operating surfaces outside this maintenance slice

## Review Commands

Use these before expanding cleanup scope:

```bash
npm run portfolio-audit:stale-support-audit
npm run portfolio-audit:project-support-coverage-audit
```

`stale-support-audit` is review-first. It now distinguishes between actionable weak rows and intentionally single-project rows so an operator can decide whether a row is still useful, intentionally narrow, or ready for merge/archive review.

The intentional-single-project classification list lives in `config/stale-support-classifications.json`.

`project-support-coverage-audit` is also review-first. It ranks projects with thin support coverage and shows any reverse-link backfill opportunities already present in the support databases.

## Weekly Rhythm

1. Run `npm run portfolio-audit:github-support-maintenance`.
2. If the dry run is clean, stop there.
3. If it shows real drift, rerun with `-- --live`.
4. Re-run the dry command to confirm the lane settled cleanly.
5. Review `stale-support-audit` and `project-support-coverage-audit` outputs when you want to reduce long-tail support clutter or strengthen project support coverage.
