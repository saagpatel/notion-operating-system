# Publishing Pipeline — Subagent Map

*Produced by map-publishing (Explore agent), 2026-07-10. File:line refs cited by the agent; spot-verify before acting on any single claim.*

**Reframe up front:** there are **two parallel write pathways**, not one. `src/internal/portfolio-audit/publish-notion.ts` is a legacy dead-end — its line 1 header says "Internal historical utility. Kept for compatibility scripts, not the shared operator surface." It's an Excel-workbook → Notion-database bootstrapper (`publish-notion.ts:9` imports `exceljs`; `:131-141`), NOT part of the live markdown pipeline.

- **Pathway A — generic `Publisher`** (`src/publishing/publisher.ts`): destination-alias-driven, used by the `publish` CLI command. Owns the three update strategies plus `create_new_page`.
- **Pathway B — managed-section sync engine** (`src/notion/managed-markdown-sync.ts` + merge/preserve helpers in `src/utils/markdown.ts`): marker-based in-place section patching with read-back convergence, used by portfolio-audit lanes (`control-tower-sync`, `review-packet`, `morning-brief`, `action-request-sync`, `intelligence-sync`, `execution-sync`).

They share only the low-level client (`DirectNotionClient.patchPageMarkdown`/`readPageMarkdown`) and two helpers (`assertSafeReplacement`, `buildReplaceCommand`). **Pathway A never uses managed sections or the convergence loop; Pathway B never goes through `Publisher`.**

## ARCHITECTURE

**Entry points**
- CLI `publish` command → `PublishRequest` → `Publisher.publish` — `src/cli/registry.ts:104-156` (`--dry-run` `:126-128`, `--live` `:131`, passed through `:154-155`).
- Portfolio-audit lanes call the managed-section engine directly, bypassing `Publisher` (e.g. `control-tower-sync.ts:140-178`, `review-packet.ts:140-207`).

**Pathway A flow (`Publisher.publish`, `publisher.ts:24-97`)**
1. Parse input file (`:25`), compute `dryRun` (`:26`).
2. Resolve destination (`:35` → `resolveDestination` `:426-457`).
3. Branch on `destinationType`: `page` → `publishToPageParent` (`:99-159`, create-only) or `publishToStandalonePage` (`:161-258`, update modes); `data_source` → schema retrieve/snapshot (`:65-77`), `buildDataSourceProperties` (`:78-84`), then `publishToDataSource` (`:260-424`).
4. Live writes: update properties, apply mode-selected content patch, read the page back (`:243`, `:409`), collect warnings (`collectReadWarnings` `:595-605`).

**Pathway B flow (managed-section sync)**
1. Read current page markdown (`control-tower-sync.ts:140`, `review-packet.ts:141`).
2. Render new markdown, re-inject previously-existing managed sections via `preserveManagedSections` (`markdown.ts:141-157`) so a lane doesn't clobber sections owned by other lanes.
3. Compute would-change flag with `pageMarkdownMatches` (`control-tower-sync.ts:163-169`, `review-packet.ts:153-159`) — the idempotency gate.
4. On live + changed, patch via `syncManagedMarkdownSectionWithReadBack` (`managed-markdown-sync.ts:129-176`) or a direct `replace_content` (`control-tower-sync.ts:287-291`).

**Low-level client** — `DirectNotionClient.patchPageMarkdown` (`direct-notion-client.ts:360-386`) maps to Notion's `replace_content`/`update_content` block commands; `readPageMarkdown` (`:317-328`) surfaces `truncated` + `unknown_block_ids`.

**Types** — Zod-validated in `src/types.ts`: `PublishModeSchema` (`:3-8`), `SafeDefaultsSchema` (`:28-38`, `allowDeletingContent` default `false`), `ContentUpdateSchema` (`:80-84`), `PublishRequestSchema` (`:86-96`).

## MECHANISMS

**Update strategies** (identical if/else blocks appear twice — `publisher.ts:218-241` standalone page, `:384-407` data source):
- `replace_full_content` — if `allowDeletingContent` false, read back + `assertSafeReplacement(previous, next)`, then `patchPageMarkdown({command:"replace_content", newMarkdown: buildReplaceCommand(body)})` (`:218-228` / `:384-394`).
- `targeted_search_replace` — `update_content` with `validateContentUpdates(request.contentUpdates)`, which **throws if empty** (`markdown.ts:32-38`) (`:229-234` / `:395-400`).
- `update_existing_page` — same `update_content` **but only if `request.contentUpdates?.length`** (`:235-241` / `:401-407`). No validation, no throw.
- `create_new_page` — `createPageWithMarkdown`; on a templated data source, waits for template readiness (`:315-322`) then patches body in (`:324-328`).

**Managed-section algorithm** (diagram-ready):
1. *Markers* — `{startMarker, endMarker, fallbackHeading, fallbackBody}`, HTML comments (`managed-markdown-sections.ts:9-102`).
2. *Find bounds* — `findManagedSectionBounds` (`markdown.ts:159-182`): for each candidate start-marker form, `indexOf` start, then `indexOf` end after it; return first pair with `endIndex > startIndex`.
3. *Marker candidates* — `markerCandidates` (`:184-194`) generates 4 variants (raw, angle-escaped, colon-escaped, both) to survive Notion round-trip escaping.
4. *Extract* — `extractManagedSection` (`:128-139`) slices start→end inclusive.
5. *Merge* — `mergeManagedSection` (`:107-126`): if bounds found, splice `[before, newSection, after]`; **if not found, append to end**.
6. *Preserve* — `preserveManagedSections` (`:141-157`): extract each section from previous page, merge into next; **skip if previous lacked it**.

