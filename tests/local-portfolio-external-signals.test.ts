import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildExternalRecommendationAdjustments,
  buildExternalSignalSeedPlans,
  buildExternalSignalSummary,
  getPrimarySourceProjectId,
  parseLocalPortfolioExternalSignalProviderConfig,
  parseLocalPortfolioExternalSignalSourceConfig,
  parseLocalPortfolioExternalSignalViewPlan,
  renderExternalSignalBriefSection,
  renderWeeklyExternalSignalsSection,
  validateLocalPortfolioExternalSignalViewPlanAgainstSchemas,
  type ExternalSignalEventRecord,
  type ExternalSignalSourceRecord,
  type ExternalSignalSyncRunRecord,
} from "../src/notion/local-portfolio-external-signals.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import { renderNotionPhaseMemoryMarkdown } from "../src/notion/local-portfolio-roadmap.js";
import type { IntelligenceProjectRecord } from "../src/notion/local-portfolio-intelligence.js";
import type { WorkPacketRecord } from "../src/notion/local-portfolio-execution.js";

describe("local portfolio external signals", () => {
  test("parses the phase-5 source, provider, and view configs", async () => {
    const [sourcesRaw, providersRaw, viewsRaw] = await Promise.all([
      readConfig("../config/local-portfolio-external-signal-sources.json"),
      readConfig("../config/local-portfolio-external-signal-providers.json"),
      readConfig("../config/local-portfolio-external-signal-views.json"),
    ]);

    const sourceConfig = parseLocalPortfolioExternalSignalSourceConfig(sourcesRaw);
    const providerConfig = parseLocalPortfolioExternalSignalProviderConfig(providersRaw);
    const viewPlan = parseLocalPortfolioExternalSignalViewPlan(viewsRaw);

    expect(sourceConfig.sourceTemplates).toHaveLength(2);
    expect(providerConfig.providers).toHaveLength(3);
    expect(viewPlan.collections).toHaveLength(4);
  });

  test("builds bounded seed plans for the priority telemetry slice", async () => {
    const sourceConfig = parseLocalPortfolioExternalSignalSourceConfig(
      await readConfig("../config/local-portfolio-external-signal-sources.json"),
    );

    const plans = buildExternalSignalSeedPlans({
      projects: [
        baseProject({ id: "project-1", title: "GPT_RAG", operatingQueue: "Resume Now" }),
        baseProject({ id: "project-2", title: "SpecCompanion", operatingQueue: "Worth Finishing" }),
      ],
      packets: [basePacket({ localProjectIds: ["project-2"], priority: "Now" })],
      sourceConfig,
    });

    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans.some((plan) => plan.provider === "GitHub")).toBe(true);
    expect(plans.some((plan) => plan.localProjectId === "project-1" && plan.provider === "GitHub")).toBe(true);
    expect(plans.some((plan) => plan.localProjectId === "project-2" && plan.provider === "Vercel")).toBe(true);
    expect(plans.some((plan) => plan.status === "Needs Mapping")).toBe(true);
  });

  test("derives external summaries and additive recommendation boosts", () => {
    const project = baseProject();
    const sources: ExternalSignalSourceRecord[] = [
      {
        id: "source-1",
        url: "https://notion.so/source-1",
        title: "GPT_RAG - GitHub Repo",
        localProjectIds: ["project-1"],
        provider: "GitHub",
        sourceType: "Repo",
        identifier: "owner/repo",
        sourceUrl: "https://github.com/owner/repo",
        status: "Active",
        environment: "N/A",
        syncStrategy: "Poll",
        lastSyncedAt: "2026-03-17",
      },
      {
        id: "source-2",
        url: "https://notion.so/source-2",
        title: "GPT_RAG - Deployment Project",
        localProjectIds: ["project-1"],
        provider: "Vercel",
        sourceType: "Deployment Project",
        identifier: "prj_123",
        sourceUrl: "https://vercel.com/project",
        status: "Active",
        environment: "Production",
        syncStrategy: "Poll",
        lastSyncedAt: "2026-03-17",
      },
    ];
    const events: ExternalSignalEventRecord[] = [
      baseEvent({
        title: "PR #12 - Tighten ingestion logic",
        signalType: "Pull Request",
        status: "open",
        occurredAt: "2026-03-17",
      }),
      baseEvent({
        id: "event-2",
        title: "Workflow run - external-signal-sync",
        signalType: "Workflow Run",
        status: "success",
        occurredAt: "2026-03-16",
      }),
      baseEvent({
        id: "event-3",
        title: "Deployment - GPT_RAG",
        provider: "Vercel",
        sourceIds: ["source-2"],
        signalType: "Deployment",
        status: "ready",
        environment: "Production",
        occurredAt: "2026-03-17",
      }),
    ];

    const summary = buildExternalSignalSummary({
      project,
      sources,
      events,
      today: "2026-03-17",
    });
    const adjustments = buildExternalRecommendationAdjustments(project, summary);

    expect(summary.coverage).toBe("Repo + Deploy");
    expect(summary.latestDeploymentStatus).toBe("Success");
    expect(summary.openPrCount).toBe(1);
    expect(adjustments.finishBoost).toBeGreaterThan(0);
  });

  test("returns the first non-empty linked project id for a source", () => {
    expect(
      getPrimarySourceProjectId({
        id: "source-1",
        url: "https://notion.so/source-1",
        title: "Sandbox repo",
        localProjectIds: ["", "project-2"],
        provider: "GitHub",
        sourceType: "Repo",
        identifier: "owner/repo",
        sourceUrl: "https://github.com/owner/repo",
        status: "Active",
        environment: "N/A",
        syncStrategy: "Poll",
        lastSyncedAt: "2026-03-21",
      }),
    ).toBe("project-2");

    expect(
      getPrimarySourceProjectId({
        id: "source-2",
        url: "https://notion.so/source-2",
        title: "Unmapped repo",
        localProjectIds: [],
        provider: "GitHub",
        sourceType: "Repo",
        identifier: "owner/repo",
        sourceUrl: "https://github.com/owner/repo",
        status: "Active",
        environment: "N/A",
        syncStrategy: "Poll",
        lastSyncedAt: "2026-03-21",
      }),
    ).toBeUndefined();
  });

  test("validates the phase-5 view plan against representative schemas", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const plan = parseLocalPortfolioExternalSignalViewPlan(
      await readConfig("../config/local-portfolio-external-signal-views.json"),
    );

    const summary = validateLocalPortfolioExternalSignalViewPlanAgainstSchemas({
      plan,
      schemas: {
        sources: {
          id: plan.collections[0]!.database.dataSourceId,
          title: "External Signal Sources",
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            "Local Project": { name: "Local Project", type: "relation", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            "Source Type": { name: "Source Type", type: "select", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            Identifier: { name: "Identifier", type: "rich_text", writable: true },
            "Last Synced At": { name: "Last Synced At", type: "date", writable: true },
            Environment: { name: "Environment", type: "select", writable: true },
          },
        },
        events: {
          id: plan.collections[1]!.database.dataSourceId,
          title: "External Signal Events",
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            "Local Project": { name: "Local Project", type: "relation", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            "Signal Type": { name: "Signal Type", type: "select", writable: true },
            Status: { name: "Status", type: "rich_text", writable: true },
            Severity: { name: "Severity", type: "select", writable: true },
            "Occurred At": { name: "Occurred At", type: "date", writable: true },
            Environment: { name: "Environment", type: "select", writable: true },
          },
        },
        syncRuns: {
          id: plan.collections[2]!.database.dataSourceId,
          title: "External Signal Sync Runs",
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            "Started At": { name: "Started At", type: "date", writable: true },
            "Completed At": { name: "Completed At", type: "date", writable: true },
            "Items Written": { name: "Items Written", type: "number", writable: true },
            Failures: { name: "Failures", type: "number", writable: true },
            Scope: { name: "Scope", type: "rich_text", writable: true },
            "Items Seen": { name: "Items Seen", type: "number", writable: true },
            "Items Deduped": { name: "Items Deduped", type: "number", writable: true },
            Notes: { name: "Notes", type: "rich_text", writable: true },
          },
        },
        projects: {
          id: controlConfig.database.dataSourceId,
          title: controlConfig.database.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            "External Signal Coverage": { name: "External Signal Coverage", type: "select", writable: true },
            "Latest External Activity": { name: "Latest External Activity", type: "date", writable: true },
            "External Signal Updated": { name: "External Signal Updated", type: "date", writable: true },
            "Latest Deployment Status": { name: "Latest Deployment Status", type: "select", writable: true },
            "Recent Failed Workflow Runs": { name: "Recent Failed Workflow Runs", type: "number", writable: true },
            "Recommendation Lane": { name: "Recommendation Lane", type: "select", writable: true },
          },
        },
      },
    });

    expect(summary.validatedViews.length).toBeGreaterThan(0);
  });

  test("renders phase memory through phase seven", () => {
    const markdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: "2026-03-17",
      currentPhase: 5,
    });

    expect(markdown).toContain("## Phase 7");
    expect(markdown).toContain("Phase 5 gave us structured external telemetry");
  });

  test("renders recent signal bullets in a stable order", () => {
    const summary = buildExternalSignalSummary({
      project: baseProject(),
      sources: [
        {
          id: "source-1",
          url: "https://notion.so/source-1",
          title: "Repo",
          localProjectIds: ["project-1"],
          provider: "GitHub",
          sourceType: "Repo",
          identifier: "owner/repo",
          sourceUrl: "https://github.com/owner/repo",
          status: "Active",
          environment: "N/A",
          syncStrategy: "Poll",
          lastSyncedAt: "2026-03-17",
        },
      ],
      events: [
        baseEvent({ id: "event-a", title: "B Event", occurredAt: "2026-03-17", status: "success" }),
        baseEvent({ id: "event-b", title: "A Event", occurredAt: "2026-03-17", status: "success" }),
      ],
      today: "2026-03-17",
    });

    const markdown = renderExternalSignalBriefSection({ summary });

    expect(markdown.indexOf("[B Event]")).toBeLessThan(markdown.indexOf("[A Event]"));
  });

  test("builds recent events in a stable order before truncation", () => {
    const summary = buildExternalSignalSummary({
      project: baseProject(),
      sources: [
        {
          id: "source-1",
          url: "https://notion.so/source-1",
          title: "Repo",
          localProjectIds: ["project-1"],
          provider: "GitHub",
          sourceType: "Repo",
          identifier: "owner/repo",
          sourceUrl: "https://github.com/owner/repo",
          status: "Active",
          environment: "N/A",
          syncStrategy: "Poll",
          lastSyncedAt: "2026-03-17",
        },
      ],
      events: [
        baseEvent({ id: "event-a", title: "B Event", occurredAt: "2026-03-17", status: "success" }),
        baseEvent({ id: "event-c", title: "A Event", occurredAt: "2026-03-17", status: "failure" }),
        baseEvent({ id: "event-b", title: "A Event", occurredAt: "2026-03-17", status: "success" }),
      ],
      today: "2026-03-17",
    });

    expect(summary.recentEvents.map((event) => event.id)).toEqual(["event-a", "event-b", "event-c"]);
  });

  test("renders latest sync runs in a stable order on identical dates", () => {
    const markdown = renderWeeklyExternalSignalsSection({
      summaries: [],
      syncRuns: [
        baseSyncRun({ id: "run-a", url: "https://notion.so/run-a", title: "GitHub sync - 2026-03-17", startedAt: "2026-03-17" }),
        baseSyncRun({ id: "run-b", url: "https://notion.so/run-b", title: "GitHub sync - 2026-03-17", startedAt: "2026-03-17" }),
      ],
    });

    expect(markdown.indexOf("run-b")).toBeLessThan(markdown.indexOf("run-a"));
  });
});

