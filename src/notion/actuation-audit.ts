import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
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

export interface ActuationAuditCommandOptions {
  config?: string;
}

export async function runActuationAuditCommand(
  options: ActuationAuditCommandOptions = {},
): Promise<void> {
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
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
  const output = { ok: true, githubActionFamilies: githubFamilies.families.length, ...summary };
  const missingCredentials =
    summary.missingGitHubAuthRefs.length > 0 ||
    summary.missingGitHubWebhookRefs.length > 0 ||
    summary.missingVercelAuthRefs.length > 0;
  const structuralWarnings = summary.blockedRequests.length > 0;
  recordCommandOutputSummary(output, {
    status: missingCredentials || structuralWarnings ? "warning" : "completed",
    warningCategories:
      missingCredentials || structuralWarnings
        ? ([
            ...(missingCredentials ? (["missing_credentials"] as const) : []),
            ...(structuralWarnings ? (["validation_gap"] as const) : []),
          ] as Array<"missing_credentials" | "validation_gap">)
        : undefined,
    metadata: {
      allowlistedTargets: summary.allowlistedTargets,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    await runActuationAuditCommand({
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
  void runLegacyCliPath(["governance", "actuation-audit"]);
}
