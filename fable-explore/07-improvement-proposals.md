# Improvement Proposals — Notion OS

*Drafted by Fable, 2026-07-10. Proposals only — nothing here is implemented. Each cites the evidence from files 01-05 (spot-verified claims marked ✓). Ordered by tier: correctness first, coherence second, polish third.*

**Reading key:** each proposal = Problem → Change → Sketch → Verify → Size/Risk.

---

## Tier 1 — Correctness (the system can currently lie to you)

### P1. Idempotency keys for the build-log outbox (the headliner)

**Problem.** `bridge-db-sync` is at-least-once with no idempotent consumer. If `createPageWithMarkdown` succeeds but `confirmShippedRowSynced` fails (`bridge-db-sync.ts:268-281`), the row stays unprocessed and the next run creates a **duplicate Build Log page**. Same window in the ops-events path with `markRowProcessed` (`:344-355`). The governance lane already solved this exact problem with `computeActuationExecutionKey` dedup (`action-runner.ts:96-107`) — the discipline just never migrated. (Morling: "idempotency gives you deterministic convergence under retries, not exactly-once.")

**Change.** Give every Build Log write a deterministic sync key and check before create:
1. Key = `bridge:{source}:{rowId}` (bridge row ids are stable and unique per db; no hashing needed).
2. Add a `Sync Key` rich-text property to the Build Log schema (extend the existing `assertDataSourceSchemaProperties` required list, `:140-146`).
3. Before creating, query Build Log for `Sync Key == key` (single filtered query; same pattern as `fetchExistingExternalSignalEventKeys`). Hit → skip create, re-run `confirmShippedRowSynced` with the existing page id (this heals the exact crash window), count as `rowsRecovered`.
4. Write the key in the create payload.

**Verify.** New test: simulate confirm-failure after create (mock MCP session throwing on `confirmShippedSync`), re-run, assert exactly one page exists and the row is confirmed. Plus schema-drift test for the new required property.

**Size/Risk.** ~80 lines + tests. Low risk; one extra Notion query per unconfirmed row (rare). Requires adding one property to the live Build Log database (manual, one-time).

### P2. Single-call page creation (close the half-written-page window)

**Problem.** Build Log pages are created in two non-atomic calls: create with title+markdown, then patch Session Date / relation / Tags (`bridge-db-sync.ts:250-267`, ops path `:322-343`). A crash between them leaves a dateless, relationless entry invisible to date-filtered views. Governance executions have the same two-write shape (`action-runner.ts:281-320`, accepted there because `Started`→final is intentional state).

**Change.** Pass ALL properties in the `createPageWithMarkdown` payload — the create endpoint accepts a full properties map; the code already sends `properties` with just the title (`:252-256`). If the markdown-create transport genuinely can't carry them (verify against `DirectNotionClient.createPageWithMarkdown`), then invert order: create with full properties + empty body, patch body second — a body-less but fully-attributed entry beats an attributed-less body.

**Verify.** Unit test asserting the create payload carries Session Date/relation/Tags; integration dry-run diff unchanged.

**Size/Risk.** ~30 lines. Low. Combined with P1, the build-log lane becomes an honest idempotent outbox consumer.

### P3. Durable watermarks for the signal layer

**Problem (three heads, one cause: no persisted cursor).**
- `readNotificationHubJsonl` keeps only the last `maxEventsPerSource` lines — a burst bigger than the window silently loses the oldest events forever (`external-signal-sync.ts:2608-2634`).
- Cross-run dedup depends entirely on live Notion event-key queries; any transient error triggers a full-DB scan fallback (`local-portfolio-external-signals-live.ts:542-552`).
- A `cursor` field (`newestOccurredAt`) is computed per provider result and **never read back** (`external-signal-sync.ts:1620`).

