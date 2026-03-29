import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages, toControlTowerProjectRecord } from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
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
import { AppError, toErrorMessage } from "../utils/errors.js";
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

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for action request sync");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (flags.live) {
      logLiveStage(flags.live, "Ensuring Phase 6 schema");
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

    logLiveStage(flags.live, "Fetching governance datasets");
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
    if (flags.live) {
      logLiveStage(flags.live, "Expiring stale action requests", { requestCount: requests.length });
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
    if (flags.live) {
      logLiveStage(flags.live, "Refreshing governance briefs", { projectCount: projects.length });
      for (const [index, project] of projects.entries()) {
        logLoopProgress(flags.live, "action-request-sync", "Project brief", index + 1, projects.length);
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
          await api.patchPageMarkdown({
            pageId: project.id,
            command: "replace_content",
            newMarkdown: updated,
          });
          changedProjectPages += 1;
        }
      }

      if (config.commandCenter.pageId) {
        logLiveStage(flags.live, "Refreshing governance command center");
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
          await api.patchPageMarkdown({
            pageId: config.commandCenter.pageId,
            command: "replace_content",
            newMarkdown: withActuation,
          });
        }
      }

      const latestWeekly = weeklyPages.sort((left, right) => right.title.localeCompare(left.title))[0];
      if (latestWeekly) {
        logLiveStage(flags.live, "Refreshing weekly governance summary");
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
          await api.patchPageMarkdown({
            pageId: latestWeekly.id,
            command: "replace_content",
            newMarkdown: withActuation,
          });
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          expiredCount,
          changedProjectPages,
          pendingApprovalCount: requests.filter((request) => request.status === "Pending Approval").length,
          approvedCount: requests.filter((request) => request.status === "Approved").length,
          verifiedDeliveryCount: deliveries.filter((delivery) => delivery.verificationResult === "Valid").length,
          executionCount: executions.length,
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

function parseFlags(argv: string[]): { live: boolean; today?: string } {
  let live = false;
  let today: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1];
      index += 1;
    }
  }

  return { live, today };
}

void main();