async function readConfig(relativePath: string) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

function baseProject(overrides: Partial<IntelligenceProjectRecord> = {}): IntelligenceProjectRecord {
  return {
    id: overrides.id ?? "project-1",
    url: overrides.url ?? "https://notion.so/project-1",
    title: overrides.title ?? "GPT_RAG",
    currentState: overrides.currentState ?? "Active Build",
    portfolioCall: overrides.portfolioCall ?? "Finish",
    momentum: overrides.momentum ?? "Warm",
    needsReview: overrides.needsReview ?? false,
    nextMove: overrides.nextMove ?? "Boot the local environment",
    biggestBlocker: overrides.biggestBlocker ?? "Need one clear implementation push",
    lastActive: overrides.lastActive ?? "2026-03-15",
    dateUpdated: overrides.dateUpdated ?? "2026-03-16",
    lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-15",
    buildSessionCount: overrides.buildSessionCount ?? 3,
    relatedResearchCount: overrides.relatedResearchCount ?? 1,
    supportingSkillsCount: overrides.supportingSkillsCount ?? 1,
    linkedToolCount: overrides.linkedToolCount ?? 1,
    setupFriction: overrides.setupFriction ?? "Low",
    runsLocally: overrides.runsLocally ?? "Yes",
    buildMaturity: overrides.buildMaturity ?? "Feature Complete",
    shipReadiness: overrides.shipReadiness ?? "Near Ship",
    effortToDemo: overrides.effortToDemo ?? "1 day",
    effortToShip: overrides.effortToShip ?? "2-3 days",
    oneLinePitch: overrides.oneLinePitch ?? "A retrieval-augmented generation tool.",
    valueOutcome: overrides.valueOutcome ?? "Create a strong demoable artifact",
    monetizationValue: overrides.monetizationValue ?? "Strategic leverage",
    evidenceConfidence: overrides.evidenceConfidence ?? "High",
    docsQuality: overrides.docsQuality ?? "Strong",
    testPosture: overrides.testPosture ?? "Some",
    category: overrides.category ?? "Dev Tool",
    operatingQueue: overrides.operatingQueue ?? "Resume Now",
    nextReviewDate: overrides.nextReviewDate ?? "2026-03-24",
    evidenceFreshness: overrides.evidenceFreshness ?? "Fresh",
    relatedResearchIds: overrides.relatedResearchIds ?? ["research-1"],
    supportingSkillIds: overrides.supportingSkillIds ?? ["skill-1"],
    toolStackIds: overrides.toolStackIds ?? ["tool-1"],
    recommendationRunIds: overrides.recommendationRunIds ?? [],
    projectShape: overrides.projectShape ?? ["Tool"],
    deploymentSurface: overrides.deploymentSurface ?? ["CLI"],
    primaryTool: overrides.primaryTool ?? "OpenAI",
    externalSignalCoverage: overrides.externalSignalCoverage,
    latestExternalActivity: overrides.latestExternalActivity,
    latestDeploymentStatus: overrides.latestDeploymentStatus,
    openPrCount: overrides.openPrCount,
    recentFailedWorkflowRuns: overrides.recentFailedWorkflowRuns,
    externalSignalUpdated: overrides.externalSignalUpdated,
    recommendationLane: overrides.recommendationLane,
    recommendationScore: overrides.recommendationScore,
    recommendationConfidence: overrides.recommendationConfidence,
    recommendationUpdated: overrides.recommendationUpdated,
  };
}

