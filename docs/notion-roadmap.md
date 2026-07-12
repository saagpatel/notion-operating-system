# Notion Operating Roadmap

Updated: 2026-07-11

## July 11 Integration Checkpoint

- The Fable exploration material and four reliability feature lines are merged into `main` from `codex/fable-integration-closeout-20260711`; verify `origin/main` live before relying on publication status.
- No GitHub action, deployment, public-material publication, or weekly refresh was performed in this closeout lane.
- `npm run verify` passes with 64 test files and 530 tests, followed by build, built-CLI smoke, packed-install smoke, and git-install smoke.
- Governance health reports healthy with zero warnings, governance audit passes, repo doctor passes against all 23 configured destinations, and BridgeDB status is healthy with schema version 13 and no actionable unprocessed shipped rows.
- A direct read-only Notion schema check confirms the live Build Log has `Sync Key` as `rich_text`; its title, date, project relations, and tags also match the integrated schema gate.
- The external `--limit 1 --shipped-only` proof completed against real TradeOffAtlas event `5655`: dry-run planned one write with no skips or failures, live mode created one Build Log page, readback confirmed the sync key, relation, date, tags, and complete markdown, and BridgeDB attached a Notion receipt before marking the event `PROCESSED`.
- The formerly unrelated `config/local-portfolio-control-tower.json` metrics refresh was preserved, reviewed, and later landed as its own coherent commit.
- All four feature branch tips were proven contained before their dedicated branches and worktrees were pruned; the canonical checkout is the only current worktree.
- Exact-title review recovery reduced the current overdue total from 88 to 80 across `cost-tracker`, `agent-bridge`, `cross-provider-egress-guard`, `GPT_RAG`, `knowledgecore`, `machine-control-tower`, `JobCommandCenter`, and `portfolio-health`. Matching readback dry-runs return zero work for all eight.
- `AIWorkFlow` and `PortfolioCommandCenter` remain explicitly unresolved rather than auto-advanced because newer BridgeDB completion evidence conflicts with their stored Notion next moves. The other overdue rows are outside the active portfolio attention contract.

## Current Phase
- Phase: 12 - Managed Write Reliability and Daily Driver Hardening
- Status: Active
- Objective: Make the daily driver durable now that Phase 11 can rank, publish, and audit the work queue.

