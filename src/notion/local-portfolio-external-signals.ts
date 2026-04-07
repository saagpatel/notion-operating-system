import { loadRuntimeConfig } from "../config/runtime-config.js";
import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import { losAngelesToday } from "../utils/date.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";
import type { IntelligenceProjectRecord } from "./local-portfolio-intelligence.js";
import type { WorkPacketRecord } from "./local-portfolio-execution.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";

export const DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH =
  "./config/local-portfolio-external-signal-sources.json";
export const DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_VIEWS_PATH =
  "./config/local-portfolio-external-signal-views.json";
export const DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_PROVIDERS_PATH =
  "./config/local-portfolio-external-signal-providers.json";

export type ExternalProviderKey = "github" | "vercel" | "google_calendar";
export type ExternalSignalCoverage = "None" | "Repo Only" | "Repo + Deploy" | "Calendar Only" | "Mixed";
export type LatestDeploymentStatus =
  | "Success"
  | "Failed"
  | "Building"
  | "Canceled"
  | "Unknown"
  | "Not Deployed";
export type ExternalSourceStatus = "Active" | "Paused" | "Needs Mapping" | "Needs Review";
export type ExternalSignalSeverity = "Info" | "Watch" | "Risk";
export type ExternalSignalProviderName = "GitHub" | "Vercel" | "Google Calendar" | "Netlify" | "Render" | "Cloudflare";
export type ExternalSourceType = "Repo" | "Deployment Project" | "Calendar";
export type ExternalSignalType =
  | "Pull Request"
  | "Workflow Run"
  | "Deployment"
  | "Release"
  | "Calendar Block"
  | "Issue"
  | "Issue Comment";
export type ExternalSignalSyncStatus = "Started" | "Succeeded" | "Partial" | "Failed";

export interface ExternalSignalDatabaseRef {
  name: string;
  databaseUrl: string;
  databaseId: string;
  dataSourceId: string;
  destinationAlias: string;
}

export interface ExternalSignalSourceSeedTemplate {
  provider: ExternalSignalProviderName;
  sourceType: ExternalSourceType;
  titleSuffix: string;
  defaultStatus: ExternalSourceStatus;
  defaultEnvironment: "Production" | "Preview" | "N/A";
  defaultSyncStrategy: "Poll" | "Incremental";
}

export interface ManualExternalSignalSeedPlan {
  title: string;
  localProjectId: string;
  provider: ExternalSignalProviderName;
  sourceType: ExternalSourceType;
  status: ExternalSourceStatus;
  environment: "Production" | "Preview" | "N/A";
  syncStrategy: "Poll" | "Incremental";
  identifier?: string;
  sourceUrl?: string;
}

export interface LocalPortfolioExternalSignalSourceConfig {
  version: 1;
  strategy: {
    primary: "direct_rest";
    fallback: "manual_review";
    notes: string[];
  };
  seedRules: {
    targetQueues: string[];
    includePacketPriorities: string[];
    limit: number;
  };
  sourceTemplates: ExternalSignalSourceSeedTemplate[];
  manualSeeds: ManualExternalSignalSeedPlan[];
}

export interface ExternalSignalProviderPlan {
  key: ExternalProviderKey;
  displayName: string;
  enabled: boolean;
  authEnvVar: string;
  baseUrl: string;
  syncStrategy: "poll" | "incremental";
  sourceTypes: ExternalSourceType[];
  notes: string[];
}

export interface LocalPortfolioExternalSignalProviderConfig {
  version: 1;
  providers: ExternalSignalProviderPlan[];
}

export interface ExternalSignalViewSpec {
  name: string;
  viewId?: string;
  type: "table" | "board" | "gallery";
  purpose: string;
  configure: string;
}

export interface ExternalSignalViewCollection {
  key: "sources" | "events" | "syncRuns" | "projects";
  database: ExternalSignalDatabaseRef;
  views: ExternalSignalViewSpec[];
}

export interface LocalPortfolioExternalSignalViewPlan {
  version: 1;
  strategy: {
    primary: "notion_mcp";
    fallback: "playwright";
    notes: string[];
  };
  collections: ExternalSignalViewCollection[];
}

export interface ExternalSignalSourceRecord {
  id: string;
  url: string;
  title: string;
  localProjectIds: string[];
  provider: ExternalSignalProviderName;
  sourceType: ExternalSourceType;
  identifier: string;
  sourceUrl: string;
  status: ExternalSourceStatus;
  environment: "Production" | "Preview" | "N/A";
  syncStrategy: "Poll" | "Incremental";
  lastSyncedAt: string;
}

export function getPrimarySourceProjectId(source: ExternalSignalSourceRecord): string | undefined {
  const projectId = source.localProjectIds.find((value) => value.trim().length > 0);
  return projectId?.trim();
}

export interface ExternalSignalEventRecord {
  id: string;
  url: string;
  title: string;
  localProjectIds: string[];
  sourceIds: string[];
  provider: ExternalSignalProviderName;
  signalType: ExternalSignalType;
  occurredAt: string;
  status: string;
  environment: "Production" | "Preview" | "N/A";
  severity: ExternalSignalSeverity;
  sourceIdValue: string;
  sourceUrl: string;
  syncRunIds: string[];
  eventKey: string;
  summary: string;
  rawExcerpt: string;
}

export interface ExternalSignalSyncRunRecord {
  id: string;
  url: string;
  title: string;
  provider: ExternalSignalProviderName;
  status: ExternalSignalSyncStatus;
  startedAt: string;
  completedAt: string;
  scope: string;
  itemsSeen: number;
  itemsWritten: number;
  itemsDeduped: number;
  failures: number;
  cursor: string;
  notes: string;
}

