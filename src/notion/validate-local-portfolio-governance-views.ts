import "dotenv/config";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
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

export interface GovernanceViewsValidateCommandOptions {
  config?: string;
}

export async function runGovernanceViewsValidateCommand(
  options: GovernanceViewsValidateCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for governance view validation");
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
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

  const output = { ok: true, ...summary };
  recordCommandOutputSummary(output, {
    metadata: {
      validatedViews: summary.validatedViews.length,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    await runGovernanceViewsValidateCommand({
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
  void runLegacyCliPath(["governance", "views-validate"]);
}
