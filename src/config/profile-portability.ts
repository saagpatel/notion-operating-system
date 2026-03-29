import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
  WORKSPACE_PROFILE_OWNED_FILES,
  buildWorkspaceProfileDescriptor,
  parseWorkspaceProfileDescriptor,
  type WorkspaceProfile,
  type WorkspaceProfileDescriptor,
  type WorkspaceProfileOwnedPathKey,
} from "./profiles.js";
import { readJsonFile } from "../utils/files.js";
import { AppError } from "../utils/errors.js";

export const WORKSPACE_PROFILE_BUNDLE_VERSION = 2;

export type WorkspaceProfilePortableAssetKey =
  | "destinations"
  | "controlTower"
  | WorkspaceProfileOwnedPathKey
  | "envTemplate";

export interface WorkspaceProfilePortableAsset {
  key: WorkspaceProfilePortableAssetKey;
  kind: "json" | "text";
  relativePath: string;
  absolutePath?: string;
}

export interface WorkspaceProfileBundleFile {
  key?: WorkspaceProfilePortableAssetKey;
  kind: "json" | "text";
  relativePath: string;
  content: unknown;
}

export interface WorkspaceProfileBundle {
  version: 1 | 2;
  exportedAt: string;
  profile: WorkspaceProfileDescriptor;
  sourceConfigVersion: number;
  files: WorkspaceProfileBundleFile[];
}

const OWNED_FILE_KEY_BY_BASENAME = new Map(
  WORKSPACE_PROFILE_OWNED_FILES.map(({ key, fileName }) => [fileName, key]),
);

export function buildWorkspaceProfilePortableAssetManifest(
  profile: Pick<WorkspaceProfile, "destinationsPath" | "controlTowerConfigPath" | "ownedPaths">,
  cwd = process.cwd(),
): WorkspaceProfilePortableAsset[] {
  const manifest: WorkspaceProfilePortableAsset[] = [
    {
      key: "destinations",
      kind: "json",
      absolutePath: profile.destinationsPath,
      relativePath: path.relative(cwd, profile.destinationsPath),
    },
    {
      key: "controlTower",
      kind: "json",
      absolutePath: profile.controlTowerConfigPath,
      relativePath: path.relative(cwd, profile.controlTowerConfigPath),
    },
    ...WORKSPACE_PROFILE_OWNED_FILES.map((entry) => ({
      key: entry.key,
      kind: "json" as const,
      absolutePath: profile.ownedPaths[entry.key],
      relativePath: path.relative(cwd, profile.ownedPaths[entry.key]),
    })),
    {
      key: "envTemplate",
      kind: "text",
      relativePath: "env.template",
    },
  ];

  return manifest;
}

export function buildWorkspaceProfilePortableAssetManifestForDescriptor(
  descriptor: WorkspaceProfileDescriptor,
  cwd = process.cwd(),
): WorkspaceProfilePortableAsset[] {
  const controlTowerConfigPath = path.resolve(cwd, descriptor.controlTowerConfigPath);
  const profileConfigDir = path.dirname(controlTowerConfigPath);

  return [
    {
      key: "destinations",
      kind: "json",
      absolutePath: path.resolve(cwd, descriptor.destinationsPath),
      relativePath: path.relative(cwd, path.resolve(cwd, descriptor.destinationsPath)),
    },
    {
      key: "controlTower",
      kind: "json",
      absolutePath: controlTowerConfigPath,
      relativePath: path.relative(cwd, controlTowerConfigPath),
    },
    ...WORKSPACE_PROFILE_OWNED_FILES.map((entry) => {
      const absolutePath = path.resolve(profileConfigDir, entry.fileName);
      return {
        key: entry.key,
        kind: "json" as const,
        absolutePath,
        relativePath: path.relative(cwd, absolutePath),
      };
    }),
    {
      key: "envTemplate",
      kind: "text",
      relativePath: "env.template",
    },
  ];
}

export async function collectWorkspaceProfileBundleFiles(
  profile: WorkspaceProfile,
  cwd: string,
  envTemplate: string,
): Promise<WorkspaceProfileBundleFile[]> {
  const files: WorkspaceProfileBundleFile[] = [];

  for (const asset of buildWorkspaceProfilePortableAssetManifest(profile, cwd)) {
    if (asset.key === "envTemplate") {
      files.push({
        key: asset.key,
        kind: asset.kind,
        relativePath: asset.relativePath,
        content: envTemplate,
      });
      continue;
    }

    if (!asset.absolutePath || !(await pathExists(asset.absolutePath))) {
      continue;
    }

    files.push({
      key: asset.key,
      kind: asset.kind,
      relativePath: asset.relativePath,
      content:
        asset.kind === "json"
          ? await readJsonFile<unknown>(asset.absolutePath)
          : await readFile(asset.absolutePath, "utf8"),
    });
  }

  return files;
}

export function buildWorkspaceProfileBundle(input: {
  profile: WorkspaceProfile;
  cwd: string;
  envTemplate: string;
  files: WorkspaceProfileBundleFile[];
}): WorkspaceProfileBundle {
  return {
    version: WORKSPACE_PROFILE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    sourceConfigVersion: input.profile.sourceConfigVersion,
    profile: descriptorFromProfile(input.profile, input.cwd),
    files: input.files,
  };
}

