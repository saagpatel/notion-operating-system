import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildImplicitWorkspaceProfile,
  buildWorkspaceProfileDescriptor,
  buildWorkspaceProfileRegistry,
  getWorkspaceProfileDescriptorPath,
  getWorkspaceProfileRegistryPath,
  listWorkspaceProfiles,
  resolveWorkspaceProfile,
  WORKSPACE_PROFILE_OWNED_FILES,
  type WorkspaceProfile,
  type WorkspaceProfileDescriptor,
  type WorkspaceProfileRegistry,
} from "../config/profiles.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import { AppError } from "../utils/errors.js";

interface WorkspaceProfileBundleFile {
  kind: "json" | "text";
  relativePath: string;
  content: unknown;
}

interface WorkspaceProfileBundle {
  version: 1;
  exportedAt: string;
  profile: WorkspaceProfileDescriptor;
  files: WorkspaceProfileBundleFile[];
}

export async function runProfilesListCommand(): Promise<void> {
  const profiles = listWorkspaceProfiles().map((profile) => ({
    ...profile,
    isActive: resolveWorkspaceProfile().name === profile.name,
  }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        profiles,
      },
      null,
      2,
    ),
  );
}

export async function runProfilesShowCommand(): Promise<void> {
  const profile = resolveWorkspaceProfile();
  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: serializeProfile(profile),
      },
      null,
      2,
    ),
  );
}

export async function runProfilesMigrateCommand(options: { write?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, "default");
  const registryExists = await pathExists(registryPath);
  const descriptorExists = await pathExists(descriptorPath);
  const profile = resolveWorkspaceProfile();

  const actions = [];
  if (!registryExists) {
    actions.push({ type: "write", path: registryPath, description: "Create the workspace profile registry." });
  }
  if (!descriptorExists) {
    actions.push({ type: "write", path: descriptorPath, description: "Create the default workspace profile descriptor." });
  }

  if (options.write && actions.length > 0) {
    await mkdir(path.dirname(registryPath), { recursive: true });
    if (!registryExists) {
      await writeJsonFile(registryPath, buildWorkspaceProfileRegistry(["default"]));
    }
    if (!descriptorExists) {
      await mkdir(path.dirname(descriptorPath), { recursive: true });
      await writeJsonFile(
        descriptorPath,
        buildWorkspaceProfileDescriptor({
          name: "default",
          label: profile.label,
          envFile: path.relative(cwd, profile.envFile) || ".env",
          destinationsPath: path.relative(cwd, profile.destinationsPath) || "./config/destinations.json",
          controlTowerConfigPath:
            path.relative(cwd, profile.controlTowerConfigPath) || "./config/local-portfolio-control-tower.json",
        }),
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: options.write && actions.length > 0,
        alreadyMaterialized: actions.length === 0,
        actions,
        profile: serializeProfile(options.write ? resolveWorkspaceProfile() : profile),
      },
      null,
      2,
    ),
  );
}

export async function runProfilesExportCommand(options: { output?: string } = {}): Promise<void> {
  if (!options.output) {
    throw new AppError("--output is required for profiles export");
  }

  const cwd = process.cwd();
  const profile = resolveWorkspaceProfile();
  const bundle: WorkspaceProfileBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: descriptorFromProfile(profile, cwd),
    files: [
      {
        kind: "json",
        relativePath: path.relative(cwd, profile.destinationsPath),
        content: await readJsonFile<unknown>(profile.destinationsPath),
      },
      {
        kind: "json",
        relativePath: path.relative(cwd, profile.controlTowerConfigPath),
        content: await readJsonFile<unknown>(profile.controlTowerConfigPath),
      },
      ...await collectProfileOwnedBundleFiles(profile, cwd),
      {
        kind: "text",
        relativePath: "env.template",
        content: await loadEnvTemplate(cwd),
      },
    ],
  };

  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        profile: serializeProfile(profile),
        fileCount: bundle.files.length,
      },
      null,
      2,
    ),
  );
}

