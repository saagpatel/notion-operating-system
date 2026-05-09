# Decision Queue and Repo Mapping Cleanup - 2026-05-09

This packet records the current Local Portfolio Projects decision queue after
the stale-active rescue and repo-mapping cleanup pass.

## Verification Baseline

- `npm run control-tower:stale-active-rescue -- --limit 1` returned clean: 0 stale active projects.
- `npm run control-tower:repo-mapping-audit -- --limit 50` found 117 project rows, 9 decision queue rows, 9 local mapping gaps, 4 GitHub source mapping gaps, and 16 attention rows before cleanup.
- `npm run control-tower:repo-mapping-audit -- --limit 50 --live-normalize-local-paths` applied 8 deterministic Local Path fixes.
- `npm run control-tower:repo-mapping-audit -- --limit 50 --include-all-gaps --live-normalize-local-paths` applied 3 additional deterministic Local Path fixes.
- A live decision pass resolved the remaining decision rows, repaired the nested/absolute local paths for DesktopTerrarium and the sandbox row, paused local-only GitHub placeholders, and created the missing EvolutionSandbox GitHub source.
- Final live audit state: 0 decision queue rows, 0 local mapping gaps, 0 GitHub source mapping gaps, and 0 attention rows.

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
| EarthPulse | `FunGamePrjs/EarthPulse` | `Fun:GamePrjs/EarthPulse` |
| EarthPulse-readiness | `FunGamePrjs/EarthPulse-readiness` | `Fun:GamePrjs/EarthPulse` |
| PomGambler-prod | `Fun:GamePrjs/PomGambler-prod` | `Fun:GamePrjs/PomGambler` |
| DesktopTerrarium | `Fun:GamePrjs/DesktopTerrarium` | `Fun:GamePrjs/DesktopTerrarium/desktop_terrarium` |
| Sandbox Local Portfolio Project | `Sandbox Local Portfolio Project.` | `/Users/d/portfolio-actuation-sandbox` |

## Decision Queue

The decision queue is now empty. The former decision rows were moved into their
current operating posture:

| Project | Current state | Operating queue | Portfolio call | Current disposition |
|---|---|---|---|---|
| ComplianceKit | Active Build | Needs Review | Build Now | Close the scaffold branch before treating readiness as clear. |
| DesktopPEt-ready | Parked | Watch | Merge | Treat as a readiness artifact under DesktopPEt unless a distinct release scope reappears. |
| KBFreshnessDetector | Active Build | Needs Review | Finish | Close the bootstrap verification branch. |
| LoreKeeper | Active Build | Needs Review | Finish | Close the batch verification branch. |
| OrbitForge (staging) | Active Build | Needs Review | Build Now | Verify the local app, then decide whether staging stays separate. |
| PersonalKBDrafter | Active Build | Needs Review | Finish | Close the bootstrap branch and duplicate source posture. |
| ScreenshotAnnotate | Parked | Watch | Merge | Merge into the screenshot/data-selection lineage after confirming the canonical active surface. |
| SpecCompanion | Active Build | Resume Now | Build Now | Keep as the clearest build-now item; wire tests, UI gates, and error-boundary UI. |
| TicketHandoff | Active Build | Needs Review | Finish | Close the bootstrap branch. |

## Remaining Mapping Cleanup

No repo/source mapping cleanup remains after the live decision pass.

| Project | Resolution |
|---|---|
| DesktopTerrarium | Repointed to the nested `desktop_terrarium` git repo. |
| Sandbox Local Portfolio Project | Repointed to `/Users/d/portfolio-actuation-sandbox` and parked as a watch-only proof row. |
| da-scaffold | Paused the empty GitHub placeholder; keep local-only until an origin exists. |
| RAG Knowledge Base | Paused the empty GitHub placeholder; keep local-only until an origin exists. |
| TabTriage | Paused the empty GitHub placeholder; publish or park after local dirty files are reviewed. |
| evolutionsandbox | Added the missing active GitHub source for `saagpatel/EvolutionSandbox`. |

## Current Command

Use this for the next refresh:

```bash
npm run control-tower:repo-mapping-audit -- --limit 50
```

Use this only after the dry run shows deterministic path fixes:

```bash
npm run control-tower:repo-mapping-audit -- --limit 50 --live-normalize-local-paths
```