export function parseWorkspaceProfileBundle(raw: unknown): WorkspaceProfileBundle {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Workspace profile bundle must be an object");
  }

  const bundle = raw as Record<string, unknown>;
  if (bundle.version !== 1 && bundle.version !== WORKSPACE_PROFILE_BUNDLE_VERSION) {
    throw new AppError(`Unsupported workspace profile bundle version "${String(bundle.version)}"`);
  }
  if (!bundle.profile || typeof bundle.profile !== "object") {
    throw new AppError("Workspace profile bundle is missing the profile descriptor");
  }
  if (!Array.isArray(bundle.files)) {
    throw new AppError("Workspace profile bundle is missing files");
  }

  const rawProfile = bundle.profile as Record<string, unknown>;
  const profileName = typeof rawProfile.name === "string" ? rawProfile.name : undefined;
  if (!profileName) {
    throw new AppError("Workspace profile bundle profile descriptor is missing a name");
  }

  const parsedProfile = parseWorkspaceProfileDescriptor(rawProfile, profileName);

  return {
    version: bundle.version as 1 | 2,
    exportedAt: typeof bundle.exportedAt === "string" ? bundle.exportedAt : new Date(0).toISOString(),
    sourceConfigVersion:
      typeof bundle.sourceConfigVersion === "number"
        ? bundle.sourceConfigVersion
        : parsedProfile.sourceConfigVersion,
    profile: parsedProfile.descriptor,
    files: (bundle.files as unknown[]).map((entry) => normalizeWorkspaceProfileBundleFile(entry)),
  };
}

export function findWorkspaceProfileBundleFile(
  bundle: WorkspaceProfileBundle,
  key: WorkspaceProfilePortableAssetKey,
): WorkspaceProfileBundleFile | undefined {
  return bundle.files.find((entry) => entry.key === key);
}

export async function loadWorkspaceProfileEnvTemplate(cwd: string): Promise<string> {
  const envExamplePath = path.resolve(cwd, ".env.example");
  if (await pathExists(envExamplePath)) {
    return readFile(envExamplePath, "utf8");
  }

  return [
    "# Notion Operating System environment template",
    "NOTION_PROFILE=",
    "NOTION_TOKEN=",
    "NOTION_LOG_DIR=./logs",
    "NOTION_RETRY_MAX_ATTEMPTS=5",
    "NOTION_HTTP_TIMEOUT_MS=90000",
    "# Optional advanced override. Leave unset to use the active profile destinations file.",
    "# NOTION_DESTINATIONS_PATH=./config/destinations.json",
    "GITHUB_TOKEN=",
    "VERCEL_TOKEN=",
    "GOOGLE_CALENDAR_TOKEN=",
  ].join("\n").concat("\n");
}

export function descriptorFromProfile(profile: WorkspaceProfile, cwd: string): WorkspaceProfileDescriptor {
  return buildWorkspaceProfileDescriptor({
    name: profile.name,
    label: profile.label,
    kind: profile.kind,
    envFile: path.relative(cwd, profile.envFile) || ".env",
    destinationsPath: path.relative(cwd, profile.destinationsPath) || "./config/destinations.json",
    controlTowerConfigPath:
      path.relative(cwd, profile.controlTowerConfigPath) || "./config/local-portfolio-control-tower.json",
  });
}

export function descriptorFromBundleProfile(
  profile: WorkspaceProfileDescriptor,
  targetName = profile.name,
  label?: string,
  kind = profile.kind,
): WorkspaceProfileDescriptor {
  return buildWorkspaceProfileDescriptor({
    name: targetName,
    label: label ?? (targetName === profile.name ? profile.label : undefined),
    kind,
  });
}

export function serializePortableContent(file: WorkspaceProfileBundleFile): string {
  return file.kind === "json" ? JSON.stringify(file.content) : String(file.content);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeWorkspaceProfileBundleFile(raw: unknown): WorkspaceProfileBundleFile {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Workspace profile bundle file entries must be objects");
  }

  const entry = raw as Record<string, unknown>;
  if (entry.kind !== "json" && entry.kind !== "text") {
    throw new AppError("Workspace profile bundle file entries must include a valid kind");
  }
  if (typeof entry.relativePath !== "string" || entry.relativePath.length === 0) {
    throw new AppError("Workspace profile bundle file entries must include a relativePath");
  }

  const key = normalizeBundleFileKey(entry.key, entry.relativePath);

  return {
    key,
    kind: entry.kind,
    relativePath: entry.relativePath,
    content: entry.content,
  };
}

function normalizeBundleFileKey(
  rawKey: unknown,
  relativePath: string,
): WorkspaceProfilePortableAssetKey | undefined {
  if (typeof rawKey === "string") {
    if (rawKey === "destinations" || rawKey === "controlTower" || rawKey === "envTemplate") {
      return rawKey;
    }
    if (WORKSPACE_PROFILE_OWNED_FILES.some((entry) => entry.key === rawKey)) {
      return rawKey as WorkspaceProfileOwnedPathKey;
    }
  }

  const basename = path.basename(relativePath);
  if (basename === "destinations.json") {
    return "destinations";
  }
  if (basename === "local-portfolio-control-tower.json") {
    return "controlTower";
  }
  if (basename === "env.template") {
    return "envTemplate";
  }
  return OWNED_FILE_KEY_BY_BASENAME.get(basename);
}
