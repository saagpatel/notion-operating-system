import { describe, expect, test } from "vitest";

import {
  buildOperationalRolloutPlan,
  classifyOperationalRolloutProject,
} from "../src/notion/operational-rollout.js";
import type { LocalPortfolioActuationTargetConfig } from "../src/notion/local-portfolio-actuation.js";
import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import type { ExternalSignalSourceRecord } from "../src/notion/local-portfolio-external-signals.js";

describe("operational rollout", () => {
  test("selects an active allowlisted GitHub project as the pilot", () => {
    const jobProject = baseProject({
      id: "job-project",
      title: "JobCommandCenter",
      operatingQueue: "Worth Finishing",
      shipReadiness: "Near Ship",
      buildMaturity: "Demoable",
      runsLocally: "Partial",
    });
    const otherProject = baseProject({
      id: "model-project",
      title: "ModelColosseum",
      operatingQueue: "Worth Finishing",
      shipReadiness: "Ship-Ready",
      buildMaturity: "Demoable",
    });
    const plan = buildOperationalRolloutPlan({
      projects: [jobProject, otherProject],
      githubSources: [
        baseSource({
          id: "job-source",
          localProjectIds: ["job-project"],
          identifier: "saagpatel/JobCommandCenter",
          sourceUrl: "https://github.com/saagpatel/JobCommandCenter",
          status: "Active",
        }),
        baseSource({
          id: "model-source",
          localProjectIds: ["model-project"],
          status: "Needs Mapping",
        }),
      ],
      targetConfig: baseTargetConfig({
        targets: [
          {
            title: "JobCommandCenter",
            localProjectId: "job-project",
            sourceIdentifier: "saagpatel/JobCommandCenter",
            sourceUrl: "https://github.com/saagpatel/JobCommandCenter",
            allowedActions: ["github.create_issue"],
            titlePrefix: "[Portfolio]",
            defaultLabels: [],
            supportsIssueCreate: true,
            supportsPrComment: true,
          },
        ],
      }),
    });

    expect(plan.pilotCandidate?.projectTitle).toBe("JobCommandCenter");
    expect(plan.wave1Shortlist).toHaveLength(1);
    expect(plan.wave2Queue[0]?.projectTitle).toBe("ModelColosseum");
  });

  test("keeps scaffolded seeded projects notion-only until they are ready", () => {
    const candidate = classifyOperationalRolloutProject({
      project: baseProject({
        title: "SignalDecay",
        operatingQueue: "Resume Now",
        shipReadiness: "Not Ready",
        buildMaturity: "Scaffolded",
        runsLocally: "Unknown",
      }),
      githubSources: [
        baseSource({
          id: "signal-source",
          localProjectIds: ["project-1"],
          status: "Needs Mapping",
        }),
      ],
      targetConfig: baseTargetConfig(),
    });

    expect(candidate.classification).toBe("keep Notion-only");
    expect(candidate.githubLane).toBe("seeded_not_ready");
  });

  test("marks high-friction needs-decision projects as not worth migrating yet", () => {
    const candidate = classifyOperationalRolloutProject({
      project: baseProject({
        title: "knowledgecore",
        currentState: "Needs Decision",
        operatingQueue: "Needs Decision",
        shipReadiness: "Not Ready",
        buildMaturity: "Functional Core",
        runsLocally: "Partial",
        setupFriction: "High",
      }),
      githubSources: [],
      targetConfig: baseTargetConfig(),
    });

    expect(candidate.classification).toBe("not worth migrating yet");
  });

  test("allows one seeded candidate into wave one only when no known repo exists", () => {
    const plan = buildOperationalRolloutPlan({
      projects: [
        baseProject({
          id: "project-a",
          title: "DevToolsTranslator",
          operatingQueue: "Worth Finishing",
          shipReadiness: "Near Ship",
          buildMaturity: "Feature Complete",
          runsLocally: "Yes",
        }),
      ],
      githubSources: [
        baseSource({
          id: "source-a",
          localProjectIds: ["project-a"],
          status: "Needs Mapping",
        }),
      ],
      targetConfig: baseTargetConfig(),
    });

    expect(plan.wave1Shortlist).toHaveLength(1);
    expect(plan.wave1Shortlist[0]?.githubLane).toBe("seeded_needs_mapping");
  });
});

