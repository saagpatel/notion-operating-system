import { createNotionSdkClient } from "./notion-sdk.js";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  applyDerivedSignals,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  calculateExecutionMetrics,
  buildProjectExecutionContext,
  mergeManagedSection,
  renderExecutionBriefSection,
  renderExecutionCommandCenterSection,
} from "./local-portfolio-execution.js";
import {
  ensurePhase2ExecutionSchema,
  toExecutionTaskRecord,
  toProjectDecisionRecord,
  toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
  loadLocalPortfolioExecutionViewPlan,
  validateLocalPortfolioExecutionViewPlanAgainstSchemas,
} from "./local-portfolio-execution-views.js";
import {
  fetchAllPages,
  toBuildSessionRecord,
  toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand, normalizeMarkdown } from "../utils/markdown.js";
import { losAngelesToday } from "../utils/date.js";
import { buildWeeklyStepContract, mapWeeklyStepStatusToCommandStatus } from "./weekly-refresh-contract.js";
import { isNotionPolicyBlockedError, syncManagedMarkdownSection } from "./managed-markdown-sync.js";

const EXECUTION_BRIEF_START = "<!-- codex:notion-execution-brief:start -->";
const EXECUTION_BRIEF_END = "<!-- codex:notion-execution-brief:end -->";
const EXECUTION_COMMAND_CENTER_START = "<!-- codex:notion-execution-command-center:start -->";
const EXECUTION_COMMAND_CENTER_END = "<!-- codex:notion-execution-command-center:end -->";

export interface ExecutionSyncCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
}

