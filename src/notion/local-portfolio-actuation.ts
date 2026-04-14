import { createHash, createSign } from "node:crypto";

import { loadRuntimeConfig } from "../config/runtime-config.js";
import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";
import type { ExternalSignalSourceRecord } from "./local-portfolio-external-signals.js";
import type { ActionPolicyRecord, ActionRequestRecord } from "./local-portfolio-governance.js";

export const DEFAULT_LOCAL_PORTFOLIO_ACTUATION_TARGETS_PATH = "./config/local-portfolio-actuation-targets.json";
export const DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH = "./config/local-portfolio-actuation-views.json";
export const DEFAULT_LOCAL_PORTFOLIO_GITHUB_ACTION_FAMILIES_PATH =
  "./config/local-portfolio-github-action-families.json";
export const DEFAULT_LOCAL_PORTFOLIO_GITHUB_VIEWS_PATH = "./config/local-portfolio-github-views.json";

export type ActuationMode = "Dry Run" | "Live" | "Compensation";
export type ActuationStatus = "Planned" | "Started" | "Succeeded" | "Failed" | "Skipped" | "Compensation Needed";
export type ActuationIntent = "Dry Run" | "Ready for Live";
export type ActuationProviderName = "GitHub" | "Vercel";
export type ActuationActionKey =
  | "github.create_issue"
  | "github.update_issue"
  | "github.set_issue_labels"
  | "github.set_issue_assignees"
  | "github.add_issue_comment"
  | "github.comment_pull_request"
  | "vercel.redeploy"
  | "vercel.rollback";

export const SUPPORTED_GITHUB_ACTION_KEYS: ActuationActionKey[] = [
  "github.create_issue",
  "github.update_issue",
  "github.set_issue_labels",
  "github.set_issue_assignees",
  "github.add_issue_comment",
  "github.comment_pull_request",
];

export const SUPPORTED_VERCEL_ACTION_KEYS: ActuationActionKey[] = ["vercel.redeploy", "vercel.rollback"];
export const SUPPORTED_ACTION_KEYS: ActuationActionKey[] = [
  ...SUPPORTED_GITHUB_ACTION_KEYS,
  ...SUPPORTED_VERCEL_ACTION_KEYS,
];

export type VercelTargetEnvironment = "Production" | "Preview";
export type VercelScopeType = "Personal" | "Team";

export interface ActuationDatabaseRef {
  name: string;
  databaseUrl: string;
  databaseId: string;
  dataSourceId: string;
  destinationAlias: string;
}

export interface ActuationTargetRule {
  title: string;
  provider?: ActuationProviderName;
  sourceIdentifier?: string;
  sourceUrl?: string;
  localProjectId?: string;
  allowedActions: ActuationActionKey[];
  titlePrefix?: string;
  defaultLabels: string[];
  supportsIssueCreate: boolean;
  supportsPrComment: boolean;
  vercelProjectId?: string;
  vercelTeamId?: string;
  vercelTeamSlug?: string;
  vercelScopeType?: VercelScopeType;
  vercelEnvironment?: VercelTargetEnvironment;
}

export interface LocalPortfolioActuationTargetConfig {
  version: 1;
  strategy: {
    primary: "repo_config";
    fallback: "manual_review";
    notes: string[];
  };
  defaults: {
    allowedActions: ActuationActionKey[];
    titlePrefix: string;
    defaultLabels: string[];
    supportsIssueCreate: boolean;
    supportsPrComment: boolean;
  };
  targets: ActuationTargetRule[];
}

export interface ActuationViewSpec {
  name: string;
  viewId?: string;
  type: "table" | "board" | "gallery";
  purpose: string;
  configure: string;
}

export interface ActuationViewCollection {
  key: "actionRequests" | "executions" | "sources";
  database:
    | ActuationDatabaseRef
    | {
        name: string;
        databaseUrl: string;
        databaseId: string;
        dataSourceId: string;
        destinationAlias: string;
      };
  views: ActuationViewSpec[];
}

export interface LocalPortfolioActuationViewPlan {
  version: 1;
  strategy: {
    primary: "notion_mcp";
    fallback: "playwright";
    notes: string[];
  };
  collections: ActuationViewCollection[];
}

export interface GitHubActionFamilyPlan {
  actionKey: ActuationActionKey;
  provider: "GitHub";
  requestTarget: "issue" | "pull_request";
  mutationClass: "Issue" | "Comment";
  permissionFamily: "issues_write" | "issues_write_plus_pull_requests_read";
  requiresTitle: boolean;
  requiresBody: boolean;
  requiresTargetNumber: boolean;
  usesLabels: boolean;
  usesAssignees: boolean;
  destructive: false;
  notes: string;
}

export interface LocalPortfolioGitHubActionFamilyConfig {
  version: 1;
  strategy: {
    primary: "repo_config";
    fallback: "manual_review";
    notes: string[];
  };
  families: GitHubActionFamilyPlan[];
}

export interface ExternalActionExecutionRecord {
  id: string;
  url: string;
  title: string;
  actionRequestIds: string[];
  localProjectIds: string[];
  policyIds: string[];
  targetSourceIds: string[];
  provider: "GitHub" | "Vercel" | "Google Calendar";
  actionKey: string;
  mode: ActuationMode;
  status: ActuationStatus;
  idempotencyKey: string;
  executedAt: string;
  providerResultKey: string;
  providerUrl: string;
  issueNumber: number;
  commentId: string;
  labelDeltaSummary: string;
  assigneeDeltaSummary: string;
  responseClassification: GitHubResponseClassification;
  reconcileStatus: GitHubReconcileStatus;
  responseSummary: string;
  failureNotes: string;
  compensationPlan: string;
}

export interface ActuationAuditSummary {
  missingGitHubAuthRefs: string[];
  missingGitHubWebhookRefs: string[];
  missingVercelAuthRefs: string[];
  liveCapablePolicies: string[];
  allowlistedTargets: number;
  issueReadyTargets: number;
  commentReadyTargets: number;
  issueLifecycleReadyTargets: number;
  supportedActionKeys: ActuationActionKey[];
  blockedRequests: string[];
}

export interface ResolvedActuationTarget {
  provider: ActuationProviderName;
  source: ExternalSignalSourceRecord;
  rule: ActuationTargetRule;
  owner?: string;
  repo?: string;
  projectId?: string;
  projectName?: string;
  teamId?: string;
  teamSlug?: string;
  scopeType?: VercelScopeType;
  environment?: VercelTargetEnvironment;
}

export interface GitHubExecutionPayload {
  provider: "GitHub";
  actionKey: ActuationActionKey;
  owner: string;
  repo: string;
  title?: string;
  body?: string;
  issueNumber?: number;
  labels: string[];
  assignees: string[];
}

export interface VercelRedeployExecutionPayload {
  provider: "Vercel";
  actionKey: "vercel.redeploy";
  projectId: string;
  projectName: string;
  teamId?: string;
  teamSlug?: string;
  scopeType: VercelScopeType;
  targetEnvironment: VercelTargetEnvironment;
  deploymentId: string;
  deploymentUrl: string;
  deploymentReadyState: string;
}

export interface VercelRollbackExecutionPayload {
  provider: "Vercel";
  actionKey: "vercel.rollback";
  projectId: string;
  projectName: string;
  teamId?: string;
  teamSlug?: string;
  scopeType: VercelScopeType;
  targetEnvironment: VercelTargetEnvironment;
  currentDeploymentId: string;
  currentDeploymentUrl: string;
  rollbackDeploymentId: string;
  rollbackDeploymentUrl: string;
  rollbackDeploymentReadyState: string;
  rollbackDescription: string;
}

export interface GitHubIssueSnapshot {
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  isPullRequest: boolean;
  providerUrl: string;
}

export interface GitHubActionPreflight {
  issueSnapshot?: GitHubIssueSnapshot;
  titleWillChange: boolean;
  bodyWillChange: boolean;
  labelsToAdd: string[];
  blockedLabelRemovals: string[];
  assigneesToAdd: string[];
  blockedAssigneeRemovals: string[];
  unassignableAssignees: string[];
  missingPullRequestPermission: boolean;
  noMaterialChange: boolean;
}

export interface VercelDeploymentSnapshot {
  deploymentId: string;
  deploymentUrl: string;
  projectId: string;
  readyState: string;
  environment: VercelTargetEnvironment;
  createdAt: string;
  aliasAssigned?: boolean;
  aliasAssignedAt?: number;
  readySubstate?: string;
  rollbackCandidate?: boolean;
}

export interface VercelRedeployPreflight {
  latestDeployment?: VercelDeploymentSnapshot;
  targetEnvironment: VercelTargetEnvironment;
  providerExercised: boolean;
  noRedeployCandidate: boolean;
}

export interface VercelRollbackPreflight {
  currentDeployment?: VercelDeploymentSnapshot;
  rollbackCandidate?: VercelDeploymentSnapshot;
  targetEnvironment: VercelTargetEnvironment;
  providerExercised: boolean;
  noRollbackCandidate: boolean;
}

export type GitHubResponseClassification =
  | "Success"
  | "Validation Failure"
  | "Verification Failure"
  | "Permission Failure"
  | "Auth Failure"
  | "Not Found"
  | "Rate Limited"
  | "Transient Failure"
  | "Duplicate Suppressed";

export type GitHubReconcileStatus = "Not Needed" | "Pending" | "Confirmed" | "Mismatch";

export interface GitHubExecutionResult {
  executionStatus: Extract<ActuationStatus, "Succeeded" | "Skipped" | "Failed" | "Compensation Needed">;
  providerResultKey: string;
  providerUrl: string;
  issueNumber: number;
  commentId: string;
  labelDeltaSummary: string;
  assigneeDeltaSummary: string;
  responseClassification: GitHubResponseClassification;
  reconcileStatus: GitHubReconcileStatus;
  responseSummary: string;
}

export function requirePhase7Actuation(
  config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase7Actuation"]> {
  if (!config.phase7Actuation) {
    throw new AppError("Control tower config is missing phase7Actuation");
  }
  return config.phase7Actuation;
}

export function requirePhase8GithubDeepening(
  config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase8GithubDeepening"]> {
  if (!config.phase8GithubDeepening) {
    throw new AppError("Control tower config is missing phase8GithubDeepening");
  }
  return config.phase8GithubDeepening;
}

export async function loadLocalPortfolioActuationTargetConfig(
  filePath = loadRuntimeConfig().paths.actuationTargetsPath,
): Promise<LocalPortfolioActuationTargetConfig> {
  return parseLocalPortfolioActuationTargetConfig(await readJsonFile<unknown>(filePath));
}

export async function loadLocalPortfolioActuationViewPlan(
  filePath = loadRuntimeConfig().paths.actuationViewsPath,
): Promise<LocalPortfolioActuationViewPlan> {
  return parseLocalPortfolioActuationViewPlan(await readJsonFile<unknown>(filePath));
}

export async function loadLocalPortfolioGitHubActionFamilyConfig(
  filePath = loadRuntimeConfig().paths.githubActionFamiliesPath,
): Promise<LocalPortfolioGitHubActionFamilyConfig> {
  return parseLocalPortfolioGitHubActionFamilyConfig(await readJsonFile<unknown>(filePath));
}

export async function loadLocalPortfolioGitHubViewPlan(
  filePath = loadRuntimeConfig().paths.githubViewsPath,
): Promise<LocalPortfolioActuationViewPlan> {
  return parseLocalPortfolioActuationViewPlan(await readJsonFile<unknown>(filePath));
}

export function ensurePhase7ActuationState(
  config: LocalPortfolioControlTowerConfig,
  input: { today: string },
): NonNullable<LocalPortfolioControlTowerConfig["phase7Actuation"]> {
  const phase7PhaseMemory = {
    phase1GaveUs:
      "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
    phase2Added:
      "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
    phase3Added:
      "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
    phase4Added:
      "Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.",
    phase5Added:
      "Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.",
    phase6Added:
      "Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries.",
    phase7Added:
      "Phase 7 gave us controlled actuation: approved GitHub issue/comment execution, dry-run-backed execution logs, deterministic idempotency, and compensation-aware external write handling.",
    phase8Brief:
      "Phase 8 will deepen the proven GitHub-first actuation lane into a mature issue and PR-comment workflow with stronger security, better operator experience, and richer GitHub feedback loops.",
  };

  return {
    executions:
      config.phase7Actuation?.executions ?? blankDatabaseRef("External Action Executions", "external_action_executions"),
    rolloutProfile: "github_first_issues_then_comments",
    runnerLimits: config.phase7Actuation?.runnerLimits ?? {
      mode: "serial",
      maxLivePerRun: 1,
      maxDryRunsPerRun: 5,
      minSecondsBetweenWrites: 1,
    },
    liveGating: config.phase7Actuation?.liveGating ?? {
      requireApproval: true,
      requireNonExpiredRequest: true,
      requireActiveGitHubTarget: true,
      requireFreshDryRunBeforeLive: true,
      freshDryRunMaxAgeHours: 24,
    },
    githubAuth: config.phase7Actuation?.githubAuth ?? {
      provider: "GitHub App",
      tokenLifetimeMinutes: 60,
      mintPerRun: true,
    },
    metricsRegistry: config.phase7Actuation?.metricsRegistry ?? {
      dryRunSuccessRate: "dry_run_success_rate",
      liveSuccessRate: "live_success_rate",
      actuationFailureRate: "actuation_failure_rate",
      compensationNeededCount: "compensation_needed_count",
      approvalToExecutionHours: "approval_to_execution_hours",
    },
    viewIds: config.phase7Actuation?.viewIds ?? {
      actionRequests: {},
      executions: {},
      sources: {},
    },
    phaseMemory: {
      ...phase7PhaseMemory,
      ...config.phase7Actuation?.phaseMemory,
      phase8Brief: phase7PhaseMemory.phase8Brief,
    },
    baselineCapturedAt: config.phase7Actuation?.baselineCapturedAt ?? input.today,
    baselineMetrics: config.phase7Actuation?.baselineMetrics,
    lastAuditAt: config.phase7Actuation?.lastAuditAt,
    lastAuditSummary: config.phase7Actuation?.lastAuditSummary,
  };
}

