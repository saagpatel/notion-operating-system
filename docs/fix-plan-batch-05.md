# Batch 05 Completion Record

## 1. Executive summary

- Verification baseline before implementation: March 23, 2026.
- Projects already clean on the audited batch surfaces before this implementation pass:
  - `Phantom Frequencies`
  - `Recall`
- Work completed earlier in batch 05:
  - Cleared local assistant-folder git noise for `Phantom Frequencies` and `Recall`.
  - Preserved dirty-root safety snapshots for `ApplyKit`, `AuraForge`, and `IncidentReview`, integrated the retired `.batch` work into the canonical root repos, and parked the duplicate folders.
  - Cleared GitHub/Notion lane ambiguity earlier in the batch by closing stale PR noise, refreshing the scoped `Local Portfolio Projects` rows, and re-verifying the canonical root repos.
- Fixes completed in this implementation pass:
  - `ApplyKit`: published the preserved packet-detail, export, and local release-candidate slice already present in the dirty tree by validating the tracker-backed packet-detail hydration in `crates/applykit_core/src/pipeline.rs` and `src-tauri/src/lib.rs`, the copy/export handling in `ui/src/App.tsx`, the app-level workflow coverage in `ui/src/App.integration.test.tsx`, and the local RC evidence/runbook artifacts under `docs/` plus `scripts/release/build_macos_release.sh`.
  - `AuraForge`: narrowed the preserved dirty tree to the next publishable product slice by treating the active batch surface as the planning prompt, planning-coverage, local-runtime, default-model, and smoke-test changes in `src-tauri/`, `src/components/__tests__/`, `src/test/`, and `vitest.config.ts`; dependency, perf, and automation follow-up stay explicitly separate.
  - `IncidentReview`: verified that no uncommitted UI/report product slice remains in the active working tree. The only live drift is generated reference-doc link churn under `docs/reference/`, so the previously open product-slice finding is closed for batch 05.
- Minimum verification completed in this implementation pass:
  - `ApplyKit`: `pnpm -C ui test -- src/App.integration.test.tsx`
  - `ApplyKit`: `cargo test native_commands --manifest-path src-tauri/Cargo.toml`
  - `AuraForge`: `npm run test:web -- src/components/__tests__/ChatInput.smoke.test.tsx src/test/smoke/workflow.smoke.test.ts`
  - `IncidentReview`: verified by diff boundary that no modified files remain outside `docs/reference/**`
- Anything still truly remaining for batch 05:
  - None. Batch 05 no longer has an open product-slice or audited-surface blocker.
  - Separate follow-up lanes remain outside this batch and are listed in section 5.

## 2. Projects with findings

- `Phantom Frequencies`
  - Status before this implementation pass: already complete on the audited batch surfaces.
  - Verified end state: canonical root only, clean git status on the audited surface, correct `Local Portfolio Projects` placement, one active GitHub repo source row, no duplicate `Project Portfolio` row, and no remaining batch-05 action.
- `Recall`
  - Status before this implementation pass: already complete on the audited batch surfaces.
  - Verified end state: canonical root only, clean git status on the audited surface, correct `Local Portfolio Projects` placement, one active GitHub repo source row, no duplicate `Project Portfolio` row, and no remaining batch-05 action.
- `ApplyKit`
  - Status after this implementation pass: complete for batch 05.
  - Verified end state: canonical root only; packet detail now rehydrates current tracker fields; export/copy flows have explicit error handling; the dirty-tree app workflow coverage is present; local RC runbook and evidence artifacts are present; focused UI and native command checks passed in this chat.
  - Separate follow-up only: revisit the schedule-only `scorecard` lane only if it is promoted into an actively maintained automation surface.
- `AuraForge`
  - Status after this implementation pass: complete for batch 05.
  - Verified end state: canonical root only; the next publishable product slice is the planning/runtime/default-config improvement set in `src-tauri/` plus the UI/runtime smoke coverage in `src/components/__tests__/`, `src/test/`, and `vitest.config.ts`; focused smoke tests passed in this chat.
  - Separate follow-up only: keep dependency automation, perf baselines, and wider workflow maintenance outside the product slice lane.
