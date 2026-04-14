import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution } from "../cli/legacy.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages, toControlTowerProjectRecord } from "./local-portfolio-control-tower-live.js";
import { loadLocalPortfolioActuationTargetConfig, type ActuationTargetRule, type VercelTargetEnvironment } from "./local-portfolio-actuation.js";
import {
  loadLocalPortfolioExternalSignalSourceConfig,
  type ExternalSignalSourceRecord,
  type ManualExternalSignalSeedPlan,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";

export const DEFAULT_LOCAL_PORTFOLIO_VERCEL_ROLLOUT_MANIFEST_PATH = "./config/local-portfolio-vercel-rollout-manifest.json";

export interface LocalPortfolioVercelRolloutProject {
  localProjectTitle: string;
  localProjectId: string;
  vercelProjectName: string;
  vercelProjectId: string;
  scopeType: "Team" | "Personal";
  environment: VercelTargetEnvironment;
  rolloutOrder: number;
  reserve: boolean;
}

export interface LocalPortfolioVercelRolloutManifest {
  version: 1;
  teamId: string;
  teamSlug: string;
  projects: LocalPortfolioVercelRolloutProject[];
}

export interface VercelRolloutProjectReadiness {
  localProjectTitle: string;
  localProjectId: string;
  vercelProjectName: string;
  vercelProjectId: string;
  reserve: boolean;
  rolloutOrder: number;
  ready: boolean;
  blockers: string[];
  hasLocalProject: boolean;
  hasSourceSeed: boolean;
  hasNotionSource: boolean;
  hasTargetRule: boolean;
  scopeMatches: boolean;
  providerExercised: boolean;
  latestDeploymentId: string;
  latestDeploymentUrl: string;
}

export interface VercelRolloutReadinessSummary {
  ok: true;
  allReady: boolean;
  readyPrimaryCount: number;
  primaryCount: number;
  reserveCount: number;
  projects: VercelRolloutProjectReadiness[];
}

interface DeploymentProbe {
  providerExercised: boolean;
  latestDeploymentId: string;
  latestDeploymentUrl: string;
  blockers: string[];
}

interface VercelDeploymentListResponse {
  deployments?: Array<Record<string, unknown>>;
  error?: { message?: string };
  message?: string;
}

export async function loadLocalPortfolioVercelRolloutManifest(
  filePath = DEFAULT_LOCAL_PORTFOLIO_VERCEL_ROLLOUT_MANIFEST_PATH,
): Promise<LocalPortfolioVercelRolloutManifest> {
  return parseLocalPortfolioVercelRolloutManifest(await readJsonFile(filePath));
}

export function parseLocalPortfolioVercelRolloutManifest(raw: unknown): LocalPortfolioVercelRolloutManifest {
  if (!raw || typeof raw !== "object") {
    throw new AppError("localPortfolioVercelRolloutManifest must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError("localPortfolioVercelRolloutManifest.version must be 1");
  }
  if (!Array.isArray(value.projects) || value.projects.length === 0) {
    throw new AppError("localPortfolioVercelRolloutManifest.projects must be a non-empty array");
  }
  const projects = value.projects.map((entry, index) => parseRolloutProject(entry, `projects[${index}]`));
  const rolloutOrders = new Set<number>();
  for (const project of projects) {
    if (rolloutOrders.has(project.rolloutOrder)) {
      throw new AppError(`localPortfolioVercelRolloutManifest.projects has duplicate rolloutOrder ${project.rolloutOrder}`);
    }
    rolloutOrders.add(project.rolloutOrder);
  }
  return {
    version: 1,
    teamId: requiredString(value.teamId, "teamId"),
    teamSlug: requiredString(value.teamSlug, "teamSlug"),
    projects,
  };
}

export function buildVercelRolloutReadinessSummary(input: {
  manifest: LocalPortfolioVercelRolloutManifest;
  existingProjectIds: string[];
  sourceSeeds: ManualExternalSignalSeedPlan[];
  notionSources: ExternalSignalSourceRecord[];
  targetRules: ActuationTargetRule[];
  deploymentProbes: Record<string, DeploymentProbe>;
}): VercelRolloutReadinessSummary {
  const projects = [...input.manifest.projects]
    .sort((left, right) => left.rolloutOrder - right.rolloutOrder)
    .map((project) => {
      const blockers: string[] = [];
      const hasLocalProject = input.existingProjectIds.includes(project.localProjectId);
      if (!hasLocalProject) {
        blockers.push("Local Portfolio project row is missing.");
      }

      const sourceSeedMatches = input.sourceSeeds.filter(
        (entry) => entry.provider === "Vercel" && entry.localProjectId === project.localProjectId && entry.identifier === project.vercelProjectId,
      );
      const sourceSeed = sourceSeedMatches[0];
      const hasSourceSeed = Boolean(sourceSeed);
      if (!sourceSeed) {
        blockers.push("Repo-owned Vercel source seed is missing.");
      } else if (sourceSeedMatches.length > 1) {
        blockers.push("Repo-owned Vercel source seed is duplicated.");
      }

      const notionSourceMatches = input.notionSources.filter(
        (source) =>
          source.provider === "Vercel" &&
          source.identifier === project.vercelProjectId &&
          source.localProjectIds.includes(project.localProjectId) &&
          source.status === "Active",
      );
      const notionSource = notionSourceMatches[0];
      const hasNotionSource = Boolean(notionSource);
      if (!notionSource) {
        blockers.push("Active Notion Vercel source row is missing.");
      } else if (notionSourceMatches.length > 1) {
        blockers.push("Active Notion Vercel source row is duplicated.");
      }

      const targetRuleMatches = input.targetRules.filter(
        (rule) =>
          rule.provider === "Vercel" &&
          rule.localProjectId === project.localProjectId &&
          rule.sourceIdentifier === project.vercelProjectId &&
          rule.vercelProjectId === project.vercelProjectId,
      );
      const targetRule = targetRuleMatches[0];
      const hasTargetRule = Boolean(targetRule);
      if (!targetRule) {
        blockers.push("Repo-owned Vercel actuation target is missing.");
      } else if (targetRuleMatches.length > 1) {
        blockers.push("Repo-owned Vercel actuation target is duplicated.");
      }

      const scopeMatches = Boolean(
        sourceSeed &&
          targetRule &&
          notionSource &&
          sourceSeed.providerScopeType === project.scopeType &&
          sourceSeed.providerScopeId === input.manifest.teamId &&
          sourceSeed.providerScopeSlug === input.manifest.teamSlug &&
          targetRule.vercelScopeType === project.scopeType &&
          targetRule.vercelTeamId === input.manifest.teamId &&
          targetRule.vercelTeamSlug === input.manifest.teamSlug &&
          targetRule.vercelEnvironment === project.environment &&
          notionSource.providerScopeType === project.scopeType &&
          notionSource.providerScopeId === input.manifest.teamId &&
          notionSource.providerScopeSlug === input.manifest.teamSlug &&
          notionSource.environment === project.environment
      );
      if (!scopeMatches) {
        blockers.push("Source and target scope metadata do not match the rollout manifest.");
      }

      const probe = input.deploymentProbes[project.vercelProjectId] ?? {
        providerExercised: false,
        latestDeploymentId: "",
        latestDeploymentUrl: "",
        blockers: ["Provider probe was not executed."],
      };
      blockers.push(...probe.blockers);

      return {
        localProjectTitle: project.localProjectTitle,
        localProjectId: project.localProjectId,
        vercelProjectName: project.vercelProjectName,
        vercelProjectId: project.vercelProjectId,
        reserve: project.reserve,
        rolloutOrder: project.rolloutOrder,
        ready: blockers.length === 0,
        blockers,
        hasLocalProject,
        hasSourceSeed,
        hasNotionSource,
        hasTargetRule,
        scopeMatches,
        providerExercised: probe.providerExercised,
        latestDeploymentId: probe.latestDeploymentId,
        latestDeploymentUrl: probe.latestDeploymentUrl,
      } satisfies VercelRolloutProjectReadiness;
    });

  const primaryProjects = projects.filter((project) => !project.reserve);
  return {
    ok: true,
    allReady: primaryProjects.every((project) => project.ready),
    readyPrimaryCount: primaryProjects.filter((project) => project.ready).length,
    primaryCount: primaryProjects.length,
    reserveCount: projects.filter((project) => project.reserve).length,
    projects,
  };
}

export interface VercelRolloutReadinessCommandOptions {
  config?: string;
  manifest?: string;
}

export async function runVercelRolloutReadinessCommand(
  options: VercelRolloutReadinessCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for the Vercel rollout readiness audit");
  const config = await loadLocalPortfolioControlTowerConfig(options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
  if (!config.phase5ExternalSignals) {
    throw new AppError("Control tower config is missing phase5ExternalSignals");
  }
  const manifest = await loadLocalPortfolioVercelRolloutManifest(options.manifest);
  const [sourceConfig, targetConfig] = await Promise.all([
    loadLocalPortfolioExternalSignalSourceConfig(),
    loadLocalPortfolioActuationTargetConfig(),
  ]);

  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);
  const [projectSchema, sourceSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
  ]);
  const [projectPages, sourcePages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
  ]);

  const deploymentProbes = Object.fromEntries(
    await Promise.all(
      manifest.projects.map(async (project) => [project.vercelProjectId, await fetchLatestDeploymentProbe({
        projectId: project.vercelProjectId,
        teamId: manifest.teamId,
        teamSlug: manifest.teamSlug,
        environment: project.environment,
      })] as const),
    ),
  );

  const summary = buildVercelRolloutReadinessSummary({
    manifest,
    existingProjectIds: projectPages.map((page) => toControlTowerProjectRecord(page).id),
    sourceSeeds: sourceConfig.manualSeeds,
    notionSources: sourcePages.map((page) => toExternalSignalSourceRecord(page)),
    targetRules: targetConfig.targets,
    deploymentProbes,
  });

  recordCommandOutputSummary(summary as unknown as Record<string, unknown>, {
    status: summary.allReady ? "completed" : "warning",
    warningCategories: summary.allReady ? undefined : ["validation_gap"],
    metadata: {
      readyPrimaryCount: summary.readyPrimaryCount,
      primaryCount: summary.primaryCount,
    },
  });
  console.log(JSON.stringify(summary, null, 2));
}

