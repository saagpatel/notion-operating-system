# Continuation Prompt For Claude Code

Continue this work in the same workspace unless I say otherwise.

## Mission
This repo is a working Notion Operating System in `/Users/d/Projects/Notion`. It publishes local markdown into Notion, refreshes portfolio control-tower fields, syncs external GitHub signals, and runs governed GitHub write workflows. The active lane is **Phase 12: managed write reliability and daily-driver hardening**.

## Workspace
- Same folder as the previous session: `/Users/d/Projects/Notion`
- Treat the workspace as source of truth
- Re-ground from files before changing anything
- Check `git status --short --branch` before trusting branch or worktree state
- Dry-run first unless the user has explicitly approved a live write

## Read These First
- `/Users/d/Projects/Notion/AGENTS.md`
- `/Users/d/Projects/Notion/HANDOFF.md`
- `/Users/d/Projects/Notion/README.md`
- `/Users/d/Projects/Notion/docs/notion-roadmap.md`
- `/Users/d/Projects/Notion/docs/notion-phase-memory.md`
- `/Users/d/Projects/Notion/docs/github-governed-actions-runbook.md`
- `/Users/d/Projects/Notion/docs/governance-sync-failure-troubleshooting.md`
- `/Users/d/Projects/Notion/docs/governance-incident-followup-runbook.md`

## Latest Checkpoint
- A June 6 audit found the repo operationally healthy, but not clean branch truth.
- After `git fetch --prune origin`, the active branch was `codex/fix/notion-autolink-markdown-normalization`, tracking `origin/main` and reporting `ahead 5, behind 2`.
- The working tree had four uncommitted code/test files: `src/notion/external-signal-sync.ts`, `src/notion/weekly-refresh.ts`, `tests/external-signal-sync.test.ts`, and `tests/weekly-refresh.test.ts`.
- Those active edits appear to harden stored external-signal brief writes with retries and split large live external-signal project-page refreshes into smaller batches.
- Local validation passed: `npm run typecheck`, `npm test`, `npm run build`, CLI smoke checks, governance health, doctor checks, destination checks, view schema validation, Codex evals, and hook/MCP checks.
- `npm audit --json` currently reports a moderate `hono` advisory path through `@modelcontextprotocol/sdk -> hono@4.12.18`. Dependabot PR #99 updates `hono`; PR #94 updates `tsx`.
- A fast weekly dry-run for 2026-06-06 completed with `failed=0` and `partial=0`, but reported `needsLiveWrite=true` across `control-tower-sync`, `execution-sync`, `intelligence-sync`, and `review-packet`.

## Decisions Already Made
- Keep Phase 12 focused on managed write convergence, retry safety, and daily-driver reliability.
- Keep the existing governed GitHub and bounded Vercel control lanes; do not widen provider/action scope without a concrete reason.
- Use the health report and command center as the main operator visibility surface.
- Prefer shared CLI commands and current runbooks over inventing new surfaces.
- Treat ChatGPT Pro or browser advice as advisory only; Codex owns local truth, verification, and durable records.

## Rejected Paths
- Do not use `npm run maintenance:weekly-refresh -- --live` as a targeted repair tool.
- Do not run portfolio-wide live refresh commands after a single-project push unless the user explicitly asks for portfolio-wide refresh.
- Do not assume branch, audit, or live Notion drift state from this file; verify locally.

## Current State That Matters
- The repo is an operational control system, not an ad hoc script folder.
- Local safety checks are strong, but current branch divergence and uncommitted code changes must be resolved before any ship/merge claim.
- The command surface is intentionally dry-run first, with live writes gated by explicit flags and user approval.
- Weekly maintenance drift is currently a live-write decision, not a failing local validation problem.
- The active security follow-up is the `hono` advisory path via MCP SDK, not the older ExcelJS/UUID note.

## Open Loops
- Review and land or discard the active code/test changes intentionally.
- Reconcile the current branch against `origin/main`.
- Merge or otherwise handle Dependabot PR #99 to clear the current `hono` advisory path; review PR #94 separately.
- If live Notion repair is approved, run each drifting lane as targeted dry-run -> live -> same dry-run.
- Keep docs current as active workflows evolve.

## Next Best Step
1. Run `git status --short --branch` and inspect the active dirty diff before making more changes.
2. Run focused verification for the active code edits, especially `tests/external-signal-sync.test.ts` and `tests/weekly-refresh.test.ts`.
3. Decide whether the active reliability changes should be committed, rebased, or set aside.
4. If the user approves live Notion writes, repair only the drifting lane with that lane's dry-run, live command, and matching follow-up dry-run.
5. Keep broad weekly live refresh reserved for explicit weekly-maintenance approval.

## Guardrails
- Reuse established decisions unless I explicitly reopen them
- Do not restart discovery from scratch
- Do not add new provider/action scope unless you find a serious reason
- If the prompt and the files disagree, inspect the files and explain the mismatch before proceeding