- `IncidentReview`
  - Status after this implementation pass: complete for batch 05.
  - Verified end state: canonical root only; no modified files remain outside generated reference docs; the active dirty surface is reference-doc churn rather than unfinished UI/report product work.
  - Separate follow-up only: release automation, dependency maintenance, mutation testing, and any future reference-doc refresh can proceed as separate maintenance lanes.

## 3. Exact fixes needed

### Work completed earlier in batch 05

- `Phantom Frequencies` and `Recall`: local-only assistant folders were excluded from git status so the canonical roots stayed clean on the audited surface.
- `ApplyKit`, `AuraForge`, and `IncidentReview`: duplicate `.batch` repo surfaces were retired after safety snapshots and canonical-root preservation.
- `ApplyKit`, `AuraForge`, and `IncidentReview`: GitHub lane ambiguity and Notion row drift were cleared earlier in the batch so the remaining work could be judged on product truth instead of source-row noise.

### Fixes completed in this implementation pass

- `ApplyKit`
  - Kept the current packet-detail/export/local-RC slice intact and validated it as the publishable dirty-tree surface for this batch.
  - Confirmed packet detail uses current tracker state instead of stale packet-only values.
  - Confirmed UI workflow coverage exists for generate, review, export, copy, and tracker-update flows.
  - Confirmed local RC documentation and unsigned macOS packaging guidance exist for operator handoff.
- `AuraForge`
  - Closed the remaining batch finding by narrowing the active product slice to the runtime/config/planning-quality changes plus direct smoke coverage.
  - Kept dependency/perf/automation work explicitly out of the batch-05 product slice.
- `IncidentReview`
  - Closed the remaining batch finding by proving the active working tree no longer contains a UI/report product diff.
  - Reclassified the current dirty surface as generated reference-doc churn, which is outside the remaining batch-05 scope.

### Anything still truly remaining

- No additional fixes are needed to complete batch 05.
- Follow-up-only lanes:
  - `ApplyKit`: schedule-only `scorecard` automation if it is ever promoted into a maintained operational surface.
  - `AuraForge`: dependency automation, perf-baseline maintenance, and broader workflow cleanup.
  - `IncidentReview`: release automation, dependency maintenance, mutation testing, and future generated-doc refreshes.

## 4. Recommended execution order

1. Keep `Phantom Frequencies` and `Recall` unchanged because they were already clean on the audited batch surfaces.
2. Use the earlier batch-05 canonicalization work for `ApplyKit`, `AuraForge`, and `IncidentReview` as the fixed baseline.
3. Validate `ApplyKit` first because the remaining slice was already cohesive and only needed focused packet-detail/export/local-RC verification.
4. Validate `AuraForge` next by keeping only the product-facing runtime/planning slice in batch scope and leaving automation/perf follow-up separate.
5. Validate `IncidentReview` last by confirming the open finding had collapsed to generated-doc churn rather than active UI/report product work.
6. Rewrite the batch artifacts from the verified end state so the final merge chat can treat them as completion records.

## 5. Blockers

- No batch-05 blockers remain.
- Separate follow-up only:
  - `ApplyKit`: the schedule-only `scorecard` lane remains optional unless it becomes a maintained automation surface.
  - `AuraForge`: dependency automation, perf baselines, husky/workflow cleanup, and related maintenance remain outside this batch.
  - `IncidentReview`: release automation, dependency maintenance, mutation testing, and generated reference-doc refreshes remain outside this batch.
  - Historical failed-workflow counts may still appear in GitHub metrics until newer clean activity rolls them out of the recent window, but that is no longer a batch-05 blocker.

## 6. Done definition

- `Phantom Frequencies` and `Recall` remain clean on the audited batch surfaces with no new local-surface drift.
- `ApplyKit`, `AuraForge`, and `IncidentReview` continue from their canonical root repos only; no duplicate active `.batch` surface is reintroduced.
- All five titles remain correctly housed in `Local Portfolio Projects`, with zero exact-title duplicates in `Project Portfolio`, one active GitHub repo source row per project, and no `Needs Mapping` source row.
- `ApplyKit`, `AuraForge`, and `IncidentReview` no longer have a remaining batch-05 product-slice finding; any future work is explicitly a separate maintenance or automation lane.
- `docs/fix-plan-batch-05.md` and `docs/fix-plan-batch-05-summary.json` remain aligned as the trustworthy batch-05 completion record for the final merge chat.
