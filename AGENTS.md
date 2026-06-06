# Notion Publisher Repo Instructions

## Purpose

This repo exists to make future Codex sessions short and safe when publishing local files into Notion.

## Preferred workflow

1. Load `.env` and `config/destinations.json`.
2. Dry-run first unless the user clearly asks for a live write.
3. Resolve destination aliases before guessing IDs.
4. Validate properties against the live parent schema before any write.
5. Use markdown REST endpoints for create/read/update.
6. Read back final markdown after a live publish and summarize what changed.

## Targeted repair workflow

- Do not use `npm run maintenance:weekly-refresh -- --live` as a targeted repair tool.
- For one broken lane, run that lane's dry-run, then that lane's live command, then the same dry-run again.
- Prefer `npm run maintenance:weekly-refresh -- --fast` for first-pass triage. It keeps project-page batches scoped, skips pages already known to be markdown-blocked, streams child-command progress, and uses a lower retry budget.
- Use the broad weekly live refresh only for full weekly maintenance, never as the default follow-up to a repair.
- Broad weekly live refresh requires both explicit user approval and the CLI guard flag `--confirm-full-live`.
- If a fast dry-run reports drift, run only the drifting lane with `--only <step> --fast --live --confirm-full-live`, then repeat the same `--only <step> --fast` dry-run.
- If the goal is Command Center repair, prefer:
  - `npm run control-tower:sync -- --today <date>`
  - `npm run control-tower:sync -- --today <date> --live`
  - `npm run control-tower:sync -- --today <date>`
- If a project-page markdown loop fails, stop after the failing lane and diagnose that lane directly instead of rerunning the full weekly sequence.
- Use subagents or separate chats for read-only work only: blocker classification, log review, migration planning, and test review. Do not run multiple live Notion writers in parallel against the same integration.
- Use the signed-in browser as a visual confirmation surface for current pages and Command Center replacements, not for bulk edits.
- Durable speed target: move generated project briefs toward child/linked records or structured properties so the workflow stops depending on direct project-page markdown patches.
- Detailed speed runbook: `docs/notion-api-speed-workflow.md`.

## Safety defaults

- Never hardcode the Notion token.
- Keep `allowDeletingContent=false` unless the user explicitly approves a destructive replacement.
- Treat template-based destinations as asynchronous and wait for template readiness before markdown patching.
- Surface rate-limit retries and truncation warnings clearly.

## Commands

- `npm run destinations:check`
- `npm run destinations:resolve`
- `npm run publish:notion -- --request <file>`
- `npm run publish:notion -- --destination <alias> --file <path> --dry-run`
- `npm run maintenance:weekly-refresh`
- `npm run maintenance:weekly-refresh -- --fast`
- `npm run maintenance:weekly-refresh -- --live --confirm-full-live`
- `npm run portfolio-audit:views-plan`
- `npm run portfolio-audit:views-validate`
- `npm run portfolio-audit:control-tower-sync`
- `npm run portfolio-audit:external-signal-seed-mappings`
- `npm run portfolio-audit:provider-expansion-audit`
- `npm run portfolio-audit:operational-rollout`
- `npm run portfolio-audit:review-packet`
- `npm run portfolio-audit:phase-closeout`

## Current aliases

- `weekly_reviews`
- `build_log`
- `project_portfolio`
- `local_portfolio_projects`
- `local_portfolio_command_center`
- `skills_library`
- `research_library`
- `ai_tool_site_matrix`

## Project database roles

- `Local Portfolio Projects` is the operating database for projects that are completed or in some kind of build-status workflow.
- `Project Portfolio` is for projects that have not been started yet.
- Do not blur the two systems: use `Local Portfolio Projects` for active/completed operating work and `Project Portfolio` for pre-start portfolio intake.

## Scoped operations rule for single-project pipeline pushes

- When a session is pushing a single project through the Notion and GitHub pipeline, do not finish by running `npm run maintenance:weekly-refresh`, `npm run portfolio-audit:external-signal-sync`, or `npm run portfolio-audit:control-tower-sync` unless the user explicitly asks for a portfolio-wide refresh.
- Treat requests such as "refresh everything live", "run the weekly sequence", and "catch me up" as explicit permission to use the portfolio-wide commands.
- Preferred fast path for one project: explore the project and search Notion for an existing row, create or push the GitHub repo if needed, publish the build log and any skills, research, or tool records, run `npm run portfolio-audit:external-signal-seed-mappings -- --live --limit <N>` to create the source row, then do one Notion MCP property update that sets counts, state fields, and any needed derived fields.
- For this single-project lane only, direct Notion MCP property updates are preferred over repo-wide sync commands because there is no single-project CLI for those field updates today.
- This exception only changes how Notion-side project fields are finalized after a single-project push. Governed GitHub writes still use the normal approval pipeline.

## When blocked

Only stop for:

- missing Notion token
- missing integration access to a page or data source
- a required live-write approval

## Local Portfolio Projects

- Use `npm run maintenance:weekly-refresh` only when the user explicitly wants the portfolio-wide weekly refresh sequence.
- Use targeted shared-CLI commands such as `npm run portfolio-audit:control-tower-sync` when the user asks for a narrower portfolio-wide refresh.
- Do not use portfolio-wide refresh commands as the default follow-up after publishing or wiring a single project. For single-project pushes, follow the scoped rule above and set the project fields directly.
- Saved view definitions live in `/Users/d/Projects/Notion/config/local-portfolio-views.json`.
- The view config now also stores the live Notion view IDs for the target eight views.
- Use `npm run portfolio-audit:views-plan` to print the exact saved-view plan for future sessions.
- Use `npm run portfolio-audit:views-validate` to confirm the config still matches the live data source schema before an MCP view sync.
- Preferred view-sync strategy: direct REST for data, Notion MCP for saved views, Playwright only as fallback if MCP auth is unavailable.
- Phase-one control-tower rules and mutable phase state live in `/Users/d/Projects/Notion/config/local-portfolio-control-tower.json`.
- `portfolio-audit:control-tower-sync` should stay dry-run by default and only write live when `--live` is explicit.
- Do not run `portfolio-audit:control-tower-sync` or `portfolio-audit:external-signal-sync` as the default final step for a single-project push. Save those commands for explicit portfolio-wide refresh requests.
- `portfolio-audit:review-packet` should publish the current weekly review from build-log and project state rather than manual reconstruction.
- `portfolio-audit:phase-closeout` is responsible for keeping `docs/notion-roadmap.md` and the Build Log aligned on the exact next-phase brief.

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Notion Operating System is the local automation and rules layer that connects Notion project databases, GitHub external signals, and governed action workflows. It publishes markdown into Notion, refreshes portfolio control-tower fields, generates weekly review packets, syncs GitHub signals, and executes approved GitHub actions through a dry-run-first governance pipeline.

## Current State

The repo is an operational control system, not an ad hoc Notion script folder. The Local Portfolio Projects database is the main operating surface; config files define destinations, policies, schemas, views, and rollout rules. Broad weekly maintenance is available but should only run when explicitly requested.

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

Prior lessons, decisions, and context for this project live in SecondBrain. Search the vault via the `engraph` MCP for `notion-os`, `Notion Operating System`, and related stack terms before non-trivial work; historical map paths may move.
