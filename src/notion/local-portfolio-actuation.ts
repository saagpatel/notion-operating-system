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
export type ActuationActionKey =
  | "github.create_issue"
  | "github.update_issue"
  | "github.set_issue_labels"
  | "github.set_issue_assignees"
  | "github.add_issue_comment"
  | "github.comment_pull_request";

export const SUPPORTED_GITHUB_ACTION_KEYS: ActuationActionKey[] = [
  "github.create_issue",
  "github.update_issue",
  "github.set_issue_labels",
  "github.set_issue_assignees",
  "github.add_issue_comment",
  "github.comment_pull_request",
];

export interface ActuationDatabaseRef {
  name: string;
  databaseUrl: string;
  databaseId: string;
  dataSourceId: string;
  destinationAlias: string;
}

export interface ActuationTargetRule {
  title: string;
  sourceIdentifier?: string;
  sourceUrl?: string;
  localProjectId?: string;
  allowedActions: ActuationActionKey[];
  titlePrefix?: string;
  defaultLabels: string[];
  supportsIssueCreate: boolean;
  supportsPrComment: boolean;
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
  liveCapablePolicies: string[];
  allowlistedTargets: number;
  issueReadyTargets: number;
  commentReadyTargets: number;
  issueLifecycleReadyTargets: number;
  supportedActionKeys: ActuationActionKey[];
  blockedRequests: string[];
}

export interface ResolvedActuationTarget {
  source: ExternalSignalSourceRecord;
  rule: ActuationTargetRule;
  owner: string;
  repo: string;
}

export interface GitHubExecutionPayload {
  actionKey: ActuationActionKey;
  owner: string;
  repo: string;
  title?: string;
  body?: string;
  issueNumber?: number;
  labels: string[];
  assignees: string[];
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

export type GitHubResponseClassification =
  | "Success"
  | "Validation Failure"
  | "Permission Failure"
  | "Auth Failure"
  | "Not Found"
  | "Rate Limited"
  | "Transient Failure"
  | "Duplicate Suppressed";

export type GitHubReconcileStatus = "Not Needed" | "Pending" | "Confirmed" | "Mismatch";

export interface GitHubExecutionResult {
  executionStatus: Extract<ActuationStatus, "Succeeded" | "Skipped">;
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

  const liveCapablePolicies = input.policyConfig.policies
    .filter((policy) => policy.provider === "GitHub" && policy.executionMode === "Approved Live")
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

