import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { buildImplicitWorkspaceProfile, resolveWorkspaceProfile, type WorkspaceProfile } from "./profiles.js";
import { AppError } from "../utils/errors.js";

export const DEFAULT_NOTION_VERSION = "2026-03-11";

const OPTIONAL_ADVANCED_ENV_VARS = [
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
  "GOOGLE_CALENDAR_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY_PEM",
  "GITHUB_APP_WEBHOOK_SECRET",
  "VERCEL_WEBHOOK_SECRET",
  "GITHUB_BREAK_GLASS_TOKEN",
  "VERCEL_BREAK_GLASS_TOKEN",
] as const;

const optionalStringSchema = z.preprocess(normalizeOptionalString, z.string().min(1).optional());
const defaultStringSchema = (fallback: string) =>
  z.preprocess(normalizeOptionalString, z.string().min(1).optional()).default(fallback);
const positiveIntSchema = (fallback: number) =>
  z.preprocess(normalizeOptionalString, z.coerce.number().int().positive().optional()).default(fallback);

const runtimeEnvSchema = z.object({
  NOTION_PROFILE: optionalStringSchema,
  NOTION_TOKEN: optionalStringSchema,
  NOTION_LOG_DIR: defaultStringSchema("./logs"),
  NOTION_DESTINATIONS_PATH: optionalStringSchema,
  NOTION_RETRY_MAX_ATTEMPTS: positiveIntSchema(5),
  NOTION_HTTP_TIMEOUT_MS: positiveIntSchema(90_000),
  GITHUB_TOKEN: optionalStringSchema,
  VERCEL_TOKEN: optionalStringSchema,
  GOOGLE_CALENDAR_TOKEN: optionalStringSchema,
  GITHUB_APP_ID: optionalStringSchema,
  GITHUB_APP_PRIVATE_KEY_PEM: optionalStringSchema,
  GITHUB_APP_WEBHOOK_SECRET: optionalStringSchema,
  VERCEL_WEBHOOK_SECRET: optionalStringSchema,
  GITHUB_BREAK_GLASS_TOKEN: optionalStringSchema,
  VERCEL_BREAK_GLASS_TOKEN: optionalStringSchema,
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

export interface RuntimeConfig {
  cwd: string;
  profile: {
    configVersion: number;
    sourceConfigVersion: number;
    name: string;
    label: string;
    kind: "primary" | "sandbox";
    implicit: boolean;
    registryPath?: string;
    descriptorPath?: string;
  };
  notion: {
    token?: string;
    version: string;
    retryMaxAttempts: number;
    httpTimeoutMs: number;
  };
  paths: {
    envFile: string;
    logDir: string;
    destinationsPath: string;
    controlTowerConfigPath: string;
    profileConfigDir: string;
    localPortfolioViewsPath: string;
    executionViewsPath: string;
    intelligenceViewsPath: string;
    externalSignalSourcesPath: string;
    externalSignalProvidersPath: string;
    externalSignalViewsPath: string;
    governancePoliciesPath: string;
    webhookProvidersPath: string;
    governanceViewsPath: string;
    actuationTargetsPath: string;
    actuationViewsPath: string;
    githubActionFamiliesPath: string;
    githubViewsPath: string;
    nativeDashboardsPath: string;
    nativeAutomationsPath: string;
    nativePilotsPath: string;
  };
  optionalCredentials: {
    present: string[];
    missing: string[];
  };
}

interface RuntimeConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  profile?: string;
  hydrateEnvFile?: boolean;
}

type RuntimeConfigParseResult =
  | { success: true; config: RuntimeConfig }
  | { success: false; config: RuntimeConfig; issues: string[] };

export function loadRuntimeConfig(options: RuntimeConfigOptions = {}): RuntimeConfig {
  const result = safeLoadRuntimeConfig(options);
  if (result.success) {
    return result.config;
  }

  throw new AppError(`Invalid runtime configuration: ${result.issues.join("; ")}`);
}

export function safeLoadRuntimeConfig(options: RuntimeConfigOptions = {}): RuntimeConfigParseResult {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourceEnv = options.env ?? process.env;
  const env = { ...sourceEnv };
  const shouldOverrideInheritedEnv =
    options.env === undefined || options.env === process.env;
  let profile: WorkspaceProfile;
  const profileIssues: string[] = [];

  try {
    profile = resolveWorkspaceProfile({
      cwd,
      env,
      profileName: options.profile,
    });
  } catch (error) {
    profile = buildImplicitWorkspaceProfile(cwd);
    profileIssues.push(`profile: ${toIssueMessage(error)}`);
  }

  if (options.hydrateEnvFile !== false) {
    hydrateEnv(env, profile.envFile, {
      overrideExisting: shouldOverrideInheritedEnv,
    });
  }
  const parsed = runtimeEnvSchema.safeParse(env);

  if (!parsed.success) {
    return {
      success: false,
      config: buildFallbackRuntimeConfig(cwd, env, profile),
      issues: [
        ...profileIssues,
        ...parsed.error.issues.map((issue) => {
          const joinedPath = issue.path.join(".");
          return joinedPath ? `${joinedPath}: ${issue.message}` : issue.message;
        }),
      ],
    };
  }

  if (profileIssues.length > 0) {
    return {
      success: false,
      config: buildRuntimeConfig(parsed.data, cwd, profile),
      issues: profileIssues,
    };
  }

  return {
    success: true,
    config: buildRuntimeConfig(parsed.data, cwd, profile),
  };
}

export function requireNotionToken(message = "NOTION_TOKEN is required", options: RuntimeConfigOptions = {}): string {
  const token = loadRuntimeConfig(options).notion.token?.trim();
  if (!token) {
    throw new AppError(message);
  }

  return token;
}

function buildRuntimeConfig(env: RuntimeEnv, cwd: string, profile: WorkspaceProfile): RuntimeConfig {
  return {
    cwd,
    profile: {
      configVersion: profile.configVersion,
      sourceConfigVersion: profile.sourceConfigVersion,
      name: profile.name,
      label: profile.label,
      kind: profile.kind,
      implicit: profile.implicit,
      registryPath: profile.registryPath,
      descriptorPath: profile.descriptorPath,
    },
    notion: {
      token: env.NOTION_TOKEN,
      version: DEFAULT_NOTION_VERSION,
      retryMaxAttempts: env.NOTION_RETRY_MAX_ATTEMPTS,
      httpTimeoutMs: env.NOTION_HTTP_TIMEOUT_MS,
    },
    paths: {
      envFile: profile.envFile,
      logDir: path.resolve(cwd, env.NOTION_LOG_DIR),
      destinationsPath: path.resolve(cwd, env.NOTION_DESTINATIONS_PATH ?? profile.destinationsPath),
      controlTowerConfigPath: profile.controlTowerConfigPath,
      profileConfigDir: profile.ownedPaths.profileConfigDir,
      localPortfolioViewsPath: profile.ownedPaths.localPortfolioViewsPath,
      executionViewsPath: profile.ownedPaths.executionViewsPath,
      intelligenceViewsPath: profile.ownedPaths.intelligenceViewsPath,
      externalSignalSourcesPath: profile.ownedPaths.externalSignalSourcesPath,
      externalSignalProvidersPath: profile.ownedPaths.externalSignalProvidersPath,
      externalSignalViewsPath: profile.ownedPaths.externalSignalViewsPath,
      governancePoliciesPath: profile.ownedPaths.governancePoliciesPath,
      webhookProvidersPath: profile.ownedPaths.webhookProvidersPath,
      governanceViewsPath: profile.ownedPaths.governanceViewsPath,
      actuationTargetsPath: profile.ownedPaths.actuationTargetsPath,
      actuationViewsPath: profile.ownedPaths.actuationViewsPath,
      githubActionFamiliesPath: profile.ownedPaths.githubActionFamiliesPath,
      githubViewsPath: profile.ownedPaths.githubViewsPath,
      nativeDashboardsPath: profile.ownedPaths.nativeDashboardsPath,
      nativeAutomationsPath: profile.ownedPaths.nativeAutomationsPath,
      nativePilotsPath: profile.ownedPaths.nativePilotsPath,
    },
    optionalCredentials: summarizeOptionalCredentials(env),
  };
}

function buildFallbackRuntimeConfig(cwd: string, env: NodeJS.ProcessEnv, profile: WorkspaceProfile): RuntimeConfig {
  const readNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    cwd,
    profile: {
      configVersion: profile.configVersion,
      sourceConfigVersion: profile.sourceConfigVersion,
      name: profile.name,
      label: profile.label,
      kind: profile.kind,
      implicit: profile.implicit,
      registryPath: profile.registryPath,
      descriptorPath: profile.descriptorPath,
    },
    notion: {
      token: normalizeOptionalString(env.NOTION_TOKEN) as string | undefined,
      version: DEFAULT_NOTION_VERSION,
      retryMaxAttempts: readNumber(env.NOTION_RETRY_MAX_ATTEMPTS, 5),
      httpTimeoutMs: readNumber(env.NOTION_HTTP_TIMEOUT_MS, 90_000),
    },
    paths: {
      envFile: profile.envFile,
      logDir: path.resolve(cwd, (normalizeOptionalString(env.NOTION_LOG_DIR) as string | undefined) ?? "./logs"),
      destinationsPath: path.resolve(
        cwd,
        (normalizeOptionalString(env.NOTION_DESTINATIONS_PATH) as string | undefined) ?? profile.destinationsPath,
      ),
      controlTowerConfigPath: profile.controlTowerConfigPath,
      profileConfigDir: profile.ownedPaths.profileConfigDir,
      localPortfolioViewsPath: profile.ownedPaths.localPortfolioViewsPath,
      executionViewsPath: profile.ownedPaths.executionViewsPath,
      intelligenceViewsPath: profile.ownedPaths.intelligenceViewsPath,
      externalSignalSourcesPath: profile.ownedPaths.externalSignalSourcesPath,
      externalSignalProvidersPath: profile.ownedPaths.externalSignalProvidersPath,
      externalSignalViewsPath: profile.ownedPaths.externalSignalViewsPath,
      governancePoliciesPath: profile.ownedPaths.governancePoliciesPath,
      webhookProvidersPath: profile.ownedPaths.webhookProvidersPath,
      governanceViewsPath: profile.ownedPaths.governanceViewsPath,
      actuationTargetsPath: profile.ownedPaths.actuationTargetsPath,
      actuationViewsPath: profile.ownedPaths.actuationViewsPath,
      githubActionFamiliesPath: profile.ownedPaths.githubActionFamiliesPath,
      githubViewsPath: profile.ownedPaths.githubViewsPath,
      nativeDashboardsPath: profile.ownedPaths.nativeDashboardsPath,
      nativeAutomationsPath: profile.ownedPaths.nativeAutomationsPath,
      nativePilotsPath: profile.ownedPaths.nativePilotsPath,
    },
    optionalCredentials: summarizeOptionalCredentials(env),
  };
}

function summarizeOptionalCredentials(env: Partial<Record<(typeof OPTIONAL_ADVANCED_ENV_VARS)[number], string | undefined>>) {
  const present: string[] = [];
  const missing: string[] = [];

  for (const key of OPTIONAL_ADVANCED_ENV_VARS) {
    if ((env[key] ?? "").trim()) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  return { present, missing };
}

function hydrateEnv(
  env: NodeJS.ProcessEnv,
  envFilePath: string,
  options: { overrideExisting: boolean },
): NodeJS.ProcessEnv {
  loadDotenv({
    path: envFilePath,
    processEnv: env as Record<string, string>,
    override: options.overrideExisting,
  });
  return env;
}

function toIssueMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