## Repo State Snapshot
- The June 13 landscape refresh reconciled path drift: `/Users/d/Projects/Notion` is the real checkout, while `/Users/d/Notion` is a hollow non-worktree stub and must not receive writes.
- The June 13 dry-run-first refresh found 5 drifting weekly lanes and no failed or partial lanes; repairs used targeted live lane commands, not a broad live weekly refresh.
- The June 13 review-recovery follow-through applied 85 narrow Local Portfolio Project property updates and cleared overdue reviews, missing Next Move, and missing Last Active to 0.
- Final weekly fast preflight for 2026-06-13 reports 6 clean lanes, 0 drift, no failed or partial steps, and `needsLiveWrite=false`.
- The repo-mapping audit normalized 5 stale Local Path values and now reports 0 local mapping gaps and 0 GitHub mapping gaps.
- Operator brief now reports 0 overdue reviews, 0 stale active projects, 14 actionable kickoff orphans, 6 orphans with routed or completed kickoff packets, 0 stale-task packets, and 0 at-risk packets.
- The orphan-classify command now has repeatable exact `--project-title` filters so dry-runs, approval requests, and packet creation can be scoped to evidence-backed projects instead of sweeping every viable orphan.
- Scoped live orphan approval and approved-packet passes created 4 kickoff work packets for active-infra projects only: cost-tracker, cross-system-smoke, portfolio-health, and PortfolioCommandCenter. The other orphan candidates were left untouched under the portfolio attention contract.
- A scoped live Execution Tasks pass created one concrete first task for each of those four kickoff packets, moving packet follow-through from 4 unworked kickoff packets to 0 unworked packets and 4 `Ready to start` orphan-kickoff packets.
- The four active-infra kickoff proof tasks were worked from local repo evidence on 2026-06-13. A linked Build Log row, `Kickoff proof batch: active-infra local checks (2026-06-13)`, records the passing cost-tracker, portfolio-health, cross-system-smoke, and PortfolioCommandCenter checks; the four tasks are Done and the four kickoff packets have been accepted as Done.
- DevToolsTranslator release-blocker follow-through regenerated the missing `0.1.0-beta.14` dry-run release manifests and confirmed staged-public prerelease dry-run success. Promotion readiness is now narrowed to `cws_credentials_missing` and `updater_signature_missing`; updater rollout remains blocked on `signature_invalid` until `UPDATER_SIGNATURE` is available and `signature_verified=true` is proven.
- JobCommandCenter bot-detection follow-through confirmed the LinkedIn adapter/session tests pass, but the persisted LinkedIn Playwright profile has no session files. The existing task remains Blocked until the operator logs in through the visible browser, confirms session data, and runs one safe Easy Apply dry-run against an operator-selected listing.
- Nocturne geospatial sync follow-through confirmed the app has camera, location, local persistence, Supabase upload, and validation-test surfaces, but no physical-device camera/GPS/share proof artifact exists yet. Local `xcodebuild` proof is blocked until full Xcode is selected instead of Command Line Tools, so the task remains Blocked pending real-device proof.
- The June 13 stale-task pass updated the existing Nocturne, JobCommandCenter, and Afterimage execution tasks with fresh evidence-backed blockers or proof plans, then refreshed exactly 3 generated project execution briefs through targeted `execution-sync`. No broad live weekly refresh was used.
- Review-recovery downstream drift was repaired through targeted lanes only: 85 Control Tower derived row updates plus Command Center refresh, 85 execution briefs, 21 recommendation briefs, and the existing `Week of 2026-06-08` review packet.
- External-signal live batches emitted soft stored-brief property patch failures, but the full follow-up dry-run returned clean. Treat repeated patch noise as a maintainability risk rather than current portfolio drift.
- Config phase-state caveat: the hand-maintained roadmap and docs are on Phase 12, but `phaseState.currentPhase` in `config/local-portfolio-control-tower.json` remains at legacy Phase 10 until the generated roadmap phase model is extended beyond Phase 10.
- The May 31 targeted maintenance pass cleared the only current live Notion drift without using broad weekly live refresh as a repair tool.
- The first May 31 weekly fast preflight found 5 clean lanes and 1 drift lane, `intelligence-sync`; the targeted live repair updated exactly 1 recommendation brief, and the matching follow-up dry-run returned clean.
- Final weekly fast preflight for 2026-05-31 reports 6 clean lanes, 0 drift, no failed or partial steps, and `needsLiveWrite=false`.
- Operator brief now reports 0 overdue reviews, 0 stale active projects, 0 orphan kickoff gaps, 6 stale-task packets, and 6 at-risk packets. Daily Focus ranks DevToolsTranslator, JobCommandCenter, and Nocturne as the top Now items.
- Packet follow-through now scans 9 open packets and surfaces 8 follow-through rows: 3 blocked packets and 6 overdue packets.
- The May 31 ChatGPT advisory context zip was reviewed as evidence only. Its useful repo-facing guidance is boundary discipline: ChatGPT stays advisory, Codex verifies local truth, Drive is not source of truth, and compact receipts should precede any consultation schema.
- Dependabot PRs for `tmp`, `qs`, production dependencies, and development tooling were merged into `main`; local validation passes with `npm ci`, `npm run typecheck`, and `npm test`.
- `npm audit --json` now reports only the documented moderate `exceljs -> uuid` exception. The prior high `tmp` advisory and moderate `qs` advisory are cleared.
- The current weekly review page is `Week of 2026-05-25`; review recovery, Control Tower sync, Execution sync, Intelligence sync, External Signals sync, Morning Brief, and Daily Focus were repaired through targeted live commands and follow-up dry-runs.
- Final weekly fast preflight for 2026-05-30 reports 6 clean lanes and 0 drift after the Phase 12 Daily Focus preservation fix.
- Operator brief now reports 0 overdue reviews, 0 stale active projects, 0 orphan kickoff gaps, and 8 at-risk stale packets. The top stale packet queue is Nocturne, DevToolsTranslator, IncidentWorkbench, JobCommandCenter, and GPT_RAG.
- Daily Focus is present and dry-run clean on the current weekly review page, with DevToolsTranslator, GPT_RAG, and Phantom Frequencies as the top Now items.
- The first Phase 12 implementation fix is complete: weekly review packet generation now preserves the Daily Focus managed section, so review-packet and Daily Focus no longer compete in the weekly fast preflight.
- Weekly managed-section preservation now uses `WEEKLY_REVIEW_MANAGED_SECTIONS` so External Signals, Morning Brief, Trend Analysis, and Daily Focus are registered in one place.
- The repo is currently in a strong maintenance state after a broad cleanup and command-surface hardening pass.
- The May 18 Phase 11 daily-focus slice is live as `npm run control-tower:today`, synthesizing packet priority and follow-through pressure into a managed Daily Focus section on the current weekly review page.
- The May 18 packet-staleness slice is live in `npm run control-tower:operator-brief`, surfacing stale task activity and at-risk overdue packets without adding new Notion fields.
- The May 18 managed-section block audit is live as `npm run control-tower:managed-section-audit`; it confirms Daily Focus is readable as top-level Notion blocks, while replacement writes remain deferred to the markdown REST path until a rollback-safe block writer exists.
- The May 18 signal-quality cleanup is complete: `SecondBrain` and `claude-code-harness` GitHub placeholders are now intentionally `Paused`, and the repo-mapping audit reports 0 GitHub mapping gaps on the operator surface.
- The May 18 Phase 12 first operating pass republished Packet Follow-Through, refreshed the weekly review packet, repatched Morning Brief and Daily Focus, and documented the required daily-driver refresh order.
- The May 18 weekly review page was created for `Week of 2026-05-18`, and the Daily Focus section was patched live with top focus items AIWorkFlow, DevToolsTranslator, Codec, Construction, and Nexus.
- The May 16 Phase 11 first slice is live in the repo as `npm run control-tower:packet-prioritizer`, ranking open work packets by recommendation score, external signal severity, evidence freshness, and task staleness without adding new Notion fields.
- The May 16 operator pass recovered review drift and created approved kickoff packets for all viable orphan projects that lacked packets; follow-up dry-runs report 0 overdue reviews, 0 missing Next Move rows, and 0 viable orphans still needing packet creation.
- The May 10 review-recovery pass is complete: `npm run control-tower:review-recovery` is now available, the live pass cleared the review backlog and small review metadata gaps, and the operator brief now reports 0 overdue reviews.
- The May 10 follow-through pass closed the Command Center and weekly-review content drift loops: both now return clean dry-runs after live refreshes.
- The May 10 operator brief command is live as `npm run control-tower:operator-brief`, combining top signal risks, stale-active count, orphan kickoff follow-through, and the first review-recovery queue.
- The May 10 packet follow-through lane is live as `npm run control-tower:packet-follow-through`, ranking existing kickoff packets, signal-risk repair packets, overdue packet work, and packets that need a first concrete task. The first live run created the missing ApplyKit signal-risk follow-up task and published a Build Log report.
- The May 9 Notion maintenance work is complete: Dependabot updates are merged, the targeted cleanup lanes are clean, and the Command Center destination now points at the current live page.
- The May 9 Phase 10C operator-surface pass is complete: morning brief priority ranking, governed orphan actions, deduped trend movement, live weekly sections, approved orphan kickoff packets, and a Command Center refresh are now in place.
- The May 4 Notion maintenance work is complete: Intelligence, Execution, and External Signal generated briefs now converge through dedicated Notion databases instead of project-page markdown writes.
- The weekly refresh fast path includes compact per-lane timing output; as of 2026-05-31 it is clean across all six lanes.
- The next Notion-only product focus is packet-staleness follow-through, led by DevToolsTranslator in Daily Focus and Nocturne in stale-task age.
- Weekly `--fast` uses bounded project brief write concurrency and can be tuned with `--project-concurrency`.
- That cleanup and hardening work is now merged reality, not an in-progress branch posture.
- The shared CLI plus modern npm aliases are now the intended public operator surface.
- Legacy `portfolio-audit:*` aliases remain only where compatibility is still useful, and they now route either through the CLI or through clearly internal maintenance utilities.
- Public npm scripts no longer point directly at `src/notion/*.ts`.
- Internal maintenance and historical migration utilities were quarantined under `src/internal/notion-maintenance/` or `src/internal/portfolio-audit/`.
- Current focus should be Phase 12 managed write convergence and packet follow-through, not another repo-wide cleanup campaign.

