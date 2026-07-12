# Web Research — Prior Art + Positioning

*Produced by web-research (general-purpose agent), 2026-07-10. Facts carry URLs; [inference] marks the agent's own judgment. Feeds 08-public-material-plan.md.*

## THREAD 1 — Notion as system of record / serious API sync

1. **Rate limit is the dominant design constraint.** ~3 req/sec average per connection (a Notion engineer quotes 2,700 calls/15 min per token), no paid tier buys more; overages return HTTP 429 + `Retry-After`; 529 = `service_overload`. https://developers.notion.com/reference/request-limits , https://www.resumelens.org/blog/notion/notion-api-and-oauth
2. **Pagination compounds the limit into wall-clock pain.** 100-result cap applies at *every level* of the block tree. Truto's worked example: 250 blocks + 50 toggles × 150 children = 103 API calls, >34s to read ONE document. https://truto.one/blog/how-to-integrate-with-the-notion-api-architecture-guide-for-b2b-saas/
3. **Cursors are short-lived — a hidden trap for interrupted syncs.** A cursor should be consumed in the immediately following request; pausing for backoff/timeout/restart can expire it. https://www.resumelens.org/blog/notion/notion-api-and-oauth
4. **The markdown↔block fidelity gap is a deliberate Notion decision, not a bug.** Notion chose custom JSON over Markdown: Markdown implementations diverge, many block types have no Markdown equivalent, and breadth-first pagination is trivial on UUID-bearing JSON but near-impossible on newline-structured Markdown. Canonical primary source for the "round-trip fidelity" framing. https://www.notion.com/blog/creating-the-notion-api
5. **Practitioners treat unrepresentable blocks as a safety hazard.** `easy-notion-mcp` emits an `omitted_block_types` warning because blindly round-tripping would DELETE those blocks on write-back — same failure class the fallback ladder + assertSafeReplacement guard against. https://github.com/Grey-Iris/easy-notion-mcp ; war-story: https://altf4.blog/blog/2024-02-25-building-a-notion-to-markdown-tool-is-annoying-actually/
6. **The 2025-09-03 data-source API is a real, dateable breaking change.** Databases became containers holding multiple "data sources"; `/v1/databases/:id/query` → `/v1/data_sources/:id/query`. A live example for "schema-drift assertions before writes." https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03
7. **Notion's OWN sync model mirrors the outbox/optimistic-update pattern.** operations → transactions → optimistic local apply → local `TransactionQueue` → `/saveTransactions` → server validates → WebSocket notify. "Notion itself does what you're doing" hook. https://howworks.ai/blog/how-notion-was-built
8. **Blunt dissenting view (for balance):** Notion was built for team docs, not programmatic ingestion; 3 req/sec is reasonable for docs even if painful for automation. https://dev.to/kanta13jp1/notion-api-rate-limits-are-breaking-your-automation-heres-the-real-fix-o5p
9. **Closest existing "local files → Notion as view" tools:** `notion-skills` (Brian Lovin — local files round-trip as Notion sub-pages, local machine authoritative) and `oss-notion-markdown-sync` (claims 100% content preservation on pull-push-pull). https://github.com/brianlovin/notion-skills/ , https://github.com/vegastack/oss-notion-markdown-sync

**[inference]** Nobody frames Notion explicitly as a *materialized view with single-writer partitioned ownership + receipt writeback*. Existing tools are bidirectional git-doc sync or no-code reverse-ETL. The model is architecturally distinct.

## THREAD 2 — Local-first & reconciliation literature (concept mapping)

