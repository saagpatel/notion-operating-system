# Explainer Storyboard — "One Writer, No Lies"

*Fable, 2026-07-10. Full six-act spec for the interactive centerpiece. Written to be buildable mechanically: every act defines scene, sim rules, interactions, predict-then-reveal beat, and copy stubs. Companion essay: `10-essay-draft.md`.*

---

## The world (shared across all acts)

One simulation, progressively unlocked. Three vertical zones:

```
┌─────────────────────┐   ~~~ THE WIRE ~~~   ┌─────────────────────┐
│  LOCAL (the truth)  │  requests ──────▶    │  REMOTE (the view)  │
│                     │    ◀────── acks      │                     │
│  ┌ outbox ────────┐ │                      │  ┌ record ────────┐ │
│  │ □ row 41 ●     │ │   [failure toggles   │  │ ▤ page: A      │ │
│  │ □ row 42 ○     │ │    live on the wire] │  │ ▤ page: B      │ │
│  └────────────────┘ │                      │  └────────────────┘ │
│  fields: A B C      │                      │  fields: A B C      │
└─────────────────────┘                      └─────────────────────┘
```

- **LOCAL** holds project cards ("Project A/B/C" — synthetic entities, real *mechanism* vocabulary only) with derived fields, plus an **outbox** list where events accumulate. Every outbox row shows a receipt slot: `○` empty, `●` filled (holds the remote page id).
- **REMOTE** holds the mirrored record: a small database of rows, and (from Act 4 on) a page made of fenced sections.
- **THE WIRE** is where the drama happens. Requests are visible packets moving left→right; acks are smaller packets moving right→left. Failure injectors kill packets mid-flight with a visible ✕.
- **The sim is deterministic and tick-based.** Entities: `OutboxRow {id, payload, receipt?}`, `RemoteRow {id, syncKey?, content}`, `Packet {kind: write|ack, rowRef, position}`. Reducers per act (below). Seeded RNG only for cosmetic jitter; all *behavior* is user-triggered, so every reader sees the same causality. No `Date.now()` in logic; tick counter only.
- **Controls chrome (all acts):** ▶ run one sync pass · ⟳ run again · failure toggles (unlocked per act) · reset. A compact **event log** line ("run 2: created page for row 41 · ack lost") under the sim, newest first, max 5 lines.

**Visual language** (final values from the site palette at build time; placeholders here):
- Truth entities: warm paper tones. Remote entities: cooler ink tones. The wire: neutral.
- Duplicate rows flash a red outline and *stay* subtly red — duplicates are the villain; they must remain visible, not fade.
- Receipts are small circular tokens that visibly travel back and dock into the outbox row's slot.
- Ladder rungs (Act 4): a vertical 5-step indicator beside the page; the active rung lights amber, the resolving rung lights green.

**Predict-then-reveal mechanic (Nicky Case beat, one per act):** before the reveal moment, the sim pauses and presents 2-3 buttons ("What happens next?"). Any answer unpauses; the chosen guess gets a ✓/✗ against the outcome. No score kept. Copy stays dry, never quizzy.

---

## Act 1 — The naive sync (the problem)

**Teach:** why "just push everything" corrupts the record. At-least-once without idempotency = duplicates.

**Scene:** LOCAL outbox with 3 rows, REMOTE empty. One button: ▶ sync.

**Sim rules:** sync sends one write packet per unconfirmed row; on arrival REMOTE appends a new row (no dedup); ack returns and marks the outbox row confirmed. No failures yet.

**Beats:**
1. Reader presses ▶. Three packets fly, three pages appear, three acks dock. Clean. Copy: works fine, ship it.
2. Toggle appears: **"drop one ack"**. Reader presses ▶ on a fresh row; the write lands, the ack dies mid-wire (✕). Outbox row stays unconfirmed.
3. **PREDICT:** "The tool retries the row. What does the record look like after?" — (a) one page, (b) two pages, (c) an error.
4. Reveal: ⟳ → second packet → **two pages**, red-flagged. The record now says this thing shipped twice. It didn't.

**Copy stub (closing line):** "The write succeeded. Only the *receipt* was lost. The tool couldn't tell the difference, so it lied by repetition."

## Act 2 — One writer per field (partition beats merge)

**Teach:** conflicts prevented by jurisdiction, not resolved by cleverness. The CRDT contrast.

**Scene:** three field chips per project card on BOTH sides (Queue, Review Date, Freshness) plus one "Notes" field marked ✍ *manual*. Two writer bots appear above LOCAL: `control-tower` and `signal-sync`, each with a colored badge.