export function ensurePhase8GithubDeepeningState(
  config: LocalPortfolioControlTowerConfig,
  input: { today: string },
): NonNullable<LocalPortfolioControlTowerConfig["phase8GithubDeepening"]> {
  const phase8PhaseMemory = {
    phase1GaveUs:
      "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
    phase2Added:
      "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
    phase3Added:
      "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
    phase4Added:
      "Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.",
    phase5Added:
      "Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.",
    phase6Added:
      "Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries.",
    phase7Added:
      "Phase 7 gave us controlled actuation: approved GitHub issue/comment execution, dry-run-backed execution logs, deterministic idempotency, and compensation-aware external write handling.",
    phase8Added:
      "Phase 8 gave us a mature GitHub action lane: issue lifecycle actions, PR comments, hardened GitHub App posture, richer operator packets, and audit-grade GitHub execution feedback loops.",
    phase9Brief:
      "Phase 9 will expand the proven governance-and-actuation pattern to non-GitHub providers only after the deep GitHub lane is stable, low-noise, and easy to audit.",
  };

  return {
    rolloutProfile: "github_issue_lifecycle_then_pr_comments",
    actionFamilies: config.phase8GithubDeepening?.actionFamilies ?? {
      createIssue: true,
      updateIssue: true,
      setLabels: true,
      setAssignees: true,
      addIssueComment: true,
      commentPullRequest: true,
    },
    writeSafety: config.phase8GithubDeepening?.writeSafety ?? {
      mode: "serial",
      maxLivePerRun: config.phase7Actuation?.runnerLimits.maxLivePerRun ?? 1,
      maxDryRunsPerRun: config.phase7Actuation?.runnerLimits.maxDryRunsPerRun ?? 5,
      minSecondsBetweenWrites: config.phase7Actuation?.runnerLimits.minSecondsBetweenWrites ?? 1,
    },
    permissionPosture: config.phase8GithubDeepening?.permissionPosture ?? {
      issues: "read_write",
      metadata: "read_only",
      broaderRepositoryPermissions: "disabled",
    },
    webhookFeedback: config.phase8GithubDeepening?.webhookFeedback ?? {
      githubStatus: "shadow",
      subscribedEvents: ["issues", "issue_comment", "pull_request", "workflow_run"],
      reconcileMode: "execution_first",
    },
    metricsRegistry: config.phase8GithubDeepening?.metricsRegistry ?? {
      dryRunSuccessRate: "dry_run_success_rate",
      liveSuccessRate: "live_success_rate",
      actuationFailureRate: "actuation_failure_rate",
      compensationNeededCount: "compensation_needed_count",
      approvalToExecutionHours: "approval_to_execution_hours",
      reconcileConfirmationRate: "reconcile_confirmation_rate",
    },
    viewIds: config.phase8GithubDeepening?.viewIds ?? {
      actionRequests: {},
      executions: {},
      sources: {},
    },
    phaseMemory: {
      ...phase8PhaseMemory,
      ...config.phase8GithubDeepening?.phaseMemory,
      phase8Added: phase8PhaseMemory.phase8Added,
      phase9Brief: phase8PhaseMemory.phase9Brief,
    },
    baselineCapturedAt: config.phase8GithubDeepening?.baselineCapturedAt ?? input.today,
    baselineMetrics: config.phase8GithubDeepening?.baselineMetrics,
    lastAuditAt: config.phase8GithubDeepening?.lastAuditAt,
    lastAuditSummary: config.phase8GithubDeepening?.lastAuditSummary,
  };
}

export function parseLocalPortfolioActuationTargetConfig(raw: unknown): LocalPortfolioActuationTargetConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio actuation target config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio actuation target config version "${String(value.version)}"`);
  }
  return {
    version: 1,
    strategy: parseStrategy(value.strategy, "localPortfolioActuationTargets.strategy", "repo_config", "manual_review"),
    defaults: parseActuationDefaults(value.defaults),
    targets: parseActuationTargets(value.targets),
  };
}

export function parseLocalPortfolioActuationViewPlan(raw: unknown): LocalPortfolioActuationViewPlan {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio actuation views config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio actuation views config version "${String(value.version)}"`);
  }
  return {
    version: 1,
    strategy: parseStrategy(value.strategy, "localPortfolioActuationViews.strategy", "notion_mcp", "playwright"),
    collections: parseViewCollections(value.collections),
  };
}

export function parseLocalPortfolioGitHubActionFamilyConfig(raw: unknown): LocalPortfolioGitHubActionFamilyConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio GitHub action family config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio GitHub action family config version "${String(value.version)}"`);
  }
  return {
    version: 1,
    strategy: parseStrategy(
      value.strategy,
      "localPortfolioGitHubActionFamilies.strategy",
      "repo_config",
      "manual_review",
    ),
    families: parseGitHubActionFamilies(value.families),
  };
}

export function validateLocalPortfolioActuationViewPlanAgainstSchemas(input: {
  plan: LocalPortfolioActuationViewPlan;
  schemas: Record<ActuationViewCollection["key"], DataSourceSchemaSnapshot>;
}): { validatedViews: Array<{ collection: string; name: string; type: string; referencedProperties: string[] }> } {
  const validatedViews: Array<{ collection: string; name: string; type: string; referencedProperties: string[] }> = [];
  for (const collection of input.plan.collections) {
    const schema = input.schemas[collection.key];
    if (!schema) {
      throw new AppError(`Missing schema for actuation collection "${collection.key}"`);
    }
    if (schema.id !== collection.database.dataSourceId) {
      throw new AppError(
        `Actuation collection "${collection.key}" points at "${collection.database.dataSourceId}" but schema came from "${schema.id}"`,
      );
    }
    for (const view of collection.views) {
      const referencedProperties = validateViewAgainstSchema(view.configure, schema.properties);
      validatedViews.push({
        collection: collection.key,
        name: view.name,
        type: view.type,
        referencedProperties,
      });
    }
  }
  return { validatedViews };
}

export function buildActuationAuditSummary(input: {
  controlConfig: LocalPortfolioControlTowerConfig;
  policyConfig: {
    policies: Array<
      Pick<ActionPolicyRecord, "provider" | "executionMode"> & {
        title?: string;
        actionKey?: string;
      }
    >;
  };
  targetConfig: LocalPortfolioActuationTargetConfig;
}): ActuationAuditSummary {
  const missingGitHubAuthRefs = [
    process.env.GITHUB_APP_ID?.trim() ? undefined : "GITHUB_APP_ID",
    process.env.GITHUB_APP_PRIVATE_KEY_PEM?.trim() ? undefined : "GITHUB_APP_PRIVATE_KEY_PEM",
  ].filter((value): value is string => Boolean(value));
  const missingGitHubWebhookRefs = [process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ? undefined : "GITHUB_APP_WEBHOOK_SECRET"].filter(
    (value): value is string => Boolean(value),
  );
  const missingVercelAuthRefs = [process.env.VERCEL_TOKEN?.trim() ? undefined : "VERCEL_TOKEN"].filter(
    (value): value is string => Boolean(value),
  );

  const liveCapablePolicies = input.policyConfig.policies
    .filter((policy) => policy.executionMode === "Approved Live")
    .map((policy) => policy.title ?? policy.actionKey ?? "unknown");
  const issueReadyTargets = input.targetConfig.targets.filter((target) => target.supportsIssueCreate).length;
  const commentReadyTargets = input.targetConfig.targets.filter((target) => target.supportsPrComment).length;
  const issueLifecycleReadyTargets = input.targetConfig.targets.filter((target) =>
    target.allowedActions.some((actionKey) =>
      [
        "github.create_issue",
        "github.update_issue",
        "github.set_issue_labels",
        "github.set_issue_assignees",
        "github.add_issue_comment",
      ].includes(actionKey),
    ),
  ).length;
  const supportedActionKeys = [...new Set(input.targetConfig.targets.flatMap((target) => target.allowedActions))].sort() as ActuationActionKey[];
  const blockedRequests = input.targetConfig.targets.flatMap((target) => {
    if (!isVercelTargetRule(target)) {
      return [];
    }
    const issues: string[] = [];
    if (!target.localProjectId?.trim()) {
      issues.push("missing localProjectId");
    }
    if (!target.sourceIdentifier?.trim()) {
      issues.push("missing sourceIdentifier");
    }
    if (!target.vercelProjectId?.trim()) {
      issues.push("missing vercelProjectId");
    }
    if (target.vercelScopeType === "Team" && !target.vercelTeamId?.trim()) {
      issues.push("missing vercelTeamId");
    }
    if (target.vercelScopeType === "Team" && !target.vercelTeamSlug?.trim()) {
      issues.push("missing vercelTeamSlug");
    }
    if (!target.vercelScopeType) {
      issues.push("missing vercelScopeType");
    }
    if (!target.vercelEnvironment) {
      issues.push("missing vercelEnvironment");
    }
    if (
      target.sourceIdentifier?.trim() &&
      target.vercelProjectId?.trim() &&
      target.sourceIdentifier.trim() !== target.vercelProjectId.trim()
    ) {
      issues.push("sourceIdentifier does not match vercelProjectId");
    }
    return issues.length > 0 ? [`Vercel target "${target.title}" is not live-safe: ${issues.join(", ")}.`] : [];
  });

  return {
    missingGitHubAuthRefs,
    missingGitHubWebhookRefs,
    missingVercelAuthRefs,
    liveCapablePolicies,
    allowlistedTargets: input.targetConfig.targets.length,
    issueReadyTargets,
    commentReadyTargets,
    issueLifecycleReadyTargets,
    supportedActionKeys,
    blockedRequests,
  };
}

export function resolveActuationTarget(input: {
  request: ActionRequestRecord;
  sources: ExternalSignalSourceRecord[];
  targetConfig: LocalPortfolioActuationTargetConfig;
  actionKey: ActuationActionKey;
}): ResolvedActuationTarget {
  const linkedSourceId = input.request.targetSourceIds?.[0];
  const linkedSource = linkedSourceId ? input.sources.find((source) => source.id === linkedSourceId) : undefined;
  if (!linkedSource) {
    throw new AppError(`Action request "${input.request.title}" is missing a linked target source.`);
  }
  const provider = linkedSource.provider;

  if (provider === "GitHub") {
    const matchingRule = input.targetConfig.targets.find((target) => {
      const targetProvider = target.provider ?? inferTargetProviderFromRule(target);
      if (targetProvider && targetProvider !== provider) {
        return false;
      }
      return (
        (target.sourceIdentifier && target.sourceIdentifier === linkedSource.identifier) ||
        (target.sourceUrl && target.sourceUrl === linkedSource.sourceUrl) ||
        (target.localProjectId && input.request.localProjectIds.includes(target.localProjectId))
      );
    });
    if (linkedSource.sourceType !== "Repo" || linkedSource.status !== "Active") {
      throw new AppError(`Target source "${linkedSource.title}" is not an active GitHub repo source.`);
    }
    const resolvedRule =
      matchingRule ?? {
        title: linkedSource.title,
        provider: "GitHub" as const,
        sourceIdentifier: linkedSource.identifier,
        sourceUrl: linkedSource.sourceUrl,
        allowedActions: input.targetConfig.defaults.allowedActions,
        titlePrefix: input.targetConfig.defaults.titlePrefix,
        defaultLabels: input.targetConfig.defaults.defaultLabels,
        supportsIssueCreate: input.targetConfig.defaults.supportsIssueCreate,
        supportsPrComment: input.targetConfig.defaults.supportsPrComment,
      };
    if (!resolvedRule.allowedActions.includes(input.actionKey)) {
      throw new AppError(`Target "${linkedSource.title}" is not allowlisted for ${input.actionKey}.`);
    }
    const repoSource = linkedSource.identifier || linkedSource.sourceUrl;
    const [owner, repo] = extractGitHubRepo(repoSource);
    return {
      provider: "GitHub",
      source: linkedSource,
      rule: resolvedRule,
      owner,
      repo,
    };
  }

  if (provider === "Vercel") {
    if (linkedSource.sourceType !== "Deployment Project" || linkedSource.status !== "Active") {
      throw new AppError(`Target source "${linkedSource.title}" is not an active Vercel deployment source.`);
    }
    const sourceProjectId = linkedSource.identifier.trim();
    if (!sourceProjectId) {
      throw new AppError(`Target "${linkedSource.title}" is missing a Vercel project id.`);
    }
    const matchingRules = input.targetConfig.targets.filter((target) => {
      const targetProvider = target.provider ?? inferTargetProviderFromRule(target);
      if (targetProvider !== "Vercel") {
        return false;
      }
      return (
        target.sourceIdentifier?.trim() === sourceProjectId ||
        target.vercelProjectId?.trim() === sourceProjectId
      );
    });
    if (matchingRules.length === 0) {
      throw new AppError(`Target "${linkedSource.title}" does not have a Vercel allowlist rule yet.`);
    }
    if (matchingRules.length > 1) {
      throw new AppError(`Target "${linkedSource.title}" resolves to multiple Vercel allowlist rules.`);
    }
    const matchingRule = matchingRules[0]!;
    if (!matchingRule.allowedActions.includes(input.actionKey)) {
      throw new AppError(`Target "${linkedSource.title}" is not allowlisted for ${input.actionKey}.`);
    }
    if (!matchingRule.localProjectId?.trim()) {
      throw new AppError(`Target "${linkedSource.title}" is missing a linked Local Portfolio project id.`);
    }
    if (!linkedSource.localProjectIds.includes(matchingRule.localProjectId.trim())) {
      throw new AppError(`Target "${linkedSource.title}" does not match the linked Local Portfolio project.`);
    }
    if (matchingRule.sourceIdentifier?.trim() !== sourceProjectId) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact sourceIdentifier match.`);
    }
    if (matchingRule.vercelProjectId?.trim() !== sourceProjectId) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact vercelProjectId match.`);
    }
    const scopeType = linkedSource.providerScopeType?.trim() as VercelScopeType | undefined;
    if (!scopeType || !matchingRule.vercelScopeType || matchingRule.vercelScopeType !== scopeType) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact Vercel scope type match.`);
    }
    const teamId = linkedSource.providerScopeId?.trim();
    if (scopeType === "Team" && (!teamId || matchingRule.vercelTeamId?.trim() !== teamId)) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact Vercel team id match.`);
    }
    const teamSlug = linkedSource.providerScopeSlug?.trim();
    if (scopeType === "Team" && (!teamSlug || matchingRule.vercelTeamSlug?.trim() !== teamSlug)) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact Vercel team slug match.`);
    }
    const sourceEnvironment = normalizeVercelEnvironment(linkedSource.environment);
    if (!matchingRule.vercelEnvironment || matchingRule.vercelEnvironment !== sourceEnvironment) {
      throw new AppError(`Target "${linkedSource.title}" is missing an exact Vercel environment match.`);
    }
    return {
      provider: "Vercel",
      source: linkedSource,
      rule: matchingRule,
      projectId: sourceProjectId,
      projectName: matchingRule.title || linkedSource.title,
      teamId,
      teamSlug,
      scopeType,
      environment: matchingRule.vercelEnvironment,
    };
  }

  throw new AppError(`Target source "${linkedSource.title}" uses unsupported provider "${provider}".`);
}

