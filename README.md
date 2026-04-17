# Notion Operating System

A local automation layer that turns Notion into a real project and portfolio control system.

The system connects three surfaces: **Notion** (databases, dashboards, weekly reviews), **GitHub** (open PRs, workflow runs, issue/comment actuation), and **Vercel** (redeploy, rollback, promote). All automation is config-driven, auditable, and dry-run-first.

## What It Does

- Publishes local Markdown files into the right Notion pages and databases
- Maintains a project control tower with derived PM signals (Operating Queue, Review Date, Evidence Freshness)
- Syncs GitHub repo activity as external signals that inform project recommendations
- Executes governed GitHub mutations (issues, labels, assignees, PR comments) through a dry-run → approval → live pipeline
- Executes governed Vercel recovery actions (redeploy, rollback, promote) through the same pipeline
- Generates weekly review packets, command-center pages, and governance health snapshots
- Stores all rules, policies, and config in code so the setup is portable and versionable

## First Operator Checkpoint

Before anything else, run the health report to see the current governance posture:

```bash
npm run governance:health-report
```

This shows live action-request coverage, execution status, dry-run staleness, and any attention items — without touching Notion or GitHub.

## Install

Use the install path that matches how much control you want:

- **GitHub ref install**: install directly from a tagged GitHub ref
- **GitHub release tarball install**: most locked-down verified artifact
- **local repo development**: working on the repo itself, source-first workflow

```bash
# GitHub ref install
npm install github:saagpatel/notion-operating-system#v0.2.0

# GitHub release tarball install
npm install https://github.com/saagpatel/notion-operating-system/releases/download/v0.2.0/notion-operating-system-0.2.0.tgz

# local repo development
npm ci
```

## First Run (New Machine)

```bash
npm ci
cp .env.example .env
# fill in NOTION_TOKEN (required), GITHUB_TOKEN (for signal sync),
# GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PEM (for governed GitHub writes)
npm run doctor
npm run verify
```

Then start with a dry-run publish:

```bash
npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly.md
```

Add `--live` only when you are satisfied with the dry-run output.

## Main Workflows

### 1. Refresh the control tower

```bash
# Preview what would change
npm run portfolio-audit:control-tower-sync

# Write derived PM signals and refresh the command-center page
npm run portfolio-audit:control-tower-sync -- --live
```

### 2. Publish content into Notion

```bash
# Dry run (default)
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md

# Live write
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md --live
```

### 3. Generate the weekly review packet

```bash
npm run portfolio-audit:review-packet -- --live
```

Run this **before** any command that patches the "latest weekly" managed section (signals, recommendations, action-request sync). If the current week's page does not exist yet, those commands land on the wrong weekly page.

### 4. Sync GitHub signals

```bash
# Recompute from existing Notion rows (no GitHub fetch)
npm run portfolio-audit:external-signal-sync

# Fetch fresh data from GitHub
npm run portfolio-audit:external-signal-sync -- --provider github --live
```

### 5. Governed GitHub actions (dry-run → approval → live)

GitHub mutations follow a strict three-step pipeline. Never skip steps.

**Step 1 — Dry run** (validates, checks policy, computes what would change):
```bash
npm run portfolio-audit:action-dry-run -- --request <action-request-page-id>
```

**Step 2 — Approval**: In Notion, set the action request row to `Status = Approved`, fill in `Approver` and `Decided At`.

**Step 3 — Live execution**:
```bash
npm run portfolio-audit:action-runner -- --mode live --request <action-request-page-id>
```

After execution, sync governance summaries:
```bash
npm run portfolio-audit:action-request-sync -- --live
```

Supported actions: `github.create_issue`, `github.update_issue`, `github.set_issue_labels`, `github.set_issue_assignees`, `github.add_issue_comment`, `github.comment_pull_request`.

### 6. Governed Vercel actions

Same three-step pipeline as GitHub. Supported actions: `vercel.redeploy`, `vercel.rollback`, `vercel.promote`.

Requires `VERCEL_TOKEN` in your `.env`. The live gate also requires a successful dry run within the last 24 hours.

### 7. Weekly live sequence (correct order)

