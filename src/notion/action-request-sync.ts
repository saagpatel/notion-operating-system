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
import { fetchAllPages, toControlTowerProjectRecord } from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { syncManagedMarkdownSection } from "./managed-markdown-sync.js";
import {
  renderGovernanceBriefSection,
  renderGovernanceCommandCenterSection,
  renderWeeklyGovernanceSection,
  requirePhase6Governance,
  shouldExpireActionRequest,
} from "./local-portfolio-governance.js";
import {
  ensurePhase6GovernanceSchema,
  toActionPolicyRecord,
  toActionRequestRecord,
  toWebhookDeliveryRecord,
  toWebhookEndpointRecord,
} from "./local-portfolio-governance-live.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { renderActuationCommandCenterSection, renderWeeklyActuationSection } from "./local-portfolio-actuation.js";
import { AppError } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

const GOVERNANCE_BRIEF_START = "<!-- codex:notion-governance-brief:start -->";
const GOVERNANCE_BRIEF_END = "<!-- codex:notion-governance-brief:end -->";
const GOVERNANCE_COMMAND_CENTER_START = "<!-- codex:notion-governance-command-center:start -->";
const GOVERNANCE_COMMAND_CENTER_END = "<!-- codex:notion-governance-command-center:end -->";
const WEEKLY_GOVERNANCE_START = "<!-- codex:notion-weekly-governance:start -->";
const WEEKLY_GOVERNANCE_END = "<!-- codex:notion-weekly-governance:end -->";
const ACTUATION_COMMAND_CENTER_START = "<!-- codex:notion-actuation-command-center:start -->";
const ACTUATION_COMMAND_CENTER_END = "<!-- codex:notion-actuation-command-center:end -->";
const WEEKLY_ACTUATION_START = "<!-- codex:notion-weekly-actuation:start -->";
const WEEKLY_ACTUATION_END = "<!-- codex:notion-weekly-actuation:end -->";

export interface ActionRequestSyncCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
}