  return {
    missingGitHubAuthRefs,
    missingGitHubWebhookRefs,
    liveCapablePolicies,
    allowlistedTargets: input.targetConfig.targets.length,
    issueReadyTargets,
    commentReadyTargets,
    issueLifecycleReadyTargets,
    supportedActionKeys,
    blockedRequests: [],
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
  if (linkedSource.provider !== "GitHub" || linkedSource.sourceType !== "Repo" || linkedSource.status !== "Active") {
    throw new AppError(`Target source "${linkedSource.title}" is not an active GitHub repo source.`);
  }

  const matchingRule =
    input.targetConfig.targets.find((target) =>
      (target.sourceIdentifier && target.sourceIdentifier === linkedSource.identifier) ||
      (target.sourceUrl && target.sourceUrl === linkedSource.sourceUrl) ||
      (target.localProjectId && input.request.localProjectIds.includes(target.localProjectId)),
    ) ?? {
      title: linkedSource.title,
      sourceIdentifier: linkedSource.identifier,
      sourceUrl: linkedSource.sourceUrl,
      allowedActions: input.targetConfig.defaults.allowedActions,
      titlePrefix: input.targetConfig.defaults.titlePrefix,
      defaultLabels: input.targetConfig.defaults.defaultLabels,
      supportsIssueCreate: input.targetConfig.defaults.supportsIssueCreate,
      supportsPrComment: input.targetConfig.defaults.supportsPrComment,
    };

  if (!matchingRule.allowedActions.includes(input.actionKey)) {
    throw new AppError(`Target "${linkedSource.title}" is not allowlisted for ${input.actionKey}.`);
  }

  const repoSource = linkedSource.identifier || linkedSource.sourceUrl;
  const [owner, repo] = extractGitHubRepo(repoSource);
  return {
    source: linkedSource,
    rule: matchingRule,
    owner,
    repo,
  };
}

export function buildGitHubExecutionPayload(input: {
  request: ActionRequestRecord;
  target: ResolvedActuationTarget;
  actionKey: ActuationActionKey;
}): GitHubExecutionPayload {
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

export function computeActuationExecutionKey(input: {
  requestId: string;
  actionKey: string;
  targetSourceId: string;
  mode: ActuationMode;
  payload: GitHubExecutionPayload;
}): string {
  const normalized = JSON.stringify({
    requestId: input.requestId,
    actionKey: input.actionKey,
    targetSourceId: input.targetSourceId,
    mode: input.mode,
    owner: input.payload.owner,
    repo: input.payload.repo,
    title: input.payload.title ?? null,
    body: input.payload.body ?? null,
    issueNumber: input.payload.issueNumber ?? null,
    labels: [...input.payload.labels].sort(),
    assignees: [...input.payload.assignees].sort(),
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
  payload: GitHubExecutionPayload | null;
  target: ResolvedActuationTarget | null;
  preflight?: GitHubActionPreflight;
  latestExecution?: ExternalActionExecutionRecord;
  validationNotes: string[];
  idempotencyKey?: string;
}): string {
  const preflightNotes =
    input.payload && input.preflight
      ? describeGitHubActionPreflight({
          actionKey: input.payload.actionKey,
          preflight: input.preflight,
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
    ...(input.preflight
      ? [
          `- Current target type: ${input.preflight.issueSnapshot?.isPullRequest ? "Pull request" : input.payload?.issueNumber ? "Issue" : "New issue"}`,
          `- Current labels: ${input.preflight.issueSnapshot?.labels.join(", ") || "None"}`,
          `- Current assignees: ${input.preflight.issueSnapshot?.assignees.join(", ") || "None"}`,
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
    "## Phase 8 GitHub Lane",
    "",
    `- Ready to dry run: ${readyToDryRun.length}`,
    `- Approved for live: ${readyForLive.length}`,
    `- Recent live successes: ${recentSuccesses.length}`,
    `- Failures or compensation-needed: ${failures.length}`,
    "- Phase 8 safety posture: additive-only labels and assignees, serial writes, no destructive GitHub mutations.",
    "- Temporary tunnel note: if webhook delivery fails, redeliver from GitHub and then drain/reconcile locally.",
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
    "## Phase 8 GitHub Summary",
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

export function evaluateActionRequestReadiness(input: {
  request: ActionRequestRecord;
  policies: ActionPolicyRecord[];
  target?: ResolvedActuationTarget;
  config: LocalPortfolioControlTowerConfig;
  latestDryRun?: ExternalActionExecutionRecord;
  actionKey: ActuationActionKey;
  preflight?: GitHubActionPreflight;
  today: string;
}): string[] {
  const notes: string[] = [];
  const phase7 = requirePhase7Actuation(input.config);
  const policy = input.policies.find((entry) => input.request.policyIds.includes(entry.id));
  if (!policy) {
    notes.push("Missing linked policy.");
  }
  if (phase7.liveGating.requireApproval && input.request.status !== "Approved") {
    notes.push("Request is not approved.");
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
  if (input.actionKey === "github.set_issue_labels" && (input.preflight?.blockedLabelRemovals.length ?? 0) > 0) {
    notes.push(
      `Phase 8 additive-only labels cannot remove existing labels: ${input.preflight?.blockedLabelRemovals.join(", ")}.`,
    );
  }
  if (input.actionKey === "github.set_issue_assignees" && (input.preflight?.blockedAssigneeRemovals.length ?? 0) > 0) {
    notes.push(
      `Phase 8 additive-only assignees cannot remove existing assignees: ${input.preflight?.blockedAssigneeRemovals.join(", ")}.`,
    );
  }
  if (input.actionKey === "github.set_issue_assignees" && (input.preflight?.unassignableAssignees.length ?? 0) > 0) {
    notes.push(`These assignees are not assignable in GitHub: ${input.preflight?.unassignableAssignees.join(", ")}.`);
  }
  if (input.actionKey === "github.comment_pull_request" && input.preflight?.issueSnapshot && !input.preflight.issueSnapshot.isPullRequest) {
    notes.push("Target pull request number resolves to an issue instead of a pull request.");
  }
  if (input.actionKey === "github.comment_pull_request" && input.preflight?.missingPullRequestPermission) {
    notes.push("GitHub App is missing pull request permission required for PR comments.");
  }
  if (!input.target) {
    notes.push("Target GitHub source is not resolved.");
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
    const missingCredentials = missingGitHubLiveCredentials();
    if (missingCredentials.length > 0) {
      notes.push(`Live GitHub credentials are missing: ${missingCredentials.join(", ")}.`);
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
  preflight?: GitHubActionPreflight;
}): { executionIntent: ActionRequestRecord["executionIntent"]; notes: string[]; latestExecutionStatus: ActionRequestRecord["latestExecutionStatus"] } {
  if (input.preflightNotes.length > 0) {
    return {
      executionIntent: "Dry Run",
      notes: input.preflightNotes,
      latestExecutionStatus: "Problem",
    };
  }

  const liveNotes = evaluateActionRequestReadiness({
    request: {
      ...input.request,
      executionIntent: "Ready for Live",
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
      provider: "GitHub",
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
    };
  }

  const preflightNotes = describeGitHubActionPreflight({
    actionKey: input.actionKey,
    preflight: input.preflight,
  });

  return {
    executionIntent: "Ready for Live",
    notes:
      preflightNotes.length > 0
        ? [`Dry run passed and is ready for live execution. ${preflightNotes.join(" ")}`]
        : ["Dry run passed and is ready for live execution."],
    latestExecutionStatus: "Dry Run Passed",
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
  return {
    title: requiredString(value.title, `${fieldName}.title`),
    sourceIdentifier: optionalString(value.sourceIdentifier, `${fieldName}.sourceIdentifier`),
    sourceUrl: optionalString(value.sourceUrl, `${fieldName}.sourceUrl`),
    localProjectId: optionalString(value.localProjectId, `${fieldName}.localProjectId`),
    allowedActions: requiredActionKeys(value.allowedActions, `${fieldName}.allowedActions`),
    titlePrefix: optionalString(value.titlePrefix, `${fieldName}.titlePrefix`),
    defaultLabels: requiredStringArray(value.defaultLabels, `${fieldName}.defaultLabels`),
    supportsIssueCreate: requiredBoolean(value.supportsIssueCreate, `${fieldName}.supportsIssueCreate`),
    supportsPrComment: requiredBoolean(value.supportsPrComment, `${fieldName}.supportsPrComment`),
  };
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
    entry !== "github.comment_pull_request"
  ) {
    throw new AppError(`${fieldName} contains unsupported action key "${String(value)}"`);
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