export async function fetchLatestDeploymentProbe(input: {
  projectId: string;
  teamId: string;
  teamSlug: string;
  environment: VercelTargetEnvironment;
}): Promise<DeploymentProbe> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    return {
      providerExercised: false,
      latestDeploymentId: "",
      latestDeploymentUrl: "",
      blockers: ["VERCEL_TOKEN is missing for provider verification."],
    };
  }

  try {
    const response = await fetch(buildVercelApiUrl("/v6/deployments", {
      projectId: input.projectId,
      limit: "1",
      target: input.environment.toLowerCase(),
      teamId: input.teamId,
      slug: input.teamSlug,
    }), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "notion-vercel-rollout-readiness",
      },
    });
    const body = (await response.json()) as VercelDeploymentListResponse;
    if (!response.ok) {
      return {
        providerExercised: true,
        latestDeploymentId: "",
        latestDeploymentUrl: "",
        blockers: [`Vercel readiness probe failed: ${resolveVercelErrorMessage(body) ?? `HTTP ${response.status}`}.`],
      };
    }
    const latest = Array.isArray(body.deployments) ? body.deployments[0] : undefined;
    if (!latest) {
      return {
        providerExercised: true,
        latestDeploymentId: "",
        latestDeploymentUrl: "",
        blockers: ["No latest production deployment is available to redeploy."],
      };
    }
    const readyState = typeof latest.readyState === "string" ? latest.readyState.trim().toUpperCase() : "";
    if (readyState !== "READY") {
      return {
        providerExercised: true,
        latestDeploymentId: String(latest.id ?? latest.uid ?? ""),
        latestDeploymentUrl: normalizeVercelDeploymentUrl(latest.url),
        blockers: [
          `Latest ${input.environment.toLowerCase()} deployment is not ready yet (state: ${readyState || "unknown"}).`,
        ],
      };
    }
    return {
      providerExercised: true,
      latestDeploymentId: String(latest.id ?? latest.uid ?? ""),
      latestDeploymentUrl: normalizeVercelDeploymentUrl(latest.url),
      blockers: [],
    };
  } catch (error) {
    return {
      providerExercised: true,
      latestDeploymentId: "",
      latestDeploymentUrl: "",
      blockers: [`Vercel readiness probe failed: ${toErrorMessage(error)}.`],
    };
  }
}

