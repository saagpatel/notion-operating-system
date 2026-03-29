import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { AppError } from "../utils/errors.js";

export const DEFAULT_PROFILE_NAME = "default";
export const DEFAULT_PROFILE_REGISTRY_PATH = "./config/profiles.json";
export const DEFAULT_PROFILE_DESCRIPTOR_DIR = "./config/profiles";
export const CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION = 1;

export type WorkspaceProfileKind = "primary" | "sandbox";

export interface WorkspaceProfileDescriptor {
  configVersion: number;
  name: string;
  label: string;
  kind: WorkspaceProfileKind;
  envFile: string;
  destinationsPath: string;
  controlTowerConfigPath: string;
}

export interface WorkspaceProfileRegistry {
  version: 1;
  defaultProfile: string;
  profiles: string[];
}

export interface WorkspaceProfileOwnedPaths {
  envFile: string;
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
}

export interface WorkspaceProfile {
  configVersion: number;
  sourceConfigVersion: number;
  name: string;
  label: string;
  kind: WorkspaceProfileKind;
  implicit: boolean;
  registryPath?: string;
  descriptorPath?: string;
  envFile: string;
  destinationsPath: string;
  controlTowerConfigPath: string;
  ownedPaths: WorkspaceProfileOwnedPaths;
}

export interface WorkspaceProfileSummary {
  configVersion: number;
  name: string;
  label: string;
  kind: WorkspaceProfileKind;
  implicit: boolean;
  descriptorPath?: string;
  envFile: string;
  destinationsPath: string;
  controlTowerConfigPath: string;
}

const workspaceProfileRegistrySchema = z.object({
  version: z.literal(1),
  defaultProfile: z.string().min(1),
  profiles: z.array(z.string().min(1)).min(1),
});

const workspaceProfileDescriptorSchema = z.object({
  configVersion: z.coerce.number().int().nonnegative().default(CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION),
  name: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["primary", "sandbox"]).optional(),
  envFile: z.string().min(1),
  destinationsPath: z.string().min(1),
  controlTowerConfigPath: z.string().min(1),
});

const PROFILE_OWNED_FILE_NAMES = {
  localPortfolioViewsPath: "local-portfolio-views.json",
  executionViewsPath: "local-portfolio-execution-views.json",
  intelligenceViewsPath: "local-portfolio-intelligence-views.json",
  externalSignalSourcesPath: "local-portfolio-external-signal-sources.json",
  externalSignalProvidersPath: "local-portfolio-external-signal-providers.json",
  externalSignalViewsPath: "local-portfolio-external-signal-views.json",
  governancePoliciesPath: "local-portfolio-governance-policies.json",
  webhookProvidersPath: "local-portfolio-webhook-providers.json",
  governanceViewsPath: "local-portfolio-governance-views.json",
  actuationTargetsPath: "local-portfolio-actuation-targets.json",
  actuationViewsPath: "local-portfolio-actuation-views.json",
  githubActionFamiliesPath: "local-portfolio-github-action-families.json",
  githubViewsPath: "local-portfolio-github-views.json",
  nativeDashboardsPath: "local-portfolio-native-dashboards.json",
  nativeAutomationsPath: "local-portfolio-native-automations.json",
  nativePilotsPath: "local-portfolio-native-pilots.json",
} as const satisfies Record<string, string>;

export type WorkspaceProfileOwnedPathKey = keyof typeof PROFILE_OWNED_FILE_NAMES;

export interface WorkspaceProfileOwnedFileDefinition {
  key: WorkspaceProfileOwnedPathKey;
  fileName: string;
}

export const WORKSPACE_PROFILE_OWNED_FILES: WorkspaceProfileOwnedFileDefinition[] = Object.entries(
  PROFILE_OWNED_FILE_NAMES,
).map(([key, fileName]) => ({
  key: key as WorkspaceProfileOwnedPathKey,
  fileName,
}));

export function resolveWorkspaceProfile(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  profileName?: string;
} = {}): WorkspaceProfile {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registryPath = getWorkspaceProfileRegistryPath(cwd);

  if (!existsSync(registryPath)) {
    return buildImplicitWorkspaceProfile(cwd);
  }

  const registry = parseWorkspaceProfileRegistry(readJsonFileSync(registryPath));
  const selectedProfileName = normalizeOptionalString(options.profileName ?? options.env?.NOTION_PROFILE) ?? registry.defaultProfile;
  if (!registry.profiles.includes(selectedProfileName)) {
    throw new AppError(
      `Unknown workspace profile "${selectedProfileName}". Available profiles: ${registry.profiles.join(", ")}`,
    );
  }

  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, selectedProfileName);
  if (!existsSync(descriptorPath)) {
    throw new AppError(`Workspace profile descriptor was not found at ${descriptorPath}`);
  }

  const { descriptor, sourceConfigVersion } = parseWorkspaceProfileDescriptor(readJsonFileSync(descriptorPath), selectedProfileName);
  return buildResolvedWorkspaceProfile(cwd, descriptor, {
    implicit: false,
    sourceConfigVersion,
    registryPath,
    descriptorPath,
  });
}

export function listWorkspaceProfiles(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): WorkspaceProfileSummary[] {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registryPath = getWorkspaceProfileRegistryPath(cwd);

  if (!existsSync(registryPath)) {
    return [toWorkspaceProfileSummary(buildImplicitWorkspaceProfile(cwd))];
  }

  const registry = parseWorkspaceProfileRegistry(readJsonFileSync(registryPath));
  return registry.profiles.map((profileName) => {
    const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, profileName);
    if (!existsSync(descriptorPath)) {
      throw new AppError(`Workspace profile descriptor was not found at ${descriptorPath}`);
    }

    const { descriptor, sourceConfigVersion } = parseWorkspaceProfileDescriptor(readJsonFileSync(descriptorPath), profileName);
    return toWorkspaceProfileSummary(
      buildResolvedWorkspaceProfile(cwd, descriptor, {
        implicit: false,
        sourceConfigVersion,
        registryPath,
        descriptorPath,
      }),
    );
  });
}

