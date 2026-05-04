import { createNotionSdkClient } from "./notion-sdk.js";

import { createHash } from "node:crypto";

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
  datePropertyValue,
  fetchAllPages,
  relationValue,
  richTextValue,
  selectPropertyValue,
  textValue,
  titleValue,
  toBuildSessionRecord,
  toControlTowerProjectRecord,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand, normalizeMarkdown } from "../utils/markdown.js";
import { losAngelesToday } from "../utils/date.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { mapWeeklyStepStatusToCommandStatus } from "./weekly-refresh-contract.js";
import {
  isNotionPolicyBlockedError,
  isReadBackRecoverableMarkdownError,
  syncManagedMarkdownSectionWithReadBack,
} from "./managed-markdown-sync.js";
import {
  loadProjectMarkdownBlocklist,
  partitionKnownBlockedProjectMarkdown,
} from "./project-markdown-blocklist.js";
import { buildProjectMarkdownRefreshContract } from "./project-markdown-refresh-contract.js";
import {
  isMarkdownPatchTransportError,
  replaceCommandCenterPageAfterPatchFailure,
} from "./command-center-replacement.js";

const EXECUTION_BRIEF_START = "<!-- codex:notion-execution-brief:start -->";
const EXECUTION_BRIEF_END = "<!-- codex:notion-execution-brief:end -->";
const EXECUTION_COMMAND_CENTER_START = "<!-- codex:notion-execution-command-center:start -->";
const EXECUTION_COMMAND_CENTER_END = "<!-- codex:notion-execution-command-center:end -->";
const EXECUTION_BRIEF_STORAGE_VERSION = "execution-brief-db-v1";

interface ExecutionBriefRefresh {
  projectId: string;
  projectTitle: string;
  previousMarkdown: string;
  nextMarkdown: string;
  context: ReturnType<typeof buildProjectExecutionContext>;
  changed: boolean;
  storageTitle?: string;
  storagePageId?: string;
  storagePageUrl?: string;
  contentHash?: string;
}

export interface ExecutionSyncCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
  projectLimit?: number;
  projectOffset?: number;
  projectConcurrency?: number;
  skipKnownBlockedMarkdown?: boolean;
  blockedMarkdownConfig?: string;
}

