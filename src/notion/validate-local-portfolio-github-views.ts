import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  loadLocalPortfolioGitHubViewPlan,
  validateLocalPortfolioActuationViewPlanAgainstSchemas,
} from "./local-portfolio-actuation.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for GitHub view validation");
    }
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase7Actuation || !config.phase6Governance || !config.phase5ExternalSignals) {
      throw new AppError("Control tower config is missing phase7Actuation, phase6Governance, or phase5ExternalSignals");
    }

    const api = new DirectNotionClient(token);
    const plan = await loadLocalPortfolioGitHubViewPlan();
    const [actionRequestsSchema, executionsSchema, sourcesSchema] = await Promise.all([
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase7Actuation.executions.dataSourceId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
    ]);

    const summary = validateLocalPortfolioActuationViewPlanAgainstSchemas({
      plan,
      schemas: {
        actionRequests: actionRequestsSchema,
        executions: executionsSchema,
        sources: sourcesSchema,
      },
    });

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