**Sim rules:** each writer owns specific fields (badge colors match chip outlines). A writer's sync diffs its OWN fields only and patches only changes. Manual field: no bot may touch it.

**Beats:**
1. Both writers run "concurrently" (interleaved packets). Fields update; no collisions *possible* — each chip has exactly one badge.
2. **PREDICT:** "Both bots run at the same moment. Which field can end up wrong?" — (a) Queue, (b) Freshness, (c) none of them.
3. Reveal: none. Then the contrast card slides in: a 20-second cameo of two writers sharing ONE field, values flickering last-writer-wins, with the caption: "the other fix for this is a merge algebra clever enough to reconcile anything (CRDTs, link) — or you could just decide who owns the field."
4. Reader drags a field chip from one writer's column to the other's: ownership *moves*, conflicts stay impossible. (Direct-manipulation beat; cheap to build, memorable.)

**Copy stub:** "Concurrency control by org chart. Conflicts aren't resolved here. They're unemployable."

## Act 3 — The outbox and the receipt (the fix for Act 1)

**Teach:** transactional outbox + idempotency key + receipt writeback = deterministic convergence under retries. **This act is the unclaimed ground; give it the most room.**

**Scene:** Act 1's world, upgraded: every outbox row now shows a **key tag** (`bridge:cc:41`), every remote page shows a **key slot**. New toggles: drop ack · duplicate delivery · **kill process mid-write** (the big red one).

**Sim rules (the real algorithm, simplified):**
1. For each unconfirmed row: query REMOTE by key.
2. Hit → write receipt only, mark confirmed, badge the row "recovered."
3. Miss → create page (key stamped in the same packet), then receipt.
4. Kill-switch: halts the run between any two steps (reader picks the moment by pressing during flight — packet freezes, process dies, ⟳ restarts).

**Beats:**
1. Re-run Act 1's betrayal: drop the ack, retry. **PREDICT:** one page or two? Reveal: the retry's *query* packet flies first, finds the key, and only a receipt comes back. One page. The row badge reads "recovered."
2. Kill mid-write, after create but before receipt (the exact bug found in the real system — labeled as such). Restart. Converges to one page.
3. Duplicate delivery toggle: the same write delivered twice; second one bounces off the key. Copy names the term: *idempotent consumer*.
4. Chaos button (small): 10 rows, random ack-drops, three ⟳ presses. Counter shows `pages created: 10 / duplicates: 0 / recovered: n`.

**Copy stubs:** "You don't prevent the duplicate delivery. You make it converge." · "The receipt is the queue's proof it was drained — provenance pointing both directions." · Confession callout box: "The real system shipped for months with rung 3 missing its key check. Here's the run that found it." (links to essay section)

## Act 4 — The ladder (writing prose into someone else's house)

**Teach:** graceful degradation of a write; ack-lost ≠ write-lost; the WAF.

**Scene:** REMOTE becomes a *page* with three fenced sections (visible `<!-- start/end -->` markers, color-fenced). LOCAL wants to update section 2. Beside the page: the 5-rung ladder indicator: `no-op · swap · replace · insert · read-back`.

**Sim rules:** each obstacle toggle disables rungs; the sync descends until a rung succeeds:
- no obstacles → rung 1 or 2 (diff decides)
- "markers corrupted" → rung 2 dead → rung 3 (guard checkmark flashes: "no child pages dropped")
- "firewall blocks the patch" (WAF toggle, styled as a tiny castle wall on the wire) → rungs 2-3 bounce with a 403 packet → rung 4 anchors after the heading
- "transport error" → the write packet lands but the response dies → rung 5: a *read* packet fetches the page, a comparison card shows normalized-equal → green stamp `read_back_converged`.

**Beats:**
1. Clean run: rung 1 lights ("nothing changed, nothing written"). The most common outcome is the boring one; say so.
2. **PREDICT** (the WAF beat): "The firewall rejected the patch because of what the text says. What does the tool do?" — (a) give up and alert, (b) try a blunter write shape, (c) wait and retry the same thing.
3. Reveal: (b), rung 4 lights. Copy: "the request wasn't wrong. It was *unpalatable*. Rung four exists because arguing with a firewall is not a strategy."
4. Transport-error run → rung 5 → the "it landed, calm down" stamp. Name read-repair.

**Copy stub:** "Five ways to write one paragraph, tried politest-first. The ladder is what 'robust' actually looks like: not one perfect write, but a stack of acceptable ones."

## Act 5 — Drift and the dry run (anti-entropy as a flashlight)

