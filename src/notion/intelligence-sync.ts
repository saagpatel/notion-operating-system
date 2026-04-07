import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import {
  buildProjectIntelligenceContext,
  buildRecommendation,
  calculateIntelligenceMetrics,
  renderIntelligenceCommandCenterSection,
  renderRecommendationBriefSection,
  requirePhase3Intelligence,
} from "./local-portfolio-intelligence.js";
import {
  ensurePhase3IntelligenceSchema,
  toIntelligenceProjectRecord,
  toLinkSuggestionRecord,
  toRecommendationRunRecord,
  toResearchLibraryRecord,
  toSkillLibraryRecord,
  toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";
import {
  fetchAllPages,
  relationIds,
  relationValue,
  toBuildSessionRecord,
} from "./local-portfolio-control-tower-live.js";
import {
  toExecutionTaskRecord,
  toProjectDecisionRecord,
  toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
  loadLocalPortfolioIntelligenceViewPlan,
} from "./local-portfolio-intelligence.js";
import { validateLocalPortfolioIntelligenceViewPlanAgainstSchemas } from "./local-portfolio-intelligence-views.js";
import { AppError } from "../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand, normalizeMarkdown } from "../utils/markdown.js";
import { losAngelesToday } from "../utils/date.js";
import { buildWeeklyStepContract, mapWeeklyStepStatusToCommandStatus } from "./weekly-refresh-contract.js";

const RECOMMENDATION_BRIEF_START = "<!-- codex:notion-recommendation-brief:start -->";
const RECOMMENDATION_BRIEF_END = "<!-- codex:notion-recommendation-brief:end -->";
const INTELLIGENCE_COMMAND_CENTER_START = "<!-- codex:notion-intelligence-command-center:start -->";
const INTELLIGENCE_COMMAND_CENTER_END = "<!-- codex:notion-intelligence-command-center:end -->";

export interface IntelligenceSyncCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
}

