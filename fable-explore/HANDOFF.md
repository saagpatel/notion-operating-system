# HANDOFF — Notion OS deep-dive integration closeout

*Written 2026-07-11 by Fable at session close and reconciled by Codex after local integration verification. Read INDEX.md next for the exploration ledger and historical review detail.*

## Ground rules (inherited from the operator, still binding)

1. **Nothing is pushed and nothing merges to `main` without the operator's explicit go.** The four feature lines are locally integrated only.
2. **No live Notion writes** while working on this material. Dry-run is the repo default; keep it that way.
3. Public material (essay/explainer) is architecture-and-reasoning only — never real project names, workspace contents, or personal data beyond what's already in the drafts.
4. Review large diffs with `git diff main...HEAD -w` — a Biome format-on-save hook inflates raw diffs with whole-file re-indents.

## Current integration state

- `main` and `origin/main` remain aligned before this work.
- `docs/fable-explore-session` contains the Fable material plus all four feature lines in the required merge order.
- Closeout work continues on `codex/fable-integration-closeout-20260711` in a dedicated worktree created from that integration head.
- The original checkout still owns the unrelated dirty `config/local-portfolio-control-tower.json` metrics refresh. That file is not part of the integration or closeout branch.
- All four feature branch tips are ancestors of the integration head. Their worktrees and branches have not been pruned because the integration has not been approved for `main`.

## Verified deliverables

| # | Deliverable | Where | Commits | Verified |
|---|---|---|---|---|
| 1 | PR-1 build-log idempotency (sync key + single-call create) | branch `feat/build-log-idempotency`, worktree `.claude/worktrees/agent-ad46b046f815b1b2f` | `5f358a2` | typecheck 0, 43/43 |
| 2 | PR-2 signal watermarks + Vercel identity-upsert + snapshot idempotency | branch `feat/signal-watermarks`, worktree `.claude/worktrees/agent-a5faf21cda9fdef9a` | `137abb8` + `23f4239` (review fixes) | typecheck 0, 111/111 |
| 3 | PR-3 publisher write verification (`verifyWrites: warn\|fail\|off`) | branch `feat/publisher-write-verification`, worktree `.claude/worktrees/agent-a1746f140fad52429` | `e9399c8` + `8ab1865` + `ac7c5bd` (review fixes) | typecheck 0, 16/16 |
| 4 | PR-4 config eviction (hardcoded Notion UUIDs → `config/workspace-ids.json`) | branch `chore/config-eviction`, worktree `.claude/worktrees/agent-aace128a109cc699a` | `2fa66af` | typecheck 0, 38/38, UUID grep clean |
| 5 | Interactive explainer ("One Writer, No Lies") | `fable-explore/explainer/` (tracked, self-contained) | integration branch | TypeScript compile clean, check.mjs 6/6 |

PR-2 and PR-3 each went through an independent code review; 4 real findings total, all fixed and re-verified. Full finding details remain in INDEX.md.

Current integrated verification: `npm run verify` passes with 64 test files and 526 tests, followed by build, built-CLI smoke, packed-install smoke, and git-install smoke. The earlier package-surface timeout note is historical and did not reproduce on the integrated head. Governance health is healthy with zero warnings, governance audit passes, repo doctor passes, and BridgeDB status is healthy.

The explainer also passes its own build and six deterministic reducer scenarios:

```sh
npx tsc -p fable-explore/explainer/tsconfig.json
node fable-explore/explainer/check.mjs
```

## Operator decisions pending (blockers for the steps below)

A. Approve or reject the local integration for `main`.
B. **Resolved.** The live Build Log schema has `Sync Key` as `rich_text`, and the bounded TradeOffAtlas event `5655` proof completed dry-run → live → readback with a receipt-backed `PROCESSED` state.
C. Storyboard calls (file 11 §"Open calls"): standalone page vs embedded; entity naming (recommend "Project A/B/C" — already built that way); ship Acts 1+3 as Part I vs hold for all six.
E. Supply the "why Notion specifically vs a local dashboard" sentence for the essay (file 12, Dim 3). **Do not invent this — it must be the operator's real answer.**

## Next steps, in order (all delegable, none needs Fable)

1. **Review the local integration.** The required merge order has already been exercised locally and the full integrated verifier is green. Do not merge to `main` or push without operator approval.
2. **Decide branch disposition.** The first external proof is complete: TradeOffAtlas event `5655` created one Build Log page with the correct sync key and relation, readback was complete, and BridgeDB recorded the receipt. Merge and push remain separately gated by operator approval.
3. **Explainer QA.** (a) Interactive click-through of every beat in Acts 1 and 3 including predict-then-reveal and all three failure toggles; (b) mobile pass — MUST use Playwright with real device metrics (headless Chrome `--window-size` does not emulate mobile layout; known trap); (c) reduced-motion check (`prefers-reduced-motion` → packets teleport with fade). Serve over HTTP (`python3 -m http.server` in `explainer/`) — it's an ES module; file:// will not execute.
4. **Explainer Acts 2, 4, 5, 6** per the storyboard (file 11): sessions 2-4 of its build order. Act 4 (the fallback ladder) is the second unclaimed visual and the priority. Same sim core; acts are config + copy + small rule additions. Keep the deterministic-reducer contract (no Date.now/Math.random in logic) and keep check.mjs growing with a scenario per act.
5. **Diagram set** (file 08 §Piece 3, four diagrams) once the essay/explainer near shipping.
6. **Site integration** when the operator says ship: follow the operator's memory note `reference_portfolio_index_essay_source` (source under `scripts/sources/session-NN`, register in build-writing SOURCES+CLUSTERS, full canonical build sequence, 2-commit date settle, verify via `vercel inspect`).

## Reserved for Fable (do NOT do these)

- The essay's final voice pass (after the operator supplies the sentence for decision E). Draft 2 is at `10-essay-draft.md`; the review that governs remaining edits is `12-essay-review.md`. The essay's voice is calibrated (zero em dashes anywhere, Light & Warm profile, no AI tells) — a mechanical editor will degrade it.
- Any rewrite of explainer beat copy beyond the storyboard stubs (same voice constraint). Building new acts with the existing stubs is fine; polishing prose is not.

## Incident warning (read before relying on anything untracked)

At 2026-07-11 00:02:28, an external `git reset --hard` + `git clean -fd` wiped everything untracked-but-not-ignored in the main checkout, including all of `fable-explore/`. The material was fully recovered. It is now tracked on the local integration branch, so the old session-scoped tarball instruction is no longer the active safety path. Keep the dedicated integration worktree until branch disposition is approved.

## File map

Everything lives in `/Users/d/Projects/Notion/fable-explore/`: `INDEX.md` (ledger — read second), `01`-`06` findings, `07` improvement proposals (P1-P11; P7/P9-P11 not yet implemented — future PR-5 material), `08` public-material plan, `09` web research, `10` essay draft 2, `11` explainer storyboard (the spec for step 4), `12` essay review, `13` PR-3 design spec, `explainer/` (the built artifact).
