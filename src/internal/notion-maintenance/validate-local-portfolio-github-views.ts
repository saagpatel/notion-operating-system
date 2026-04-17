import "dotenv/config";

import { isDirectExecution } from "../../cli/legacy.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { renderDirectScriptHelp, shouldShowDirectScriptHelp } from "../../notion/direct-script-help.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  loadLocalPortfolioGitHubViewPlan,
  validateLocalPortfolioActuationViewPlanAgainstSchemas,
} from "../../notion/local-portfolio-actuation.js";

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (shouldShowDirectScriptHelp(argv)) {
      process.stdout.write(
        renderDirectScriptHelp({
          command: "tsx src/internal/notion-maintenance/validate-local-portfolio-github-views.ts [config-path]",
          description: "Validate the local portfolio GitHub view plan against live Notion schemas.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
          ],
          notes: [
            "When no config path is provided, the default control-tower config is used.",
          ],
        }),
      );
      return;
    }

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

if (isDirectExecution(import.meta.url)) {
  void main();
}