export async function runIntelligenceSyncCommand(
  options: IntelligenceSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for intelligence sync");
  const live = options.live ?? false;
  const today = options.today ?? losAngelesToday();
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let config = await loadLocalPortfolioControlTowerConfig(configPath);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (live) {
      logLiveStage(live, "Ensuring Phase 3 schema");
      config = await ensurePhase3IntelligenceSchema(sdk, config);
    }

    const phase3 = requirePhase3Intelligence(config);
    logLiveStage(live, "Loading intelligence view plan");
    const viewPlan = await loadLocalPortfolioIntelligenceViewPlan();

    const [projectSchema, buildSchema, researchSchema, skillSchema, toolSchema, decisionSchema, packetSchema, taskSchema, runSchema, suggestionSchema] =
      await Promise.all([
        api.retrieveDataSource(config.database.dataSourceId),
        api.retrieveDataSource(config.relatedDataSources.buildLogId),
        api.retrieveDataSource(config.relatedDataSources.researchId),
        api.retrieveDataSource(config.relatedDataSources.skillsId),
        api.retrieveDataSource(config.relatedDataSources.toolsId),
        api.retrieveDataSource(config.phase2Execution!.decisions.dataSourceId),
        api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
        api.retrieveDataSource(config.phase2Execution!.tasks.dataSourceId),
        api.retrieveDataSource(phase3.recommendationRuns.dataSourceId),
        api.retrieveDataSource(phase3.linkSuggestions.dataSourceId),
      ]);

    logLiveStage(live, "Validating intelligence views");
    validateLocalPortfolioIntelligenceViewPlanAgainstSchemas(viewPlan, {
      projects: projectSchema,
      recommendationRuns: runSchema,
      linkSuggestions: suggestionSchema,
    });

    logLiveStage(live, "Fetching intelligence datasets");
    const [projectPages, buildPages, researchPages, skillPages, toolPages, decisionPages, packetPages, taskPages, runPages, suggestionPages] =
      await Promise.all([
        fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
        fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
        fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
        fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
        fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
        fetchAllPages(sdk, config.phase2Execution!.decisions.dataSourceId, decisionSchema.titlePropertyName),
        fetchAllPages(sdk, config.phase2Execution!.packets.dataSourceId, packetSchema.titlePropertyName),
        fetchAllPages(sdk, config.phase2Execution!.tasks.dataSourceId, taskSchema.titlePropertyName),
        fetchAllPages(sdk, phase3.recommendationRuns.dataSourceId, runSchema.titlePropertyName),
        fetchAllPages(sdk, phase3.linkSuggestions.dataSourceId, suggestionSchema.titlePropertyName),
      ]);

    const projects = projectPages.map((page) => toIntelligenceProjectRecord(page));
    const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
    const research = researchPages.map((page) => toResearchLibraryRecord(page));
    const skills = skillPages.map((page) => toSkillLibraryRecord(page));
    const tools = toolPages.map((page) => toToolMatrixRecord(page));
    const decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
    const packets = packetPages.map((page) => toWorkPacketRecord(page));
    const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
    const runs = runPages.map((page) => toRecommendationRunRecord(page));
    const suggestions = suggestionPages.map((page) => toLinkSuggestionRecord(page));

    const contexts = projects.map((project) =>
      buildProjectIntelligenceContext({
        project,
        researchRecords: research,
        skillRecords: skills,
        toolRecords: tools,
        decisions,
        packets,
        tasks,
        buildSessions,
        today,
      }),
    );
    const recommendations = contexts.map((context) => buildRecommendation(context));
    const metrics = calculateIntelligenceMetrics({
      projects,
      recommendations,
      linkSuggestions: suggestions,
    });

    const latestWeeklyRun = runs
      .filter((run) => run.runType === "Weekly Portfolio")
      .sort((left, right) => right.runDate.localeCompare(left.runDate))[0];
    const latestDailyRun = runs
      .filter((run) => run.runType === "Daily Focus")
      .sort((left, right) => right.runDate.localeCompare(left.runDate))[0];

    const recommendationBriefs = await Promise.all(
      contexts.map(async (context, index) => {
        const recommendation = recommendations[index];
        const previous = await api.readPageMarkdown(context.project.id);
        if (!recommendation) {
          return {
            projectId: context.project.id,
            previousMarkdown: previous.markdown,
            nextMarkdown: previous.markdown,
            recommendation,
            changed: false,
          };
        }
        const nextMarkdown = mergeManagedSection(
          previous.markdown,
          renderRecommendationBriefSection({
            context: {
              ...context,
              project: {
                ...context.project,
                recommendationLane: recommendation?.lane,
                recommendationScore: recommendation?.score,
                recommendationConfidence: recommendation?.confidence,
                recommendationUpdated: today,
              },
            },
            recommendation,
          }),
          RECOMMENDATION_BRIEF_START,
          RECOMMENDATION_BRIEF_END,
        );
        return {
          projectId: context.project.id,
          previousMarkdown: previous.markdown,
          nextMarkdown,
          recommendation,
          changed: Boolean(recommendation) &&
            normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown),
        };
      }),
    );
    const projectRecommendationBriefsWouldChange = recommendationBriefs.filter((entry) => entry.changed).length;

    const previousCommandCenter = await api.readPageMarkdown(config.commandCenter.pageId!);
    const nextCommandCenter = mergeManagedSection(
      previousCommandCenter.markdown,
      renderIntelligenceCommandCenterSection({
        recommendations,
        projects: projects.map((project) => ({
          ...project,
          recommendationLane: recommendations.find((entry) => entry.projectId === project.id)?.lane,
        })),
        latestWeeklyRun,
        latestDailyRun,
        linkSuggestionQueue: suggestions,
      }),
      INTELLIGENCE_COMMAND_CENTER_START,
      INTELLIGENCE_COMMAND_CENTER_END,
    );
    const intelligenceCommandCenterSectionWouldChange =
      normalizeMarkdown(nextCommandCenter) !== normalizeMarkdown(previousCommandCenter.markdown);

    let changedProjectPages = 0;
    if (live) {
      logLiveStage(live, "Applying accepted link suggestions", {
        suggestionCount: suggestions.filter((entry) => entry.status === "Accepted").length,
      });
      const projectPageMap = new Map(projectPages.map((page) => [page.id, page]));
      const researchPageMap = new Map(researchPages.map((page) => [page.id, page]));
      const skillPageMap = new Map(skillPages.map((page) => [page.id, page]));
      const toolPageMap = new Map(toolPages.map((page) => [page.id, page]));

      await applyAcceptedLinkSuggestions({
        api,
        suggestions,
        projectPages: projectPageMap,
        researchPages: researchPageMap,
          skillPages: skillPageMap,
          toolPages: toolPageMap,
        });

      logLiveStage(live, "Refreshing recommendation briefs", { projectCount: contexts.length });
      for (const [index, entry] of recommendationBriefs.entries()) {
        logLoopProgress(live, "intelligence-sync", "Project brief", index + 1, recommendationBriefs.length);
        const context = contexts[index];
        const recommendation = entry?.recommendation;
        if (!recommendation || !context) {
          continue;
        }

        await api.updatePageProperties({
          pageId: context.project.id,
          properties: {
            "Recommendation Lane": { select: { name: recommendation.lane } },
            "Recommendation Score": { number: recommendation.score },
            "Recommendation Confidence": { select: { name: recommendation.confidence } },
            "Recommendation Updated": { date: { start: today } },
          },
        });

        if (entry.changed) {
          assertSafeReplacement(entry.previousMarkdown, entry.nextMarkdown);
          await api.patchPageMarkdown({
            pageId: context.project.id,
            command: "replace_content",
            newMarkdown: buildReplaceCommand(entry.nextMarkdown),
          });
          changedProjectPages += 1;
        }
      }

      logLiveStage(live, "Refreshing intelligence command center");
      if (intelligenceCommandCenterSectionWouldChange) {
        assertSafeReplacement(previousCommandCenter.markdown, nextCommandCenter);
        await api.patchPageMarkdown({
          pageId: config.commandCenter.pageId!,
          command: "replace_content",
          newMarkdown: buildReplaceCommand(nextCommandCenter),
        });
      }

      logLiveStage(live, "Persisting intelligence sync metrics");
      const nextConfig = {
        ...config,
        phaseState: {
          ...config.phaseState,
          currentPhaseStatus: "In Progress",
        },
        phase3Intelligence: {
          ...phase3,
          baselineCapturedAt: phase3.baselineCapturedAt ?? today,
          baselineMetrics: phase3.baselineMetrics ?? serializeMetrics(metrics),
          lastSyncAt: today,
          lastSyncMetrics: serializeMetrics(metrics),
        },
      };
      await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);
      config = nextConfig;
    }

    const output = {
      ok: true,
      live,
      status: "clean" as string,
      wouldChange: false,
      summaryCounts: {},
      warnings: [] as string[],
      changedProjectPages,
      projectRecommendationBriefsWouldChange,
      intelligenceCommandCenterSectionWouldChange,
      metrics,
      latestWeeklyRunId: latestWeeklyRun?.id,
      latestDailyRunId: latestDailyRun?.id,
    };
    const contract = buildWeeklyStepContract({
      live,
      wouldChange:
        projectRecommendationBriefsWouldChange > 0 || intelligenceCommandCenterSectionWouldChange,
      summaryCounts: {
        projectRecommendationBriefsWouldChange,
        intelligenceCommandCenterSectionWouldChange: intelligenceCommandCenterSectionWouldChange ? 1 : 0,
        totalProjects: metrics.totalProjects,
        resumeCandidates: metrics.resumeCandidates,
        proposedLinkSuggestions: metrics.proposedLinkSuggestions,
      },
    });
    output.status = contract.status;
    output.wouldChange = contract.wouldChange;
    output.summaryCounts = contract.summaryCounts;
    output.warnings = contract.warnings;
    recordCommandOutputSummary(output, {
      status: mapWeeklyStepStatusToCommandStatus(contract.status),
      metadata: {
        latestWeeklyRunId: latestWeeklyRun?.id,
        latestDailyRunId: latestDailyRun?.id,
      },
    });
    console.log(JSON.stringify(output, null, 2));
}

