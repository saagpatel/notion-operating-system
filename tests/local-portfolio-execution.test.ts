import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildProjectExecutionContext,
  calculateExecutionMetrics,
  mergeManagedSection,
  parseLocalPortfolioExecutionViewPlan,
  renderExecutionBriefSection,
  renderExecutionCommandCenterSection,
  renderWeeklyExecutionSection,
  validateExecutionWip,
  type ExecutionTaskRecord,
  type ProjectDecisionRecord,
  type WorkPacketRecord,
} from "../src/notion/local-portfolio-execution.js";
import { parseLocalPortfolioControlTowerConfig, type ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";

const TODAY = "2026-03-17";

describe("local portfolio execution system", () => {
  test("parses the execution view plan and control tower phase 2 config", async () => {
    const viewsRaw = JSON.parse(
      await readFile(new URL("../config/local-portfolio-execution-views.json", import.meta.url), "utf8"),
    );
    const configRaw = JSON.parse(
      await readFile(new URL("../config/local-portfolio-control-tower.json", import.meta.url), "utf8"),
    );

    const plan = parseLocalPortfolioExecutionViewPlan(viewsRaw);
    const config = parseLocalPortfolioControlTowerConfig(configRaw);

    expect(plan.collections).toHaveLength(3);
    expect(config.phase2Execution?.packets.name).toBe("Work Packets");
    expect(config.phase2Execution?.phaseMemory.phase3Brief).toContain("recommend what to resume");
  });

  test("calculates execution metrics and wip violations", async () => {
    const configRaw = JSON.parse(
      await readFile(new URL("../config/local-portfolio-control-tower.json", import.meta.url), "utf8"),
    );
    const config = parseLocalPortfolioControlTowerConfig(configRaw);
    const decisions = [baseDecision()];
    const packets = [basePacket(), basePacket({ id: "packet-2", title: "Standby", priority: "Standby", status: "Ready" })];
    const tasks = [
      baseTask(),
      baseTask({ id: "task-2", title: "Blocked task", status: "Blocked", dueDate: "2026-03-16" }),
    ];

    const metrics = calculateExecutionMetrics({
      decisions,
      packets,
      tasks,
      today: TODAY,
      config,
    });

    expect(metrics.openDecisions).toBe(1);
    expect(metrics.nowPackets).toBe(1);
    expect(metrics.standbyPackets).toBe(1);
    expect(metrics.blockedTasks).toBe(1);
    expect(metrics.overdueTasks).toBe(1);
    expect(validateExecutionWip({ packets, tasks, maxNowPackets: 1, maxStandbyPackets: 1 })).toEqual([]);
  });

  test("renders execution artifacts with durable managed sections", () => {
    const project = baseProject();
    const context = buildProjectExecutionContext({
      project,
      decisions: [baseDecision()],
      packets: [basePacket()],
      tasks: [baseTask({ status: "Blocked" })],
      buildSessions: [],
      today: TODAY,
    });

    const brief = renderExecutionBriefSection(context);
    const merged = mergeManagedSection("# Project Page", brief, "<!-- codex:notion-execution-brief:start -->", "<!-- codex:notion-execution-brief:end -->");
    const commandCenter = renderExecutionCommandCenterSection({
      metrics: {
        openDecisions: 1,
        nowPackets: 1,
        standbyPackets: 0,
        blockedPackets: 0,
        blockedTasks: 1,
        overdueTasks: 0,
        tasksCompletedThisWeek: 0,
        packetsCompletedThisWeek: 0,
        rolloverPackets: 0,
        projectsWithExecutionDrift: 0,
        wipViolations: [],
      },
      decisions: [baseDecision()],
      packets: [basePacket()],
      tasks: [baseTask({ status: "Blocked" })],
      projects: [project],
      today: TODAY,
    });
    const weekly = renderWeeklyExecutionSection({
      weekTitle: "Week of 2026-03-17",
      nowPackets: [basePacket()],
      standbyPackets: [],
      decisionsCommitted: [baseDecision({ status: "Committed", decidedOn: TODAY })],
      blockedTasks: [baseTask({ status: "Blocked" })],
      completedTasks: [baseTask({ status: "Done", completedOn: TODAY })],
      rolloverPackets: [basePacket({ rolloverCount: 1, title: "Rollover packet" })],
      nextFocus: ["Finish the current packet."],
      includeNextPhase: true,
      phase3Brief: "Phase 3 will use the combined history.",
    });

    expect(brief).toContain("## Execution Brief");
    expect(merged).toContain("codex:notion-execution-brief:start");
    expect(commandCenter).toContain("## Phase 2 Execution System");
    expect(weekly).toContain("### Next Phase");
  });
});

function baseProject(overrides: Partial<ControlTowerProjectRecord> = {}): ControlTowerProjectRecord {
  return {
    id: overrides.id ?? "project-1",
    url: overrides.url ?? "https://notion.so/project-1",
    title: overrides.title ?? "Sample Project",
    currentState: overrides.currentState ?? "Active Build",
    portfolioCall: overrides.portfolioCall ?? "Finish",
    momentum: overrides.momentum ?? "Warm",
    needsReview: overrides.needsReview ?? false,
    nextMove: overrides.nextMove ?? "Ship a clear slice",
    biggestBlocker: overrides.biggestBlocker ?? "Need one more pass",
    lastActive: overrides.lastActive ?? "2026-03-15",
    dateUpdated: overrides.dateUpdated ?? "2026-03-14",
    lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-15",
    buildSessionCount: overrides.buildSessionCount ?? 1,
    relatedResearchCount: overrides.relatedResearchCount ?? 1,
    supportingSkillsCount: overrides.supportingSkillsCount ?? 1,
    linkedToolCount: overrides.linkedToolCount ?? 1,
    setupFriction: overrides.setupFriction ?? "Low",
    runsLocally: overrides.runsLocally ?? "Yes",
    buildMaturity: overrides.buildMaturity ?? "Feature Complete",
    shipReadiness: overrides.shipReadiness ?? "Near Ship",
    effortToDemo: overrides.effortToDemo ?? "1 day",
    effortToShip: overrides.effortToShip ?? "2-3 days",
    oneLinePitch: overrides.oneLinePitch ?? "A phase-two execution test project",
    valueOutcome: overrides.valueOutcome ?? "Create execution clarity",
    monetizationValue: overrides.monetizationValue ?? "Strategic leverage",
    evidenceConfidence: overrides.evidenceConfidence ?? "High",
    docsQuality: overrides.docsQuality ?? "Strong",
    testPosture: overrides.testPosture ?? "Some",
    category: overrides.category ?? "Dev Tool",
    operatingQueue: overrides.operatingQueue ?? "Resume Now",
    nextReviewDate: overrides.nextReviewDate ?? "2026-03-24",
    evidenceFreshness: overrides.evidenceFreshness ?? "Fresh",
  };
}

function baseDecision(overrides: Partial<ProjectDecisionRecord> = {}): ProjectDecisionRecord {
  return {
    id: overrides.id ?? "decision-1",
    url: overrides.url ?? "https://notion.so/decision-1",
    title: overrides.title ?? "Resume the project",
    status: overrides.status ?? "Proposed",
    decisionType: overrides.decisionType ?? "Priority",
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    decisionOwnerIds: overrides.decisionOwnerIds ?? ["user-1"],
    proposedOn: overrides.proposedOn ?? "2026-03-17",
    decidedOn: overrides.decidedOn ?? "",
    revisitBy: overrides.revisitBy ?? "2026-03-24",
    optionsConsidered: overrides.optionsConsidered ?? "Resume, pause, or narrow scope",
    chosenOption: overrides.chosenOption ?? "",
    rationale: overrides.rationale ?? "This is the clearest next move.",
    expectedImpact: overrides.expectedImpact ?? "Improve delivery clarity.",
    buildLogSessionIds: overrides.buildLogSessionIds ?? [],
  };
}

function basePacket(overrides: Partial<WorkPacketRecord> = {}): WorkPacketRecord {
  return {
    id: overrides.id ?? "packet-1",
    url: overrides.url ?? "https://notion.so/packet-1",
    title: overrides.title ?? "Now packet",
    status: overrides.status ?? "In Progress",
    packetType: overrides.packetType ?? "Resume",
    priority: overrides.priority ?? "Now",
    ownerIds: overrides.ownerIds ?? ["user-1"],
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    drivingDecisionIds: overrides.drivingDecisionIds ?? ["decision-1"],
    goal: overrides.goal ?? "Ship one clear weekly slice.",
    definitionOfDone: overrides.definitionOfDone ?? "Working proof is logged.",
    whyNow: overrides.whyNow ?? "This is the best low-friction project to resume.",
    targetStart: overrides.targetStart ?? "2026-03-17",
    targetFinish: overrides.targetFinish ?? "2026-03-21",
    estimatedSize: overrides.estimatedSize ?? "2-3 days",
    rolloverCount: overrides.rolloverCount ?? 0,
    executionTaskIds: overrides.executionTaskIds ?? ["task-1"],
    buildLogSessionIds: overrides.buildLogSessionIds ?? [],
    weeklyReviewIds: overrides.weeklyReviewIds ?? [],
    blockerSummary: overrides.blockerSummary ?? "",
  };
}

function baseTask(overrides: Partial<ExecutionTaskRecord> = {}): ExecutionTaskRecord {
  return {
    id: overrides.id ?? "task-1",
    url: overrides.url ?? "https://notion.so/task-1",
    title: overrides.title ?? "Boot the local environment",
    status: overrides.status ?? "Ready",
    assigneeIds: overrides.assigneeIds ?? ["user-1"],
    dueDate: overrides.dueDate ?? "2026-03-18",
    priority: overrides.priority ?? "P0",
    taskType: overrides.taskType ?? "Build",
    workPacketIds: overrides.workPacketIds ?? ["packet-1"],
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    estimate: overrides.estimate ?? "1h",
    completedOn: overrides.completedOn ?? "",
    taskNotes: overrides.taskNotes ?? "Verify the boot path.",
  };
}
