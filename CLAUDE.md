# Notion Operating System

## 1. Purpose

This repo is the automation and rules layer for a personal project management operating system. It bridges two systems:

- **Notion** is the project operating surface — databases, views, dashboards, weekly reviews, and day-to-day PM decisions all live here.
- **GitHub** is an external signal source and a governed action target — repo activity feeds into portfolio intelligence, and approved mutations (issues, comments, labels) flow out through a strict approval pipeline.
- **This repo** owns the config, logic, safety defaults, and audit trails that connect the two. It publishes content into Notion, syncs external signals, computes derived PM fields, generates review packets, and executes governed GitHub actions.

The repo replaces ad hoc manual Notion editing and GitHub mutation with deterministic, auditable, config-driven workflows.

## 2. Mental Model

### What lives in Notion

- **Local Portfolio Projects** — the operational control tower (ADR 0001). Every project has a row here with manual fields (Current State, Portfolio Call, Next Move, etc.) and derived fields (Operating Queue, Next Review Date, Evidence Freshness, etc.).
- **Supporting databases** — Build Log, Weekly Reviews, Project Decisions, Work Packets, Execution Tasks, Research Library, Skills Library, AI Tool & Site Matrix, Recommendation Runs, Link Suggestions.
- **Governance databases** — External Action Policies, External Action Requests, External Action Executions, Webhook Endpoints/Deliveries/Receipts.
- **External signal databases** — External Signal Sources, External Signal Events, External Signal Sync Runs.
- **Command Center page** — an evergreen page with linked views and generated markdown sections.
- **Saved views** — 8 primary views (Portfolio Home, Resume Now, Worth Finishing, Needs Decision, Needs Review, Cold Storage, By Category, Gallery Snapshot) plus GitHub-specific action views.

### What lives in GitHub

- Repos mapped as External Signal Sources with provider=GitHub.
- Open pull requests and workflow runs polled as External Signal Events. The signal type enum also includes Deployment, Release, Issue, Issue Comment, and Calendar Block, but the current GitHub sync adapter polls PRs and workflow runs.
- Governed mutations: issue creation/update, label sync, assignee sync, issue comments, PR comments.

### What the repo does between them

1. **Reads Notion** — fetches project rows, build sessions, decisions, recommendations, signals.
2. **Computes derived state** — applies PM signals, recommendation scores, external signal summaries.
3. **Writes Notion** — updates derived fields, publishes command-center markdown, generates weekly review packets.
4. **Reads GitHub** — polls repos for open PRs and workflow runs (in `--live` mode only; dry-run recomputes from existing Notion rows without hitting GitHub).
5. **Writes GitHub** — executes approved action requests through a dry-run → approval → live pipeline.

### Source of truth

The **Local Portfolio Projects** database is the operational source of truth for project state. The repo config files are the source of truth for rules, policies, schema, and destination mappings. Manual fields and derived fields must stay conceptually separate — do not casually overwrite manual fields when a sync lane owns derived fields.

### Which command writes which derived fields

- **`control-tower-sync`** writes: Operating Queue, Next Review Date, Evidence Freshness. Also refreshes the Command Center page markdown.
- **`external-signal-sync`** writes: External Signal Coverage, Latest External Activity, Latest Deployment Status, Open PR Count, Recent Failed Workflow Runs, External Signal Updated.
- **`recommendation-run`** writes: Recommendation Lane, Recommendation Score, Recommendation Confidence, Recommendation Updated.
- **`destinations:resolve`** repairs resolved Notion IDs only. It does not repair schema drift or view drift.

## 3. Safety Defaults