function basePacket(overrides: Partial<WorkPacketRecord> = {}): WorkPacketRecord {
  return {
    id: overrides.id ?? "packet-1",
    url: overrides.url ?? "https://notion.so/packet-1",
    title: overrides.title ?? "Resume GPT_RAG",
    status: overrides.status ?? "In Progress",
    packetType: overrides.packetType ?? "Resume",
    priority: overrides.priority ?? "Standby",
    ownerIds: overrides.ownerIds ?? [],
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    drivingDecisionIds: overrides.drivingDecisionIds ?? [],
    goal: overrides.goal ?? "Ship a stable telemetry slice",
    definitionOfDone: overrides.definitionOfDone ?? "One stable sync run",
    whyNow: overrides.whyNow ?? "It is the next highest-value slice",
    targetStart: overrides.targetStart ?? "2026-03-17",
    targetFinish: overrides.targetFinish ?? "2026-03-18",
    estimatedSize: overrides.estimatedSize ?? "1 day",
    rolloverCount: overrides.rolloverCount ?? 0,
    executionTaskIds: overrides.executionTaskIds ?? [],
    buildLogSessionIds: overrides.buildLogSessionIds ?? [],
    weeklyReviewIds: overrides.weeklyReviewIds ?? [],
    blockerSummary: overrides.blockerSummary ?? "",
  };
}

