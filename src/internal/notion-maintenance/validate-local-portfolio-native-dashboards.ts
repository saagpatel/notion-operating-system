import "../../config/load-default-env.js";

import { isDirectExecution } from "../../cli/legacy.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  loadLocalPortfolioNativeDashboardConfig,
  validateNativeDashboardPlanAgainstSchemas,
} from "../../notion/local-portfolio-native.js";

async function main(): Promise<void> {
  try {
    if (shouldShowHelp(process.argv.slice(2))) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:native-dashboard-validate --",
          description: "Validate the native dashboard plan against live schemas.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--config <path>", description: "Path to the control-tower config file." },
          ],
        }),
      );
      return;
    }

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

if (isDirectExecution(import.meta.url)) {
  void main();
}