- **Dry-run first.** Every command defaults to dry-run unless `--live` is explicitly passed. `external-signal-sync` in dry-run does not fetch fresh GitHub data — it recomputes from existing Notion rows.
- **Resolve aliases.** Always use `config/destinations.json` aliases instead of hardcoded Notion IDs.
- **Validate schema.** Commands validate properties against the live Notion schema before writing.
- **No destructive replacement.** `allowDeletingContent` is `false` by default. Only enable with explicit user approval.
- **Governed GitHub writes.** GitHub mutations follow a strict pipeline: action request → policy check → dry run → approval → live execution → audit trail. Never treat GitHub as an ad hoc mutation surface.
- **No hardcoded tokens.** Notion and GitHub tokens come from environment variables only.
- **Rate-limit awareness.** Retries and truncation warnings are surfaced clearly.
- **Runner limits.** Phase 7/8 runner limits: `maxLivePerRun=1`, `maxDryRunsPerRun=5`, `minSecondsBetweenWrites=1` (serial mode).
- **Live gating.** GitHub live execution requires: approval, non-expired request, active GitHub target, and a fresh successful dry run (max 24 hours old).
- **Compensation posture.** Comments use corrective follow-up (not delete-in-place). Labels/assignees use a new desired-state request. Issues use fix-forward. There is no automated compensation runner — compensation is manual/operator-driven.

## 4. Core Workflows

### Publish content into Notion

Creates or updates pages in any destination database. Use for build log entries, weekly reviews, research notes, etc.

Frontmatter is used for title resolution only. Other Notion properties (Tags, Session Date, relations) come from `--property` overrides, destination fixed/default properties, or workflow-specific code — they are not inferred from markdown headings.

```bash
# Dry run (default)
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md

# Live write
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md --live

# From a request file
npm run publish:notion -- --request examples/requests/weekly_review.dry-run.json

# With property overrides
npm run publish:notion -- --destination build_log --file session.md --live \
  --property "Session Date=2026-03-21" --property "Tags=[\"notion\",\"sync\"]"
```

Minimal build log markdown:
```markdown
---
title: First Local Publish Setup
---

# Build Log Entry

## What Was Planned
...

## What Shipped
...

## Next Steps
...
```

Minimal weekly review markdown:
```markdown
---
title: Week of 2026-03-16
---

# Weekly Review

## Wins
...

## What Shipped
...

## What Stalled
...

## Next Week Focus
...
```

### Refresh the control tower

Recomputes three derived PM signals (Operating Queue, Next Review Date, Evidence Freshness) for every project row. Updates the Command Center page markdown.

```bash
# Dry run — shows what would change
npm run portfolio-audit:control-tower-sync

# Live — writes derived fields and refreshes the command center
npm run portfolio-audit:control-tower-sync -- --live
```

### Generate weekly review packet

Builds a structured weekly review from project state, build sessions, and portfolio changes. Publishes to the Weekly Reviews database.

```bash
# Dry run
npm run portfolio-audit:review-packet

# Live
npm run portfolio-audit:review-packet -- --live
```

### Sync external signals (GitHub)

Polls GitHub repos for open PRs and workflow runs (live mode only) and writes signal events into Notion. Updates project-level external signal fields. Also patches managed sections on the latest weekly review page.

```bash
# Dry run (recomputes from existing Notion rows, does NOT hit GitHub)
npm run portfolio-audit:external-signal-sync

# Live (fetches fresh data from GitHub)
npm run portfolio-audit:external-signal-sync -- --provider github --live
```

### Governed GitHub actions (dry-run → approval → live)

This is a three-step pipeline for any GitHub mutation.

**Step 1 — Dry run:** Validates the action request, checks policy compliance, fetches GitHub preflight state, computes what would change.

```bash
npm run portfolio-audit:action-dry-run -- --request <action-request-page-id>
```

**Step 2 — Approval:** The operator reviews the dry-run output in Notion, then sets the action request row: `Status = Approved`, populates `Approver` and `Decided At`.

**Step 3 — Live execution:** Executes the approved action against GitHub and records the result.

```bash
npm run portfolio-audit:action-runner -- --mode live --request <action-request-page-id>
```

**Post-execution verification:** Check both the request row (`Status = Executed`, `Latest Execution Status = Executed`) and the execution row (`Status = Succeeded`, `Provider URL`, `Issue Number` or `Comment ID`, sane `Response Classification` and `Reconcile Status`). Then refresh governance summaries:

```bash
npm run portfolio-audit:action-request-sync -- --live
```

