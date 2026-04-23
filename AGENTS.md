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
- Saved view definitions live in `/Users/d/Notion/config/local-portfolio-views.json`.
- The view config now also stores the live Notion view IDs for the target eight views.
- Use `npm run portfolio-audit:views-plan` to print the exact saved-view plan for future sessions.
- Use `npm run portfolio-audit:views-validate` to confirm the config still matches the live data source schema before an MCP view sync.
- Preferred view-sync strategy: direct REST for data, Notion MCP for saved views, Playwright only as fallback if MCP auth is unavailable.
- Phase-one control-tower rules and mutable phase state live in `/Users/d/Notion/config/local-portfolio-control-tower.json`.
- `portfolio-audit:control-tower-sync` should stay dry-run by default and only write live when `--live` is explicit.
- Do not run `portfolio-audit:control-tower-sync` or `portfolio-audit:external-signal-sync` as the default final step for a single-project push. Save those commands for explicit portfolio-wide refresh requests.
- `portfolio-audit:review-packet` should publish the current weekly review from build-log and project state rather than manual reconstruction.
- `portfolio-audit:phase-closeout` is responsible for keeping `docs/notion-roadmap.md` and the Build Log aligned on the exact next-phase brief.