function buildVercelApiUrl(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value?.trim()) {
      params.set(key, value);
    }
  }
  return `https://api.vercel.com${path}?${params.toString()}`;
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

function normalizeVercelDeploymentUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  return value.startsWith("http") ? value : `https://${value}`;
}

function parseRolloutProject(raw: unknown, fieldName: string): LocalPortfolioVercelRolloutProject {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }
  const value = raw as Record<string, unknown>;
  const scopeType = requiredString(value.scopeType, `${fieldName}.scopeType`);
  const environment = requiredString(value.environment, `${fieldName}.environment`);
  if (scopeType !== "Team" && scopeType !== "Personal") {
    throw new AppError(`${fieldName}.scopeType must be Team or Personal`);
  }
  if (environment !== "Production" && environment !== "Preview") {
    throw new AppError(`${fieldName}.environment must be Production or Preview`);
  }
  return {
    localProjectTitle: requiredString(value.localProjectTitle, `${fieldName}.localProjectTitle`),
    localProjectId: requiredString(value.localProjectId, `${fieldName}.localProjectId`),
    vercelProjectName: requiredString(value.vercelProjectName, `${fieldName}.vercelProjectName`),
    vercelProjectId: requiredString(value.vercelProjectId, `${fieldName}.vercelProjectId`),
    scopeType,
    environment,
    rolloutOrder: requiredPositiveInteger(value.rolloutOrder, `${fieldName}.rolloutOrder`),
    reserve: requiredBoolean(value.reserve, `${fieldName}.reserve`),
  };
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AppError(`${fieldName} must be a boolean`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`);
  }
  return value;
}

async function main(): Promise<void> {
  await runVercelRolloutReadinessCommand();
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((error) => {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  });
}
