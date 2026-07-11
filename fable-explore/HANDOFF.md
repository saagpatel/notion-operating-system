# HANDOFF — Notion OS deep-dive session (Fable → successor agent)

*Written 2026-07-11 by Fable at session close. Successor: any capable agent (Codex/Opus/Sonnet). Read INDEX.md next — it is the ledger; every claim below is expanded there.*

## Ground rules (inherited from the operator, still binding)

1. **Nothing is pushed and nothing merges without the operator's explicit go.** All four branches below are local-only proposals.
2. **No live Notion writes** while working on this material. Dry-run is the repo default; keep it that way.
3. Public material (essay/explainer) is architecture-and-reasoning only — never real project names, workspace contents, or personal data beyond what's already in the drafts.
4. Review large diffs with `git diff main...HEAD -w` — a Biome format-on-save hook inflates raw diffs with whole-file re-indents.

## State: five verified deliverables, zero known defects

| # | Deliverable | Where | Commits | Verified |
|---|---|---|---|---|
| 1 | PR-1 build-log idempotency (sync key + single-call create) | branch `feat/build-log-idempotency`, worktree `.claude/worktrees/agent-ad46b046f815b1b2f` | `5f358a2` | typecheck 0, 43/43 |
| 2 | PR-2 signal watermarks + Vercel identity-upsert + snapshot idempotency | branch `feat/signal-watermarks`, worktree `.claude/worktrees/agent-a5faf21cda9fdef9a` | `137abb8` + `23f4239` (review fixes) | typecheck 0, 111/111 |
| 3 | PR-3 publisher write verification (`verifyWrites: warn\|fail\|off`) | branch `feat/publisher-write-verification`, worktree `.claude/worktrees/agent-a1746f140fad52429` | `e9399c8` + `8ab1865` + `ac7c5bd` (review fixes) | typecheck 0, 16/16 |
| 4 | PR-4 config eviction (hardcoded Notion UUIDs → `config/workspace-ids.json`) | branch `chore/config-eviction`, worktree `.claude/worktrees/agent-aace128a109cc699a` | `2fa66af` | typecheck 0, 38/38, UUID grep clean |
| 5 | Interactive explainer v1, Acts 1+3 ("One Writer, No Lies") | `fable-explore/explainer/` (7 files, self-contained) | n/a (untracked) | tsc 0, check.mjs 2/2, desktop render verified |

PR-2 and PR-3 each went through an independent code review; 4 real findings total, all fixed and re-verified. Full finding details in INDEX.md.

Verification commands: `npm run typecheck`; `npx vitest run <test files>`; full `npm test` has ONE pre-existing flake (`tests/package-surface.test.ts` subprocess timeout — fails on clean main too; passes in isolation). Only that failure is acceptable.

## Operator decisions pending (blockers for the steps below)

A. Approve/reject each PR branch after review.
B. One-time manual Notion action for PR-1: add a rich-text property named `Sync Key` to the live Build Log database. Until then bridge-db sync fails loud by design (schema gate).
C. Storyboard calls (file 11 §"Open calls"): standalone page vs embedded; entity naming (recommend "Project A/B/C" — already built that way); ship Acts 1+3 as Part I vs hold for all six.
D. Commit `fable-explore/` locally (recommended — see Incident below) or keep untracked with external tarball backups.
E. Supply the "why Notion specifically vs a local dashboard" sentence for the essay (file 12, Dim 3). **Do not invent this — it must be the operator's real answer.**

## Next steps, in order (all delegable, none needs Fable)

1. **Merges (after operator approval).** Order matters: PR-1 first, then PR-4 (both touch `src/notion/bridge-db-sync.ts` — PR-4 takes a small conflict resolution: its change there is loading IDs from `WorkspaceIds` config), then PR-2 and PR-3 in either order (independent files). Merge to a local integration branch or main per operator's instruction; run full `npm test` after each merge; nothing pushes without the operator.
2. **PR-1 first live run** after merge + Sync Key property: use `--limit 1` to prove the single-call create payload against the real Notion API before a full drain.
3. **Explainer QA.** (a) Interactive click-through of every beat in Acts 1 and 3 including predict-then-reveal and all three failure toggles; (b) mobile pass — MUST use Playwright with real device metrics (headless Chrome `--window-size` does not emulate mobile layout; known trap); (c) reduced-motion check (`prefers-reduced-motion` → packets teleport with fade). Serve over HTTP (`python3 -m http.server` in `explainer/`) — it's an ES module; file:// will not execute.
4. **Explainer Acts 2, 4, 5, 6** per the storyboard (file 11): sessions 2-4 of its build order. Act 4 (the fallback ladder) is the second unclaimed visual and the priority. Same sim core; acts are config + copy + small rule additions. Keep the deterministic-reducer contract (no Date.now/Math.random in logic) and keep check.mjs growing with a scenario per act.
5. **Diagram set** (file 08 §Piece 3, four diagrams) once the essay/explainer near shipping.
6. **Site integration** when the operator says ship: follow the operator's memory note `reference_portfolio_index_essay_source` (source under `scripts/sources/session-NN`, register in build-writing SOURCES+CLUSTERS, full canonical build sequence, 2-commit date settle, verify via `vercel inspect`).

## Reserved for Fable (do NOT do these)

- The essay's final voice pass (after the operator supplies the sentence for decision E). Draft 2 is at `10-essay-draft.md`; the review that governs remaining edits is `12-essay-review.md`. The essay's voice is calibrated (zero em dashes anywhere, Light & Warm profile, no AI tells) — a mechanical editor will degrade it.
- Any rewrite of explainer beat copy beyond the storyboard stubs (same voice constraint). Building new acts with the existing stubs is fine; polishing prose is not.

## Incident warning (read before relying on anything untracked)

At 2026-07-11 00:02:28, an external `git reset --hard` + `git clean -fd` (prime suspect: a Codex worker from a DIFFERENT session with workspace-write) wiped everything untracked-but-not-ignored in this repo's main checkout, including all of `fable-explore/`. Fully recovered (transcript replay + compile-back reconstruction; explainer TS re-compiles byte-identical to the pre-wipe artifact). Lessons: worktrees and tracked files were untouched; gitignored files were untouched. **Until fable-explore/ is committed (decision D), refresh the external tarball after every meaningful change:** `tar czf /private/tmp/claude-501/-Users-d/9fdc44fa-f2e3-428f-bc69-ee1130253ec9/scratchpad/fable-explore-backup-<label>.tgz -C /Users/d/Projects/Notion/fable-explore .` (note: that scratchpad dir is session-scoped tmp — if this handoff outlives it, choose a fresh backup location outside the repo first).

## File map

Everything lives in `/Users/d/Projects/Notion/fable-explore/`: `INDEX.md` (ledger — read second), `01`-`06` findings, `07` improvement proposals (P1-P11; P7/P9-P11 not yet implemented — future PR-5 material), `08` public-material plan, `09` web research, `10` essay draft 2, `11` explainer storyboard (the spec for step 4), `12` essay review, `13` PR-3 design spec, `explainer/` (the built artifact).
