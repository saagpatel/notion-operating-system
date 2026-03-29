import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  applyDerivedSignals,
  calculateControlTowerMetrics,
  deriveEvidenceFreshness,
  deriveNextReviewDate,
  deriveOperatingQueue,
  parseLocalPortfolioControlTowerConfig,
  renderCommandCenterMarkdown,
  renderWeeklyReviewMarkdown,
  type ControlTowerBuildSessionRecord,
  type ControlTowerProjectRecord,
} from "../src/notion/local-portfolio-control-tower.js";
import {
  buildDerivedPropertyUpdates,
  buildNextControlTowerPhaseState,
  countControlTowerChangedRows,
} from "../src/notion/control-tower-sync.js";
import {
  buildRoadmapPhases,
  renderLocalPortfolioAdrMarkdown,
  renderNotionRoadmapMarkdown,
} from "../src/notion/local-portfolio-roadmap.js";

const TODAY = "2026-03-17";

describe("local portfolio control tower rules", () => {
  test("parses the repo control-tower config", async () => {
    const raw = JSON.parse(
      await readFile(new URL("../config/local-portfolio-control-tower.json", import.meta.url), "utf8"),
    );
    const config = parseLocalPortfolioControlTowerConfig(raw);

    expect(config.database.name).toBe("Local Portfolio Projects");
    expect(config.fieldOwnership.derived).toEqual(
      expect.arrayContaining([
        "Operating Queue",
        "Next Review Date",
        "Evidence Freshness",
        "Recommendation Lane",
        "Recommendation Score",
        "Recommendation Confidence",
        "Recommendation Updated",
      ]),
    );
    expect(config.queuePrecedence).toContain("Resume Now");
  });

  test("derives queue precedence in the expected order", async () => {
    const config = await loadConfig();

    expect(
      deriveOperatingQueue({
        currentState: "Shipped",
        needsReview: true,
        portfolioCall: "Finish",
        runsLocally: "Yes",
        setupFriction: "Low",
        momentum: "Hot",
      }),
    ).toBe("Shipped");

    expect(
      deriveOperatingQueue({
        currentState: "Needs Decision",
        needsReview: true,
        portfolioCall: "Finish",
        runsLocally: "Yes",
        setupFriction: "Low",
        momentum: "Warm",
      }),
    ).toBe("Needs Review");

    const project = applyDerivedSignals(
      {
        ...baseProject(),
        currentState: "Active Build",
        portfolioCall: "Build Now",
        runsLocally: "Yes",
        setupFriction: "Low",
      },
      config,
      TODAY,
    );
    expect(project.operatingQueue).toBe("Resume Now");
  });

  test("derives review dates and freshness windows from the newest evidence date", async () => {
    const config = await loadConfig();
    const project = baseProject({
      currentState: "Ready to Demo",
      lastActive: "2026-03-10",
      dateUpdated: "2026-03-01",
      lastBuildSessionDate: "2026-03-12",
    });

    expect(deriveNextReviewDate(project, config.reviewCadenceDays)).toBe("2026-03-26");
    expect(deriveEvidenceFreshness(project, config.freshnessWindows, TODAY)).toBe("Fresh");
    expect(
      deriveEvidenceFreshness(
        {
          ...project,
          lastActive: "2026-01-01",
          lastBuildSessionDate: "",
          dateUpdated: "2026-01-10",
        },
        config.freshnessWindows,
        TODAY,
      ),
    ).toBe("Stale");
  });

  test("calculates completeness and review metrics", async () => {
    const config = await loadConfig();
    const projects = [
      applyDerivedSignals(baseProject({ title: "Needs Decision", currentState: "Needs Decision" }), config, TODAY),
      applyDerivedSignals(
        baseProject({
          title: "Orphan",
          currentState: "Active Build",
          nextMove: "",
          buildSessionCount: 0,
          relatedResearchCount: 0,
          supportingSkillsCount: 0,
          linkedToolCount: 0,
          lastActive: "",
          lastBuildSessionDate: "",
          dateUpdated: "2025-12-01",
        }),
        config,
        TODAY,
      ),
    ];
    const metrics = calculateControlTowerMetrics(projects, [], TODAY);

    expect(metrics.queueCounts["Needs Decision"]).toBe(1);
    expect(metrics.missingNextMove).toBe(1);
    expect(metrics.missingLastActive).toBe(1);
    expect(metrics.orphanedProjects).toBe(1);
  });

  test("counts only the rows whose derived properties actually changed", async () => {
    const config = await loadConfig();
    const previousProjects = [
      applyDerivedSignals(
        baseProject({
          id: "project-stable",
          title: "Stable",
          currentState: "Active Build",
          portfolioCall: "Build Now",
          lastActive: "2026-03-16",
          lastBuildSessionDate: "2026-03-16",
          dateUpdated: "2026-03-16",
        }),
        config,
        TODAY,
      ),
      applyDerivedSignals(
        baseProject({
          id: "project-changed",
          title: "Changed",
          currentState: "Active Build",
          portfolioCall: "Build Now",
          lastActive: "2026-01-01",
          lastBuildSessionDate: "2026-01-01",
          dateUpdated: "2026-01-01",
        }),
        config,
        TODAY,
      ),
    ];

    const nextProjects = [
      previousProjects[0]!,
      {
        ...previousProjects[1]!,
        evidenceFreshness: "Stale" as const,
        nextReviewDate: "2026-03-18",
      },
    ];

    expect(countControlTowerChangedRows(previousProjects, nextProjects)).toBe(1);
  });

  test("builds live updates only for changed derived fields", () => {
    const previous = baseProject({
      operatingQueue: "Resume Now",
      nextReviewDate: "2026-03-20",
      evidenceFreshness: "Fresh",
    });
    const next = {
      ...previous,
      nextReviewDate: "2026-03-27",
    };

    expect(buildDerivedPropertyUpdates(previous, next)).toEqual({
      "Next Review Date": { date: { start: "2026-03-27" } },
    });
  });

  test("emits no live updates when derived fields are unchanged", () => {
    const stable = baseProject({
      operatingQueue: "Resume Now",
      nextReviewDate: "2026-03-20",
      evidenceFreshness: "Fresh",
    });

    expect(buildDerivedPropertyUpdates(stable, { ...stable })).toEqual({});
  });

  test("keeps changed-row counting stable when multiple fields change on one row", () => {
    const previousProjects = [
      baseProject({
        id: "project-1",
        operatingQueue: "Worth Finishing",
        nextReviewDate: "2026-03-20",
        evidenceFreshness: "Aging",
      }),
      baseProject({
        id: "project-2",
        operatingQueue: "Resume Now",
        nextReviewDate: "2026-03-18",
        evidenceFreshness: "Fresh",
      }),
    ];
    const nextProjects = [
      {
        ...previousProjects[0]!,
        operatingQueue: "Resume Now" as const,
        nextReviewDate: "2026-03-27",
        evidenceFreshness: "Stale" as const,
      },
      previousProjects[1]!,
    ];

    expect(countControlTowerChangedRows(previousProjects, nextProjects)).toBe(1);
  });

  test("captures the baseline once and keeps later sync metrics deterministic", () => {
    const metrics = {
      totalProjects: 1,
      queueCounts: {
        Shipped: 0,
        "Needs Review": 0,
        "Needs Decision": 0,
        "Worth Finishing": 0,
        "Resume Now": 1,
        "Cold Storage": 0,
        Watch: 0,
      },
      overdueReviews: 0,
      staleActiveProjects: 0,
      missingNextMove: 0,
      missingLastActive: 0,
      orphanedProjects: 0,
      recentBuildSessions: 1,
    };

    const initial = buildNextControlTowerPhaseState(
      {
        currentPhase: 1,
        currentPhaseStatus: "Active",
      },
      metrics,
      "2026-03-17",
    );
    const followUp = buildNextControlTowerPhaseState(
      {
        ...initial.phaseState,
        baselineMetrics: metrics,
        baselineCapturedAt: "2026-03-17",
      },
      {
        ...metrics,
        recentBuildSessions: 2,
      },
      "2026-03-24",
    );

    expect(initial.baselineCaptured).toBe(true);
    expect(initial.phaseState.baselineCapturedAt).toBe("2026-03-17");
    expect(initial.phaseState.lastSyncMetrics).toEqual(metrics);
    expect(followUp.baselineCaptured).toBe(false);
    expect(followUp.phaseState.baselineCapturedAt).toBe("2026-03-17");
    expect(followUp.phaseState.baselineMetrics).toEqual(metrics);
    expect(followUp.phaseState.lastSyncMetrics).toEqual({
      ...metrics,
      recentBuildSessions: 2,
    });
  });

  test("renders command-center, review-packet, roadmap, and ADR artifacts", async () => {
    const config = await loadConfig();
    const projects = [
      applyDerivedSignals(
        baseProject({
          title: "Resume Fast",
          currentState: "Active Build",
          portfolioCall: "Build Now",
          nextMove: "Run the local boot flow",
        }),
        config,
        TODAY,
      ),
    ];
    const sessions: ControlTowerBuildSessionRecord[] = [
      {
        id: "session-1",
        url: "https://notion.so/session-1",
        title: "Shipped command center scaffolding",
        sessionDate: "2026-03-16",
        outcome: "Shipped",
        localProjectIds: [projects[0]!.id],
      },
    ];

    const metrics = calculateControlTowerMetrics(projects, sessions, TODAY);
    const commandCenter = renderCommandCenterMarkdown({
      generatedAt: TODAY,
      metrics,
      baselineMetrics: metrics,
      projects,
      recentBuildSessions: sessions,
      config,
      today: TODAY,
    });
    const reviewPacket = renderWeeklyReviewMarkdown({
      weekTitle: "Week of 2026-03-16",
      compareStartDate: "2026-03-09",
      compareLabel: "Since 2026-03-09",
      projectsChanged: projects,
      projectsNeedDecision: [],
      projectsWorthFinishing: [],
      overdueProjects: [],
      staleActiveProjects: [],
      recentBuildSessions: sessions,
      topPrioritiesNextWeek: ["Resume Resume Fast."],
      nextPhaseBrief: "Phase 2 will add the project decision register.",
    });
    const roadmap = renderNotionRoadmapMarkdown({
      generatedAt: TODAY,
      currentPhase: 2,
      currentPhaseStatus: "Planned",
      baselineMetrics: metrics,
      latestMetrics: metrics,
      lastClosedPhase: 1,
    });
    const adr = renderLocalPortfolioAdrMarkdown();

    expect(commandCenter).toContain("Local Portfolio Command Center");
    expect(commandCenter).toContain("Saved Views");
    expect(reviewPacket).toContain("## Next Phase");
    expect(roadmap).toContain("Phase: 2 - Project Execution System");
    expect(roadmap).toContain("## Phase Transition Memory");
    expect(roadmap).toContain("Build the project execution system around Local Portfolio Projects");
    expect(roadmap).toContain("## Phase Memory");
    expect(roadmap).toContain("Phase 2 gave us structured execution data");
    expect(roadmap).toContain("Phase 3 - Cross-Database Intelligence");
    expect(roadmap).toContain("Phase 3 will turn the combined project, execution, research, skill, and tool records");
    expect(roadmap).toContain("### Phase 4: Premium-Native Augmentation");
    expect(roadmap).toContain("### Phase 5: External Signal Integration");
    expect(roadmap).toContain("### Phase 6: Cross-System Governance");
    expect(adr).toContain("Local Portfolio Projects is the project control tower");
    expect(buildRoadmapPhases(2, "Planned", true)[1]?.status).toBe("Planned");
  });
});