```bash
npm run portfolio-audit:control-tower-sync -- --live          # 1. derive PM signals
npm run portfolio-audit:review-packet -- --live               # 2. create/refresh weekly page
npm run portfolio-audit:external-signal-sync -- --provider github --live  # 3. sync GitHub signals
npm run portfolio-audit:recommendation-run -- --type weekly --live        # 4. run recommendations
npm run portfolio-audit:action-request-sync -- --live         # 5. sync governance summaries
```

## Common Commands

| Command | What it does |
|---|---|
| `npm run governance:health-report` | Governance health snapshot (no writes) |
| `npm run destinations:check` | List configured Notion destination aliases |
| `npm run destinations:resolve` | Resolve and persist Notion IDs for all destinations |
| `npm run portfolio-audit:control-tower-sync` | Refresh derived PM signals (dry-run) |
| `npm run control-tower:schema-report` | Analyze property usage before schema cleanup or deletion |
| `npm run portfolio-audit:review-packet` | Generate weekly review packet (dry-run) |
| `npm run portfolio-audit:external-signal-sync -- --provider github --live` | Sync GitHub signals (live) |
| `npm run portfolio-audit:recommendation-run -- --type weekly` | Weekly recommendations (dry-run) |
| `npm run portfolio-audit:action-request-sync -- --live` | Sync governance summaries |
| `npm run portfolio-audit:action-dry-run -- --request <id>` | Dry-run a governed action |
| `npm run portfolio-audit:action-runner -- --mode live --request <id>` | Execute an approved action |
| `npm run portfolio-audit:operational-rollout` | Operational rollout plan |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Run Vitest tests |
| `npm run verify` | Full local release gate (typecheck + test + build + smoke) |
| `npm run verify:fresh-clone` | Fresh-machine confidence check |
| `npm run doctor` | Verify local setup |

## Key Config Files

| File | Contains |
|---|---|
| `config/destinations.json` | Notion destination aliases and resolved IDs |
| `config/local-portfolio-control-tower.json` | Control tower rules, review cadence, runner limits, live gating |
| `config/local-portfolio-governance-policies.json` | Action policies for governed external mutations |
| `config/local-portfolio-actuation-targets.json` | GitHub/Vercel allowlist with per-target permissions |
| `config/local-portfolio-views.json` | Saved view definitions |

## Safety Defaults

- **Dry-run first.** Every command defaults to dry-run unless `--live` is explicitly passed.
- **Governed writes only.** GitHub and Vercel mutations require: approved action request, non-expired request, active target, and a successful dry run (max 24 hours old).
- **No hardcoded tokens.** All tokens come from environment variables.
- **Additive posture.** Labels and assignees are additive-only — removal requires a new desired-state request.
- **Compensation is manual.** There is no automated compensation runner. Corrections are operator-driven.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes | Notion integration token |
| `GITHUB_TOKEN` | For signal sync | GitHub PAT for polling PRs and workflow runs |
| `GITHUB_APP_ID` | For governed GitHub writes | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PEM` | For governed GitHub writes | GitHub App private key |
| `GITHUB_APP_WEBHOOK_SECRET` | For webhook verification | Shared secret for delivery validation |
| `VERCEL_TOKEN` | For governed Vercel writes | Vercel API token |
| `NOTION_LOG_DIR` | Optional | Log directory (default: `./logs`) |

## Sandbox Profile Discipline

Use a `sandbox` profile as the default proving ground before live changes that touch control-tower, signals, governance, rollout, or profile flows.

```bash
npm run sandbox:smoke
notion-os --profile sandbox doctor
```

The sandbox profile isolates tokens and Notion targets from your primary profile. The sandbox doctor fails if the sandbox token matches the primary token or if any sandbox target overlaps primary targets.

See [docs/sandbox-rehearsal-runbook.md](docs/sandbox-rehearsal-runbook.md) for the full rehearsal path.

## Project Docs

- [First-run onboarding](docs/first-run.md)
- [Architecture overview](docs/architecture-overview.md)
- [GitHub governed actions runbook](docs/github-governed-actions-runbook.md)
- [Governance sync failure troubleshooting](docs/governance-sync-failure-troubleshooting.md)
- [Governance incident follow-up runbook](docs/governance-incident-followup-runbook.md)
- [Maintenance playbook](docs/maintenance-playbook.md)
- [Sandbox rehearsal runbook](docs/sandbox-rehearsal-runbook.md) — proving path before risky live writes
- [Release process](docs/release-process.md)
- [Roadmap](docs/notion-roadmap.md)