**Patch + fallback ladder** (`syncManagedMarkdownSection`, `managed-markdown-sync.ts:32-127`):
- Early no-op return if normalized previous == normalized next (`:45-50`).
- Both prev + next section exist → `update_content` swapping old section for new (`:63-78`).
- Else → `assertSafeReplacement` then full `replace_content` (`:86-96`).
- If `replace_content` blocked by **Cloudflare WAF 403** (`isNotionPolicyBlockedError` regex on body, `:178-190`), fall through to two heuristic `update_content` fallbacks: insert-after-first-heading, then append-to-tail (`:102-122`, builders `:199-251`).

**Convergence / read-back** (`syncManagedMarkdownSectionWithReadBack`, `:129-176`):
- Loop up to `maxAttempts`, default **1** (`DEFAULT_READ_BACK_MAX_ATTEMPTS = 1`, `:16`).
- On recoverable transport error (`isReadBackRecoverableMarkdownError` regex on PATCH errors, `:192-197`), read back; if normalized readback == normalized next, return `"read_back_converged"` (treat-as-success on ambiguous network failure); else loop with readback as new baseline.

**Idempotency gate** — `pageMarkdownMatches` (`markdown.ts:76-90`) compares normalized candidates (with/without leading title). All work is in `normalizeComparisonMarkdown` (`:207-233`): canonicalizes Notion URLs, dedupes adjacent duplicate links (`:235-250`), un-escapes `\[ \| \<` etc., collapses `\n{2,}` → `\n` (`:226`). This regex pile is the entire basis of "did anything change."

## SAFETY RAILS

- **Dry-run default:** `dryRun = request.live ? false : request.dryRun ?? true` (`publisher.ts:26`). Every write branch gated behind `if (dryRun) return {...}` (`:126`, `:195`, `:290`, `:359`).
- **Token-less dry-run requires pre-resolved IDs / schema snapshots** — throws otherwise (`publisher.ts:74-77`, `:429-446`).
- **Schema validation before write:** `buildDataSourceProperties` rejects unknown (`property-validator.ts:58-60`) + non-writable (`:61-63`) properties.
- **Zod validation** on request + config (`types.ts:80-96`).
- **`allowDeletingContent` defaults false** (`types.ts:30,35`), gates `assertSafeReplacement` (`publisher.ts:219,385`; `managed-markdown-sync.ts:86`).
- **Env kill-switch:** `NOTION_SKIP_MANAGED_MARKDOWN_PATCH=1` short-circuits managed patches (`managed-markdown-sync.ts:28-30,41-44,139-142`).
- **Would-change gate:** Pathway B only publishes when `pageMarkdownMatches` says content differs.
- **Read-back after write** in both pathways (`publisher.ts:243,409`; Pathway B `:161`).
- **HTTP retry w/ backoff** (`http.ts:95-141`); `destinations:check`/doctor reachability validation (`doctor.ts:112-174`).

## ROUGH EDGES

1. **Pathway A's read-back does not verify content.** `collectReadWarnings` (`publisher.ts:595-605`) only checks `truncated` + `unknownBlockIds`; never compares readback to intended markdown. True convergence checking exists ONLY in Pathway B. A silent garbled write via `publish` would pass.
2. **`update_existing_page` silently no-ops on content.** `&& request.contentUpdates?.length` with no `else` (`publisher.ts:235,401`) → properties-only update, zero error — whereas `targeted_search_replace` throws. Inconsistent contracts for near-identical modes.
3. **Non-atomic writes.** Properties updated first (`publisher.ts:211-216,379-382`), then content patch separately. Patch failure leaves properties mutated, no rollback.
4. **Duplicated strategy blocks** — `publisher.ts:218-241` and `:384-407` are copy-paste; will drift.
5. **WAF-block-as-control-flow.** Regex-matching Cloudflare's block page in a 403 body and switching to heuristic tail-append fallbacks is brittle and can misplace a managed section (`buildAppendSectionTailUpdate` `:199-227`).
6. **Default `maxAttempts = 1` undercuts "convergence."** (`:16`) Only callers passing higher (e.g. `action-request-sync.ts:182` → 2) get real retries. Name oversells behavior.
7. **Duplicate / missing markers handled silently.** Duplicated pairs → later content ignored, no warning. Missing markers → append-to-end / silent skip — can misplace or drop managed content.
8. **Idempotency rides on a fragile regex stack.** `normalizeComparisonMarkdown` hard-codes Notion's current URL/escaping/link-dedup quirks. Any Notion round-trip change → spurious `wouldChange` → unnecessary live writes. `\n{2,}`→`\n` is aggressive enough to mask real whitespace diffs.
9. **`assertSafeReplacement` is narrower than it sounds.** Only protects page/database reference blocks. A full replace can still delete all prose with `allowDeletingContent=false` as long as no child-ref blocks disappear.
10. **Focus-file mismatch.** `publish-notion.ts` is self-declared legacy — live surface is `publisher.ts` + the `src/notion/*-sync.ts` lanes.

**Files to open directly:** `src/publishing/publisher.ts`, `src/notion/managed-markdown-sync.ts`, `src/utils/markdown.ts`, `src/notion/managed-markdown-sections.ts`, `src/publishing/property-validator.ts`, `src/types.ts`.
