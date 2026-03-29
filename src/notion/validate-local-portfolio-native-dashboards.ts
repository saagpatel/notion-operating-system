import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  loadLocalPortfolioNativeDashboardConfig,
  validateNativeDashboardPlanAgainstSchemas,
} from "./local-portfolio-native.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for native dashboard validation");
    }

    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase2Execution) {
      throw new AppError("Control tower config is missing phase2Execution");
    }

    const api = new DirectNotionClient(token);
    const dashboardConfig = await loadLocalPortfolioNativeDashboardConfig();
    const [projectSchema, taskSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
    ]);

    const summary = validateNativeDashboardPlanAgainstSchemas({
      controlConfig: config,
      dashboardConfig,
      schemas: {
        projects: projectSchema,
        tasks: taskSchema,
      },
    });

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
