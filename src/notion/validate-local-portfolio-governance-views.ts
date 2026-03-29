import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  loadLocalPortfolioGovernanceViewPlan,
  validateLocalPortfolioGovernanceViewPlanAgainstSchemas,
} from "./local-portfolio-governance-views.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for governance view validation");
    }

    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase6Governance) {
      throw new AppError("Control tower config is missing phase6Governance");
    }

    const api = new DirectNotionClient(token);
    const plan = await loadLocalPortfolioGovernanceViewPlan();

    const [policiesSchema, actionRequestsSchema, endpointsSchema, deliveriesSchema, receiptsSchema] = await Promise.all([
      api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.webhookEndpoints.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.webhookDeliveries.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.webhookReceipts.dataSourceId),
    ]);

    const summary = validateLocalPortfolioGovernanceViewPlanAgainstSchemas({
      plan,
      schemas: {
        policies: policiesSchema,
        actionRequests: actionRequestsSchema,
        endpoints: endpointsSchema,
        deliveries: deliveriesSchema,
        receipts: receiptsSchema,
      },
    });

    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
