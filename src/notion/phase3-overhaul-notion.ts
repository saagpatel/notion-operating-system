import "dotenv/config";

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
import { ensurePhase3IntelligenceSchema } from "./local-portfolio-intelligence-live.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 3 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    let nextConfig = config;

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      nextConfig = await ensurePhase3IntelligenceSchema(sdk, config);
      nextConfig = {
        ...nextConfig,
        phaseState: {
          ...nextConfig.phaseState,
          currentPhaseStatus: "In Progress",
        },
        phase3Intelligence: {
          ...nextConfig.phase3Intelligence!,
          lastSyncAt: today,
        },
      };
      await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);
      await upsertDestinationAliases(nextConfig);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          recommendationRunsDataSourceId: nextConfig.phase3Intelligence?.recommendationRuns.dataSourceId,
          linkSuggestionsDataSourceId: nextConfig.phase3Intelligence?.linkSuggestions.dataSourceId,
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
  if (!config.phase3Intelligence) {
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

  upsert("recommendation_runs", {
    alias: "recommendation_runs",
    description: "Create a new recommendation-run record.",
    destinationType: "data_source",
    sourceUrl: config.phase3Intelligence.recommendationRuns.databaseUrl,
    resolvedId: config.phase3Intelligence.recommendationRuns.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "Recommendation Run",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
    schemaSnapshot: {
      id: config.phase3Intelligence.recommendationRuns.dataSourceId,
      title: config.phase3Intelligence.recommendationRuns.name,
      titlePropertyName: "Name",
      properties: {
        Name: { name: "Name", type: "title", writable: true },
        Status: { name: "Status", type: "select", writable: true },
        "Run Type": { name: "Run Type", type: "select", writable: true },
      },
    },
  });

  upsert("link_suggestions", {
    alias: "link_suggestions",
    description: "Create a new link-suggestion review record.",
    destinationType: "data_source",
    sourceUrl: config.phase3Intelligence.linkSuggestions.databaseUrl,
    resolvedId: config.phase3Intelligence.linkSuggestions.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "Link Suggestion",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
    schemaSnapshot: {
      id: config.phase3Intelligence.linkSuggestions.dataSourceId,
      title: config.phase3Intelligence.linkSuggestions.name,
      titlePropertyName: "Name",
      properties: {
        Name: { name: "Name", type: "title", writable: true },
        Status: { name: "Status", type: "select", writable: true },
        "Suggestion Type": { name: "Suggestion Type", type: "select", writable: true },
      },
    },
  });

  await writeJsonFile(DESTINATIONS_PATH, registry);
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
