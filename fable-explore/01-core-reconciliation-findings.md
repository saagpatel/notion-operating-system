# Core Reconciliation — Firsthand Read

*Fable's own read of the reconciliation-critical code paths, 2026-07-10. File:line refs verified against working tree.*

## The mental model

Notion OS treats Notion as a **remote materialized view of local truth**, not as a database it owns. Three distinct reconciliation protocols coexist, one per data shape:

1. **Property reconciliation** (structured fields) — diff-and-patch
2. **Section reconciliation** (prose on shared pages) — marker-fenced ownership + degradation ladder
3. **Event reconciliation** (build log) — at-least-once queue drain with receipt writeback

Each has different consistency guarantees, and the differences are principled, not accidental.

## 1. Property reconciliation — `control-tower-sync.ts`

- Fetches ALL project rows from Notion first, derives new signal values locally, then computes a per-property diff (`buildDerivedPropertyUpdates`, `src/notion/control-tower-sync.ts:321-340`). Only changed properties are patched; unchanged rows are skipped entirely.
- **Field ownership is a hard contract**: control-tower-sync owns exactly Operating Queue / Next Review Date / Evidence Freshness. Other commands own other derived fields (see CLAUDE.md "Field ownership"). Manual fields are never touched. This is single-writer-per-field — conflict avoidance by partition, not by merge.
- Derivation rules are a priority ladder (`deriveOperatingQueue`, `local-portfolio-control-tower.ts:34-70`): Shipped > Needs Review > Needs Decision > Worth Finishing > Resume Now (Active Build + runs locally + friction ≠ High) > Cold Storage > Watch. Evidence Freshness is windowed age (Fresh/Aging/Stale) off newest(lastActive, lastBuildSessionDate).
- Phase state + baseline metrics are persisted back into the **local config file** (`saveLocalPortfolioControlTowerConfig`, control-tower-sync.ts:203) — local mutable state lives in a JSON file committed in the repo, not in Notion.
- Live run appends a JSONL snapshot batch (`appendSnapshotBatch`, :181) → trend analysis. So every live sync leaves a local history record; Notion holds only "now."

## 2. Section reconciliation — the managed-section protocol

The most original subsystem. Multiple commands write to the SAME Notion pages (command center, weekly review). Coordination protocol:

- Each writer owns named sections fenced by HTML comment markers `<!-- codex:notion-<key>:start/end -->` (`managed-markdown-sections.ts`). ~9 section types across command center + weekly page.
- A full-page re-renderer (control-tower-sync) calls `preserveManagedSections` (`src/utils/markdown.ts:140-156`): render your own page, then splice back every OTHER owner's section extracted from the previous remote markdown. **Page-level merge with section granularity.**
- Section writers call `syncManagedMarkdownSection` (`src/notion/managed-markdown-sync.ts:32-127`) — a five-rung degradation ladder:
  1. Normalized-equality no-op check (:45-50)
  2. Targeted search-replace of just the section via `update_content` oldStr→newStr (:63-84)
  3. On Notion **policy block** — a 403 whose body is Cloudflare's "you have been blocked" HTML (`isNotionPolicyBlockedError`, :178-190) — fall back to full `replace_content` (:88-96)
  4. If that's also blocked: insert section after the unique H1 anchor, else append after a unique tail chunk (tail candidates 1200→250 chars, uniqueness-verified, ≥120 chars; :199-251)
  5. `syncManagedMarkdownSectionWithReadBack` (:129-176): on transport error, **read the page back and compare** — if remote already matches target, return `read_back_converged`. Handles "write landed, ack lost."
- Equality is **fuzzy by necessity**: `pageMarkdownMatches` (markdown.ts:75-89) compares sets of normalized candidates (with/without leading title) because Notion's markdown↔block round-trip is not byte-stable. *Idempotency against a document database requires defining your own equivalence relation.*

## 3. Event reconciliation — `bridge-db-sync.ts` (build log honesty)

Local sessions (CC/Codex/personal-ops) log SHIPPED rows into bridge-db (SQLite). This sync drains them into the Notion Build Log:

