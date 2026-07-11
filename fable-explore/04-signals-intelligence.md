# External Signals + Intelligence Layer — Subagent Map

*Produced by map-signals (Explore agent), 2026-07-10. File:line refs cited by the agent; spot-verify before acting on any single claim.*

## ARCHITECTURE — data flow

**Stage 1: Provider pull → NormalizedSignalEvent.** `runExternalSignalSyncCommand` (`external-signal-sync.ts:216`) loads provider config (`:248`), then dispatches to per-provider fetchers behind one shared in-run dedup set `eventKeySet: new Set()` (`:504`). Each fetcher returns a `ProviderSyncResult` (`:160`) carrying `NormalizedSignalEvent[]` (`:134`) — common shape: `{ title, localProjectId, sourceId, provider, signalType, occurredAt, status, environment, severity, sourceIdValue, sourceUrl, eventKey, summary, rawExcerpt }`.

Four wired providers (CLI enum `github | vercel | notification_hub | repo_auditor | all`, `:176`):
- **Vercel** (`:3040`): HTTP GET `/v6/deployments` with bearer token → `Deployment` signals.
- **Notification Hub** (`:2381`): reads a local JSONL log, streams via `readNotificationHubJsonl` (`:2608`) → `Notification` signals. Resolves raw `project` string to a local project id via `buildProjectResolver`; drops missing/unmatched/ignored-operational.
- **Repo Auditor** (`:2689`): reads newest `audit-report-*.json` in the auditor's output dir (`:2705`) → `Audit` signals.
- **GitHub**: `syncGithubSource` (`:2879`).

`google_calendar` appears in the provider-name typing but has NO dedicated fetcher here.

**Stage 2: Cross-run dedup.** `filterProviderResultsAgainstExistingEventKeys` (`:1584`) collects candidate `eventKey`s, calls `fetchExistingExternalSignalEventKeys` (`local-portfolio-external-signals-live.ts:506`) to find keys already in Notion, filters, recomputes each result's `status/itemsWritten/itemsDeduped/cursor` (`:1613`).

**Stage 3: Write to Notion.** Survivors become event rows (`Severity` select + `Event Key` rich-text `:3251` + provider/status/environment). Per write-scope it also refreshes per-project brief markdown + portfolio-section rollups (`ExternalSignalSyncWriteScope = full | providers | project-pages | portfolio-sections`, `:189`).

**Stage 4: Intelligence.** `runIntelligenceSyncCommand` (`intelligence-sync.ts:110`) loads project contexts, calls `buildRecommendation` per context (`:268`), writes each to a **Recommendation Briefs** DB (`recommendation-brief-db-v1`, `:83`) with `Recommendation Lane/Score/Confidence` (`:731`) + hashed markdown body (`hashMarkdown` `:740`) so unchanged briefs skip. Also renders an "Intelligence Command Center" managed section (`:81`).

**Stage 5: Morning brief.** `runMorningBriefCommand` (`morning-brief.ts:566`) pulls projects + weekly reviews + events + packets + tasks, filters to a lookback window, groups by severity, optionally synthesizes, splices into the weekly-review page between `MORNING_BRIEF_START/END` markers (`:729-740`; replace-in-place helper `:812`).

**Stage 6: Trend/snapshot.** `snapshot-history.ts` appends per-project `ProjectSnapshot` lines to `~/.local/share/notion-os/snapshots.jsonl` (`appendSnapshotBatch` `:43`); `runTrendAnalysisCommand` (`:356`) renders a trend report (`TREND_REPORT_START/END` `:15`) over movement between the last 2 snapshot dates + "3+ consecutive stale" detection.

## MECHANISMS

**Event key** (`local-portfolio-external-signals.ts:1001`): `buildEventKey(parts)` = parts lowercased/trimmed, empties dropped, joined `::`. No hashing. Per provider: notification_hub `["notification_hub", event_id]`; repo_auditor `["repo_auditor", fullName, reportDate]`; vercel `["vercel","deployment",identifier,uid,status]` — **status is part of the key**.

**Severity** (→ `Info | Watch | Risk`): notification (`classifyNotificationSeverity` `:2651`) urgent→Risk, normal→Watch, else Info. Repo grade (`classifyRepoAuditGrade` `:2862`) A/B→Info, C→Watch, else(D/F)→Risk. Vercel (`:3097`) failure status→Risk, contains "build"→Watch, else Info.