export function buildGitHubExecutionPayload(input: {
  request: ActionRequestRecord;
  target: ResolvedActuationTarget;
  actionKey: ActuationActionKey;
}): GitHubExecutionPayload {
  if (input.target.provider !== "GitHub" || !input.target.owner || !input.target.repo) {
    throw new AppError(`Action request "${input.request.title}" is not resolved to a GitHub target.`);
  }
  const rawTitle = input.request.payloadTitle.trim();
  const prefixedTitle =
    input.actionKey === "github.create_issue" && rawTitle
      ? `${input.target.rule.titlePrefix || ""}${input.target.rule.titlePrefix ? " " : ""}${rawTitle}`.trim()
      : rawTitle;
  const body = input.request.payloadBody.trim();
  const issueNumber = input.request.targetNumber || undefined;
  if (input.actionKey === "github.create_issue" && !prefixedTitle) {
    throw new AppError(`Action request "${input.request.title}" is missing a payload title.`);
  }
  if (
    ["github.update_issue", "github.set_issue_labels", "github.set_issue_assignees", "github.add_issue_comment"].includes(
      input.actionKey,
    ) &&
    !issueNumber
  ) {
    throw new AppError(`Action request "${input.request.title}" is missing a target issue number.`);
  }
  if (input.actionKey === "github.comment_pull_request" && !issueNumber) {
    throw new AppError(`Action request "${input.request.title}" is missing a target pull request number.`);
  }
  if (
    (input.actionKey === "github.create_issue" ||
      input.actionKey === "github.update_issue" ||
      input.actionKey === "github.add_issue_comment" ||
      input.actionKey === "github.comment_pull_request") &&
    !body &&
    input.actionKey !== "github.update_issue"
  ) {
    throw new AppError(`Action request "${input.request.title}" is missing a payload body.`);
  }
  if (input.actionKey === "github.update_issue" && !prefixedTitle && !body) {
    throw new AppError(`Action request "${input.request.title}" needs a payload title or body to update an issue.`);
  }
  if (input.actionKey === "github.set_issue_labels" && input.request.targetLabels.length === 0) {
    throw new AppError(`Action request "${input.request.title}" is missing target labels.`);
  }
  if (input.actionKey === "github.set_issue_assignees" && input.request.targetAssignees.length === 0) {
    throw new AppError(`Action request "${input.request.title}" is missing target assignees.`);
  }
  return {
    provider: "GitHub",
    actionKey: input.actionKey,
    owner: input.target.owner,
    repo: input.target.repo,
    title: prefixedTitle || undefined,
    body: body || undefined,
    issueNumber,
    labels:
      input.actionKey === "github.set_issue_labels"
        ? input.request.targetLabels
        : input.actionKey === "github.create_issue"
          ? [...new Set([...input.target.rule.defaultLabels, ...input.request.targetLabels])]
          : [],
    assignees: input.actionKey === "github.set_issue_assignees" ? input.request.targetAssignees : [],
  };
}

export function buildVercelRedeployExecutionPayload(input: {
  request: ActionRequestRecord;
  target: ResolvedActuationTarget;
  preflight?: VercelRedeployPreflight;
}): VercelRedeployExecutionPayload {
  if (
    input.target.provider !== "Vercel" ||
    !input.target.projectId ||
    !input.target.projectName ||
    !input.target.environment ||
    !input.target.scopeType
  ) {
    throw new AppError(`Action request "${input.request.title}" is not resolved to a Vercel target.`);
  }
  if (input.target.scopeType === "Team" && (!input.target.teamId || !input.target.teamSlug)) {
    throw new AppError(`Action request "${input.request.title}" is missing required Vercel team scope.`);
  }
  const latestDeployment = input.preflight?.latestDeployment;
  if (!latestDeployment) {
    throw new AppError(`Validation Failure: no existing Vercel deployment is available to redeploy for ${input.target.projectName}.`);
  }
  if (latestDeployment.projectId !== input.target.projectId) {
    throw new AppError("Validation Failure: Vercel preflight resolved a deployment for the wrong project.");
  }
  if (latestDeployment.environment !== input.target.environment) {
    throw new AppError("Validation Failure: Vercel preflight resolved the wrong deployment environment.");
  }
  return {
    provider: "Vercel",
    actionKey: "vercel.redeploy",
    projectId: input.target.projectId,
    projectName: input.target.projectName,
    teamId: input.target.teamId,
    teamSlug: input.target.teamSlug,
    scopeType: input.target.scopeType ?? "Team",
    targetEnvironment: input.target.environment,
    deploymentId: latestDeployment.deploymentId,
    deploymentUrl: latestDeployment.deploymentUrl,
    deploymentReadyState: latestDeployment.readyState,
  };
}

export function formatVercelRollbackRequestKey(input: {
  projectId: string;
  deploymentId: string;
}): string {
  return `vercel.rollback:${input.projectId}:${input.deploymentId}`;
}

export function parseVercelRollbackRequestKey(value: string): {
  projectId: string;
  deploymentId: string;
} | null {
  const match = value.trim().match(/^vercel\.rollback:([^:]+):([^:]+)$/);
  if (!match) {
    return null;
  }
  return {
    projectId: match[1]!,
    deploymentId: match[2]!,
  };
}

export function buildVercelRollbackExecutionPayload(input: {
  request: ActionRequestRecord;
  target: ResolvedActuationTarget;
  preflight?: VercelRollbackPreflight;
}): VercelRollbackExecutionPayload {
  if (
    input.target.provider !== "Vercel" ||
    !input.target.projectId ||
    !input.target.projectName ||
    !input.target.environment ||
    !input.target.scopeType
  ) {
    throw new AppError(`Action request "${input.request.title}" is not resolved to a Vercel target.`);
  }
  if (input.target.scopeType === "Team" && (!input.target.teamId || !input.target.teamSlug)) {
    throw new AppError(`Action request "${input.request.title}" is missing required Vercel team scope.`);
  }
  const currentDeployment = input.preflight?.currentDeployment;
  const rollbackCandidate = input.preflight?.rollbackCandidate;
  if (!currentDeployment || !rollbackCandidate) {
    throw new AppError(`Validation Failure: no eligible Vercel rollback candidate is available for ${input.target.projectName}.`);
  }
  if (currentDeployment.projectId !== input.target.projectId || rollbackCandidate.projectId !== input.target.projectId) {
    throw new AppError("Validation Failure: Vercel rollback preflight resolved a deployment for the wrong project.");
  }
  if (currentDeployment.environment !== input.target.environment || rollbackCandidate.environment !== input.target.environment) {
    throw new AppError("Validation Failure: Vercel rollback preflight resolved the wrong deployment environment.");
  }
  if (currentDeployment.deploymentId === rollbackCandidate.deploymentId) {
    throw new AppError("Validation Failure: Vercel rollback candidate matches the current production deployment.");
  }
  const pinnedTarget = parseVercelRollbackRequestKey(input.request.providerRequestKey);
  if (pinnedTarget) {
    if (
      pinnedTarget.projectId !== input.target.projectId ||
      pinnedTarget.deploymentId !== rollbackCandidate.deploymentId
    ) {
      throw new AppError("Validation Failure: Vercel rollback target no longer matches the approved dry-run candidate.");
    }
  }
  return {
    provider: "Vercel",
    actionKey: "vercel.rollback",
    projectId: input.target.projectId,
    projectName: input.target.projectName,
    teamId: input.target.teamId,
    teamSlug: input.target.teamSlug,
    scopeType: input.target.scopeType ?? "Team",
    targetEnvironment: input.target.environment,
    currentDeploymentId: currentDeployment.deploymentId,
    currentDeploymentUrl: currentDeployment.deploymentUrl,
    rollbackDeploymentId: rollbackCandidate.deploymentId,
    rollbackDeploymentUrl: rollbackCandidate.deploymentUrl,
    rollbackDeploymentReadyState: rollbackCandidate.readyState,
    rollbackDescription: `Action request ${input.request.id}`,
  };
}

export function computeActuationExecutionKey(input: {
  requestId: string;
  actionKey: string;
  targetSourceId: string;
  mode: ActuationMode;
  payload: GitHubExecutionPayload | VercelRedeployExecutionPayload | VercelRollbackExecutionPayload;
}): string {
  const normalized =
    input.payload.provider === "GitHub"
      ? JSON.stringify({
          requestId: input.requestId,
          actionKey: input.actionKey,
          targetSourceId: input.targetSourceId,
          mode: input.mode,
          provider: input.payload.provider,
          owner: input.payload.owner,
          repo: input.payload.repo,
          title: input.payload.title ?? null,
          body: input.payload.body ?? null,
          issueNumber: input.payload.issueNumber ?? null,
          labels: [...input.payload.labels].sort(),
          assignees: [...input.payload.assignees].sort(),
        })
      : input.payload.actionKey === "vercel.redeploy"
        ? JSON.stringify({
            requestId: input.requestId,
            actionKey: input.actionKey,
            targetSourceId: input.targetSourceId,
            mode: input.mode,
            provider: input.payload.provider,
            projectId: input.payload.projectId,
            teamId: input.payload.teamId ?? null,
            teamSlug: input.payload.teamSlug ?? null,
            targetEnvironment: input.payload.targetEnvironment,
            deploymentId: input.payload.deploymentId,
            deploymentReadyState: input.payload.deploymentReadyState,
          })
        : JSON.stringify({
            requestId: input.requestId,
            actionKey: input.actionKey,
            targetSourceId: input.targetSourceId,
            mode: input.mode,
            provider: input.payload.provider,
            projectId: input.payload.projectId,
            teamId: input.payload.teamId ?? null,
            teamSlug: input.payload.teamSlug ?? null,
            targetEnvironment: input.payload.targetEnvironment,
            currentDeploymentId: input.payload.currentDeploymentId,
            rollbackDeploymentId: input.payload.rollbackDeploymentId,
            rollbackDeploymentReadyState: input.payload.rollbackDeploymentReadyState,
          });
  return createHash("sha256").update(normalized).digest("hex");
}

export function computeGitHubActionPreflight(input: {
  payload: GitHubExecutionPayload;
  issueSnapshot?: GitHubIssueSnapshot;
  assignableAssignees?: string[];
}): GitHubActionPreflight {
  const issueSnapshot = input.issueSnapshot;
  const payloadLabels = uniqueNormalizedStrings(input.payload.labels);
  const payloadAssignees = uniqueNormalizedStrings(input.payload.assignees);
  const currentLabels = uniqueNormalizedStrings(issueSnapshot?.labels ?? []);
  const currentAssignees = uniqueNormalizedStrings(issueSnapshot?.assignees ?? []);

  const titleWillChange =
    input.payload.actionKey === "github.update_issue" &&
    Boolean(issueSnapshot) &&
    input.payload.title !== undefined &&
    input.payload.title !== issueSnapshot?.title;
  const bodyWillChange =
    input.payload.actionKey === "github.update_issue" &&
    Boolean(issueSnapshot) &&
    input.payload.body !== undefined &&
    input.payload.body !== issueSnapshot?.body;

  const labelsToAdd =
    input.payload.actionKey === "github.set_issue_labels"
      ? payloadLabels.filter((label) => !currentLabels.includes(label))
      : [];
  const blockedLabelRemovals =
    input.payload.actionKey === "github.set_issue_labels"
      ? currentLabels.filter((label) => !payloadLabels.includes(label))
      : [];

  const requestedAssigneeAdds =
    input.payload.actionKey === "github.set_issue_assignees"
      ? payloadAssignees.filter((assignee) => !currentAssignees.includes(assignee))
      : [];
  const assignableAssignees = uniqueNormalizedStrings(input.assignableAssignees ?? []);
  const unassignableAssignees =
    input.payload.actionKey === "github.set_issue_assignees" && input.assignableAssignees !== undefined
      ? requestedAssigneeAdds.filter((assignee) => !assignableAssignees.includes(assignee))
      : [];
  const assigneesToAdd =
    input.payload.actionKey === "github.set_issue_assignees"
      ? requestedAssigneeAdds.filter((assignee) => !unassignableAssignees.includes(assignee))
      : [];
  const blockedAssigneeRemovals =
    input.payload.actionKey === "github.set_issue_assignees"
      ? currentAssignees.filter((assignee) => !payloadAssignees.includes(assignee))
      : [];

  const noMaterialChange =
    input.payload.actionKey === "github.update_issue"
      ? Boolean(issueSnapshot) && !titleWillChange && !bodyWillChange
      : input.payload.actionKey === "github.set_issue_labels"
        ? labelsToAdd.length === 0
        : input.payload.actionKey === "github.set_issue_assignees"
          ? assigneesToAdd.length === 0
          : false;

  return {
    issueSnapshot,
    titleWillChange,
    bodyWillChange,
    labelsToAdd,
    blockedLabelRemovals,
    assigneesToAdd,
    blockedAssigneeRemovals,
    unassignableAssignees,
    missingPullRequestPermission: false,
    noMaterialChange,
  };
}

export function describeGitHubActionPreflight(input: {
  actionKey: ActuationActionKey;
  preflight?: GitHubActionPreflight;
}): string[] {
  const preflight = input.preflight;
  if (!preflight) {
    return [];
  }

  if (input.actionKey === "github.update_issue") {
    if (preflight.noMaterialChange) {
      return ["Live execution would skip because the requested issue title/body already match GitHub."];
    }
    const notes: string[] = [];
    if (preflight.titleWillChange) {
      notes.push("Title would change.");
    }
    if (preflight.bodyWillChange) {
      notes.push("Body would change.");
    }
    return notes;
  }

  if (input.actionKey === "github.set_issue_labels") {
    const notes: string[] = [];
    if (preflight.labelsToAdd.length > 0) {
      notes.push(`Labels to add: ${preflight.labelsToAdd.join(", ")}.`);
    }
    if (preflight.blockedLabelRemovals.length > 0) {
      notes.push(`Blocked label removals: ${preflight.blockedLabelRemovals.join(", ")}.`);
    }
    if (notes.length === 0) {
      notes.push("Live execution would skip because all requested labels are already present.");
    }
    return notes;
  }

  if (input.actionKey === "github.set_issue_assignees") {
    const notes: string[] = [];
    if (preflight.assigneesToAdd.length > 0) {
      notes.push(`Assignees to add: ${preflight.assigneesToAdd.join(", ")}.`);
    }
    if (preflight.blockedAssigneeRemovals.length > 0) {
      notes.push(`Blocked assignee removals: ${preflight.blockedAssigneeRemovals.join(", ")}.`);
    }
    if (preflight.unassignableAssignees.length > 0) {
      notes.push(`Not assignable in GitHub: ${preflight.unassignableAssignees.join(", ")}.`);
    }
    if (notes.length === 0) {
      notes.push("Live execution would skip because all requested assignees are already present.");
    }
    return notes;
  }

  if (input.actionKey === "github.comment_pull_request" && preflight.issueSnapshot && !preflight.issueSnapshot.isPullRequest) {
    return ["The target number resolves to an issue, not a pull request."];
  }
  if (input.actionKey === "github.comment_pull_request" && preflight.missingPullRequestPermission) {
    return ["GitHub App is missing pull request permission required for PR comments."];
  }

  return [];
}

