# Notion Operating Roadmap

Updated: 2026-04-14

## Current Phase
- Phase: 9 - Provider Expansion
- Status: In Progress
- Objective: Expand the proven GitHub governance-and-actuation pattern to non-GitHub providers in bounded, auditable slices after the deep GitHub lane is measurably trusted.

## Baseline Metrics
- Total projects: 65
- Overdue reviews: 0
- Missing next moves: 0
- Missing last active: 0
- Stale active projects: 0
- Orphaned projects: 50
- Recent build sessions: 5

## Latest Metrics
- Total projects: 113
- Overdue reviews: 71
- Missing next moves: 0
- Missing last active: 0
- Stale active projects: 0
- Orphaned projects: 4
- Recent build sessions: 0

## Phase Transition Memory
- Transition: Phase 8 closed into Phase 9
- Carry-forward brief: Phase 9A and 9B are proven. Phase 9C now has an implemented bounded `vercel.rollback` lane for `evolutionsandbox`, with pinned-target dry runs and live verification, but the live pilot and post-pilot review are still pending.
- Supporting artifacts:
  - [Vercel Phase 9A Post-Pilot Review](/Users/d/Notion/docs/vercel-phase9a-post-pilot-review.md)
  - [Vercel Phase 9B Rollout Plan](/Users/d/Notion/docs/vercel-phase9b-rollout-plan.md)
  - [Vercel Phase 9B Post-Rollout Review](/Users/d/Notion/docs/vercel-phase9b-post-rollout-review.md)

## Phase Memory
### Phase 1 Gave Us
Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.

### Phase 2 Added
Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.

### Phase 3 Added
Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.

### Phase 4 Added
Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.

### Phase 5 Added
Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.

### Phase 6 Added
Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries.

### Phase 7 Added
Phase 7 gave us controlled actuation: approved GitHub issue/comment execution, dry-run-backed execution logs, deterministic idempotency, and compensation-aware external write handling.

### Phase 8 Added
Phase 8 gave us a mature GitHub action lane: issue lifecycle actions, PR comments, hardened GitHub App posture, richer operator packets, and audit-grade GitHub execution feedback loops.

### Phase 9 Now Looks Like
Phase 9 is in its third bounded slice. Phase 9A proved one explicit Vercel redeploy pilot, Phase 9B proved small-allowlist `vercel.redeploy` widening, and the repo now has an implemented but not yet provider-proven `vercel.rollback` lane for `evolutionsandbox`.

## Risks
- Avoid adding a second overlapping status system beyond the manual fields and the three derived PM signals.
- Keep command-center pages light and linked-view oriented instead of embedding many full databases.
- Keep the repo as the canonical memory so phase transitions do not depend on chat history.

## Phase Roadmap
### Phase 1: Project Control Tower
- Status: Completed
- Objective: Turn Local Portfolio Projects into the low-friction operating control tower for project review, prioritization, and portfolio visibility.
- Deliverables:
  - Governance config for ownership, cadence, freshness, and queue rules
  - Derived PM signals plus completeness snapshot logic
  - Evergreen command-center page and weekly review packet
  - Repo roadmap ledger and phase-closeout flow
- Exit criteria:
  - Derived fields are populated for every project row
  - The command-center page updates idempotently
  - One real weekly review uses the new control-tower data
  - Phase-closeout writes the same phase-2 brief into repo memory and Build Log

### Phase 2: Project Execution System
- Status: Completed
- Objective: Turn project priority into structured execution history with Project Decisions, Work Packets, and Execution Tasks while keeping the project page as the daily PM home.
- Deliverables:
  - Project Decisions, Work Packets, and Execution Tasks data sources
  - Execution-sync and weekly-plan commands that enforce WIP and refresh briefs
  - Project-page execution briefs and richer weekly reviews
  - Phase-memory artifact that carries phase 1, phase 2, and phase 3 forward together
- Exit criteria:
  - Execution Tasks works as the daily task layer and links cleanly to packets and projects
  - WIP is limited to one Now packet and one Standby packet
  - Weekly reviews point at packets, tasks, and material decisions
  - Phase 2 closeout writes the same phase-3 brief into repo memory and Build Log

### Phase 3: Cross-Database Intelligence
- Status: Completed
- Objective: Turn the combined project, execution, research, skill, and tool records into deterministic recommendations and reviewed link intelligence.
- Deliverables:
  - Recommendation Runs and Link Suggestions data sources
  - Deterministic scoring model with project recommendation briefs
  - Weekly recommendation runs, daily focus runs, and command-center intelligence sections
  - Phase memory that preserves phases 1 through 5 in repo artifacts and closeout logs
- Exit criteria:
  - The system can rank resume, finish, investigate, and defer candidates deterministically
  - Weekly runs are stored durably and weekly recommendations can be reviewed before publication
  - Link suggestions move through a review queue with acceptance and rejection memory
  - Phase 3 closeout writes the same phase-4 and phase-5 brief into repo memory and Build Log

