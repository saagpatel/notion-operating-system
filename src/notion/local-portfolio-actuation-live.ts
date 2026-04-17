import type { Client } from "@notionhq/client";

import { AppError } from "../utils/errors.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type { DataSourcePageRef } from "./local-portfolio-control-tower-live.js";
import { dateValue, relationIds, selectValue, textValue } from "./local-portfolio-control-tower-live.js";
import {
  ensurePhase7ActuationState,
  type ExternalActionExecutionRecord,
} from "./local-portfolio-actuation.js";

export async function ensurePhase7ActuationSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
): Promise<LocalPortfolioControlTowerConfig> {
  const nextPhase7 = ensurePhase7ActuationState(config, {
    today:
      config.phase7Actuation?.baselineCapturedAt ??
      config.phase6Governance?.baselineCapturedAt ??
      config.phase5ExternalSignals?.lastSyncAt ??
      "2026-03-17",
  });

  const executions = await ensureDataSourceRef({
    sdk,
    existing: config.phase7Actuation?.executions,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Action Executions",
    titlePropertyName: "Name",
    destinationAlias: "external_action_executions",
  });

  await Promise.all([
    sdk.request({
      path: `data_sources/${config.phase6Governance!.actionRequests.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Target Source": relationSchema(config.phase5ExternalSignals!.sources.dataSourceId),
          "Payload Title": { rich_text: {} },
          "Payload Body": { rich_text: {} },
          "Target Number": { number: { format: "number" } },
          "Target Labels": { rich_text: {} },
          "Target Assignees": { rich_text: {} },
          "Execution Intent": { select: { options: colorize([["Dry Run", "blue"], ["Ready for Live", "green"]]) } },
          "Latest Execution": relationSchema(executions.dataSourceId),
          "Latest Execution Status": {
            select: {
              options: colorize([
                ["None", "gray"],
                ["Dry Run Passed", "green"],
                ["Problem", "red"],
                ["Executed", "blue"],
              ]),
            },
          },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${executions.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Action Request": relationSchema(config.phase6Governance!.actionRequests.dataSourceId),
          "Local Project": relationSchema(config.database.dataSourceId),
          Policy: relationSchema(config.phase6Governance!.policies.dataSourceId),
          "Target Source": relationSchema(config.phase5ExternalSignals!.sources.dataSourceId),
          Provider: { select: { options: colorize([["GitHub", "gray"], ["Vercel", "blue"], ["Google Calendar", "yellow"]]) } },
          "Action Key": { rich_text: {} },
          Mode: { select: { options: colorize([["Dry Run", "blue"], ["Live", "green"], ["Compensation", "orange"]]) } },
          Status: { select: { options: colorize([["Planned", "default"], ["Started", "orange"], ["Succeeded", "green"], ["Failed", "red"], ["Skipped", "gray"], ["Compensation Needed", "orange"]]) } },
          "Idempotency Key": { rich_text: {} },
          "Executed At": { date: {} },
          "Provider Result Key": { rich_text: {} },
          "Provider URL": { url: {} },
          "Issue Number": { number: { format: "number" } },
          "Comment ID": { rich_text: {} },
          "Label Delta Summary": { rich_text: {} },
          "Assignee Delta Summary": { rich_text: {} },
          "Response Classification": {
            select: {
              options: colorize([
                ["Success", "green"],
                ["Validation Failure", "red"],
                ["Verification Failure", "red"],
                ["Permission Failure", "red"],
                ["Auth Failure", "red"],
                ["Not Found", "orange"],
                ["Rate Limited", "orange"],
                ["Transient Failure", "orange"],
                ["Duplicate Suppressed", "gray"],
              ]),
            },
          },
          "Reconcile Status": {
            select: {
              options: colorize([
                ["Not Needed", "gray"],
                ["Pending", "orange"],
                ["Confirmed", "green"],
                ["Mismatch", "red"],
              ]),
            },
          },
          "Response Summary": { rich_text: {} },
          "Failure Notes": { rich_text: {} },
          "Compensation Plan": { rich_text: {} },
        },
      },
    }),
  ]);

  return {
    ...config,
    phase7Actuation: {
      ...nextPhase7,
      executions,
    },
  };
}

export function toExternalActionExecutionRecord(page: DataSourcePageRef): ExternalActionExecutionRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    actionRequestIds: relationIds(page.properties["Action Request"]),
    localProjectIds: relationIds(page.properties["Local Project"]),
    policyIds: relationIds(page.properties.Policy),
    targetSourceIds: relationIds(page.properties["Target Source"]),
    provider: selectValue(page.properties.Provider) as ExternalActionExecutionRecord["provider"],
    actionKey: textValue(page.properties["Action Key"]),
    mode: selectValue(page.properties.Mode) as ExternalActionExecutionRecord["mode"],
    status: selectValue(page.properties.Status) as ExternalActionExecutionRecord["status"],
    idempotencyKey: textValue(page.properties["Idempotency Key"]),
    executedAt: dateValue(page.properties["Executed At"]),
    providerResultKey: textValue(page.properties["Provider Result Key"]),
    providerUrl: page.properties["Provider URL"]?.url?.trim() ?? "",
    issueNumber: Number(page.properties["Issue Number"]?.number ?? 0),
    commentId: textValue(page.properties["Comment ID"]),
    labelDeltaSummary: textValue(page.properties["Label Delta Summary"]),
    assigneeDeltaSummary: textValue(page.properties["Assignee Delta Summary"]),
    responseClassification: selectValue(page.properties["Response Classification"]) as ExternalActionExecutionRecord["responseClassification"],
    reconcileStatus: selectValue(page.properties["Reconcile Status"]) as ExternalActionExecutionRecord["reconcileStatus"],
    responseSummary: textValue(page.properties["Response Summary"]),
    failureNotes: textValue(page.properties["Failure Notes"]),
    compensationPlan: textValue(page.properties["Compensation Plan"]),
  };
}

async function ensureDataSourceRef(input: {
  sdk: Client;
  existing:
    | {
        name: string;
        databaseUrl: string;
        databaseId: string;
        dataSourceId: string;
        destinationAlias: string;
      }
    | undefined;
  parentPageUrl: string;
  title: string;
  titlePropertyName: string;
  destinationAlias: string;
}): Promise<{
  name: string;
  databaseUrl: string;
  databaseId: string;
  dataSourceId: string;
  destinationAlias: string;
}> {
  if (input.existing && !input.existing.databaseUrl.includes("00000000000000000000000000000000")) {
    return input.existing;
  }

  const parentPageId = extractNotionIdFromUrl(input.parentPageUrl);
  if (!parentPageId) {
    throw new AppError(`Could not resolve parent page id from "${input.parentPageUrl}"`);
  }

  const response = (await input.sdk.request({
    path: "databases",
    method: "post",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: toRichText(input.title),
      properties: {
        [input.titlePropertyName]: {
          title: {},
        },
      },
    },
  })) as { id: string; url: string; data_sources?: Array<{ id: string }> };

  const dataSourceId = response.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new AppError(`New database "${input.title}" did not expose a data source id`);
  }

  return {
    name: input.title,
    databaseUrl: response.url,
    databaseId: normalizeNotionId(response.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    destinationAlias: input.destinationAlias,
  };
}

function relationSchema(dataSourceId: string): { relation: { data_source_id: string; single_property: {} } } {
  return {
    relation: {
      data_source_id: dataSourceId,
      single_property: {},
    },
  };
}

function colorize(entries: Array<[string, string]>): Array<{ name: string; color: string }> {
  return entries.map(([name, color]) => ({ name, color }));
}

function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  return [
    {
      type: "text",
      text: {
        content: value,
      },
    },
  ];
}