- Reads unprocessed SHIPPED rows via a spawned MCP subprocess session (not raw sqlite3 anymore) — `readShippedRows` (:465-475). Schema-compat preflight fails loud before any Notion work (:116-123).
- **Routing ladder** for project attribution (`resolveShippedProjectTarget`, :666-684): canonical registry id (bridge-db `notion_sync.state === "ready"` → direct page id, rename-proof) → fuzzy name match against two databases (normalized lookup keys: lowercase, dash/space/alnum variants, :731-741) → hardcoded `OPERATIONAL_PROJECT_ALIASES` map (:69-90).
- **Receipt loop**: after creating the Build Log page, `confirmShippedRowSynced` writes the Notion page id back into bridge-db as `downstreamRef` (:269-281). The upstream queue holds a durable pointer to the downstream artifact — provenance in both directions.
- **Unrouted rows never die**: skipped rows aren't marked processed, so they retry every run and are surfaced via notification-hub at warn level (:405-416, comment cites finding F9). Deliberate: visible purgatory instead of silent drop.
- Schema drift check on all three Notion databases before writing (`assertDataSourceSchemaProperties`, :523-545) — remote schema is an assumption to verify, not a given.

## Rough edges I found firsthand

1. **Duplicate-on-retry window (at-least-once, no idempotency key).** In `runBridgeDbSyncCommand`, if `createPageWithMarkdown` succeeds but `confirmShippedRowSynced` fails (:268-281), the row stays unprocessed and the next run creates a **second** Build Log page. Same shape in the ops-events path (:344-355, `markRowProcessed`). The comment even says "it will be re-processed on next run." No pre-write existence check (e.g. query Build Log for a page whose title/downstreamRef matches the row) and no idempotency key. Window is small but the failure mode is silent duplication in the system of record.
2. **Two-phase page write is non-atomic** (:250-267): page created with title+body, then properties (Session Date, relation, Tags) patched in a second call. Crash between the two leaves a Build Log entry with no date/relation — invisible to date-filtered views.
3. **Config-in-code**: `PROJECT_PORTFOLIO_DATA_SOURCE_ID` hardcoded (:49), `OPERATIONAL_PROJECT_ALIASES` hardcoded (:69-90). Contradicts the repo's own config discipline (everything else lives in `config/*.json`).
4. **`openPrCount: 0` hardcoded in snapshots** (control-tower-sync.ts:188) — trend history always records zero open PRs even though external-signal-sync owns a real Open PR Count field. Trend analysis on that column is fiction.
5. **Command-center transport-error fallback creates a new page** (control-tower-sync.ts:285-318): on `isMarkdownPatchTransportError`, it creates a fresh page and re-points config + destination registry. The old page is orphaned in Notion, and if the patch actually landed (ack-lost case), content is now duplicated. The weekly-section path got the read-back-converged treatment; this path didn't.
6. **Dry-run counts "would-write" as written** (`result.rowsWritten += 1` under `!live`, :241-247) — mildly confusing telemetry; dry-run and live share a counter name meaning different things.

## The drift vocabulary — `weekly-refresh-contract.ts`

Every command reports a `WeeklyRefreshStepContract` with status `clean | drift | completed | partial | failed | skipped` (`src/notion/weekly-refresh-contract.ts:3-49`). The mapping is the interesting part: **dry-run + wouldChange = "drift"**. Dry-run here isn't just a safety valve — it's an anti-entropy audit. Running the whole suite dry answers "where do local truth and Notion currently disagree?" without writing a byte. Live + wouldChange = "completed"; live + no change = "clean". One vocabulary for both auditing and repairing.

Other supporting guards found firsthand:
- `assertSafeReplacement` (`src/utils/markdown.ts:44-57`): full-page replace refuses to proceed if it would drop child-page/child-database reference blocks (`allowDeletingContent=false` philosophy — a re-render can never orphan children).
- Transport is Notion's native markdown REST endpoints (`GET/PATCH /v1/pages/{id}/markdown`, `direct-notion-client.ts:318,382`) — the round-trip instability and WAF-blocked patches are properties of Notion's own markdown API, which is why the fuzzy-equality + ladder machinery exists.

## Load-bearing insight for the public piece

The system never trusts a write. Every mutation path has: dry-run default → schema assertion → diff-before-write → fuzzy-equality no-op → write → read-back or receipt. And the failure philosophy is consistent: **fail loud and retry forever beats fail silent** (unrouted rows accumulate visibly; schema drift aborts; ack-loss triggers read-back). The one place that philosophy has a gap is the duplicate-on-retry window — the cost of at-least-once with no idempotency key.
