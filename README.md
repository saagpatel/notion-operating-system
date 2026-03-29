# Notion Operating System

This repo gives Codex a durable local workflow for publishing Markdown or text files into Notion through the direct Notion REST API.

That publisher is the foundation, but the project has grown into a broader Notion operating system for project and portfolio management. In practice, this repo now does two jobs:

- publishes local content into Notion safely and repeatably
- maintains a larger Notion-based control tower for projects, reviews, signals, and governed actions

## What this project does

- Reads a local `.md` or `.txt` file
- Resolves a friendly destination alias from `config/destinations.json`
- Validates writable properties against the current parent data source schema
- Creates or updates Notion pages using the direct REST markdown endpoints
- Handles template discovery, template creation, and template readiness polling
- Retries on rate limits with `Retry-After`
- Writes structured run logs into `logs/`
- Supports dry-run and live publish modes

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

3. Put your Notion integration token in `.env` as `NOTION_TOKEN`.

4. Update `config/destinations.json` with your real destination aliases and Notion URLs.

5. If your destination config only has URLs and not resolved IDs yet, resolve them:

   ```bash
   npm run destinations:resolve
   ```

## GitHub And Portability

If you want this system to survive machine changes, this repo should live in GitHub.

What belongs in GitHub:

- source code in `src/`
- config files in `config/`
- docs in `docs/`
- examples in `examples/`
- environment template files like `.env.example`

What should stay local:

- `.env` and any real tokens
- run logs in `logs/`
- scratch files in `tmp/` and `.tmp/`
- webhook shadow state in `var/`

Recommended repo identity:

- Project name: `Notion Operating System`
- GitHub repo name: `notion-operating-system`

For a machine-to-machine setup checklist, see [docs/github-portability.md](docs/github-portability.md).

## Common commands

- Dry-run a publish request:

  ```bash
  npm run publish:notion -- --request examples/requests/weekly_review.dry-run.json --dry-run
  ```

- Publish a file directly by alias:

  ```bash
  npm run publish:notion -- --destination weekly_reviews --file ./notes/weekly-review.md --live
  ```

- Check destination config only:

  ```bash
  npm run destinations:check
  ```

- Rebuild the `Local Portfolio Projects` database as the resume-and-decision system:

  ```bash
  npm run portfolio-audit:overhaul-notion
  ```

- Print the saved-view sync plan for `Local Portfolio Projects`:

  ```bash
  npm run portfolio-audit:views-plan
  ```

- Validate the saved-view plan against the live `Local Portfolio Projects` schema before an MCP sync:

  ```bash
  npm run portfolio-audit:views-validate
  ```

- Dry-run the project control-tower sync:

  ```bash
  npm run portfolio-audit:control-tower-sync
  ```

- Publish the current weekly review packet from the control tower:

  ```bash
  npm run portfolio-audit:review-packet -- --live
  ```

- Run the bounded operational rollout for the current priority slice:

  ```bash
  npm run portfolio-audit:operational-rollout
  ```

- Dry-run the BattleGrid/EarthPulse/Relay/SynthWave cohort rollout into governed GitHub issues:

  ```bash
  npm run portfolio-audit:cohort-rollout -- --projects BattleGrid,EarthPulse,Relay,SynthWave
  ```

- Audit which non-GitHub provider is closest to a safe Phase 9 pilot:

  ```bash
  npm run portfolio-audit:provider-expansion-audit
  ```

- Close the active phase and write the next-phase brief into repo memory plus Build Log:

  ```bash
  npm run portfolio-audit:phase-closeout -- --phase 1
  ```

## Request file format

The easiest repeatable path is a small JSON request file:

```json
{
  "destinationAlias": "weekly_reviews",
  "inputFile": "examples/content/weekly-review.md",
  "dryRun": true,
  "titleOverride": "Week of 2026-03-16"
}
```

## Live write safety

