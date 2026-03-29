import "dotenv/config";

import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  buildGovernanceAuditSummary,
  loadLocalPortfolioGovernancePolicyConfig,
  loadLocalPortfolioWebhookProviderConfig,
} from "./local-portfolio-governance.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const [controlConfig, policyConfig, providerConfig] = await Promise.all([
      loadLocalPortfolioControlTowerConfig(configPath),
      loadLocalPortfolioGovernancePolicyConfig(),
      loadLocalPortfolioWebhookProviderConfig(),
    ]);
    if (!controlConfig.phase6Governance) {
      throw new AppError("Control tower config is missing phase6Governance");
    }

    const summary = buildGovernanceAuditSummary({
      controlConfig,
      policyConfig,
      providerConfig,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          ...summary,
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

void main();
