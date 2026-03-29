import type { LocalPortfolioActuationTargetConfig, ActuationTargetRule } from "./local-portfolio-actuation.js";
import { SUPPORTED_GITHUB_ACTION_KEYS } from "./local-portfolio-actuation.js";
import type {
  LocalPortfolioExternalSignalProviderConfig,
  ExternalProviderKey,
} from "./local-portfolio-external-signals.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type {
  GovernanceProviderKey,
  GovernanceProviderName,
  LocalPortfolioGovernancePolicyConfig,
  LocalPortfolioWebhookProviderConfig,
} from "./local-portfolio-governance.js";

export type ProviderExpansionReadiness = "ready" | "scaffolded" | "blocked";

export interface ProviderExpansionProviderSummary {
  provider: GovernanceProviderName;
  providerKey: GovernanceProviderKey;
  readiness: ProviderExpansionReadiness;
  policyCount: number;
  liveCapablePolicies: string[];
  modeledActionKeys: string[];
  runnerSupportedActionKeys: string[];
  externalSignalsEnabled: boolean;
  webhookConfigured: boolean;
  webhookMode: string;
  governanceStatus: string;
  targetCount: number;
  blockers: string[];
  nextStep: string;
}

export interface ProviderExpansionAuditSummary {
  currentPhase: number;
  currentPhaseStatus: LocalPortfolioControlTowerConfig["phaseState"]["currentPhaseStatus"];
  githubBaselineTrusted: boolean;
  candidateProviders: GovernanceProviderName[];
  providers: ProviderExpansionProviderSummary[];
  nextStep: string;
}

const KNOWN_PROVIDERS: Array<{ key: GovernanceProviderKey; name: GovernanceProviderName }> = [
  { key: "github", name: "GitHub" },
  { key: "vercel", name: "Vercel" },
  { key: "google_calendar", name: "Google Calendar" },
];

const RUNNER_SUPPORTED_ACTION_KEYS = [...SUPPORTED_GITHUB_ACTION_KEYS];

export function buildProviderExpansionAuditSummary(input: {
  controlConfig: LocalPortfolioControlTowerConfig;
  policyConfig: LocalPortfolioGovernancePolicyConfig;
  webhookConfig: LocalPortfolioWebhookProviderConfig;
  externalProviderConfig: LocalPortfolioExternalSignalProviderConfig;
  targetConfig: LocalPortfolioActuationTargetConfig;
}): ProviderExpansionAuditSummary {
  const githubBaselineTrusted =
    input.controlConfig.phase8GithubDeepening?.webhookFeedback.githubStatus === "trusted_feedback";

  const providers = KNOWN_PROVIDERS.map((provider) =>
    summarizeProviderExpansion({
      provider,
      githubBaselineTrusted,
      controlConfig: input.controlConfig,
      policyConfig: input.policyConfig,
      webhookConfig: input.webhookConfig,
      externalProviderConfig: input.externalProviderConfig,
      targetConfig: input.targetConfig,
    }),
  );

  const candidateProviders = providers
    .filter(
      (provider) =>
        provider.provider !== "GitHub" &&
        (provider.policyCount > 0 || provider.externalSignalsEnabled || provider.webhookConfigured || provider.targetCount > 0),
    )
    .sort(compareProviderReadiness)
    .map((provider) => provider.provider);

  return {
    currentPhase: input.controlConfig.phaseState.currentPhase,
    currentPhaseStatus: input.controlConfig.phaseState.currentPhaseStatus,
    githubBaselineTrusted,
    candidateProviders,
    providers,
    nextStep:
      providers.find((provider) => provider.provider !== "GitHub" && provider.readiness !== "blocked")?.nextStep ??
      "Keep GitHub as the trusted baseline until one non-GitHub lane is scoped for a bounded pilot.",
  };
}

