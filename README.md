# Notion Operating System

A local automation layer that turns Notion into a real project and portfolio control system.

The system connects **Notion** (databases, dashboards, weekly reviews), **GitHub** (open PRs, workflow runs, issue/comment actuation), and **Vercel** (redeploy, rollback, promote). The shared CLI logs its runs and supports previews for publishing and portfolio syncs.

## Status

This repository is the local automation and rules layer for Notion publishing,
portfolio control-tower fields, weekly reviews, provider signals, and governed
actions. `Local Portfolio Projects` is the operating database; `Project
Portfolio` holds pre-start intake. Config files define destinations, policies,
schemas, views, and rollout rules. Broad weekly maintenance is available only
when explicitly requested.

The recorded roadmap context identifies Phase 12 (Managed Write Reliability
and Daily Driver Hardening) as active and phases 1–11 as complete. It records
Phase 9 provider expansion as complete, GitHub and Vercel actuation as live and
policy-backed, and Google Calendar scaffolding as disabled. These are recorded
delivery states, not fresh provider verification.

The control-tower snapshot dated 2026-08-29 records 158 tracked projects, 132 overdue
reviews, and 41 orphaned projects. Current counts require a fresh sync.
“Orphaned” means `buildSessionCount`, `relatedResearchCount`,
`supportingSkillsCount`, and `linkedToolCount` are all zero. Missing linked
operating records do not imply corruption or prevent a scoped authorized sync.

### Stack

- Node/npm command suite with dry-run/live separation and explicit live guards.
- Notion API integration and destination aliases.
- GitHub external signals and governed GitHub/Vercel action runners.
- JSON configuration for destinations, policies, schemas, saved views, and control-tower rules.
- Direct REST for data, Notion MCP for saved views, and Playwright fallback when MCP authentication is unavailable.

### Known risks

