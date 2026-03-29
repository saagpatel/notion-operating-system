import "dotenv/config";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  loadLocalPortfolioControlTowerConfig,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
} from "./local-portfolio-control-tower.js";
import {
  loadLocalPortfolioExternalSignalViewPlan,
  validateLocalPortfolioExternalSignalViewPlanAgainstSchemas,
} from "./local-portfolio-external-signal-views.js";

export interface ExternalSignalViewsValidateCommandOptions {
  config?: string;
}

export async function runExternalSignalViewsValidateCommand(
  options: ExternalSignalViewsValidateCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for external signal view validation");
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
  if (!config.phase5ExternalSignals) {
    throw new AppError("Control tower config is missing phase5ExternalSignals");
  }

  const api = new DirectNotionClient(token);
  const plan = await loadLocalPortfolioExternalSignalViewPlan();

  const [sourcesSchema, eventsSchema, syncRunsSchema, projectsSchema] = await Promise.all([
    api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
    api.retrieveDataSource(config.phase5ExternalSignals.events.dataSourceId),
    api.retrieveDataSource(config.phase5ExternalSignals.syncRuns.dataSourceId),
    api.retrieveDataSource(config.database.dataSourceId),
  ]);

  const summary = validateLocalPortfolioExternalSignalViewPlanAgainstSchemas({
    plan,
    schemas: {
      sources: sourcesSchema,
      events: eventsSchema,
      syncRuns: syncRunsSchema,
      projects: projectsSchema,
    },
  });

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

async function main(): Promise<void> {
  try {
    await runExternalSignalViewsValidateCommand({
      config:
        process.argv[2]?.startsWith("--")
          ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
          : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
    });
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["signals", "views-validate"]);
}
