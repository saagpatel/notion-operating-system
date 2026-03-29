import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  applyDerivedSignals,
  calculateControlTowerMetrics,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  renderCommandCenterMarkdown,
  saveLocalPortfolioControlTowerConfig,
  type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import {
  ensureLocalPortfolioControlTowerSchema,
  fetchAllPages,
  selectPropertyValue,
  datePropertyValue,
  toBuildSessionRecord,
  toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";
import { loadLocalPortfolioViewPlan, validateLocalPortfolioViewPlanAgainstSchema } from "./local-portfolio-views.js";
import { Publisher } from "../publishing/publisher.js";
import { losAngelesToday } from "../utils/date.js";

export interface ControlTowerSyncCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
}

export async function runControlTowerSyncCommand(
  options: ControlTowerSyncCommandOptions = {},
): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const logger = RunLogger.fromRuntimeConfig(runtimeConfig);
  await logger.init();

  const token = runtimeConfig.notion.token;
  if (!token) {
    throw new Error("NOTION_TOKEN is required for control-tower sync");
  }
  const live = options.live ?? false;
  const today = options.today ?? losAngelesToday();

  const [config, viewPlan, registry] = await Promise.all([
    loadLocalPortfolioControlTowerConfig(options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH),
    loadLocalPortfolioViewPlan(),
    DestinationRegistry.load(runtimeConfig.paths.destinationsPath),
  ]);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token, logger);
    const publisher = new Publisher(api, logger);

    if (live) {
      await ensureLocalPortfolioControlTowerSchema(sdk, config);
    }
    const schema = await api.retrieveDataSource(config.database.dataSourceId);
    validateLocalPortfolioViewPlanAgainstSchema(viewPlan, schema);

    const [projectPages, buildPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, schema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, "Session Title"),
    ]);

    const projects = projectPages.map((page) => toControlTowerProjectRecord(page));
    const recentBuildSessions = buildPages
      .map((page) => toBuildSessionRecord(page))
      .filter((session) => session.sessionDate && diffDays(session.sessionDate, today) <= 7);

    const derivedProjects = projects.map((project) => applyDerivedSignals(project, config, today));
    let changedRows = 0;

    if (live) {
      for (const project of derivedProjects) {
        const previous = projects.find((entry) => entry.id === project.id);
        const propertyUpdates = buildDerivedPropertyUpdates(previous, project);
        if (Object.keys(propertyUpdates).length === 0) {
          continue;
        }

        await api.updatePageProperties({
          pageId: project.id,
          properties: propertyUpdates,
        });
        changedRows += 1;
      }
    } else {
      changedRows = derivedProjects.filter((project) => {
        const previous = projects.find((entry) => entry.id === project.id);
        return Object.keys(buildDerivedPropertyUpdates(previous, project)).length > 0;
      }).length;
    }

    const metrics = calculateControlTowerMetrics(derivedProjects, recentBuildSessions, today);
    const baselineCaptured = !config.phaseState.baselineMetrics;
    const nextConfig = {
      ...config,
      phaseState: {
        ...config.phaseState,
        baselineCapturedAt: baselineCaptured ? today : config.phaseState.baselineCapturedAt,
        baselineMetrics: baselineCaptured ? metrics : config.phaseState.baselineMetrics,
        lastSyncAt: today,
        lastSyncMetrics: metrics,
      },
    };

    const markdown = renderCommandCenterMarkdown({
      generatedAt: today,
      metrics,
      baselineMetrics: nextConfig.phaseState.baselineMetrics,
      projects: derivedProjects,
      recentBuildSessions,
      config: nextConfig,
      today,
    });

    const commandCenterBootstrap = !nextConfig.commandCenter.pageId;
    const commandCenterSummary = await publishCommandCenter({
      registry,
      publisher,
      config: nextConfig,
      markdown,
      live,
    });

    if (live) {
      const finalConfig = {
        ...nextConfig,
        commandCenter: {
          ...nextConfig.commandCenter,
          pageId: commandCenterSummary.pageId ?? nextConfig.commandCenter.pageId,
          pageUrl: commandCenterSummary.pageUrl ?? nextConfig.commandCenter.pageUrl,
        },
      };

      await saveLocalPortfolioControlTowerConfig(finalConfig);

      if (commandCenterBootstrap && commandCenterSummary.pageId && commandCenterSummary.pageUrl) {
        await registry.patchDestination(finalConfig.destinations.commandCenterAlias, {
          sourceUrl: commandCenterSummary.pageUrl,
          resolvedId: commandCenterSummary.pageId,
          mode: "replace_full_content",
        });
      }
    }

  const output = {
    ok: true,
    live,
    changedRows,
    baselineCaptured,
    commandCenterPageId: commandCenterSummary.pageId ?? nextConfig.commandCenter.pageId,
    commandCenterPageUrl: commandCenterSummary.pageUrl ?? nextConfig.commandCenter.pageUrl,
    metrics,
  };
  recordCommandOutputSummary(output);
  console.log(JSON.stringify(output, null, 2));
}

async function publishCommandCenter(input: {
  registry: DestinationRegistry;
  publisher: Publisher;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  markdown: string;
  live: boolean;
}): Promise<{ pageId?: string; pageUrl?: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-portfolio-command-center-"));
  const filePath = path.join(tempDir, "command-center.md");
  await writeFile(filePath, input.markdown, "utf8");

  try {
    const destination = input.registry.getDestination(input.config.destinations.commandCenterAlias);
    const summary = await input.publisher.publish(destination, {
      destinationAlias: destination.alias,
      inputFile: filePath,
      dryRun: input.live ? false : true,
      live: input.live,
    });

    return {
      pageId: summary.pageId,
      pageUrl: summary.pageUrl,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildDerivedPropertyUpdates(
  previous: ControlTowerProjectRecord | undefined,
  next: ControlTowerProjectRecord,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (previous?.operatingQueue !== next.operatingQueue) {
    updates["Operating Queue"] = selectPropertyValue(next.operatingQueue);
  }
  if (previous?.nextReviewDate !== next.nextReviewDate) {
    updates["Next Review Date"] = next.nextReviewDate ? datePropertyValue(next.nextReviewDate) : { date: null };
  }
  if (previous?.evidenceFreshness !== next.evidenceFreshness) {
    updates["Evidence Freshness"] = next.evidenceFreshness
      ? selectPropertyValue(next.evidenceFreshness)
      : { select: null };
  }
  return updates;
}

function diffDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["control-tower", "sync"]);
}