export async function runProfilesImportCommand(options: {
  bundle?: string;
  target?: string;
  write?: boolean;
} = {}): Promise<void> {
  if (!options.bundle) {
    throw new AppError("--bundle is required for profiles import");
  }

  const cwd = process.cwd();
  const bundle = parseWorkspaceProfileBundle(
    JSON.parse(await readFile(path.resolve(options.bundle), "utf8")) as unknown,
  );
  const targetName = options.target?.trim() || bundle.profile.name;
  const targetDescriptor = buildWorkspaceProfileDescriptor({
    name: targetName,
    label: targetName === bundle.profile.name ? bundle.profile.label : undefined,
  });

  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, targetName);
  const envTemplate = getBundleText(bundle, "env.template");
  const writes = [
    { path: registryPath, kind: "json", description: "Update the workspace profile registry." },
    { path: descriptorPath, kind: "json", description: `Write the "${targetName}" profile descriptor.` },
    { path: path.resolve(cwd, targetDescriptor.destinationsPath), kind: "json", description: "Restore the destinations config." },
    {
      path: path.resolve(cwd, targetDescriptor.controlTowerConfigPath),
      kind: "json",
      description: "Restore the control-tower config.",
    },
    ...bundle.files
      .filter((file) => file.kind === "json")
      .filter((file) => !file.relativePath.endsWith("destinations.json"))
      .filter((file) => !file.relativePath.endsWith("local-portfolio-control-tower.json"))
      .map((file) => ({
        path: path.resolve(path.dirname(path.resolve(cwd, targetDescriptor.controlTowerConfigPath)), path.basename(file.relativePath)),
        kind: "json",
        description: `Restore ${path.basename(file.relativePath)}.`,
      })),
  ];

  const envFilePath = path.resolve(cwd, targetDescriptor.envFile);
  const envFileExists = await pathExists(envFilePath);
  const actions = [
    ...writes,
    envFileExists
      ? {
          path: envFilePath,
          kind: "text",
          description: "Preserve the existing env file without overwriting secrets.",
          skipped: true,
        }
      : {
          path: envFilePath,
          kind: "text",
          description: "Create the profile env file from the non-secret template.",
          skipped: false,
        },
  ];

  if (options.write) {
    const registry = await loadOrInitializeRegistry(cwd, targetName);
    const nextProfileNames = registry.profiles.includes(targetName)
      ? registry.profiles
      : [...registry.profiles, targetName].sort();
    const nextRegistry: WorkspaceProfileRegistry = {
      version: 1,
      defaultProfile: registry.defaultProfile,
      profiles: nextProfileNames,
    };

    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeJsonFile(registryPath, nextRegistry);
    await mkdir(path.dirname(descriptorPath), { recursive: true });
    await writeJsonFile(descriptorPath, targetDescriptor);

    await restoreJsonFile(path.resolve(cwd, targetDescriptor.destinationsPath), getBundleJson(bundle, "destinations.json"));
    await restoreJsonFile(
      path.resolve(cwd, targetDescriptor.controlTowerConfigPath),
      getBundleJson(bundle, "local-portfolio-control-tower.json"),
    );

    const targetConfigDir = path.dirname(path.resolve(cwd, targetDescriptor.controlTowerConfigPath));
    for (const file of bundle.files.filter((entry) => entry.kind === "json")) {
      const basename = path.basename(file.relativePath);
      if (basename === "destinations.json" || basename === "local-portfolio-control-tower.json") {
        continue;
      }
      await restoreJsonFile(path.resolve(targetConfigDir, basename), file.content);
    }

    if (!envFileExists) {
      await mkdir(path.dirname(envFilePath), { recursive: true });
      await writeFile(envFilePath, envTemplate, "utf8");
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: Boolean(options.write),
        targetProfile: targetName,
        descriptorPath,
        actions,
      },
      null,
      2,
    ),
  );
}

async function collectProfileOwnedBundleFiles(profile: WorkspaceProfile, cwd: string): Promise<WorkspaceProfileBundleFile[]> {
  const files: WorkspaceProfileBundleFile[] = [];

  for (const { key } of WORKSPACE_PROFILE_OWNED_FILES) {
    const targetPath = profile.ownedPaths[key];
    if (!(await pathExists(targetPath))) {
      continue;
    }

    files.push({
      kind: "json",
      relativePath: path.relative(cwd, targetPath),
      content: await readJsonFile<unknown>(targetPath),
    });
  }

  return files;
}

async function restoreJsonFile(targetPath: string, content: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeJsonFile(targetPath, content);
}

async function loadEnvTemplate(cwd: string): Promise<string> {
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

async function loadOrInitializeRegistry(cwd: string, defaultProfile: string): Promise<WorkspaceProfileRegistry> {
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  if (!(await pathExists(registryPath))) {
    return buildWorkspaceProfileRegistry([defaultProfile], defaultProfile);
  }

  return readJsonFile<WorkspaceProfileRegistry>(registryPath);
}

function serializeProfile(profile: WorkspaceProfile) {
  return {
    name: profile.name,
    label: profile.label,
    implicit: profile.implicit,
    registryPath: profile.registryPath,
    descriptorPath: profile.descriptorPath,
    envFile: profile.envFile,
    destinationsPath: profile.destinationsPath,
    controlTowerConfigPath: profile.controlTowerConfigPath,
    ownedPaths: profile.ownedPaths,
  };
}

function descriptorFromProfile(profile: WorkspaceProfile, cwd: string): WorkspaceProfileDescriptor {
  return {
    name: profile.name,
    label: profile.label,
    envFile: path.relative(cwd, profile.envFile) || ".env",
    destinationsPath: path.relative(cwd, profile.destinationsPath) || "./config/destinations.json",
    controlTowerConfigPath:
      path.relative(cwd, profile.controlTowerConfigPath) || "./config/local-portfolio-control-tower.json",
  };
}

function parseWorkspaceProfileBundle(raw: unknown): WorkspaceProfileBundle {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Workspace profile bundle must be an object");
  }

  const bundle = raw as Partial<WorkspaceProfileBundle>;
  if (bundle.version !== 1) {
    throw new AppError(`Unsupported workspace profile bundle version "${String(bundle.version)}"`);
  }
  if (!bundle.profile || typeof bundle.profile !== "object") {
    throw new AppError("Workspace profile bundle is missing the profile descriptor");
  }
  if (!Array.isArray(bundle.files)) {
    throw new AppError("Workspace profile bundle is missing files");
  }

  return bundle as WorkspaceProfileBundle;
}

function getBundleJson(bundle: WorkspaceProfileBundle, basename: string): unknown {
  const file = bundle.files.find((entry) => entry.kind === "json" && path.basename(entry.relativePath) === basename);
  if (!file) {
    throw new AppError(`Bundle is missing ${basename}`);
  }
  return file.content;
}

function getBundleText(bundle: WorkspaceProfileBundle, basename: string): string {
  const file = bundle.files.find((entry) => entry.kind === "text" && path.basename(entry.relativePath) === basename);
  if (!file || typeof file.content !== "string") {
    throw new AppError(`Bundle is missing ${basename}`);
  }
  return file.content;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