**Dedup/watermark — two layers, both event-key-based; NO persisted watermark/cursor.** Layer 1 (intra-run): shared `eventKeySet`. Layer 2 (cross-run): `fetchExistingExternalSignalEventKeys` runs an OR-filter Notion query batched at 50 keys with bounded concurrency (`event_key_filter` mode `:519-540`); on ANY thrown error it **falls back to a full DB scan** (`full_scan_fallback` `:542-552`). The `cursor` field is computed (`newestOccurredAt`) but nothing reads it back to bound the next fetch.

**LLM synthesis** (`morning-brief.ts`, `--synthesize`): `synthesizeRiskProject` (`:128`) POSTs to the Anthropic API (Haiku, `max_tokens:150`, fixed 2-sentence prompt). `runSynthesisForRiskEvents` (`:499`) takes top-5 unique Risk-event projects, fires sequentially. Silent-degrade: no `ANTHROPIC_API_KEY`→console.error+skip (`:601`); API failure→event renders without the synthesis blockquote (`:318`).

**Recommendation engine** (`buildRecommendation`, `local-portfolio-intelligence.ts:338`): weighted linear scoring across lanes (Resume/…/Monitor) over `context.factors` (executionReadiness, supportFit, evidenceStrength, executionHealth, attentionCost + penalties) blended with `freshnessScore` and external adjustments (`external.deferBoost`). Top lane wins, then `chooseRecommendationLane` applies state/queue/call overrides (finishTrack, closeToDone); `determineConfidence` sets confidence. Monitor lane = fixed score 40.

**Orphan classification** (`orphan-classification.ts:98`): 3 rules — already-parked; archive-candidate (category in `ARCHIVE_CATEGORIES` and inactive > 180 days `:81`); else viable-needs-kickoff. `getGovernedOrphanAction` (`:162`) maps disposition→governed action, blocks duplicate kickoff packets. Packets + approval requests are drafted (`:300`,`:351`) but approval-gated — nothing auto-creates.

**Packet follow-through** (`packet-follow-through.ts:242`): scores open packets, classifies into lanes (`orphan-kickoff | signal-risk-repair | active-packet | blocked-packet | overdue-packet | unworked-packet`) + state, counts task/session progress. Filters `score>=20` unless `includeAllOpen`, sorts, slices to `limit` (default 12).

## ROUGH EDGES

1. **Vercel status-in-key multiplies rows** (`external-signal-sync.ts:3062`). One deployment transitioning BUILDING→READY→ERROR yields a different key per state → separate Notion rows across syncs. Other providers don't do this. Dedup-contract inconsistency + events-DB inflation.
2. **Notification-hub tail window silently drops unsynced events** (`:2608-2634`). Only the last `maxEventsPerSource` lines are kept; with no persisted cursor, a burst larger than the window permanently loses the oldest-unsynced events — never written, no error. Malformed lines also swallowed silently.
3. **No durable watermark anywhere** (`:1620` computes `cursor`, nothing reads it). Dedup correctness rests entirely on tail windows + live Notion event-key lookups.
4. **Dedup fallback = full-DB scan on any transient error** (`local-portfolio-external-signals-live.ts:542`). One thrown error flips to `full_scan_fallback`, pulling every page of the events DB — latent performance cliff.
5. **Snapshot append has no same-day idempotency** (`snapshot-history.ts:43`). Running the snapshot job twice in a day double-writes rows for the same `(projectId, snapshotDate)`; trend analysis counts and consecutive-staleness detection can be corrupted. Clearest double-write hazard in the layer.
6. **Synthesis count fragile** (`morning-brief.ts:~658`): `synthesisCount = Math.round(synthesisMap.size / 2)` assumes id+name entries per project. Telemetry-only, cosmetic.

## Key files
`src/notion/external-signal-sync.ts`, `local-portfolio-external-signals.ts`, `local-portfolio-external-signals-live.ts`, `intelligence-sync.ts`, `local-portfolio-intelligence.ts`, `morning-brief.ts`, `orphan-classification.ts`, `packet-follow-through.ts`, `snapshot-history.ts`, `src/portfolio-audit/project-intelligence.ts`.
