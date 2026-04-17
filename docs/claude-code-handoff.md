# Continuation Prompt For Claude Code

Continue this work in the same workspace unless I say otherwise.

## Mission
This repo is a working “Notion Operating System” in `/Users/d/Notion`. The major Phase 9 feature work is already landed: governed GitHub actions, bounded Vercel redeploy/rollback/promote, operator runbooks, a compact `governance:health-report`, and Notion command-center health visibility. The large cleanup and project-hardening pass is now also complete enough that the next slice should be **Phase 10 follow-through and operational maturity**, not another broad cleanup sweep.

## Workspace
- Same folder as the previous session: `/Users/d/Notion`
- Treat the workspace as source of truth
- Re-ground from files before changing anything

## Read These First
- `/Users/d/Notion/AGENTS.md`
- `/Users/d/Notion/README.md`
- `/Users/d/Notion/docs/notion-roadmap.md`
- `/Users/d/Notion/docs/notion-phase-memory.md`
- `/Users/d/Notion/docs/github-governed-actions-runbook.md`
- `/Users/d/Notion/docs/governance-sync-failure-troubleshooting.md`
- `/Users/d/Notion/docs/governance-incident-followup-runbook.md`

## Latest Checkpoint
- The repo has now completed a deep audit-and-prune pass across script surface, docs alignment, and internal utility boundaries.
- That cleanup is now merged reality and the restart docs have been refreshed against the merged repo state.
- Recent cleanup outcomes:
  - maintenance-only and historical utilities were moved behind `src/internal/notion-maintenance/` or `src/internal/portfolio-audit/`
  - public npm scripts no longer point directly at `src/notion/*.ts`
  - legacy compatibility aliases now route through the shared CLI or clearly internal maintenance entrypoints
  - `rollout:vercel-readiness` is now part of the shared rollout CLI surface
  - historical schema migration utilities remain available but are clearly treated as internal/historical
- Recent verification passed repeatedly:
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npm run verify`
- Package-surface tests now enforce the public-script boundary directly

## Decisions Already Made
- Do **not** widen provider scope by default -> the project should focus on maturity/cleanup now
- Keep the existing governed GitHub + bounded Vercel control lanes -> those are already proven
- Use the health report and command center as the main operator visibility surface
- Prefer shared CLI commands and current runbooks over inventing new surfaces
- Treat the broad cleanup pass as complete enough for now -> future work should be explicit product or operational work unless a new structural problem appears

## Rejected Paths
- Do not start new provider-expansion work right now -> rejected because the repo needs cleanup and clearer beginner-facing documentation first
- Do not re-open major Vercel architecture work -> rejected because the bounded recovery loop is already complete
- Do not assume the README is fully current -> it is not

## Current State That Matters
- The repo is structurally healthy and materially cleaner than it was before the hardening track
- The command surface is now more intentional:
  - shared CLI + modern npm aliases are the public operator path
  - internal maintenance tools are quarantined under `src/internal/*`
  - compatibility aliases remain only where they still buy something
- a 2026-04-17 confidence pass verified that `control-tower:trend-analysis`, `governance:orphan-classify`, `bridge-db:status`, and `signals:morning-brief` all produce useful dry-run or read-only output
- the same pass repaired the `sandbox` profile so that sandbox doctor now passes path isolation, token isolation, and target isolation, and `npm run sandbox:smoke` now passes end to end
- the sandbox profile-owned Vercel manual seeds and rollout targets were trimmed because the sandbox workspace does not currently contain matching local project rows for those primary-profile IDs
- the orphan-classification packet lane now creates structured `work_packets` entries with execution fields and `Local Project` relations; the remaining orphan follow-through gap is approval gating rather than packet shape
- the orphan-classification lane now has an approval-backed path too: `--request-approval` creates governance requests for kickoff packets, and `--create-approved-packets` only materializes approved ones
- Current `governance:health-report` may still warn in active runtime about missing `VERCEL_TOKEN` and `VERCEL_WEBHOOK_SECRET`; treat that as an operational-env follow-up, not a code bug
- The next meaningful work should start from one explicit Phase 10 delivery slice, not from another repo cleanup pass
- `notification-hub` and `repo-auditor` are now fully landed enough that they should be treated as completed supporting infrastructure, not as the next default adapter tasks

## Open Loops
- Advance active Phase 10 work rather than reopening generic cleanup:
  - continue signal-adapter wiring only where a real gap still remains, most likely `bridge-db`
  - keep morning-brief, orphan classification, and trend-analysis lanes coherent
  - prefer the new approval-backed orphan path for live use when human signoff is desirable
  - preserve script-surface discipline as new commands are added
- Keep docs current as active workflows evolve
- Continue normal maintenance:
  - dependency cleanup when upstream fixes make it worthwhile
  - sandbox rehearsal discipline for risky live workflows

## Next Best Step
1. Re-ground from `HANDOFF.md`, `docs/notion-roadmap.md`, and `docs/script-surface-classification.md`.
2. Choose the next explicit Phase 10 implementation slice now that the sandbox rehearsal lane is healthy again.
   The best current candidate is no longer `notification-hub` or `GithubRepoAuditor`; those are already proven in sandbox live mode.
   Choose either `bridge-db` completion or operator-surface productization on top of the proven adapters.
3. Treat the sandbox GitHub lane, orphan packet structure, and approval-backed orphan flow as already-proven foundations unless a new bug appears.
4. Treat the `notification-hub` and `repo-auditor` adapters as already-proven foundations too:
   - both use global local-provider source rows
   - `notification-hub` is project-only in v1
   - `repo-auditor` resolves through GitHub source identifiers first
5. Prefer shared CLI additions over new standalone script entrypoints.
6. Re-run `notion-os --profile sandbox doctor --json`, `npm run sandbox:smoke`, and the relevant Phase 10 dry-run checks after any new work.

## Guardrails
- Reuse established decisions unless I explicitly reopen them
- Do not restart discovery from scratch
- Do not add new provider/action scope unless you find a serious reason
- If the prompt and the files disagree, inspect the files and explain the mismatch before proceeding