export interface ExternalSignalSummary {
  projectId: string;
  coverage: ExternalSignalCoverage;
  latestExternalActivity: string;
  latestDeploymentStatus: LatestDeploymentStatus;
  openPrCount: number;
  recentFailedWorkflowRuns: number;
  externalSignalUpdated: string;
  mappedSources: ExternalSignalSourceRecord[];
  activeSources: ExternalSignalSourceRecord[];
  recentEvents: ExternalSignalEventRecord[];
  repoActivityFreshness: number;
  workflowHealth: number;
  deploymentHealth: number;
  externalCoverageScore: number;
  contradictionScore: number;
  contradictionLabel: "Reinforces" | "Contradicts" | "Insufficient Coverage";
}

export interface ExternalRecommendationAdjustments {
  resumeBoost: number;
  finishBoost: number;
  investigateBoost: number;
  deferBoost: number;
}

export interface ExternalSignalSeedPlan {
  title: string;
  localProjectId: string;
  provider: ExternalSignalProviderName;
  sourceType: ExternalSourceType;
  status: ExternalSourceStatus;
  environment: "Production" | "Preview" | "N/A";
  syncStrategy: "Poll" | "Incremental";
  identifier?: string;
  sourceUrl?: string;
}

export interface ExternalSignalCommandCenterInput {
  summaries: ExternalSignalSummary[];
  syncRuns: ExternalSignalSyncRunRecord[];
  projects: IntelligenceProjectRecord[];
}

export interface ExternalSignalSyncMetrics {
  mappedProjects: number;
  projectsNeedingMapping: number;
  activeSources: number;
  riskEvents: number;
  successfulDeployments: number;
  failedWorkflowRuns: number;
  contradictionProjects: number;
}

export function requirePhase5ExternalSignals(
  config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase5ExternalSignals"]> {
  if (!config.phase5ExternalSignals) {
    throw new AppError("Control tower config is missing phase5ExternalSignals");
  }

  return config.phase5ExternalSignals;
}

export async function loadLocalPortfolioExternalSignalSourceConfig(
  filePath = loadRuntimeConfig().paths.externalSignalSourcesPath,
): Promise<LocalPortfolioExternalSignalSourceConfig> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioExternalSignalSourceConfig(raw);
}

export async function loadLocalPortfolioExternalSignalProviderConfig(
  filePath = loadRuntimeConfig().paths.externalSignalProvidersPath,
): Promise<LocalPortfolioExternalSignalProviderConfig> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioExternalSignalProviderConfig(raw);
}

export async function loadLocalPortfolioExternalSignalViewPlan(
  filePath = loadRuntimeConfig().paths.externalSignalViewsPath,
): Promise<LocalPortfolioExternalSignalViewPlan> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioExternalSignalViewPlan(raw);
}

export function parseLocalPortfolioExternalSignalSourceConfig(
  raw: unknown,
): LocalPortfolioExternalSignalSourceConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio external signal source config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio external signal source config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    strategy: parseSourceStrategy(value.strategy),
    seedRules: parseSeedRules(value.seedRules),
    sourceTemplates: parseSourceTemplates(value.sourceTemplates),
    manualSeeds: parseManualSeeds(value.manualSeeds),
  };
}

export function parseLocalPortfolioExternalSignalProviderConfig(
  raw: unknown,
): LocalPortfolioExternalSignalProviderConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio external signal provider config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio external signal provider config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    providers: parseProviderPlans(value.providers),
  };
}

export function parseLocalPortfolioExternalSignalViewPlan(
  raw: unknown,
): LocalPortfolioExternalSignalViewPlan {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio external signal views config must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio external signal views config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    strategy: parseViewStrategy(value.strategy),
    collections: parseViewCollections(value.collections),
  };
}

export function buildExternalSignalSummary(input: {
  project: IntelligenceProjectRecord;
  sources: ExternalSignalSourceRecord[];
  events: ExternalSignalEventRecord[];
  today: string;
}): ExternalSignalSummary {
  const mappedSources = input.sources
    .filter((source) => source.localProjectIds.includes(input.project.id))
    .sort(compareMappedSources);
  const activeSources = mappedSources.filter((source) => source.status === "Active");
  const recentEvents = input.events
    .filter((event) => event.localProjectIds.includes(input.project.id))
    .sort(compareRecentSignalEvents)
    .slice(0, 25);

  const hasRepo = activeSources.some((source) => source.sourceType === "Repo");
  const hasDeployment = activeSources.some((source) => source.sourceType === "Deployment Project");
  const hasCalendar = activeSources.some((source) => source.sourceType === "Calendar");

  const coverage = deriveExternalCoverage({ hasRepo, hasDeployment, hasCalendar, mappedSources });
  const latestExternalActivity = recentEvents[0]?.occurredAt ?? "";
  const latestDeployment = recentEvents.find((event) => event.signalType === "Deployment");
  const latestDeploymentStatus = deriveLatestDeploymentStatus(latestDeployment?.status, hasDeployment);
  const openPrCount = recentEvents.filter(
    (event) =>
      event.signalType === "Pull Request" &&
      ["open", "draft", "ready_for_review"].includes(event.status.toLowerCase()),
  ).length;
  const recentFailedWorkflowRuns = recentEvents.filter(
    (event) =>
      event.signalType === "Workflow Run" &&
      isFailureStatus(event.status) &&
      diffDays(event.occurredAt, input.today) <= 14,
  ).length;
  const repoActivityFreshness = calculateRepoActivityFreshness(recentEvents, hasRepo, input.today);
  const workflowHealth = calculateWorkflowHealth(recentEvents, hasRepo, input.today);
  const deploymentHealth = calculateDeploymentHealth(recentEvents, hasDeployment, input.today);
  const externalCoverageScore = coverageScore(coverage, activeSources.length);
  const contradictionScore = calculateContradictionScore({
    project: input.project,
    recentFailedWorkflowRuns,
    latestDeploymentStatus,
    repoActivityFreshness,
    coverage,
  });

  return {
    projectId: input.project.id,
    coverage,
    latestExternalActivity,
    latestDeploymentStatus,
    openPrCount,
    recentFailedWorkflowRuns,
    externalSignalUpdated: latestExternalActivity || newestDate(activeSources.map((source) => source.lastSyncedAt)),
    mappedSources,
    activeSources,
    recentEvents,
    repoActivityFreshness,
    workflowHealth,
    deploymentHealth,
    externalCoverageScore,
    contradictionScore,
    contradictionLabel:
      coverage === "None"
        ? "Insufficient Coverage"
        : contradictionScore >= 55
          ? "Contradicts"
          : repoActivityFreshness >= 60 || deploymentHealth >= 70
            ? "Reinforces"
            : "Insufficient Coverage",
  };
}

