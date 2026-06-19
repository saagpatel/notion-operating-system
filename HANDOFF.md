# Notion Operating System Handoff

## Current state

Latest checkpoint: 2026-06-13.

The real checkout is `/Users/d/Projects/Notion`. The historical `/Users/d/Notion` path is a hollow stub containing only a `.git/hooks/reference-transaction` tripwire hook; `git status` there fails with `fatal: not a git repository`. Do not write into `/Users/d/Notion`.

The repo is on `main` tracking `origin/main`; do not treat this file as the source of truth for the current branch or working tree. Check `git status --short --branch` before acting.

The active operating phase remains Phase 12: managed write reliability and daily-driver hardening. One repo-model caveat: `config/local-portfolio-control-tower.json` still has `phaseState.currentPhase = 10`, while the hand-maintained roadmap and operating docs are on Phase 12. Do not bump that config number without extending `src/notion/local-portfolio-roadmap.ts`, which currently renders generated phases only through Phase 10.

## Local closeout note - 2026-06-14

- Safe local cleanup restored `.env.example` to the active runtime environment surface with blank secret values, including `GITHUB_TOKEN`, `NOTION_PROFILE`, `NOTION_HTTP_TIMEOUT_MS`, `GOOGLE_CALENDAR_TOKEN`, `VERCEL_WEBHOOK_SECRET`, and break-glass token placeholders. Bridge-db auth placeholders were not kept because this repo source does not currently parse them.
- `tests/package-surface.test.ts` now guards the `.env.example` runtime surface, active-path cleanup, untrusted-content wrappers for agent-readable Notion markdown, absence of local LLM generation callsites, and explicit dry-run/live confirmation gates.
- Local verification after the cleanup: `git diff --check`, `npm run typecheck`, targeted changed-surface tests, full `npm test`, and `npm run build` all passed.
- Read-only/dry-run operational verification on 2026-06-14: `npm run governance:health-report` returned healthy with 0 warnings, and `npm run maintenance:weekly-refresh -- --today 2026-06-14 --fast --summary-first` returned 6 clean lanes, 0 drift, 0 failed/partial steps, and `needsLiveWrite=false`; no live Notion writes were run.
- `config/local-portfolio-control-tower.json` still has local generated metric drift for 2026-06-14 (`overdueReviews=14`, `recentBuildSessions=17`, `weeklyReviewLastPublishedAt=2026-06-14`). Treat that file as an operational-state split/defer candidate unless a later session intentionally lands a generated-state checkpoint.

## Verified today

- `npm run governance:health-report` reports healthy governance and actuation posture with no warnings.
- `npm run control-tower:schema-report` fetched 138 Local Portfolio Projects rows and confirmed the intended manual/derived/legacy field split; count fields remain stale because relation counts are not rollups.
- `npm run control-tower:repo-mapping-audit -- --include-all-gaps --live-normalize-local-paths` applied 5 Local Path normalizations: BattleGrid, IncidentWorkbench, LegalDocsReview, OrbitForge (staging), and Relay. Follow-up state is 0 local mapping gaps and 0 GitHub mapping gaps.
- `npm run control-tower:review-recovery -- --today 2026-06-13 --include-metadata-gaps --limit 120 --live` applied 85 review-recovery updates, clearing overdue reviews, missing Next Move, and missing Last Active to 0.
- `npm run control-tower:operator-brief -- --today 2026-06-13 --packet-stale-days 14` now reports 0 overdue reviews, 0 stale active projects, 14 orphans needing first kickoff, 6 orphans already routed to kickoff packets, 0 stale-task packets, and 0 at-risk packets.
- `governance:orphan-classify` now supports repeatable exact `--project-title` filters; focused tests and `npm run typecheck` pass for the selector path.
- Scoped live orphan-classify passes approved the 4 active-infra kickoff requests and created 4 kickoff work packets: cost-tracker, cross-system-smoke, portfolio-health, and PortfolioCommandCenter. They published scoped Build Log classification reports and did not touch the other orphan candidates.
- A scoped live Execution Tasks pass created one concrete first task for each of those kickoff packets: `Kickoff proof: cost-tracker local checks`, `Kickoff proof: cross-system-smoke read-only plan`, `Kickoff proof: portfolio-health dev checks`, and `Kickoff proof: PortfolioCommandCenter typecheck`.
- The four approved active-infra kickoff proof tasks were worked from live local repo evidence on 2026-06-13 and marked Done. A linked Build Log proof row, `Kickoff proof batch: active-infra local checks (2026-06-13)`, records the exact passing checks for cost-tracker, portfolio-health, cross-system-smoke, and PortfolioCommandCenter. The four kickoff packets were accepted and marked Done; orphan accounting now treats completed kickoff packets as handled evidence so they do not re-enter the kickoff-creation queue.
- DevToolsTranslator's release blocker lane was rechecked from live local repo evidence. The `0.1.0-beta.14` dry-run release manifests were regenerated for macOS, Windows, Linux, and the Chrome public extension; promotion readiness now passes `manual_smoke_marker` and `release_manifests_present`, and staged-public prerelease dry-run succeeds. The packet remains blocked on `cws_credentials_missing` and `updater_signature_missing`; updater feed/controller proof still reports `signature_verified=false` / `signature_invalid` until `UPDATER_SIGNATURE` is provided.
- JobCommandCenter's bot-detection smoke lane was rechecked from live local repo evidence. The LinkedIn adapter/session tests pass (`python3 -m pytest tests/test_linkedin.py tests/test_playwright_base.py -q` => 16 passed), but `/Users/d/.jcc/playwright_data/linkedin` currently contains 0 files, so no persisted logged-in LinkedIn browser session exists for a truthful live Easy Apply smoke. The existing execution task remains Blocked with 2026-06-20 due date; targeted `execution-sync` refreshed the single generated project brief and the follow-up dry-run is clean.
- Nocturne's geospatial sync proof lane was rechecked from live local repo evidence. The repo has real camera, CoreLocation, local GRDB persistence, Supabase upload/heatmap, and validation test surfaces, but no physical-device capture/GPS/share artifact was found. Local `xcodebuild` proof is blocked because this machine's active developer directory is Command Line Tools, not full Xcode. The existing execution task remains Blocked with 2026-06-20 due date; targeted `execution-sync` refreshed the single generated project brief and the follow-up dry-run is clean.
- The stale-task queue was recovered for Nocturne, JobCommandCenter, and Afterimage by updating the existing evidence-backed tasks, not by creating placeholder work. Nocturne and JobCommandCenter are now blocked with current proof blockers and 2026-06-20 due dates; Afterimage is Ready with a current physical-device proof plan and a 2026-06-20 due date. Targeted `execution-sync` refreshed the 3 generated project execution briefs, and the follow-up dry-run is clean.
- Targeted live weekly repairs were run lane-by-lane, not as a broad live refresh: Control Tower, Execution Sync, Intelligence Sync, External Signals, Weekly Review Packet, then a final Control Tower refresh.
- Full generated brief coverage was refreshed during the landscape pass, and the review-recovery follow-through refreshed 85 execution briefs plus 21 recommendation briefs affected by the review metadata changes.
- The current weekly review page is `Week of 2026-06-08`, page ID `37dc21f1-caf0-81a8-8a97-e5c23dfa35cf`.
- Final integrated fast preflight for 2026-06-13 reports 6 clean lanes, 0 drift, 0 failed/partial steps, and `needsLiveWrite=false`.
- Post-packet, first-task, stale-task, and active-infra proof checks converged cleanly: repo mapping has 0 local and GitHub gaps, review recovery has 0 eligible updates, targeted execution-sync repaired the expected generated brief drift from the 4 kickoff packets, the 4 first tasks, the 3 stale-task updates, and the 4 proof completions, and final weekly fast preflight is back to 6 clean lanes with `needsLiveWrite=false`.

