# Notion Operating System

TypeScript CLI that bridges Notion project databases, GitHub external signals, and governed action workflows. Publishes markdown into Notion, refreshes portfolio control-tower fields, generates weekly review packets, syncs GitHub signals, and executes approved GitHub actions through a dry-run-first governance pipeline.

## Stack / Architecture

- Node/npm command suite with dry-run/live command separation
- Notion API via `NOTION_TOKEN`; destination aliases in `config/destinations.json`
- GitHub signal sync (`GITHUB_TOKEN`) and governed GitHub App action runner (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PEM`)
- JSON configs for destinations, policies, views, and control-tower rules
- **Local Portfolio Projects** Notion database is the operational source of truth; manual fields and derived fields are conceptually separate — sync commands own derived fields only

## Build / Test / Run

```bash
npm run typecheck       # TypeScript type checking
npm test                # Run Vitest tests
```

Core workflow commands (dry-run by default; append `--live` to write):

```bash
# Publish content into Notion
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md
npm run publish:notion -- --destination weekly_reviews --file path/to/review.md --live
npm run publish:notion -- --request examples/requests/weekly_review.dry-run.json
npm run publish:notion -- --destination build_log --file session.md --live \
  --property "Session Date=2026-03-21" --property "Tags=[\"notion\",\"sync\"]"
npm run publish:notion -- --destination <alias> --file <path> --live

# Portfolio signals and reviews
npm run portfolio-audit:control-tower-sync [-- --live]
npm run portfolio-audit:review-packet [-- --live]
npm run portfolio-audit:recommendation-run -- --type weekly [--live]

# External signals
npm run portfolio-audit:external-signal-sync [-- --provider github --live]

# Governance / GitHub actions
npm run portfolio-audit:action-dry-run -- --request <action-request-page-id>
npm run portfolio-audit:action-dry-run -- --request <id>
npm run portfolio-audit:action-runner -- --mode live --request <action-request-page-id>
npm run portfolio-audit:action-runner -- --mode live --request <id>
npm run portfolio-audit:action-request-sync [-- --live]
npm run portfolio-audit:operational-rollout
npm run portfolio-audit:operational-rollout -- --live

# Views and config
npm run portfolio-audit:views-validate
npm run portfolio-audit:views-plan
npm run destinations:check
npm run destinations:resolve

# Weekly triage
npm run maintenance:weekly-refresh -- --fast [--live --confirm-full-live]
```

## Gotchas

### Critical weekly sequencing

**Run `review-packet` before lanes that patch managed weekly sections.** `external-signal-sync`, `recommendation-run`, and `action-request-sync` all patch the latest weekly page. If the current week's page does not yet exist, those sections land on the wrong page.

Correct weekly live order:
```bash
npm run portfolio-audit:control-tower-sync -- --live
npm run portfolio-audit:review-packet -- --live
npm run portfolio-audit:external-signal-sync -- --provider github --live
npm run portfolio-audit:recommendation-run -- --type weekly --live
npm run portfolio-audit:action-request-sync -- --live
```

### Actuation target fallback

`config/local-portfolio-actuation-targets.json` has explicit per-repo rules AND a `defaults` block. If a linked active GitHub source does not match a specific target rule, `resolveActuationTarget()` falls back to defaults (allows all six GitHub actions, title prefix `[Portfolio]`, label `portfolio`). Any active linked GitHub repo source is potentially live-capable — be deliberate when approving requests against non-obvious targets.

### Field ownership

`control-tower-sync` owns: Operating Queue, Next Review Date, Evidence Freshness + Command Center markdown.
`external-signal-sync` owns: External Signal Coverage, Latest External Activity, Latest Deployment Status, Open PR Count, Recent Failed Workflow Runs.
`recommendation-run` owns: Recommendation Lane, Score, Confidence, Updated.
`destinations:resolve` repairs resolved Notion IDs only — not schema drift.

### dry-run for external-signal-sync

Dry-run `external-signal-sync` recomputes from existing Notion rows — it does NOT fetch fresh GitHub data. Only `--live` mode polls GitHub.

### GitHub App auth

GitHub writes use a GitHub App (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PEM`) with installation-scoped tokens minted per run (60-minute lifetime). Permissions: `issues = read_write`, `metadata = read_only`.

### Governed GitHub pipeline

GitHub mutations follow: action request → policy check → dry run → approval → live execution → audit trail. Safe-to-go-live signs after dry run: `Execution Intent = Ready for Live`, `Latest Execution Status = Dry Run Passed`, dry-run execution row `Status = Succeeded`. Compensation is corrective follow-up, not delete-in-place — no automated compensation runner.

### Rate-limit awareness

Retries and truncation warnings are surfaced clearly. Runner limits: `maxLivePerRun=1`, `maxDryRunsPerRun=5`, `minSecondsBetweenWrites=1`.

### Webhook feedback

Webhook feedback is currently `trusted_feedback` mode, but shadow/drain/reconcile machinery still exists. Do not assume the feedback loop is magically self-healing — verify execution rows and reconcile state.

### Config update dependencies

New destination alias → update `config/destinations.json`, run `destinations:resolve`. New GitHub action key → update `config/local-portfolio-governance-policies.json` AND `config/local-portfolio-github-action-families.json` AND `src/notion/local-portfolio-actuation.ts`. No one-shot global cross-config validator exists.