export async function runActionRequestSyncCommand(
  options: ActionRequestSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for action request sync");
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
      logLiveStage(live, "Ensuring Phase 6 schema");
      config = await ensurePhase6GovernanceSchema(sdk, config);
      await saveLocalPortfolioControlTowerConfig(config, configPath);
    }

    const phase6 = requirePhase6Governance(config);
    const executionSchemaPromise = config.phase7Actuation
      ? api.retrieveDataSource(config.phase7Actuation.executions.dataSourceId)
      : Promise.resolve(undefined);
    const [projectSchema, policySchema, requestSchema, endpointSchema, deliverySchema, weeklySchema, executionSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(phase6.policies.dataSourceId),
      api.retrieveDataSource(phase6.actionRequests.dataSourceId),
      api.retrieveDataSource(phase6.webhookEndpoints.dataSourceId),
      api.retrieveDataSource(phase6.webhookDeliveries.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
      executionSchemaPromise,
    ]);

    logLiveStage(live, "Fetching governance datasets");
    const executionPagesPromise =
      config.phase7Actuation && executionSchema
        ? fetchAllPages(sdk, config.phase7Actuation.executions.dataSourceId, executionSchema.titlePropertyName)
        : Promise.resolve([]);
    const [projectPages, policyPages, requestPages, endpointPages, deliveryPages, weeklyPages, executionPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.policies.dataSourceId, policySchema.titlePropertyName),
      fetchAllPages(sdk, phase6.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.webhookEndpoints.dataSourceId, endpointSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.webhookDeliveries.dataSourceId, deliverySchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.weeklyReviewsId, weeklySchema.titlePropertyName),
      executionPagesPromise,
    ]);

    const projects = projectPages.map((page) => toControlTowerProjectRecord(page));
    const policies = policyPages.map((page) => toActionPolicyRecord(page));
    const requests = requestPages.map((page) => toActionRequestRecord(page));
    const endpoints = endpointPages.map((page) => toWebhookEndpointRecord(page));
    const deliveries = deliveryPages.map((page) => toWebhookDeliveryRecord(page));
    const executions = executionPages.map((page) => toExternalActionExecutionRecord(page));

    let expiredCount = 0;
    if (live) {
      logLiveStage(live, "Expiring stale action requests", { requestCount: requests.length });
      for (const request of requests) {
        if (shouldExpireActionRequest(request, today)) {
          await api.updatePageProperties({
            pageId: request.id,
            properties: {
              Status: { select: { name: "Expired" } },
            },
          });
          request.status = "Expired";
          expiredCount += 1;
        }
      }
    }

    let changedProjectPages = 0;
    const failedProjectPageIds: string[] = [];
    const failedSummaryTargets: string[] = [];
    if (live) {
      logLiveStage(live, "Refreshing governance briefs", { projectCount: projects.length });
      for (const [index, project] of projects.entries()) {
        logLoopProgress(live, "action-request-sync", "Project brief", index + 1, projects.length);
        const projectRequests = requests.filter((request) => request.localProjectIds.includes(project.id));
        const projectDeliveries = deliveries.filter((delivery) => delivery.localProjectIds.includes(project.id));
        const projectExecutions = executions.filter((execution) => execution.localProjectIds.includes(project.id));
        const brief = renderGovernanceBriefSection({
          projectTitle: project.title,
          actionRequests: projectRequests,
          deliveries: projectDeliveries,
          policies,
          actuationExecutions: projectExecutions,
        });
        const existing = await api.readPageMarkdown(project.id);
        const updated = mergeManagedSection(existing.markdown, brief, GOVERNANCE_BRIEF_START, GOVERNANCE_BRIEF_END);
        if (updated !== existing.markdown) {
          try {
            await syncManagedMarkdownSection({
              api,
              pageId: project.id,
              previousMarkdown: existing.markdown,
              nextMarkdown: updated,
              startMarker: GOVERNANCE_BRIEF_START,
              endMarker: GOVERNANCE_BRIEF_END,
            });
            changedProjectPages += 1;
          } catch (error) {
            failedProjectPageIds.push(project.id);
            logLiveStage(live, "Skipped project brief patch", {
              projectId: project.id,
              projectTitle: project.title,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (config.commandCenter.pageId) {
        logLiveStage(live, "Refreshing governance command center");
        const commandCenter = await api.readPageMarkdown(config.commandCenter.pageId);
        const section = renderGovernanceCommandCenterSection({
          requests,
          deliveries,
          endpoints,
          policies,
          actuationExecutions: executions,
        });
        const updated = mergeManagedSection(
          commandCenter.markdown,
          section,
          GOVERNANCE_COMMAND_CENTER_START,
          GOVERNANCE_COMMAND_CENTER_END,
        );
        const actuationSection = renderActuationCommandCenterSection({
          requests,
          executions,
        });
        const withActuation = mergeManagedSection(
          updated,
          actuationSection,
          ACTUATION_COMMAND_CENTER_START,
          ACTUATION_COMMAND_CENTER_END,
        );
        if (withActuation !== commandCenter.markdown) {
          try {
            const governanceOnly = mergeManagedSection(
              commandCenter.markdown,
              section,
              GOVERNANCE_COMMAND_CENTER_START,
              GOVERNANCE_COMMAND_CENTER_END,
            );
            if (governanceOnly !== commandCenter.markdown) {
              await syncManagedMarkdownSection({
                api,
                pageId: config.commandCenter.pageId,
                previousMarkdown: commandCenter.markdown,
                nextMarkdown: governanceOnly,
                startMarker: GOVERNANCE_COMMAND_CENTER_START,
                endMarker: GOVERNANCE_COMMAND_CENTER_END,
              });
            }
            if (withActuation !== governanceOnly) {
              await syncManagedMarkdownSection({
                api,
                pageId: config.commandCenter.pageId,
                previousMarkdown: governanceOnly,
                nextMarkdown: withActuation,
                startMarker: ACTUATION_COMMAND_CENTER_START,
                endMarker: ACTUATION_COMMAND_CENTER_END,
              });
            }
          } catch (error) {
            failedSummaryTargets.push("command-center");
            logLiveStage(live, "Skipped command center patch", {
              pageId: config.commandCenter.pageId,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      const latestWeekly = weeklyPages.sort((left, right) => right.title.localeCompare(left.title))[0];
      if (latestWeekly) {
        logLiveStage(live, "Refreshing weekly governance summary");
        const weekly = await api.readPageMarkdown(latestWeekly.id);
        const section = renderWeeklyGovernanceSection({ requests, deliveries, actuationExecutions: executions });
        const updated = mergeManagedSection(weekly.markdown, section, WEEKLY_GOVERNANCE_START, WEEKLY_GOVERNANCE_END);
        const actuationSection = renderWeeklyActuationSection({ executions });
        const withActuation = mergeManagedSection(
          updated,
          actuationSection,
          WEEKLY_ACTUATION_START,
          WEEKLY_ACTUATION_END,
        );
        if (withActuation !== weekly.markdown) {
          try {
            const governanceOnly = mergeManagedSection(
              weekly.markdown,
              section,
              WEEKLY_GOVERNANCE_START,
              WEEKLY_GOVERNANCE_END,
            );
            if (governanceOnly !== weekly.markdown) {
              await syncManagedMarkdownSection({
                api,
                pageId: latestWeekly.id,
                previousMarkdown: weekly.markdown,
                nextMarkdown: governanceOnly,
                startMarker: WEEKLY_GOVERNANCE_START,
                endMarker: WEEKLY_GOVERNANCE_END,
              });
            }
            if (withActuation !== governanceOnly) {
              await syncManagedMarkdownSection({
                api,
                pageId: latestWeekly.id,
                previousMarkdown: governanceOnly,
                nextMarkdown: withActuation,
                startMarker: WEEKLY_ACTUATION_START,
                endMarker: WEEKLY_ACTUATION_END,
              });
            }
          } catch (error) {
            failedSummaryTargets.push("weekly-review");
            logLiveStage(live, "Skipped weekly governance patch", {
              pageId: latestWeekly.id,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    const output = {
      ok: true,
      expiredCount,
      changedProjectPages,
      failedProjectPageCount: failedProjectPageIds.length,
      failedProjectPageIds,
      failedSummaryTargets,
      pendingApprovalCount: requests.filter((request) => request.status === "Pending Approval").length,
      approvedCount: requests.filter((request) => request.status === "Approved").length,
      verifiedDeliveryCount: deliveries.filter((delivery) => delivery.verificationResult === "Valid").length,
      executionCount: executions.length,
    };
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
}

function logLiveStage(live: boolean, stage: string, details?: Record<string, unknown>): void {
  if (!live) {
    return;
  }

  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[action-request-sync] ${stage}${suffix}`);
}

function logLoopProgress(live: boolean, scope: string, label: string, index: number, total: number): void {
  if (!live) {
    return;
  }

  console.error(`[${scope}] ${label} ${index}/${total}`);
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "action-request-sync"]);
}
