import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  applyDerivedSignals,
  buildTopPriorities,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  renderWeeklyReviewMarkdown,
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
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for review-packet publishing");
    }

    const flags = parseFlags(process.argv.slice(2));
    const live = flags.live;
    const today = flags.today ?? losAngelesToday();
    const currentWeekStart = startOfWeekMonday(today);
    const weekTitle = `Week of ${currentWeekStart}`;

    const config = await loadLocalPortfolioControlTowerConfig(
      process.argv[2]?.startsWith("--") ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
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
      flags.includeNextPhase
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
        markdown,
      });
      pageId = result.id;
      pageUrl = result.url;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live,
          weekTitle,
          compareStartDate,
          touchedProjects: touchedProjects.length,
          buildSessions: recentBuildSessions.length,
          pageId,
          pageUrl,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
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

function parseFlags(argv: string[]): { live: boolean; today?: string; includeNextPhase: boolean } {
  let live = false;
  let today: string | undefined;
  let includeNextPhase = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--include-next-phase") {
      includeNextPhase = true;
    }
  }

  return { live, today, includeNextPhase };
}

void main();