## Fresh Verification Snapshot
- `npm run governance:health-report` reports healthy governance and actuation posture with no warnings on 2026-06-13.
- `npm run control-tower:schema-report` fetched 138 Local Portfolio Projects rows and confirmed the intended manual, derived, related, and legacy field model; 383 stale relation/count mismatches remain because count fields are not Notion rollups.
- `npm run control-tower:repo-mapping-audit -- --include-all-gaps --live-normalize-local-paths` applied 5 supported Local Path normalizations, and the follow-up audit reports 0 local mapping gaps and 0 GitHub mapping gaps.
- `npm run control-tower:review-recovery -- --today 2026-06-13 --include-metadata-gaps --limit 120 --live` applied 85 updates; the follow-up dry-run reports 0 eligible projects, 0 planned updates, 0 overdue reviews, 0 missing Next Move, and 0 missing Last Active.
- `npm run control-tower:operator-brief -- --today 2026-06-13 --packet-stale-days 14` reports 0 overdue reviews, 0 stale active projects, 14 actionable orphans, 6 orphans with routed or completed kickoff evidence, 0 stale-task packets, and 0 at-risk packets.
- Targeted live refreshes for `control-tower-sync`, `execution-sync`, `intelligence-sync`, `external-signals`, and `review-packet` completed on 2026-06-13; full-scope follow-up dry-runs are clean for Control Tower, execution, intelligence, review packet, and external-signal generated briefs.
- Final `npm run maintenance:weekly-refresh -- --today 2026-06-13 --fast --summary-first` completed with 6 clean lanes, 0 drift lanes, no failed or partial steps, and `needsLiveWrite=false`.
- `npm test -- tests/orphan-classification.test.ts` and `npm run typecheck` passed after adding the scoped orphan title filter.
- `npm run governance:orphan-classify -- --today 2026-06-13 --live --request-approval --approve --project-title cost-tracker --project-title cross-system-smoke --project-title portfolio-health --project-title PortfolioCommandCenter` approved 4 scoped requests, and the matching `--create-approved-packets` command created 4 kickoff packets.
- Post-packet, first-task, stale-task, active-infra proof, and accepted-kickoff semantics checks converged: operator brief reports 14 actionable orphans, 6 orphans with routed or completed kickoff evidence, 0 stale-task packets, and 0 at-risk packets. Packet follow-through reports `orphanKickoffPackets=0` and `unworkedPackets=0`; completed kickoff packets no longer re-enter the kickoff-creation queue. Targeted control-tower, execution, intelligence, and review-packet repairs converged, and final weekly fast preflight is 6 clean lanes with `needsLiveWrite=false`.
- `npm ci` completed on 2026-05-31 and ran the prepare/build step successfully.
- `npm run typecheck` passed on 2026-05-31.
- `npm test` passed on 2026-05-31 with 59 test files and 403 tests.
- `npm run governance:health-report` reports healthy governance and actuation posture with no warnings.
- `npm run control-tower:operator-brief -- --today 2026-05-31 --packet-stale-days 14` reports 0 overdue reviews, 0 stale active projects, 0 actionable orphans, 6 stale-task packets, and 6 at-risk packets.
- `npm run control-tower:packet-follow-through -- --today 2026-05-31 --limit 12` scans 9 open packets and surfaces 8 follow-through packets, led by DevToolsTranslator, JobCommandCenter, Nocturne, IncidentWorkbench, and ModelColosseum.
- `npm run control-tower:today -- --today 2026-05-31 --limit 5` reports `weeklyReviewWouldChange=false`; the top Now items are DevToolsTranslator, JobCommandCenter, and Nocturne.
- `npm run control-tower:managed-section-audit -- --today 2026-05-31` finds the Daily Focus marker span on the current weekly page, with 19 managed blocks and markdown REST still recommended as the write mode.
- The first `npm run maintenance:weekly-refresh -- --today 2026-05-31 --fast --summary-first --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` found 1 drift lane: `intelligence-sync`.
- `npm run maintenance:weekly-refresh -- --today 2026-05-31 --only intelligence-sync --fast --live --confirm-full-live --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` updated 1 recommendation brief; the matching dry-run then reported the lane clean.
- Final `npm run maintenance:weekly-refresh -- --today 2026-05-31 --fast --summary-first --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` completed with 6 clean lanes, 0 drift lanes, no failed or partial steps, and `needsLiveWrite=false`.
- `gh pr list --state open --limit 20` returns no open PRs, and `gh run list --branch main --limit 10` shows latest `main` CI runs green; Dependabot's advisory workflow still fails on the accepted `exceljs -> uuid` exception.
- `npm run control-tower:review-recovery -- --today 2026-05-30 --include-metadata-gaps --limit 120 --live` applied 69 review-recovery updates; the follow-up dry-run returned `totalEligibleProjects=0`, `overdueReviews=0`, `missingNextMove=0`, and `missingLastActive=0`.
- `npm run control-tower:sync -- --today 2026-05-30 --live` applied 90 derived row updates and refreshed the Command Center; the follow-up dry-run returned `derivedRowsWouldChange=0` and `commandCenterWouldChange=0`.
- Targeted weekly-refresh live repairs for `execution-sync`, `intelligence-sync`, and `external-signals` each completed with `--fast --max-project-pages 119 --project-concurrency 2`; each matching follow-up dry-run returned `needsLiveWrite=false`.
- `npm run signals:morning-brief -- --today 2026-05-30 --lookback-days 7 --live` patched the current weekly page with 8 events and 98 coverage gaps.
- `npm run control-tower:today -- --today 2026-05-30 --limit 5 --live` patched Daily Focus onto `Week of 2026-05-25`; the follow-up dry-run returned `weeklyReviewWouldChange=false`.
- `npm run control-tower:managed-section-audit -- --today 2026-05-30` found the Daily Focus marker span on the current weekly page, with 19 managed blocks and markdown REST still recommended as the write mode.
- `npm run control-tower:operator-brief -- --today 2026-05-30 --packet-stale-days 14` reports 0 overdue reviews, 0 stale active projects, 0 orphan kickoff gaps, and 8 at-risk stale packets.
- `npm run maintenance:weekly-refresh -- --today 2026-05-30 --fast --summary-first --step-timeout-minutes 5 --max-project-pages 119 --project-concurrency 2` completed with 6 clean lanes, 0 drift lanes, no failed or partial steps, and `needsLiveWrite=false`.
- `npm run typecheck` and `npm test` passed after dependency updates, the Daily Focus preservation fix, and the weekly managed-section registry refactor. The test suite currently reports 59 test files and 401 tests.
- GitHub CI is green on the latest main merge commit; Dependabot's advisory workflow still fails on the accepted `exceljs -> uuid` exception.
- `npm run control-tower:operator-brief -- --today 2026-05-18 --packet-stale-days 14` reports 0 overdue reviews, 0 stale active projects, 0 orphan kickoff gaps, and 10 at-risk packets with stale task activity. The top five are DevToolsTranslator, IncidentWorkbench, visual-album-studio, Construction, and Nexus.
- `npm run signals:seed-mappings -- --live --limit 2` updated the two documented monitor-only GitHub placeholders, and `npm run control-tower:repo-mapping-audit -- --today 2026-05-18 --limit 80` now reports `githubMappingGapCount=0` and `attentionCount=0`.
- `npm run control-tower:packet-follow-through -- --today 2026-05-18 --limit 12 --live` republished the current 12-item packet recovery queue, then the weekly review packet and Morning Brief were refreshed live. Follow-up dry-runs report the weekly review packet clean, Daily Focus unchanged, and the Daily Focus block audit at a single 19-block marker span.
- `npm run control-tower:managed-section-audit -- --today 2026-05-18` found the Daily Focus managed markers on `Week of 2026-05-18` as top-level blocks 54-72 of 73, with a 19-block span. The block read path is viable; production replacement writes stay on `PATCH /pages/{id}/markdown` because append/delete block replacement is not transactional or rollback-safe yet.
- `npm run control-tower:today -- --today 2026-05-18 --limit 5` scanned 21 open packets and produced a valid Daily Focus section. The live follow-up patched the section onto `Week of 2026-05-18`.
- `npm run control-tower:review-packet -- --today 2026-05-18 --include-next-phase --live` created the weekly review page for `Week of 2026-05-18`.
- `npm run control-tower:packet-follow-through -- --today 2026-05-18 --limit 12` scanned 21 open packets and surfaced 12 follow-through rows: 5 blocked packet pressures, 17 overdue packet pressures, and 0 unworked packets.
- `npm run control-tower:packet-prioritizer -- --today 2026-05-18 --limit 12` scanned 21 open packets and returned 12 ranked packets. The top five were `AIWorkFlow - Notion-only production packet`, `DevToolsTranslator - release blocker packet`, `Codec - package the verified local baseline`, `Construction - PR failure triage and dependency restore`, and `Nexus - restore desktop build scripts and rerun smoke`.
- `npm run control-tower:packet-prioritizer -- --today 2026-05-16 --limit 12` scanned 29 open packets and returned 12 ranked packets. The top five were `app - restore ContentView or confirm scaffold stop`, `AuraForge - first Rust command wiring slice`, `Afterimage - evidence-hardening next slice`, `DevToolsTranslator - release blocker packet`, and `Codec - package the verified local baseline`.
- `npm run control-tower:review-recovery -- --today 2026-05-16 --include-metadata-gaps --limit 120 --live` applied 9 review-recovery updates; the follow-up dry-run returned `totalEligibleProjects=0`, `overdueReviews=0`, `missingNextMove=0`, and `missingLastActive=0`.
- `npm run governance:orphan-classify -- --today 2026-05-16 --live --request-approval --approve` upserted 5 approved kickoff requests, and `npm run governance:orphan-classify -- --today 2026-05-16 --live --create-approved-packets` created 5 kickoff packets. The follow-up dry-run reports `viableNeedsKickoffWithoutPacket=0`.
- `npm run control-tower:packet-follow-through -- --today 2026-05-16 --limit 12` now scans 29 open packets, including 6 orphan kickoff packets, 3 blocked packets, and 20 overdue packets. The top follow-through items are AIWorkFlow, DevToolsTranslator, Kickoff: da-scaffold, Phantom Frequencies, and Recall.
- `npm run control-tower:sync -- --today 2026-05-10 --live` refreshed derived rows and the Command Center; the final follow-up dry-run returned clean with `derivedRowsWouldChange=0` and `commandCenterWouldChange=0`.
- `npm run control-tower:review-recovery -- --today 2026-05-10 --include-metadata-gaps --limit 120 --live` applied 87 review-recovery updates; overdue reviews moved from 83 to 0, missing Next Move from 1 to 0, and missing Last Active from 4 to 0.
- `npm run control-tower:review-packet -- --today 2026-05-10 --live` refreshed the weekly review packet; the follow-up dry-run returned clean with `weeklyReviewWouldChange=0`.
- `npm run signals:morning-brief -- --today 2026-05-10 --lookback-days 7 --live` republished the ranked morning brief after the weekly review refresh. Current top risk projects are ApplyKit and AuraForge.
- `npm run control-tower:trend-analysis -- --today 2026-05-10 --live` republished trend analysis after review recovery; current trend movement is 117 tracked projects and stale evidence dropped from 54 to 23.
- `npm run governance:orphan-classify -- --today 2026-05-10 --live --request-approval` now reports 5 viable orphans with existing kickoff packets and 0 viable orphans still needing packet creation.
- Signal-risk triage updated project next moves for ApplyKit, AuraForge, AssistSupport, and notification-hub; ApplyKit now has a dedicated `Signal risk repair - ApplyKit workflow failures` work packet.
- `npm run control-tower:stale-active-rescue -- --today 2026-05-10 --limit 10 --live` applied the 10-project rescue batch; the follow-up dry-run now reports 0 stale active projects.
- `npm run control-tower:review-packet -- --today 2026-05-10` and `npm run control-tower:sync -- --today 2026-05-10` both returned clean after the final review and Command Center refresh.
- `npm run control-tower:operator-brief -- --today 2026-05-10` reports the current operator queue: 0 overdue reviews, 0 stale active projects, 0 new orphan kickoff packets needed, and 5 orphans already routed to kickoff packets.
- `npm run control-tower:packet-follow-through -- --today 2026-05-10 --limit 12 --live --create-signal-tasks` published the packet follow-through report, created 1 signal-risk task for ApplyKit, and the follow-up dry-run now shows the ApplyKit signal-risk packet as `Ready to start` with 1 open task.
- ApplyKit monitoring found the next true repo blocker after the pnpm and Trivy repairs: the GitHub CI/quality/security verify jobs now fail on the build-time performance threshold (`buildMs` exceeded the 15% allowance), while pnpm setup, Trivy, Rust tests, UI tests, coverage, docs checks, and bundle size pass.
- Personal Ops coordination handoff proof passed on 2026-05-10: `personal-ops workflow morning --json` showed green coordination with 5 dry-run Notion rows, `personal-ops coordination diff --against last-green --json` reported 0 changes, and the repo-local `signals:coordination-snapshot` dry-run validated schema, dedupe, evidence, and `planned_writes: 0`.
- Personal Ops now owns the archive and proof commands for the next Coordination Snapshot layer: `personal-ops coordination archive`, `personal-ops coordination verify-notion-dry-run`, and `personal-ops coordination health`. Notion should consume the exported External Signal Events as the durable display and ledger, not generate the snapshot itself.
- The Coordination Snapshot display pilot now uses `signals:coordination-snapshot -- --display --json` to emit a read-only Notion ledger model grouped by Needs Review, Watch, and Archive Candidates before any approved event writes.
- `npm run maintenance:weekly-refresh -- --fast --summary-first --today 2026-05-09` passed earlier on 2026-05-09 with 6 clean lanes, 0 drift, 0 failed steps, and `needsLiveWrite=false`; a later post-Phase-10C dry run found 4 drift lanes, with no failed steps.
- `npm run signals:morning-brief -- --today 2026-05-09 --lookback-days 7 --live` patched the weekly review on 2026-05-09 with a ranked Priority Projects section. Current top risk projects were ApplyKit and AuraForge.
- `npm run governance:orphan-classify -- --today 2026-05-09 --live --request-approval --approve --create-approved-packets` created or refreshed 5 approved orphan kickoff requests and 5 work packets on 2026-05-09.
- `npm run control-tower:trend-analysis -- --today 2026-05-09 --live` patched the weekly review on 2026-05-09 with portfolio movement, queue changes, and deduped sustained-stale evidence.
- `npm run execution:sync -- --today 2026-05-09 --project-limit 50 --project-concurrency 2 --live` refreshed 43 execution briefs, and the follow-up dry run returned clean.
- `npm run intelligence:sync -- --today 2026-05-09 --project-limit 60 --project-concurrency 2 --live` refreshed 48 recommendation briefs, and the follow-up dry run returned clean.
- `npm run control-tower:review-packet -- --today 2026-05-09 --live` refreshed the weekly review packet successfully; the immediate dry-run still reported weekly-review content drift, so the Phase 10 morning brief and trend sections were reapplied live afterward.
- `npm run control-tower:sync -- --today 2026-05-09 --live` refreshed the Command Center after the Phase 10C live writes. A follow-up dry run had 0 derived-row changes and only Command Center content drift remaining.
- `npm run control-tower:repo-mapping-audit -- --limit 50 --include-all-gaps --live-normalize-local-paths` and the follow-on decision pass completed on 2026-05-09; the current queue is 0 decision rows, 0 local mapping gaps, 0 GitHub mapping gaps, and 0 attention rows.
- `npm run control-tower:stale-active-rescue -- --limit 10` returned clean on 2026-05-09 after the decision closeout pass refreshed active review evidence.
- `npm run control-tower:sync -- --today 2026-05-09 --live` refreshed the Command Center after the closeout pass; a follow-up dry run had 0 derived-row changes and only Command Center content drift remaining.
- `npm audit --json` passed on 2026-05-09 with 0 vulnerabilities after the dependency PR merge sequence.
- `npm run typecheck`, `npm test`, and `npm run build` passed on 2026-05-09 after dependency cleanup and before the May 9 maintenance config PR was merged.
- The May 9 productization pass added a read-only stale-active rescue report, clearer Command Center attention/stale-active summaries, weekly recovery-plan hints, and action dry-run operator summaries.
- `npm run maintenance:weekly-refresh -- --fast --today 2026-05-04` passed on 2026-05-04 with 6 clean lanes, 0 drift, 0 failed steps, and timing output. The proof run took 144 seconds; `external-signals` was the longest lane at 63 seconds, followed by `intelligence-sync` at 50 seconds.
- `npm test` passed on 2026-05-04 with 48 files and 329 tests.
- `npm run typecheck` passed on 2026-05-04.
- `git diff --check` passed on 2026-05-04.
- The May 4 closeout commits shipped the brief database migrations, weekly review convergence fix, bounded project-write concurrency, and compact weekly timing summary.
- `npm run typecheck` passed on 2026-04-23.
- `npm test` passed on 2026-04-23 with 44 files and 299 tests.
- `npm run build` passed on 2026-04-23.
- `npm run dry-run:example` passed on 2026-04-23 using the documented `--dry-run` flag.
- `npm run bridge-db:status` returned a healthy read-only bridge-db snapshot on 2026-04-23 with `unprocessed_shipped_count: 0`.
- `npm run bridge-db:sync` completed in dry-run mode on 2026-04-23 with 0 SHIPPED rows, 50 personal-ops rows, and 0 failures.
- A post-merge fresh clone from GitHub passed `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:built-cli`, `npm run smoke:packed-install`, and `npm run smoke:git-install` on 2026-04-23.
- Hosted Dependabot checks ran successfully on the final merged dependency heads after PR cleanup; Dependabot's `uuid` advisory workflow still fails because of the accepted `exceljs -> uuid` exception.
- The 2026-04-23 dependency cleanup merged GitHub Actions, production dependency, TypeScript/Node types, and Vitest updates. It also added quiet dotenv loading for the `dotenv` 17 default banner so CLI JSON output remains machine-readable.
- Stale fully merged remote feature branches were pruned on 2026-04-23; `origin/main` is now the only remaining remote branch.
- `npm run signals:seed-mappings -- --limit 2` completed in dry-run mode on 2026-04-23.
- `npm run signals:seed-mappings -- --live --limit 2` created active primary-profile source rows for `Notification Hub - Event Log` and `GithubRepoAuditor - Audit Reports` on 2026-04-23.
- `signals:sync -- --provider notification_hub` and `signals:sync -- --provider repo_auditor` both complete dry-run on 2026-04-23 with `syncedSourceCount: 1`.
  - `notification_hub` now exercises, strips status prefixes before matching, ignores known bridge/Codex operational tags (`bridge-sync`, `memories`, `d`), and reports sample names for remaining unmatched project values.
  - `repo_auditor` now exercises, reports audit input dated 2026-04-24, and reports sample names for remaining unmatched repos.
  - `bridge-db`, `notification-hub`, and `DecisionStressTest` now have Local Portfolio Project rows and live GitHub source mappings, so local-provider dry-runs no longer report unmatched project/repo names.
  - broad live signal sync was approved and attempted on 2026-04-24; signal events and sync runs reconciled, and `signals:sync` now has scoped `providers`, `project-pages`, and `portfolio-sections` write modes for safe recovery.
  - the 2026-04-25 scoped recovery wrote 23 notification-hub events plus one provider sync-run, then reduced project brief drift from 117 to 38 before the new convergence guard stopped on `Phantom Frequencies` and `Recall`.