function logLiveStage(live: boolean, stage: string, details?: Record<string, unknown>): void {
  if (!live) {
    return;
  }

  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[intelligence-sync] ${stage}${suffix}`);
}

function logLoopProgress(live: boolean, scope: string, label: string, index: number, total: number): void {
  if (!live) {
    return;
  }

  console.error(`[${scope}] ${label} ${index}/${total}`);
}

async function applyAcceptedLinkSuggestions(input: {
  api: DirectNotionClient;
  suggestions: ReturnType<typeof toLinkSuggestionRecord>[];
  projectPages: Map<string, Awaited<ReturnType<typeof fetchAllPages>>[number]>;
  researchPages: Map<string, Awaited<ReturnType<typeof fetchAllPages>>[number]>;
  skillPages: Map<string, Awaited<ReturnType<typeof fetchAllPages>>[number]>;
  toolPages: Map<string, Awaited<ReturnType<typeof fetchAllPages>>[number]>;
}): Promise<void> {
  for (const suggestion of input.suggestions.filter((entry) => entry.status === "Accepted")) {
    const projectId = suggestion.localProjectIds[0];
    if (!projectId) {
      continue;
    }
    const projectPage = input.projectPages.get(projectId);
    if (!projectPage) {
      continue;
    }

    const projectResearchIds = new Set(relationIds(projectPage.properties["Related Research"]));
    const projectSkillIds = new Set(relationIds(projectPage.properties["Supporting Skills"]));
    const projectToolIds = new Set(relationIds(projectPage.properties["Tool Stack Records"]));

    if (suggestion.suggestedResearchIds[0]) {
      projectResearchIds.add(suggestion.suggestedResearchIds[0]);
      await input.api.updatePageProperties({
        pageId: projectId,
        properties: {
          "Related Research": relationValue([...projectResearchIds]),
        },
      });
      const researchPage = input.researchPages.get(suggestion.suggestedResearchIds[0]);
      if (researchPage) {
        const relatedProjects = new Set(relationIds(researchPage.properties["Related Local Projects"]));
        relatedProjects.add(projectId);
        await input.api.updatePageProperties({
          pageId: researchPage.id,
          properties: {
            "Related Local Projects": relationValue([...relatedProjects]),
          },
        });
      }
    }

    if (suggestion.suggestedSkillIds[0]) {
      projectSkillIds.add(suggestion.suggestedSkillIds[0]);
      await input.api.updatePageProperties({
        pageId: projectId,
        properties: {
          "Supporting Skills": relationValue([...projectSkillIds]),
        },
      });
      const skillPage = input.skillPages.get(suggestion.suggestedSkillIds[0]);
      if (skillPage) {
        const relatedProjects = new Set(relationIds(skillPage.properties["Related Local Projects"]));
        relatedProjects.add(projectId);
        await input.api.updatePageProperties({
          pageId: skillPage.id,
          properties: {
            "Related Local Projects": relationValue([...relatedProjects]),
          },
        });
      }
    }

    if (suggestion.suggestedToolIds[0]) {
      projectToolIds.add(suggestion.suggestedToolIds[0]);
      await input.api.updatePageProperties({
        pageId: projectId,
        properties: {
          "Tool Stack Records": relationValue([...projectToolIds]),
        },
      });
      const toolPage = input.toolPages.get(suggestion.suggestedToolIds[0]);
      if (toolPage) {
        const relatedProjects = new Set(relationIds(toolPage.properties["Linked Local Projects"]));
        relatedProjects.add(projectId);
        await input.api.updatePageProperties({
          pageId: toolPage.id,
          properties: {
            "Linked Local Projects": relationValue([...relatedProjects]),
          },
        });
      }
    }
  }
}

function serializeMetrics(metrics: ReturnType<typeof calculateIntelligenceMetrics>): Record<string, number | string[]> {
  return {
    totalProjects: metrics.totalProjects,
    resumeCandidates: metrics.resumeCandidates,
    finishCandidates: metrics.finishCandidates,
    investigateCandidates: metrics.investigateCandidates,
    deferCandidates: metrics.deferCandidates,
    monitorProjects: metrics.monitorProjects,
    orphanedProjects: metrics.orphanedProjects,
    supportGapProjects: metrics.supportGapProjects,
    proposedLinkSuggestions: metrics.proposedLinkSuggestions,
    acceptedLinkSuggestions: metrics.acceptedLinkSuggestions,
  };
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["intelligence", "sync"]);
}