async function loadConfig() {
  const raw = JSON.parse(
    await readFile(new URL("../config/local-portfolio-control-tower.json", import.meta.url), "utf8"),
  );
  return parseLocalPortfolioControlTowerConfig(raw);
}

function baseProject(overrides: Partial<ControlTowerProjectRecord> = {}): ControlTowerProjectRecord {
  return {
    id: overrides.id ?? "project-1",
    url: overrides.url ?? "https://notion.so/project-1",
    title: overrides.title ?? "Sample Project",
    currentState: overrides.currentState ?? "Active Build",
    portfolioCall: overrides.portfolioCall ?? "Finish",
    momentum: overrides.momentum ?? "Warm",
    needsReview: overrides.needsReview ?? false,
    nextMove: overrides.nextMove ?? "Ship the next small milestone",
    biggestBlocker: overrides.biggestBlocker ?? "Need one more pass",
    lastActive: overrides.lastActive ?? "2026-03-12",
    dateUpdated: overrides.dateUpdated ?? "2026-03-11",
    lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-13",
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
    oneLinePitch: overrides.oneLinePitch ?? "A control-tower test project",
    valueOutcome: overrides.valueOutcome ?? "Clear PM visibility",
    monetizationValue: overrides.monetizationValue ?? "Strategic leverage",
    evidenceConfidence: overrides.evidenceConfidence ?? "High",
    docsQuality: overrides.docsQuality ?? "Strong",
    testPosture: overrides.testPosture ?? "Some",
    category: overrides.category ?? "Dev Tool",
    operatingQueue: overrides.operatingQueue,
    nextReviewDate: overrides.nextReviewDate,
    evidenceFreshness: overrides.evidenceFreshness,
  };
}