function baseProject(overrides: Partial<ControlTowerProjectRecord> = {}): ControlTowerProjectRecord {
  return {
    id: overrides.id ?? "project-1",
    url: overrides.url ?? "https://notion.so/project-1",
    title: overrides.title ?? "GPT_RAG",
    currentState: overrides.currentState ?? "Active Build",
    portfolioCall: overrides.portfolioCall ?? "Finish",
    momentum: overrides.momentum ?? "Warm",
    needsReview: overrides.needsReview ?? false,
    nextMove: overrides.nextMove ?? "Ship the next slice",
    biggestBlocker: overrides.biggestBlocker ?? "",
    lastActive: overrides.lastActive ?? "2026-03-21",
    dateUpdated: overrides.dateUpdated ?? "2026-03-21",
    lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-20",
    buildSessionCount: overrides.buildSessionCount ?? 3,
    relatedResearchCount: overrides.relatedResearchCount ?? 1,
    supportingSkillsCount: overrides.supportingSkillsCount ?? 1,
    linkedToolCount: overrides.linkedToolCount ?? 1,
    setupFriction: overrides.setupFriction ?? "Medium",
    runsLocally: overrides.runsLocally ?? "Yes",
    buildMaturity: overrides.buildMaturity ?? "Feature Complete",
    shipReadiness: overrides.shipReadiness ?? "Near Ship",
    effortToDemo: overrides.effortToDemo ?? "1-2 sessions",
    effortToShip: overrides.effortToShip ?? "1 sprint",
    oneLinePitch: overrides.oneLinePitch ?? "One-line pitch",
    valueOutcome: overrides.valueOutcome ?? "High leverage",
    monetizationValue: overrides.monetizationValue ?? "Strategic",
    evidenceConfidence: overrides.evidenceConfidence ?? "High",
    docsQuality: overrides.docsQuality ?? "Good",
    testPosture: overrides.testPosture ?? "Covered",
    category: overrides.category ?? "Desktop App",
    operatingQueue: overrides.operatingQueue ?? "Worth Finishing",
    nextReviewDate: overrides.nextReviewDate ?? "2026-03-28",
    evidenceFreshness: overrides.evidenceFreshness ?? "Fresh",
  };
}

function baseSource(overrides: Partial<ExternalSignalSourceRecord> = {}): ExternalSignalSourceRecord {
  return {
    id: overrides.id ?? "source-1",
    url: overrides.url ?? "https://notion.so/source-1",
    title: overrides.title ?? "Project - GitHub Repo",
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    provider: overrides.provider ?? "GitHub",
    sourceType: overrides.sourceType ?? "Repo",
    identifier: overrides.identifier ?? "",
    sourceUrl: overrides.sourceUrl ?? "",
    status: overrides.status ?? "Needs Mapping",
    environment: overrides.environment ?? "N/A",
    syncStrategy: overrides.syncStrategy ?? "Poll",
    lastSyncedAt: overrides.lastSyncedAt ?? "",
  };
}

function baseTargetConfig(
  overrides: Partial<LocalPortfolioActuationTargetConfig> = {},
): LocalPortfolioActuationTargetConfig {
  return {
    version: 1,
    strategy: {
      primary: "repo_config",
      fallback: "manual_review",
      notes: [],
    },
    defaults: {
      allowedActions: ["github.create_issue"],
      titlePrefix: "[Portfolio]",
      defaultLabels: [],
      supportsIssueCreate: true,
      supportsPrComment: true,
    },
    targets: overrides.targets ?? [],
  };
}