**Safe-to-go-live signs after dry run:**
- Request row `Execution Intent = Ready for Live`
- Request row `Latest Execution Status = Dry Run Passed`
- Dry-run execution row `Status = Succeeded`
- No validation notes about missing payload, missing target, additive-only conflicts, unresolved source, missing PR permission, or stale dry run

Supported GitHub action keys: `github.create_issue`, `github.update_issue`, `github.set_issue_labels`, `github.set_issue_assignees`, `github.add_issue_comment`, `github.comment_pull_request`.

### Creating action request rows

There is no dedicated generic "create action request" CLI. Action request rows are created:
- Manually in Notion
- Via the operational rollout pilot flow (`src/notion/operational-rollout.ts`)
- `publish:notion` with the `external_action_requests` alias technically works but is not the clean canonical path — those rows are relation-heavy and need workflow-specific semantics

For a `github.create_issue` request, the row needs at minimum: Local Project, Policy (linked to `github.create_issue`), Target Source, Status, Source Type, Requested By, Requested At, Expires At, Payload Title, Payload Body, Provider Request Key, and usually Approval Reason and Execution Notes.

### Action type differences

| Action Key | Requires Title | Requires Body | Requires Target Number | Special Notes |
|---|---|---|---|---|
| `github.create_issue` | Yes | Yes | No | Title gets target-config prefix; labels include target defaults + requested |
| `github.update_issue` | No (but needs title or body change) | No | Yes | |
| `github.set_issue_labels` | No | No | Yes | Additive-only posture blocks label removals |
| `github.set_issue_assignees` | No | No | Yes | Additive-only posture blocks assignee removals; unassignable users flagged in preflight |
| `github.add_issue_comment` | No | Yes | Yes | |
| `github.comment_pull_request` | No | Yes | Yes | Target must be a PR; GitHub App needs PR-read permission |

### Operational rollout

Classifies priority projects for GitHub lane readiness and generates a rollout plan.

```bash
npm run portfolio-audit:operational-rollout
npm run portfolio-audit:operational-rollout -- --live
```

## 5. Weekly Ordering — Critical Sequencing Rule

The single most important sequencing gotcha: **create or refresh the current weekly review before running lanes that patch "latest weekly" managed sections.** `external-signal-sync`, `recommendation-run`, and `action-request-sync` patch the latest weekly page. If the current week's page does not exist yet, those sections land on the wrong weekly page or fail to represent the intended week.

**Correct weekly live order:**

```bash
# 1. Refresh derived PM signals
npm run portfolio-audit:control-tower-sync -- --live

# 2. Create/refresh this week's review page
npm run portfolio-audit:review-packet -- --live

# 3. Sync GitHub signals (patches the weekly page)
npm run portfolio-audit:external-signal-sync -- --provider github --live

# 4. Run recommendations (patches the weekly page)
npm run portfolio-audit:recommendation-run -- --type weekly --live

# 5. Sync action request summaries (patches the weekly page)
npm run portfolio-audit:action-request-sync -- --live
```

## 6. Common Commands

| Command | Purpose |
|---|---|
| `npm run destinations:check` | List all configured destination aliases |
| `npm run destinations:resolve` | Resolve and persist Notion IDs for all destinations (IDs only, not schema) |
| `npm run publish:notion -- --destination <alias> --file <path>` | Publish a file to a Notion destination (dry-run default) |
| `npm run publish:notion -- --destination <alias> --file <path> --live` | Publish live |
| `npm run portfolio-audit:control-tower-sync` | Refresh derived PM signals (dry-run) |
| `npm run portfolio-audit:control-tower-sync -- --live` | Refresh derived PM signals (live) |
| `npm run portfolio-audit:review-packet` | Generate weekly review packet (dry-run) |
| `npm run portfolio-audit:review-packet -- --live` | Publish weekly review packet (live) |
| `npm run portfolio-audit:external-signal-sync` | Recompute signals from existing data (dry-run, no GitHub fetch) |
| `npm run portfolio-audit:external-signal-sync -- --provider github --live` | Fetch fresh GitHub data and sync (live) |
| `npm run portfolio-audit:recommendation-run -- --type weekly` | Weekly recommendation run (dry-run) |
| `npm run portfolio-audit:recommendation-run -- --type weekly --live` | Weekly recommendation run (live) |
| `npm run portfolio-audit:action-dry-run -- --request <id>` | Dry-run a governed GitHub action |
| `npm run portfolio-audit:action-runner -- --mode live --request <id>` | Execute an approved GitHub action |
| `npm run portfolio-audit:action-request-sync -- --live` | Sync governance/actuation summaries |
| `npm run portfolio-audit:operational-rollout` | Generate operational rollout plan |
| `npm run portfolio-audit:overhaul-notion` | Full schema upgrade and project refresh |
| `npm run portfolio-audit:views-validate` | Validate core project view config against live schema |
| `npm run portfolio-audit:execution-views-validate` | Validate execution views |
| `npm run portfolio-audit:external-signal-views-validate` | Validate external signal views |
| `npm run portfolio-audit:phase6-views-validate` | Validate governance views |
| `npm run portfolio-audit:phase7-views-validate` | Validate actuation views |
| `npm run portfolio-audit:phase8-views-validate` | Validate GitHub-specific views |
| `npm run portfolio-audit:views-plan` | Print saved-view plan |
| `npm run typecheck` | Run TypeScript type checking |
| `npm test` | Run Vitest tests |