- `npm audit --json` still reports 2 moderate findings through `exceljs -> uuid`; this is documented as an accepted temporary exception because the maintained `exceljs` line still depends on vulnerable `uuid`.
- `notification-hub` and `repo-auditor` have sandbox live proof from 2026-04-17 and primary-profile dry-run exercise from 2026-04-23.
  - sandbox source rows exist for both providers
  - `notification-hub` wrote one bounded proof event and one sync-run row
  - `repo-auditor` wrote one bounded proof audit event and one sync-run row
  - `signals:morning-brief -- --profile sandbox` now sees the notification-hub proof event
- `notion-os --profile sandbox doctor --json` now passes sandbox path isolation, token isolation, and target isolation checks.
- `npm run sandbox:smoke` now passes end to end.
- The sandbox GitHub lane is now sufficiently proven in live mode on 2026-04-17 against `portfolio-actuation-sandbox` issue `#3`.
  - `github.create_issue` created issue `#3`
  - `github.add_issue_comment` created comment `4266814277`
  - `github.update_issue` updated issue `#3`
- `src/notion/local-portfolio-actuation.ts` now normalizes quoted GitHub App PEM values before signing, which fixed the live GitHub App key decoding failure uncovered during the sandbox proof.
- `src/notion/operational-rollout.ts` now includes a generic `ensureGitHubActionRequest(...)` helper so non-create GitHub action requests can be created from repo code instead of one-off scripts.
- The sandbox profile-owned Vercel manual seeds and rollout targets were trimmed because the sandbox workspace currently does not contain matching local project rows for those primary-profile IDs.
- The restart docs were refreshed again after the final confidence pass so they describe the merged repo state and current next-step posture accurately.

