# fable-explore — Notion OS deep-dive session

> **Successor agents: read [HANDOFF.md](HANDOFF.md) first** — ordered next steps, merge order, gotchas, and what is reserved for Fable.

*Fable 5 exploration session, started 2026-07-10. Discovery → proposals → public material for saagarpatel.dev.*

## Integration reconciliation — 2026-07-11

- The four feature branches described below are merged into `main` from `codex/fable-integration-closeout-20260711`; verify `origin/main` live before relying on publication status.
- `fable-explore/` is tracked in the integration history; the historical untracked-material warning below is retained as incident provenance, not current branch state.
- `npm run verify` passes on the integrated head with 64 test files and 526 tests, followed by all build and install smoke checks. The earlier package-surface timeout did not reproduce.
- A direct read-only check confirms the live Build Log `Sync Key` property exists as `rich_text` and the remaining required properties match the integrated schema contract.
- The first real bridge-db sync proof completed for TradeOffAtlas event `5655`: bounded dry-run planned one write, live mode created one Build Log page, readback confirmed the exact sync key and relation with complete markdown, and BridgeDB attached a Notion receipt and marked the row `PROCESSED`.

The detailed sections below preserve the pre-integration exploration, review, and incident record. For current operator actions, use HANDOFF.md.

## Ground rules
- Public-safe = architecture + reasoning only; never real project/workspace contents.
- Code changes are drafted as proposals only — nothing pushed, no live Notion mutations.

## Contents