## 7. How to Interpret User Requests

| User says | Workflow |
|---|---|
| "publish this to Notion" | `publish:notion` with the appropriate destination alias |
| "refresh project status" / "update the control tower" | `portfolio-audit:control-tower-sync --live` |
| "generate the weekly review" | `portfolio-audit:review-packet --live` |
| "pull GitHub activity" / "sync signals" | `portfolio-audit:external-signal-sync -- --provider github --live` |
| "create a GitHub issue for project X" | Governed actuation pipeline (see section 4) — not generic publishing |
| "run a dry run" | Append no flags (dry-run is default) or use `action-dry-run` for GitHub actions |
| "run live" / "do it for real" | Append `--live` (or `--mode live` for action-runner) to the relevant command |
| "catch me up" / "check on things" | Run validation then dry-run sequence (see section 9) |
| "refresh everything live" | Run the 5-step weekly live sequence (see section 5) |
| "check my destinations" | `destinations:check` |
| "resolve destination IDs" | `destinations:resolve` |
| "what's the rollout plan?" | `portfolio-audit:operational-rollout` |
| "validate the views" | `portfolio-audit:views-validate` (plus lane-specific validators as needed) |

## 8. Required Environment / Auth

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes | Notion integration token for all API calls |
| `GITHUB_TOKEN` | For signal sync | Personal access token for GitHub API polling |
| `GITHUB_APP_ID` | For governed actions | GitHub App ID for authenticated mutations |
| `GITHUB_APP_PRIVATE_KEY_PEM` | For governed actions | GitHub App private key (PEM format) for installation auth |
| `GITHUB_APP_WEBHOOK_SECRET` | For webhook verification | Shared secret for validating GitHub webhook deliveries |
| `NOTION_LOG_DIR` | Optional | Log directory (defaults to `./logs`) |
| `NOTION_DESTINATIONS_PATH` | Optional | Path to destinations config (defaults to `./config/destinations.json`) |

### Auth model