**Teach:** dry-run as a diff between what-is and what-should-be; the preflight gate.

**Scene:** full world from all prior acts. New control: a **hand-edit** tool — the reader clicks any REMOTE field and scribbles over it (value flips to a wrong one, small pencil icon marks it). New button: **▶ dry run** (outlined, not filled — visual grammar: hollow = no writes).

**Sim rules:** dry run sends only *read* packets; each owned field compares and lights `clean` (dim) or `drift` (amber) with a tooltip showing local vs remote. Nothing on REMOTE changes. A status strip totals: `7 clean · 2 drift`. Then **▶ live run** is enabled ONLY if the dry pass had zero failures; it patches exactly the drifted fields.

**Beats:**
1. Reader vandalizes two fields, runs dry. Amber lights on exactly those two. **PREDICT** before live run: "The live pass rewrites — (a) everything, (b) the two drifted fields, (c) the whole page?" Reveal: (b), two surgical packets.
2. Break the preflight (toggle: "make one read fail") → live button stays disabled with the caption "a broken preflight never escalates to writes."
3. Manual-field vandalism: reader scribbles the ✍ Notes field → dry run shows... nothing. It's not owned; the system has no opinion. Copy: "the constitution cuts both ways: unowned means untouched, including your hand edits. That's a feature with a sharp edge."

**Copy stub:** "Run the whole thing dry and you get the most useful report infrastructure can produce: a map of everywhere the view has stopped telling the truth."

## Act 6 — Sandbox (chaos mode)

**Teach:** nothing new; consolidate by free play. Case's "sandbox mode" pattern.

**Scene:** everything unlocked, all toggles live, plus: event-burst slider (1-20 rows), a "rename remote page" injector (tests key-vs-title routing: key-carrying rows still route; a title-matched row goes to *visible purgatory* — a holding pen labeled "unrouted, retrying forever, nagging you"), and a **CHAOS** toggle that randomizes one failure per run.
**HUD:** `pages: n · duplicates: 0 · recovered: n · drift: n · unrouted: n`. The duplicates counter is the scoreboard; the whole piece has been arguing it should read zero.
**Exit copy:** one paragraph, then the essay link. Kicker mirrors the essay: "Rent the view. Own the truth."

---

## Build spec

- **Form:** one self-contained HTML page + one hand-written TS module compiled to a single JS file + one CSS file. No framework, no runtime deps (site constraint; also the Ciechanowski/Rose norm). Canvas NOT required — DOM+CSS transforms are enough at this entity count and keep text crisp/accessible.
- **Sim core (~300 lines):** tick loop via `requestAnimationFrame` gated to sim-speed; pure reducer `step(state, tick) → state`; acts = configs `{unlockedToggles, rules, predictBeat}` over the same core. Packet motion is presentational interpolation over reducer-emitted transitions (logic never reads positions).
- **Accessibility:** every animation state change mirrored to the event log (live region); `prefers-reduced-motion` → packets teleport with a 300ms fade; all toggles are real buttons; color states double-encoded (icon + color).
- **Mobile:** stack LOCAL over REMOTE, wire becomes vertical; verify with real device metrics via Playwright, not window-size flags (memory: headless `--window-size` doesn't emulate mobile layout).
- **Scroll vs stepper:** stepper (act tabs + next buttons), not scrollytelling — cheaper, robust on mobile, and the acts are discrete lessons.
- **Instrumentation of honesty:** the sim's reducer is the *actual algorithm shape* from `bridge-db-sync.ts`/`managed-markdown-sync.ts`, simplified but not falsified: same ordering (query→create→receipt), same rung order, same gate conditions. A footnote links each act to the real file so a skeptical reader can check.

## Build order (estimate ~4 sessions)

1. Sim core + Act 1 + Act 3 (they share rules; Act 3 is the thesis) — this alone is publishable as a v1.
2. Act 4 (ladder — the second unclaimed visual).
3. Acts 2 + 5 (mostly presentational variants of existing machinery).
4. Act 6 + polish + a11y + mobile pass + site integration (per `reference_portfolio_index_essay_source` conventions).

## Open calls for the operator

1. **Standalone page vs embedded in the essay?** Recommend: standalone interactive with the essay linking in per-act (site already has an "interactive explainers" shelf shape).
2. **Entity naming:** "Project A/B/C" (recommend) vs cheeky fake names.
3. **v1 scope:** ship Acts 1+3 first as "Part I" (fastest path to the unclaimed lane) vs hold for all six. Recommend ship-in-parts only if the essay ships simultaneously; otherwise hold.