export function describeVercelRedeployPreflight(preflight?: VercelRedeployPreflight): string[] {
  if (!preflight) {
    return [];
  }
  const notes: string[] = [];
  if (!preflight.providerExercised) {
    notes.push("Vercel was not exercised during preflight.");
    return notes;
  }
  if (preflight.latestDeployment) {
    notes.push(`Latest deployment candidate: ${preflight.latestDeployment.deploymentId}.`);
    notes.push(`Candidate ready state: ${preflight.latestDeployment.readyState}.`);
    notes.push(`Target environment: ${preflight.targetEnvironment}.`);
  }
  if (preflight.noRedeployCandidate) {
    notes.push("No existing deployment is available to redeploy.");
  }
  return notes;
}

export function describeVercelRollbackPreflight(preflight?: VercelRollbackPreflight): string[] {
  if (!preflight) {
    return [];
  }
  const notes: string[] = [];
  if (!preflight.providerExercised) {
    notes.push("Vercel was not exercised during preflight.");
    return notes;
  }
  if (preflight.currentDeployment) {
    notes.push(`Current production deployment: ${preflight.currentDeployment.deploymentId}.`);
  }
  if (preflight.rollbackCandidate) {
    notes.push(`Pinned rollback candidate: ${preflight.rollbackCandidate.deploymentId}.`);
    notes.push(`Candidate ready state: ${preflight.rollbackCandidate.readyState}.`);
  }
  if (preflight.noRollbackCandidate) {
    notes.push("No previous eligible production deployment is available to roll back to.");
  }
  return notes;
}

