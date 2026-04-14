import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  buildActuationAuditSummary,
  loadLocalPortfolioActuationTargetConfig,
  loadLocalPortfolioGitHubActionFamilyConfig,
  type ActuationActionKey,
  type ActuationAuditSummary,
} from "./local-portfolio-actuation.js";
import {
  buildGovernanceAuditSummary,
  loadLocalPortfolioGovernancePolicyConfig,
  loadLocalPortfolioWebhookProviderConfig,
  type GovernanceAuditSummary,
} from "./local-portfolio-governance.js";

export interface GovernanceHealthReportCommandOptions {
  config?: string;
}

export interface GovernanceHealthReport {
  ok: true;
  status: "healthy" | "warning";
  generatedAt: string;
  warningCount: number;
  governance: {
    liveMutationPolicyCount: number;
    warningCount: number;
    missingAuthRefs: string[];
    missingSecretRefs: string[];
    policiesMissingApprovalRule: string[];
    endpointModeWarnings: string[];
    identityWarnings: string[];
  };
  actuation: {
    liveCapablePolicyCount: number;
    allowlistedTargetCount: number;
    issueReadyTargetCount: number;
    commentReadyTargetCount: number;
    issueLifecycleReadyTargetCount: number;
    githubActionFamilyCount: number;
    supportedActionKeys: ActuationActionKey[];
    warningCount: number;
    missingGitHubAuthRefs: string[];
    missingGitHubWebhookRefs: string[];
    missingVercelAuthRefs: string[];
    blockedRequests: string[];
  };
  nextActions: string[];
}

export function buildGovernanceHealthReport(input: {
  governanceSummary: GovernanceAuditSummary;
  actuationSummary: ActuationAuditSummary;
  githubActionFamilyCount: number;
  generatedAt: string;
}): GovernanceHealthReport {
  const governanceWarningCount =
    input.governanceSummary.missingAuthRefs.length +
    input.governanceSummary.missingSecretRefs.length +
    input.governanceSummary.policiesMissingApprovalRule.length +
    input.governanceSummary.endpointModeWarnings.length +
    input.governanceSummary.identityWarnings.length;
  const actuationWarningCount =
    input.actuationSummary.missingGitHubAuthRefs.length +
    input.actuationSummary.missingGitHubWebhookRefs.length +
    input.actuationSummary.missingVercelAuthRefs.length +
    input.actuationSummary.blockedRequests.length;
  const warningCount = governanceWarningCount + actuationWarningCount;

  return {
    ok: true,
    status: warningCount > 0 ? "warning" : "healthy",
    generatedAt: input.generatedAt,
    warningCount,
    governance: {
      liveMutationPolicyCount: input.governanceSummary.liveMutationPolicies.length,
      warningCount: governanceWarningCount,
      missingAuthRefs: input.governanceSummary.missingAuthRefs,
      missingSecretRefs: input.governanceSummary.missingSecretRefs,
      policiesMissingApprovalRule: input.governanceSummary.policiesMissingApprovalRule,
      endpointModeWarnings: input.governanceSummary.endpointModeWarnings,
      identityWarnings: input.governanceSummary.identityWarnings,
    },
    actuation: {
      liveCapablePolicyCount: input.actuationSummary.liveCapablePolicies.length,
      allowlistedTargetCount: input.actuationSummary.allowlistedTargets,
      issueReadyTargetCount: input.actuationSummary.issueReadyTargets,
      commentReadyTargetCount: input.actuationSummary.commentReadyTargets,
      issueLifecycleReadyTargetCount: input.actuationSummary.issueLifecycleReadyTargets,
      githubActionFamilyCount: input.githubActionFamilyCount,
      supportedActionKeys: input.actuationSummary.supportedActionKeys,
      warningCount: actuationWarningCount,
      missingGitHubAuthRefs: input.actuationSummary.missingGitHubAuthRefs,
      missingGitHubWebhookRefs: input.actuationSummary.missingGitHubWebhookRefs,
      missingVercelAuthRefs: input.actuationSummary.missingVercelAuthRefs,
      blockedRequests: input.actuationSummary.blockedRequests,
    },
    nextActions: deriveGovernanceHealthNextActions({
      governanceSummary: input.governanceSummary,
      actuationSummary: input.actuationSummary,
    }),
  };
}

