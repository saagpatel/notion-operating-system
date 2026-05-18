import type { Client } from "@notionhq/client";

import { AppError } from "../utils/errors.js";
import {
  extractNotionIdFromUrl,
  normalizeNotionId,
} from "../utils/notion-id.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type {
  ExecutionTaskRecord,
  ProjectDecisionRecord,
  WorkPacketRecord,
} from "./local-portfolio-execution.js";
import type { DataSourcePageRef } from "./local-portfolio-control-tower-live.js";
import {
  dateValue,
  numberValue,
  relationIds,
  selectValue,
  textValue,
} from "./local-portfolio-control-tower-live.js";

export async function ensurePhase2ExecutionSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
  options: { includeExecutionBriefs?: boolean } = {},
): Promise<LocalPortfolioControlTowerConfig> {
  const execution = config.phase2Execution;
  if (!execution) {
    return config;
  }

  const executionBriefs = options.includeExecutionBriefs
    ? await ensureDataSourceRef({
        sdk,
        existing: execution.executionBriefs,
        parentPageUrl: config.commandCenter.parentPageUrl,
        title: "Execution Briefs",
        titlePropertyName: "Name",
        destinationAlias: "execution_briefs",
      })
    : execution.executionBriefs;

  await Promise.all([
    ensureStatusOptions(sdk, execution.packets.dataSourceId, [
      ["Backlog", "default"],
      ["Ready", "yellow"],
      ["In Progress", "blue"],
      ["Blocked", "red"],
      ["Review", "purple"],
      ["Done", "green"],
      ["Dropped", "gray"],
    ]),
    ensureSelectOptions(sdk, execution.packets.dataSourceId, "Execution State", [
      ["Backlog", "default"],
      ["Ready", "yellow"],
      ["In Progress", "blue"],
      ["Blocked", "red"],
      ["Review", "purple"],
      ["Done", "green"],
      ["Dropped", "gray"],
    ]),
    ensureStatusOptions(sdk, execution.tasks.dataSourceId, [
      ["Backlog", "default"],
      ["Ready", "yellow"],
      ["In Progress", "blue"],
      ["Blocked", "red"],
      ["Done", "green"],
      ["Canceled", "gray"],
    ]),
    ensureSelectOptions(sdk, execution.tasks.dataSourceId, "Execution State", [
      ["Backlog", "default"],
      ["Ready", "yellow"],
      ["In Progress", "blue"],
      ["Blocked", "red"],
      ["Done", "green"],
      ["Canceled", "gray"],
    ]),
    ensureRelationProperty({
      sdk,
      dataSourceId: config.relatedDataSources.buildLogId,
      propertyName: "Execution Tasks",
      relatedDataSourceId: execution.tasks.dataSourceId,
      syncedPropertyName: "Build Log Sessions",
    }),
    ensureRelationProperty({
      sdk,
      dataSourceId: config.relatedDataSources.weeklyReviewsId,
      propertyName: "Decisions Made",
      relatedDataSourceId: execution.decisions.dataSourceId,
    }),
    ensureRelationProperty({
      sdk,
      dataSourceId: config.relatedDataSources.weeklyReviewsId,
      propertyName: "Tasks Completed",
      relatedDataSourceId: execution.tasks.dataSourceId,
    }),
    ...(executionBriefs
      ? [
          sdk.request({
            path: `data_sources/${executionBriefs.dataSourceId}`,
            method: "patch",
            body: {
              properties: {
                "Local Project": {
                  relation: relationSchema(config.database.dataSourceId),
                },
                "Brief Date": { date: {} },
                "Active Packet": {
                  relation: relationSchema(execution.packets.dataSourceId),
                },
                "Standby Packet": {
                  relation: relationSchema(execution.packets.dataSourceId),
                },
                "Open Decisions": {
                  relation: relationSchema(execution.decisions.dataSourceId),
                },
                "Blocked Tasks": {
                  relation: relationSchema(execution.tasks.dataSourceId),
                },
                "Due Tasks": {
                  relation: relationSchema(execution.tasks.dataSourceId),
                },
                "Source": { select: { options: colorize([["execution-sync", "blue"]]) } },
                "Storage Version": { rich_text: {} },
                "Brief Hash": { rich_text: {} },
              },
            },
          }),
        ]
      : []),
  ]);

  return {
    ...config,
    phase2Execution: {
      ...execution,
      executionBriefs,
    },
  };
}

export function toProjectDecisionRecord(page: DataSourcePageRef): ProjectDecisionRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    status: selectValue(page.properties.Status),
    decisionType: selectValue(page.properties["Decision Type"]),
    localProjectIds: relationIds(page.properties["Local Project"]),
    decisionOwnerIds: peopleIds(page.properties["Decision Owner"]),
    proposedOn: dateValue(page.properties["Proposed On"]),
    decidedOn: dateValue(page.properties["Decided On"]),
    revisitBy: dateValue(page.properties["Revisit By"]),
    optionsConsidered: textValue(page.properties["Options Considered"]),
    chosenOption: textValue(page.properties["Chosen Option"]),
    rationale: textValue(page.properties.Rationale),
    expectedImpact: textValue(page.properties["Expected Impact"]),
    buildLogSessionIds: relationIds(page.properties["Build Log Sessions"]),
  };
}

