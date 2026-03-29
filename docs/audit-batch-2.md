# Audit Batch 2

Updated: 2026-03-23

Evidence scope:
- Live scoped Notion writes to `Local Portfolio Projects` and `External Signal Sources` for this batch only
- Post-write read-only verification of `Local Portfolio Projects`, `Project Portfolio`, and `External Signal Sources`
- Local git branch, dirty-state, upstream, and path checks for the batch repos
- Targeted local command verification for `SpecCompanion`, `Chronomap`, `Echolocate`, and `Conductor`
- Targeted GitHub PR checks for `OrbitForge`, `ApplyKit`, `DesktopPEt`, `LoreKeeper`, and `CryptForge`
- No portfolio-wide sync commands, no destructive repo cleanup, and no GitHub writes

## 1. Executive summary

- Batch 2 audit and Notion-side remediation are complete.
- No exact-title duplicates were found between `Local Portfolio Projects` and `Project Portfolio` for this batch. `AI Workflow Accelerator` remains a fuzzy near-match in `Project Portfolio`, but it was not proven to be the same project as `AIWorkFlow`.
- Scoped remediation landed cleanly: stale placeholder source rows were paused, duplicate `ApplyKit` GitHub coverage was normalized, and every batch project row now has refreshed state/call/blocker truth with `Needs Review = false`.
- The biggest remaining issues are no longer control-tower ambiguity. They are local repo fragmentation, missing dependency baselines on a few JS projects, noisy PR/workflow surfaces, and unresolved merge/archive decisions.
- No project in this batch is fully set yet.

## 2. Verified complete projects

- None.

## 3. Findings by project

- `AIWorkFlow`: control-tower truth is now current, but the project still needs production deployment plus launch-polish closure before it can leave active build posture.
- `AssistSupport`: stale deployment placeholder was paused and the row is now accurate; remaining blockers are the dirty codex branch plus open-PR and failed-workflow noise.
- `IncidentMgmt`: row truth is normalized, but the repo-title mismatch with `saagpatel/IncidentManagement` and release/workflow cleanup still keep it from being fully set.
- `ModelColosseum`: moved to `Ready to Demo` and the stale deployment placeholder was paused; it now needs only demo/polish follow-through, not structural cleanup.
- `SignalDecay`: stale deployment placeholder was paused; the remaining issue is simply that the project is still very early and not close to fully set.
- `visual-album-studio`: row is accurate, but open PRs and recent failed workflows still keep the operating lane noisy.
- `ApplyKit`: support-lane cleanup is complete in Notion, but the canonical repo is still dirty and a second `.batch` repo surface still exists.
- `AuraForge`: row is accurate, but the root repo remains dirty and the duplicate `.batch` repo surface is still present.
- `IncidentReview`: row is accurate, but the root repo remains dirty, the `.batch` repo still exists, and workflow noise remains high.
- `SpecCompanion`: row now reflects reality, but `pnpm ui:gate:static` fails immediately because dependencies are missing; the duplicate `.batch` repo also still exists.
- `Chronomap`: blocker truth is now evidence-based; `pnpm typecheck` fails because the dependency baseline is missing, so stronger app-level verification is still blocked.
- `Conductor`: moved out of parked posture into `Active Build` based on a passing `xcodebuild` baseline; the remaining issue is defining the next real finish slice.
- `Echolocate`: blocker truth is now evidence-based; `pnpm lint` fails because `prettier` and the local dependency baseline are missing.
- `OrbitForge`: split-state is now explicit instead of ambiguous: base `OrbitForge` is a parked reference row merged into `OrbitForge (staging)`, and staging is the only active surface. Remaining work is on the staging repo baseline and any follow-on cleanup of the duplicate local surfaces.
- `TerraSynth`: archive posture is now normalized, but the repo is still dirty so the archive state is not operationally clean.
- `CryptForge`: row truth is now current, but the whitespace-prefixed folder, `legacy-origin` upstream naming, and PR/workflow noise still make it a decision-heavy finish candidate.
- `DeepTank`: row now correctly says the project needs a decision, but there is still no merge target recorded, so the `Merge` call cannot be executed yet.
- `DesktopPEt`: row truth is current and GitHub coverage is clean, but the main repo still uses `legacy-origin` and a second `DesktopPEt-ready` repo surface still splits local truth.
- `LoreKeeper`: stale deployment placeholder was paused and the legacy duplicate GitHub row remains safely paused; the remaining blocker is the repo’s missing upstream plus general finish-work cleanup.
- `PixelForge`: archive posture is now normalized, but the repo is still dirty and workflow noise remains high.