export function buildExternalRecommendationAdjustments(
  project: IntelligenceProjectRecord,
  summary?: ExternalSignalSummary,
): ExternalRecommendationAdjustments {
  if (!summary || summary.coverage === "None") {
    return {
      resumeBoost: 0,
      finishBoost: 0,
      investigateBoost: 0,
      deferBoost: 0,
    };
  }

  const coverageBoost = summary.externalCoverageScore * 0.05;
  const resumeBoost = roundScore(
    summary.repoActivityFreshness * 0.08 + summary.workflowHealth * 0.07 + coverageBoost,
  );
  const finishBoost = roundScore(
    summary.deploymentHealth * 0.12 + summary.workflowHealth * 0.08 + coverageBoost,
  );
  const investigateBoost = roundScore(
    summary.contradictionScore * 0.18 +
      (summary.latestDeploymentStatus === "Failed" ? 6 : 0) +
      (summary.recentFailedWorkflowRuns > 0 ? 6 : 0),
  );
  const inactivityPenalty = roundScore((100 - summary.repoActivityFreshness) * 0.1 + coverageBoost);
  const deferBoost = roundScore(
    inactivityPenalty +
      (summary.latestDeploymentStatus === "Failed" ? 4 : 0) +
      (project.operatingQueue === "Cold Storage" ? 6 : 0),
  );

  return {
    resumeBoost,
    finishBoost,
    investigateBoost,
    deferBoost,
  };
}

export function buildExternalSignalSeedPlans(input: {
  projects: IntelligenceProjectRecord[];
  packets: WorkPacketRecord[];
  sourceConfig: LocalPortfolioExternalSignalSourceConfig;
}): ExternalSignalSeedPlan[] {
  const selectedProjects = selectPriorityProjectsForExternalSignals({
    projects: input.projects,
    packets: input.packets,
    limit: input.sourceConfig.seedRules.limit,
    includePacketPriorities: input.sourceConfig.seedRules.includePacketPriorities,
    targetQueues: input.sourceConfig.seedRules.targetQueues,
  });

  const generatedSeeds = selectedProjects.flatMap((project) =>
    input.sourceConfig.sourceTemplates.map((template) => ({
      title: `${project.title} - ${template.titleSuffix}`,
      localProjectId: project.id,
      provider: template.provider,
      sourceType: template.sourceType,
      status: template.defaultStatus,
      environment: template.defaultEnvironment,
      syncStrategy: template.defaultSyncStrategy,
    })),
  );

  const seenSeedKeys = new Set<string>();
  return [...input.sourceConfig.manualSeeds, ...generatedSeeds].filter((plan) => {
    const key = [
      plan.localProjectId.trim().toLowerCase(),
      plan.provider.trim().toLowerCase(),
      plan.sourceType.trim().toLowerCase(),
    ].join("::");
    if (seenSeedKeys.has(key)) {
      return false;
    }
    seenSeedKeys.add(key);
    return true;
  });
}

export function selectPriorityProjectsForExternalSignals(input: {
  projects: IntelligenceProjectRecord[];
  packets: WorkPacketRecord[];
  targetQueues: string[];
  includePacketPriorities: string[];
  limit: number;
}): IntelligenceProjectRecord[] {
  const packetPrioritySet = new Set(input.includePacketPriorities);
  const packetProjectIds = new Set(
    input.packets
      .filter((packet) => packetPrioritySet.has(packet.priority))
      .flatMap((packet) => packet.localProjectIds),
  );

  return [...input.projects]
    .filter(
      (project) =>
        input.targetQueues.includes(project.operatingQueue ?? "") || packetProjectIds.has(project.id),
    )
    .sort((left, right) => {
      const leftPacketPriority = packetProjectIds.has(left.id) ? 1 : 0;
      const rightPacketPriority = packetProjectIds.has(right.id) ? 1 : 0;
      if (leftPacketPriority !== rightPacketPriority) {
        return rightPacketPriority - leftPacketPriority;
      }

      const queueRank =
        input.targetQueues.indexOf(left.operatingQueue ?? "") - input.targetQueues.indexOf(right.operatingQueue ?? "");
      if (queueRank !== 0) {
        return queueRank;
      }

      return (right.lastActive || "").localeCompare(left.lastActive || "");
    })
    .slice(0, input.limit);
}