export function summarizeGitHubLabelDelta(input: {
  payload: GitHubExecutionPayload;
  preflight?: GitHubActionPreflight;
}): string {
  if (input.payload.actionKey !== "github.set_issue_labels") {
    return "";
  }
  if (!input.preflight) {
    return input.payload.labels.length > 0 ? `Requested labels: ${input.payload.labels.join(", ")}` : "";
  }
  const parts: string[] = [];
  if (input.preflight.labelsToAdd.length > 0) {
    parts.push(`Add labels: ${input.preflight.labelsToAdd.join(", ")}`);
  }
  if (input.preflight.blockedLabelRemovals.length > 0) {
    parts.push(`Blocked removals: ${input.preflight.blockedLabelRemovals.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("No label change needed.");
  }
  return parts.join(" | ");
}

export function summarizeGitHubAssigneeDelta(input: {
  payload: GitHubExecutionPayload;
  preflight?: GitHubActionPreflight;
}): string {
  if (input.payload.actionKey !== "github.set_issue_assignees") {
    return "";
  }
  if (!input.preflight) {
    return input.payload.assignees.length > 0 ? `Requested assignees: ${input.payload.assignees.join(", ")}` : "";
  }
  const parts: string[] = [];
  if (input.preflight.assigneesToAdd.length > 0) {
    parts.push(`Add assignees: ${input.preflight.assigneesToAdd.join(", ")}`);
  }
  if (input.preflight.blockedAssigneeRemovals.length > 0) {
    parts.push(`Blocked removals: ${input.preflight.blockedAssigneeRemovals.join(", ")}`);
  }
  if (input.preflight.unassignableAssignees.length > 0) {
    parts.push(`Not assignable: ${input.preflight.unassignableAssignees.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("No assignee change needed.");
  }
  return parts.join(" | ");
}

export function renderActuationPacketSection(input: {
  request: ActionRequestRecord;
  payload: GitHubExecutionPayload | VercelRedeployExecutionPayload | VercelRollbackExecutionPayload | null;
  target: ResolvedActuationTarget | null;
  preflight?: GitHubActionPreflight | VercelRedeployPreflight | VercelRollbackPreflight;
  latestExecution?: ExternalActionExecutionRecord;
  validationNotes: string[];
  idempotencyKey?: string;
}): string {
  if (input.payload?.provider === "Vercel" || input.target?.provider === "Vercel") {
    const payload = input.payload?.provider === "Vercel" ? input.payload : null;
    const isRollback = payload?.actionKey === "vercel.rollback" || input.request.providerRequestKey.startsWith("vercel.rollback:");
    const rollbackPreflight = isRollback ? (input.preflight as VercelRollbackPreflight | undefined) : undefined;
    const redeployPreflight = !isRollback ? (input.preflight as VercelRedeployPreflight | undefined) : undefined;
    const latestDeployment = redeployPreflight?.latestDeployment;
    const currentDeployment = rollbackPreflight?.currentDeployment;
    const rollbackCandidate = rollbackPreflight?.rollbackCandidate;
    const preflightNotes = isRollback
      ? describeVercelRollbackPreflight(rollbackPreflight)
      : describeVercelRedeployPreflight(redeployPreflight);
    return [
      "<!-- codex:notion-actuation-packet:start -->",
      "## Vercel Operator Packet",
      "",
      `- Action family: ${payload?.actionKey || (isRollback ? "vercel.rollback" : "vercel.redeploy")}`,
      `- Execution intent: ${input.request.executionIntent || "Dry Run"}`,
      `- Target source: ${input.target ? `[${input.target.source.title}](${input.target.source.url})` : "Not resolved"}`,
      `- Vercel project: ${payload?.projectName || input.target?.projectName || "Not resolved"}`,
      `- Project id: ${payload?.projectId || input.target?.projectId || "Not resolved"}`,
      `- Team scope: ${payload?.teamSlug || input.target?.teamSlug || payload?.teamId || input.target?.teamId || "Personal"}`,
      `- Target environment: ${payload?.targetEnvironment || input.target?.environment || "Not resolved"}`,
      `- Provider request key: ${input.request.providerRequestKey || "Not pinned yet"}`,
      `- Idempotency key: ${input.idempotencyKey || "Not computed yet"}`,
      `- Latest execution: ${input.latestExecution ? `[${input.latestExecution.title}](${input.latestExecution.url}) - ${input.latestExecution.mode} / ${input.latestExecution.status}` : "None yet"}`,
      `- Latest response classification: ${input.latestExecution?.responseClassification || "Not classified yet"}`,
      `- Reconcile status: ${input.latestExecution?.reconcileStatus || "Not Needed"}`,
      "",
      ...(isRollback
        ? [
            "### Rollback Targeting",
            ...(currentDeployment
              ? [
                  `- Current production deployment id: ${currentDeployment.deploymentId}`,
                  `- Current production deployment url: ${currentDeployment.deploymentUrl}`,
                  `- Current deployment created at: ${currentDeployment.createdAt}`,
                ]
              : ["- Current production deployment is not resolved yet."]),
            ...(rollbackCandidate
              ? [
                  `- Rollback candidate deployment id: ${rollbackCandidate.deploymentId}`,
                  `- Rollback candidate deployment url: ${rollbackCandidate.deploymentUrl}`,
                  `- Rollback candidate created at: ${rollbackCandidate.createdAt}`,
                ]
              : ["- No previous eligible production deployment is available yet."]),
            "",
          ]
        : [
            "### Redeploy Basis",
            ...(latestDeployment
              ? [
                  `- Deployment id: ${latestDeployment.deploymentId}`,
                  `- Deployment url: ${latestDeployment.deploymentUrl}`,
                  `- Ready state: ${latestDeployment.readyState}`,
                  `- Created at: ${latestDeployment.createdAt}`,
                ]
              : ["- No existing deployment is available to redeploy yet."]),
            "",
          ]),
      "",
      "### Vercel Preflight",
      ...(preflightNotes.length > 0 ? preflightNotes.map((note) => `- ${note}`) : ["- Preflight data will appear once Vercel state can be resolved."]),
      "",
      "### Validation Notes",
      ...(input.validationNotes.length > 0 ? input.validationNotes.map((note) => `- ${note}`) : ["- Ready for dry run."]),
      "",
      "### Compensation Posture",
      ...(isRollback
        ? [
            "- If rollback verification is ambiguous, treat the request as compensation-needed and stop the pilot.",
            "- Rollback leaves production auto-assignment disabled until a later explicit promote or undo step.",
          ]
        : [
            "- If the redeploy is wrong, stop widening scope and use a fresh explicit request rather than hidden retries.",
            "- Promotion and rollback stay out of scope in this redeploy lane.",
          ]),
      "",
      "### Webhook Recovery",
      "- Treat Vercel webhooks as evidence only in this phase.",
      `- Use direct provider reads to confirm the ${isRollback ? "rolled-back production target" : "deployment state"} after any live Vercel action.`,
      "<!-- codex:notion-actuation-packet:end -->",
    ].join("\n");
  }
  const githubPreflight = input.preflight as GitHubActionPreflight | undefined;
  const preflightNotes =
    input.payload?.provider === "GitHub" && githubPreflight
      ? describeGitHubActionPreflight({
          actionKey: input.payload.actionKey,
          preflight: githubPreflight,
        })
      : [];
  return [
    "<!-- codex:notion-actuation-packet:start -->",
    "## GitHub Operator Packet",
    "",
    `- Action family: ${input.payload?.actionKey || "Not resolved"}`,
    `- Execution intent: ${input.request.executionIntent || "Dry Run"}`,
    `- Target source: ${input.target ? `[${input.target.source.title}](${input.target.source.url})` : "Not resolved"}`,
    `- GitHub repo: ${input.target ? `${input.target.owner}/${input.target.repo}` : "Not resolved"}`,
    `- Target issue or PR: ${input.payload?.issueNumber ? `#${input.payload.issueNumber}` : "New issue"}`,
    `- Permission family: ${input.payload ? "Issues: Read and write" : "Not resolved"}`,
    `- Idempotency key: ${input.idempotencyKey || "Not computed yet"}`,
    `- Latest execution: ${input.latestExecution ? `[${input.latestExecution.title}](${input.latestExecution.url}) - ${input.latestExecution.mode} / ${input.latestExecution.status}` : "None yet"}`,
    `- Latest response classification: ${input.latestExecution?.responseClassification || "Not classified yet"}`,
    `- Reconcile status: ${input.latestExecution?.reconcileStatus || "Not Needed"}`,
    "",
    "### Payload Preview",
    ...(input.payload
      ? [
          `- Title: ${input.payload.title || "(not used for this action)"}`,
          `- Body length: ${input.payload.body?.length ?? 0} chars`,
          `- Labels: ${input.payload.labels.join(", ") || "None"}`,
          `- Assignees: ${input.payload.assignees.join(", ") || "None"}`,
          input.payload.issueNumber ? `- Target number: #${input.payload.issueNumber}` : "- Target number: New issue",
        ]
      : ["- Payload preview unavailable until the request is fully populated."]),
    "",
    "### GitHub Preflight",
    ...(githubPreflight
      ? [
          `- Current target type: ${githubPreflight.issueSnapshot?.isPullRequest ? "Pull request" : input.payload?.issueNumber ? "Issue" : "New issue"}`,
          `- Current labels: ${githubPreflight.issueSnapshot?.labels.join(", ") || "None"}`,
          `- Current assignees: ${githubPreflight.issueSnapshot?.assignees.join(", ") || "None"}`,
          ...preflightNotes.map((note) => `- ${note}`),
        ]
      : ["- Preflight data will appear once GitHub state can be resolved."]),
    "",
    "### Validation Notes",
    ...(input.validationNotes.length > 0 ? input.validationNotes.map((note) => `- ${note}`) : ["- Ready for dry run."]),
    "",
    "### Compensation Posture",
    ...(input.payload?.actionKey.includes("comment")
      ? ["- Use a corrective follow-up comment rather than delete-in-place in v1."]
      : [
          "- Use fix-forward and/or a manual-close follow-up plan rather than destructive delete in v1.",
          "- For label or assignee corrections, submit a new explicit desired-state request.",
        ]),
    "",
    "### Webhook Recovery",
    "- If GitHub delivery fails, use GitHub App delivery history plus redelivery, then run the webhook drain command.",
    "- Keep temporary tunnel risk in mind until the hosted sidecar is introduced in a later phase.",
    "<!-- codex:notion-actuation-packet:end -->",
  ].join("\n");
}

export function renderActuationCommandCenterSection(input: {
  requests: ActionRequestRecord[];
  executions: ExternalActionExecutionRecord[];
}): string {
  const readyToDryRun = input.requests.filter(
    (request) => request.status === "Approved" && (request.executionIntent || "Dry Run") === "Dry Run",
  );
  const readyForLive = input.requests.filter(
    (request) => request.status === "Approved" && request.executionIntent === "Ready for Live",
  );
  const recentSuccesses = input.executions
    .filter((execution) => execution.mode === "Live" && execution.status === "Succeeded")
    .sort((left, right) => right.executedAt.localeCompare(left.executedAt))
    .slice(0, 8);
  const failures = input.executions
    .filter((execution) => ["Failed", "Compensation Needed"].includes(execution.status))
    .sort((left, right) => right.executedAt.localeCompare(left.executedAt))
    .slice(0, 8);

  return [
    "<!-- codex:notion-actuation-command-center:start -->",
    "## External Actuation Lane",
    "",
    `- Ready to dry run: ${readyToDryRun.length}`,
    `- Approved for live: ${readyForLive.length}`,
    `- Recent live successes: ${recentSuccesses.length}`,
    `- Failures or compensation-needed: ${failures.length}`,
    "- Current safety posture: GitHub stays additive-only, Vercel writes stay serial, and rollback is only allowlisted for evolutionsandbox.",
    "- If webhook delivery fails, recover through provider delivery history and then drain/reconcile locally.",
    "",
    "### Ready for Live",
    ...(readyForLive.length > 0 ? readyForLive.map((request) => `- [${request.title}](${request.url})`) : ["- None right now."]),
    "",
    "### Recent Live Successes",
    ...(recentSuccesses.length > 0
      ? recentSuccesses.map((execution) => `- [${execution.title}](${execution.url}) - ${execution.executedAt}`)
      : ["- No live executions yet."]),
    "",
    "### Failures",
    ...(failures.length > 0
      ? failures.map((execution) => `- [${execution.title}](${execution.url}) - ${execution.status}`)
      : ["- No actuation failures at the moment."]),
    "<!-- codex:notion-actuation-command-center:end -->",
  ].join("\n");
}

export function renderWeeklyActuationSection(input: {
  executions: ExternalActionExecutionRecord[];
}): string {
  const dryRuns = input.executions.filter((execution) => execution.mode === "Dry Run");
  const liveSuccesses = input.executions.filter(
    (execution) => execution.mode === "Live" && execution.status === "Succeeded",
  );
  const failures = input.executions.filter((execution) => execution.status === "Failed");
  const compensation = input.executions.filter((execution) => execution.status === "Compensation Needed");
  return [
    "<!-- codex:notion-weekly-actuation:start -->",
    "## Weekly Actuation Summary",
    "",
    `- Dry runs completed: ${dryRuns.length}`,
    `- Live actions executed: ${liveSuccesses.length}`,
    `- Failed executions: ${failures.length}`,
    `- Compensation-needed items: ${compensation.length}`,
    "<!-- codex:notion-weekly-actuation:end -->",
  ].join("\n");
}

export function buildGitHubCompensationPlan(actionKey: ActuationActionKey): string {
  if (actionKey === "github.add_issue_comment" || actionKey === "github.comment_pull_request") {
    return "If the live comment is wrong, add a corrective follow-up comment rather than deleting in place.";
  }
  if (actionKey === "github.set_issue_labels" || actionKey === "github.set_issue_assignees") {
    return "If the desired state is wrong, submit a corrective desired-state request rather than mutating manually.";
  }
  return "If the live issue change is wrong, use fix-forward and/or a manual-close follow-up plan rather than delete in v1.";
}

export function buildVercelCompensationPlan(actionKey: Extract<ActuationActionKey, "vercel.redeploy" | "vercel.rollback"> = "vercel.redeploy"): string {
  if (actionKey === "vercel.rollback") {
    return "If rollback verification is ambiguous, pause immediately, confirm which deployment currently owns production, and use an explicit follow-up request rather than silent retries.";
  }
  return "If the redeploy is wrong, pause further live requests, verify the resulting deployment state, and use a fresh explicit follow-up request rather than hidden retries.";
}

export function evaluateActionRequestReadiness(input: {
  request: ActionRequestRecord;
  policies: ActionPolicyRecord[];
  target?: ResolvedActuationTarget;
  config: LocalPortfolioControlTowerConfig;
  latestDryRun?: ExternalActionExecutionRecord;
  actionKey: ActuationActionKey;
  preflight?: GitHubActionPreflight | VercelRedeployPreflight | VercelRollbackPreflight;
  today: string;
}): string[] {
  const notes: string[] = [];
  const githubPreflight = input.preflight as GitHubActionPreflight | undefined;
  const phase7 = requirePhase7Actuation(input.config);
  const policy = input.policies.find((entry) => input.request.policyIds.includes(entry.id));
  if (!policy) {
    notes.push("Missing linked policy.");
  }
  if (phase7.liveGating.requireApproval && input.request.status !== "Approved") {
    notes.push("Request is not approved.");
  }
  if (policy && !policy.allowedSources.includes(input.request.sourceType)) {
    notes.push(`Request source type "${input.request.sourceType}" is not allowlisted by policy.`);
  }
  if (input.request.executionIntent === "Ready for Live" && policy) {
    const distinctApprovers = uniqueNormalizedStrings(input.request.approverIds);
    if (policy.approvalRule === "Single Approval" && distinctApprovers.length < 1) {
      notes.push("At least one approver is required before live execution.");
    }
    if (policy.approvalRule === "Dual Approval" && distinctApprovers.length < 2) {
      notes.push("Two distinct approvers are required before live execution.");
    }
    if (policy.approvalRule === "No Write") {
      notes.push("Policy is configured as No Write.");
    }
  }
  if (phase7.liveGating.requireNonExpiredRequest && input.request.expiresAt && input.request.expiresAt < input.today) {
    notes.push("Request is expired.");
  }
  if (!input.request.payloadBody.trim()) {
    if (
      input.actionKey === "github.create_issue" ||
      input.actionKey === "github.add_issue_comment" ||
      input.actionKey === "github.comment_pull_request"
    ) {
      notes.push("Payload body is missing.");
    }
  }
  if (input.actionKey === "github.create_issue" && !input.request.payloadTitle.trim()) {
    notes.push("Payload title is missing for issue creation.");
  }
  if (
    ["github.update_issue", "github.set_issue_labels", "github.set_issue_assignees", "github.add_issue_comment"].includes(
      input.actionKey,
    ) &&
    !input.request.targetNumber
  ) {
    notes.push("Target issue number is missing.");
  }
  if (input.actionKey === "github.comment_pull_request" && !input.request.targetNumber) {
    notes.push("Target pull request number is missing.");
  }
  if (input.actionKey === "github.update_issue" && !input.request.payloadTitle.trim() && !input.request.payloadBody.trim()) {
    notes.push("Issue update needs a title and/or body change.");
  }
  if (input.actionKey === "github.set_issue_labels" && input.request.targetLabels.length === 0) {
    notes.push("Target labels are missing.");
  }
  if (input.actionKey === "github.set_issue_assignees" && input.request.targetAssignees.length === 0) {
    notes.push("Target assignees are missing.");
  }
  if (input.actionKey === "github.set_issue_labels" && (githubPreflight?.blockedLabelRemovals.length ?? 0) > 0) {
    notes.push(
      `Phase 8 additive-only labels cannot remove existing labels: ${githubPreflight?.blockedLabelRemovals.join(", ")}.`,
    );
  }
  if (input.actionKey === "github.set_issue_assignees" && (githubPreflight?.blockedAssigneeRemovals.length ?? 0) > 0) {
    notes.push(
      `Phase 8 additive-only assignees cannot remove existing assignees: ${githubPreflight?.blockedAssigneeRemovals.join(", ")}.`,
    );
  }
  if (input.actionKey === "github.set_issue_assignees" && (githubPreflight?.unassignableAssignees.length ?? 0) > 0) {
    notes.push(`These assignees are not assignable in GitHub: ${githubPreflight?.unassignableAssignees.join(", ")}.`);
  }
  if (input.actionKey === "github.comment_pull_request" && githubPreflight?.issueSnapshot && !githubPreflight.issueSnapshot.isPullRequest) {
    notes.push("Target pull request number resolves to an issue instead of a pull request.");
  }
  if (input.actionKey === "github.comment_pull_request" && githubPreflight?.missingPullRequestPermission) {
    notes.push("GitHub App is missing pull request permission required for PR comments.");
  }
  if (input.actionKey === "vercel.redeploy") {
    const preflight = input.preflight as VercelRedeployPreflight | undefined;
    if (!preflight?.providerExercised) {
      notes.push("Vercel preflight did not exercise the provider.");
    }
    if (preflight?.noRedeployCandidate) {
      notes.push("No existing Vercel deployment is available to redeploy.");
    }
  }
  if (input.actionKey === "vercel.rollback") {
    const preflight = input.preflight as VercelRollbackPreflight | undefined;
    if (!preflight?.providerExercised) {
      notes.push("Vercel rollback preflight did not exercise the provider.");
    }
    if (preflight?.noRollbackCandidate) {
      notes.push("No previous eligible production deployment is available to roll back to.");
    }
    if (input.request.executionIntent === "Ready for Live") {
      const pinnedTarget = parseVercelRollbackRequestKey(input.request.providerRequestKey);
      if (!pinnedTarget) {
        notes.push("Provider request key is missing the pinned Vercel rollback target.");
      } else if (
        input.target?.projectId &&
        (pinnedTarget.projectId !== input.target.projectId ||
          pinnedTarget.deploymentId !== preflight?.rollbackCandidate?.deploymentId)
      ) {
        notes.push("Pinned Vercel rollback target no longer matches the current rollback candidate.");
      }
    }
  }
  if (!input.target) {
    notes.push(
      input.actionKey.startsWith("vercel.") ? "Target Vercel source is not resolved." : "Target GitHub source is not resolved.",
    );
  }
  if (
    phase7.liveGating.requireFreshDryRunBeforeLive &&
    input.request.executionIntent === "Ready for Live" &&
    (!input.latestDryRun ||
      input.latestDryRun.status !== "Succeeded" ||
      hoursBetween(input.latestDryRun.executedAt, `${input.today}T00:00:00Z`) > phase7.liveGating.freshDryRunMaxAgeHours)
  ) {
    notes.push("A fresh successful dry run is required before live execution.");
  }
  if (policy?.executionMode !== "Approved Live" && input.request.executionIntent === "Ready for Live") {
    notes.push("Linked policy is not live-capable yet.");
  }
  if (input.request.executionIntent === "Ready for Live") {
    if (input.actionKey === "vercel.redeploy" || input.actionKey === "vercel.rollback") {
      const missingCredentials = missingVercelLiveCredentials();
      if (missingCredentials.length > 0) {
        notes.push(`Live Vercel credentials are missing: ${missingCredentials.join(", ")}.`);
      }
    } else {
      const missingCredentials = missingGitHubLiveCredentials();
      if (missingCredentials.length > 0) {
        notes.push(`Live GitHub credentials are missing: ${missingCredentials.join(", ")}.`);
      }
    }
  }
  return notes;
}

export function computePostDryRunReadiness(input: {
  request: ActionRequestRecord;
  policies: ActionPolicyRecord[];
  target?: ResolvedActuationTarget;
  config: LocalPortfolioControlTowerConfig;
  actionKey: ActuationActionKey;
  executedAt: string;
  preflightNotes: string[];
  preflight?: GitHubActionPreflight | VercelRedeployPreflight | VercelRollbackPreflight;
}): {
  executionIntent: ActionRequestRecord["executionIntent"];
  notes: string[];
  latestExecutionStatus: ActionRequestRecord["latestExecutionStatus"];
  providerRequestKey: string;
} {
  if (input.preflightNotes.length > 0) {
    return {
      executionIntent: "Dry Run",
      notes: input.preflightNotes,
      latestExecutionStatus: "Problem",
      providerRequestKey: input.request.providerRequestKey,
    };
  }

  const rollbackPinnedKey =
    input.actionKey === "vercel.rollback"
      ? formatVercelRollbackRequestKey({
          projectId: input.target?.projectId ?? "",
          deploymentId: (input.preflight as VercelRollbackPreflight | undefined)?.rollbackCandidate?.deploymentId ?? "",
        })
      : input.request.providerRequestKey;

  const liveNotes = evaluateActionRequestReadiness({
    request: {
      ...input.request,
      executionIntent: "Ready for Live",
      providerRequestKey: rollbackPinnedKey,
    },
    policies: input.policies,
    target: input.target,
    config: input.config,
    latestDryRun: {
      id: "fresh-dry-run",
      url: "",
      title: "Fresh dry run",
      actionRequestIds: [input.request.id],
      localProjectIds: input.request.localProjectIds,
      policyIds: input.request.policyIds,
      targetSourceIds: input.target ? [input.target.source.id] : [],
      provider: input.actionKey.startsWith("vercel.") ? "Vercel" : "GitHub",
      actionKey: input.actionKey,
      mode: "Dry Run",
      status: "Succeeded",
      idempotencyKey: "",
      executedAt: input.executedAt,
      providerResultKey: "",
      providerUrl: "",
      issueNumber: input.request.targetNumber,
      commentId: "",
      labelDeltaSummary: "",
      assigneeDeltaSummary: "",
      responseClassification: "Success",
      reconcileStatus: "Not Needed",
      responseSummary: "",
      failureNotes: "",
      compensationPlan: "",
    },
    actionKey: input.actionKey,
    preflight: input.preflight,
    today: input.executedAt.slice(0, 10),
  });

  if (liveNotes.length > 0) {
    return {
      executionIntent: "Dry Run",
      notes: [`Dry run passed, but live execution is still blocked: ${liveNotes.join(" ")}`],
      latestExecutionStatus: "Problem",
      providerRequestKey: rollbackPinnedKey,
    };
  }

  const preflightNotes =
    input.actionKey === "vercel.redeploy"
      ? describeVercelRedeployPreflight(input.preflight as VercelRedeployPreflight | undefined)
      : input.actionKey === "vercel.rollback"
        ? describeVercelRollbackPreflight(input.preflight as VercelRollbackPreflight | undefined)
        : describeGitHubActionPreflight({
          actionKey: input.actionKey,
          preflight: input.preflight as GitHubActionPreflight | undefined,
        });

  return {
    executionIntent: "Ready for Live",
    notes:
      preflightNotes.length > 0
        ? [`Dry run passed and is ready for live execution. ${preflightNotes.join(" ")}`]
        : ["Dry run passed and is ready for live execution."],
    latestExecutionStatus: "Dry Run Passed",
    providerRequestKey: rollbackPinnedKey,
  };
}

export async function mintGitHubInstallationToken(input: {
  owner: string;
  repo: string;
}): Promise<string> {
  const access = await mintGitHubInstallationAccess(input);
  return access.token;
}

interface GitHubInstallationAccess {
  token: string;
  permissions: Record<string, string>;
}

async function mintGitHubInstallationAccess(input: {
  owner: string;
  repo: string;
}): Promise<GitHubInstallationAccess> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const pem = process.env.GITHUB_APP_PRIVATE_KEY_PEM?.trim();
  if (!appId || !pem) {
    throw new AppError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PEM are required for live GitHub execution");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };
  const appJwt = signJwt(payload, pem);

  const installationResponse = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/installation`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt}`,
      "User-Agent": "notion-portfolio-actuation",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!installationResponse.ok) {
    throw new AppError(`Could not resolve GitHub App installation for ${input.owner}/${input.repo}`);
  }
  const installation = (await installationResponse.json()) as { id?: number };
  if (!installation.id) {
    throw new AppError(`GitHub App installation lookup for ${input.owner}/${input.repo} returned no id`);
  }

  const tokenResponse = await fetch(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt}`,
      "User-Agent": "notion-portfolio-actuation",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!tokenResponse.ok) {
    throw new AppError(`Could not mint GitHub installation token for ${input.owner}/${input.repo}`);
  }
  const body = (await tokenResponse.json()) as {
    token?: string;
    permissions?: Record<string, string>;
  };
  if (!body.token) {
    throw new AppError(`GitHub installation token response for ${input.owner}/${input.repo} returned no token`);
  }
  return {
    token: body.token,
    permissions: body.permissions ?? {},
  };
}

export async function fetchGitHubActionPreflight(input: {
  payload: GitHubExecutionPayload;
}): Promise<GitHubActionPreflight | undefined> {
  if (input.payload.actionKey === "github.create_issue" || !input.payload.issueNumber) {
    return undefined;
  }
  if (missingGitHubLiveCredentials().length > 0) {
    return undefined;
  }

  const access = await mintGitHubInstallationAccess({
    owner: input.payload.owner,
    repo: input.payload.repo,
  });
  const baseHeaders = githubApiHeaders(access.token);
  let snapshot: GitHubIssueSnapshot | undefined;
  try {
    snapshot = await fetchGitHubIssueSnapshot({
      owner: input.payload.owner,
      repo: input.payload.repo,
      issueNumber: input.payload.issueNumber,
      headers: baseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.payload.actionKey === "github.comment_pull_request" && message.includes("Permission Failure")) {
      const preflight = computeGitHubActionPreflight({
        payload: input.payload,
      });
      preflight.missingPullRequestPermission = true;
      return preflight;
    }
    throw error;
  }

  let assignableAssignees: string[] | undefined;
  if (input.payload.actionKey === "github.set_issue_assignees" && input.payload.assignees.length > 0) {
    assignableAssignees = [];
    for (const assignee of uniqueNormalizedStrings(input.payload.assignees)) {
      const response = await fetch(
        `https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/assignees/${encodeURIComponent(assignee)}`,
        {
          headers: baseHeaders,
        },
      );
      if (response.status === 204) {
        assignableAssignees.push(assignee);
        continue;
      }
      if (response.status === 404) {
        continue;
      }
      const body = (await response.json()) as { message?: string };
      throwGitHubExecutionFailure(response.status, body.message);
    }
  }

  const preflight = computeGitHubActionPreflight({
    payload: input.payload,
    issueSnapshot: snapshot,
    assignableAssignees,
  });
  if (input.payload.actionKey === "github.comment_pull_request" && !hasGitHubPullRequestPermission(access.permissions)) {
    preflight.missingPullRequestPermission = true;
  }
  return preflight;
}

export async function executeGitHubAction(input: {
  payload: GitHubExecutionPayload;
  preflight?: GitHubActionPreflight;
}): Promise<GitHubExecutionResult> {
  const token = await mintGitHubInstallationToken({
    owner: input.payload.owner,
    repo: input.payload.repo,
  });
  const baseHeaders = githubApiHeaders(token);

  if (input.payload.actionKey === "github.create_issue") {
    const response = await fetch(`https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/issues`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        title: input.payload.title,
        body: input.payload.body,
        labels: input.payload.labels,
      }),
    });
    const body = (await response.json()) as { number?: number; html_url?: string; message?: string };
    if (!response.ok) {
      throwGitHubExecutionFailure(response.status, body.message);
    }
    return {
      executionStatus: "Succeeded",
      providerResultKey: String(body.number ?? ""),
      providerUrl: body.html_url ?? "",
      issueNumber: body.number ?? 0,
      commentId: "",
      labelDeltaSummary: input.payload.labels.length > 0 ? `Set labels: ${input.payload.labels.join(", ")}` : "",
      assigneeDeltaSummary: "",
      responseClassification: "Success",
      reconcileStatus: "Pending",
      responseSummary: `Created GitHub issue #${body.number ?? "unknown"}.`,
    };
  }

  if (input.payload.actionKey === "github.update_issue") {
    if (input.preflight?.noMaterialChange) {
      return {
        executionStatus: "Skipped",
        providerResultKey: String(input.payload.issueNumber ?? ""),
        providerUrl:
          input.preflight.issueSnapshot?.providerUrl ??
          `https://github.com/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
        issueNumber: input.payload.issueNumber ?? 0,
        commentId: "",
        labelDeltaSummary: "",
        assigneeDeltaSummary: "",
        responseClassification: "Success",
        reconcileStatus: "Not Needed",
        responseSummary: `Skipped GitHub issue #${input.payload.issueNumber ?? "unknown"} because no material title/body change was needed.`,
      };
    }
    const response = await fetch(
      `https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
      {
        method: "PATCH",
        headers: baseHeaders,
        body: JSON.stringify({
          ...(input.preflight?.titleWillChange && input.payload.title ? { title: input.payload.title } : {}),
          ...(input.preflight?.bodyWillChange && input.payload.body ? { body: input.payload.body } : {}),
          ...(!input.preflight && input.payload.title ? { title: input.payload.title } : {}),
          ...(!input.preflight && input.payload.body ? { body: input.payload.body } : {}),
        }),
      },
    );
    const body = (await response.json()) as { number?: number; html_url?: string; message?: string };
    if (!response.ok) {
      throwGitHubExecutionFailure(response.status, body.message);
    }
    return {
      executionStatus: "Succeeded",
      providerResultKey: String(body.number ?? input.payload.issueNumber ?? ""),
      providerUrl: body.html_url ?? "",
      issueNumber: body.number ?? input.payload.issueNumber ?? 0,
      commentId: "",
      labelDeltaSummary: "",
      assigneeDeltaSummary: "",
      responseClassification: "Success",
      reconcileStatus: "Pending",
      responseSummary: `Updated GitHub issue #${body.number ?? input.payload.issueNumber ?? "unknown"}.`,
    };
  }

  if (input.payload.actionKey === "github.set_issue_labels") {
    if ((input.preflight?.blockedLabelRemovals.length ?? 0) > 0) {
      throw new AppError(
        `Validation Failure: additive-only labels cannot remove ${input.preflight?.blockedLabelRemovals.join(", ")}`,
      );
    }
    if ((input.preflight?.labelsToAdd.length ?? input.payload.labels.length) === 0) {
      return {
        executionStatus: "Skipped",
        providerResultKey: String(input.payload.issueNumber ?? ""),
        providerUrl:
          input.preflight?.issueSnapshot?.providerUrl ??
          `https://github.com/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
        issueNumber: input.payload.issueNumber ?? 0,
        commentId: "",
        labelDeltaSummary: "No label change needed.",
        assigneeDeltaSummary: "",
        responseClassification: "Success",
        reconcileStatus: "Not Needed",
        responseSummary: `Skipped GitHub issue #${input.payload.issueNumber ?? "unknown"} because all requested labels are already present.`,
      };
    }
    const response = await fetch(
      `https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}/labels`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ labels: input.preflight?.labelsToAdd ?? input.payload.labels }),
      },
    );
    const body = (await response.json()) as Array<{ name?: string }> | { message?: string };
    if (!response.ok) {
      throwGitHubExecutionFailure(response.status, (body as { message?: string }).message);
    }
    const names = Array.isArray(body)
      ? body.map((entry) => entry.name?.trim() ?? "").filter(Boolean)
      : input.preflight?.labelsToAdd ?? input.payload.labels;
    return {
      executionStatus: "Succeeded",
      providerResultKey: String(input.payload.issueNumber ?? ""),
      providerUrl: `https://github.com/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
      issueNumber: input.payload.issueNumber ?? 0,
      commentId: "",
      labelDeltaSummary: `Add labels: ${names.join(", ")}`,
      assigneeDeltaSummary: "",
      responseClassification: "Success",
      reconcileStatus: "Pending",
      responseSummary: `Added labels on GitHub issue #${input.payload.issueNumber ?? "unknown"}.`,
    };
  }

  if (input.payload.actionKey === "github.set_issue_assignees") {
    if ((input.preflight?.blockedAssigneeRemovals.length ?? 0) > 0) {
      throw new AppError(
        `Validation Failure: additive-only assignees cannot remove ${input.preflight?.blockedAssigneeRemovals.join(", ")}`,
      );
    }
    if ((input.preflight?.unassignableAssignees.length ?? 0) > 0) {
      throw new AppError(
        `Validation Failure: unassignable assignees ${input.preflight?.unassignableAssignees.join(", ")}`,
      );
    }
    if ((input.preflight?.assigneesToAdd.length ?? input.payload.assignees.length) === 0) {
      return {
        executionStatus: "Skipped",
        providerResultKey: String(input.payload.issueNumber ?? ""),
        providerUrl:
          input.preflight?.issueSnapshot?.providerUrl ??
          `https://github.com/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
        issueNumber: input.payload.issueNumber ?? 0,
        commentId: "",
        labelDeltaSummary: "",
        assigneeDeltaSummary: "No assignee change needed.",
        responseClassification: "Success",
        reconcileStatus: "Not Needed",
        responseSummary: `Skipped GitHub issue #${input.payload.issueNumber ?? "unknown"} because all requested assignees are already present.`,
      };
    }
    const response = await fetch(
      `https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}/assignees`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ assignees: input.preflight?.assigneesToAdd ?? input.payload.assignees }),
      },
    );
    const body = (await response.json()) as { assignees?: Array<{ login?: string }>; message?: string };
    if (!response.ok) {
      throwGitHubExecutionFailure(response.status, body.message);
    }
    const assignees = Array.isArray(body.assignees)
      ? body.assignees.map((entry) => entry.login?.trim() ?? "").filter(Boolean)
      : input.preflight?.assigneesToAdd ?? input.payload.assignees;
    return {
      executionStatus: "Succeeded",
      providerResultKey: String(input.payload.issueNumber ?? ""),
      providerUrl: `https://github.com/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}`,
      issueNumber: input.payload.issueNumber ?? 0,
      commentId: "",
      labelDeltaSummary: "",
      assigneeDeltaSummary: `Add assignees: ${assignees.join(", ")}`,
      responseClassification: "Success",
      reconcileStatus: "Pending",
      responseSummary: `Added assignees on GitHub issue #${input.payload.issueNumber ?? "unknown"}.`,
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${input.payload.owner}/${input.payload.repo}/issues/${input.payload.issueNumber}/comments`,
    {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        body: input.payload.body,
      }),
    },
  );
  const body = (await response.json()) as { id?: number; html_url?: string; message?: string };
  if (!response.ok) {
    throwGitHubExecutionFailure(response.status, body.message);
  }
  return {
    executionStatus: "Succeeded",
    providerResultKey: String(body.id ?? ""),
    providerUrl: body.html_url ?? "",
    issueNumber: input.payload.issueNumber ?? 0,
    commentId: String(body.id ?? ""),
    labelDeltaSummary: "",
    assigneeDeltaSummary: "",
    responseClassification: "Success",
    reconcileStatus: "Pending",
    responseSummary:
      input.payload.actionKey === "github.comment_pull_request"
        ? `Created GitHub PR comment ${body.id ?? "unknown"}.`
        : `Created GitHub issue comment ${body.id ?? "unknown"}.`,
  };
}

export async function fetchVercelRedeployPreflight(input: {
  target: ResolvedActuationTarget;
}): Promise<VercelRedeployPreflight | undefined> {
  if (input.target.provider !== "Vercel" || !input.target.projectId || !input.target.environment) {
    return undefined;
  }
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return undefined;
  }

  const deployments = await fetchVercelDeployments({
    token,
    projectId: input.target.projectId,
    environment: input.target.environment,
    limit: 1,
    state: "READY",
    teamId: input.target.teamId,
    teamSlug: input.target.teamSlug,
  });
  const latest = deployments[0];
  if (!latest) {
    return {
      targetEnvironment: input.target.environment,
      providerExercised: true,
      noRedeployCandidate: true,
    };
  }

  return {
    targetEnvironment: input.target.environment,
    providerExercised: true,
    noRedeployCandidate: false,
    latestDeployment: {
      deploymentId: String(latest.id ?? latest.uid ?? ""),
      deploymentUrl: normalizeVercelDeploymentUrl(latest.url),
      projectId: String(latest.projectId ?? input.target.projectId),
      readyState: String(latest.readyState ?? latest.state ?? latest.status ?? "unknown"),
      environment: String(latest.target ?? "production").toLowerCase().includes("preview") ? "Preview" : "Production",
      createdAt: formatVercelTimestamp(latest.createdAt ?? latest.created ?? new Date().toISOString()),
      aliasAssigned: readVercelAliasAssigned(latest),
    },
  };
}

export async function fetchVercelRollbackPreflight(input: {
  target: ResolvedActuationTarget;
}): Promise<VercelRollbackPreflight | undefined> {
  if (input.target.provider !== "Vercel" || !input.target.projectId || !input.target.environment) {
    return undefined;
  }
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return undefined;
  }

  const deployments = await fetchVercelDeployments({
    token,
    projectId: input.target.projectId,
    environment: input.target.environment,
    limit: 20,
    state: "READY",
    teamId: input.target.teamId,
    teamSlug: input.target.teamSlug,
  });
  const snapshots = deployments
    .map((deployment) => toVercelDeploymentSnapshot(deployment, input.target.projectId!, input.target.environment!))
    .filter((deployment) => deployment.readyState.toUpperCase() === "READY");
  const currentDeployment = selectCurrentVercelProductionDeployment(snapshots);
  const eligibleRollbackDeployments = await fetchVercelDeployments({
    token,
    projectId: input.target.projectId,
    environment: input.target.environment,
    limit: 20,
    state: "READY",
    rollbackCandidate: true,
    teamId: input.target.teamId,
    teamSlug: input.target.teamSlug,
  });
  const rollbackSnapshots = eligibleRollbackDeployments
    .map((deployment) => toVercelDeploymentSnapshot(deployment, input.target.projectId!, input.target.environment!))
    .filter((deployment) => deployment.readyState.toUpperCase() === "READY");
  const rollbackCandidate = selectVercelRollbackCandidate({
    currentDeployment,
    rollbackSnapshots,
    fallbackSnapshots: snapshots,
  });

  return {
    targetEnvironment: input.target.environment,
    providerExercised: true,
    noRollbackCandidate: !rollbackCandidate,
    currentDeployment,
    rollbackCandidate,
  };
}

export async function executeVercelRedeploy(input: {
  payload: VercelRedeployExecutionPayload;
}): Promise<GitHubExecutionResult> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    throw new AppError("Auth Failure: Missing VERCEL_TOKEN");
  }

  const response = await fetch(
    buildVercelApiUrl("/v13/deployments", {
      teamId: input.payload.teamId,
      slug: input.payload.teamSlug,
    }),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "notion-portfolio-actuation",
      },
      body: JSON.stringify({
        deploymentId: input.payload.deploymentId,
        name: input.payload.projectName,
        target: input.payload.targetEnvironment.toLowerCase(),
      }),
    },
  );
  const body = (await readVercelJsonResponse(response)) as Record<string, unknown> & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throwVercelExecutionFailure(response.status, resolveVercelErrorMessage(body));
  }
  const deploymentId = String(body.id ?? body.uid ?? "");
  const verification = deploymentId
    ? await verifyVercelRedeploy({
        deploymentId,
        teamId: input.payload.teamId,
        teamSlug: input.payload.teamSlug,
        token,
      })
    : undefined;
  const providerUrl = normalizeVercelDeploymentUrl(body.url) || verification?.providerUrl || input.payload.deploymentUrl;
  const reconcileStatus: GitHubReconcileStatus =
    verification?.deploymentId === deploymentId && verification?.projectId === input.payload.projectId ? "Confirmed" : "Mismatch";

  if (reconcileStatus !== "Confirmed") {
    return {
      executionStatus: "Compensation Needed",
      providerResultKey: deploymentId,
      providerUrl,
      issueNumber: 0,
      commentId: "",
      labelDeltaSummary: "",
      assigneeDeltaSummary: "",
      responseClassification: "Verification Failure",
      reconcileStatus,
      responseSummary: `Triggered Vercel redeploy for ${input.payload.projectName}, but post-action verification could not confirm the expected project deployment.`,
    };
  }

  return {
    executionStatus: "Succeeded",
    providerResultKey: deploymentId,
    providerUrl,
    issueNumber: 0,
    commentId: "",
    labelDeltaSummary: "",
    assigneeDeltaSummary: "",
    responseClassification: "Success",
    reconcileStatus,
    responseSummary: `Triggered Vercel redeploy for ${input.payload.projectName}${deploymentId ? ` via deployment ${deploymentId}` : ""}.`,
  };
}

export async function executeVercelRollback(input: {
  payload: VercelRollbackExecutionPayload;
}): Promise<GitHubExecutionResult> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    throw new AppError("Auth Failure: Missing VERCEL_TOKEN");
  }

  const response = await fetch(
    buildVercelApiUrl(
      `/v1/projects/${encodeURIComponent(input.payload.projectId)}/rollback/${encodeURIComponent(input.payload.rollbackDeploymentId)}`,
      {
        teamId: input.payload.teamId,
        slug: input.payload.teamSlug,
      },
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "notion-portfolio-actuation",
      },
    },
  );
  const body = (await readVercelJsonResponse(response)) as Record<string, unknown> & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throwVercelExecutionFailure(response.status, resolveVercelErrorMessage(body));
  }
  await updateVercelRollbackDescription({
    projectId: input.payload.projectId,
    deploymentId: input.payload.rollbackDeploymentId,
    description: input.payload.rollbackDescription,
    teamId: input.payload.teamId,
    teamSlug: input.payload.teamSlug,
    token,
  });

  const verification = await verifyVercelRollback({
    projectId: input.payload.projectId,
    rollbackDeploymentId: input.payload.rollbackDeploymentId,
    environment: input.payload.targetEnvironment,
    teamId: input.payload.teamId,
    teamSlug: input.payload.teamSlug,
    token,
  });
  const providerResultKey = formatVercelRollbackRequestKey({
    projectId: input.payload.projectId,
    deploymentId: input.payload.rollbackDeploymentId,
  });
  if (!verification.confirmed) {
    return {
      executionStatus: "Compensation Needed",
      providerResultKey,
      providerUrl: verification.providerUrl || input.payload.rollbackDeploymentUrl,
      issueNumber: 0,
      commentId: "",
      labelDeltaSummary: "",
      assigneeDeltaSummary: "",
      responseClassification: "Verification Failure",
      reconcileStatus: "Mismatch",
      responseSummary: `Triggered Vercel rollback for ${input.payload.projectName}, but production could not be confirmed on the pinned rollback target.`,
    };
  }

  return {
    executionStatus: "Succeeded",
    providerResultKey,
    providerUrl: verification.providerUrl || input.payload.rollbackDeploymentUrl,
    issueNumber: 0,
    commentId: "",
    labelDeltaSummary: "",
    assigneeDeltaSummary: "",
    responseClassification: "Success",
    reconcileStatus: "Confirmed",
    responseSummary: `Rolled back ${input.payload.projectName} to deployment ${input.payload.rollbackDeploymentId}.`,
  };
}

async function fetchGitHubIssueSnapshot(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  headers: Record<string, string>;
}): Promise<GitHubIssueSnapshot> {
  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`, {
    headers: input.headers,
  });
  const body = (await response.json()) as {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    labels?: Array<{ name?: string }>;
    assignees?: Array<{ login?: string }>;
    pull_request?: Record<string, unknown>;
    message?: string;
  };
  if (!response.ok) {
    throwGitHubExecutionFailure(response.status, body.message);
  }
  return {
    issueNumber: body.number ?? input.issueNumber,
    title: body.title?.trim() ?? "",
    body: body.body ?? "",
    labels: uniqueNormalizedStrings(Array.isArray(body.labels) ? body.labels.map((label) => label.name?.trim() ?? "") : []),
    assignees: uniqueNormalizedStrings(
      Array.isArray(body.assignees) ? body.assignees.map((assignee) => assignee.login?.trim() ?? "") : [],
    ),
    isPullRequest: Boolean(body.pull_request),
    providerUrl: body.html_url ?? `https://github.com/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
  };
}

function githubApiHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "notion-portfolio-actuation",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function hasGitHubPullRequestPermission(permissions: Record<string, string>): boolean {
  const level = permissions.pull_requests;
  return level === "read" || level === "write";
}

function throwGitHubExecutionFailure(status: number, message?: string): never {
  const classification = classifyGitHubResponse(status);
  throw new AppError(`${classification}: ${message ?? "Unknown error"}`);
}

export function classifyGitHubFailureMessage(message: string): GitHubResponseClassification {
  const known: GitHubResponseClassification[] = [
    "Validation Failure",
    "Verification Failure",
    "Permission Failure",
    "Auth Failure",
    "Not Found",
    "Rate Limited",
    "Transient Failure",
    "Duplicate Suppressed",
    "Success",
  ];
  const matched = known.find((classification) => message.startsWith(`${classification}:`));
  return matched ?? "Transient Failure";
}

export function classifyGitHubResponse(status: number): GitHubResponseClassification {
  if (status === 422) {
    return "Validation Failure";
  }
  if (status === 401) {
    return "Auth Failure";
  }
  if (status === 403) {
    return "Permission Failure";
  }
  if (status === 404) {
    return "Not Found";
  }
  if (status === 429) {
    return "Rate Limited";
  }
  if (status >= 500) {
    return "Transient Failure";
  }
  return "Transient Failure";
}

function inferTargetProviderFromRule(target: ActuationTargetRule): ActuationProviderName | undefined {
  if (target.provider) {
    return target.provider;
  }
  if (target.allowedActions.some((actionKey) => actionKey.startsWith("vercel."))) {
    return "Vercel";
  }
  if (target.allowedActions.some((actionKey) => actionKey.startsWith("github."))) {
    return "GitHub";
  }
  if (target.sourceUrl?.includes("vercel.com") || target.sourceUrl?.includes(".vercel.app")) {
    return "Vercel";
  }
  if (target.sourceUrl?.includes("github.com")) {
    return "GitHub";
  }
  return undefined;
}

function normalizeVercelEnvironment(
  value: ExternalSignalSourceRecord["environment"] | undefined,
): VercelTargetEnvironment {
  return value === "Preview" ? "Preview" : "Production";
}

function isVercelTargetRule(target: Pick<ActuationTargetRule, "provider" | "allowedActions" | "sourceUrl">): boolean {
  return (target.provider ?? inferTargetProviderFromRule(target as ActuationTargetRule)) === "Vercel";
}

function missingVercelLiveCredentials(): string[] {
  return [process.env.VERCEL_TOKEN?.trim() ? undefined : "VERCEL_TOKEN"].filter((value): value is string => Boolean(value));
}

function buildVercelApiUrl(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value?.trim()) {
      params.set(key, value);
    }
  }
  const querySuffix = params.toString();
  return `https://api.vercel.com${path}${querySuffix ? `?${querySuffix}` : ""}`;
}

function resolveVercelErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const value = body as { message?: unknown; error?: { message?: unknown } };
  if (typeof value.error?.message === "string" && value.error.message.trim()) {
    return value.error.message.trim();
  }
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  return undefined;
}

function throwVercelExecutionFailure(status: number, message?: string): never {
  const classification = classifyGitHubResponse(status);
  throw new AppError(`${classification}: ${message ?? "Unknown Vercel error"}`);
}

async function fetchVercelDeployments(input: {
  token: string;
  projectId: string;
  environment: VercelTargetEnvironment;
  limit: number;
  state?: string;
  rollbackCandidate?: boolean;
  teamId?: string;
  teamSlug?: string;
}): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(
    buildVercelApiUrl("/v6/deployments", {
      projectId: input.projectId,
      limit: String(input.limit),
      target: input.environment.toLowerCase(),
      state: input.state,
      rollbackCandidate: input.rollbackCandidate === undefined ? undefined : String(input.rollbackCandidate),
      teamId: input.teamId,
      slug: input.teamSlug,
    }),
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
        "User-Agent": "notion-portfolio-actuation",
      },
    },
  );
  const body = (await readVercelJsonResponse(response)) as
    | { deployments?: Array<Record<string, unknown>>; error?: { message?: string }; message?: string }
    | Array<Record<string, unknown>>;
  if (!response.ok) {
    throwVercelExecutionFailure(response.status, resolveVercelErrorMessage(body));
  }
  return Array.isArray(body) ? body : Array.isArray(body.deployments) ? body.deployments : [];
}

