# Public Material Plan — saagarpatel.dev

*Drafted by Fable, 2026-07-10. Grounded in 06 (synthesis) + 09 (prior-art research). Public-safe rule: architecture and reasoning only — mechanism shapes, never workspace contents, project names, or personal data.*

## What earns its place (and what doesn't)

The research verdict is unambiguous: interactive sync explainers exist only for CRDTs and consensus. The single-writer / outbox / idempotency / read-repair family — the pattern that quietly runs most real systems — has zero interactive treatment. Notion OS is a complete, battle-scarred instance of exactly that family. So the package is:

1. **One interactive explainer** (the centerpiece, the unclaimed lane)
2. **One essay** (the narrative + the receipts)
3. **A diagram set** (shared between them, standalone-linkable)

**Cut candidates I considered and dropped:** a "Notion API pain" listicle (crowded, low-signal); a CLI walkthrough (nobody's workspace but ours, violates public-safe anyway); a full governance/actuation piece (strong but second-tier — fold its best moment, approval-that-can't-be-replayed, into the essay and revisit as a follow-up if the first piece lands).

---

## Piece 1 — Interactive explainer: "The Reconciler"

**Working title:** *One Writer, No Lies — how a local machine keeps a remote record honest*
**Form:** self-contained interactive page (vanilla JS/TS, no framework runtime, matching the generator-site constraint). Sam Rose visual register; Nicky Case predict-then-reveal beats.

**The scene:** LOCAL (left) — a truth store emitting events and derived fields. REMOTE (right) — a Notion-like record with property rows and a page of fenced sections. Between them: the sync lane where requests/acks visibly travel and fail.

**Guided acts (scroll- or step-driven), each ending in a predict-then-reveal:**

1. **The naive sync.** Push everything on every run. Watch duplicate rows pile up on retry. *Bet: what happens when this ack is lost?*
2. **Partition the writers.** Fields get owner badges; conflicts become structurally impossible. The CRDT contrast beat: "merge algebras are for when you can't do this."
3. **The outbox.** Events queue locally; each drain writes remotely and a **receipt flows back**. Kill the process mid-write (button) — watch at-least-once + idempotency key converge to exactly-one page. The literature's prose claim, animated for the first time.
4. **The fallback ladder.** A section write meets escalating obstacles (marker intact → marker escaped → WAF block). Watch the reconciler try progressively blunter instruments; rungs light up. Includes the ack-lost rung: read-back says "it actually landed," no retry needed.
5. **Drift and the dry run.** Let remote drift (simulated hand-edit); run a dry pass; watch `drift` statuses light up without any writes. Anti-entropy as a flashlight, not a hammer.
6. **Sandbox mode.** All failure injectors unlocked (drop ack, duplicate delivery, rename remote page, burst the queue, block a patch). A "chaos" toggle. Reader poses their own questions — the Case pattern.

**Honesty beat (mandatory, it's the site's register):** one act shows the *unprotected* lane double-writing — labeled as the real bug found in the real system, with the fix (idempotency key) applied live by the reader. The explainer teaches by fixing our actual defect.

**Scope discipline (Sam Rose's own lesson):** animate only what the mechanism honestly shows. No fake network topology, no queue-theory math. Six acts, one system, every animation a real mechanism from files 01-05.

**Public-safety mapping:** entities are "Project A/B/C", fields are the real *derived-field names* (Operating Queue, Evidence Freshness — mechanism vocabulary, not contents), events are synthetic. The WAF anecdote describes the mechanism (content-based 403 from the edge) without quoting any blocked content.

## Piece 2 — Essay: the teardown

**Working title:** *You Don't Own Your Database* (alt: *Keeping an Honest Build Log in Someone Else's House*)
**Register:** plainspoken teardown, scars-first. Every mechanism introduced as the betrayal that forced it.

**Spine (each section = betrayal → scar → named pattern):**
1. The premise: local machine is truth; Notion is a materialized view you *rent*. (Prior art: reverse-ETL and doc-sync tools exist; the materialized-view-with-receipts framing doesn't.)
2. Round-trip betrayal → homemade equality. Notion's own blog says the markdown gap is deliberate; therefore `did anything change?` is a regex-stack equivalence relation you must own.
3. Lost acks → read-repair. The `read_back_converged` rung; ack loss ≠ write loss.
4. The firewall reads your prose → the fallback ladder. Cloudflare-block-as-control-flow.
5. Renames → canonical registry routing with fuzzy fallback (rename-proof ids over name matching).
6. Retries → the outbox + receipts… and the confession: one lane had idempotency keys, one didn't, and the one that didn't could double-write. Here's the fix. (Morling citation.)
7. Trust nothing, including yourself: dry-run as anti-entropy (`drift` status), approval that can't be replayed, additive-only mutations.
8. Close: what this cost (~64K lines, ~49 commands) and when you should absolutely not do this. Honest bill.

**Length target:** 2,500-3,500 words + 4 diagrams + links into the explainer at acts 3/4/5.

## Piece 3 — Diagram set (shared)

1. **Three protocols, one system** — data shape → protocol → guarantee (the taxonomy table as a visual).
2. **The write ladder** — five rungs with trigger conditions (also the explainer's act-4 storyboard).
3. **The receipt loop** — outbox row → Notion page → downstreamRef back; the crash window marked in red pre-fix, green post-fix.
4. **Weekly orchestration gate** — preflight→live two-phase with the "broken preflight never escalates" property.

Style: site's existing palette/ledger conventions (check `feedback_read_design_intent_comments` + dataviz skill at build time).

## Build order + verification

1. Essay outline → full draft (fast, unblocks voice review) → `stop-slop` + `review-prose` passes.
2. Explainer: static storyboard of all 6 acts first (cheap to review) → build acts 3+4 (the unclaimed-ground pair) → wrap remaining acts → embed.
3. Diagrams alongside whichever piece needs them first.
4. Site integration per `reference_portfolio_index_essay_source`: source under `scripts/sources/session-NN`, register in build-writing SOURCES+CLUSTERS, full canonical build sequence, 2-commit date settle, verify via `vercel inspect`.

**Positioning line for the site:** "Everyone explains CRDTs. Nobody explains the boring half of distributed systems that actually runs your tools — one writer, an outbox, receipts, and a firewall that reads your markdown."
