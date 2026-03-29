import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "@notionhq/client";

import { buildProjectIntelligenceDataset } from "../portfolio-audit/project-intelligence.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  dateValue,
  fetchAllPages,
  relationIds,
  relationValue,
  richTextValue,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";

export interface BuildSessionEvidence {
  id: string;
  title: string;
  sessionDate: string;
  createdDate: string;
}

export interface WorkflowRunEvidence {
  occurredAt: string;
}

export interface LatestBuildEvidence {
  date: string;
  label: string;
  source: "build_session" | "workflow_run" | "none";
}

export interface SelectedBuildEvidence {
  latest: LatestBuildEvidence;
  buildSessionIds: string[];
  buildSessionCount: number;
}

interface ActivityRefreshProjectChange {
  title: string;
  lastActive?: { from: string; to: string };
  lastBuildSessionDate?: { from: string; to: string; source: LatestBuildEvidence["source"] };
  lastBuildSession?: { from: string; to: string };
  buildSessionCount?: { from: number; to: number };
  buildSessionsLinked?: { from: number; to: number };
}

interface Flags {
  live: boolean;
  limit: number;
  configPath: string;
}

export function selectLatestBuildEvidence(input: {
  buildSessions: BuildSessionEvidence[];
  workflowRuns: WorkflowRunEvidence[];
}): SelectedBuildEvidence {
  const buildSessionIds = uniqueIds(input.buildSessions.map((session) => session.id));

  const latestBuildSession = input.buildSessions
    .map((session) => ({
      ...session,
      effectiveDate: session.sessionDate || session.createdDate,
    }))
    .filter((session) => session.effectiveDate)
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];

  const latestWorkflowRun = input.workflowRuns
    .filter((run) => run.occurredAt)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];

  if (latestBuildSession && latestWorkflowRun) {
    if (latestWorkflowRun.occurredAt > latestBuildSession.effectiveDate) {
      return {
        latest: {
          date: latestWorkflowRun.occurredAt,
          label: "GitHub workflow run",
          source: "workflow_run",
        },
        buildSessionIds,
        buildSessionCount: buildSessionIds.length,
      };
    }

    return {
      latest: {
        date: latestBuildSession.effectiveDate,
        label: latestBuildSession.title || "Build session",
        source: "build_session",
      },
      buildSessionIds,
      buildSessionCount: buildSessionIds.length,
    };
  }

  if (latestBuildSession) {
    return {
      latest: {
        date: latestBuildSession.effectiveDate,
        label: latestBuildSession.title || "Build session",
        source: "build_session",
      },
      buildSessionIds,
      buildSessionCount: buildSessionIds.length,
    };
  }

  if (latestWorkflowRun) {
    return {
      latest: {
        date: latestWorkflowRun.occurredAt,
        label: "GitHub workflow run",
        source: "workflow_run",
      },
      buildSessionIds,
      buildSessionCount: buildSessionIds.length,
    };
  }

  return {
    latest: {
      date: "",
      label: "",
      source: "none",
    },
    buildSessionIds,
    buildSessionCount: buildSessionIds.length,
  };
}

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for activity refresh");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(flags.configPath);
    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [dataset, projectSchema, buildSchema] = await Promise.all([
      buildProjectIntelligenceDataset(),
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
    ]);

    const eventSchema = config.phase5ExternalSignals
      ? await api.retrieveDataSource(config.phase5ExternalSignals.events.dataSourceId)
      : undefined;

    const [projectPages, buildPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
    ]);
    const eventPages =
      config.phase5ExternalSignals && eventSchema
        ? await fetchAllPages(sdk, config.phase5ExternalSignals.events.dataSourceId, eventSchema.titlePropertyName)
        : [];

    const datasetByTitle = new Map(
      dataset.projects.map((project) => [normalizeTitle(project.projectName), project] as const),
    );
    const pagePathKeys = new Map(
      projectPages.map((page) => [page.id, normalizeProjectPath(textFromRichText(page.properties["Local Path"]))] as const),
    );
    const buildPagesByProjectId = buildPages.reduce<Map<string, BuildSessionEvidence[]>>((map, page) => {
      const evidence = toBuildSessionEvidence(page);
      for (const projectId of relationIds(page.properties["Local Project"])) {
        const bucket = map.get(projectId) ?? [];
        bucket.push(evidence);
        map.set(projectId, bucket);
      }
        return map;
      }, new Map());
    const buildPagesByPathKey = new Map<string, BuildSessionEvidence[]>();
    for (const [projectId, evidence] of buildPagesByProjectId.entries()) {
      const pathKey = pagePathKeys.get(projectId) ?? "";
      if (!pathKey) {
        continue;
      }
      const bucket = buildPagesByPathKey.get(pathKey) ?? [];
      bucket.push(...evidence);
      buildPagesByPathKey.set(pathKey, bucket);
    }

    const workflowRunsByProjectId = eventPages
      .map((page) => toExternalSignalEventRecord(page))
      .filter((event) => event.signalType === "Workflow Run" && event.occurredAt)
      .reduce<Map<string, WorkflowRunEvidence[]>>((map, event) => {
        for (const projectId of event.localProjectIds) {
          const bucket = map.get(projectId) ?? [];
          bucket.push({ occurredAt: event.occurredAt });
          map.set(projectId, bucket);
        }
        return map;
      }, new Map());
    const workflowRunsByPathKey = new Map<string, WorkflowRunEvidence[]>();
    for (const [projectId, evidence] of workflowRunsByProjectId.entries()) {
      const pathKey = pagePathKeys.get(projectId) ?? "";
      if (!pathKey) {
        continue;
      }
      const bucket = workflowRunsByPathKey.get(pathKey) ?? [];
      bucket.push(...evidence);
      workflowRunsByPathKey.set(pathKey, bucket);
    }

    let changedRows = 0;
    let lastActiveUpdates = 0;
    let buildDateUpdates = 0;
    let buildRelationUpdates = 0;
    const sampleChanges: ActivityRefreshProjectChange[] = [];

    for (const page of projectPages) {
      const project = datasetByTitle.get(normalizeTitle(page.title));
      const pagePathKey = pagePathKeys.get(page.id) ?? "";
      const directBuildSessions = buildPagesByProjectId.get(page.id) ?? [];
      const pathBuildSessions =
        directBuildSessions.length > 0 ? directBuildSessions : buildPagesByPathKey.get(pagePathKey) ?? [];
      const directWorkflowRuns = workflowRunsByProjectId.get(page.id) ?? [];
      const pathWorkflowRuns =
        directWorkflowRuns.length > 0 ? directWorkflowRuns : workflowRunsByPathKey.get(pagePathKey) ?? [];
      const usesPathFallbackBuildEvidence =
        directBuildSessions.length === 0 && pathBuildSessions.length > 0;
      const buildEvidence = selectLatestBuildEvidence({
        buildSessions: pathBuildSessions,
        workflowRuns: pathWorkflowRuns,
      });

      const currentLastActive = dateValue(page.properties["Last Active"]);
      const currentLastBuildDate = dateValue(page.properties["Last Build Session Date"]);
      const currentLastBuildSession = textFromRichText(page.properties["Last Build Session"]);
      const currentBuildSessionIds = relationIds(page.properties["Build Sessions"]);
      const currentBuildSessionCount =
        typeof page.properties["Build Session Count"]?.number === "number"
          ? page.properties["Build Session Count"]?.number ?? 0
          : currentBuildSessionIds.length;
      const nextBuildSessionIds = uniqueIds([
        ...currentBuildSessionIds,
        ...(usesPathFallbackBuildEvidence ? [] : buildEvidence.buildSessionIds),
      ]);
      const nextBuildSessionCount = nextBuildSessionIds.length;

      const updates: Record<string, unknown> = {};
      const change: ActivityRefreshProjectChange = { title: page.title };

      if (
        project?.lastActive &&
        (currentLastActive === "" || project.lastActive > currentLastActive)
      ) {
        updates["Last Active"] = { date: { start: project.lastActive } };
        change.lastActive = { from: currentLastActive, to: project.lastActive };
        lastActiveUpdates += 1;
      }

      if (nextBuildSessionIds.length > 0 && !sameIds(currentBuildSessionIds, nextBuildSessionIds)) {
        updates["Build Sessions"] = relationValue(nextBuildSessionIds);
        updates["Build Session Count"] = { number: nextBuildSessionCount };
        change.buildSessionsLinked = {
          from: currentBuildSessionIds.length,
          to: nextBuildSessionIds.length,
        };
        change.buildSessionCount = {
          from: currentBuildSessionCount,
          to: nextBuildSessionCount,
        };
        buildRelationUpdates += 1;
      } else if (
        nextBuildSessionCount > 0 &&
        currentBuildSessionCount !== nextBuildSessionCount
      ) {
        updates["Build Session Count"] = { number: nextBuildSessionCount };
        change.buildSessionCount = {
          from: currentBuildSessionCount,
          to: nextBuildSessionCount,
        };
      }

      const shouldAdvanceBuildDate =
        buildEvidence.latest.date !== "" &&
        (currentLastBuildDate === "" || buildEvidence.latest.date > currentLastBuildDate);

      if (shouldAdvanceBuildDate) {
        updates["Last Build Session Date"] = { date: { start: buildEvidence.latest.date } };
        change.lastBuildSessionDate = {
          from: currentLastBuildDate,
          to: buildEvidence.latest.date,
          source: buildEvidence.latest.source,
        };
        buildDateUpdates += 1;
      }

      const shouldUpdateBuildLabel =
        buildEvidence.latest.label !== "" &&
        buildEvidence.latest.label !== currentLastBuildSession &&
        (
          currentLastBuildSession === "" ||
          (buildEvidence.latest.source === "build_session" && shouldAdvanceBuildDate)
        );

      if (shouldUpdateBuildLabel) {
        updates["Last Build Session"] = richTextValue(buildEvidence.latest.label);
        change.lastBuildSession = {
          from: currentLastBuildSession,
          to: buildEvidence.latest.label,
        };
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      changedRows += 1;
      if (sampleChanges.length < flags.limit) {
        sampleChanges.push(change);
      }

      if (flags.live) {
        await api.updatePageProperties({
          pageId: page.id,
          properties: updates,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          changedRows,
          lastActiveUpdates,
          buildDateUpdates,
          buildRelationUpdates,
          sampleChanges,
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

function toBuildSessionEvidence(page: DataSourcePageRef): BuildSessionEvidence {
  return {
    id: page.id,
    title: page.title,
    sessionDate: dateValue(page.properties["Session Date"]),
    createdDate: page.createdTime?.slice(0, 10) ?? "",
  };
}

function textFromRichText(property: DataSourcePageRef["properties"][string] | undefined): string {
  return (property?.rich_text ?? []).map((item) => item.plain_text ?? "").join("").trim();
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeProjectPath(value: string): string {
  return value
    .replace(/^\/Users\/d\/Projects\//, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "");
}

function sameIds(left: string[], right: string[]): boolean {
  return JSON.stringify(uniqueIds(left).sort()) === JSON.stringify(uniqueIds(right).sort());
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function parseFlags(argv: string[]): Flags {
  let live = false;
  let limit = 10;
  let configPath = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }
    if (!current.startsWith("--")) {
      configPath = current;
      continue;
    }
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--limit") {
      const next = Number(argv[index + 1] ?? "");
      if (Number.isFinite(next) && next > 0) {
        limit = next;
      }
      index += 1;
    }
  }

  return { live, limit, configPath };
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  void main();
}