## Baseline Metrics
- Total projects: 65
- Overdue reviews: 0
- Missing next moves: 0
- Missing last active: 0
- Stale active projects: 0
- Orphaned projects: 50
- Recent build sessions: 5

## Latest Metrics
- Total projects: 138
- Overdue reviews: 0
- Missing next moves: 0
- Missing last active: 0
- Stale active projects: 0
- Orphaned projects: 21
- Recent build sessions: 20

## Phase Transition Memory
- Transition: Phase 9 closed into Phase 10
- Carry-forward brief: Future phases should only expand integrations that clearly improve decision quality or reduce friction without weakening human oversight.

## Phase Memory
### Phase 1 Gave Us
Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.

### Phase 2 Added
Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.

### Phase 3 Added
Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.

### Phase 4 Added
Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.

### Phase 5 Added
Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.

### Phase 6 Added
Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries.

### Phase 7 Added
Phase 7 gave us controlled actuation: approved GitHub issue/comment execution, dry-run-backed execution logs, deterministic idempotency, and compensation-aware external write handling.

### Phase 8 Added
Phase 8 gave us a mature GitHub action lane: issue lifecycle actions, PR comments, hardened GitHub App posture, richer operator packets, and audit-grade GitHub execution feedback loops.

### Phase 9 Added
Phase 9 expanded the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane was stable, low-noise, and easy to audit.

