# Notion Operating System Agent Guide

## Purpose

Make local publishing and portfolio operations safe, scoped, and easy to resume.
The system connects Notion databases, provider signals, and governed actions;
config files define destinations, policies, schemas, views, and rollout rules.
See README `Status` for the recorded project context.

## Layout

- `src/cli/`: shared command registry and command implementations.
- `src/publishing/` and `src/notion/`: publishing, provider clients, and syncs.
- `config/`: destination aliases, policies, schemas, saved views, and control-tower rules.
- `scripts/` and `tests/`: verification commands and credential-free fixtures.
- `docs/notion-roadmap.md`: roadmap; `docs/notion-phase-memory.md`: phase history.
- `docs/notion-api-speed-workflow.md`: detailed targeted-repair speed runbook.

`Local Portfolio Projects` is the operating database for active/completed work.
`Project Portfolio` is pre-start intake. Do not blur their roles or manual fields
with sync-owned derived fields.

Current destination aliases: `weekly_reviews`, `build_log`, `project_portfolio`,
`local_portfolio_projects`, `local_portfolio_command_center`, `skills_library`,
`research_library`, and `ai_tool_site_matrix`.

Saved view definitions and the eight live view IDs are in
`config/local-portfolio-views.json`. Phase-one rules and mutable phase state are
in `config/local-portfolio-control-tower.json`. Prefer REST for data, Notion MCP
for saved views, and Playwright only when MCP authentication is unavailable.

## Setup

