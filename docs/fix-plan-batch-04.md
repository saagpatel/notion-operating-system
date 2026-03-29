# Batch 04 Fix Plan

## 1. Executive Summary

This record covers only `PersonalKBDrafter`, `ScreenshotAnnotate`, `DevToolsTranslator`, `GPT_RAG`, and `JobCommandCenter`.

Verified on 2026-03-24 against current local repo state and live GitHub state, with the 2026-03-23 read-only Notion placement audit retained as the latest database-placement source of truth:

- All five projects exist exactly once in `Local Portfolio Projects`.
- Zero exact-title matches exist in `Project Portfolio` for these five projects.
- All five have an active canonical GitHub repo source mapped to the `saagpatel/*` repo.
- All five already have governed GitHub-lane activity in Notion.

The remaining work is much narrower than the earlier batch notes suggested. Local repo-surface cleanup is now done for all five projects. The batch is now mainly blocked by three things: environment-specific runtime prerequisites (`PersonalKBDrafter` credentials and saved state, `GPT_RAG` models and reranker assets), narrower GitHub-lane reconciliation and governance follow-up (`ScreenshotAnnotate`, `DevToolsTranslator`, `JobCommandCenter`), and missing live Notion auth for final truth refreshes. No project in this batch is fully exception-free yet, so there are still no fully verified-complete projects for the batch record.

## 2. Projects With Findings

### PersonalKBDrafter

- Local verification is now strong: `npm run check:prereqs`, `npm run lint`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` all passed on 2026-03-24.
- This machine cannot run the real credential-backed drafting happy path yet: Keychain lookups for `kb-drafter-jira` and `kb-drafter-confluence` are missing, `app_settings` has no saved rows, and the local article table is empty.
- GitHub is still live with unresolved noise: `main` has failed `CI` run `23396324744` from 2026-03-22 and 2 open Dependabot PRs.
- Notion truth is likely stale relative to current confidence: the local run evidence is now stronger than the current recorded posture.

### ScreenshotAnnotate

- Local repo surface is clean again after removing build-generated schema formatting noise.
- Local verification is green: `npm test -- --run`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml` all passed on 2026-03-24, with 11 Rust tests green.
- GitHub still has 1 open Dependabot PR.
- The latest live governed GitHub execution still needs reconciliation, and live Notion truth has not been refreshed yet.

### DevToolsTranslator

- Local repo surface is normalized now: `SESSION-PLAN.md` is ignored scratch, not an active ambiguity.
- Current readiness truth still depends on the remaining release blocker slice, not on missing setup.
- Recent `release-extension-stage-controller` runs on `main` succeeded on 2026-03-23 and 2026-03-24.
- The latest governed issue-refresh execution still needs reconciliation before Notion truth is called current.

### GPT_RAG

- Local dev setup is restored: `uv sync --extra dev` completed, the local app data paths and required SQLite tables exist, and the repo scratch state is normalized for future sessions.
- The CLI module entrypoint was fixed so `python -m gpt_rag.cli doctor --json` now emits diagnostics instead of exiting silently.
- `doctor --json` reports `runtime_ready: false` because the required local Ollama models (`qwen3-embedding:4b`, `qwen3:8b`) are unavailable and the reranker dependencies plus cache snapshot are missing.
- `runtime-check --json` now fails for the expected reason with `status: "not_ready"` rather than a setup ambiguity.

### JobCommandCenter

- Local verification unlocked a real repo fix: `npm install` repaired the stale lockfile mismatch, producing a tracked `package-lock.json` refresh.
- `npm run build` now passes on 2026-03-24. The build still reports a CSS `file` property warning and a large-chunk warning, but it completes successfully.
- The Python sidecar was verified end to end: `/health` returned `ok`, and `/submit/batch` dry-run against a local generic form fixture returned `status: "dry_run"` with `resume_uploaded: true`.
- GitHub default branch is still `polish/v1.0-improvements`, which may be intentional but still needs an explicit decision, and the project still has 1 open PR plus governed-lane reconciliation history to close out.

## 3. Exact Fixes Needed

- `PersonalKBDrafter`: run one real credential-backed drafting happy-path proof on a machine with saved Jira and Confluence credentials plus populated local app settings, triage failed `CI` run `23396324744` and the 2 open Dependabot PRs, then refresh Notion fields from the verified result.
- `ScreenshotAnnotate`: reconcile the latest live GitHub execution and remaining open PR, then refresh Notion fields from the verified local result.
- `DevToolsTranslator`: confirm the current release-readiness blocker slice is still the right next move, reconcile the latest governed issue-refresh execution, then refresh Notion only if the verified counts or blocker text changed.
- `GPT_RAG`: install the reranker extra and cache snapshot, install or point to the required local Ollama models, rerun `runtime-check --json`, then refresh Notion only if the verified blocker text changed.
- `JobCommandCenter`: land the `package-lock.json` refresh in the normal repo flow, decide whether `polish/v1.0-improvements` should remain the operating default branch, reconcile the open PR plus any still-material governed mismatch history, then refresh Notion from the verified result.

No current fix is needed for wrong-database placement or exact-title duplicate rows in `Project Portfolio` for this batch.

## 4. Recommended Execution Order

1. `GPT_RAG`: smallest remaining fix slice and the clearest path to a stronger runtime-ready proof.
2. `PersonalKBDrafter`: strongest local verification is already in place, but the real happy path still needs a credential-backed environment.
3. `JobCommandCenter`: verified build and sidecar proof are now in place, so the remaining work is governance, PR, and Notion-lane closure.
4. `ScreenshotAnnotate`: local proof is done; remaining work is GitHub-lane reconcile plus Notion refresh.
5. `DevToolsTranslator`: local surface is already clean, so this is now mainly a release-truth and governed-execution reconcile pass.
6. Re-audit only these five projects and rewrite this markdown file plus the JSON summary so they reflect the verified post-fix state.

## 5. Blockers

- `NOTION_TOKEN` is still missing in the current shell, so live Notion truth cannot be refreshed from this workspace yet.
- `PersonalKBDrafter` manual happy-path proof still requires saved `kb-drafter-jira` and `kb-drafter-confluence` credentials plus non-empty local app settings.
- `GPT_RAG` runtime proof still requires the local Ollama models `qwen3-embedding:4b` and `qwen3:8b` plus reranker dependencies and a reranker cache snapshot.
- `JobCommandCenter` default-branch posture may be intentional and should still be treated as a decision, not auto-corrected blindly.
- Pending or mismatched execution reconciliation may still require comparing Notion execution records with live GitHub issue or PR state before closing the lane-health findings.

## 6. Done Definition

- All five projects still exist exactly once in `Local Portfolio Projects` and zero times in `Project Portfolio`.
- Each project has one active canonical GitHub repo source, and any paused placeholders are clearly intentional and non-blocking.
- Local repo surface is normalized in place for all five projects, with no ambiguous dirty or untracked state left in the active execution slice.
- GitHub truth and Notion truth agree on PR posture, workflow posture, readiness state, and blocker text for each project.
- The latest governed GitHub execution is reconciled for every project that currently shows `Pending` or material `Mismatch` status.
- `/Users/d/Notion/docs/fix-plan-batch-04.md` and `/Users/d/Notion/docs/fix-plan-batch-04-summary.json` match the same verified batch state.