**Change.** Persist per-provider watermarks in a local state file (`~/.local/share/notion-os/signal-watermarks.json`, same home as snapshots):
1. After a successful live write batch, store `{provider, sourceId, lastOccurredAt, lastEventId}`.
2. notification_hub: read the JSONL **from the watermark forward** (scan is cheap — it's a local file) instead of tail-slicing; cap per-run *writes*, not *reads*, so a burst queues instead of vanishing.
3. Use the watermark to bound the event-key dedup query set (only keys newer than watermark need checking), which shrinks the OR-filter batches and makes the full-scan fallback nearly unreachable.
4. Fallback hardening: retry the batched key query once before conceding to `full_scan_fallback`, and cap the scan.

**Verify.** Test: 2×window-size events between runs → all events written across two runs, none dropped. Test: watermark file absent → behavior identical to today (backward compatible).

**Size/Risk.** ~150 lines + tests. Medium. The watermark file is new local state — must be excluded from "truth" semantics (it's a cursor, rebuildable by deleting it).

### P4. Fix the Vercel dedup-contract inconsistency

**Problem ✓.** Vercel event keys include `status` (`external-signal-sync.ts:3068-3074` verified), so one deployment transitioning BUILDING→READY produces N rows; notification_hub and repo_auditor key on identity. Events DB inflates and "latest deployment status" reads noisy.

**Change.** Key on identity (`vercel::deployment::{sourceId}::{uid}`), and treat status changes as **updates to the existing row** (status property + occurredAt patch) — upsert, not append. If append-only history is actually wanted for deployments, make that explicit per-provider config (`dedupMode: "identity" | "identity+status"`) instead of an accident.

**Verify.** Test: same uid, two statuses → one row, final status; distinct uids → distinct rows.

**Size/Risk.** ~60 lines. Low-medium: changes row semantics — decide whether existing duplicate rows get a one-time hygiene sweep (fits the existing hygiene-pass family).

### P5. Same-day idempotency for snapshot history + real openPrCount

**Problem ✓.** `appendSnapshotBatch` blind-appends (`snapshot-history.ts:43-67` verified) — a double-run double-counts in trend analysis and can corrupt consecutive-staleness detection. Separately, control-tower-sync hardcodes `openPrCount: 0` into every snapshot (`control-tower-sync.ts:188`), so PR trend data is fiction.

**Change.** (a) Before append, drop incoming entries whose `(projectId, snapshotDate)` already exists — read-modify-write on a local JSONL is cheap at this scale; or dedupe at read time in `readAllSnapshots` (last-write-wins per key) which also heals historical dupes. Do both: read-side dedup for history, write-side skip for cleanliness. (b) Thread the real Open PR Count (already fetched by external-signal-sync onto project rows) into the snapshot record; if unavailable at CT-sync time, record `null`, not `0` — absent data must not masquerade as zero.

**Verify.** Test: double append same day → single logical row in trend math. Test: `openPrCount` null-vs-zero distinction preserved through render.

**Size/Risk.** ~70 lines. Low.

---

## Tier 2 — Coherence (two answers to one question)

### P6. One write-verification conscience: give Pathway A read-back convergence

**Problem.** The generic `Publisher` reads pages back after live writes but only checks `truncated`/`unknownBlockIds` — it never compares content (`publisher.ts:595-605`). Real convergence checking exists only in the managed-section engine. Also `update_existing_page` silently no-ops when `contentUpdates` is empty (`publisher.ts:235,401`) while `targeted_search_replace` throws — two contracts for near-identical modes. And the strategy blocks are duplicated verbatim (`:218-241` vs `:384-407`), guaranteed to drift.

**Change.**
1. Extract the duplicated strategy blocks into one `applyContentStrategy()` helper.
2. After live content writes, run the readback through `pageMarkdownMatches` (already exists, already fuzzy-correct) and surface `converged: boolean` in the publish summary; warn loudly on mismatch.
3. `update_existing_page` with no `contentUpdates` → warn ("properties-only update; no content changes supplied") instead of silence.
4. Raise `DEFAULT_READ_BACK_MAX_ATTEMPTS` from 1 to 2 (`managed-markdown-sync.ts:16`) so "convergence" means what it says — callers who want one attempt can pass it.

**Verify.** Existing 60-file test suite + new cases: garbled-write simulation → `converged:false` warning; empty contentUpdates → warning present.

**Size/Risk.** ~120 lines net (deduplication may shrink the file). Low-medium — touches the shared publish path, so full `npm run verify` gate.

### P7. Read-back before recreate in the command-center fallback

**Problem.** On a markdown-patch transport error, control-tower-sync creates a NEW command-center page and re-points config + destination registry (`control-tower-sync.ts:285-318`). If the patch actually landed (ack-lost case — exactly what `read_back_converged` exists for), the old page is orphaned and content duplicated. The weekly-refresh path already has the more careful recreate flow (`replaceCommandCenterPageAfterPatchFailure`, `weekly-refresh.ts:1218-1257`).

**Change.** In the catch: read the page back first; if `pageMarkdownMatches` says the patch landed, return success (converged). Only recreate when the page is genuinely unreachable/corrupt, and when recreating, archive the old page (`in_trash:true`, the hygiene-pass idiom) instead of orphaning it.

**Verify.** Test: transport error + landed write → no new page created. Test: genuine failure → new page + old page trashed + registry repointed.

**Size/Risk.** ~50 lines. Low.

### P8. Evict config-in-code (UUIDs and aliases)

**Problem.** Hardcoded workspace identifiers contradict the repo's own config discipline: `PROJECT_PORTFOLIO_DATA_SOURCE_ID` + `OPERATIONAL_PROJECT_ALIASES` (`bridge-db-sync.ts:49,69-90`), `INTAKE_PROJECTS_DATA_SOURCE_ID` hardcoded twice independently (`notion-hygiene-pass.ts:~43`, `github-notion-catch-up.ts:~245`), canonical-page pins + forced-merge lists (`support-database-hygiene-pass.ts:~24-35`). A workspace rebuild silently strands all of them. CLAUDE.md itself admits "No one-shot global cross-config validator exists."

**Change.**
1. New `config/workspace-ids.json`: `{dataSources: {projectPortfolio, intakeProjects, ...}, operationalAliases: [...], canonicalPins: [...]}` with one typed loader.
2. Replace all in-code literals with loader reads (grep-audit for `[0-9a-f]{8}-[0-9a-f]{4}` in src/ to catch stragglers).
3. Add `notion-os doctor --config-cross-check`: every configured id resolves against the live workspace; every alias target exists. This is the missing cross-config validator, scoped to ids first.

**Verify.** Typecheck + tests + a doctor run against the live workspace (read-only).

**Size/Risk.** ~200 lines across ~6 files. Low risk mechanically, high grep discipline required. Good candidate for a Codex dispatch (mechanical, crisp spec, volume) once the config schema is agreed.

---

## Tier 3 — Governance + operational polish

### P9. Tighten the approval gate's weakest links
- **Requester ≠ approver:** record a `Requested By` person on Action Requests at sync time and reject readiness when the sole approver equals the requester (`local-portfolio-actuation.ts:1749-1760`). Single-operator reality means this mostly guards against reflexive self-approval habits — still worth encoding.
- **Decide break-glass:** the tokens exist in schema/audit only (`runtime-config.ts:19-20,43-44`; zero execution branches). Either wire a real, loudly-audited emergency path or delete the schema entries — a security concept that exists only on paper is worse than absent, because it reads as covered.
- **Surface missing preflight creds at dry-run time:** `fetchGitHubActionPreflight` returning `undefined` on missing creds (`:2086`) should add a readiness note immediately, not first at live intent (`:1890`) — otherwise early dry runs look cleaner than they are.

### P10. Orchestrator ergonomics
- **Per-step timeout scaling:** make `--step-timeout-minutes` a multiplier on the tiered defaults (or accept `lane=minutes` pairs) instead of a uniform override that SIGTERMs the 20-minute external-signals lane (`weekly-refresh.ts:375-380`).
- **Typed retryability:** child-timeout and transport failures should carry a structured `retryable` flag on the error object rather than being re-classified from message strings (`:569,647`).
- **Build the step list once:** preflight and live phases construct step definitions independently (`:179,200`); build once, reuse, so live executes exactly what preflight validated.
- **Rename the dry-run counter:** `rowsWritten` under dry-run means "would write" (`bridge-db-sync.ts:241-247`); report `rowsWouldWrite` to stop telemetry ambiguity.

### P11. Wire the stale-support-audit queue into the follow-through lane
`stale-support-audit` emits actionable review queues that nothing consumes (read-only by design, but also invisible-by-default). Feed its `actionable` bucket into `packet-follow-through` as a lane (the lane enum already exists and is extensible) so detected drift shows up where the operator already looks.

---

## Suggested sequencing

1. **PR-1 (correctness core):** P1 + P2 together — they share the create-path surgery. The build-log lane graduates to idempotent-outbox status.
2. **PR-2 (signal integrity):** P3 + P4 + P5 — one theme (durable cursors + honest dedup + honest history).
3. **PR-3 (verification unification):** P6 + P7.
4. **PR-4 (config eviction):** P8, mechanical, Codex-eligible.
5. **PR-5+ (polish):** P9-P11 as appetite allows.

Every PR: dry-run-first testing against the live workspace, `npm run verify` gate, no live Notion writes without explicit operator go.
