# Master Fix-Plan Merge Refresh

## Executive summary

- This master refresh is rebuilt from the current `fix-plan-batch-01` through `fix-plan-batch-10` artifacts, the dedicated audit-gap follow-up packet, the three bucket follow-up packets, and the available implementation follow-up packets.
- Later implementation packets override earlier planning packets when they prove a project is closed.
- The merged state now separates 47 projects that are closed or intentionally preserved from 7 projects that still have real follow-up.
- The mixed local-project-plus-GitHub bucket is closed based on `docs/followup-mixed-local-github-implementation.md` and `docs/followup-mixed-local-github-implementation-summary.json`.
- The GitHub/workflow/governance bucket is now mostly closed based on `docs/followup-github-governance-implementation.md` and `docs/followup-github-governance-implementation-summary.json`; only `DevToolsTranslator` and `JobCommandCenter` still remain in that lane.
- `OPscinema` improved materially, but it is still not fully closed because the packaged smoke checklist is not yet fully stable after export.

## Consolidated remaining fixes

### Already completed in prior batch chats

- `SpecCompanion`
- `DeepTank`
- `AIWorkFlow`
- `AI Workflow Accelerator`
- `job-search-2026`
- `OrbitForge`
- `PomGambler`
- `SynthWave`
- `TerraSynth`
- `PixelForge`
- `knowledgecore`
- `IncidentWorkbench`
- `Phantom Frequencies`
- `Recall`
- `ApplyKit`
- `AuraForge`
- `IncidentReview`
- `DesktopPEt`
- `OrbitForge (staging)`
- `SmartClipboard`
- `TicketDashboard`
- `Chronomap`
- `Echolocate`
- `DatabaseSchema`
- `LegalDocsReview`
- `EarthPulse`
- `AssistSupport`
- `IncidentMgmt`
- `visual-album-studio`
- `SignalDecay`
- `Conductor`
- `WorkdayDebrief`
- `ModelColosseum`
- `SignalFlow`
- `PomGambler-prod`
- `GPT_RAG`
- `SnippetLibrary`
- `Nexus`
- `FreeLanceInvoice`
- `StatusPage`
- `ContentEngine`
- `CryptForge`
- `Construction`
- `RealEstate`
- `ScreenshotAnnotate`
- `prompt-englab`
- `AIGCCore`

### Still remaining

- `PersonalKBDrafter` (`env-local`): local proof is green, but the real drafting happy path still needs saved Jira and Confluence credentials plus seeded local app state.
- `SlackIncidentBot` (`env-local`): repo cleanup and local library proof are done, but the live runtime path still needs `.env`, Slack credentials, PostgreSQL connectivity, and a working Docker or equivalent runtime environment.
- `TicketHandoff` (`env-local`): frontend and backend proof are done, but live Jira-backed happy-path proof still needs a saved `api_config` row and the expected Jira keychain credential.
- `OPscinema` (`opscinema implementation`): the packaged app now launches, captures, OCRs, generates tutorial output, and exports successfully, but the late prompt, `Apply Step Edit (Retry)`, and relaunch persistence still are not fully proven end to end.
- `TicketDocumentation` (`env-local`): setup recovery is complete and static proof is green, but the real onboarding, monitoring, and live documentation-generation runtime flow still needs to be closed out in-app.
- `DevToolsTranslator` (`github-governance implementation`): scratch-state cleanup, successful controller runs, governed issue reconciliation, and Notion refresh are done, but issue `#1` is still intentionally open for concrete release-readiness blockers: missing manual Chrome sign-off, missing staged-public release artifacts, missing Chrome Web Store credentials, and missing updater-signature input.
- `JobCommandCenter` (`github-governance implementation`): build proof, sidecar dry-run, governed issue rewrite, and Notion refresh are done, and the PyInstaller sidecar bundle is now built locally, but issue `#3` is still intentionally open for real 5-job batch evidence plus documented LinkedIn bot-detection behavior before the default-branch posture can be revisited.

### Gap between master audit and fix-plan batches

- None. `Nexus` and `TicketDocumentation` both now have dedicated follow-up coverage, and only `TicketDocumentation` remains open.

## Recommended master execution order

1. Freeze the completed set so stale findings are not reintroduced:
   `SpecCompanion`, `DeepTank`, `AIWorkFlow`, `AI Workflow Accelerator`, `job-search-2026`, `OrbitForge`, `PomGambler`, `SynthWave`, `TerraSynth`, `PixelForge`, `knowledgecore`, `IncidentWorkbench`, `Phantom Frequencies`, `Recall`, `ApplyKit`, `AuraForge`, `IncidentReview`, `DesktopPEt`, `OrbitForge (staging)`, `SmartClipboard`, `TicketDashboard`, `Chronomap`, `Echolocate`, `DatabaseSchema`, `LegalDocsReview`, `EarthPulse`, `AssistSupport`, `IncidentMgmt`, `visual-album-studio`, `SignalDecay`, `Conductor`, `WorkdayDebrief`, `ModelColosseum`, `SignalFlow`, `PomGambler-prod`, `GPT_RAG`, `SnippetLibrary`, `Nexus`, `FreeLanceInvoice`, `StatusPage`, `ContentEngine`, `CryptForge`, `Construction`, `RealEstate`, `ScreenshotAnnotate`, `prompt-englab`, `AIGCCore`.
2. Environment and runtime-prerequisite lane:
   `TicketDocumentation`, `TicketHandoff`, `PersonalKBDrafter`, `SlackIncidentBot`.
3. OPscinema closeout lane:
   `OPscinema`.
4. GitHub, workflow, and governance lane:
   `JobCommandCenter`, `DevToolsTranslator`.
5. Final consolidation pass:
   refresh from the latest batch and follow-up artifacts only, resolve any changed summary conflicts, do only the minimum verification needed, and then rewrite `docs/fix-plan-master.md` plus `docs/fix-plan-master-summary.json`.

## Cross-batch blockers

- Several remaining items now depend on real credentials, saved app state, macOS permissions, or runtime services rather than code cleanup alone.
- `OPscinema` is no longer blocked at first launch or first capture, but the packaged smoke flow is still not fully stable or persistent after export.
- `DevToolsTranslator` still depends on clearing the concrete release-readiness blockers tracked in GitHub issue `#1`: manual Chrome sign-off, release artifacts, Chrome Web Store credentials, and updater-signature input.
- `JobCommandCenter` still depends on finish-validation evidence before its intentional default-branch posture can be re-evaluated and issue `#3` can close; the remaining proof is now the real 5-job batch plus LinkedIn bot-detection documentation, not PyInstaller bundling.
- Historical failed-workflow counts should stay historical unless the newest blocker text still points to them directly as the current issue.

## Final done definition

- `docs/fix-plan-master.md` and `docs/fix-plan-master-summary.json` both exist and describe the same merged state.
- Every project from the 10 fix-plan batch summaries appears exactly once in either the completed list above or the JSON `remaining_fixes` array.
- `Nexus` and `TicketDocumentation` are no longer treated as uncovered audit gaps; they are represented through dedicated follow-up coverage, and only `TicketDocumentation` remains active.
- The current unresolved set is exactly these 7 projects:
  `PersonalKBDrafter`, `SlackIncidentBot`, `TicketHandoff`, `OPscinema`, `TicketDocumentation`, `DevToolsTranslator`, `JobCommandCenter`.
- Completed or preserved projects do not reappear in the JSON remaining-fix payload.
- Any future implementation pass refreshes from the latest batch and follow-up artifacts only, resolves summary conflicts, performs only the minimum verification needed, and rewrites the two master artifacts to the final post-implementation state.
