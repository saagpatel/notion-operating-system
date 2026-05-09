# Decision Queue and Repo Mapping Cleanup - 2026-05-09

This packet records the current Local Portfolio Projects decision queue after
the stale-active rescue and repo-mapping cleanup pass.

## Verification Baseline

- `npm run control-tower:stale-active-rescue -- --limit 1` returned clean: 0 stale active projects.
- `npm run control-tower:repo-mapping-audit -- --limit 50` found 117 project rows, 9 decision queue rows, 9 local mapping gaps, 4 GitHub source mapping gaps, and 16 attention rows before cleanup.
- `npm run control-tower:repo-mapping-audit -- --limit 50 --live-normalize-local-paths` applied 8 deterministic Local Path fixes.
- Final live audit state: 9 decision queue rows, 5 local mapping gaps, 4 GitHub source mapping gaps, and 13 attention rows.

## Live Local Path Fixes Applied

| Project | Previous Local Path | Current Local Path |
|---|---|---|
| DesktopPEt-ready | `FunGamePrjs/DesktopPEt-ready` | `Fun:GamePrjs/DesktopPEt` |
| GitHub Repo Auditor | `GithubRepoAuditor.` | `GithubRepoAuditor` |
| JSM Ticket Analytics Export | `~/Projects/jsm-analytics-export` | `JSMTicketAnalyticsExport` |
| MCP Audit | `MCPAudit.` | `MCPAudit` |
| MCP Forge | `mcpforge.` | `mcpforge` |
| Notion Operating System | `Notion Operating System.` | `/Users/d/Notion` |
| Personal Ops | `Personal Ops.` | `/Users/d/.local/share/personal-ops` |
| Reddit Sentiment Analyzer | `RedditSentimentAnalyzer.` | `RedditSentimentAnalyzer` |

## Decision Queue

These rows are still `Needs Decision` or derived into the decision queue. Their
local repo and GitHub source mappings are now active unless noted elsewhere.

| Project | Current state | Portfolio call | Next decision |
|---|---|---|---|
| ComplianceKit | Needs Decision | Build Now | Continue, park, or clean up `feat/phase0-scaffold`. |
| DesktopPEt-ready | Needs Decision | Finish | Decide whether this should remain a separate row or merge back into DesktopPEt. |
| KBFreshnessDetector | Needs Decision | Finish | Decide whether to continue, park, or refresh the repo evidence. |
| LoreKeeper | Needs Decision | Finish | Decide whether to continue, park, or refresh the repo evidence. |
| OrbitForge (staging) | Needs Decision | Build Now | Run the local app or park the staging row. |
| PersonalKBDrafter | Needs Decision | Finish | Decide whether to continue, park, or refresh the repo evidence. |
| ScreenshotAnnotate | Needs Decision | Merge | Decide whether it stays separate or merges with the nearby screenshot/data-selection lineage. |
| SpecCompanion | Needs Decision | Build Now | Decide whether to wire tests/UI gates now or park. |
| TicketHandoff | Needs Decision | Finish | Decide whether to continue, park, or refresh the repo evidence. |

## Remaining Mapping Cleanup

| Project | Current issue | Recommended next move |
|---|---|---|
| DesktopTerrarium | `Local Path` points at `Fun:GamePrjs/DesktopTerrarium`, but no local repo exists there. | Confirm whether this is archived, renamed, or should map to another repo before keeping it active. |
| Sandbox Local Portfolio Project | `Local Path` remains `Sandbox Local Portfolio Project.`; closest local repo candidate is `/Users/d/Projects/EvolutionSandbox`. | Confirm whether this row should map to `EvolutionSandbox` or be retired as a sandbox proof row. |
| da-scaffold | Local repo exists, but GitHub source row is still `Needs Mapping` with no identifier/source URL. | Add a real remote/source only after the repo gets an origin, or pause the placeholder. |
| TabTriage | Local repo exists, but GitHub source row is still `Needs Mapping`; local repo currently has no upstream. | Decide whether to publish the repo and fill the source mapping, or keep it local/parked. |

## Current Command

Use this for the next refresh:

```bash
npm run control-tower:repo-mapping-audit -- --limit 50
```

Use this only after the dry run shows deterministic path fixes:

```bash
npm run control-tower:repo-mapping-audit -- --limit 50 --live-normalize-local-paths
```