export async function runExecutionSyncCommand(
  options: ExecutionSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for execution sync");
  const live = options.live ?? false;
  const today = options.today ?? losAngelesToday();
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  validateProjectBatchOptions(options);
  const projectConcurrency = options.projectConcurrency ?? 1;
  const projectBatchEnabled = options.projectLimit !== undefined || options.projectOffset !== undefined;

  let config = await loadLocalPortfolioControlTowerConfig(configPath);
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
      config = await ensurePhase2ExecutionSchema(sdk, config, {
        includeExecutionBriefs: true,
      });
      await saveLocalPortfolioControlTowerConfig(config, configPath);
    }
    const phase2Execution = config.phase2Execution;
    if (!phase2Execution) {
      throw new AppError("Control tower config is missing phase2Execution");
    }
    const commandCenterPageId = config.commandCenter.pageId;
    if (!commandCenterPageId) {
      throw new AppError("Control tower config is missing commandCenter.pageId");
    }

    logLiveStage(live, "Loading execution schemas");
    const viewPlan = await loadLocalPortfolioExecutionViewPlan();
    const [projectSchema, buildSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
    ]);
    const [decisionsSchema, packetsSchema] = await Promise.all([
      api.retrieveDataSource(phase2Execution.decisions.dataSourceId),
      api.retrieveDataSource(phase2Execution.packets.dataSourceId),
    ]);
    const [tasksSchema] = await Promise.all([
      api.retrieveDataSource(phase2Execution.tasks.dataSourceId),
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
      fetchAllPages(api, phase2Execution.decisions.dataSourceId, decisionsSchema.titlePropertyName),
      fetchAllPages(api, phase2Execution.packets.dataSourceId, packetsSchema.titlePropertyName),
    ]);
    const [taskPages] = await Promise.all([
      fetchAllPages(api, phase2Execution.tasks.dataSourceId, tasksSchema.titlePropertyName),
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

    const contexts = projects.map((project) =>
      buildProjectExecutionContext({
        project,
        decisions,
        packets,
        tasks,
        buildSessions,
        today,
      }),
    );
    const projectBriefs = phase2Execution.executionBriefs
      ? await buildStoredExecutionBriefRefreshes({
          api,
          contexts,
          dataSourceId: phase2Execution.executionBriefs.dataSourceId,
          today,
        })
      : await buildProjectPageExecutionBriefRefreshes({
          api,
          contexts,
        });
    const changedProjectBriefs = projectBriefs.filter((entry) => entry.changed);
    const targetProjectBriefsBeforeKnownBlocked = selectProjectBriefBatch(changedProjectBriefs, options);
    const usesExecutionBriefStorage = Boolean(phase2Execution.executionBriefs);
    const knownBlockedMarkdownBlocklist = options.skipKnownBlockedMarkdown && !usesExecutionBriefStorage
      ? await loadProjectMarkdownBlocklist(options.blockedMarkdownConfig)
      : undefined;
    const knownBlockedPartition = knownBlockedMarkdownBlocklist
      ? partitionKnownBlockedProjectMarkdown(
          targetProjectBriefsBeforeKnownBlocked,
          knownBlockedMarkdownBlocklist,
          "execution",
        )
      : { writable: targetProjectBriefsBeforeKnownBlocked, skipped: [] };
    const targetProjectBriefs = knownBlockedPartition.writable;
    const knownBlockedMarkdownProjects = knownBlockedPartition.skipped.map((entry) => entry.projectTitle);
    const projectExecutionBriefsWouldChange = projectBatchEnabled
      ? targetProjectBriefsBeforeKnownBlocked.length
      : changedProjectBriefs.length;

    const previousCommandCenter = projectBatchEnabled
      ? undefined
      : await api.readPageMarkdown(commandCenterPageId);
    const nextCommandCenter = previousCommandCenter
      ? mergeManagedSection(
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
        )
      : undefined;
    const executionCommandCenterSectionWouldChange =
      previousCommandCenter && nextCommandCenter
        ? normalizeMarkdown(nextCommandCenter) !== normalizeMarkdown(previousCommandCenter.markdown)
        : false;

    let changedProjectPages = 0;
    const blockedMarkdownProjects: string[] = [];
    const fallbackMarkdownProjects: string[] = [];
    if (live) {
      logLiveStage(live, "Refreshing project execution briefs", {
        projectCount: targetProjectBriefs.length,
        projectRefreshTotalCount: changedProjectBriefs.length,
        projectRefreshOffset: options.projectOffset ?? 0,
        projectRefreshLimit: options.projectLimit ?? 0,
        projectConcurrency,
      });
      await mapWithConcurrency(targetProjectBriefs, projectConcurrency, async (brief, index) => {
        logLoopProgress(live, "execution-sync", "Project brief", index + 1, targetProjectBriefs.length);
          if (phase2Execution.executionBriefs && brief.storageTitle) {
            await upsertPageByTitle({
              api,
              dataSourceId: phase2Execution.executionBriefs.dataSourceId,
              titlePropertyName: "Name",
              title: brief.storageTitle,
              properties: buildExecutionBriefStorageProperties({
                entry: brief,
                today,
              }),
              markdown: brief.nextMarkdown,
            });
            changedProjectPages += 1;
            return;
          }

          try {
            const mode = await syncManagedMarkdownSectionWithReadBack({
              api,
              pageId: brief.projectId,
              previousMarkdown: brief.previousMarkdown,
              nextMarkdown: brief.nextMarkdown,
              startMarker: EXECUTION_BRIEF_START,
              endMarker: EXECUTION_BRIEF_END,
            });
            changedProjectPages += 1;
            const projectTitle = brief.projectTitle;
            if (mode === "append_tail_update") {
              fallbackMarkdownProjects.push(projectTitle);
            }
          } catch (error) {
            if (!isNotionPolicyBlockedError(error) && !isReadBackRecoverableMarkdownError(error)) {
              throw error;
            }
            const projectTitle = brief.projectTitle;
            blockedMarkdownProjects.push(projectTitle);
            logLiveStage(live, "Skipping blocked project markdown patch", {
              projectId: brief.projectId,
              projectTitle,
            });
          }
      });

      logLiveStage(live, "Refreshing execution command center");
      if (previousCommandCenter && nextCommandCenter && executionCommandCenterSectionWouldChange) {
        assertSafeReplacement(previousCommandCenter.markdown, nextCommandCenter);
        try {
          await api.patchPageMarkdown({
            pageId: commandCenterPageId,
            command: "replace_content",
            newMarkdown: buildReplaceCommand(nextCommandCenter),
          });
        } catch (error) {
          if (!isMarkdownPatchTransportError(error)) {
            throw error;
          }
          config = await replaceCommandCenterPageAfterPatchFailure({
            api,
            config,
            configPath,
            markdown: nextCommandCenter,
          });
        }
      }

      if (!projectBatchEnabled) {
        logLiveStage(live, "Persisting execution sync metrics");
        const phase2Execution = config.phase2Execution;
        if (!phase2Execution) {
          throw new AppError("Control tower config is missing phase2Execution");
        }
        await saveLocalPortfolioControlTowerConfig(
          {
            ...config,
            phaseState: {
              ...config.phaseState,
            },
            phase2Execution: {
              ...phase2Execution,
              baselineCapturedAt: phase2Execution.baselineCapturedAt ?? today,
              baselineMetrics: phase2Execution.baselineMetrics ?? serializeExecutionMetrics(metrics),
              lastSyncAt: today,
              lastSyncMetrics: serializeExecutionMetrics(metrics),
            },
          },
          configPath,
        );
      }
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
      knownBlockedMarkdownProjectPages: knownBlockedMarkdownProjects.length,
      markdownFallbackProjectPages: fallbackMarkdownProjects.length,
      projectRefreshTotalCount: changedProjectBriefs.length,
      projectRefreshBatchCount: targetProjectBriefsBeforeKnownBlocked.length,
      projectRefreshWritableBatchCount: targetProjectBriefs.length,
      projectRefreshOffset: options.projectOffset ?? 0,
      projectRefreshLimit: options.projectLimit ?? 0,
      metrics,
    };
    const warnings = [
      ...summarizeProjectWarnings("Execution brief markdown used a fallback write for", fallbackMarkdownProjects),
      ...summarizeProjectWarnings("Execution brief markdown remained blocked for", blockedMarkdownProjects),
      ...summarizeProjectWarnings("Execution brief markdown skipped as known blocked for", knownBlockedMarkdownProjects),
    ];
    const contract = buildProjectMarkdownRefreshContract({
      live,
      blockedMarkdownProjectPages: blockedMarkdownProjects.length,
      writableMarkdownProjectPagesWouldChange: targetProjectBriefs.length,
      portfolioSectionWouldChange: executionCommandCenterSectionWouldChange,
      summaryCounts: {
        projectExecutionBriefsWouldChange,
        executionCommandCenterSectionWouldChange: executionCommandCenterSectionWouldChange ? 1 : 0,
        blockedMarkdownProjectPages: blockedMarkdownProjects.length,
        knownBlockedMarkdownProjectPages: knownBlockedMarkdownProjects.length,
        markdownFallbackProjectPages: fallbackMarkdownProjects.length,
        projectRefreshTotalCount: changedProjectBriefs.length,
        projectRefreshBatchCount: targetProjectBriefsBeforeKnownBlocked.length,
        projectRefreshWritableBatchCount: targetProjectBriefs.length,
        projectRefreshOffset: options.projectOffset ?? 0,
        projectRefreshLimit: options.projectLimit ?? 0,
        projectsWithExecutionDrift: metrics.projectsWithExecutionDrift,
        blockedTasks: metrics.blockedTasks,
        overdueTasks: metrics.overdueTasks,
        backlogOverdueTasks: metrics.backlogOverdueTasks,
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

async function buildProjectPageExecutionBriefRefreshes(input: {
  api: DirectNotionClient;
  contexts: ReturnType<typeof buildProjectExecutionContext>[];
}): Promise<ExecutionBriefRefresh[]> {
  return Promise.all(
    input.contexts.map(async (context) => {
      const previous = await input.api.readPageMarkdown(context.project.id);
      const nextMarkdown = mergeManagedSection(
        previous.markdown,
        renderExecutionBriefSection(context),
        EXECUTION_BRIEF_START,
        EXECUTION_BRIEF_END,
      );
      return {
        projectId: context.project.id,
        projectTitle: context.project.title,
        previousMarkdown: previous.markdown,
        nextMarkdown,
        context,
        changed: normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown),
      };
    }),
  );
}

async function buildStoredExecutionBriefRefreshes(input: {
  api: DirectNotionClient;
  contexts: ReturnType<typeof buildProjectExecutionContext>[];
  dataSourceId: string;
  today: string;
}): Promise<ExecutionBriefRefresh[]> {
  const existingPages = await fetchAllPages(input.api, input.dataSourceId, "Name");
  const existingByTitle = new Map(existingPages.map((page) => [page.title, page]));

  return Promise.all(
    input.contexts.map(async (context) => {
      const storageTitle = buildExecutionBriefStorageTitle({
        projectTitle: context.project.title,
        today: input.today,
      });
      const existing = existingByTitle.get(storageTitle);
      const nextMarkdown = renderExecutionBriefStorageMarkdown({
        context,
        today: input.today,
      });
      const contentHash = hashMarkdown(nextMarkdown);
      const existingHash = existing
        ? textValue(existing.properties["Brief Hash"])
        : "";
      const previousMarkdown =
        existing && !existingHash
          ? (await input.api.readPageMarkdown(existing.id)).markdown
          : "";
      return {
        projectId: context.project.id,
        projectTitle: context.project.title,
        previousMarkdown,
        nextMarkdown,
        context,
        changed:
          !existing ||
          (existingHash
            ? existingHash !== contentHash
            : normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previousMarkdown)),
        storageTitle,
        storagePageId: existing?.id,
        storagePageUrl: existing?.url,
        contentHash,
      };
    }),
  );
}

export function buildExecutionBriefStorageTitle(input: {
  projectTitle: string;
  today: string;
}): string {
  return `${input.projectTitle} - Execution Brief - ${input.today}`;
}

function renderExecutionBriefStorageMarkdown(input: {
  context: ReturnType<typeof buildProjectExecutionContext>;
  today: string;
}): string {
  return [
    `# ${buildExecutionBriefStorageTitle({
      projectTitle: input.context.project.title,
      today: input.today,
    })}`,
    "",
    renderExecutionBriefSection(input.context),
  ].join("\n");
}

function buildExecutionBriefStorageProperties(input: {
  entry: ExecutionBriefRefresh;
  today: string;
}): Record<string, unknown> {
  return {
    Name: titleValue(input.entry.storageTitle ?? input.entry.projectTitle),
    "Local Project": relationValue([input.entry.projectId]),
    "Brief Date": datePropertyValue(input.today),
    "Active Packet": relationValue(
      input.entry.context.activePacket ? [input.entry.context.activePacket.id] : [],
    ),
    "Standby Packet": relationValue(
      input.entry.context.standbyPacket ? [input.entry.context.standbyPacket.id] : [],
    ),
    "Open Decisions": relationValue(
      input.entry.context.openDecisions.map((decision) => decision.id),
    ),
    "Blocked Tasks": relationValue(
      input.entry.context.blockedTasks.map((task) => task.id),
    ),
    "Due Tasks": relationValue(
      input.entry.context.dueTasks.map((task) => task.id),
    ),
    Source: selectPropertyValue("execution-sync"),
    "Storage Version": richTextValue(EXECUTION_BRIEF_STORAGE_VERSION),
    "Brief Hash": richTextValue(input.entry.contentHash ?? ""),
  };
}

function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(normalizeMarkdown(markdown)).digest("hex");
}

function validateProjectBatchOptions(options: Pick<ExecutionSyncCommandOptions, "projectLimit" | "projectOffset" | "projectConcurrency">): void {
  if (options.projectLimit !== undefined && (!Number.isInteger(options.projectLimit) || options.projectLimit < 1)) {
    throw new AppError("--project-limit must be a positive integer");
  }
  if (options.projectOffset !== undefined && (!Number.isInteger(options.projectOffset) || options.projectOffset < 0)) {
    throw new AppError("--project-offset must be a non-negative integer");
  }
  if (options.projectConcurrency !== undefined && (!Number.isInteger(options.projectConcurrency) || options.projectConcurrency < 1)) {
    throw new AppError("--project-concurrency must be a positive integer");
  }
}

function selectProjectBriefBatch<T>(
  briefs: T[],
  options: Pick<ExecutionSyncCommandOptions, "projectLimit" | "projectOffset">,
): T[] {
  const offset = options.projectOffset ?? 0;
  const limit = options.projectLimit ?? briefs.length;
  return briefs.slice(offset, offset + limit);
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
    backlogOverdueTasks: metrics.backlogOverdueTasks,
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