- **Notion reads/writes** use the `NOTION_TOKEN` integration token. The integration must have access to all target pages and databases.
- **GitHub reads** (signal sync) use `GITHUB_TOKEN` for REST API polling.
- **GitHub writes** (governed actions) use a GitHub App (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PEM`) for installation-scoped, auditable mutations. Token is minted per run with a 60-minute lifetime. This is deliberate — GitHub App identity is more auditable than PAT-based writes.
- **GitHub App permission posture** (Phase 8): `issues = read_write`, `metadata = read_only`, broader repository permissions disabled.

## 9. Operating Stance for Claude Code

When working in this repo:

1. **Identify the workflow lane first.** Map the user's request to one of the core workflows above before doing anything.
2. **Use repo commands.** Prefer `npm run <script>` over improvising direct Notion/GitHub API calls. The commands encode safety defaults, validation, and audit trails.
3. **Use config, not guesswork.** Destination aliases, governance policies, action families, and view definitions are all in `config/`. Read them before making assumptions.
4. **Dry-run by default.** Never pass `--live` (or `--mode live`) unless the user explicitly asks for a live write.
5. **For GitHub mutations, follow the pipeline.** Action request → dry run → approval → live execution. Never skip steps.
6. **Check prerequisites.** Before running a command, verify that the required env vars are set and the relevant config is present.
7. **Respect field ownership.** Manual fields are human-edited. Derived fields are written by specific sync commands. Don't mix them up and don't overwrite manual fields.
8. **Read the roadmap.** `docs/notion-roadmap.md` tracks the current phase and what each phase delivered. `docs/notion-phase-memory.md` has the compressed history.
9. **After live writes, verify real Notion rows/pages**, not just the JSON summary from the script.
10. **Everything is manually triggered.** There is no cron/CI driving these workflows. All commands are run through the agent/terminal.

### "Catch me up" sequence

```bash
npm run portfolio-audit:views-validate
npm run portfolio-audit:control-tower-sync
npm run portfolio-audit:review-packet
npm run portfolio-audit:recommendation-run -- --type weekly
# Note: dry-run external-signal-sync does NOT fetch fresh GitHub data
```

Then inspect current Notion state and existing signal/action ledgers.

### Key config files

| File | Contains |
|---|---|
| `config/destinations.json` | All Notion destination aliases, resolved IDs, schema snapshots |
| `config/local-portfolio-control-tower.json` | Control tower rules, field ownership, review cadence, execution config, governance config, runner limits, live gating |
| `config/local-portfolio-views.json` | Saved view definitions and Notion view IDs |
| `config/local-portfolio-governance-policies.json` | Action policies for governed external mutations |
| `config/local-portfolio-github-views.json` | GitHub-specific operator views |
| `config/local-portfolio-github-action-families.json` | GitHub action family validation rules |
| `config/local-portfolio-actuation-targets.json` | GitHub repo allowlist with per-target action permissions and title prefixes |

### Config update dependencies

- **New destination alias:** Update `config/destinations.json`, run `destinations:resolve` if needed. Only update other configs if a workflow explicitly references the alias.
- **New GitHub action key:** Update `config/local-portfolio-governance-policies.json` AND `config/local-portfolio-github-action-families.json` AND code in `src/notion/local-portfolio-actuation.ts`. Update views if operators need visibility.
- **No one-shot global cross-config validator exists.** Verify config consistency manually.

### Actuation target fallback — important gotcha

`config/local-portfolio-actuation-targets.json` has explicit per-repo target rules AND a `defaults` block. If a linked active GitHub repo source does not match a specific target rule, `resolveActuationTarget()` falls back to defaults. The current defaults allow all six GitHub actions with title prefix `[Portfolio]` and default label `portfolio`. This means any active linked GitHub repo source is potentially live-capable, not just explicitly allowlisted ones. Be deliberate when approving requests against repos that are not obviously expected targets.

### Current state

- **Phase 8 (GitHub Deepening) is complete.** The GitHub action lane is mature with issue lifecycle, PR comments, hardened App posture, and audit-grade feedback loops.
- **Phase 9 (Provider Expansion) is planned.** Next phase will expand governance to non-GitHub providers, but only after the GitHub lane is measurably trusted.
- **Provider scaffolding exists** for Vercel (disabled governance policies) and Google Calendar (disabled provider scaffolding). Treat this repo as "GitHub-first operating system with future provider hooks," not "multi-provider actuation system already in production."
- **65 projects tracked**, 0 overdue reviews. **50 orphaned projects** means `buildSessionCount === 0` AND `relatedResearchCount === 0` AND `supportingSkillsCount === 0` AND `linkedToolCount === 0`. These are not corrupted — they are safe to sync and safe to run `control-tower-sync` against. They simply have no linked operating records.
- **Webhook feedback** is currently `trusted_feedback` mode, but shadow/drain/reconcile machinery still exists. Do not assume the feedback loop is magically self-healing — verify execution rows and reconcile state.
- **MCP vs REST:** Direct REST is used for all data operations. Notion MCP is the primary strategy for saved view operations. Playwright is fallback only when MCP auth is unavailable.