| File | What it is | Status |
|---|---|---|
| `01-core-reconciliation-findings.md` | Firsthand read of the reconciliation core: property diff-patch (control-tower), managed-section protocol + degradation ladder, bridge-db → Build Log receipt loop. Includes 6 rough edges found. | done |
| `02-publishing-pipeline.md` | Subagent map: TWO write pathways (generic Publisher vs managed-section engine), update strategies, fallback ladder, 10 rough edges | done |
| `03-governance-actuation.md` | Subagent map: dual-gate approval state machine (Approved + dry-run-earned Ready for Live), policies, idempotency keys, vestigial break-glass | done |
| `04-signals-intelligence.md` | Subagent map: provider→event pipeline, event-key dedup (no watermarks!), severity rules, recommendation scoring, 6 rough edges | done |
| `05-orchestrator-maintenance.md` | Subagent map: 6-lane weekly orchestrator w/ preflight→live gate, retry/timeout mechanics, hygiene passes, ~49-command surface | done |
| `06-interesting-things.md` | Synthesis: the thesis ("a reconciler that refuses to trust anything"), 10 interesting things ranked, the honest counter-story | done |
| `07-improvement-proposals.md` | 11 proposals in 3 tiers + PR sequencing. Headliners: idempotency keys for the build-log outbox (P1), single-call page creation (P2), durable signal watermarks (P3), Vercel dedup fix (P4), unified write verification (P6). | done |
| `08-public-material-plan.md` | The package: interactive explainer "One Writer, No Lies" (6 acts, predict-then-reveal, chaos sandbox), essay "You Don't Own Your Database" (betrayal→scar→pattern spine), 4-diagram set, build order. | done |
| `09-web-research.md` | Prior art + positioning: Notion API sync practice, reconciliation literature (outbox/idempotency/read-repair terms of art), interactive-explainer survey. Verdict: the single-writer/outbox/receipt lane has NO interactive treatment anywhere — open ground confirmed. | done |
| `10-essay-draft.md` | Essay draft 1: "You Don't Own Your Database" (~2,400 words, 8 sections, betrayal→scar→pattern spine, includes the double-write confession + fix). Zero em dashes, Light & Warm voice profile applied at write time. | done — awaiting operator voice read |
| `11-explainer-storyboard.md` | Full 6-act storyboard for "One Writer, No Lies": shared tick-based sim world, per-act rules + predict-then-reveal beats + copy stubs, build spec (vanilla TS, DOM-based, stepper not scrollytelling), ~4-session build order, 3 operator calls flagged. | done — awaiting operator review |
| `12-essay-review.md` | Corpus-rubrics review of the essay draft: PASS on structure/redundancy/naming; STRENGTHEN on steelman (the "why Notion at all vs a local dashboard" counter is half-answered — needs Saagar's real reason); 2 sentence-of-judgment fixes. Draft 2 fixes applied; steelman move left open for operator. | done |
| `13-pr3-unified-verification-design.md` | PR-3 design spec (P6): wire the existing `pageMarkdownMatches` equivalence into the Publisher's post-write readback (today it checks only truncation/unknown-block flags, never content). Expectation-per-mode table, `verifyWrites: warn\|fail\|off` knob, 7 test scenarios. Ready to delegate. | done — ready to delegate |
| `diagrams/` | Four public-safe, standalone SVGs: protocol taxonomy, managed-section write ladder, receipt loop/crash-window repair, and weekly preflight→live gate. Uses the explainer ledger palette, direct labels, accessible titles/descriptions, and no external dependencies. | done — local source assets only, unpublished |

## Code drafted for review

- **PR-1 (build-log idempotency, P1+P2 from file 07): READY FOR OPERATOR REVIEW.**
  Branch `feat/build-log-idempotency`, commit `5f358a2`, worktree `.claude/worktrees/agent-ad46b046f815b1b2f`. Not pushed, not merged.
  - 3 files, +520/-155 (~106 production lines, 414 test lines; 43/43 targeted tests, typecheck clean — both re-verified independently by the lead).
  - Full suite 473 pass / 1 fail; the failure (`package-surface` subprocess timeout) confirmed pre-existing on clean main by the lead.
  - **Deploy gate (operator action required before next sync run):** add a rich-text property named `Sync Key` to the live Build Log database. Until then, bridge-db sync fails loud by design (schema-drift error).
  - Review flags from lead's diff read: dry-run now performs one Notion read per unprocessed row (accuracy over speed, ~50 reads worst case); first live run after merge should use `--limit 1` to prove the single-call create payload against the real API.

## Delegated work in flight (dispatched 2026-07-11, delegation-first directive)

| Stream | Worker | Target | Status |
|---|---|---|---|
| Explainer v1 (sim core + Acts 1+3, per file 11 build spec) | Codex via codex-delegate | `fable-explore/explainer/` (new dir only) | **DONE, lead-verified** — built, wiped in the 00:02 incident, fully rebuilt: reconstructed TS compiles BYTE-IDENTICAL to the surviving pre-wipe dist (md5 match, re-verified by lead), check.mjs 2/2 re-run by lead, desktop render eyeballed by lead over HTTP (all sim UI initializes; note `type="module"` means file:// won't run it — serve via any local HTTP server). Wrapper's invented-structure list (page skeleton, most CSS palette vars, mobile axis rotation, reduced-motion body) documented in its report. Remaining: interactive click-through of all beats, mobile verify via Playwright device metrics, reduced-motion check, lead copy polish. |
| PR-2 (P3 watermarks + P4 Vercel dedup + P5 snapshot idempotency, per files 07/04) | Sonnet subagent, isolated worktree | branch `feat/signal-watermarks` | **DONE, lead-verified** — commit `137abb8`; 11 files +1958/-258 (`-w`; ~950 production, ~1000 test incl. new signal-watermarks suite); typecheck 0 + 108/108 targeted tests re-run by lead; agent's full-suite run 495/496 with only the known package-surface flake (re-passed in isolation). 4 documented ambiguity calls, all reasonable. Independent review found 2 Important issues, BOTH lead-confirmed on bytes vs main: (1) new 5000-row cap on the last-resort full-scan fallback is a correctness REGRESSION (main was unbounded) — silent false-creates past 5000 rows, defeats P4's own upsert; (2) status-upsert patch omits Raw Excerpt/Sync Run/Source URL → row self-contradicts after a transition. Review also confirmed clean: dry-run purity (watermark writes live-gated), day-granularity watermark safety, fail-open on corrupt/missing watermark file, identity-key stability, null-PR-count threading. Fixes landed in `23f4239` and re-verified by lead on bytes: cap constant fully removed (0 refs; contract locked by a 51-page/5,100-row behavioral test that fails under any re-capping), upsert payload now carries Raw Excerpt + Source URL + Sync Run (threaded syncRunId, asserted via toEqual). Typecheck 0 + 111/111 targeted re-run by lead. **DONE, review-clean.** |
| PR-4 (P8 config eviction, per files 07/05) | Codex via codex-delegate, isolated worktree | branch `chore/config-eviction` | **DONE, lead-verified** — commit `2fa66af`; 9 files +246/-62 (new `config/workspace-ids.json` + zod loader following the DestinationRegistry idiom); typecheck 0 + 38/38 tests re-run by lead; UUID grep clean (only the 2 intentional `blankDatabaseRef` sentinel files remain). Wrapper caught + corrected a real Codex idiom deviation (module-top-level await → in-function load). **Merge-order note: touches `bridge-db-sync.ts`, same as PR-1 — merge PR-1 first, PR-4 resolves.** |
| PR-3 (P6 unified verification, per file 13) | Sonnet subagent, isolated worktree | branch `feat/publisher-write-verification` | **DONE, review-clean, lead-verified** — commits `e9399c8` + `8ab1865` (+ `ac7c5bd` fixture rename). Review found 2 real issues (CRITICAL substring false-diverge; MAJOR page-state missing from fail-mode error), both lead-confirmed then fixed by the implementer; fixes re-verified by lead on bytes: `!normalizedReplacement.includes(normalizedSearch)` exemption + genuine-leftover case still diverges; AppError details carry pageId/pageUrl, asserted concretely. Typecheck 0 + 16/16 re-run by lead. Review with `git diff main...HEAD -w` (Biome noise). |

Lead (Fable) retains: verify-on-bytes review of each stream, essay voice pass (blocked on operator's "why Notion" sentence), explainer copy/interaction review post-build.

## Incident — 2026-07-11 00:02:28: fable-explore wiped by external `git reset --hard` + `git clean -fd`

- Everything untracked-but-not-ignored under the MAIN checkout was deleted (all 13 markdown files + 6 of 7 explainer files); `explainer/dist/` survived only because `dist/` is gitignored. Evidence: reflog `reset: moving to HEAD` with .git index/ORIG_HEAD mtimes at 00:02:28; worktrees and tracked files untouched.
- Prime suspect: a Codex worker from a DIFFERENT Claude session (GithubRepoAuditor refactor) that resumed at exactly 00:02 with workspace-write; its own controller's resume prompt contains "Do not touch fable-explore/." Neither of this session's agents had reset/clean in their history, and worktree agents cannot reach the main tree.
- Recovery: all 13 markdown files restored byte-faithfully by replaying Write/Edit tool calls from this session's transcript (script in session scratchpad). tsconfig.json + README.md restored verbatim from the build wrapper's context; remaining 4 explainer files being reconstructed from the surviving compiled artifact.
- Backups now maintained OUTSIDE the repo (session scratchpad tarballs). Standing decision for the operator: commit `fable-explore/` locally so session artifacts stop being `git clean`-vulnerable.

## Key architectural facts established so far

- Three reconciliation protocols by data shape: property diff-patch / marker-fenced section merge / at-least-once event drain with receipts.
- Single-writer-per-field ownership contract prevents property conflicts by partition.
- Managed-section writes degrade through 5 rungs, ending in read-back convergence ("write landed, ack lost" handling).
- Equality vs Notion is fuzzy by design — normalized-candidate comparison because block round-trip isn't byte-stable.
- Real-world constraint discovered: Notion's Cloudflare WAF 403-blocks some markdown patches *based on content*; the ladder exists partly because of this.
