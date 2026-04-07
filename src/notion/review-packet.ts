import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  applyDerivedSignals,
  buildTopPriorities,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  renderWeeklyReviewMarkdown,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  multiSelectValue,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  toBuildSessionRecord,
  toControlTowerProjectRecord,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import { buildRoadmapPhases } from "./local-portfolio-roadmap.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { normalizeMarkdown, preserveManagedSections } from "../utils/markdown.js";
import { WEEKLY_EXTERNAL_SIGNALS_SECTION } from "./managed-markdown-sections.js";
import { buildWeeklyStepContract, mapWeeklyStepStatusToCommandStatus } from "./weekly-refresh-contract.js";

export interface ReviewPacketCommandOptions {
  live?: boolean;
  today?: string;
  includeNextPhase?: boolean;
  config?: string;
}

export async function runReviewPacketCommand(options: ReviewPacketCommandOptions = {}): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for review-packet publishing");
  const live = options.live ?? false;
  const today = options.today ?? losAngelesToday();
  const currentWeekStart = startOfWeekMonday(today);
  const weekTitle = `Week of ${currentWeekStart}`;

  let config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectPages, buildPages, weeklyPages, weeklySchema] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, "Name"),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, "Session Title"),
      fetchAllPages(sdk, config.relatedDataSources.weeklyReviewsId, "Week"),
      api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
    ]);

    const projects = projectPages.map((page) => applyDerivedSignals(toControlTowerProjectRecord(page), config, today));
    const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
    const compareStartDate = findCompareStartDate(weeklyPages.map((page) => page.title), currentWeekStart);
    const compareLabel =
      compareStartDate === addDays(currentWeekStart, -7)
        ? `Since ${compareStartDate} (fallback 7-day window)`
        : `Since the previous weekly packet on ${compareStartDate}`;

    const changedProjects = projects.filter((project) =>
      [project.lastActive, project.dateUpdated, project.lastBuildSessionDate].some(
        (value) => value && value >= compareStartDate,
      ),
    );
    const recentBuildSessions = buildSessions
      .filter((session) => session.sessionDate && session.sessionDate >= compareStartDate)
      .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate));
    const touchedProjectIds = new Set<string>([
      ...changedProjects.map((project) => project.id),
      ...recentBuildSessions.flatMap((session) => session.localProjectIds),
    ]);
    const touchedProjects = projects.filter((project) => touchedProjectIds.has(project.id));

    const phases = buildRoadmapPhases(
      config.phaseState.currentPhase,
      config.phaseState.currentPhaseStatus,
      config.phaseState.currentPhase > 1,
    );
  const nextPhaseBrief =
      options.includeNextPhase
        ? phases.find((phase) => phase.phase === config.phaseState.currentPhase)?.nextPhaseBrief
        : undefined;

    const markdown = renderWeeklyReviewMarkdown({
      weekTitle,
      compareStartDate,
      compareLabel,
      projectsChanged: touchedProjects,
      projectsNeedDecision: projects.filter((project) => project.operatingQueue === "Needs Decision"),
      projectsWorthFinishing: projects.filter((project) => project.operatingQueue === "Worth Finishing"),
      overdueProjects: projects.filter((project) => project.nextReviewDate && project.nextReviewDate <= today),
      staleActiveProjects: projects.filter(
        (project) => project.currentState === "Active Build" && project.evidenceFreshness === "Stale",
      ),
      recentBuildSessions,
      topPrioritiesNextWeek: buildTopPriorities(projects),
      nextPhaseBrief,
    });
    const existingWeeklyPage = weeklyPages.find((page) => page.title === weekTitle);
    const previousWeeklyMarkdown = existingWeeklyPage
      ? await api.readPageMarkdown(existingWeeklyPage.id)
      : undefined;
    const finalMarkdown = previousWeeklyMarkdown
      ? preserveManagedSections(markdown, previousWeeklyMarkdown.markdown, [WEEKLY_EXTERNAL_SIGNALS_SECTION])
      : markdown;
    const weeklyReviewWouldChange = previousWeeklyMarkdown
      ? normalizeMarkdown(finalMarkdown) !== normalizeMarkdown(previousWeeklyMarkdown.markdown)
      : true;
    const weeklyReviewPageExists = Boolean(existingWeeklyPage);

    const properties = {
      [weeklySchema.titlePropertyName]: titleValue(weekTitle),
      "Review Status": selectPropertyValue(live ? "Published" : "Draft"),
      "Top Priorities Next Week": richTextValue(buildTopPriorities(projects).join(" ")),
      "Local Projects Touched": relationValue([...touchedProjectIds]),
      "Build Log Sessions": relationValue(recentBuildSessions.map((session) => session.id)),
      Tags: multiSelectValue(["notion", "portfolio", "control-tower"]),
    };

    let pageId: string | undefined;
    let pageUrl: string | undefined;
    if (live) {
      const result = await upsertPageByTitle({
        api,
        dataSourceId: config.relatedDataSources.weeklyReviewsId,
        titlePropertyName: weeklySchema.titlePropertyName,
        title: weekTitle,
        properties,
        markdown: finalMarkdown,
      });
      pageId = result.id;
      pageUrl = result.url;
      config = {
        ...config,
        weeklyMaintenance: {
          ...config.weeklyMaintenance,
          weeklyReviewLastPublishedAt: today,
        },
      };
      await saveLocalPortfolioControlTowerConfig(
        config,
        options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
      );
    }

  const output = {
    ok: true,
    live,
    status: "clean" as string,
    wouldChange: false,
    summaryCounts: {},
    warnings: [] as string[],
    weekTitle,
    compareStartDate,
    weeklyReviewWouldChange,
    weeklyReviewPageExists,
    touchedProjects: touchedProjects.length,
    buildSessions: recentBuildSessions.length,
    pageId,
    pageUrl,
  };
  const contract = buildWeeklyStepContract({
    live,
    wouldChange: weeklyReviewWouldChange,
    summaryCounts: {
      weeklyReviewWouldChange: weeklyReviewWouldChange ? 1 : 0,
      weeklyReviewPageExists: weeklyReviewPageExists ? 1 : 0,
      touchedProjects: touchedProjects.length,
      buildSessions: recentBuildSessions.length,
    },
  });
  output.status = contract.status;
  output.wouldChange = contract.wouldChange;
  output.summaryCounts = contract.summaryCounts;
  output.warnings = contract.warnings;
  recordCommandOutputSummary(output, {
    status: mapWeeklyStepStatusToCommandStatus(contract.status),
    metadata: {
      weekTitle,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

function findCompareStartDate(weekTitles: string[], currentWeekStart: string): string {
  const prior = weekTitles
    .map((title) => title.match(/^Week of (\d{4}-\d{2}-\d{2})$/)?.[1] ?? "")
    .filter((value) => value && value < currentWeekStart)
    .sort((left, right) => right.localeCompare(left))[0];

  return prior ?? addDays(currentWeekStart, -7);
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["control-tower", "review-packet"]);
}
