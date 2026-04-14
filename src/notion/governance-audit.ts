import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
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

export interface GovernanceAuditCommandOptions {
  config?: string;
}

export async function runGovernanceAuditCommand(
  options: GovernanceAuditCommandOptions = {},
): Promise<void> {
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
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
  const output = {
    ok: true,
    ...summary,
  };
  const hasWarnings =
    summary.missingAuthRefs.length > 0 ||
    summary.missingSecretRefs.length > 0 ||
    summary.policiesMissingApprovalRule.length > 0 ||
    summary.endpointModeWarnings.length > 0 ||
    summary.identityWarnings.length > 0;
  recordCommandOutputSummary(output, {
    status: hasWarnings ? "warning" : "completed",
    warningCategories: hasWarnings ? ["validation_gap"] : undefined,
    metadata: {
      liveMutationPolicies: summary.liveMutationPolicies.length,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    await runGovernanceAuditCommand({
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
  void runLegacyCliPath(["governance", "audit"]);
}
