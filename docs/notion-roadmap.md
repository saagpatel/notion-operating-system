# Notion Operating Roadmap

Updated: 2026-04-23

## Current Phase
- Phase: 10 - Signal Wiring and Intelligence Layer
- Status: Active
- Objective: Wire local signal adapters (notification-hub, repo-auditor, bridge-db) into the external-signal pipeline, add a morning-brief digest, orphan classification, and historical trending to close the feedback loop between portfolio health and daily operations.

## Repo State Snapshot
- The repo is currently in a strong maintenance state after a broad cleanup and command-surface hardening pass.
- That cleanup and hardening work is now merged reality, not an in-progress branch posture.
- The shared CLI plus modern npm aliases are now the intended public operator surface.
- Legacy `portfolio-audit:*` aliases remain only where compatibility is still useful, and they now route either through the CLI or through clearly internal maintenance utilities.
- Public npm scripts no longer point directly at `src/notion/*.ts`.
- Internal maintenance and historical migration utilities were quarantined under `src/internal/notion-maintenance/` or `src/internal/portfolio-audit/`.
- Current focus should be Phase 10 follow-through and operational maturity, not another repo-wide cleanup campaign.

## Fresh Verification Snapshot
- `npm run typecheck` passed on 2026-04-23.
- `npm test` passed on 2026-04-23 with 44 files and 299 tests.
- `npm run build` passed on 2026-04-23.
- `npm run dry-run:example` passed on 2026-04-23 using the documented `--dry-run` flag.
- `npm run bridge-db:status` returned a healthy read-only bridge-db snapshot on 2026-04-23 with `unprocessed_shipped_count: 0`.
- `npm run bridge-db:sync` completed in dry-run mode on 2026-04-23 with 0 SHIPPED rows, 50 personal-ops rows, and 0 failures.
- A post-merge fresh clone from GitHub passed `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:built-cli`, `npm run smoke:packed-install`, and `npm run smoke:git-install` on 2026-04-23.
- Hosted Dependabot checks ran successfully on the final merged dependency heads after PR cleanup; Dependabot's `uuid` advisory workflow still fails because of the accepted `exceljs -> uuid` exception.
- The 2026-04-23 dependency cleanup merged GitHub Actions, production dependency, TypeScript/Node types, and Vitest updates. It also added quiet dotenv loading for the `dotenv` 17 default banner so CLI JSON output remains machine-readable.
- Stale fully merged remote feature branches were pruned on 2026-04-23; `origin/main` is now the only remaining remote branch.
- `npm run signals:seed-mappings -- --limit 2` completed in dry-run mode on 2026-04-23.
- `npm run signals:seed-mappings -- --live --limit 2` created active primary-profile source rows for `Notification Hub - Event Log` and `GithubRepoAuditor - Audit Reports` on 2026-04-23.
- `signals:sync -- --provider notification_hub` and `signals:sync -- --provider repo_auditor` both complete dry-run on 2026-04-23 with `syncedSourceCount: 1`.
  - `notification_hub` now exercises, strips status prefixes before matching, ignores known bridge operational tags, and reports sample names for remaining unmatched project values.
  - `repo_auditor` now exercises, reports audit input dated 2026-04-24, and reports sample names for remaining unmatched repos.
  - `bridge-db`, `notification-hub`, and `DecisionStressTest` now have Local Portfolio Project rows and live GitHub source mappings, so local-provider dry-runs no longer report unmatched project/repo names.
  - broad live signal sync is still a separate decision because the latest dry-run would update 117 project external-signal briefs.
- `npm audit --json` still reports 2 moderate findings through `exceljs -> uuid`; this is documented as an accepted temporary exception because the maintained `exceljs` line still depends on vulnerable `uuid`.
- `notification-hub` and `repo-auditor` have sandbox live proof from 2026-04-17 and primary-profile dry-run exercise from 2026-04-23.
  - sandbox source rows exist for both providers
  - `notification-hub` wrote one bounded proof event and one sync-run row
  - `repo-auditor` wrote one bounded proof audit event and one sync-run row
  - `signals:morning-brief -- --profile sandbox` now sees the notification-hub proof event
- `notion-os --profile sandbox doctor --json` now passes sandbox path isolation, token isolation, and target isolation checks.
- `npm run sandbox:smoke` now passes end to end.
- The sandbox GitHub lane is now sufficiently proven in live mode on 2026-04-17 against `portfolio-actuation-sandbox` issue `#3`.
  - `github.create_issue` created issue `#3`
  - `github.add_issue_comment` created comment `4266814277`
  - `github.update_issue` updated issue `#3`
- `src/notion/local-portfolio-actuation.ts` now normalizes quoted GitHub App PEM values before signing, which fixed the live GitHub App key decoding failure uncovered during the sandbox proof.
- `src/notion/operational-rollout.ts` now includes a generic `ensureGitHubActionRequest(...)` helper so non-create GitHub action requests can be created from repo code instead of one-off scripts.
- The sandbox profile-owned Vercel manual seeds and rollout targets were trimmed because the sandbox workspace currently does not contain matching local project rows for those primary-profile IDs.
- The restart docs were refreshed again after the final confidence pass so they describe the merged repo state and current next-step posture accurately.