async function readVercelJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function normalizeVercelDeploymentUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  return value.startsWith("http") ? value : `https://${value}`;
}

function formatVercelTimestamp(value: unknown): string {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

function readVercelAliasAssigned(value: Record<string, unknown>): boolean {
  if (value.aliasAssigned === true) {
    return true;
  }
  if (typeof value.aliasAssigned === "number") {
    return value.aliasAssigned > 0;
  }
  if (Array.isArray(value.aliases) && value.aliases.length > 0) {
    return true;
  }
  if (Array.isArray(value.alias) && value.alias.length > 0) {
    return true;
  }
  return false;
}

function readVercelAliasAssignedAt(value: Record<string, unknown>): number | undefined {
  if (typeof value.aliasAssigned === "number" && Number.isFinite(value.aliasAssigned) && value.aliasAssigned > 0) {
    return value.aliasAssigned;
  }
  return undefined;
}

function toVercelDeploymentSnapshot(
  deployment: Record<string, unknown>,
  projectId: string,
  environment: VercelTargetEnvironment,
): VercelDeploymentSnapshot {
  return {
    deploymentId: String(deployment.id ?? deployment.uid ?? ""),
    deploymentUrl: normalizeVercelDeploymentUrl(deployment.url),
    projectId: String(deployment.projectId ?? projectId),
    readyState: String(deployment.readyState ?? deployment.state ?? deployment.status ?? "unknown"),
    environment:
      String(deployment.target ?? "production").toLowerCase().includes("preview") ? "Preview" : environment,
    createdAt: formatVercelTimestamp(deployment.createdAt ?? deployment.created ?? new Date().toISOString()),
    aliasAssigned: readVercelAliasAssigned(deployment),
    aliasAssignedAt: readVercelAliasAssignedAt(deployment),
    readySubstate: typeof deployment.readySubstate === "string" ? deployment.readySubstate : undefined,
    rollbackCandidate: deployment.isRollbackCandidate === true,
  };
}

function compareVercelDeploymentsByCreatedAt(left: VercelDeploymentSnapshot, right: VercelDeploymentSnapshot): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return right.createdAt.localeCompare(left.createdAt);
  }
  return rightTime - leftTime;
}

function selectCurrentVercelProductionDeployment(
  snapshots: VercelDeploymentSnapshot[],
): VercelDeploymentSnapshot | undefined {
  const ordered = [...snapshots].sort(compareVercelDeploymentsByCreatedAt);
  const aliasedByMostRecentAssignment = ordered
    .filter((deployment) => typeof deployment.aliasAssignedAt === "number")
    .sort((left, right) => (right.aliasAssignedAt ?? 0) - (left.aliasAssignedAt ?? 0));
  return (
    aliasedByMostRecentAssignment[0] ??
    ordered.find((deployment) => deployment.aliasAssigned) ??
    ordered.find((deployment) => deployment.readySubstate?.toUpperCase() === "PROMOTED") ??
    ordered[0]
  );
}

function selectVercelRollbackCandidate(input: {
  currentDeployment?: VercelDeploymentSnapshot;
  rollbackSnapshots: VercelDeploymentSnapshot[];
  fallbackSnapshots: VercelDeploymentSnapshot[];
}): VercelDeploymentSnapshot | undefined {
  const currentDeploymentId = input.currentDeployment?.deploymentId;
  const explicitCandidates = [...input.rollbackSnapshots]
    .sort(compareVercelDeploymentsByCreatedAt)
    .filter((deployment) => deployment.deploymentId !== currentDeploymentId);
  if (explicitCandidates.length > 0) {
    return explicitCandidates[0];
  }
  return [...input.fallbackSnapshots]
    .sort(compareVercelDeploymentsByCreatedAt)
    .find((deployment) => deployment.deploymentId !== currentDeploymentId);
}

async function verifyVercelRedeploy(input: {
  deploymentId: string;
  teamId?: string;
  teamSlug?: string;
  token: string;
}): Promise<{ deploymentId: string; providerUrl: string; projectId: string }> {
  const response = await fetch(
    buildVercelApiUrl(`/v13/deployments/${encodeURIComponent(input.deploymentId)}`, {
      teamId: input.teamId,
      slug: input.teamSlug,
    }),
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
        "User-Agent": "notion-portfolio-actuation",
      },
    },
  );
  const body = (await readVercelJsonResponse(response)) as Record<string, unknown> & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throwVercelExecutionFailure(response.status, resolveVercelErrorMessage(body));
  }
  return {
    deploymentId: String(body.id ?? body.uid ?? input.deploymentId),
    providerUrl: normalizeVercelDeploymentUrl(body.url),
    projectId: String(body.projectId ?? ""),
  };
}

async function verifyVercelRollback(input: {
  projectId: string;
  rollbackDeploymentId: string;
  environment: VercelTargetEnvironment;
  teamId?: string;
  teamSlug?: string;
  token: string;
}): Promise<{ confirmed: boolean; providerUrl: string }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const deployments = await fetchVercelDeployments({
      token: input.token,
      projectId: input.projectId,
      environment: input.environment,
      limit: 5,
      state: "READY",
      teamId: input.teamId,
      teamSlug: input.teamSlug,
    });
    const snapshots = deployments
      .map((deployment) => toVercelDeploymentSnapshot(deployment, input.projectId, input.environment))
      .filter((deployment) => deployment.readyState.toUpperCase() === "READY");
    const currentDeployment = selectCurrentVercelProductionDeployment(snapshots);
    if (currentDeployment?.deploymentId === input.rollbackDeploymentId) {
      return {
        confirmed: true,
        providerUrl: currentDeployment.deploymentUrl,
      };
    }
    if (attempt < 5) {
      await delay(2000);
    }
  }
  return {
    confirmed: false,
    providerUrl: "",
  };
}