- Never hardcode Notion or GitHub tokens.
- Keep publishing and syncs dry-run-first; live writes need explicit authority.
- Use targeted repairs; broad weekly live refresh requires explicit approval and `--confirm-full-live`.
- Keep manual project fields separate from sync-owned derived fields.
- Governed mutations require request, policy check, dry run, approval, live execution, and audit trail.
- GitHub webhook feedback is recorded as `trusted_feedback`, with shadow/drain/reconcile machinery retained. Verify execution rows and reconcile state; the loop is not self-healing.
- Actuation defaults can permit all six GitHub actions for unmatched active linked sources. Review fallback targets deliberately; see [AGENTS.md](AGENTS.md#boundaries).

### Next steps

Start with `npm run governance:health-report`. Follow
[CONTRIBUTING.md](CONTRIBUTING.md#tests) for the pinned toolchain and
credential-free checks; full verification installs temporary packages, while
sandbox smoke performs real provider writes. Run `npm run doctor` only for
requested operator setup because credentials enable provider queries.

Use targeted dry-runs for narrow repairs and report drift before writing.
For Command Center work, prefer `portfolio-audit:control-tower-sync` dry-run,
then an explicitly authorized live run and the same dry-run again. Reserve
`maintenance:weekly-refresh -- --live --confirm-full-live` for an explicitly
approved full weekly refresh. Move generated project briefs toward linked
records or structured properties to reduce direct project-page markdown patches.

## What It Does

- Publishes local Markdown files into the right Notion pages and databases
- Maintains a project control tower with derived PM signals (Operating Queue, Next Review Date, Evidence Freshness)
- Syncs GitHub repo activity as external signals that inform project recommendations
- Executes governed GitHub mutations (issues, labels, assignees, PR comments) through a dry-run → approval → live pipeline
- Executes governed Vercel recovery actions (redeploy, rollback, promote) through the same pipeline
- Generates weekly review packets, command-center pages, and governance health snapshots
- Keeps destination mappings and policy definitions in versioned JSON. Live operations use the configured workspace's Notion records.

## First Operator Checkpoint

After installing dependencies, run the health report to see the configured governance posture:

```bash
npm run governance:health-report
```

This shows config-based policy, authentication, webhook, and target readiness warnings — without querying Notion or GitHub.

## Install

Local development uses Node 26.11.1 and npm 11.21.0. The full check needs a POSIX environment with Git, tar, Make, and registry access.

- **GitHub ref install**: install a pinned commit into a consuming npm project.
- **GitHub release tarball install**: requires a published release with an attached package tarball.
- **local repo development**: use the repository checkout for the operator commands below.

```bash
# In a consuming npm project
npm install git+https://github.com/saagpatel/notion-operating-system.git#a59f498430e51343876b6c2ff9c2318e7b01fc55
```

```bash
# In the repository root
npm ci
make check
```

## First Run (New Machine)

For credential-free development checks, use the [local setup and verification
guide](CONTRIBUTING.md#local-setup), including its pinned Node/npm prerequisites. The
following path configures an operator workspace. Point the active profile's destination
and control-tower config at your own Notion targets before checking access with doctor.

```bash
npm ci
cp .env.example .env
# fill in NOTION_TOKEN (for Notion access), GITHUB_TOKEN (or a gh login for GitHub signals),
# GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PEM (for governed GitHub writes)
npm run doctor
```

Run the [verification lanes](CONTRIBUTING.md#tests) in a separate checkout without
operator credentials before using the tool.

Then start with a dry-run publish:

```bash
npm run publish:notion -- --destination weekly_reviews --file examples/content/weekly-review.md --dry-run
```

Replace `--dry-run` with `--live` only when you are satisfied with the preview.

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
# Preview the bundled review
npm run publish:notion -- --destination weekly_reviews --file examples/content/weekly-review.md --dry-run

# Live write
npm run publish:notion -- --destination weekly_reviews --file examples/content/weekly-review.md --live
```

### 3. Review stale active projects

```bash
npm run control-tower:stale-active-rescue
```

The stale-active rescue command is safe by default. Use `--limit <count>` to
scope a dry run, add `--live` to apply the planned row updates, and add
`--missing-repos-only` when you only want to move missing local-repo mappings
into a decision posture.

This is read-only by default. It groups stale `Active Build` projects by the most useful first repair reason and returns the next operator move before anyone changes project status.

### 4. Review the decision queue and repo mappings

```bash
npm run control-tower:repo-mapping-audit
```

The repo-mapping audit is read-only by default. It joins `Needs Decision`
rows, local repo path evidence under `~/Projects`, and GitHub
external-source coverage so mapping cleanup does not depend on stale chat
memory. Add `--live-normalize-local-paths` only after the dry run shows
deterministic Local Path fixes.

### 5. Recover overdue portfolio reviews

```bash
npm run control-tower:review-recovery
```

Review recovery is dry-run by default. Use `--limit <count>` to scope a batch,
add `--include-metadata-gaps` when you also want to patch missing Next Move or
Last Active rows, and add `--live` only after the dry-run plan matches the
intended portfolio cleanup.

### 6. Generate the weekly review packet

```bash
npm run portfolio-audit:review-packet -- --live
```

Run this **before** syncing weekly sections. Signals and weekly recommendations look up `Week of <weekStart>` and skip its section when the page is missing. Action-request sync uses the latest weekly page and can patch the previous week.

### 7. Sync GitHub signals

```bash
# Preview the full sync: polls enabled providers, including GitHub, without persisting sync writes
npm run portfolio-audit:external-signal-sync

# Fetch fresh data from GitHub
npm run portfolio-audit:external-signal-sync -- --provider github --live
```

The default `full` scope polls providers even in dry-run mode.
`--write-scope project-pages` and `--write-scope portfolio-sections` recompute
from existing Notion rows and skip provider polling.

### 8. Governed GitHub actions (dry-run → approval → live)

GitHub mutations follow a strict three-step pipeline. Never skip steps.

**Step 1 — Dry run** (validates, checks policy, computes what would change):
```bash
npm run portfolio-audit:action-dry-run -- --request <action-request-page-id>
```

**Step 2 — Approval**: In Notion, set the action request row to `Status = Approved`, fill in `Approver` and `Decided At`. Follow the linked policy's approval count. The requester cannot be the sole approver. Repeat the dry run after approval if needed to reach `Execution Intent = Ready for Live` and `Latest Execution Status = Dry Run Passed`.

**Step 3 — Live execution**:
```bash
npm run portfolio-audit:action-runner -- --mode live --request <action-request-page-id>
```

After execution, sync governance summaries:
```bash
npm run portfolio-audit:action-request-sync -- --live
```

Supported actions: `github.create_issue`, `github.update_issue`, `github.set_issue_labels`, `github.set_issue_assignees`, `github.add_issue_comment`, `github.comment_pull_request`.

### 9. Governed Vercel actions

Same three-step pipeline as GitHub. Supported actions: `vercel.redeploy`, `vercel.rollback`, `vercel.promote`.

Set `VERCEL_TOKEN` in the active profile's env file or export it in your shell. The CLI gives env-file assignments precedence over shell values, even when the assignment is blank. If you export the token, remove or comment out the `VERCEL_TOKEN=` line copied from `.env.example`.

The live gate also requires a successful dry run that passes the configured freshness gate (24 hours measured against the current UTC day's midnight).

### 10. Weekly live sequence (correct order)

Use the guarded orchestrator for a full weekly pass:

```bash
npm run maintenance:weekly-refresh -- --today "$(date +%F)" --signal-source-limit 5 --signal-max-events-per-source 5 --summary-first
npm run maintenance:weekly-refresh -- --today "$(date +%F)" --signal-source-limit 5 --signal-max-events-per-source 5 --live --confirm-full-live --summary-first
```

For repair work, run a single lane instead of the full weekly live pass:

```bash
npm run maintenance:weekly-refresh -- --today "$(date +%F)" --only intelligence-sync --step-timeout-minutes 5 --max-step-attempts 2 --summary-first
npm run maintenance:weekly-refresh -- --today "$(date +%F)" --only external-signals --max-project-pages 10 --project-offset 0 --summary-first
```

`--fast` also applies a conservative `--project-concurrency 2` for project brief write loops. Lower it to `1` if Notion starts rate-limiting; raise batch size before raising concurrency.

The older manual sequence remains useful when you need to run one command directly:

```bash
npm run portfolio-audit:control-tower-sync -- --live          # 1. derive PM signals
npm run portfolio-audit:review-packet -- --live               # 2. create/refresh weekly page
npm run portfolio-audit:external-signal-sync -- --provider github --live  # 3. sync GitHub signals
npm run portfolio-audit:recommendation-run -- --type weekly --live        # 4. run recommendations
npm run portfolio-audit:action-request-sync -- --live         # 5. sync governance summaries
```

## Immutable scheduled runtime generations

`scripts/notion-runtime-generation.mjs` stages and verifies an immutable runtime
for scheduled snapshots. `stage`, `select`, and `readback` remain
separate operations. `readback` does not alter a runtime selector, release, or
lock. It validates the pointer, release, manifest, pointer identity, and pointer
digest before and after receipt construction and fails if final validation
observes a binding change.
Therefore an interrupted scheduled verification cannot leave a persistent lock.
Selector mutations remain serialized by an owner-only generation lock and stale
mutation locks remain fail-closed for explicit recovery. A first-install selector
whose `previous` binding is `null` can be reversed with `deactivate` only when the
expected current commit, current manifest digest, and pointer digest all match
under that lock. The pointer is moved into owner-private selector-reversal
custody while the immutable release remains intact. `reactivate` consumes the
exact expectation-bound custody pointer, restores its original bytes and digest,
and verifies the retained release. A post-move failure is recovered to the exact
pre-operation selector state when possible; incomplete recovery is reported
explicitly as `recovery-required`. These operations do not load launchd, use
credentials, call Notion, or provide scheduler proof.

## Common Commands

| Command | What it does |
|---|---|
| `npm run governance:health-report` | Governance health snapshot from local config and credential presence |
| `npm run maintenance:weekly-refresh -- --summary-first` | Weekly maintenance preflight with compact troubleshooting output |
| `npm run destinations:check` | List configured Notion destination aliases |
| `npm run destinations:resolve` | Resolve and persist Notion IDs for all destinations |
| `npm run portfolio-audit:control-tower-sync` | Refresh derived PM signals (dry-run) |
| `npm run control-tower:review-recovery` | Recover overdue review rows and small review metadata gaps; dry-run by default |
| `npm run control-tower:stale-active-rescue` | Stale Active Build project rescue report and scoped updater; dry-run by default, live only with `--live` |
| `npm run control-tower:repo-mapping-audit` | Read-only decision queue and repo/source mapping cleanup packet |
| `npm run bridge-db:sync -- --shipped-only` | Preview Build Log writes for bridge-db `SHIPPED` rows. Omit the filter to include personal-ops events. |
| `npm run control-tower:schema-report` | Analyze property usage before schema cleanup or deletion |
| `npm run portfolio-audit:review-packet` | Generate weekly review packet (dry-run) |
| `npm run portfolio-audit:external-signal-sync -- --provider github --live` | Sync GitHub signals (live) |
| `npm run portfolio-audit:recommendation-run -- --type weekly` | Weekly recommendations (dry-run) |
| `npm run portfolio-audit:action-request-sync -- --live` | Sync governance summaries |
| `npm run portfolio-audit:action-dry-run -- --request <id>` | Dry-run a governed action |
| `npm run portfolio-audit:action-runner -- --mode live --request <id>` | Execute an approved action |
| `npm run portfolio-audit:operational-rollout` | Operational rollout plan |
| `npm run typecheck` | TypeScript type checking |
| `make check` | Lint, format check, typecheck, tests, build, and three CLI/install smokes |
| `npm test` | Run Vitest tests |
| `npm run verify` | Typecheck, tests, build, and three CLI/install smokes |
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

- **Dry-run first.** Pass `--dry-run` when publishing a file. With `--destination` and `--file`, omitting the mode selects a live publish. Portfolio syncs default to preview and action-runner uses `--mode live`. Action dry runs persist Notion execution records, `destinations:resolve` persists local IDs, and `phase-closeout` writes local artifacts and Notion records without a `--live` flag.
- **Governed writes only.** GitHub and Vercel mutations require: approved action request, non-expired request, active target, and a successful dry run that passes the configured freshness gate (24 hours measured against the current UTC day's midnight).
- **No hardcoded tokens.** Configure credentials through the environment or the active profile's env file. GitHub signal polling can also use an authenticated `gh` CLI.
- **Additive posture.** Labels and assignees are additive-only — removal is not supported by these actions.
- **Compensation is manual.** There is no automated compensation runner. Corrections are operator-driven.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Live Notion access | Notion integration token |
| `GITHUB_TOKEN` | For GitHub signals without a `gh` login | Token for polling PRs and workflow runs |
| `GITHUB_APP_ID` | For governed GitHub writes | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PEM` | For governed GitHub writes | GitHub App private key |
| `GITHUB_APP_WEBHOOK_SECRET` | For webhook verification | Shared secret for delivery validation |
| `VERCEL_TOKEN` | For Vercel signals and governed Vercel actions | Vercel API token |
| `VERCEL_WEBHOOK_SECRET` | Optional | Signature verification for Vercel webhook deliveries |
| `GOOGLE_CALENDAR_TOKEN` | Optional | Credential reference for the disabled Calendar provider |
| `NOTIFICATION_HUB_LOG_PATH` | Optional | Override the local event log used by the Notification Hub signal provider |
| `GITHUB_BREAK_GLASS_TOKEN`, `VERCEL_BREAK_GLASS_TOKEN` | Optional | Audit-only credential references for emergency policies |
| `NOTION_PROFILE` | Optional | Select a workspace profile |
| `NOTION_ENV_FILE` | Optional | Absolute path to a private, owner-controlled env file |
| `NOTION_RETRY_MAX_ATTEMPTS` | Optional | Maximum Notion request attempts (default: `5`) |
| `NOTION_HTTP_TIMEOUT_MS` | Optional | Notion HTTP timeout in milliseconds (default: `90000`) |
| `NOTION_LOG_DIR` | Optional | Log directory (default: `./logs`) |
| `NOTION_DESTINATIONS_PATH` | Optional | Override the active profile's destinations file (`./config/destinations.json` for the default profile) |
| `BRIDGE_DB_PATH` | Optional | Database path passed to the BridgeDB launcher |
| `BRIDGE_DB_MCP_LAUNCHER` | Optional | Absolute reviewed BridgeDB launcher; defaults to the installed immutable `~/.local/state/bridge-db/current/bin/bridge-db-mcp` |

The bridge sync always acts as its bound `notion_os` principal. A foreign-source
SHIPPED row therefore needs an exact active BridgeDB owner delegation before a
live sync; the worker never substitutes the row's source as its caller.

## Sandbox Profile Discipline

Use a `sandbox` profile as the default proving ground before live changes that touch control-tower, signals, governance, rollout, or profile flows.

```bash
npm run doctor -- --profile sandbox
npm run sandbox:smoke
```

Configure a separate token in `.env.sandbox` and separate Notion targets for the sandbox profile. The sandbox doctor checks for token and target overlap with the primary profile.

`sandbox:smoke` performs real sandbox writes and provider reads. It requires
explicit authorization for those effects; use the [fixture verification
lane](CONTRIBUTING.md#tests) for local development checks.

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