export async function runExecutionSyncCommand(
  options: ExecutionSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for execution sync");
  const live = options.live ?? false;
  const today = options.today ?? losAngelesToday();
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;

  const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase2Execution) {
      throw new AppError("Control tower config is missing phase2Execution");
    }
    if (!config.commandCenter.pageId) {
      throw new AppError("Control tower config is missing commandCenter.pageId");
    }

    const sdk = createNotionSdkClient(token);
    const api = new DirectNotionClient(token);

    if (live) {
      logLiveStage(live, "Ensuring Phase 2 schema");
      await ensurePhase2ExecutionSchema(sdk, config);
    }

    logLiveStage(live, "Loading execution schemas");
    const viewPlan = await loadLocalPortfolioExecutionViewPlan();
    const [projectSchema, buildSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
    ]);
    const [decisionsSchema, packetsSchema] = await Promise.all([
      api.retrieveDataSource(config.phase2Execution.decisions.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
    ]);
    const [tasksSchema] = await Promise.all([
      api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
    ]);

    validateLocalPortfolioExecutionViewPlanAgainstSchemas(viewPlan, {
      decisions: decisionsSchema,
      packets: packetsSchema,
      tasks: tasksSchema,
    });

    logLiveStage(live, "Fetching execution datasets");
    const [projectPages, buildPages] = await Promise.all([
      fetchAllPages(api, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(api, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
    ]);
    const [decisionPages, packetPages] = await Promise.all([
      fetchAllPages(api, config.phase2Execution.decisions.dataSourceId, decisionsSchema.titlePropertyName),
      fetchAllPages(api, config.phase2Execution.packets.dataSourceId, packetsSchema.titlePropertyName),
    ]);
    const [taskPages] = await Promise.all([
      fetchAllPages(api, config.phase2Execution.tasks.dataSourceId, tasksSchema.titlePropertyName),
    ]);

    const projects = projectPages.map((page) => applyDerivedSignals(toControlTowerProjectRecord(page), config, today));
    const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
    const decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
    const packets = packetPages.map((page) => toWorkPacketRecord(page));
    const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
    const metrics = calculateExecutionMetrics({
      decisions,
      packets,
      tasks,
      today,
      config,
    });

    const projectBriefs = await Promise.all(
      projects.map(async (project) => {
        const context = buildProjectExecutionContext({
          project,
          decisions,
          packets,
          tasks,
          buildSessions,
          today,
        });
        const previous = await api.readPageMarkdown(project.id);
        const nextMarkdown = mergeManagedSection(
          previous.markdown,
          renderExecutionBriefSection(context),
          EXECUTION_BRIEF_START,
          EXECUTION_BRIEF_END,
        );
        return {
          projectId: project.id,
          previousMarkdown: previous.markdown,
          nextMarkdown,
          changed: normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown),
        };
      }),
    );
    const projectExecutionBriefsWouldChange = projectBriefs.filter((entry) => entry.changed).length;

    const previousCommandCenter = await api.readPageMarkdown(config.commandCenter.pageId);
    const nextCommandCenter = mergeManagedSection(
      previousCommandCenter.markdown,
      renderExecutionCommandCenterSection({
        metrics,
        decisions,
        packets,
        tasks,
        projects,
        today,
      }),
      EXECUTION_COMMAND_CENTER_START,
      EXECUTION_COMMAND_CENTER_END,
    );
    const executionCommandCenterSectionWouldChange =
      normalizeMarkdown(nextCommandCenter) !== normalizeMarkdown(previousCommandCenter.markdown);

    let changedProjectPages = 0;
    const blockedMarkdownProjects: string[] = [];
    const fallbackMarkdownProjects: string[] = [];
    if (live) {
      logLiveStage(live, "Refreshing project execution briefs", { projectCount: projects.length });
      for (const [index, brief] of projectBriefs.entries()) {
        logLoopProgress(live, "execution-sync", "Project brief", index + 1, projectBriefs.length);
        if (brief.changed) {
          try {
            const mode = await syncManagedMarkdownSection({
              api,
              pageId: brief.projectId,
              previousMarkdown: brief.previousMarkdown,
              nextMarkdown: brief.nextMarkdown,
              startMarker: EXECUTION_BRIEF_START,
              endMarker: EXECUTION_BRIEF_END,
            });
            changedProjectPages += 1;
            const projectTitle = projects.find((project) => project.id === brief.projectId)?.title ?? brief.projectId;
            if (mode === "append_tail_update") {
              fallbackMarkdownProjects.push(projectTitle);
            }
          } catch (error) {
            if (!isNotionPolicyBlockedError(error)) {
              throw error;
            }
            const projectTitle = projects.find((project) => project.id === brief.projectId)?.title ?? brief.projectId;
            blockedMarkdownProjects.push(projectTitle);
            logLiveStage(live, "Skipping blocked project markdown patch", {
              projectId: brief.projectId,
              projectTitle,
            });
          }
        }
      }

      logLiveStage(live, "Refreshing execution command center");
      if (executionCommandCenterSectionWouldChange) {
        assertSafeReplacement(previousCommandCenter.markdown, nextCommandCenter);
        await api.patchPageMarkdown({
          pageId: config.commandCenter.pageId,
          command: "replace_content",
          newMarkdown: buildReplaceCommand(nextCommandCenter),
        });
      }

      logLiveStage(live, "Persisting execution sync metrics");
      await saveLocalPortfolioControlTowerConfig(
        {
          ...config,
          phaseState: {
            ...config.phaseState,
          },
          phase2Execution: {
            ...config.phase2Execution,
            baselineCapturedAt: config.phase2Execution.baselineCapturedAt ?? today,
            baselineMetrics: config.phase2Execution.baselineMetrics ?? serializeExecutionMetrics(metrics),
            lastSyncAt: today,
            lastSyncMetrics: serializeExecutionMetrics(metrics),
          },
        },
        configPath,
      );
    }

    const output = {
      ok: true,
      live,
      status: "clean" as string,
      wouldChange: false,
      summaryCounts: {},
      warnings: [] as string[],
      changedProjectPages,
      projectExecutionBriefsWouldChange,
      executionCommandCenterSectionWouldChange,
      blockedMarkdownProjectPages: blockedMarkdownProjects.length,
      markdownFallbackProjectPages: fallbackMarkdownProjects.length,
      metrics,
    };
    const warnings = [
      ...summarizeProjectWarnings("Execution brief markdown used a fallback write for", fallbackMarkdownProjects),
      ...summarizeProjectWarnings("Execution brief markdown remained blocked for", blockedMarkdownProjects),
    ];
    const contract = buildWeeklyStepContract({
      live,
      status: blockedMarkdownProjects.length > 0 ? "partial" : undefined,
      wouldChange:
        blockedMarkdownProjects.length > 0 ||
        projectExecutionBriefsWouldChange > 0 ||
        executionCommandCenterSectionWouldChange,
      summaryCounts: {
        projectExecutionBriefsWouldChange,
        executionCommandCenterSectionWouldChange: executionCommandCenterSectionWouldChange ? 1 : 0,
        blockedMarkdownProjectPages: blockedMarkdownProjects.length,
        markdownFallbackProjectPages: fallbackMarkdownProjects.length,
        projectsWithExecutionDrift: metrics.projectsWithExecutionDrift,
        blockedTasks: metrics.blockedTasks,
        overdueTasks: metrics.overdueTasks,
      },
      warnings,
    });
    output.status = contract.status;
    output.wouldChange = contract.wouldChange;
    output.summaryCounts = contract.summaryCounts;
    output.warnings = contract.warnings;
    recordCommandOutputSummary(output, {
      status: mapWeeklyStepStatusToCommandStatus(contract.status),
    });
    console.log(JSON.stringify(output, null, 2));
}

function logLiveStage(live: boolean, stage: string, details?: Record<string, unknown>): void {
  if (!live) {
    return;
  }

  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[execution-sync] ${stage}${suffix}`);
}

function logLoopProgress(live: boolean, scope: string, label: string, index: number, total: number): void {
  if (!live) {
    return;
  }
  if (index === 1 || index === total || index % 10 === 0) {
    console.error(`[${scope}] ${label} ${index}/${total}`);
  }
}

function summarizeProjectWarnings(prefix: string, projectTitles: string[]): string[] {
  if (projectTitles.length === 0) {
    return [];
  }

  const preview = projectTitles.slice(0, 3).join(", ");
  const suffix = projectTitles.length > 3 ? `, +${projectTitles.length - 3} more` : "";
  return [`${prefix} ${projectTitles.length} project page(s): ${preview}${suffix}.`];
}

function serializeExecutionMetrics(metrics: ReturnType<typeof calculateExecutionMetrics>): Record<string, number | string[]> {
  return {
    openDecisions: metrics.openDecisions,
    nowPackets: metrics.nowPackets,
    standbyPackets: metrics.standbyPackets,
    blockedPackets: metrics.blockedPackets,
    blockedTasks: metrics.blockedTasks,
    overdueTasks: metrics.overdueTasks,
    tasksCompletedThisWeek: metrics.tasksCompletedThisWeek,
    packetsCompletedThisWeek: metrics.packetsCompletedThisWeek,
    rolloverPackets: metrics.rolloverPackets,
    projectsWithExecutionDrift: metrics.projectsWithExecutionDrift,
    wipViolations: metrics.wipViolations,
  };
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["execution", "sync"]);
}
