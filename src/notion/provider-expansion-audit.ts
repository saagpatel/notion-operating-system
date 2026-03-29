import "dotenv/config";

import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { loadLocalPortfolioGovernancePolicyConfig, loadLocalPortfolioWebhookProviderConfig } from "./local-portfolio-governance.js";
import { loadLocalPortfolioExternalSignalProviderConfig } from "./local-portfolio-external-signals.js";
import { loadLocalPortfolioActuationTargetConfig } from "./local-portfolio-actuation.js";
import { buildProviderExpansionAuditSummary } from "./local-portfolio-provider-expansion.js";
import { toErrorMessage } from "../utils/errors.js";

export interface ProviderExpansionAuditCommandOptions {
  config?: string;
}

export async function runProviderExpansionAuditCommand(
  options: ProviderExpansionAuditCommandOptions = {},
): Promise<void> {
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  const [controlConfig, policyConfig, webhookConfig, externalProviderConfig, targetConfig] = await Promise.all([
    loadLocalPortfolioControlTowerConfig(configPath),
    loadLocalPortfolioGovernancePolicyConfig(),
    loadLocalPortfolioWebhookProviderConfig(),
    loadLocalPortfolioExternalSignalProviderConfig(),
    loadLocalPortfolioActuationTargetConfig(),
  ]);

  const summary = buildProviderExpansionAuditSummary({
    controlConfig,
    policyConfig,
    webhookConfig,
    externalProviderConfig,
    targetConfig,
  });
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

async function main(): Promise<void> {
  try {
    await runProviderExpansionAuditCommand({
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
  void runLegacyCliPath(["signals", "provider-expansion-audit"]);
}
