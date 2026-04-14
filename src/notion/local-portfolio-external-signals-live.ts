import { Client } from "@notionhq/client";

import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type { DataSourcePageRef, NotionPageProperty } from "./local-portfolio-control-tower-live.js";
import {
  checkboxValue,
  dateValue,
  numberValue,
  relationIds,
  selectValue,
  textValue,
} from "./local-portfolio-control-tower-live.js";
import type {
  ExternalSignalEventRecord,
  ExternalSignalSourceRecord,
  ExternalSignalSyncRunRecord,
} from "./local-portfolio-external-signals.js";
import { AppError } from "../utils/errors.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";

export async function ensurePhase5ExternalSignalSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
): Promise<LocalPortfolioControlTowerConfig> {
  const sources = await ensureDataSourceRef({
    sdk,
    existing: config.phase5ExternalSignals?.sources,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Signal Sources",
    titlePropertyName: "Name",
    destinationAlias: "external_signal_sources",
  });
  const events = await ensureDataSourceRef({
    sdk,
    existing: config.phase5ExternalSignals?.events,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Signal Events",
    titlePropertyName: "Name",
    destinationAlias: "external_signal_events",
  });
  const syncRuns = await ensureDataSourceRef({
    sdk,
    existing: config.phase5ExternalSignals?.syncRuns,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Signal Sync Runs",
    titlePropertyName: "Name",
    destinationAlias: "external_signal_sync_runs",
  });

  const [projectSchema, sourcesSchema, eventsSchema, syncRunsSchema] = await Promise.all([
    sdk.request({
      path: `data_sources/${config.database.dataSourceId}`,
      method: "get",
    }) as Promise<{ properties?: Record<string, unknown> }>,
    sdk.request({
      path: `data_sources/${sources.dataSourceId}`,
      method: "get",
    }) as Promise<{ properties?: Record<string, unknown> }>,
    sdk.request({
      path: `data_sources/${events.dataSourceId}`,
      method: "get",
    }) as Promise<{ properties?: Record<string, unknown> }>,
    sdk.request({
      path: `data_sources/${syncRuns.dataSourceId}`,
      method: "get",
    }) as Promise<{ properties?: Record<string, unknown> }>,
  ]);

  await Promise.all([
    sdk.request({
      path: `data_sources/${config.database.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "External Signal Coverage": {
            select: {
              options: mergeSelectOptions(projectSchema.properties?.["External Signal Coverage"], [
                ["None", "default"],
                ["Repo Only", "blue"],
                ["Repo + Deploy", "green"],
                ["Calendar Only", "yellow"],
                ["Mixed", "orange"],
              ]),
            },
          },
          "Latest External Activity": { date: {} },
          "Latest Deployment Status": {
            select: {
              options: mergeSelectOptions(projectSchema.properties?.["Latest Deployment Status"], [
                ["Success", "green"],
                ["Failed", "red"],
                ["Building", "blue"],
                ["Canceled", "gray"],
                ["Unknown", "default"],
                ["Not Deployed", "brown"],
              ]),
            },
          },
          "Open PR Count": { number: { format: "number" } },
          "Recent Failed Workflow Runs": { number: { format: "number" } },
          "External Signal Updated": { date: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${sources.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Local Project": { relation: relationSchema(config.database.dataSourceId) },
          Provider: {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.Provider, [
                ["GitHub", "gray"],
                ["Vercel", "blue"],
                ["Google Calendar", "yellow"],
                ["Netlify", "green"],
                ["Render", "orange"],
                ["Cloudflare", "gray"],
              ]),
            },
          },
          "Source Type": {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.["Source Type"], [
                ["Repo", "blue"],
                ["Deployment Project", "green"],
                ["Calendar", "yellow"],
              ]),
            },
          },
          Identifier: { rich_text: {} },
          "Source URL": { url: {} },
          "Provider Scope Type": {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.["Provider Scope Type"], [
                ["Personal", "default"],
                ["Team", "blue"],
              ]),
            },
          },
          "Provider Scope ID": { rich_text: {} },
          "Provider Scope Slug": { rich_text: {} },
          Status: {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.Status, [
                ["Active", "green"],
                ["Paused", "gray"],
                ["Needs Mapping", "orange"],
                ["Needs Review", "red"],
              ]),
            },
          },
          Environment: {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.Environment, [
                ["Production", "green"],
                ["Preview", "blue"],
                ["N/A", "default"],
              ]),
            },
          },
          "Sync Strategy": {
            select: {
              options: mergeSelectOptions(sourcesSchema.properties?.["Sync Strategy"], [
                ["Poll", "blue"],
                ["Incremental", "purple"],
              ]),
            },
          },
          "Last Synced At": { date: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${events.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Local Project": { relation: relationSchema(config.database.dataSourceId) },
          Source: { relation: relationSchema(sources.dataSourceId) },
          Provider: {
            select: {
              options: mergeSelectOptions(eventsSchema.properties?.Provider, [
                ["GitHub", "gray"],
                ["Vercel", "blue"],
                ["Google Calendar", "yellow"],
                ["Netlify", "green"],
                ["Render", "orange"],
                ["Cloudflare", "gray"],
              ]),
            },
          },
          "Signal Type": {
            select: {
              options: mergeSelectOptions(eventsSchema.properties?.["Signal Type"], [
                ["Pull Request", "blue"],
                ["Workflow Run", "orange"],
                ["Deployment", "green"],
                ["Release", "purple"],
                ["Calendar Block", "yellow"],
                ["Issue", "green"],
                ["Issue Comment", "blue"],
              ]),
            },
          },
          "Occurred At": { date: {} },
          Status: { rich_text: {} },
          Environment: {
            select: {
              options: mergeSelectOptions(eventsSchema.properties?.Environment, [
                ["Production", "green"],
                ["Preview", "blue"],
                ["N/A", "default"],
              ]),
            },
          },
          Severity: {
            select: {
              options: mergeSelectOptions(eventsSchema.properties?.Severity, [
                ["Info", "default"],
                ["Watch", "orange"],
                ["Risk", "red"],
              ]),
            },
          },
          "Source ID": { rich_text: {} },
          "Source URL": { url: {} },
          "Sync Run": { relation: relationSchema(syncRuns.dataSourceId) },
          "Event Key": { rich_text: {} },
          Summary: { rich_text: {} },
          "Raw Excerpt": { rich_text: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${syncRuns.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Provider: {
            select: {
              options: mergeSelectOptions(syncRunsSchema.properties?.Provider, [
                ["GitHub", "gray"],
                ["Vercel", "blue"],
                ["Google Calendar", "yellow"],
              ]),
            },
          },
          Status: {
            select: {
              options: mergeSelectOptions(syncRunsSchema.properties?.Status, [
                ["Started", "blue"],
                ["Succeeded", "green"],
                ["Partial", "orange"],
                ["Failed", "red"],
              ]),
            },
          },
          "Started At": { date: {} },
          "Completed At": { date: {} },
          Scope: { rich_text: {} },
          "Items Seen": { number: { format: "number" } },
          "Items Written": { number: { format: "number" } },
          "Items Deduped": { number: { format: "number" } },
          Failures: { number: { format: "number" } },
          "Cursor / Sync Token": { rich_text: {} },
          Notes: { rich_text: {} },
        },
      },
    }),
  ]);

  const derived = new Set(config.fieldOwnership.derived);
  derived.add("External Signal Coverage");
  derived.add("Latest External Activity");
  derived.add("Latest Deployment Status");
  derived.add("Open PR Count");
  derived.add("Recent Failed Workflow Runs");
  derived.add("External Signal Updated");

  return {
    ...config,
    fieldOwnership: {
      ...config.fieldOwnership,
      derived: [...derived],
    },
    phase5ExternalSignals: {
      sources,
      events,
      syncRuns,
      providerEnablement: config.phase5ExternalSignals?.providerEnablement ?? {
        github: true,
        vercel: true,
        googleCalendar: false,
      },
      pollingCadenceMinutes: config.phase5ExternalSignals?.pollingCadenceMinutes ?? {
        github: 60,
        vercel: 60,
        googleCalendar: 240,
      },
      syncLimits: config.phase5ExternalSignals?.syncLimits ?? {
        maxProjectsInFirstWave: 15,
        maxEventsPerSource: 25,
      },
      scoringModelVersion: config.phase5ExternalSignals?.scoringModelVersion ?? "balanced-hybrid-v2",
      viewIds: config.phase5ExternalSignals?.viewIds ?? {
        sources: {},
        events: {},
        syncRuns: {},
        projects: {},
      },
      phaseMemory: config.phase5ExternalSignals?.phaseMemory ?? {
        phase1GaveUs:
          "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
        phase2Added:
          "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
        phase3Added:
          "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
        phase4Added:
          "Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.",
        phase5Added:
          "Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.",
        phase6Brief:
          "Phase 6 will add webhook policy, identity boundaries, credential posture, replay and dedupe rules, approval gates, and audit requirements before any higher-trust integration or external mutation.",
        phase7Brief:
          "Phase 7 will allow tightly approved cross-system actions such as creating work items, annotating deploys, or writing back to external systems from trusted recommendations.",
      },
      baselineCapturedAt: config.phase5ExternalSignals?.baselineCapturedAt,
      baselineMetrics: config.phase5ExternalSignals?.baselineMetrics,
      lastSyncAt: config.phase5ExternalSignals?.lastSyncAt,
      lastSyncMetrics: config.phase5ExternalSignals?.lastSyncMetrics,
    },
  };
}

export function toExternalSignalSourceRecord(page: DataSourcePageRef): ExternalSignalSourceRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    localProjectIds: relationIds(page.properties["Local Project"]),
    provider: selectValue(page.properties.Provider) as ExternalSignalSourceRecord["provider"],
    sourceType: selectValue(page.properties["Source Type"]) as ExternalSignalSourceRecord["sourceType"],
    identifier: textValue(page.properties.Identifier),
    sourceUrl: page.properties["Source URL"]?.url?.trim() ?? "",
    status: selectValue(page.properties.Status) as ExternalSignalSourceRecord["status"],
    environment: selectValue(page.properties.Environment) as ExternalSignalSourceRecord["environment"],
    syncStrategy: selectValue(page.properties["Sync Strategy"]) as ExternalSignalSourceRecord["syncStrategy"],
    lastSyncedAt: dateValue(page.properties["Last Synced At"]),
    providerScopeType: selectValue(page.properties["Provider Scope Type"]) as ExternalSignalSourceRecord["providerScopeType"],
    providerScopeId: textValue(page.properties["Provider Scope ID"]),
    providerScopeSlug: textValue(page.properties["Provider Scope Slug"]),
  };
}

export function toExternalSignalEventRecord(page: DataSourcePageRef): ExternalSignalEventRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    localProjectIds: relationIds(page.properties["Local Project"]),
    sourceIds: relationIds(page.properties.Source),
    provider: selectValue(page.properties.Provider) as ExternalSignalEventRecord["provider"],
    signalType: selectValue(page.properties["Signal Type"]) as ExternalSignalEventRecord["signalType"],
    occurredAt: dateValue(page.properties["Occurred At"]),
    status: textValue(page.properties.Status),
    environment: selectValue(page.properties.Environment) as ExternalSignalEventRecord["environment"],
    severity: selectValue(page.properties.Severity) as ExternalSignalEventRecord["severity"],
    sourceIdValue: textValue(page.properties["Source ID"]),
    sourceUrl: page.properties["Source URL"]?.url?.trim() ?? "",
    syncRunIds: relationIds(page.properties["Sync Run"]),
    eventKey: textValue(page.properties["Event Key"]),
    summary: textValue(page.properties.Summary),
    rawExcerpt: textValue(page.properties["Raw Excerpt"]),
  };
}

export function toExternalSignalSyncRunRecord(page: DataSourcePageRef): ExternalSignalSyncRunRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    provider: selectValue(page.properties.Provider) as ExternalSignalSyncRunRecord["provider"],
    status: selectValue(page.properties.Status) as ExternalSignalSyncRunRecord["status"],
    startedAt: dateValue(page.properties["Started At"]),
    completedAt: dateValue(page.properties["Completed At"]),
    scope: textValue(page.properties.Scope),
    itemsSeen: numberValue(page.properties["Items Seen"]),
    itemsWritten: numberValue(page.properties["Items Written"]),
    itemsDeduped: numberValue(page.properties["Items Deduped"]),
    failures: numberValue(page.properties.Failures),
    cursor: textValue(page.properties["Cursor / Sync Token"]),
    notes: textValue(page.properties.Notes),
  };
}

function peopleIds(property?: NotionPageProperty): string[] {
  return Array.isArray(property?.people)
    ? property.people
        .map((person) => (typeof person?.id === "string" ? normalizeNotionId(person.id) : ""))
        .filter(Boolean)
    : [];
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
    throw new AppError(`Could not resolve parent page id from "${input.parentPageUrl}"`);
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
    throw new AppError(`Notion did not return a data source for "${input.title}"`);
  }

  return {
    name: input.title,
    databaseUrl: response.url,
    databaseId: normalizeNotionId(response.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    destinationAlias: input.destinationAlias,
  };
}

function relationSchema(dataSourceId: string): { data_source_id: string; single_property: Record<string, never> } {
  return {
    data_source_id: dataSourceId,
    single_property: {},
  };
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

function colorize(options: Array<[string, string]>): Array<{ name: string; color: string }> {
  return options.map(([name, color]) => ({ name, color }));
}

function mergeSelectOptions(
  property: unknown,
  desired: Array<[string, string]>,
): Array<{ name: string; color: string }> {
  const existingOptions =
    property && typeof property === "object" && "select" in property
      ? ((property as { select?: { options?: Array<{ name?: string; color?: string }> } }).select?.options ?? [])
      : [];
  const existingColors = new Map(
    existingOptions
      .filter((option): option is { name: string; color?: string } => typeof option?.name === "string")
      .map((option) => [option.name, option.color ?? "default"]),
  );
  return desired.map(([name, color]) => ({
    name,
    color: existingColors.get(name) ?? color,
  }));
}
