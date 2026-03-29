import type { ControlTowerMetrics } from "./local-portfolio-control-tower.js";

export interface RoadmapPhase {
  phase: number;
  title: string;
  status: "Planned" | "In Progress" | "Completed";
  objective: string;
  deliverables: string[];
  exitCriteria: string[];
  nextPhaseBrief: string;
}

function normalizeRoadmapStatus(status: string): RoadmapPhase["status"] {
  const lowered = status.trim().toLowerCase();
  if (lowered.includes("complete")) {
    return "Completed";
  }
  if (lowered.includes("plan")) {
    return "Planned";
  }
  return "In Progress";
}

export function buildRoadmapPhases(
  currentPhase: number,
  currentPhaseStatus: string,
  phaseOneCompleted: boolean,
): RoadmapPhase[] {
  const normalizedCurrentStatus = normalizeRoadmapStatus(currentPhaseStatus);
  const phase1Status =
    currentPhase > 1 || phaseOneCompleted
      ? "Completed"
      : currentPhase === 1 && currentPhaseStatus.toLowerCase().includes("progress")
        ? normalizedCurrentStatus
        : "Planned";
  const phase2Status =
    currentPhase === 2
      ? normalizedCurrentStatus
      : currentPhase > 2
        ? "Completed"
        : "Planned";
  const phase3Status =
    currentPhase === 3
      ? normalizedCurrentStatus
      : currentPhase > 3
        ? "Completed"
        : "Planned";
  const phase4Status = currentPhase === 4 ? normalizedCurrentStatus : currentPhase > 4 ? "Completed" : "Planned";
  const phase5Status = currentPhase === 5 ? normalizedCurrentStatus : currentPhase > 5 ? "Completed" : "Planned";
  const phase6Status = currentPhase === 6 ? normalizedCurrentStatus : currentPhase > 6 ? "Completed" : "Planned";
  const phase7Status = currentPhase === 7 ? normalizedCurrentStatus : currentPhase > 7 ? "Completed" : "Planned";
  const phase8Status = currentPhase === 8 ? normalizedCurrentStatus : currentPhase > 8 ? "Completed" : "Planned";
  const phase9Status = currentPhase === 9 ? normalizedCurrentStatus : currentPhase > 9 ? "Completed" : "Planned";

  return [
    {
      phase: 1,
      title: "Project Control Tower",
      status: phase1Status,
      objective:
        "Turn Local Portfolio Projects into the low-friction operating control tower for project review, prioritization, and portfolio visibility.",
      deliverables: [
        "Governance config for ownership, cadence, freshness, and queue rules",
        "Derived PM signals plus completeness snapshot logic",
        "Evergreen command-center page and weekly review packet",
        "Repo roadmap ledger and phase-closeout flow",
      ],
      exitCriteria: [
        "Derived fields are populated for every project row",
        "The command-center page updates idempotently",
        "One real weekly review uses the new control-tower data",
        "Phase-closeout writes the same phase-2 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Build the project execution system around Local Portfolio Projects with Project Decisions, Work Packets, Execution Tasks, weekly planning, and durable phase memory.",
    },
    {
      phase: 2,
      title: "Project Execution System",
      status: phase2Status,
      objective:
        "Turn project priority into structured execution history with Project Decisions, Work Packets, and Execution Tasks while keeping the project page as the daily PM home.",
      deliverables: [
        "Project Decisions, Work Packets, and Execution Tasks data sources",
        "Execution-sync and weekly-plan commands that enforce WIP and refresh briefs",
        "Project-page execution briefs and richer weekly reviews",
        "Phase-memory artifact that carries phase 1, phase 2, and phase 3 forward together",
      ],
      exitCriteria: [
        "Execution Tasks works as the daily task layer and links cleanly to packets and projects",
        "WIP is limited to one Now packet and one Standby packet",
        "Weekly reviews point at packets, tasks, and material decisions",
        "Phase 2 closeout writes the same phase-3 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Phase 3 will use those combined project + execution + research + skill + tool signals to recommend what to resume, finish, defer, or investigate next.",
    },
    {
      phase: 3,
      title: "Cross-Database Intelligence",
      status: phase3Status,
      objective:
        "Turn the combined project, execution, research, skill, and tool records into deterministic recommendations and reviewed link intelligence.",
      deliverables: [
        "Recommendation Runs and Link Suggestions data sources",
        "Deterministic scoring model with project recommendation briefs",
        "Weekly recommendation runs, daily focus runs, and command-center intelligence sections",
        "Phase memory that preserves phases 1 through 5 in repo artifacts and closeout logs",
      ],
      exitCriteria: [
        "The system can rank resume, finish, investigate, and defer candidates deterministically",
        "Weekly runs are stored durably and weekly recommendations can be reviewed before publication",
        "Link suggestions move through a review queue with acceptance and rejection memory",
        "Phase 3 closeout writes the same phase-4 and phase-5 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Phase 4 will evaluate premium-native Notion overlays such as dashboards, reminder automations, synced databases, and custom agents only after the phase-3 recommendation engine is stable, trusted, and worth augmenting.",
    },
    {
      phase: 4,
      title: "Premium-Native Augmentation",
      status: phase4Status,
      objective:
        "Use premium-native Notion features as thin overlays for dashboards, reminder nudges, and bounded pilots after the core repo-owned operating model is already stable.",
      deliverables: [
        "Portfolio Dashboard and Execution Dashboard as native visibility layers",
        "Notification-only native reminder automation desired-state and audit tracking",
        "Bounded synced-database and custom-agent pilot definitions with defer reasons or live status",
        "Phase memory that preserves Phases 1 through 6 and records what native overlays actually shipped",
      ],
      exitCriteria: [
        "Native dashboards exist and stay within the performance guardrails",
        "Reminder automations are either live or explicitly deferred with written reasons",
        "Premium-native pilots are either active in bounded form or explicitly deferred with written reasons",
        "Phase 4 closeout writes the same phase-5 and phase-6 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Phase 5 will bring in external repo, deploy, calendar, and workflow signals as additive recommendation inputs so the operating system can compare Notion memory with real execution telemetry.",
    },
    {
      phase: 5,
      title: "External Signal Integration",
      status: phase5Status,
      objective:
        "Extend the recommendation engine with non-Notion execution signals so portfolio calls can reflect real repo, deploy, calendar, and workflow evidence.",
      deliverables: [
        "External Signal Sources, External Signal Events, and External Signal Sync Runs data sources",
        "Polling-first GitHub and deployment adapters with bounded, idempotent sync behavior",
        "Project external-signal briefs plus command-center and weekly-review telemetry sections",
        "Updated phase memory that preserves phases 1 through 7 and sets up governance next",
      ],
      exitCriteria: [
        "Priority projects have visible external-signal coverage or explicit Needs Mapping rows",
        "Sync reruns dedupe cleanly and remain additive to repo-owned scoring and memory",
        "At least one external signal materially improves recommendation quality",
        "Phase 5 closeout writes the same phase-6 and phase-7 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Phase 6 will add webhook policy, identity boundaries, credential posture, replay and dedupe rules, approval gates, and audit requirements before any higher-trust integration or external mutation.",
    },
    {
      phase: 6,
      title: "Cross-System Governance",
      status: phase6Status,
      objective:
        "Add the approval gates, action policies, and audit trails needed for recommendations and external signals to influence work outside Notion without losing human control.",
      deliverables: [
        "Action policy, approval-request, endpoint, delivery, and receipt ledgers",
        "Shadow-mode webhook verification with provider-safe receipt and delivery handling",
        "Project and command-center governance briefs plus audit-ready trust controls",
      ],
      exitCriteria: [
        "Cross-system actions require explicit approval at the right boundary",
        "Webhook deliveries are verified, deduped, and auditable without mutating external systems",
        "Governance artifacts explain how recommendations become safe actions outside Notion",
        "Phase 6 closeout writes the same phase-7 brief into repo memory and Build Log",
      ],
      nextPhaseBrief:
        "Phase 7 will allow tightly approved cross-system actions such as creating work items, annotating deploys, or writing back to external systems from trusted recommendations.",
    },
    {
      phase: 7,
      title: "Controlled Actuation",
      status: phase7Status,
      objective:
        "Allow tightly governed cross-system actions only after telemetry and approval boundaries are trustworthy.",
      deliverables: [
        "Narrow action runners for approved external mutations",
        "Approval-aware execution logs that link recommendations to resulting actions",
        "Rollback and safe-failure posture for any external write path",
      ],
      exitCriteria: [
        "Every external mutation requires an approved path and leaves an audit trail",
        "Rollback posture exists for each supported action type",
      ],
      nextPhaseBrief:
        "Phase 8 will deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.",
    },
    {
      phase: 8,
      title: "GitHub Deepening and Hardening",
      status: phase8Status,
      objective:
        "Deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.",
      deliverables: [
        "Expanded GitHub issue lifecycle and PR comment actions built on the Phase 7 execution ledger",
        "Hardened GitHub App permissions, serial write safety, richer error classification, and trusted GitHub feedback loops",
        "GitHub-specific operator packets, command-center views, and measured actuation metrics",
      ],
      exitCriteria: [
        "GitHub issue updates, labels, assignees, issue comments, and PR comments use the same approval, idempotency, and audit pattern as Phase 7",
        "The deep GitHub lane stays low-noise, easy to audit, and safer than manual ad hoc mutation",
      ],
      nextPhaseBrief:
        "Phase 9 will expand the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is stable, low-noise, and easy to audit.",
    },
    {
      phase: 9,
      title: "Provider Expansion",
      status: phase9Status,
      objective:
        "Expand the proven GitHub governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is measurably trusted.",
      deliverables: [
        "New provider actuation lanes that reuse the existing approval, idempotency, and execution-ledger contract",
        "Provider-specific telemetry, webhook verification, and compensation patterns layered on top of the Phase 5 to 8 foundation",
        "Operator-facing cross-provider views and metrics that stay understandable and low-noise",
      ],
      exitCriteria: [
        "New providers reuse the same approval, audit, and execution posture rather than inventing parallel systems",
        "Cross-provider expansion remains easy to understand and clearly worth the added complexity",
      ],
      nextPhaseBrief:
        "Future phases should only expand integrations that clearly improve decision quality or reduce friction without weakening human oversight.",
    },
  ];
}

export function renderNotionRoadmapMarkdown(input: {
  generatedAt: string;
  currentPhase: number;
  currentPhaseStatus: string;
  baselineMetrics?: ControlTowerMetrics;
  latestMetrics?: ControlTowerMetrics;
  lastClosedPhase?: number;
}): string {
  const phases = buildRoadmapPhases(
    input.currentPhase,
    input.currentPhaseStatus,
    input.currentPhase > 1 || input.currentPhaseStatus.toLowerCase().includes("complete"),
  );
  const currentPhaseEntry =
    phases.find((phase) => phase.phase === input.currentPhase) ??
    phases[0]!;
  const previousPhaseEntry =
    typeof input.lastClosedPhase === "number"
      ? phases.find((phase) => phase.phase === input.lastClosedPhase)
      : undefined;
  const nextPhaseEntry =
    phases.find((phase) => phase.phase === input.currentPhase + 1) ??
    currentPhaseEntry;
  const nextPhaseBrief =
    currentPhaseEntry.nextPhaseBrief;
  const phaseMemory = buildPhaseMemorySummary(input.currentPhase);

  const lines = [
    "# Notion Operating Roadmap",
    "",
    `Updated: ${input.generatedAt}`,
    "",
    "## Current Phase",
    `- Phase: ${currentPhaseEntry.phase} - ${currentPhaseEntry.title}`,
    `- Status: ${currentPhaseEntry.status}`,
    `- Objective: ${currentPhaseEntry.objective}`,
    "",
    "## Baseline Metrics",
    ...renderMetricSection(input.baselineMetrics, "Baseline metrics will be captured on the first live control-tower sync."),
    "",
    "## Latest Metrics",
    ...renderMetricSection(input.latestMetrics, "Latest metrics are not captured yet."),
  ];

  if (previousPhaseEntry && previousPhaseEntry.phase + 1 === currentPhaseEntry.phase) {
    lines.push(
      "",
      "## Phase Transition Memory",
      `- Transition: Phase ${previousPhaseEntry.phase} closed into Phase ${currentPhaseEntry.phase}`,
      `- Carry-forward brief: ${previousPhaseEntry.nextPhaseBrief}`,
    );
  }

  lines.push(
    "",
    "## Phase Memory",
    "### Phase 1 Gave Us",
    phaseMemory.phase1GaveUs,
    "",
    "### Phase 2 Added",
    phaseMemory.phase2Added,
    "",
    "### Phase 3 Added",
    phaseMemory.phase3Added,
    "",
    "### Phase 4 Added",
    phaseMemory.phase4Added,
    "",
    "### Phase 5 Added",
    phaseMemory.phase5Added,
    "",
    "### Phase 6 Added",
    phaseMemory.phase6Added,
    "",
    "### Phase 7 Added",
    phaseMemory.phase7Added,
    "",
    "### Phase 8 Added",
    phaseMemory.phase8Added,
    "",
    "### Phase 9 Will Expand",
    phaseMemory.phase9WillExpand,
  );

  lines.push(
    "",
    "## Risks",
    "- Avoid adding a second overlapping status system beyond the manual fields and the three derived PM signals.",
    "- Keep command-center pages light and linked-view oriented instead of embedding many full databases.",
    "- Keep the repo as the canonical memory so phase transitions do not depend on chat history.",
    "",
    "## Phase Roadmap",
    ...phases.flatMap((phase) => [
      `### Phase ${phase.phase}: ${phase.title}`,
      `- Status: ${phase.status}`,
      `- Objective: ${phase.objective}`,
      "- Deliverables:",
      ...phase.deliverables.map((item) => `  - ${item}`),
      "- Exit criteria:",
      ...phase.exitCriteria.map((item) => `  - ${item}`),
      "",
    ]),
    "## Next Phase",
    `Phase ${nextPhaseEntry.phase} - ${nextPhaseEntry.title}`,
    "",
    nextPhaseEntry.objective,
    "",
    nextPhaseBrief,
  );

  return lines.join("\n");
}

export function renderNotionPhaseMemoryMarkdown(input: {
  generatedAt: string;
  currentPhase: number;
}): string {
  const phaseMemory = buildPhaseMemorySummary(input.currentPhase);
  return [
    "# Notion Phase Memory",
    "",
    `Updated: ${input.generatedAt}`,
    "",
    "## Phase 1",
    "- Objective: Build the project control tower and the durable roadmap memory layer.",
    `- Shipped capabilities: ${phaseMemory.phase1GaveUs}`,
    "",
    "## Phase 2",
    "- Objective: Add structured execution memory with decisions, packets, tasks, and weekly planning.",
    `- Shipped capabilities: ${phaseMemory.phase2Added}`,
    "",
    "## Phase 3",
    "- Objective: Turn the combined project, execution, and support history into deterministic portfolio recommendations and reviewed link intelligence.",
    `- Shipped capabilities: ${phaseMemory.phase3Added}`,
    "",
    "## Phase 4",
    "- Objective: Add premium-native Notion overlays only where they clearly reduce friction.",
    `- Shipped capabilities: ${phaseMemory.phase4Added}`,
    "",
    "## Phase 5",
    "- Objective: Bring in external operating signals so recommendations can reflect real execution evidence beyond Notion rows.",
    `- Shipped capabilities: ${phaseMemory.phase5Added}`,
    "",
    "## Phase 6",
    "- Objective: Add governance and approval gates so cross-system actions stay safe and human-controlled.",
    `- Shipped capabilities: ${phaseMemory.phase6Added}`,
    "",
    "## Phase 7",
    "- Objective: Allow tightly approved external actions only after governance and trust boundaries are in place.",
    `- Shipped capabilities: ${phaseMemory.phase7Added}`,
    "",
    "## Phase 8",
    "- Objective: Deepen the proven GitHub actuation lane with more actions, stronger security, and better operator feedback.",
    `- Shipped capabilities: ${phaseMemory.phase8Added}`,
    "",
    "## Phase 9",
    "- Objective: Expand the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is trusted.",
    `- Next-phase brief: ${phaseMemory.phase9WillExpand}`,
  ].join("\n");
}

export function renderLocalPortfolioAdrMarkdown(): string {
  const lines = [
    "# ADR 0001: Local Portfolio Projects is the project control tower",
    "",
    "- Status: Accepted",
    "- Date: 2026-03-17",
    "",
    "## Context",
    "The repo already contains durable direct Notion REST publishing, live schema upgrades, and MCP-driven saved view sync. A newer Local Portfolio Projects database exists alongside the older scored Project Portfolio database. The operating system needs one clear project control surface for day-to-day PM review without destroying the older strategic scoring system.",
    "",
    "## Decision",
    "Use Local Portfolio Projects as the operational project control tower. Keep the older Project Portfolio database intact for legacy strategic scoring, but do not use it as the day-to-day execution-facing source of truth.",
    "",
    "## Alternatives Considered",
    "- Continue using the older Project Portfolio database as the operational source of truth.",
    "- Merge both project databases into one immediately.",
    "- Keep the operating model implicit in chat history and ad hoc Notion pages.",
    "",
    "## Consequences",
    "- The control-tower logic can stay additive and non-destructive.",
    "- The repo can own derived PM signals, review cadence, and memory artifacts around one operational database.",
    "- Cross-database relations from Build Log, Weekly Reviews, Research Library, Skills Library, and AI Tool & Site Matrix can converge on one project operating surface.",
    "",
    "## Supersession Guidance",
    "If a future phase replaces Local Portfolio Projects as the control tower, add a new ADR instead of silently rewriting this one.",
  ];

  return lines.join("\n");
}

function renderMetricSection(metrics: ControlTowerMetrics | undefined, emptyState: string): string[] {
  if (!metrics) {
    return [`- ${emptyState}`];
  }

  return [
    `- Total projects: ${metrics.totalProjects}`,
    `- Overdue reviews: ${metrics.overdueReviews}`,
    `- Missing next moves: ${metrics.missingNextMove}`,
    `- Missing last active: ${metrics.missingLastActive}`,
    `- Stale active projects: ${metrics.staleActiveProjects}`,
    `- Orphaned projects: ${metrics.orphanedProjects}`,
    `- Recent build sessions: ${metrics.recentBuildSessions}`,
  ];
}

function buildPhaseMemorySummary(currentPhase: number): {
  phase1GaveUs: string;
  phase2Added: string;
  phase3Added: string;
  phase4Added: string;
  phase5Added: string;
  phase6Added: string;
  phase7Added: string;
  phase8Added: string;
  phase9WillExpand: string;
} {
  const phase1GaveUs =
    "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.";
  const phase2Added =
    currentPhase >= 2
      ? "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history."
      : "Phase 2 is the next step: structured execution data through decisions, work packets, tasks, blockers, throughput, and weekly execution history.";
  const phase3Added =
    currentPhase >= 3
      ? "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence."
      : "Phase 3 will turn the combined project, execution, research, skill, and tool records into deterministic recommendations and reviewed link intelligence.";
  const phase4Added =
    currentPhase >= 4
      ? "Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system."
      : "Phase 4 will add stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.";
  const phase5Added =
    currentPhase >= 5
      ? "Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence."
      : "Phase 5 will bring in external repo, deploy, calendar, and workflow signals as additive recommendation inputs so the operating system can compare Notion memory with real execution telemetry.";
  const phase6Added =
    currentPhase >= 6
      ? "Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries."
      : "Phase 6 will add webhook policy, identity boundaries, credential posture, replay and dedupe rules, approval gates, and audit requirements before any higher-trust integration or external mutation.";
  const phase7Added =
    currentPhase >= 7
      ? "Phase 7 gave us controlled actuation: approved GitHub issue/comment execution, dry-run-backed execution logs, deterministic idempotency, and compensation-aware external write handling."
      : "Phase 7 will allow tightly approved cross-system actions such as creating work items, annotating deploys, or writing back to external systems from trusted recommendations.";
  const phase8Added =
    currentPhase >= 8
      ? "Phase 8 gave us a mature GitHub action lane: issue lifecycle actions, PR comments, hardened GitHub App posture, richer operator packets, and audit-grade GitHub execution feedback loops."
      : "Phase 8 will deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.";
  const phase9WillExpand =
    "Phase 9 will expand the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is stable, low-noise, and easy to audit.";

  return {
    phase1GaveUs,
    phase2Added,
    phase3Added,
    phase4Added,
    phase5Added,
    phase6Added,
    phase7Added,
    phase8Added,
    phase9WillExpand,
  };
}