export function renderExternalSignalBriefSection(input: {
  summary: ExternalSignalSummary;
}): string {
  const recentEvents = [...input.summary.recentEvents]
    .sort(compareRecentSignalEvents)
    .slice(0, 5);
  const mappedSources = [...input.summary.mappedSources].sort(compareMappedSources);

  return [
    "<!-- codex:notion-external-signal-brief:start -->",
    "## External Signal Brief",
    "",
    `- Coverage: ${input.summary.coverage}`,
    `- Latest external activity: ${input.summary.latestExternalActivity || "No external activity yet"}`,
    `- Latest deployment status: ${input.summary.latestDeploymentStatus}`,
    `- Open pull requests: ${input.summary.openPrCount}`,
    `- Recent failed workflow runs: ${input.summary.recentFailedWorkflowRuns}`,
    `- External posture: ${input.summary.contradictionLabel}`,
    "",
    "### Mapped Sources",
    ...(mappedSources.length > 0
      ? mappedSources.map((source) =>
          `- [${source.title}](${source.url}) - ${source.provider} / ${source.status}${source.identifier ? ` / ${source.identifier}` : ""}`,
        )
      : ["- No external sources mapped yet."]),
    "",
    "### Recent Signals",
    ...(recentEvents.length > 0
      ? recentEvents.map((event) => `- [${event.title}](${event.url}) - ${event.signalType} / ${event.status} / ${event.occurredAt}`)
      : ["- No external events captured yet."]),
    "",
    "### Coverage Gaps",
    ...(input.summary.coverage === "None"
      ? ["- This project still needs real repo or deployment mappings before telemetry can inform recommendations."]
      : input.summary.activeSources.length === 0
        ? ["- Sources are mapped but not yet active for live polling."]
        : ["- Coverage is active; focus next on improving signal quality rather than adding more empty mappings."]),
    "",
    "### Recommendation Impact",
    ...renderRecommendationImpact(input.summary),
    "<!-- codex:notion-external-signal-brief:end -->",
  ].join("\n");
}

export function renderExternalSignalCommandCenterSection(input: ExternalSignalCommandCenterInput): string {
  const contradictionProjects = input.summaries.filter((summary) => summary.contradictionLabel === "Contradicts").slice(0, 5);
  const projectsNeedingMapping = input.summaries
    .filter((summary) => summary.coverage === "None")
    .map((summary) => input.projects.find((project) => project.id === summary.projectId)?.title ?? "Unknown project")
    .slice(0, 8);
  const recentHealthyDeploys = input.summaries
    .filter((summary) => summary.latestDeploymentStatus === "Success")
    .sort((left, right) => right.latestExternalActivity.localeCompare(left.latestExternalActivity))
    .slice(0, 5);
  const recentWorkflowFailures = input.summaries
    .filter((summary) => summary.recentFailedWorkflowRuns > 0)
    .sort((left, right) => right.recentFailedWorkflowRuns - left.recentFailedWorkflowRuns)
    .slice(0, 5);
  const latestRun = [...input.syncRuns].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];

  return [
    "<!-- codex:notion-external-signal-command-center:start -->",
    "## Phase 5 External Signals",
    "",
    `- Projects with telemetry coverage: ${input.summaries.filter((summary) => summary.coverage !== "None").length}`,
    `- Projects needing mapping: ${projectsNeedingMapping.length}`,
    `- Recent healthy deploys: ${recentHealthyDeploys.length}`,
    `- Recent workflow failures: ${recentWorkflowFailures.length}`,
    `- Recommendation contradictions: ${contradictionProjects.length}`,
    `- Latest sync run: ${latestRun ? `[${latestRun.title}](${latestRun.url})` : "None yet"}`,
    "",
    "### Projects Needing Mapping",
    ...(projectsNeedingMapping.length > 0
      ? projectsNeedingMapping.map((title) => `- ${title}`)
      : ["- No priority projects currently need mapping."]),
    "",
    "### Recent Healthy Deploys",
    ...(recentHealthyDeploys.length > 0
      ? recentHealthyDeploys.map((summary) => `- ${projectTitle(input.projects, summary.projectId)} - ${summary.latestExternalActivity}`)
      : ["- No successful deployments captured yet."]),
    "",
    "### Recent Workflow Failures",
    ...(recentWorkflowFailures.length > 0
      ? recentWorkflowFailures.map(
          (summary) => `- ${projectTitle(input.projects, summary.projectId)} - ${summary.recentFailedWorkflowRuns} recent failed runs`,
        )
      : ["- No recent workflow failures captured yet."]),
    "",
    "### Contradictions To Review",
    ...(contradictionProjects.length > 0
      ? contradictionProjects.map(
          (summary) =>
            `- ${projectTitle(input.projects, summary.projectId)} - external signals are contradicting the optimistic Notion posture`,
        )
      : ["- No strong contradictions between Notion state and telemetry yet."]),
    "<!-- codex:notion-external-signal-command-center:end -->",
  ].join("\n");
}

export function renderWeeklyExternalSignalsSection(input: {
  summaries: ExternalSignalSummary[];
  syncRuns: ExternalSignalSyncRunRecord[];
}): string {
  const contradictions = input.summaries
    .filter((summary) => summary.contradictionLabel === "Contradicts")
    .sort(compareContradictionSummaries)
    .slice(0, 5);
  const wins = input.summaries
    .filter((summary) => summary.latestDeploymentStatus === "Success")
    .sort(compareWins)
    .slice(0, 5);
  const failures = input.summaries
    .filter((summary) => summary.recentFailedWorkflowRuns > 0)
    .sort(compareFailures)
    .slice(0, 5);
  const latestSyncRuns = [...input.syncRuns]
    .sort(compareSyncRuns)
    .slice(0, 5);

  return [
    "<!-- codex:notion-weekly-external-signals:start -->",
    "## Phase 5 External Signal Summary",
    "",
    "### Telemetry-Confirmed Wins",
    ...(wins.length > 0
      ? wins.map((summary) => `- ${summary.projectId} has a recent successful deployment signal.`)
      : ["- No telemetry-confirmed wins captured yet."]),
    "",
    "### Workflow Or Deployment Regressions",
    ...(failures.length > 0
      ? failures.map((summary) => `- ${summary.projectId} has ${summary.recentFailedWorkflowRuns} recent failed workflow runs.`)
      : ["- No workflow or deployment regressions captured yet."]),
    "",
    "### Coverage Gaps",
    ...(input.summaries.filter((summary) => summary.coverage === "None").length > 0
      ? input.summaries
          .filter((summary) => summary.coverage === "None")
          .slice(0, 5)
          .map((summary) => `- ${summary.projectId} still needs real external-source mappings.`)
      : ["- No major coverage gaps remain in the current priority slice."]),
    "",
    "### Recommendation Contradictions",
    ...(contradictions.length > 0
      ? contradictions.map((summary) => `- ${summary.projectId} should be re-reviewed because telemetry contradicts the current Notion posture.`)
      : ["- External telemetry is not strongly contradicting the current portfolio posture yet."]),
    "",
    "### Latest Sync Runs",
    ...(latestSyncRuns.length > 0
      ? latestSyncRuns.map((run) => `- [${run.title}](${run.url}) - ${run.status}`)
      : ["- No sync runs yet."]),
    "<!-- codex:notion-weekly-external-signals:end -->",
  ].join("\n");
}

