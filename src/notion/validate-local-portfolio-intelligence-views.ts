import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  loadLocalPortfolioControlTowerConfig,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
} from "./local-portfolio-control-tower.js";
import {
  loadLocalPortfolioIntelligenceViewPlan,
} from "./local-portfolio-intelligence-views.js";
import { validateLocalPortfolioIntelligenceViewPlanAgainstSchemas } from "./local-portfolio-intelligence-views.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for intelligence view validation");
    }

    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase3Intelligence) {
      throw new AppError("Control tower config is missing phase3Intelligence");
    }

    const api = new DirectNotionClient(token);
    const plan = await loadLocalPortfolioIntelligenceViewPlan();

    const [projectSchema, runSchema, suggestionSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.phase3Intelligence.recommendationRuns.dataSourceId),
      api.retrieveDataSource(config.phase3Intelligence.linkSuggestions.dataSourceId),
    ]);

    const summary = validateLocalPortfolioIntelligenceViewPlanAgainstSchemas(plan, {
      projects: projectSchema,
      recommendationRuns: runSchema,
      linkSuggestions: suggestionSchema,
    });

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