export function toWorkPacketRecord(page: DataSourcePageRef): WorkPacketRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    status: selectValue(page.properties.Status),
    packetType: selectValue(page.properties["Packet Type"]),
    priority: selectValue(page.properties.Priority),
    ownerIds: peopleIds(page.properties.Owner),
    localProjectIds: relationIds(page.properties["Local Project"]),
    drivingDecisionIds: relationIds(page.properties["Driving Decision"]),
    goal: textValue(page.properties.Goal),
    definitionOfDone: textValue(page.properties["Definition of Done"]),
    whyNow: textValue(page.properties["Why Now"]),
    targetStart: dateValue(page.properties["Target Start"]),
    targetFinish: dateValue(page.properties["Target Finish"]),
    estimatedSize: selectValue(page.properties["Estimated Size"]),
    rolloverCount: numberValue(page.properties["Rollover Count"]),
    executionTaskIds: relationIds(page.properties["Execution Tasks"]),
    buildLogSessionIds: relationIds(page.properties["Build Log Sessions"]),
    weeklyReviewIds: relationIds(page.properties["Weekly Reviews"]),
    blockerSummary: textValue(page.properties["Blocker Summary"]),
  };
}

export function toExecutionTaskRecord(page: DataSourcePageRef): ExecutionTaskRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    status: selectValue(page.properties.Status),
    assigneeIds: peopleIds(page.properties.Assignee),
    dueDate: dateValue(page.properties["Due Date"]),
    priority: selectValue(page.properties.Priority),
    taskType: selectValue(page.properties["Task Type"]),
    workPacketIds: relationIds(page.properties["Work Packet"]),
    localProjectIds: relationIds(page.properties["Local Project"]),
    estimate: selectValue(page.properties.Estimate),
    completedOn: dateValue(page.properties["Completed On"]),
    lastEditedTime: page.lastEditedTime,
    taskNotes: textValue(page.properties["Task Notes"]),
  };
}

function peopleIds(property?: DataSourcePageRef["properties"][string]): string[] {
  return Array.isArray(property?.people)
    ? property.people
        .map((person) => (typeof person?.id === "string" ? person.id : ""))
        .filter((value) => value.length > 0)
    : [];
}

async function ensureStatusOptions(
  sdk: Client,
  dataSourceId: string,
  options: Array<[string, string]>,
): Promise<void> {
  await sdk.request({
    path: `data_sources/${dataSourceId}`,
    method: "patch",
    body: {
      properties: {
        Status: {
          status: {
            options: options.map(([name, color]) => ({ name, color })),
          },
        },
      },
    },
  });
}

async function ensureSelectOptions(
  sdk: Client,
  dataSourceId: string,
  propertyName: string,
  options: Array<[string, string]>,
): Promise<void> {
  await sdk.request({
    path: `data_sources/${dataSourceId}`,
    method: "patch",
    body: {
      properties: {
        [propertyName]: {
          select: {
            options: options.map(([name, color]) => ({ name, color })),
          },
        },
      },
    },
  });
}

async function ensureRelationProperty(input: {
  sdk: Client;
  dataSourceId: string;
  propertyName: string;
  relatedDataSourceId: string;
  syncedPropertyName?: string;
}): Promise<void> {
  const schema = (await input.sdk.request({
    path: `data_sources/${input.dataSourceId}`,
    method: "get",
  })) as { properties?: Record<string, unknown> };

  if (schema.properties?.[input.propertyName]) {
    return;
  }

  await input.sdk.request({
    path: `data_sources/${input.dataSourceId}`,
    method: "patch",
    body: {
      properties: {
        [input.propertyName]: input.syncedPropertyName
          ? {
              relation: {
                data_source_id: input.relatedDataSourceId,
                dual_property: {
                  synced_property_name: input.syncedPropertyName,
                },
              },
            }
          : {
              relation: {
                data_source_id: input.relatedDataSourceId,
                single_property: {},
              },
            },
      },
    },
  });
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
  if (input.existing) {
    return input.existing;
  }

  const parentPageId = extractNotionIdFromUrl(input.parentPageUrl);
  if (!parentPageId) {
    throw new AppError(
      `Could not resolve parent page id from "${input.parentPageUrl}"`,
    );
  }

  const response = (await input.sdk.request({
    path: "databases",
    method: "post",
    body: {
      parent: {
        type: "page_id",
        page_id: parentPageId,
      },
      title: toRichText(input.title),
      properties: {
        [input.titlePropertyName]: {
          title: {},
        },
      },
    },
  })) as {
    id: string;
    url: string;
    data_sources?: Array<{ id: string }>;
  };

  const dataSourceId = response.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new AppError(
      `Notion did not return a data source for "${input.title}"`,
    );
  }

  return {
    name: input.title,
    databaseUrl: response.url,
    databaseId: normalizeNotionId(response.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    destinationAlias: input.destinationAlias,
  };
}

function relationSchema(dataSourceId: string): {
  data_source_id: string;
  single_property: Record<string, never>;
} {
  return {
    data_source_id: dataSourceId,
    single_property: {},
  };
}

function toRichText(
  value: string,
): Array<{ type: "text"; text: { content: string } }> {
  return [
    {
      type: "text",
      text: {
        content: value,
      },
    },
  ];
}

function colorize(
  options: Array<[string, string]>,
): Array<{ name: string; color: string }> {
  return options.map(([name, color]) => ({ name, color }));
}