## Risks
- Avoid adding a second overlapping status system beyond the manual fields and the three derived PM signals.
- Keep command-center pages light and linked-view oriented instead of embedding many full databases.
- Keep the repo as the canonical memory so phase transitions do not depend on chat history.
- Treat stale-active rescue as an operator triage lane, not as automatic project-status mutation.

## Phase Roadmap
### Phase 1: Project Control Tower
- Status: Completed
- Objective: Turn Local Portfolio Projects into the low-friction operating control tower for project review, prioritization, and portfolio visibility.
- Deliverables:
  - Governance config for ownership, cadence, freshness, and queue rules
  - Derived PM signals plus completeness snapshot logic
  - Evergreen command-center page and weekly review packet
  - Repo roadmap ledger and phase-closeout flow
- Exit criteria:
  - Derived fields are populated for every project row
  - The command-center page updates idempotently
  - One real weekly review uses the new control-tower data
  - Phase-closeout writes the same phase-2 brief into repo memory and Build Log

### Phase 2: Project Execution System
- Status: Completed
- Objective: Turn project priority into structured execution history with Project Decisions, Work Packets, and Execution Tasks while keeping the project page as the daily PM home.
- Deliverables:
  - Project Decisions, Work Packets, and Execution Tasks data sources
  - Execution-sync and weekly-plan commands that enforce WIP and refresh briefs
  - Project-page execution briefs and richer weekly reviews
  - Phase-memory artifact that carries phase 1, phase 2, and phase 3 forward together