export function buildWorkspaceProfileDescriptor(input: {
  configVersion?: number;
  name?: string;
  label?: string;
  kind?: WorkspaceProfileKind;
  envFile?: string;
  destinationsPath?: string;
  controlTowerConfigPath?: string;
} = {}): WorkspaceProfileDescriptor {
  const name = input.name ?? DEFAULT_PROFILE_NAME;
  return {
    configVersion: input.configVersion ?? CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
    name,
    label: input.label ?? toProfileLabel(name),
    kind: input.kind ?? defaultWorkspaceProfileKind(name),
    envFile: input.envFile ?? (name === DEFAULT_PROFILE_NAME ? ".env" : `./.env.${name}`),
    destinationsPath:
      input.destinationsPath ??
      (name === DEFAULT_PROFILE_NAME ? "./config/destinations.json" : `./config/profiles/${name}/destinations.json`),
    controlTowerConfigPath:
      input.controlTowerConfigPath ??
      (name === DEFAULT_PROFILE_NAME
        ? "./config/local-portfolio-control-tower.json"
        : `./config/profiles/${name}/local-portfolio-control-tower.json`),
  };
}

export function buildWorkspaceProfileRegistry(profileNames: string[], defaultProfile = DEFAULT_PROFILE_NAME): WorkspaceProfileRegistry {
  if (profileNames.length === 0) {
    throw new AppError("Workspace profile registry must include at least one profile");
  }

  return {
    version: 1,
    defaultProfile,
    profiles: profileNames,
  };
}

export function getWorkspaceProfileRegistryPath(cwd = process.cwd()): string {
  return path.resolve(cwd, DEFAULT_PROFILE_REGISTRY_PATH);
}

export function getWorkspaceProfileDescriptorPath(cwd: string, profileName: string): string {
  return path.resolve(cwd, DEFAULT_PROFILE_DESCRIPTOR_DIR, `${profileName}.json`);
}

export function toWorkspaceProfileSummary(profile: WorkspaceProfile): WorkspaceProfileSummary {
  return {
    name: profile.name,
    label: profile.label,
    kind: profile.kind,
    implicit: profile.implicit,
    configVersion: profile.configVersion,
    descriptorPath: profile.descriptorPath,
    envFile: profile.envFile,
    destinationsPath: profile.destinationsPath,
    controlTowerConfigPath: profile.controlTowerConfigPath,
  };
}

export function buildImplicitWorkspaceProfile(cwd: string): WorkspaceProfile {
  return buildResolvedWorkspaceProfile(cwd, buildWorkspaceProfileDescriptor(), {
    implicit: true,
  });
}

function buildResolvedWorkspaceProfile(
  cwd: string,
  descriptor: WorkspaceProfileDescriptor,
  options: {
    implicit: boolean;
    sourceConfigVersion?: number;
    registryPath?: string;
    descriptorPath?: string;
  },
): WorkspaceProfile {
  const envFile = path.resolve(cwd, descriptor.envFile);
  const destinationsPath = path.resolve(cwd, descriptor.destinationsPath);
  const controlTowerConfigPath = path.resolve(cwd, descriptor.controlTowerConfigPath);
  const profileConfigDir = path.dirname(controlTowerConfigPath);

  return {
    configVersion: descriptor.configVersion,
    sourceConfigVersion: options.sourceConfigVersion ?? descriptor.configVersion,
    name: descriptor.name,
    label: descriptor.label,
    kind: descriptor.kind,
    implicit: options.implicit,
    registryPath: options.registryPath,
    descriptorPath: options.descriptorPath,
    envFile,
    destinationsPath,
    controlTowerConfigPath,
    ownedPaths: {
      envFile,
      destinationsPath,
      controlTowerConfigPath,
      profileConfigDir,
      ...Object.fromEntries(
        WORKSPACE_PROFILE_OWNED_FILES.map(({ key, fileName }) => [key, path.resolve(profileConfigDir, fileName)]),
      ),
    } as WorkspaceProfileOwnedPaths,
  };
}

function parseWorkspaceProfileRegistry(raw: unknown): WorkspaceProfileRegistry {
  return workspaceProfileRegistrySchema.parse(raw);
}

export function parseWorkspaceProfileDescriptor(
  raw: unknown,
  expectedName: string,
): { descriptor: WorkspaceProfileDescriptor; sourceConfigVersion: number } {
  const sourceConfigVersion =
    raw && typeof raw === "object" && "configVersion" in raw && typeof raw.configVersion === "number"
      ? raw.configVersion
      : 0;
  const descriptor = workspaceProfileDescriptorSchema.parse(raw);
  if (descriptor.name !== expectedName) {
    throw new AppError(
      `Workspace profile descriptor name "${descriptor.name}" does not match requested profile "${expectedName}"`,
    );
  }

  return {
    descriptor: {
      ...descriptor,
      kind: descriptor.kind ?? defaultWorkspaceProfileKind(descriptor.name),
      configVersion: CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
    },
    sourceConfigVersion,
  };
}

function readJsonFileSync(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toProfileLabel(name: string): string {
  return name
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultWorkspaceProfileKind(name: string): WorkspaceProfileKind {
  return name.trim().toLowerCase() === "sandbox" ? "sandbox" : "primary";
}