function compareMappedSources(left: ExternalSignalSourceRecord, right: ExternalSignalSourceRecord): number {
  return (
    compareDescending(left.provider, right.provider) ||
    compareDescending(left.status, right.status) ||
    compareDescending(left.title, right.title) ||
    compareDescending(left.id, right.id)
  );
}

function compareRecentSignalEvents(left: ExternalSignalEventRecord, right: ExternalSignalEventRecord): number {
  return (
    compareDescending(left.occurredAt, right.occurredAt) ||
    compareDescending(left.signalType, right.signalType) ||
    compareDescending(left.status, right.status) ||
    compareDescending(left.title, right.title) ||
    compareDescending(left.id, right.id)
  );
}

function compareWins(left: ExternalSignalSummary, right: ExternalSignalSummary): number {
  return (
    compareDescending(left.latestExternalActivity, right.latestExternalActivity) ||
    compareDescending(left.projectId, right.projectId)
  );
}

function compareFailures(left: ExternalSignalSummary, right: ExternalSignalSummary): number {
  return (
    right.recentFailedWorkflowRuns - left.recentFailedWorkflowRuns ||
    compareDescending(left.projectId, right.projectId)
  );
}

function compareContradictionSummaries(left: ExternalSignalSummary, right: ExternalSignalSummary): number {
  return (
    compareDescending(left.latestExternalActivity, right.latestExternalActivity) ||
    compareDescending(left.projectId, right.projectId)
  );
}

function compareSyncRuns(left: ExternalSignalSyncRunRecord, right: ExternalSignalSyncRunRecord): number {
  return (
    compareDescending(left.startedAt, right.startedAt) ||
    compareDescending(left.url, right.url) ||
    compareDescending(left.id, right.id)
  );
}

function compareDescending(left: string, right: string): number {
  return right.localeCompare(left);
}

export function calculateExternalSignalMetrics(input: {
  summaries: ExternalSignalSummary[];
}): ExternalSignalSyncMetrics {
  return {
    mappedProjects: input.summaries.filter((summary) => summary.coverage !== "None").length,
    projectsNeedingMapping: input.summaries.filter((summary) => summary.coverage === "None").length,
    activeSources: input.summaries.reduce((sum, summary) => sum + summary.activeSources.length, 0),
    riskEvents: input.summaries.reduce(
      (sum, summary) => sum + summary.recentEvents.filter((event) => event.severity === "Risk").length,
      0,
    ),
    successfulDeployments: input.summaries.filter((summary) => summary.latestDeploymentStatus === "Success").length,
    failedWorkflowRuns: input.summaries.reduce((sum, summary) => sum + summary.recentFailedWorkflowRuns, 0),
    contradictionProjects: input.summaries.filter((summary) => summary.contradictionLabel === "Contradicts").length,
  };
}

export function validateLocalPortfolioExternalSignalViewPlanAgainstSchemas(input: {
  plan: LocalPortfolioExternalSignalViewPlan;
  schemas: Record<ExternalSignalViewCollection["key"], DataSourceSchemaSnapshot>;
}): { validatedViews: Array<{ collection: string; name: string; type: string; referencedProperties: string[] }> } {
  const validatedViews: Array<{ collection: string; name: string; type: string; referencedProperties: string[] }> =
    [];

  for (const collection of input.plan.collections) {
    const schema = input.schemas[collection.key];
    if (!schema) {
      throw new AppError(`Missing schema for external signal view collection "${collection.key}"`);
    }

    if (schema.id !== collection.database.dataSourceId) {
      throw new AppError(
        `External signal collection "${collection.key}" points at "${collection.database.dataSourceId}" but schema came from "${schema.id}"`,
      );
    }

    for (const view of collection.views) {
      const referencedProperties = validateViewAgainstSchema(view, schema);
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

export function buildEventKey(parts: string[]): string {
  return parts
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join("::");
}

export function normalizeProviderKey(value: ExternalSignalProviderName | ExternalProviderKey): ExternalProviderKey {
  switch (value) {
    case "GitHub":
    case "github":
      return "github";
    case "Vercel":
    case "vercel":
      return "vercel";
    case "Google Calendar":
    case "google_calendar":
      return "google_calendar";
    default:
      throw new AppError(`Unsupported external provider "${value}"`);
  }
}

function parseSourceStrategy(
  raw: unknown,
): LocalPortfolioExternalSignalSourceConfig["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("External signal source config is missing strategy");
  }
  const value = raw as Record<string, unknown>;
  if (value.primary !== "direct_rest" || value.fallback !== "manual_review") {
    throw new AppError("External signal source config strategy must be direct_rest/manual_review");
  }
  return {
    primary: "direct_rest",
    fallback: "manual_review",
    notes: requiredStringArray(value.notes, "externalSignalSources.strategy.notes"),
  };
}

function parseSeedRules(
  raw: unknown,
): LocalPortfolioExternalSignalSourceConfig["seedRules"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("External signal source config is missing seedRules");
  }
  const value = raw as Record<string, unknown>;
  return {
    targetQueues: requiredStringArray(value.targetQueues, "externalSignalSources.seedRules.targetQueues"),
    includePacketPriorities: requiredStringArray(
      value.includePacketPriorities,
      "externalSignalSources.seedRules.includePacketPriorities",
    ),
    limit: requiredPositiveNumber(value.limit, "externalSignalSources.seedRules.limit"),
  };
}

function parseSourceTemplates(
  raw: unknown,
): ExternalSignalSourceSeedTemplate[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("External signal source config must include sourceTemplates");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`externalSignalSources.sourceTemplates[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    return {
      provider: parseProviderName(requiredString(value.provider, `sourceTemplates[${index}].provider`)),
      sourceType: parseSourceType(requiredString(value.sourceType, `sourceTemplates[${index}].sourceType`)),
      titleSuffix: requiredString(value.titleSuffix, `sourceTemplates[${index}].titleSuffix`),
      defaultStatus: parseSourceStatus(requiredString(value.defaultStatus, `sourceTemplates[${index}].defaultStatus`)),
      defaultEnvironment: parseEnvironment(
        requiredString(value.defaultEnvironment, `sourceTemplates[${index}].defaultEnvironment`),
      ),
      defaultSyncStrategy: parseSyncStrategy(
        requiredString(value.defaultSyncStrategy, `sourceTemplates[${index}].defaultSyncStrategy`),
      ),
    };
  });
}

function parseManualSeeds(raw: unknown): ManualExternalSignalSeedPlan[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AppError("External signal source config manualSeeds must be an array");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`externalSignalSources.manualSeeds[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    return {
      title: requiredString(value.title, `manualSeeds[${index}].title`),
      localProjectId: requiredString(value.localProjectId, `manualSeeds[${index}].localProjectId`),
      provider: parseProviderName(requiredString(value.provider, `manualSeeds[${index}].provider`)),
      sourceType: parseSourceType(requiredString(value.sourceType, `manualSeeds[${index}].sourceType`)),
      status: parseSourceStatus(requiredString(value.status, `manualSeeds[${index}].status`)),
      environment: parseEnvironment(requiredString(value.environment, `manualSeeds[${index}].environment`)),
      syncStrategy: parseSyncStrategy(requiredString(value.syncStrategy, `manualSeeds[${index}].syncStrategy`)),
      identifier: optionalString(value.identifier),
      sourceUrl: optionalString(value.sourceUrl),
    };
  });
}