function summarizeProviderExpansion(input: {
  provider: { key: GovernanceProviderKey; name: GovernanceProviderName };
  githubBaselineTrusted: boolean;
  controlConfig: LocalPortfolioControlTowerConfig;
  policyConfig: LocalPortfolioGovernancePolicyConfig;
  webhookConfig: LocalPortfolioWebhookProviderConfig;
  externalProviderConfig: LocalPortfolioExternalSignalProviderConfig;
  targetConfig: LocalPortfolioActuationTargetConfig;
}): ProviderExpansionProviderSummary {
  const policies = input.policyConfig.policies.filter((policy) => policy.provider === input.provider.name);
  const modeledActionKeys = policies.map((policy) => policy.actionKey).sort();
  const runnerSupportedActionKeys = modeledActionKeys.filter((actionKey) => isActionKeyRunnerSupported(actionKey));
  const liveCapablePolicies = policies
    .filter((policy) => policy.executionMode === "Approved Live")
    .map((policy) => policy.actionKey)
    .sort();
  const externalProvider = input.externalProviderConfig.providers.find(
    (provider) => normalizeExternalProviderKey(provider.key) === input.provider.key,
  );
  const webhookProvider = input.webhookConfig.providers.find((provider) => provider.key === input.provider.key);
  const targetCount = input.targetConfig.targets.filter((target) => inferActuationTargetProvider(target) === input.provider.name).length;

  const blockers: string[] = [];
  if (input.provider.key !== "github" && !input.githubBaselineTrusted) {
    blockers.push("GitHub is not yet marked as trusted feedback, so provider expansion should stay gated.");
  }
  if (policies.length === 0) {
    blockers.push("No governance policies are defined for this provider.");
  }
  if (!externalProvider) {
    blockers.push("No external signal provider plan is configured.");
  } else if (!externalProvider.enabled) {
    blockers.push("External signal collection is still disabled.");
  }
  if (!webhookProvider && input.provider.key !== "google_calendar") {
    blockers.push("No webhook provider plan is configured.");
  }
  if (modeledActionKeys.length > 0 && runnerSupportedActionKeys.length === 0) {
    blockers.push("No action-family or runner support exists for this provider yet.");
  }
  if (modeledActionKeys.length > 0 && liveCapablePolicies.length === 0) {
    blockers.push("All policies are still disabled.");
  }
  if (runnerSupportedActionKeys.length > 0 && modeledActionKeys.length > 0 && targetCount === 0) {
    blockers.push("No actuation targets are configured.");
  }

  const readiness: ProviderExpansionReadiness =
    blockers.length === 0
      ? "ready"
      : policies.length > 0 || Boolean(externalProvider) || Boolean(webhookProvider) || targetCount > 0
        ? "scaffolded"
        : "blocked";

  return {
    provider: input.provider.name,
    providerKey: input.provider.key,
    readiness,
    policyCount: policies.length,
    liveCapablePolicies,
    modeledActionKeys,
    runnerSupportedActionKeys,
    externalSignalsEnabled: externalProvider?.enabled ?? false,
    webhookConfigured: Boolean(webhookProvider),
    webhookMode: webhookProvider?.mode ?? "missing",
    governanceStatus: readGovernanceStatus(input.controlConfig, input.provider.key),
    targetCount,
    blockers,
    nextStep: recommendProviderNextStep({
      provider: input.provider.name,
      githubBaselineTrusted: input.githubBaselineTrusted,
      policies,
      runnerSupportedActionKeys,
      liveCapablePolicies,
      targetCount,
      externalSignalsEnabled: externalProvider?.enabled ?? false,
      webhookConfigured: Boolean(webhookProvider),
    }),
  };
}

export function inferActuationTargetProvider(target: ActuationTargetRule): GovernanceProviderName | undefined {
  if (target.allowedActions.some((actionKey) => actionKey.startsWith("github."))) {
    return "GitHub";
  }
  if (target.allowedActions.some((actionKey) => actionKey.startsWith("vercel."))) {
    return "Vercel";
  }
  if (target.sourceUrl?.includes("github.com")) {
    return "GitHub";
  }
  if (target.sourceUrl?.includes("vercel.com") || target.sourceUrl?.includes(".vercel.app")) {
    return "Vercel";
  }
  return undefined;
}

function isActionKeyRunnerSupported(actionKey: string): boolean {
  return RUNNER_SUPPORTED_ACTION_KEYS.includes(actionKey as (typeof RUNNER_SUPPORTED_ACTION_KEYS)[number]);
}

function normalizeExternalProviderKey(key: ExternalProviderKey): GovernanceProviderKey {
  return key === "google_calendar" ? "google_calendar" : key;
}

function readGovernanceStatus(
  controlConfig: LocalPortfolioControlTowerConfig,
  providerKey: GovernanceProviderKey,
): string {
  const phase6 = controlConfig.phase6Governance;
  if (!phase6) {
    return "missing";
  }
  if (providerKey === "github") {
    return phase6.providerStatus.github;
  }
  if (providerKey === "vercel") {
    return phase6.providerStatus.vercel;
  }
  return phase6.providerStatus.googleCalendar;
}

function recommendProviderNextStep(input: {
  provider: GovernanceProviderName;
  githubBaselineTrusted: boolean;
  policies: Array<{ actionKey: string }>;
  runnerSupportedActionKeys: string[];
  liveCapablePolicies: string[];
  targetCount: number;
  externalSignalsEnabled: boolean;
  webhookConfigured: boolean;
}): string {
  if (input.provider === "GitHub") {
    return "Keep GitHub as the trusted baseline lane and use it to measure whether provider expansion stays low-noise.";
  }
  if (!input.githubBaselineTrusted) {
    return "Keep expansion paused until the GitHub baseline stays trusted and easy to audit.";
  }
  if (input.policies.length === 0) {
    return `Add one bounded ${input.provider} policy before trying to wire a new lane.`;
  }
  if (input.runnerSupportedActionKeys.length === 0) {
    return `Add one ${input.provider} action-family plus dry-run runner support before enabling live execution.`;
  }
  if (input.liveCapablePolicies.length === 0) {
    return `Promote one ${input.provider} policy from Disabled to Approved Live after dry-run support is proven.`;
  }
  if (input.targetCount === 0) {
    return `Add at least one ${input.provider} actuation target or source mapping for the pilot lane.`;
  }
  if (!input.externalSignalsEnabled) {
    return `Enable ${input.provider} external signals or document why this lane is actuation-only.`;
  }
  if (!input.webhookConfigured) {
    return `Add a ${input.provider} webhook plan or document why the lane stays polling-only.`;
  }
  return `Run one bounded ${input.provider} pilot and keep the same approval and audit path as GitHub.`;
}

function compareProviderReadiness(
  left: ProviderExpansionProviderSummary,
  right: ProviderExpansionProviderSummary,
): number {
  const rank: Record<ProviderExpansionReadiness, number> = {
    ready: 0,
    scaffolded: 1,
    blocked: 2,
  };
  return (
    rank[left.readiness] - rank[right.readiness] ||
    left.blockers.length - right.blockers.length ||
    right.policyCount - left.policyCount ||
    left.provider.localeCompare(right.provider)
  );
}