### Phase 4: Premium-Native Augmentation
- Status: Completed
- Objective: Use premium-native Notion features as thin overlays for dashboards, reminder nudges, and bounded pilots after the core repo-owned operating model is already stable.
- Deliverables:
  - Portfolio Dashboard and Execution Dashboard as native visibility layers
  - Notification-only native reminder automation desired-state and audit tracking
  - Bounded synced-database and custom-agent pilot definitions with defer reasons or live status
  - Phase memory that preserves Phases 1 through 6 and records what native overlays actually shipped
- Exit criteria:
  - Native dashboards exist and stay within the performance guardrails
  - Reminder automations are either live or explicitly deferred with written reasons
  - Premium-native pilots are either active in bounded form or explicitly deferred with written reasons
  - Phase 4 closeout writes the same phase-5 and phase-6 brief into repo memory and Build Log

### Phase 5: External Signal Integration
- Status: Completed
- Objective: Extend the recommendation engine with non-Notion execution signals so portfolio calls can reflect real repo, deploy, calendar, and workflow evidence.
- Deliverables:
  - External Signal Sources, External Signal Events, and External Signal Sync Runs data sources
  - Polling-first GitHub and deployment adapters with bounded, idempotent sync behavior
  - Project external-signal briefs plus command-center and weekly-review telemetry sections
  - Updated phase memory that preserves phases 1 through 7 and sets up governance next
- Exit criteria:
  - Priority projects have visible external-signal coverage or explicit Needs Mapping rows
  - Sync reruns dedupe cleanly and remain additive to repo-owned scoring and memory
  - At least one external signal materially improves recommendation quality
  - Phase 5 closeout writes the same phase-6 and phase-7 brief into repo memory and Build Log

### Phase 6: Cross-System Governance
- Status: Completed
- Objective: Add the approval gates, action policies, and audit trails needed for recommendations and external signals to influence work outside Notion without losing human control.
- Deliverables:
  - Action policy, approval-request, endpoint, delivery, and receipt ledgers
  - Shadow-mode webhook verification with provider-safe receipt and delivery handling
  - Project and command-center governance briefs plus audit-ready trust controls
- Exit criteria:
  - Cross-system actions require explicit approval at the right boundary
  - Webhook deliveries are verified, deduped, and auditable without mutating external systems
  - Governance artifacts explain how recommendations become safe actions outside Notion
  - Phase 6 closeout writes the same phase-7 brief into repo memory and Build Log

### Phase 7: Controlled Actuation
- Status: Completed
- Objective: Allow tightly governed cross-system actions only after telemetry and approval boundaries are trustworthy.
- Deliverables:
  - Narrow action runners for approved external mutations
  - Approval-aware execution logs that link recommendations to resulting actions
  - Rollback and safe-failure posture for any external write path
- Exit criteria:
  - Every external mutation requires an approved path and leaves an audit trail
  - Rollback posture exists for each supported action type

### Phase 8: GitHub Deepening and Hardening
- Status: Completed
- Objective: Deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.
- Deliverables:
  - Expanded GitHub issue lifecycle and PR comment actions built on the Phase 7 execution ledger
  - Hardened GitHub App permissions, serial write safety, richer error classification, and trusted GitHub feedback loops
  - GitHub-specific operator packets, command-center views, and measured actuation metrics
- Exit criteria:
  - GitHub issue updates, labels, assignees, issue comments, and PR comments use the same approval, idempotency, and audit pattern as Phase 7
  - The deep GitHub lane stays low-noise, easy to audit, and safer than manual ad hoc mutation

### Phase 9: Provider Expansion
- Status: In Progress
- Objective: Expand the proven GitHub governance-and-actuation pattern to non-GitHub providers in bounded, auditable slices that stay as understandable as the GitHub lane.
- Deliverables:
  - Phase 9A completed: truthful Vercel provider readiness, one explicit `evolutionsandbox` pilot target, one live-capable `vercel.redeploy` policy, and one successful governed live redeploy
  - Phase 9B completed: `vercel.redeploy` widened successfully to `premise-debate`, `neural-network-playground`, and `sovereign-sim`, with truthful sync, dry-run graduation, live execution, and confirmed reconciliation for each
  - Phase 9C implementation now exists: `vercel.rollback` is supported in policy, target resolution, dry run, actuation, and verification for `evolutionsandbox`, with pinned rollback targeting and compensation-needed handling on verification mismatch
  - Operator-facing cross-provider views and metrics that stay understandable and low-noise
- Exit criteria:
  - Every new provider lane reuses the same approval, audit, and execution posture rather than inventing parallel systems
  - The `evolutionsandbox` rollback pilot executes once, confirms the pinned rollback target provider-side, and is documented before any wider rollback coverage or new Vercel verbs are considered

## Next Phase
Phase 9 - Provider Expansion

Complete Phase 9C operationally: run one governed live `vercel.rollback` pilot on `evolutionsandbox`, confirm the pinned deployment becomes the effective production target, and write the post-pilot review before deciding whether Vercel should get wider rollback coverage or a separate `vercel.promote` phase.

Future phases should only expand integrations that clearly improve decision quality or reduce friction without weakening human oversight.