function baseEvent(overrides: Partial<ExternalSignalEventRecord> = {}): ExternalSignalEventRecord {
  return {
    id: overrides.id ?? "event-1",
    url: overrides.url ?? "https://notion.so/event-1",
    title: overrides.title ?? "Workflow run - external-signal-sync",
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    sourceIds: overrides.sourceIds ?? ["source-1"],
    provider: overrides.provider ?? "GitHub",
    signalType: overrides.signalType ?? "Workflow Run",
    occurredAt: overrides.occurredAt ?? "2026-03-17",
    status: overrides.status ?? "success",
    environment: overrides.environment ?? "N/A",
    severity: overrides.severity ?? "Info",
    sourceIdValue: overrides.sourceIdValue ?? "123",
    sourceUrl: overrides.sourceUrl ?? "https://example.com",
    syncRunIds: overrides.syncRunIds ?? ["run-1"],
    eventKey: overrides.eventKey ?? "event-1",
    summary: overrides.summary ?? "Workflow run finished successfully.",
    rawExcerpt: overrides.rawExcerpt ?? "success",
  };
}

function baseSyncRun(overrides: Partial<ExternalSignalSyncRunRecord> = {}): ExternalSignalSyncRunRecord {
  return {
    id: overrides.id ?? "run-1",
    url: overrides.url ?? "https://notion.so/run-1",
    title: overrides.title ?? "GitHub sync - 2026-03-17",
    provider: overrides.provider ?? "GitHub",
    status: overrides.status ?? "Succeeded",
    startedAt: overrides.startedAt ?? "2026-03-17",
    completedAt: overrides.completedAt ?? "2026-03-17",
    itemsSeen: overrides.itemsSeen ?? 1,
    itemsWritten: overrides.itemsWritten ?? 1,
    itemsDeduped: overrides.itemsDeduped ?? 0,
    failures: overrides.failures ?? 0,
    scope: overrides.scope ?? "Weekly refresh",
    cursor: overrides.cursor ?? "",
    notes: overrides.notes ?? "",
  };
}