1. **Ink & Switch, "Local-first software" (2019)** — canonical manifesto. **[inference]** Cite to position AGAINST: single-writer-per-field deliberately skips the CRDT convergence problem local-first exists to solve. Strong opening contrast. https://www.inkandswitch.com/essay/local-first/
2. **"Exactly-once delivery is a lie; exactly-once *processing* is real."** at-most-once / at-least-once / at-least-once + idempotent consumer; Two Generals Problem. https://medium.com/@gangoladeepa/why-exactly-once-delivery-is-a-lie-and-how-to-actually-achieve-it-f734db1f89c5
3. **Best idempotency citation: Gunnar Morling, "On Idempotency Keys" (Nov 2025).** Key line: *"idempotency gives you deterministic convergence under retries, not exactly-once."* Covers key-scheme tradeoffs (UUIDv4 vs UUIDv7/ULID vs monotonic sequence). https://www.morling.dev/blog/on-idempotency-keys/
4. **Race-safety subtlety:** the only race-free idempotency impl is unique-constraint + insert in the *same transaction*; check-then-process has a TOCTOU window. https://backendbytes.com/articles/idempotency-patterns-distributed-systems/
5. **Transactional outbox = the event queue's formal name.** The SQLite→Notion build-log queue IS an outbox — use the term. https://dzone.com/articles/outbox-pattern-reliable-messaging-distributed-systems
6. **Read-repair vs anti-entropy.** **[inference]** The read-back-convergence rung is read-repair; a periodic full re-reconcile would be anti-entropy; dry-run drift audit ≈ anti-entropy detection without repair. https://algoroq.io/learn/system-design-advanced/anti-entropy-and-read-repair/
7. **CQRS / materialized-view framing.** Notion = the materialized read model, rebuilt from local truth via the outbox. https://medium.com/@qingedaig/distributed-systems-consistency-patterns-3d2fa986fa3b
8. **"Exactly-once IS possible" counter-canon (intellectual honesty):** Confluent/Kreps — Kafka via idempotent producers + transactions. Cite to show the "lie" framing is a simplification. https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/ , https://medium.com/@jaykreps/exactly-once-support-in-apache-kafka-55e1fdd0a35f

## THREAD 3 — What makes great interactive system explainers

1. **Bret Victor, "Explorable Explanations" (2011)** — the origin; the bar is the **reactive document**: *"a written argument whose assertions are backed by explorable computational models."* https://worrydream.com/ExplorableExplanations/
2. **Bartosz Ciechanowski** — build-from-first-principles + draggable direct manipulation + 100+ purpose-built visuals per piece. Hand-coded, no frameworks. https://ciechanow.ski/ , https://ciechanow.ski/mechanical-watch/
3. **Sam Rose (samwho.dev)** — closest tonal/technical match. Design lesson in his own words: he *deliberately omitted* algorithms whose cost was hard to visualize — cut scope to what the animation can honestly show. Vanilla JS, source public. https://samwho.dev/load-balancing/ , https://encore.dev/blog/queueing , https://github.com/samwho/visualisations
4. **Nicky Case** — interaction patterns: **place-your-bets** (predict, then reveal) and **Sandbox Mode** (end in free play). https://blog.ncase.me/how-i-make-an-explorable-explanation/ , https://blog.ncase.me/explorable-explanations-4-more-design-patterns/
5. **Jake Lazaroff, "An Interactive Intro to CRDTs" (2023)** — single closest prior art: draggable peers you edit and watch converge. https://jakelazaroff.com/words/an-interactive-intro-to-crdts/
6. **Raft is thoroughly covered — a "taken" example.** Secret Lives of Data (guided) + RaftScope (free play). https://thesecretlivesofdata.com/raft/ , https://raft.github.io/
7. **distill.pub** = production ceiling; **Julia Evans' zines** = proof great explainer ≠ interactive. https://github.com/blob42/awesome-explorables
8. **Mechanism taxonomy:** scrubbing/sliders; simulation/free-play; guided steps; predict-then-reveal; build-from-primitives.

## CLOSEST PRIOR ART

1. **Lazaroff CRDT intro** — exactly the visual, but for multi-writer auto-merge (the opposite model). **[inference]** Thesis option: "CRDTs are what you use when you *can't* have a single writer — here's the simpler world when you can."
2. **RaftScope / Secret Lives of Data** — log convergence + partition healing, but solves consensus, which this system avoids.
3. **Sam Rose Load Balancing / Queueing** — closest in tone and the most imitable style for a sync/outbox visualization.

## OPEN GROUND ([inference], well-supported by absence in results)

- **No interactive explainer exists for the single-writer / idempotent-upsert / outbox-reconciler family.** Everything interactive is CRDT or consensus. The "boring but correct" middle — partition ownership so conflicts *can't* happen, at-least-once + idempotency + receipts — has zero interactive treatment. Clean unclaimed lane.
- **Nobody has visualized a fallback ladder.** Targeted-replace → full-replace → anchored-insert → read-back-convergence, showing which rung fired — no prior art visualizes graceful degradation of a write.
- **Nobody animates "at-least-once + receipt writeback closing the loop."** The exactly-once-is-a-lie material is all prose. An explorable where you drop an ack / inject a duplicate / kill mid-write and watch idempotency + receipts converge anyway would be the first interactive proof.
- **"Local machine as truth, Notion as materialized view"** is unclaimed as a narrative.

**Strongest positioning [inference]:** Sam Rose's animation style + Nicky Case's predict-then-reveal, applied to the outbox/idempotency/read-repair triad that currently lives only in prose — explicitly contrasted against the CRDT explainers as "the simpler world you get when you allow exactly one writer."