Use Node from `.node-version` and npm from `packageManager` in `package.json`.
Run `npm ci`; its prepare hook builds TypeScript without installing Git hooks.
See [CONTRIBUTING.md](CONTRIBUTING.md#local-setup) for credential-free setup.
Start operator orientation with `npm run governance:health-report`.
Run `npm run doctor` only for requested operator setup; with credentials it
queries Notion access and destinations.

For authorized publishing, load `.env` and `config/destinations.json`, then
resolve destination aliases before guessing IDs. Useful commands:

- `npm run destinations:check`
- `npm run destinations:resolve` (persists local IDs; does not repair schema drift)
- `npm run publish:notion -- --request <file>`
- `npm run publish:notion -- --destination <alias> --file <path> --dry-run`
- `npm run portfolio-audit:views-plan` (exact saved-view plan)
- `npm run portfolio-audit:views-validate` (validate live parent schema before MCP view sync)
- `npm run portfolio-audit:provider-expansion-audit`
- `npm run portfolio-audit:operational-rollout`

## Checks

Use the smallest credential-free fixture check that exercises the change.
For full local verification, run typecheck, tests, build, the three install/CLI
smokes, and fresh-clone verification as described in
[CONTRIBUTING.md](CONTRIBUTING.md#tests). `make check` adds lint and format checking
to `npm run verify`, which includes temporary package installs.

`sandbox:smoke` performs real provider writes and reads; it needs explicit
sandbox authority and isolated targets. Local tests do not establish live
provider, scheduler, or human acceptance.

## Boundaries

### Publishing and governed writes

- Dry-run first unless the user clearly asks for a live write. Publishing and
  syncs default to dry-run; action-runner uses `--mode live`.
- Explicit publish `--dry-run` overrides request-file mode. Do not combine it
  with `--live`; without CLI mode flags, request files retain their mode.
- Never hardcode Notion or GitHub tokens. Preserve non-secret profile bundles
  and never export live `.env` secrets.
- Validate properties against the live parent schema before any write.
- Use markdown REST endpoints for create/read/update.
- Keep `allowDeletingContent=false` unless the user explicitly approves a
  destructive replacement. Do not change its contract without an owner decision.
- Templates are asynchronous: wait for readiness before markdown patching.
- Surface rate-limit retries and truncation warnings clearly.
- Governed GitHub writes follow request, policy check, dry run, approval, live
  execution, and audit trail. A ready request has `Execution Intent = Ready for
  Live`, `Latest Execution Status = Dry Run Passed`, and a succeeded dry-run
  execution row. Compensation is manual corrective follow-up, not deletion.
- Actuation fallback warning: `config/local-portfolio-actuation-targets.json`
  has per-repo rules AND defaults. An active linked GitHub source with no
  specific match falls back to defaults, permitting all six GitHub actions
  with title prefix `[Portfolio]` and label `portfolio`. Such sources are
  potentially live-capable; approve non-obvious targets deliberately.
- Action dry runs persist Notion execution records; `destinations:resolve`
  persists local IDs. `phase-closeout` writes local artifacts and Notion
  records without a `--live` flag.
- Webhook feedback is recorded as `trusted_feedback`, with shadow/drain/reconcile
  machinery retained. Verify execution rows and reconcile state directly;
  do not assume the loop is self-healing.

### Targeted repairs

- Do not use `npm run maintenance:weekly-refresh -- --live` as a repair tool.
  Broad weekly live refresh is only for explicitly requested full weekly
  maintenance, never the default follow-up to a repair. It requires explicit
  user approval AND `--confirm-full-live`.
- For one broken lane: run its dry-run, its authorized live command, then the
  same dry-run again.
- Prefer `npm run maintenance:weekly-refresh -- --fast` for initial triage.
  It scopes project batches, skips known markdown-blocked pages, streams child
  progress, and lowers retry budgets. It uses project concurrency 2; lower it
  to 1 under rate limits and increase batch size before concurrency.
- If fast triage reports drift, run only that lane with
  `--only <step> --fast --live --confirm-full-live`, then repeat the same
  `--only <step> --fast` dry-run.
- For Command Center repair, run `npm run control-tower:sync -- --today <date>`,
  then the same command with authorized `--live`, then the original dry-run.
- If a project-page markdown loop fails, stop after that lane and diagnose it
  directly instead of rerunning the full weekly sequence.
- Use helpers or separate chats only for read-only blocker classification,
  log review, migration planning, or test review. Never run multiple live
  Notion writers in parallel against the same integration.
- Use the signed-in browser to visually confirm pages and Command Center
  replacements, not for bulk edits.
- Move generated project briefs toward child/linked records or structured
  properties so repairs stop relying on direct project-page markdown patches.
- For narrower portfolio-wide requests, use targeted shared CLI commands such
  as `portfolio-audit:control-tower-sync`; keep dry-run default and use `--live`
  only with explicit approval.

### Single-project pipeline

- Never finish a single-project push with `maintenance:weekly-refresh`,
  `portfolio-audit:external-signal-sync`, or `portfolio-audit:control-tower-sync`
  unless the user explicitly requests a portfolio-wide refresh.
- Requests such as “refresh everything live”, “run the weekly sequence”, and
  “catch me up” authorize portfolio-wide commands within that requested scope.
- Preferred scoped path: explore the project and search Notion for its row;
  create/push GitHub only when authorized; publish Build Log, skills, research,
  and tool records; run `portfolio-audit:external-signal-seed-mappings -- --live
  --limit <N>` for its source row; then use one Notion MCP property update for
  counts, state, and derived fields.
- Direct Notion MCP property updates are preferred for this lane because no
  single-project field-update CLI exists. This exception only covers Notion
  finalization; governed GitHub writes still use the approval pipeline.

### Weekly sequencing

Create the current weekly page with `review-packet` before managed-section
patchers. `external-signal-sync` and `recommendation-run` target `Week of
<weekStart>` and skip sections when it is missing. `action-request-sync` targets
the latest weekly page and can patch the previous week instead. Correct order
for an explicitly authorized full live pass:

1. `npm run portfolio-audit:control-tower-sync -- --live`
2. `npm run portfolio-audit:review-packet -- --live`
3. `npm run portfolio-audit:external-signal-sync -- --provider github --live`
4. `npm run portfolio-audit:recommendation-run -- --type weekly --live`
5. `npm run portfolio-audit:action-request-sync -- --live`

Full-scope signal dry-runs poll enabled providers, including GitHub, without
persisting sync writes. `--write-scope project-pages` and `portfolio-sections`
skip polling.

## Delivery

Read back final markdown after every live publish and summarize the change.
Verify real Notion rows/pages after authorized live writes, not just CLI JSON.
Keep manual and derived field ownership separate: control-tower owns Operating
Queue, Next Review Date, Evidence Freshness, and Command Center markdown;
external signals own coverage, latest activity/deployment, PR counts, and failed
workflow counts. Intelligence and external signals own recommendation fields.

`portfolio-audit:review-packet` builds the current review from Build Log and
project state rather than manual reconstruction. `portfolio-audit:phase-closeout`
keeps the roadmap and Build Log aligned on the exact next-phase brief.

For authorized provider work, report missing token, missing integration access,
or missing required live-write approval as the specific blocker. Continue
independent local work. Land changes through review and required checks per
CONTRIBUTING; report what was verified and any remaining limitation.
