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
import { ensurePhase7ActuationSchema } from "./local-portfolio-actuation-live.js";
import { DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH } from "./local-portfolio-actuation.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "./local-portfolio-roadmap.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 7 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase6Governance || !config.phase5ExternalSignals) {
      throw new AppError("Phase 7 requires phase6Governance and phase5ExternalSignals to already exist");
    }

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      config = await ensurePhase7ActuationSchema(sdk, config);
      config = {
        ...config,
        phaseState: {
          ...config.phaseState,
          currentPhase: Math.max(config.phaseState.currentPhase, 7),
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
          executionsDataSourceId: config.phase7Actuation?.executions.dataSourceId,
          currentPhase: config.phaseState.currentPhase,
          currentPhaseStatus: config.phaseState.currentPhaseStatus,
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

async function upsertDestinationAliases(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  if (!config.phase7Actuation) {
    return;
  }
  const registry = await readJsonFile<DestinationRegistryConfig>(DESTINATIONS_PATH);
  const alias = config.phase7Actuation.executions.destinationAlias;
  const patch: DestinationRegistryConfig["destinations"][number] = {
    alias,
    description: "Create or update external action execution rows.",
    destinationType: "data_source",
    sourceUrl: config.phase7Actuation.executions.databaseUrl,
    resolvedId: config.phase7Actuation.executions.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "External Action Execution",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
  };
  const existingIndex = registry.destinations.findIndex((entry) => entry.alias === alias);
  if (existingIndex >= 0) {
    registry.destinations[existingIndex] = patch;
  } else {
    registry.destinations.push(patch);
  }
  await writeJsonFile(DESTINATIONS_PATH, registry);
}

async function updateViewPlanDatabaseRefs(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  if (!config.phase7Actuation || !config.phase6Governance || !config.phase5ExternalSignals) {
    return;
  }
  const plan = await readJsonFile<Record<string, unknown>>(DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH);
  const collections = Array.isArray(plan.collections) ? plan.collections : [];
  for (const entry of collections) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const collection = entry as Record<string, unknown>;
    const key = collection.key;
    if (key === "actionRequests") {
      collection.database = config.phase6Governance.actionRequests;
    } else if (key === "executions") {
      collection.database = config.phase7Actuation.executions;
    } else if (key === "sources") {
      collection.database = config.phase5ExternalSignals.sources;
    }
  }
  await writeJsonFile(DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH, plan);
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