function parseProviderPlans(
  raw: unknown,
): ExternalSignalProviderPlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("External signal provider config must include providers");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`externalSignalProviders.providers[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    return {
      key: parseProviderKey(requiredString(value.key, `providers[${index}].key`)),
      displayName: requiredString(value.displayName, `providers[${index}].displayName`),
      enabled: requiredBoolean(value.enabled, `providers[${index}].enabled`),
      authEnvVar: requiredString(value.authEnvVar, `providers[${index}].authEnvVar`),
      baseUrl: requiredString(value.baseUrl, `providers[${index}].baseUrl`),
      syncStrategy: parseProviderSyncStrategy(requiredString(value.syncStrategy, `providers[${index}].syncStrategy`)),
      sourceTypes: parseProviderSourceTypes(value.sourceTypes, `providers[${index}].sourceTypes`),
      notes: requiredStringArray(value.notes, `providers[${index}].notes`),
    };
  });
}

function parseViewStrategy(
  raw: unknown,
): LocalPortfolioExternalSignalViewPlan["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("External signal views config is missing strategy");
  }
  const value = raw as Record<string, unknown>;
  if (value.primary !== "notion_mcp" || value.fallback !== "playwright") {
    throw new AppError("External signal views config strategy must be notion_mcp/playwright");
  }

  return {
    primary: "notion_mcp",
    fallback: "playwright",
    notes: requiredStringArray(value.notes, "externalSignalViews.strategy.notes"),
  };
}

function parseViewCollections(
  raw: unknown,
): ExternalSignalViewCollection[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("External signal views config must include collections");
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`externalSignalViews.collections[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    const key = requiredString(value.key, `externalSignalViews.collections[${index}].key`);
    if (key !== "sources" && key !== "events" && key !== "syncRuns" && key !== "projects") {
      throw new AppError(
        `externalSignalViews.collections[${index}].key must be sources, events, syncRuns, or projects`,
      );
    }

    return {
      key,
      database: parseExternalSignalDatabaseRef(value.database, `externalSignalViews.collections[${index}].database`),
      views: parseExternalSignalViews(value.views, `externalSignalViews.collections[${index}].views`),
    };
  });
}

function parseExternalSignalDatabaseRef(
  raw: unknown,
  fieldName: string,
): ExternalSignalDatabaseRef {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const databaseUrl = requiredString(value.databaseUrl, `${fieldName}.databaseUrl`);
  const databaseId = normalizeRequiredNotionId(requiredString(value.databaseId, `${fieldName}.databaseId`), `${fieldName}.databaseId`);
  const extractedId = extractNotionIdFromUrl(databaseUrl);
  if (!extractedId || normalizeNotionId(extractedId) !== databaseId) {
    throw new AppError(`${fieldName}.databaseId does not match ${fieldName}.databaseUrl`);
  }

  return {
    name: requiredString(value.name, `${fieldName}.name`),
    databaseUrl,
    databaseId,
    dataSourceId: normalizeRequiredNotionId(requiredString(value.dataSourceId, `${fieldName}.dataSourceId`), `${fieldName}.dataSourceId`),
    destinationAlias: requiredString(value.destinationAlias, `${fieldName}.destinationAlias`),
  };
}

