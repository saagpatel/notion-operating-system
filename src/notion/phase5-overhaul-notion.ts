import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@notionhq/client";

import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import type { DestinationRegistryConfig } from "../types.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { ensurePhase5ExternalSignalSchema } from "./local-portfolio-external-signals-live.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_VIEWS_PATH,
} from "./local-portfolio-external-signals.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "./local-portfolio-roadmap.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 5 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      config = await ensurePhase5ExternalSignalSchema(sdk, config);
      config = {
        ...config,
        phaseState: {
          ...config.phaseState,
          currentPhase: Math.max(config.phaseState.currentPhase, 5),
          currentPhaseStatus: "In Progress",
        },
      };
      await saveLocalPortfolioControlTowerConfig(config, configPath);
      await upsertDestinationAliases(config);
      await updateViewPlanDatabaseRefs(config);
    }

    const roadmapMarkdown = renderNotionRoadmapMarkdown({
      generatedAt: today,
      currentPhase: config.phaseState.currentPhase,
      currentPhaseStatus: config.phaseState.currentPhaseStatus,
      baselineMetrics: config.phaseState.baselineMetrics,
      latestMetrics: config.phaseState.lastSyncMetrics,
      lastClosedPhase: config.phaseState.lastClosedPhase,
    });
    const phaseMemoryMarkdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: today,
      currentPhase: config.phaseState.currentPhase,
    });

    await writeFile(path.join(process.cwd(), "docs", "notion-roadmap.md"), roadmapMarkdown, "utf8");
    await writeFile(path.join(process.cwd(), "docs", "notion-phase-memory.md"), phaseMemoryMarkdown, "utf8");

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          sourcesDataSourceId: config.phase5ExternalSignals?.sources.dataSourceId,
          eventsDataSourceId: config.phase5ExternalSignals?.events.dataSourceId,
          syncRunsDataSourceId: config.phase5ExternalSignals?.syncRuns.dataSourceId,
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

async function upsertDestinationAliases(config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>): Promise<void> {
  if (!config.phase5ExternalSignals) {
    return;
  }

  const registry = await readJsonFile<DestinationRegistryConfig>(DESTINATIONS_PATH);
  const upsert = (alias: string, patch: DestinationRegistryConfig["destinations"][number]) => {
    const existingIndex = registry.destinations.findIndex((destination) => destination.alias === alias);
    if (existingIndex >= 0) {
      registry.destinations[existingIndex] = patch;
      return;
    }
    registry.destinations.push(patch);
  };

  upsert("external_signal_sources", {
    alias: "external_signal_sources",
    description: "Create or update external source mapping rows.",
    destinationType: "data_source",
    sourceUrl: config.phase5ExternalSignals.sources.databaseUrl,
    resolvedId: config.phase5ExternalSignals.sources.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "External Signal Source",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
  });

  upsert("external_signal_events", {
    alias: "external_signal_events",
    description: "Create external telemetry event ledger rows.",
    destinationType: "data_source",
    sourceUrl: config.phase5ExternalSignals.events.databaseUrl,
    resolvedId: config.phase5ExternalSignals.events.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "External Signal Event",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
  });

  upsert("external_signal_sync_runs", {
    alias: "external_signal_sync_runs",
    description: "Create external-signal sync-run audit records.",
    destinationType: "data_source",
    sourceUrl: config.phase5ExternalSignals.syncRuns.databaseUrl,
    resolvedId: config.phase5ExternalSignals.syncRuns.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "External Signal Sync Run",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
  });

  await writeJsonFile(DESTINATIONS_PATH, registry);
}

async function updateViewPlanDatabaseRefs(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  if (!config.phase5ExternalSignals) {
    return;
  }

  const plan = await readJsonFile<Record<string, unknown>>(DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_VIEWS_PATH);
  const collections = Array.isArray(plan.collections) ? plan.collections : [];

  for (const entry of collections) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const collection = entry as Record<string, unknown>;
    const key = collection.key;
    if (key === "sources") {
      collection.database = config.phase5ExternalSignals.sources;
    } else if (key === "events") {
      collection.database = config.phase5ExternalSignals.events;
    } else if (key === "syncRuns") {
      collection.database = config.phase5ExternalSignals.syncRuns;
    } else if (key === "projects") {
      collection.database = config.database;
    }
  }

  await writeJsonFile(DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_VIEWS_PATH, plan);
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