### Fast weekly triage

`maintenance:weekly-refresh -- --fast` scopes batches, skips blocked markdown, uses lower retry budget. If it reports drift: run the recommended `--only <step> --fast --live --confirm-full-live` for the specific lane, then repeat that lane's dry-run. Speed runbook: `docs/notion-api-speed-workflow.md`.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `NOTION_TOKEN` | Yes | Notion integration token |
| `GITHUB_TOKEN` | Signal sync | PAT for GitHub API polling |
| `GITHUB_APP_ID` | Governed actions | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PEM` | Governed actions | GitHub App private key (PEM) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook verification | Shared secret for webhook validation |
| `VERCEL_TOKEN` | Governed Vercel writes | Vercel API token |
| `NOTION_LOG_DIR` | Optional | Log directory (default: `./logs`) |
| `NOTION_DESTINATIONS_PATH` | Optional | Destinations config path (default: `./config/destinations.json`) |

## Key Config Files

| File | Contains |
|---|---|
| `config/destinations.json` | Notion destination aliases, resolved IDs, schema snapshots |
| `config/local-portfolio-control-tower.json` | Control tower rules, field ownership, review cadence, runner limits, live gating |
| `config/local-portfolio-views.json` | Saved view definitions and Notion view IDs |
| `config/local-portfolio-governance-policies.json` | Action policies for governed external mutations |
| `config/local-portfolio-github-action-families.json` | GitHub action family validation rules |
| `config/local-portfolio-actuation-targets.json` | GitHub repo allowlist, per-target action permissions, title prefixes |

## Conventions

- Dry-run is the default for all commands. Pass `--live` (or `--mode live` for action-runner) only on explicit user request.
- Use `npm run <script>` over direct Notion/GitHub API calls — commands encode safety defaults, validation, and audit trails.
- Read `config/` before making assumptions; destination aliases, policies, and view definitions are all there.
- After live writes, verify real Notion rows/pages — not just the JSON summary from the script.
- Roadmap: `docs/notion-roadmap.md`; compressed phase history: `docs/notion-phase-memory.md`.
- Everything is manually triggered — no cron/CI drives these workflows.
- `allowDeletingContent` is `false` by default; enable only with explicit user approval.
- MCP vs REST: direct REST for all data operations; Notion MCP for saved view operations; Playwright is fallback only when MCP auth is unavailable.

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Notion Operating System is the local automation and rules layer that connects Notion project databases, GitHub external signals, and governed action workflows. It publishes markdown into Notion, refreshes portfolio control-tower fields, generates weekly review packets, syncs GitHub signals, and executes approved GitHub actions through a dry-run-first governance pipeline.

## Current State

- **Phase 12 (Managed Write Reliability and Daily Driver Hardening) is active.** Phases 1–11 are complete. The GitHub and Vercel actuation lanes are both mature and live.
- **Phase 9 (Provider Expansion) is complete.** Vercel actuation (`vercel.redeploy`, `vercel.rollback`, `vercel.promote`) is live and policy-backed. Google Calendar scaffolding remains disabled.
- **117 projects tracked**, 0 overdue reviews. **6 orphaned projects** means `buildSessionCount === 0` AND `relatedResearchCount === 0` AND `supportingSkillsCount === 0` AND `linkedToolCount === 0`. These are not corrupted — they are safe to sync and safe to run `control-tower-sync` against. They simply have no linked operating records.
- **Webhook feedback** is currently `trusted_feedback` mode, but shadow/drain/reconcile machinery still exists. Do not assume the feedback loop is magically self-healing — verify execution rows and reconcile state.
- **MCP vs REST:** Direct REST is used for all data operations. Notion MCP is the primary strategy for saved view operations. Playwright is fallback only when MCP auth is unavailable.

## Stack

- Node/npm command suite
- Notion API integration and destination aliases
- GitHub signal sync and governed GitHub action runner
- JSON config for destinations, policies, views, and control-tower rules
- Dry-run/live command separation with explicit live guards

## How To Run

- Start with `npm run governance:health-report`.
- Use `npm run doctor` and `npm run verify` for local setup checks.
- For targeted command-center work, prefer `npm run portfolio-audit:control-tower-sync` dry-run, then live only with explicit approval.
- For a full weekly refresh, use `npm run maintenance:weekly-refresh -- --live --confirm-full-live` only after explicit approval.

## Known Risks

- Never hardcode Notion or GitHub tokens.
- Do not run broad weekly live refresh as a targeted repair tool.
- Keep Notion writes dry-run-first and live-only on explicit approval.
- Do not blur manual project fields with derived sync-owned fields.
- Governed GitHub writes must follow request, dry run, approval, live execution, and audit trail.

## Next Recommended Move

Use targeted dry-run commands for narrow repairs. Reserve portfolio-wide live maintenance for explicit weekly-refresh requests and report drift before writing.

<!-- portfolio-context:end -->

<!-- secondbrain-breadcrumb -->
## SecondBrain knowledge vault

Prior lessons, decisions, and context for this project live in SecondBrain at `wiki/maps/projects/notion-os.md`. The whole vault is searchable via the `engraph` MCP — query it for this project + its stack before non-trivial work.