export async function runGovernanceHealthReportCommand(
  options: GovernanceHealthReportCommandOptions = {},
): Promise<void> {
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  const [controlConfig, policyConfig, providerConfig, targetConfig, githubFamilies] = await Promise.all([
    loadLocalPortfolioControlTowerConfig(configPath),
    loadLocalPortfolioGovernancePolicyConfig(),
    loadLocalPortfolioWebhookProviderConfig(),
    loadLocalPortfolioActuationTargetConfig(),
    loadLocalPortfolioGitHubActionFamilyConfig(),
  ]);

  if (!controlConfig.phase6Governance) {
    throw new AppError("Control tower config is missing phase6Governance");
  }
  if (!controlConfig.phase7Actuation) {
    throw new AppError("Control tower config is missing phase7Actuation");
  }

  const governanceSummary = buildGovernanceAuditSummary({
    controlConfig,
    policyConfig,
    providerConfig,
  });
  const actuationSummary = buildActuationAuditSummary({
    controlConfig,
    policyConfig: { policies: policyConfig.policies },
    targetConfig,
  });
  const output = buildGovernanceHealthReport({
    governanceSummary,
    actuationSummary,
    githubActionFamilyCount: githubFamilies.families.length,
    generatedAt: new Date().toISOString(),
  });
  recordCommandOutputSummary(output as unknown as Record<string, unknown>, {
    status: output.status === "warning" ? "warning" : "completed",
    warningCategories: output.warningCount > 0 ? deriveWarningCategories(output) : undefined,
    metadata: {
      supportedActionKeys: output.actuation.supportedActionKeys.length,
      allowlistedTargets: output.actuation.allowlistedTargetCount,
      warningCount: output.warningCount,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

function deriveGovernanceHealthNextActions(input: {
  governanceSummary: GovernanceAuditSummary;
  actuationSummary: ActuationAuditSummary;
}): string[] {
  const actions: string[] = [];

  if (
    input.governanceSummary.missingAuthRefs.length > 0 ||
    input.actuationSummary.missingGitHubAuthRefs.length > 0 ||
    input.actuationSummary.missingVercelAuthRefs.length > 0
  ) {
    actions.push("Restore the missing live-write credentials before attempting governed GitHub or Vercel actions.");
  }
  if (
    input.governanceSummary.missingSecretRefs.length > 0 ||
    input.actuationSummary.missingGitHubWebhookRefs.length > 0
  ) {
    actions.push("Restore the webhook secrets before relying on feedback or reconciliation signals.");
  }
  if (input.governanceSummary.policiesMissingApprovalRule.length > 0) {
    actions.push("Fix the governance policies that are missing approval rules so requests cannot drift into ambiguous review states.");
  }
  if (input.governanceSummary.endpointModeWarnings.length > 0) {
    actions.push("Align the control-tower provider status with the webhook provider mode before treating those endpoints as live.");
  }
  if (input.governanceSummary.identityWarnings.length > 0) {
    actions.push("Restore the app-first GitHub identity posture before widening any GitHub live-write coverage.");
  }
  if (input.actuationSummary.blockedRequests.length > 0) {
    actions.push("Fix the live-safety gaps in the allowlisted actuation targets before running new dry runs or live executions.");
  }

  return actions.length > 0
    ? actions
    : ["No immediate operator follow-up is required. Governance and actuation posture look healthy."];
}

function deriveWarningCategories(
  report: GovernanceHealthReport,
): Array<"missing_credentials" | "validation_gap"> {
  const categories = new Set<"missing_credentials" | "validation_gap">();
  const hasCredentialGap =
    report.governance.missingAuthRefs.length > 0 ||
    report.governance.missingSecretRefs.length > 0 ||
    report.actuation.missingGitHubAuthRefs.length > 0 ||
    report.actuation.missingGitHubWebhookRefs.length > 0 ||
    report.actuation.missingVercelAuthRefs.length > 0;
  const hasValidationGap =
    report.governance.policiesMissingApprovalRule.length > 0 ||
    report.governance.endpointModeWarnings.length > 0 ||
    report.governance.identityWarnings.length > 0 ||
    report.actuation.blockedRequests.length > 0;

  if (hasCredentialGap) {
    categories.add("missing_credentials");
  }
  if (hasValidationGap) {
    categories.add("validation_gap");
  }
  return [...categories];
}

async function main(): Promise<void> {
  try {
    await runGovernanceHealthReportCommand({
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
  void runLegacyCliPath(["governance", "health-report"]);
}