## 4. Cross-project systemic issues in this batch

- Notion/source hygiene is much healthier now. Remaining duplicate or historical source rows are paused rather than competing with the active operating lane.
- The main unresolved pattern is local repo fragmentation: dirty codex branches, duplicate worktrees, and inconsistent upstream naming.
- Missing dependency baselines still block stronger verification for `SpecCompanion`, `Chronomap`, and `Echolocate`, and likely the next verification pass for `OrbitForge (staging)`.
- Workflow and PR noise still obscures readiness on several otherwise-healthy projects, especially `AssistSupport`, `IncidentMgmt`, `IncidentReview`, and `visual-album-studio`.
- A few projects still need real portfolio decisions rather than more bookkeeping: `DeepTank` needs a merge target, and the duplicate local surfaces around `OrbitForge`, `DesktopPEt`, `ApplyKit`, `AuraForge`, `IncidentReview`, and `SpecCompanion` still need final canonicalization.

## 5. Implementation plan

- Completed in this pass:
  - Paused stale source rows for `ApplyKit`, `AssistSupport`, `ModelColosseum`, `SignalDecay`, and `LoreKeeper`
  - Paused the stale duplicate `ApplyKit - GitHub Repo` row and kept the canonical active `ApplyKit GitHub Repo` row
  - Refreshed batch project rows with current state, portfolio call, blocker text, test posture, confidence, local path, and `Date Updated`
  - Cleared `Needs Review` across the batch where current evidence supported it
  - Reclassified `Conductor`, `ModelColosseum`, `OrbitForge`, `CryptForge`, `DeepTank`, `TerraSynth`, and `PixelForge` into more accurate operating postures
- Remaining follow-on work is repo-level, not control-tower-level:
  - Canonicalize duplicate local repo surfaces
  - Restore dependencies and rerun checks where the current blocker is install-state
  - Triage PR/workflow noise on the highest-signal active projects
  - Make the unresolved merge/archive decisions explicit where the row still depends on them

## 6. Recommended execution order

1. Canonical local repo cleanup:
   `ApplyKit`, `AuraForge`, `IncidentReview`, `SpecCompanion`, `DesktopPEt`, `CryptForge`
2. Dependency baseline restore and rerun of blocked checks:
   `SpecCompanion`, `Chronomap`, `Echolocate`, `OrbitForge (staging)`
3. PR/workflow hygiene on active finish lanes:
   `AssistSupport`, `IncidentMgmt`, `visual-album-studio`, `LoreKeeper`
4. Decision and archive resolution:
   `DeepTank`, `OrbitForge`, `TerraSynth`, `PixelForge`
5. Finish/polish follow-through on healthier projects:
   `AIWorkFlow`, `ModelColosseum`, `Conductor`, `SignalDecay`

## 7. Blockers

- Dirty worktrees and duplicate repo surfaces cannot be normalized safely without repo-by-repo cleanup that preserves existing user work.
- Missing dependency installs currently block stronger static verification on `SpecCompanion`, `Chronomap`, and `Echolocate`.
- `DeepTank` still lacks a confirmed merge target.
- `AI Workflow Accelerator` remains the only fuzzy backlog near-match worth manual confirmation before any future duplicate-removal step.

## 8. Done definition for this batch

- Batch done means the operating truth is accurate and current even if the underlying projects still have execution work left.
- This pass is complete when each batch project has one current operating row, no active stale placeholder source row, one canonical active GitHub source row, and evidence-based blocker/readiness text.
- Those conditions are now met for the Notion-side audit/remediation lane.
- Separate repo cleanup, dependency restoration, release work, and merge/archive decisions are still required before any individual project can be considered fully set.
