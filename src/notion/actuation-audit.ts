import "dotenv/config";

import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { loadLocalPortfolioGovernancePolicyConfig } from "./local-portfolio-governance.js";
import {
  buildActuationAuditSummary,
  loadLocalPortfolioGitHubActionFamilyConfig,
  loadLocalPortfolioActuationTargetConfig,
} from "./local-portfolio-actuation.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const [controlConfig, policyConfig, targetConfig, githubFamilies] = await Promise.all([
      loadLocalPortfolioControlTowerConfig(configPath),
      loadLocalPortfolioGovernancePolicyConfig(),
      loadLocalPortfolioActuationTargetConfig(),
      loadLocalPortfolioGitHubActionFamilyConfig(),
    ]);
    if (!controlConfig.phase7Actuation) {
      throw new AppError("Control tower config is missing phase7Actuation");
    }

    const summary = buildActuationAuditSummary({
      controlConfig,
      policyConfig: { policies: policyConfig.policies },
      targetConfig,
    });
    console.log(JSON.stringify({ ok: true, githubActionFamilies: githubFamilies.families.length, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