- Exit criteria:
  - Execution Tasks works as the daily task layer and links cleanly to packets and projects
  - WIP is limited to one Now packet and one Standby packet
  - Weekly reviews point at packets, tasks, and material decisions
  - Phase 2 closeout writes the same phase-3 brief into repo memory and Build Log

### Phase 3: Cross-Database Intelligence
- Status: Completed
- Objective: Turn the combined project, execution, research, skill, and tool records into deterministic recommendations and reviewed link intelligence.
- Deliverables:
  - Recommendation Runs and Link Suggestions data sources
  - Deterministic scoring model with project recommendation briefs
  - Weekly recommendation runs, daily focus runs, and command-center intelligence sections
  - Phase memory that preserves phases 1 through 5 in repo artifacts and closeout logs
- Exit criteria:
  - The system can rank resume, finish, investigate, and defer candidates deterministically
  - Weekly runs are stored durably and weekly recommendations can be reviewed before publication
  - Link suggestions move through a review queue with acceptance and rejection memory
  - Phase 3 closeout writes the same phase-4 and phase-5 brief into repo memory and Build Log

### Phase 4: Premium-Native Augmentation
- Status: Completed
- Objective: Use premium-native Notion features as thin overlays for dashboards, reminder nudges, and bounded pilots after the core repo-owned operating model is already stable.
- Deliverables:
  - Portfolio Dashboard and Execution Dashboard as native visibility layers
  - Notification-only native reminder automation desired-state and audit tracking
  - Bounded synced-database and custom-agent pilot definitions with defer reasons or live status
  - Phase memory that preserves Phases 1 through 6 and records what native overlays actually shipped
- Exit criteria:
  - Native dashboards exist and stay within the performance guardrails
  - Reminder automations are either live or explicitly deferred with written reasons
  - Premium-native pilots are either active in bounded form or explicitly deferred with written reasons
  - Phase 4 closeout writes the same phase-5 and phase-6 brief into repo memory and Build Log

### Phase 5: External Signal Integration
- Status: Completed
- Objective: Extend the recommendation engine with non-Notion execution signals so portfolio calls can reflect real repo, deploy, calendar, and workflow evidence.
- Deliverables:
  - External Signal Sources, External Signal Events, and External Signal Sync Runs data sources
  - Polling-first GitHub and deployment adapters with bounded, idempotent sync behavior
  - Project external-signal briefs plus command-center and weekly-review telemetry sections
  - Updated phase memory that preserves phases 1 through 7 and sets up governance next
- Exit criteria:
  - Priority projects have visible external-signal coverage or explicit Needs Mapping rows
  - Sync reruns dedupe cleanly and remain additive to repo-owned scoring and memory
  - At least one external signal materially improves recommendation quality
  - Phase 5 closeout writes the same phase-6 and phase-7 brief into repo memory and Build Log

### Phase 6: Cross-System Governance
- Status: Completed
- Objective: Add the approval gates, action policies, and audit trails needed for recommendations and external signals to influence work outside Notion without losing human control.
- Deliverables:
  - Action policy, approval-request, endpoint, delivery, and receipt ledgers
  - Shadow-mode webhook verification with provider-safe receipt and delivery handling
  - Project and command-center governance briefs plus audit-ready trust controls
- Exit criteria:
  - Cross-system actions require explicit approval at the right boundary
  - Webhook deliveries are verified, deduped, and auditable without mutating external systems
  - Governance artifacts explain how recommendations become safe actions outside Notion
  - Phase 6 closeout writes the same phase-7 brief into repo memory and Build Log

### Phase 7: Controlled Actuation
- Status: Completed
- Objective: Allow tightly governed cross-system actions only after telemetry and approval boundaries are trustworthy.
- Deliverables:
  - Narrow action runners for approved external mutations
  - Approval-aware execution logs that link recommendations to resulting actions
  - Rollback and safe-failure posture for any external write path
- Exit criteria:
  - Every external mutation requires an approved path and leaves an audit trail
  - Rollback posture exists for each supported action type

### Phase 8: GitHub Deepening and Hardening
- Status: Completed
- Objective: Deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.
- Deliverables:
  - Expanded GitHub issue lifecycle and PR comment actions built on the Phase 7 execution ledger
  - Hardened GitHub App permissions, serial write safety, richer error classification, and trusted GitHub feedback loops
  - GitHub-specific operator packets, command-center views, and measured actuation metrics
- Exit criteria:
  - GitHub issue updates, labels, assignees, issue comments, and PR comments use the same approval, idempotency, and audit pattern as Phase 7
  - The deep GitHub lane stays low-noise, easy to audit, and safer than manual ad hoc mutation

### Phase 9: Provider Expansion
- Status: Completed
- Objective: Expand the proven GitHub governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is measurably trusted.
- Deliverables:
  - New provider actuation lanes that reuse the existing approval, idempotency, and execution-ledger contract
  - Provider-specific telemetry, webhook verification, and compensation patterns layered on top of the Phase 5 to 8 foundation
  - Operator-facing cross-provider views and metrics that stay understandable and low-noise