- Dry-run is the default unless `--live` is passed.
- Dry-run can work without a token if the destination config includes a `schemaSnapshot`.
- `allowDeletingContent` defaults to `false`.
- Full content replacement refuses to proceed if the existing page contains child page or child database blocks and the new content would remove them.
- After a live publish, the tool reads the final markdown back and logs whether the response looks truncated or contains `unknown_block_ids`.

## Human-only Notion steps

This code cannot do these steps for you:

1. Create the internal Notion integration.
2. Grant the integration the capabilities required for page creation, page update, property insert/update, and markdown read/update.
3. Put the token into `NOTION_TOKEN`.
4. Share each target page or data source with the integration.

## Repo guide

- [DESTINATIONS.md](DESTINATIONS.md): destination alias design and maintenance
- [AGENTS.md](AGENTS.md): in-repo operating instructions for future Codex sessions
- [.agents/skills/notion-publish/SKILL.md](.agents/skills/notion-publish/SKILL.md): short Codex skill for future publish tasks

## Current real destinations

- `weekly_reviews` -> `📅 Weekly Reviews`
- `build_log` -> `🔨 Build Log`
- `project_portfolio` -> `📦 Project Portfolio`
- `local_portfolio_projects` -> `Local Portfolio Projects`
- `local_portfolio_command_center` -> `Local Portfolio Command Center`
- `skills_library` -> `🤹 Skills Library`
- `research_library` -> `📚 Research Library`
- `ai_tool_site_matrix` -> `🧠 AI Tool & Site Matrix`

## Project database roles

- `Local Portfolio Projects` is the operating project system for projects that are completed or currently in some kind of build, review, resume, or active-working status.
- `Project Portfolio` is the earlier-stage portfolio system for projects that have not been started yet.
- Keep both databases distinct on purpose: `Local Portfolio Projects` is the day-to-day operating surface, while `Project Portfolio` is the pre-start pipeline.

## Local Portfolio Projects overhaul

The `portfolio-audit:overhaul-notion` command upgrades the live `Local Portfolio Projects` data source in place using local evidence from:

- `/Users/d/Projects/PORTFOLIO-AUDIT-REPORT.md`
- `/Users/d/Projects/PORTFOLIO-AUDIT-REPORT.xlsx`
- `/Users/d/Projects/project-registry.md`
- the local repo/manifests/docs under `/Users/d/Projects`

It adds the resume-and-decision fields, refreshes each project page into a resume-first profile, and backfills reverse links from Build Log, Research Library, Skills Library, and AI Tool & Site Matrix.

One current limitation: the public Notion API still does not expose database-view creation, so the command cannot create the target saved views automatically.

The durable workaround in this repo is:

- direct Notion REST remains the source of truth for schema, rows, and markdown content
- Notion MCP is the preferred way to create and update saved views when MCP auth is healthy
- Playwright is the fallback only if MCP auth is unavailable or the view layer needs browser repair

The saved view source of truth now lives in `/Users/d/Notion/config/local-portfolio-views.json`.
Use `npm run portfolio-audit:views-plan` to print the exact view definitions, database IDs, and MCP-ready configuration strings for:

- `Portfolio Home`
- `Resume Now`
- `Worth Finishing`
- `Needs Decision`
- `Needs Review`
- `Cold Storage`
- `By Category`
- `Gallery Snapshot`

The same config now also stores the live Notion view IDs for those eight views.
Use `npm run portfolio-audit:views-validate` to confirm the config still matches the live data source schema before you run an MCP view sync.

## Phase-one control tower

The control-tower source of truth now lives in `/Users/d/Notion/config/local-portfolio-control-tower.json`.
It defines:

- field ownership for manual, derived, and legacy-hidden properties
- freshness windows and review cadences
- queue precedence
- command-center page bootstrap and saved-view IDs
- baseline metrics and phase state for the roadmap ledger

The new phase-one commands are:

- `npm run portfolio-audit:control-tower-sync`
- `npm run portfolio-audit:review-packet`
- `npm run portfolio-audit:phase-closeout`

The repo-canonical memory artifacts live at:

- `/Users/d/Notion/docs/notion-roadmap.md`
- `/Users/d/Notion/docs/adr/0001-local-portfolio-control-tower.md`