## Baseline Metrics
- Total projects: 65
- Overdue reviews: 0
- Missing next moves: 0
- Missing last active: 0
- Stale active projects: 0
- Orphaned projects: 50
- Recent build sessions: 5

## Latest Metrics
- Total projects: 114
- Overdue reviews: 73
- Missing next moves: 1
- Missing last active: 1
- Stale active projects: 0
- Orphaned projects: 5
- Recent build sessions: 0

## Phase Transition Memory
- Transition: Phase 9 closed into Phase 10
- Carry-forward brief: Future phases should only expand integrations that clearly improve decision quality or reduce friction without weakening human oversight.

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

### Phase 9 Added
Phase 9 expanded the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane was stable, low-noise, and easy to audit.

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
- Status: Completed
- Objective: Expand the proven GitHub governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is measurably trusted.
- Deliverables:
  - New provider actuation lanes that reuse the existing approval, idempotency, and execution-ledger contract
  - Provider-specific telemetry, webhook verification, and compensation patterns layered on top of the Phase 5 to 8 foundation
  - Operator-facing cross-provider views and metrics that stay understandable and low-noise
- Exit criteria:
  - New providers reuse the same approval, audit, and execution posture rather than inventing parallel systems
  - Cross-provider expansion remains easy to understand and clearly worth the added complexity

### Phase 10: Signal Wiring and Intelligence Layer
- Status: Active
- Objective: Wire local signal adapters (notification-hub, repo-auditor, bridge-db) into the external-signal pipeline, add a morning-brief digest, orphan classification, and historical trending to close the feedback loop between portfolio health and daily operations.
- Deliverables:
  - Notification Hub JSONL → ExternalSignalEvents adapter with severity classification
  - GithubRepoAuditor audit reports → ExternalSignalEvents adapter with grade-based severity
  - bridge-db SHIPPED rows → Notion Build Log adapter with project name resolution
  - Morning brief command: daily signal digest patched onto the weekly review page
  - Orphan classification command: deterministic rule-based bucketing of projects with no linked records
  - Historical trending via JSONL snapshots: queue-change and stale-evidence detection
  - Phase 10A audit fixes: markRowProcessed propagation, normalizeProviderKey coverage, JSONL windowing, empty full_name guard
- Exit criteria:
  - All three local adapters emit events that appear in the External Signal Events database
  - Morning brief dry-run produces a valid severity-grouped markdown section
  - Orphan classification dry-run buckets all orphan projects without Notion writes
  - Trend analysis reports queue changes after two consecutive control-tower syncs
  - Sandbox proving lane stays isolated enough to trust `doctor` and `sandbox:smoke` before risky live rehearsal
  - Typecheck clean, 299+ tests pass
- Restart note:
  - structural cleanup and script-surface hardening are complete enough that Phase 10 work can proceed without another broad repo-audit pass first
  - as of 2026-04-23, dry-run confidence is strongest for `trend-analysis`, `orphan-classify`, `bridge-db status`, `bridge-db sync`, `dry-run:example`, and `morning-brief`; the sandbox proving lane is healthy again
  - as of 2026-04-23, `notification-hub` and `repo-auditor` are implemented, sandbox-proven, and primary-profile dry-run exercised:
    - both are modeled as global local-provider source rows rather than fake per-project rows
    - `notification-hub` is project-only in v1 and records skipped null/unmatched counts
    - `repo-auditor` resolves through active GitHub source identifiers first, then project-title fallback
    - sandbox live proof wrote real `External Signal Events` and `External Signal Sync Runs` rows for both providers
    - primary-profile source rows now exist for `Notification Hub - Event Log` and `GithubRepoAuditor - Audit Reports`
    - next cleanup is operator-surface productization or a reviewed broad live signal sync; the known provider mapping misses are resolved
  - as of 2026-04-17, the orphan-classification live packet lane writes structured `work_packets` entries with execution metadata and project relations
  - as of 2026-04-17, orphan follow-through also has an approval-backed path: `--request-approval` creates or refreshes governance requests and `--create-approved-packets` materializes only approved kickoff packets
  - as of 2026-04-17, the sandbox GitHub lane has enough live evidence to stop proving it further unless a new action family is needed; the next work should be productization, not more sandbox mutation depth

## Next Phase
Phase 10 - Signal Wiring and Intelligence Layer

Wire local signal adapters (notification-hub, repo-auditor, bridge-db) into the external-signal pipeline, add a morning-brief digest, orphan classification, and historical trending to close the feedback loop between portfolio health and daily operations.

Immediate next step: keep moving Phase 10 forward from the now-healthy sandbox and primary-profile dry-run lanes. Treat `notification-hub`, `repo-auditor`, and `bridge-db` as implemented adapters with signal-quality and operator-surface follow-through remaining.
Recommended next slice:
- decide whether to run a broad live signal sync after reviewing the 117-project dry-run blast radius
- improve the operator surface on top of the now-proven adapters: morning-brief ranking, command-center synthesis, or a tighter governed orphan routine

Phase 10C should now focus on the remaining gaps after adapter closure: signal-quality cleanup, stronger morning-brief synthesis around top-priority projects, a more explicit governed orphan routine, and continued managed weekly-review trend output.