- Exit criteria:
  - New providers reuse the same approval, audit, and execution posture rather than inventing parallel systems
  - Cross-provider expansion remains easy to understand and clearly worth the added complexity

### Phase 10: Signal Wiring and Intelligence Layer
- Status: Completed
- Objective: Wire local signal adapters (notification-hub, repo-auditor, bridge-db) into the external-signal pipeline, add a morning-brief digest, orphan classification, and historical trending to close the feedback loop between portfolio health and daily operations.
- Deliverables:
  - Notification Hub JSONL → ExternalSignalEvents adapter with severity classification
  - GithubRepoAuditor audit reports → ExternalSignalEvents adapter with grade-based severity
  - bridge-db SHIPPED rows → Notion Build Log adapter with project name resolution
  - Morning brief command: daily signal digest patched onto the weekly review page
  - Orphan classification command: deterministic rule-based bucketing of projects with no linked records
  - Historical trending via JSONL snapshots: queue-change and stale-evidence detection
  - Phase 10A audit fixes: receipt-backed bridge-db shipped-row confirmation, normalizeProviderKey coverage, JSONL windowing, empty full_name guard
- Exit criteria:
  - All three local adapters emit events that appear in the External Signal Events database
  - Morning brief dry-run produces a valid severity-grouped markdown section
  - Orphan classification dry-run buckets all orphan projects without Notion writes
  - Trend analysis reports queue changes after two consecutive control-tower syncs
  - Sandbox proving lane stays isolated enough to trust `doctor` and `sandbox:smoke` before risky live rehearsal
  - Typecheck clean, 299+ tests pass
- Restart note:
  - structural cleanup and script-surface hardening are complete enough that Phase 10 work can proceed without another broad repo-audit pass first
  - as of 2026-04-23, dry-run confidence is strongest for `trend-analysis`, `orphan-classify`, `bridge-db status`, `bridge-db sync`, `dry-run:example`, and `morning-brief`; the sandbox proving lane is healthy again
  - as of 2026-04-23, `notification-hub` and `repo-auditor` are implemented, sandbox-proven, and primary-profile dry-run exercised:
    - both are modeled as global local-provider source rows rather than fake per-project rows
    - `notification-hub` is project-only in v1 and records skipped null/unmatched/ignored operational counts
    - `repo-auditor` resolves through active GitHub source identifiers first, then project-title fallback
    - sandbox live proof wrote real `External Signal Events` and `External Signal Sync Runs` rows for both providers
    - primary-profile source rows now exist for `Notification Hub - Event Log` and `GithubRepoAuditor - Audit Reports`
    - the May 4 database-backed brief migrations resolved the old project-page markdown recovery path; broad weekly fast refresh is now clean
  - as of 2026-04-17, the orphan-classification live packet lane writes structured `work_packets` entries with execution metadata and project relations
  - as of 2026-04-17, orphan follow-through also has an approval-backed path: `--request-approval` creates or refreshes governance requests and `--create-approved-packets` materializes only approved kickoff packets
  - as of 2026-04-17, the sandbox GitHub lane has enough live evidence to stop proving it further unless a new action family is needed; the next work should be productization, not more sandbox mutation depth
  - Phase 10 closed 2026-05-12: all exit criteria met, 329 tests passing, stale-active rescue clean, operator brief reports 0 overdue reviews and 0 stale active projects

### Phase 11: Daily Intelligence and Packet Prioritization
- Status: Complete
- Objective: Make the portfolio OS opinionated about what to work on today — add packet prioritization by composite score, a daily focus synthesis command, packet staleness detection, and signal-quality cleanup that promotes the morning brief from a diagnostic tool to a trusted daily driver.
- Deliverables:
  - Packet prioritizer (`control-tower:packet-prioritizer`): ranks open packets by composite score (signal severity × recommendation score × evidence staleness × time-since-last-task-created), with brief per-packet rationale
  - Today's focus command (`control-tower:today`): synthesizes morning brief + packet priorities + personal-ops worklist into a single ranked daily action output, patched onto the weekly review page
  - Packet staleness detection: surfaces in operator brief when a packet has had no task activity in N days (configurable); escalates to "at risk" if both overdue and task-stale
  - Signal-quality cleanup: repo-mapping audit reports 0 operator-surface GitHub mapping gaps; monitor-only shipped placeholders are explicitly paused instead of unresolved
  - Block-level managed section writes: `control-tower:managed-section-audit` proves managed markers are readable as top-level blocks; replacement writes are intentionally deferred until the block writer can be transactional or rollback-safe
- Exit criteria:
  - `control-tower:packet-prioritizer` dry-run produces a ranked list with rationale for ≥5 actionable packets
  - `control-tower:today` dry-run produces a valid daily focus section on the weekly review page
  - Packet staleness surfaces in `control-tower:operator-brief`
  - Signal audit shows 0 unaddressed `Needs Mapping` rows (intentionally unmapped ones are documented): satisfied on 2026-05-18
  - Block-level managed writes either in production OR a clearly documented decision to defer pending Notion API fix: satisfied for the current slice by the May 18 block audit decision
  - Typecheck clean, 350+ tests pass
- Carry-forward: Do not invent new status fields — packet prioritizer must use existing signals only. Daily synthesis is only worth building if it demonstrably reduces the time to decide what to work on.

## Active Phase Detail
Phase 12 - Managed Write Reliability and Daily Driver Hardening

Make the daily driver more durable now that Phase 11 can rank, publish, and audit the work queue.

Immediate next implementation step: return to the blocked packet queue for DevToolsTranslator, JobCommandCenter, or Nocturne, then rerun `control-tower:packet-follow-through` plus `control-tower:operator-brief`.

Immediate operating step: work one real proof item from the blocked packet queue, starting with DevToolsTranslator's release secrets, JobCommandCenter's LinkedIn session/dry-run proof, or Nocturne's physical geospatial verification.
