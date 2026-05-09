# Stale Active Rescue Packet - 2026-05-09

## Current Signal

`npm run control-tower:stale-active-rescue -- --limit 60` returned 44 stale `Active Build` projects.

- Status: attention needed
- Returned projects: 44 of 44
- Reason: 44 overdue review, 0 missing next move, 0 missing last active, 0 no build evidence, 0 thin support, 0 low confidence, 0 stale evidence
- Next operator move: review the high-priority stale active projects before another broad refresh, then update Next Move, Last Active, or project status.

## Batch 1 Decision Packet

These are the first projects to handle because they have local repo evidence, explicit existing follow-up notes, unusual branch posture, or missing repo mapping.

| Project | Evidence | Proposed Notion decision | Notion next move |
| --- | --- | --- | --- |
| JobCommandCenter | Local repo has May 2026 activity, dirty worktree, and no upstream on `main`; existing follow-up says finish validation remains open. | Keep active. | Finish validation: prove real 5-job batch, document LinkedIn bot-detection behavior, then revisit default-branch posture. |
| DevToolsTranslator | Local repo exists, has dirty worktree, and existing follow-up says release-readiness blockers remain open. | Keep active. | Clear release-readiness blockers: Chrome sign-off, release artifacts, Web Store credentials, updater-signature input. |
| TideEngine | Local repo is on `fix/remove-merchant-id`, has no upstream, and has dirty release/App Store metadata. | Keep active but mark as release decision. | Decide publish, park, or merge/rebase the release branch; do not treat this as generic staleness. |
| AIWorkFlow | Local repo has May 2026 activity and synced upstream. | Keep active; refresh evidence. | Update Last Active and Next Move from current repo state. |
| knowledgecore | Local repo has April 2026 activity and synced upstream; prior warnings were resolved in earlier portfolio review. | Keep active or move to monitored, depending on current product intent. | Refresh Last Active and Next Review Date; avoid reopening old resolved drift. |
| ComplianceKit | Local repo exists on `feat/phase0-scaffold`, synced to its upstream, with dirty worktree. | Keep active but mark as scaffold/phase work. | Decide whether the phase branch should remain active or be parked. |
| IncidentReview | Local repo exists, synced upstream, but has a very large dirty worktree. | Keep active; needs cleanup decision. | Review dirty local changes before changing Notion status. |
| Interruption Resume Studio | Local repo exists, synced upstream, but has a large dirty worktree. | Keep active; needs cleanup decision. | Review dirty local changes before changing Notion status. |
| ScreenshotAnnotate | Exact local repo path was not found; nearby project `ScreenshottoDataSelect` exists. | Repair mapping before status decision. | Confirm canonical local/GitHub source, then refresh the Notion project row. |
| KBFreshnessDetector | Exact local repo path was not found. | Repair mapping or defer. | Confirm whether the repo was renamed, archived, or never created locally. |
| LoreKeeper | Exact local repo path was not found. | Repair mapping or defer. | Confirm whether the repo was renamed, archived, or never created locally. |
| PersonalKBDrafter | Exact local repo path was not found. | Repair mapping or defer. | Confirm whether the repo was renamed, archived, or never created locally. |
| TicketHandoff | Exact local repo path was not found. | Repair mapping or defer. | Confirm whether the repo was renamed, archived, or never created locally. |
| DesktopPEt-ready | Exact local repo path was not found. | Repair mapping or archive. | Confirm whether this is an old row for another project name before keeping it active. |

## Fast Batch Rules

Use these rules to work the remaining 30 projects without overthinking the first pass.

- If the repo has April or May activity, keep the row active and refresh Last Active, Next Move, and Next Review Date.
- If the repo is dirty or on a branch without upstream, set the next move to branch/worktree cleanup instead of a vague product task.
- If the exact local repo is missing, do not archive immediately; first check for a rename or old canonical source row.
- If there are zero build sessions but strong support links, refresh evidence before changing status.
- If there are zero build sessions, weak support, and no canonical repo, prepare to defer or archive after one source check.

## Suggested Live Write Batch

Live Notion writes were approved and completed for this 10-project batch:

1. JobCommandCenter
2. DevToolsTranslator
3. TideEngine
4. AIWorkFlow
5. knowledgecore
6. ComplianceKit
7. IncidentReview
8. Interruption Resume Studio
9. ScreenshotAnnotate
10. KBFreshnessDetector

The write updated only the fields needed to remove stale ambiguity: project status where Active Build was wrong, Last Active where local repo evidence was newer, Evidence Freshness, Next Move, and Next Review Date.

## Live Write Result

Post-write verification showed the stale active count dropped from 44 to 34.

- Kept active with refreshed evidence: JobCommandCenter, DevToolsTranslator, TideEngine, AIWorkFlow, knowledgecore, IncidentReview, Interruption Resume Studio
- Moved to Needs Decision: ComplianceKit, ScreenshotAnnotate, KBFreshnessDetector
- Next Review Date for the batch: 2026-05-16
- Still waiting after this batch: 34 stale active projects

## Batch 2 And Mapping Repair Result

The stale rescue updater is now a reusable command:

- Dry-run top batch: `npm run control-tower:stale-active-rescue -- --limit 10`
- Live top batch: `npm run control-tower:stale-active-rescue -- --limit 10 --live`
- Dry-run missing repo repairs: `npm run control-tower:stale-active-rescue -- --limit 10 --missing-repos-only`
- Live missing repo repairs: `npm run control-tower:stale-active-rescue -- --limit 10 --missing-repos-only --live`

Live batch 2 updated the next 10 stale active rows from local repo evidence:

1. Afterimage
2. ArguMap
3. Calibrate
4. Cartograph
5. Codec
6. ConvictionMapper
7. GlassLayer
8. How Money Moves
9. JSM Ticket Analytics Export
10. Life Cadence Ledger

Live mapping repair moved these stale active rows to Needs Decision:

1. LoreKeeper
2. PersonalKBDrafter
3. TicketHandoff
4. DesktopPEt-ready

The Command Center was refreshed live after the rescue updates. Post-refresh verification showed:

- Stale active projects: 20
- Overdue reviews: 88
- Needs Decision queue: 2
- Resume Now queue: 5
- Recent build sessions: 1

## Follow-Up Checks

- Final live rescue pass updated the remaining 20 stale active rows.
- Final Command Center refresh completed with stale active projects at 0.
- Final rescue verification returned `status=clean` and `totalStaleActiveProjects=0`.
- Keep this separate from Coordination Snapshot until Personal Ops owns that contract.
- Do not run the full weekly live refresh as the first repair action; this is a targeted rescue lane.