function parseExternalSignalViews(raw: unknown, fieldName: string): ExternalSignalViewSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(`${fieldName} must include at least one view`);
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`${fieldName}[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    const type = requiredString(value.type, `${fieldName}[${index}].type`);
    if (type !== "table" && type !== "board" && type !== "gallery") {
      throw new AppError(`${fieldName}[${index}].type must be table, board, or gallery`);
    }
    return {
      name: requiredString(value.name, `${fieldName}[${index}].name`),
      viewId: optionalNotionId(value.viewId, `${fieldName}[${index}].viewId`),
      type,
      purpose: requiredString(value.purpose, `${fieldName}[${index}].purpose`),
      configure: requiredString(value.configure, `${fieldName}[${index}].configure`),
    };
  });
}

function validateViewAgainstSchema(view: ExternalSignalViewSpec, schema: DataSourceSchemaSnapshot): string[] {
  const referencedProperties = new Set<string>();

  for (const statement of view.configure.split(";").map((part) => part.trim()).filter(Boolean)) {
    if (statement.startsWith("SHOW ")) {
      for (const propertyName of Array.from(statement.matchAll(/"([^"]+)"/g), (match) => match[1] ?? "")) {
        const property = assertPropertyExists(schema, view.name, propertyName);
        referencedProperties.add(property.name);
      }
      continue;
    }

    if (statement.startsWith("SORT BY ")) {
      const match = statement.match(/^SORT BY "([^"]+)" (ASC|DESC)$/);
      if (!match?.[1]) {
        throw new AppError(`View "${view.name}" has an unsupported SORT BY statement: ${statement}`);
      }
      assertPropertyExists(schema, view.name, match[1]);
      referencedProperties.add(match[1]);
      continue;
    }

    if (statement.startsWith("FILTER ")) {
      const match = statement.match(/^FILTER "([^"]+)" = ("[^"]+"|true|false)$/);
      if (!match?.[1]) {
        throw new AppError(`View "${view.name}" has an unsupported FILTER statement: ${statement}`);
      }
      const property = assertPropertyExists(schema, view.name, match[1]);
      if (!FILTERABLE_TYPES.has(property.type)) {
        throw new AppError(
          `View "${view.name}" uses property "${property.name}" for filtering, but its type is "${property.type}"`,
        );
      }
      referencedProperties.add(match[1]);
      continue;
    }

    throw new AppError(`View "${view.name}" has an unsupported configure statement: ${statement}`);
  }

  return [...referencedProperties];
}

function deriveExternalCoverage(input: {
  hasRepo: boolean;
  hasDeployment: boolean;
  hasCalendar: boolean;
  mappedSources: ExternalSignalSourceRecord[];
}): ExternalSignalCoverage {
  if (input.mappedSources.length === 0) {
    return "None";
  }
  if (input.hasRepo && input.hasDeployment) {
    return "Repo + Deploy";
  }
  if (input.hasRepo && !input.hasDeployment && !input.hasCalendar) {
    return "Repo Only";
  }
  if (input.hasCalendar && !input.hasRepo && !input.hasDeployment) {
    return "Calendar Only";
  }
  return "Mixed";
}

function coverageScore(coverage: ExternalSignalCoverage, activeSources: number): number {
  switch (coverage) {
    case "Repo + Deploy":
      return 90 + Math.min(activeSources, 2) * 5;
    case "Repo Only":
      return 55;
    case "Calendar Only":
      return 35;
    case "Mixed":
      return 70;
    default:
      return 0;
  }
}

function deriveLatestDeploymentStatus(
  status: string | undefined,
  hasDeploymentCoverage: boolean,
): LatestDeploymentStatus {
  if (!hasDeploymentCoverage) {
    return "Not Deployed";
  }
  const normalized = (status ?? "").toLowerCase();
  if (["ready", "success", "succeeded"].includes(normalized)) {
    return "Success";
  }
  if (["failed", "error", "failure"].includes(normalized)) {
    return "Failed";
  }
  if (["building", "queued", "in_progress"].includes(normalized)) {
    return "Building";
  }
  if (["canceled", "cancelled"].includes(normalized)) {
    return "Canceled";
  }
  return "Unknown";
}

function calculateRepoActivityFreshness(
  recentEvents: ExternalSignalEventRecord[],
  hasRepoCoverage: boolean,
  today: string,
): number {
  if (!hasRepoCoverage) {
    return 0;
  }
  const latestRepoEvent = recentEvents.find((event) => event.provider === "GitHub");
  if (!latestRepoEvent?.occurredAt) {
    return 35;
  }
  const age = diffDays(latestRepoEvent.occurredAt, today);
  if (age <= 3) {
    return 100;
  }
  if (age <= 7) {
    return 82;
  }
  if (age <= 14) {
    return 64;
  }
  if (age <= 30) {
    return 38;
  }
  return 12;
}

function calculateWorkflowHealth(
  recentEvents: ExternalSignalEventRecord[],
  hasRepoCoverage: boolean,
  today: string,
): number {
  if (!hasRepoCoverage) {
    return 0;
  }
  const workflowEvents = recentEvents.filter((event) => event.signalType === "Workflow Run");
  if (workflowEvents.length === 0) {
    return 55;
  }
  const recentFailures = workflowEvents.filter(
    (event) => isFailureStatus(event.status) && diffDays(event.occurredAt, today) <= 14,
  ).length;
  const latest = workflowEvents[0];
  if (recentFailures === 0 && latest && !isFailureStatus(latest.status)) {
    return 92;
  }
  return clamp(88 - recentFailures * 22 - (latest && isFailureStatus(latest.status) ? 18 : 0));
}

function calculateDeploymentHealth(
  recentEvents: ExternalSignalEventRecord[],
  hasDeploymentCoverage: boolean,
  today: string,
): number {
  if (!hasDeploymentCoverage) {
    return 0;
  }
  const deploymentEvents = recentEvents.filter((event) => event.signalType === "Deployment");
  if (deploymentEvents.length === 0) {
    return 45;
  }
  const latest = deploymentEvents[0];
  if (!latest) {
    return 45;
  }
  const age = diffDays(latest.occurredAt, today);
  const freshness = age <= 7 ? 18 : age <= 21 ? 10 : 0;

  if (["ready", "success", "succeeded"].includes(latest.status.toLowerCase())) {
    return clamp(82 + freshness);
  }
  if (["building", "queued", "in_progress"].includes(latest.status.toLowerCase())) {
    return clamp(58 + freshness);
  }
  if (["failed", "error", "failure"].includes(latest.status.toLowerCase())) {
    return 16;
  }
  if (["canceled", "cancelled"].includes(latest.status.toLowerCase())) {
    return 28;
  }
  return 42;
}

function calculateContradictionScore(input: {
  project: IntelligenceProjectRecord;
  recentFailedWorkflowRuns: number;
  latestDeploymentStatus: LatestDeploymentStatus;
  repoActivityFreshness: number;
  coverage: ExternalSignalCoverage;
}): number {
  if (input.coverage === "None") {
    return 0;
  }
  const optimisticNotionState =
    input.project.operatingQueue === "Resume Now" ||
    input.project.operatingQueue === "Worth Finishing" ||
    input.project.shipReadiness === "Near Ship" ||
    input.project.shipReadiness === "Ready to Demo";
  if (!optimisticNotionState) {
    return 0;
  }

  return clamp(
    input.recentFailedWorkflowRuns * 25 +
      (input.latestDeploymentStatus === "Failed" ? 35 : 0) +
      (input.repoActivityFreshness <= 20 ? 18 : 0),
  );
}

function renderRecommendationImpact(summary: ExternalSignalSummary): string[] {
  if (summary.coverage === "None") {
    return ["- External telemetry is not active yet, so recommendations still rely on Notion-native signals only."];
  }
  if (summary.contradictionLabel === "Contradicts") {
    return ["- External telemetry is contradicting the optimistic Notion posture and should increase review urgency."];
  }
  if (summary.latestDeploymentStatus === "Success" || summary.repoActivityFreshness >= 60) {
    return ["- External telemetry is reinforcing the active recommendation with fresh repo or deployment evidence."];
  }
  return ["- External telemetry is additive but not yet strong enough to materially change the recommendation."];
}

function projectTitle(projects: IntelligenceProjectRecord[], projectId: string): string {
  return projects.find((project) => project.id === projectId)?.title ?? projectId;
}

function parseProviderName(value: string): ExternalSignalProviderName {
  if (
    value !== "GitHub" &&
    value !== "Vercel" &&
    value !== "Google Calendar" &&
    value !== "Netlify" &&
    value !== "Render" &&
    value !== "Cloudflare"
  ) {
    throw new AppError(`Unsupported external signal provider name "${value}"`);
  }
  return value;
}

function parseProviderKey(value: string): ExternalProviderKey {
  if (value !== "github" && value !== "vercel" && value !== "google_calendar") {
    throw new AppError(`Unsupported external provider key "${value}"`);
  }
  return value;
}

function parseProviderSyncStrategy(value: string): "poll" | "incremental" {
  if (value !== "poll" && value !== "incremental") {
    throw new AppError(`Unsupported provider sync strategy "${value}"`);
  }
  return value;
}

function parseProviderSourceTypes(value: unknown, fieldName: string): ExternalSourceType[] {
  const types = requiredStringArray(value, fieldName);
  return types.map((entry) => parseSourceType(entry));
}

function parseSourceType(value: string): ExternalSourceType {
  if (value !== "Repo" && value !== "Deployment Project" && value !== "Calendar") {
    throw new AppError(`Unsupported external source type "${value}"`);
  }
  return value;
}

function parseSourceStatus(value: string): ExternalSourceStatus {
  if (value !== "Active" && value !== "Paused" && value !== "Needs Mapping" && value !== "Needs Review") {
    throw new AppError(`Unsupported external source status "${value}"`);
  }
  return value;
}

function parseEnvironment(value: string): "Production" | "Preview" | "N/A" {
  if (value !== "Production" && value !== "Preview" && value !== "N/A") {
    throw new AppError(`Unsupported environment "${value}"`);
  }
  return value;
}

function parseSyncStrategy(value: string): "Poll" | "Incremental" {
  if (value !== "Poll" && value !== "Incremental") {
    throw new AppError(`Unsupported sync strategy "${value}"`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppError("Expected optional string value");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertPropertyExists(
  schema: DataSourceSchemaSnapshot,
  viewName: string,
  propertyName: string,
): PropertySchema {
  const property = schema.properties[propertyName];
  if (!property) {
    throw new AppError(`View "${viewName}" references missing property "${propertyName}"`);
  }
  return property;
}

function newestDate(values: string[]): string {
  return values.filter(Boolean).sort().slice(-1)[0] ?? "";
}

function diffDays(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate) {
    return Number.POSITIVE_INFINITY;
  }
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function isFailureStatus(value: string): boolean {
  return ["failed", "failure", "error", "timed_out", "cancelled", "canceled"].includes(value.toLowerCase());
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(15, Math.round(value)));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new AppError(`${fieldName} must be a string array`);
  }
  return value.map((entry) => entry.trim());
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AppError(`${fieldName} must be a positive number`);
  }
  return value;
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AppError(`${fieldName} must be a boolean`);
  }
  return value;
}

function optionalNotionId(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string when provided`);
  }
  const extracted = extractNotionIdFromUrl(value.trim());
  if (!extracted) {
    throw new AppError(`${fieldName} must be a valid Notion ID or URL`);
  }
  return normalizeNotionId(extracted);
}

function normalizeRequiredNotionId(value: string, fieldName: string): string {
  const extracted = extractNotionIdFromUrl(value);
  if (!extracted) {
    throw new AppError(`${fieldName} must be a valid Notion ID or URL`);
  }
  return normalizeNotionId(extracted);
}

const FILTERABLE_TYPES = new Set([
  "title",
  "rich_text",
  "select",
  "status",
  "checkbox",
  "date",
  "number",
]);

export function defaultSyncRunScope(provider: ExternalSignalProviderName, sourceCount: number): string {
  return `${provider} priority sync across ${sourceCount} mapped source${sourceCount === 1 ? "" : "s"}`;
}

export function providerCredentialPresent(provider: ExternalSignalProviderPlan): boolean {
  return Boolean(process.env[provider.authEnvVar]?.trim());
}

export function currentTelemetryDate(): string {
  return losAngelesToday();
}