async function updateVercelRollbackDescription(input: {
  projectId: string;
  deploymentId: string;
  description: string;
  teamId?: string;
  teamSlug?: string;
  token: string;
}): Promise<void> {
  if (!input.description.trim()) {
    return;
  }
  const response = await fetch(
    buildVercelApiUrl(
      `/v1/projects/${encodeURIComponent(input.projectId)}/rollback/${encodeURIComponent(input.deploymentId)}/update-description`,
      {
        teamId: input.teamId,
        slug: input.teamSlug,
      },
    ),
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "notion-portfolio-actuation",
      },
      body: JSON.stringify({
        description: input.description.slice(0, 250),
      }),
    },
  );
  const body = (await readVercelJsonResponse(response)) as Record<string, unknown> & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throwVercelExecutionFailure(response.status, resolveVercelErrorMessage(body));
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signJwt(payload: Record<string, unknown>, privateKeyPem: string): string {
  const header = { alg: "RS256", typ: "JWT" };
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const normalizedPrivateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(normalizedPrivateKeyPem)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

function extractGitHubRepo(source: string): [string, string] {
  const normalized = source
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/^\/+/, "")
    .trim();
  const [owner, repo] = normalized.split("/");
  if (!owner || !repo) {
    throw new AppError(`Could not resolve GitHub repo from "${source}"`);
  }
  return [owner, repo];
}

function blankDatabaseRef(name: string, destinationAlias: string): ActuationDatabaseRef {
  return {
    name,
    databaseUrl: "https://www.notion.so/00000000000000000000000000000000",
    databaseId: "00000000-0000-0000-0000-000000000000",
    dataSourceId: "00000000-0000-0000-0000-000000000000",
    destinationAlias,
  };
}

function parseStrategy<TPrimary extends "repo_config" | "notion_mcp", TFallback extends string>(
  raw: unknown,
  fieldName: string,
  expectedPrimary: TPrimary,
  expectedFallback: TFallback,
): { primary: TPrimary; fallback: TFallback; notes: string[] } {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const primary = requiredString(value.primary, `${fieldName}.primary`);
  const fallback = requiredString(value.fallback, `${fieldName}.fallback`);
  if (primary !== expectedPrimary) {
    throw new AppError(`${fieldName}.primary must be "${expectedPrimary}"`);
  }
  if (fallback !== expectedFallback) {
    throw new AppError(`${fieldName}.fallback must be "${expectedFallback}"`);
  }
  return {
    primary: primary as TPrimary,
    fallback: fallback as TFallback,
    notes: requiredStringArray(value.notes, `${fieldName}.notes`),
  };
}

function parseActuationDefaults(
  raw: unknown,
): LocalPortfolioActuationTargetConfig["defaults"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("localPortfolioActuationTargets.defaults must be an object");
  }
  const value = raw as Record<string, unknown>;
  return {
    allowedActions: requiredActionKeys(value.allowedActions, "localPortfolioActuationTargets.defaults.allowedActions"),
    titlePrefix: requiredString(value.titlePrefix, "localPortfolioActuationTargets.defaults.titlePrefix"),
    defaultLabels: requiredStringArray(value.defaultLabels, "localPortfolioActuationTargets.defaults.defaultLabels"),
    supportsIssueCreate: requiredBoolean(
      value.supportsIssueCreate,
      "localPortfolioActuationTargets.defaults.supportsIssueCreate",
    ),
    supportsPrComment: requiredBoolean(
      value.supportsPrComment,
      "localPortfolioActuationTargets.defaults.supportsPrComment",
    ),
  };
}

function parseActuationTargets(raw: unknown): ActuationTargetRule[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AppError("localPortfolioActuationTargets.targets must be an array");
  }
  return raw.map((entry, index) => parseActuationTarget(entry, `localPortfolioActuationTargets.targets[${index}]`));
}

function parseActuationTarget(raw: unknown, fieldName: string): ActuationTargetRule {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const parsed: ActuationTargetRule = {
    title: requiredString(value.title, `${fieldName}.title`),
    provider: optionalProviderName(value.provider, `${fieldName}.provider`),
    sourceIdentifier: optionalString(value.sourceIdentifier, `${fieldName}.sourceIdentifier`),
    sourceUrl: optionalString(value.sourceUrl, `${fieldName}.sourceUrl`),
    localProjectId: optionalString(value.localProjectId, `${fieldName}.localProjectId`),
    allowedActions: requiredActionKeys(value.allowedActions, `${fieldName}.allowedActions`),
    titlePrefix: optionalString(value.titlePrefix, `${fieldName}.titlePrefix`),
    defaultLabels: requiredStringArray(value.defaultLabels, `${fieldName}.defaultLabels`),
    supportsIssueCreate: requiredBoolean(value.supportsIssueCreate, `${fieldName}.supportsIssueCreate`),
    supportsPrComment: requiredBoolean(value.supportsPrComment, `${fieldName}.supportsPrComment`),
    vercelProjectId: optionalString(value.vercelProjectId, `${fieldName}.vercelProjectId`),
    vercelTeamId: optionalString(value.vercelTeamId, `${fieldName}.vercelTeamId`),
    vercelTeamSlug: optionalString(value.vercelTeamSlug, `${fieldName}.vercelTeamSlug`),
    vercelScopeType: optionalVercelScopeType(value.vercelScopeType, `${fieldName}.vercelScopeType`),
    vercelEnvironment: optionalVercelEnvironment(value.vercelEnvironment, `${fieldName}.vercelEnvironment`),
  };
  if (isVercelTargetRule(parsed)) {
    if (!parsed.localProjectId?.trim()) {
      throw new AppError(`${fieldName}.localProjectId is required for Vercel targets`);
    }
    if (!parsed.sourceIdentifier?.trim()) {
      throw new AppError(`${fieldName}.sourceIdentifier is required for Vercel targets`);
    }
    if (!parsed.vercelProjectId?.trim()) {
      throw new AppError(`${fieldName}.vercelProjectId is required for Vercel targets`);
    }
    if (parsed.sourceIdentifier.trim() !== parsed.vercelProjectId.trim()) {
      throw new AppError(`${fieldName}.sourceIdentifier must match ${fieldName}.vercelProjectId for Vercel targets`);
    }
    if (parsed.vercelScopeType === "Team" && !parsed.vercelTeamId?.trim()) {
      throw new AppError(`${fieldName}.vercelTeamId is required for Vercel targets`);
    }
    if (parsed.vercelScopeType === "Team" && !parsed.vercelTeamSlug?.trim()) {
      throw new AppError(`${fieldName}.vercelTeamSlug is required for Vercel targets`);
    }
    if (!parsed.vercelScopeType) {
      throw new AppError(`${fieldName}.vercelScopeType is required for Vercel targets`);
    }
    if (!parsed.vercelEnvironment) {
      throw new AppError(`${fieldName}.vercelEnvironment is required for Vercel targets`);
    }
  }
  return parsed;
}

function parseViewCollections(raw: unknown): ActuationViewCollection[] {
  if (!Array.isArray(raw)) {
    throw new AppError("localPortfolioActuationViews.collections must be an array");
  }
  return raw.map((entry, index) => parseViewCollection(entry, `localPortfolioActuationViews.collections[${index}]`));
}

function parseViewCollection(raw: unknown, fieldName: string): ActuationViewCollection {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const key = requiredString(value.key, `${fieldName}.key`) as ActuationViewCollection["key"];
  return {
    key,
    database: parseDatabaseRef(value.database, `${fieldName}.database`),
    views: parseViews(value.views, `${fieldName}.views`),
  };
}

function parseDatabaseRef(raw: unknown, fieldName: string): ActuationDatabaseRef {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  return {
    name: requiredString(value.name, `${fieldName}.name`),
    databaseUrl: requiredString(value.databaseUrl, `${fieldName}.databaseUrl`),
    databaseId: requiredString(value.databaseId, `${fieldName}.databaseId`),
    dataSourceId: requiredString(value.dataSourceId, `${fieldName}.dataSourceId`),
    destinationAlias: requiredString(value.destinationAlias, `${fieldName}.destinationAlias`),
  };
}

function parseViews(raw: unknown, fieldName: string): ActuationViewSpec[] {
  if (!Array.isArray(raw)) {
    throw new AppError(`${fieldName} must be an array`);
  }
  return raw.map((entry, index) => parseView(entry, `${fieldName}[${index}]`));
}

function parseView(raw: unknown, fieldName: string): ActuationViewSpec {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  return {
    name: requiredString(value.name, `${fieldName}.name`),
    viewId: optionalString(value.viewId, `${fieldName}.viewId`),
    type: requiredString(value.type, `${fieldName}.type`) as ActuationViewSpec["type"],
    purpose: requiredString(value.purpose, `${fieldName}.purpose`),
    configure: requiredString(value.configure, `${fieldName}.configure`),
  };
}

function parseGitHubActionFamilies(raw: unknown): GitHubActionFamilyPlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("localPortfolioGitHubActionFamilies.families must be a non-empty array");
  }
  return raw.map((entry, index) => parseGitHubActionFamily(entry, `localPortfolioGitHubActionFamilies.families[${index}]`));
}

function parseGitHubActionFamily(raw: unknown, fieldName: string): GitHubActionFamilyPlan {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  return {
    actionKey: requiredActionKey(value.actionKey, `${fieldName}.actionKey`),
    provider: parseStringEnum(value.provider, `${fieldName}.provider`, ["GitHub"]),
    requestTarget: parseStringEnum(value.requestTarget, `${fieldName}.requestTarget`, ["issue", "pull_request"]),
    mutationClass: parseStringEnum(value.mutationClass, `${fieldName}.mutationClass`, ["Issue", "Comment"]),
    permissionFamily: parseStringEnum(value.permissionFamily, `${fieldName}.permissionFamily`, [
      "issues_write",
      "issues_write_plus_pull_requests_read",
    ]),
    requiresTitle: requiredBoolean(value.requiresTitle, `${fieldName}.requiresTitle`),
    requiresBody: requiredBoolean(value.requiresBody, `${fieldName}.requiresBody`),
    requiresTargetNumber: requiredBoolean(value.requiresTargetNumber, `${fieldName}.requiresTargetNumber`),
    usesLabels: requiredBoolean(value.usesLabels, `${fieldName}.usesLabels`),
    usesAssignees: requiredBoolean(value.usesAssignees, `${fieldName}.usesAssignees`),
    destructive: requiredBoolean(value.destructive, `${fieldName}.destructive`) as false,
    notes: requiredString(value.notes, `${fieldName}.notes`),
  };
}

function validateViewAgainstSchema(configure: string, properties: Record<string, PropertySchema>): string[] {
  const referenced = new Set<string>();
  for (const match of configure.matchAll(/(?:FILTER|SORT BY|GROUP BY|CALENDAR BY|TIMELINE BY|MAP BY)\s+"([^"]+)"/g)) {
    referenced.add(match[1]!.trim());
  }
  for (const match of configure.matchAll(/SHOW\s+((?:"[^"]+"\s*,\s*)*"[^"]+")/g)) {
    for (const prop of match[1]!.matchAll(/"([^"]+)"/g)) {
      referenced.add(prop[1]!.trim());
    }
  }
  const uniqueReferenced = [...referenced];
  for (const propertyName of uniqueReferenced) {
    if (!properties[propertyName]) {
      throw new AppError(`View references property "${propertyName}" which is missing from the schema`);
    }
  }
  return uniqueReferenced;
}

function requiredActionKeys(value: unknown, fieldName: string): ActuationActionKey[] {
  return requiredStringArray(value, fieldName).map((entry) => requiredActionKey(entry, fieldName));
}

function requiredActionKey(value: unknown, fieldName: string): ActuationActionKey {
  const entry = typeof value === "string" ? value.trim() : "";
  if (
    entry !== "github.create_issue" &&
    entry !== "github.update_issue" &&
    entry !== "github.set_issue_labels" &&
    entry !== "github.set_issue_assignees" &&
    entry !== "github.add_issue_comment" &&
    entry !== "github.comment_pull_request" &&
    entry !== "vercel.redeploy" &&
    entry !== "vercel.rollback"
  ) {
    throw new AppError(`${fieldName} contains unsupported action key "${String(value)}"`);
  }
  return entry;
}

function optionalProviderName(value: unknown, fieldName: string): ActuationProviderName | undefined {
  const entry = optionalString(value, fieldName);
  if (!entry) {
    return undefined;
  }
  if (entry !== "GitHub" && entry !== "Vercel") {
    throw new AppError(`${fieldName} must be "GitHub" or "Vercel" when provided`);
  }
  return entry;
}

function optionalVercelScopeType(value: unknown, fieldName: string): VercelScopeType | undefined {
  const entry = optionalString(value, fieldName);
  if (!entry) {
    return undefined;
  }
  if (entry !== "Personal" && entry !== "Team") {
    throw new AppError(`${fieldName} must be "Personal" or "Team" when provided`);
  }
  return entry;
}

function optionalVercelEnvironment(value: unknown, fieldName: string): VercelTargetEnvironment | undefined {
  const entry = optionalString(value, fieldName);
  if (!entry) {
    return undefined;
  }
  if (entry !== "Production" && entry !== "Preview") {
    throw new AppError(`${fieldName} must be "Production" or "Preview" when provided`);
  }
  return entry;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, _fieldName: string): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new AppError(`${fieldName} must be an array of non-empty strings`);
  }
  return value.map((entry) => entry.trim());
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AppError(`${fieldName} must be a boolean`);
  }
  return value;
}

function parseStringEnum<TValue extends string>(
  value: unknown,
  fieldName: string,
  allowed: TValue[],
): TValue {
  const parsed = requiredString(value, fieldName) as TValue;
  if (!allowed.includes(parsed)) {
    throw new AppError(`${fieldName} must be one of ${allowed.join(", ")}`);
  }
  return parsed;
}

function hoursBetween(left: string, right: string): number {
  const leftDate = new Date(left).getTime();
  const rightDate = new Date(right).getTime();
  if (Number.isNaN(leftDate) || Number.isNaN(rightDate)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(rightDate - leftDate) / (1000 * 60 * 60);
}

function missingGitHubLiveCredentials(): string[] {
  return [
    process.env.GITHUB_APP_ID?.trim() ? undefined : "GITHUB_APP_ID",
    process.env.GITHUB_APP_PRIVATE_KEY_PEM?.trim() ? undefined : "GITHUB_APP_PRIVATE_KEY_PEM",
  ].filter((value): value is string => Boolean(value));
}

function uniqueNormalizedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