## Landscape notes

- Notion Local Portfolio Projects currently has 138 rows. Latest control-tower metrics: 18 Shipped, 16 Needs Review, 0 Needs Decision, 29 Worth Finishing, 54 Resume Now, 14 Cold Storage, and 7 Watch.
- Latest local portfolio truth lives at `/Users/d/Projects/GithubRepoAuditor/output/portfolio-truth-latest.json`. It regenerates frequently, so do not copy counts or active-project sets from this handoff. Re-query the JSON before using portfolio counts in another doc:
  `jq '{generated_at,total:(.projects|length),counts:.source_summary.attention_state_counts}' /Users/d/Projects/GithubRepoAuditor/output/portfolio-truth-latest.json`.
- For current active-product or active-infra membership, inspect `.projects[].derived.attention_state` in that JSON instead of trusting an inlined list. Do not inline the full decision-needed set; inspect the JSON when that lane matters.
- Many recently touched repos are still `manual-only` under the portfolio attention contract. Do not promote them just because docs or generated evidence changed.
- External Signal sync emitted several soft `Stored external signal brief property patch failed` messages during live batches, but the full follow-up dry-run returned clean with 0 brief drift. Treat the noisy patch path as a maintainability risk if it reappears.

## Active follow-up

1. Review recovery is clear for now: follow-up dry-run reports 0 eligible projects, 0 planned updates, 0 overdue reviews, 0 missing Next Move, and 0 missing Last Active.
2. Orphan kickoff improved from 18 actionable orphans / 0 kickoff packets to 14 actionable orphans / 6 routed or completed kickoff packets. The four active-infra packets `Kickoff: cost-tracker`, `Kickoff: cross-system-smoke`, `Kickoff: portfolio-health`, and `Kickoff: PortfolioCommandCenter` each have a completed proof task, a linked Build Log proof row, and are now Done.
3. The remaining orphan candidates should not be promoted automatically: most are manual-only, `evals` and `hermes-harness-foundation` are experiments, and `GithubRepoAuditor-public` is unsafe title drift against the real `/Users/d/Projects/GithubRepoAuditor` repo.
4. Packet staleness is clear. Packet follow-through now excludes the accepted active-infra kickoff packets: open packets dropped to 4, `orphanKickoffPackets=0`, `unworkedPackets=0`, and the blocked-proof queue is led by DevToolsTranslator, JobCommandCenter, and Nocturne. DevToolsTranslator is narrowed to release secrets, JobCommandCenter is narrowed to operator LinkedIn login/session proof before a safe Easy Apply dry-run, and Nocturne is narrowed to full-Xcode plus physical iOS camera/location/sync proof.
5. If touching roadmap phase config, first extend the generated roadmap phase model beyond Phase 10; otherwise leave `phaseState.currentPhase` alone.
6. Use targeted lane repair commands for narrow drift. Do not use broad weekly live refresh as the default repair tool.
7. Use `npm run sandbox:smoke` before risky advanced workflow changes that touch control-tower, signals, governance, rollout, or profile portability paths.

## Restart order

1. `AGENTS.md`
2. `HANDOFF.md`
3. `docs/weekly-notion-maintenance-operating-model.md`
4. `docs/notion-roadmap.md`
5. `README.md`
6. `git status --short --branch`
7. `npm run maintenance:weekly-refresh -- --today 2026-06-13 --fast --summary-first`
