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
import { buildExternalSignalSummary, requirePhase5ExternalSignals } from "./local-portfolio-external-signals.js";
import { toExternalSignalEventRecord, toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
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
import { isNotionPolicyBlockedError, syncManagedMarkdownSection } from "./managed-markdown-sync.js";

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
    const phase5 = config.phase5ExternalSignals ? requirePhase5ExternalSignals(config) : undefined;
    logLiveStage(live, "Loading intelligence view plan");
    const viewPlan = await loadLocalPortfolioIntelligenceViewPlan();

    const [projectSchema, buildSchema, researchSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
      api.retrieveDataSource(config.relatedDataSources.researchId),
    ]);
    const [skillSchema, toolSchema, decisionSchema] = await Promise.all([
      api.retrieveDataSource(config.relatedDataSources.skillsId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
      api.retrieveDataSource(config.phase2Execution!.decisions.dataSourceId),
    ]);
    const [packetSchema, taskSchema, runSchema, suggestionSchema] = await Promise.all([
      api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.tasks.dataSourceId),
      api.retrieveDataSource(phase3.recommendationRuns.dataSourceId),
      api.retrieveDataSource(phase3.linkSuggestions.dataSourceId),
    ]);
    const [sourceSchema, eventSchema] = await Promise.all([
      phase5 ? api.retrieveDataSource(phase5.sources.dataSourceId) : Promise.resolve(undefined),
      phase5 ? api.retrieveDataSource(phase5.events.dataSourceId) : Promise.resolve(undefined),
    ]);

    logLiveStage(live, "Validating intelligence views");
    validateLocalPortfolioIntelligenceViewPlanAgainstSchemas(viewPlan, {
      projects: projectSchema,
      recommendationRuns: runSchema,
      linkSuggestions: suggestionSchema,
    });

    logLiveStage(live, "Fetching intelligence datasets");
    const [projectPages, buildPages, researchPages] = await Promise.all([
      fetchAllPages(api, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(api, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(api, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    ]);
    const [skillPages, toolPages, decisionPages] = await Promise.all([
      fetchAllPages(api, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
      fetchAllPages(api, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
      fetchAllPages(api, config.phase2Execution!.decisions.dataSourceId, decisionSchema.titlePropertyName),
    ]);
    const [packetPages, taskPages, runPages, suggestionPages] = await Promise.all([
      fetchAllPages(api, config.phase2Execution!.packets.dataSourceId, packetSchema.titlePropertyName),
      fetchAllPages(api, config.phase2Execution!.tasks.dataSourceId, taskSchema.titlePropertyName),
      fetchAllPages(api, phase3.recommendationRuns.dataSourceId, runSchema.titlePropertyName),
      fetchAllPages(api, phase3.linkSuggestions.dataSourceId, suggestionSchema.titlePropertyName),
    ]);
    const [sourcePages, eventPages] = await Promise.all([
      phase5 && sourceSchema ? fetchAllPages(api, phase5.sources.dataSourceId, sourceSchema.titlePropertyName) : Promise.resolve([]),
      phase5 && eventSchema ? fetchAllPages(api, phase5.events.dataSourceId, eventSchema.titlePropertyName) : Promise.resolve([]),
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
    const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
    const events = eventPages.map((page) => toExternalSignalEventRecord(page));

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
    const externalSummaryByProjectId = new Map(
      phase5
        ? projects.map((project) => [
            project.id,
            buildExternalSignalSummary({
              project,
              sources,
              events,
              today,
            }),
          ])
        : [],
    );
    const recommendations = contexts.map((context) =>
      buildRecommendation(context, externalSummaryByProjectId.get(context.project.id)),
    );
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
    const blockedMarkdownProjects: string[] = [];
    const fallbackMarkdownProjects: string[] = [];
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
          try {
            const mode = await syncManagedMarkdownSection({
              api,
              pageId: context.project.id,
              previousMarkdown: entry.previousMarkdown,
              nextMarkdown: entry.nextMarkdown,
              startMarker: RECOMMENDATION_BRIEF_START,
              endMarker: RECOMMENDATION_BRIEF_END,
            });
            changedProjectPages += 1;
            if (mode === "append_tail_update") {
              fallbackMarkdownProjects.push(context.project.title);
            }
          } catch (error) {
            if (!isNotionPolicyBlockedError(error)) {
              throw error;
            }
            blockedMarkdownProjects.push(context.project.title);
            logLiveStage(live, "Skipping blocked project markdown patch", {
              projectId: context.project.id,
              projectTitle: context.project.title,
            });
          }
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
      blockedMarkdownProjectPages: blockedMarkdownProjects.length,
      markdownFallbackProjectPages: fallbackMarkdownProjects.length,
      metrics,
      latestWeeklyRunId: latestWeeklyRun?.id,
      latestDailyRunId: latestDailyRun?.id,
    };
    const warnings = [
      ...summarizeProjectWarnings("Recommendation brief markdown used a fallback write for", fallbackMarkdownProjects),
      ...summarizeProjectWarnings("Recommendation brief markdown remained blocked for", blockedMarkdownProjects),
    ];
    const contract = buildWeeklyStepContract({
      live,
      status: blockedMarkdownProjects.length > 0 ? "partial" : undefined,
      wouldChange:
        blockedMarkdownProjects.length > 0 ||
        projectRecommendationBriefsWouldChange > 0 ||
        intelligenceCommandCenterSectionWouldChange,
      summaryCounts: {
        projectRecommendationBriefsWouldChange,
        intelligenceCommandCenterSectionWouldChange: intelligenceCommandCenterSectionWouldChange ? 1 : 0,
        blockedMarkdownProjectPages: blockedMarkdownProjects.length,
        markdownFallbackProjectPages: fallbackMarkdownProjects.length,
        totalProjects: metrics.totalProjects,
        resumeCandidates: metrics.resumeCandidates,
        proposedLinkSuggestions: metrics.proposedLinkSuggestions,
      },
      warnings,
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

function summarizeProjectWarnings(prefix: string, projectTitles: string[]): string[] {
  if (projectTitles.length === 0) {
    return [];
  }

  const preview = projectTitles.slice(0, 3).join(", ");
  const suffix = projectTitles.length > 3 ? `, +${projectTitles.length - 3} more` : "";
  return [`${prefix} ${projectTitles.length} project page(s): ${preview}${suffix}.`];
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
