import "dotenv/config";

import { Client } from "@notionhq/client";

import { DestinationRegistry } from "../config/destination-registry.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { ensurePhase2ExecutionSchema } from "./local-portfolio-execution-live.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 2 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase2Execution) {
      throw new AppError("Control tower config is missing phase2Execution");
    }

    const registry = await DestinationRegistry.load(process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json");
    registry.getDestination(config.phase2Execution.decisions.destinationAlias);
    registry.getDestination(config.phase2Execution.packets.destinationAlias);
    registry.getDestination(config.phase2Execution.tasks.destinationAlias);

    const api = new DirectNotionClient(token);
    const [decisionsSchema, packetsSchema, tasksSchema] = await Promise.all([
      api.retrieveDataSource(config.phase2Execution.decisions.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
    ]);

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      await ensurePhase2ExecutionSchema(sdk, config);
      await saveLocalPortfolioControlTowerConfig(
        {
          ...config,
          phaseState: {
            ...config.phaseState,
            currentPhaseStatus: "In Progress",
          },
          phase2Execution: {
            ...config.phase2Execution,
            lastSyncAt: today,
          },
        },
        configPath,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          decisionsDataSourceId: decisionsSchema.id,
          packetsDataSourceId: packetsSchema.id,
          tasksDataSourceId: tasksSchema.id,
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
