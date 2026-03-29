import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
  buildImplicitWorkspaceProfile,
  buildWorkspaceProfileDescriptor,
  buildWorkspaceProfileRegistry,
  getWorkspaceProfileDescriptorPath,
  getWorkspaceProfileRegistryPath,
  listWorkspaceProfiles,
  resolveWorkspaceProfile,
  type WorkspaceProfile,
  type WorkspaceProfileDescriptor,
  type WorkspaceProfileRegistry,
} from "../config/profiles.js";
import {
  buildWorkspaceProfileBundle,
  buildWorkspaceProfilePortableAssetManifestForDescriptor,
  collectWorkspaceProfileBundleFiles,
  descriptorFromBundleProfile,
  descriptorFromProfile,
  findWorkspaceProfileBundleFile,
  loadWorkspaceProfileEnvTemplate,
  parseWorkspaceProfileBundle,
  serializePortableContent,
  type WorkspaceProfileBundle,
  type WorkspaceProfileBundleFile,
  type WorkspaceProfilePortableAsset,
  type WorkspaceProfilePortableAssetKey,
} from "../config/profile-portability.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import { AppError } from "../utils/errors.js";

type ProfileActionKind = "create" | "update" | "preserve" | "skip";
type ProfileDiffStatus = "unchanged" | "changed" | "only-in-source" | "only-in-target";

interface ProfileAction {
  action: ProfileActionKind;
  path: string;
  description: string;
}

interface ProfileDiffEntry {
  key: string;
  relativePath: string;
  status: ProfileDiffStatus;
}

export async function runProfilesListCommand(): Promise<void> {
  const activeProfileName = resolveWorkspaceProfile().name;
  const profiles = listWorkspaceProfiles().map((profile) => ({
    ...profile,
    isActive: activeProfileName === profile.name,
  }));

  printJson({
    ok: true,
    profiles,
  });
}

export async function runProfilesShowCommand(): Promise<void> {
  const profile = resolveWorkspaceProfile();

  printJson({
    ok: true,
    profile: serializeProfile(profile),
  });
}

export async function runProfilesMigrateCommand(options: { write?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, "default");
  const registryExists = await pathExists(registryPath);
  const descriptorExists = await pathExists(descriptorPath);
  const profile = resolveWorkspaceProfile();

  const actions: ProfileAction[] = [];
  if (!registryExists) {
    actions.push(createAction("create", registryPath, "Create the workspace profile registry."));
  }
  if (!descriptorExists) {
    actions.push(createAction("create", descriptorPath, "Create the default workspace profile descriptor."));
  }

  if (options.write) {
    const descriptor = descriptorFromProfile(profile, cwd);
    await ensureRegistryIncludesProfile(cwd, descriptor.name);
    if (!descriptorExists) {
      await mkdir(path.dirname(descriptorPath), { recursive: true });
      await writeJsonFile(descriptorPath, descriptor);
    }
  }

  printJson({
    ok: true,
    wrote: Boolean(options.write && actions.length > 0),
    alreadyMaterialized: actions.length === 0,
    actions,
    profile: serializeProfile(resolveWorkspaceProfile()),
  });
}

export async function runProfilesExportCommand(options: { output?: string } = {}): Promise<void> {
  if (!options.output) {
    throw new AppError("--output is required for profiles export");
  }

  const cwd = process.cwd();
  const profile = resolveWorkspaceProfile();
  const envTemplate = await loadWorkspaceProfileEnvTemplate(cwd);
  const files = await collectWorkspaceProfileBundleFiles(profile, cwd, envTemplate);
  const bundle = buildWorkspaceProfileBundle({
    profile,
    cwd,
    envTemplate,
    files,
  });

  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  printJson({
    ok: true,
    outputPath,
    profile: serializeProfile(profile),
    fileCount: bundle.files.length,
    bundleVersion: bundle.version,
  });
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
  const targetDescriptor = descriptorFromBundleProfile(bundle.profile, targetName);
  const actions = await planProfileRestoreActions({
    cwd,
    targetDescriptor,
    mode: "import",
    bundle,
    createOnly: false,
  });

  if (options.write) {
    await applyProfileRestoreActions({
      cwd,
      targetDescriptor,
      bundle,
      createOnly: false,
    });
  }

  printJson({
    ok: true,
    wrote: Boolean(options.write),
    targetProfile: targetName,
    descriptorPath: getWorkspaceProfileDescriptorPath(cwd, targetName),
    bundleVersion: bundle.version,
    sourceConfigVersion: bundle.sourceConfigVersion,
    actions,
  });
}

export async function runProfilesDiffCommand(options: {
  againstProfile?: string;
  againstBundle?: string;
  json?: boolean;
} = {}): Promise<void> {
  if (!options.againstProfile && !options.againstBundle) {
    throw new AppError("profiles diff requires either --against-profile or --against-bundle");
  }
  if (options.againstProfile && options.againstBundle) {
    throw new AppError("profiles diff accepts only one of --against-profile or --against-bundle");
  }

  const cwd = process.cwd();
  const sourceProfile = resolveWorkspaceProfile();
  const envTemplate = await loadWorkspaceProfileEnvTemplate(cwd);
  const sourceBundle = buildWorkspaceProfileBundle({
    profile: sourceProfile,
    cwd,
    envTemplate,
    files: await collectWorkspaceProfileBundleFiles(sourceProfile, cwd, envTemplate),
  });

  const comparison =
    options.againstProfile
      ? {
          targetType: "profile" as const,
          targetName: options.againstProfile,
          bundle: buildWorkspaceProfileBundle({
            profile: resolveWorkspaceProfile({ cwd, profileName: options.againstProfile }),
            cwd,
            envTemplate,
            files: await collectWorkspaceProfileBundleFiles(
              resolveWorkspaceProfile({ cwd, profileName: options.againstProfile }),
              cwd,
              envTemplate,
            ),
          }),
        }
      : {
          targetType: "bundle" as const,
          targetName: path.resolve(options.againstBundle!),
          bundle: parseWorkspaceProfileBundle(
            JSON.parse(await readFile(path.resolve(options.againstBundle!), "utf8")) as unknown,
          ),
        };

  const descriptorDifferences = diffDescriptors(sourceBundle.profile, comparison.bundle.profile);
  const files = diffBundleFiles(sourceBundle.files, comparison.bundle.files);

  printJson({
    ok: true,
    sourceProfile: sourceProfile.name,
    targetType: comparison.targetType,
    target: comparison.targetName,
    descriptorDifferences,
    files,
  });
}

export async function runProfilesCloneCommand(options: {
  source?: string;
  target?: string;
  label?: string;
  kind?: "primary" | "sandbox";
  write?: boolean;
  json?: boolean;
} = {}): Promise<void> {
  if (!options.source) {
    throw new AppError("--source is required for profiles clone");
  }
  if (!options.target) {
    throw new AppError("--target is required for profiles clone");
  }

  const cwd = process.cwd();
  const sourceProfile = resolveWorkspaceProfile({ cwd, profileName: options.source });
  const envTemplate = await loadWorkspaceProfileEnvTemplate(cwd);
  const bundle = buildWorkspaceProfileBundle({
    profile: sourceProfile,
    cwd,
    envTemplate,
    files: await collectWorkspaceProfileBundleFiles(sourceProfile, cwd, envTemplate),
  });
  const targetKind =
    options.kind ??
    (sourceProfile.kind === "sandbox" ? "sandbox" : options.target === "sandbox" ? "sandbox" : "primary");
  const targetDescriptor = buildWorkspaceProfileDescriptor({
    name: options.target,
    label: options.label,
    kind: targetKind,
  });
  const actions = await planProfileRestoreActions({
    cwd,
    targetDescriptor,
    mode: "clone",
    bundle,
    createOnly: false,
  });

  if (options.write) {
    await applyProfileRestoreActions({
      cwd,
      targetDescriptor,
      bundle,
      createOnly: false,
    });
  }

  printJson({
    ok: true,
    wrote: Boolean(options.write),
    sourceProfile: sourceProfile.name,
    targetProfile: options.target,
    actions,
  });
}

export async function runProfilesBootstrapCommand(options: {
  target?: string;
  fromBundle?: string;
  kind?: "primary" | "sandbox";
  write?: boolean;
  json?: boolean;
} = {}): Promise<void> {
  if (!options.target) {
    throw new AppError("--target is required for profiles bootstrap");
  }

  const cwd = process.cwd();
  const sourceBundle = options.fromBundle
    ? parseWorkspaceProfileBundle(JSON.parse(await readFile(path.resolve(options.fromBundle), "utf8")) as unknown)
    : await buildActiveProfileBundle(cwd);
  const targetDescriptor = options.fromBundle
    ? descriptorFromBundleProfile(sourceBundle.profile, options.target, undefined, options.kind)
    : buildWorkspaceProfileDescriptor({ name: options.target, kind: options.kind });
  const actions = await planProfileRestoreActions({
    cwd,
    targetDescriptor,
    mode: "bootstrap",
    bundle: sourceBundle,
    createOnly: true,
  });

  if (options.write) {
    await applyProfileRestoreActions({
      cwd,
      targetDescriptor,
      bundle: sourceBundle,
      createOnly: true,
    });
  }

  printJson({
    ok: true,
    wrote: Boolean(options.write),
    targetProfile: options.target,
    source: options.fromBundle ? path.resolve(options.fromBundle) : "active-profile",
    actions,
  });
}

export async function runProfilesUpgradeCommand(options: { write?: boolean; json?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const profile = resolveWorkspaceProfile();

  if (profile.implicit || !profile.descriptorPath) {
    printJson({
      ok: true,
      wrote: false,
      profile: profile.name,
      alreadyCurrent: true,
      fromConfigVersion: profile.sourceConfigVersion,
      toConfigVersion: CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
      actions: [
        createAction(
          "skip",
          getWorkspaceProfileDescriptorPath(cwd, profile.name),
          "The active profile is implicit, so there is no stored descriptor to upgrade.",
        ),
      ],
    });
    return;
  }

  const actions =
    profile.sourceConfigVersion >= CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION
      ? []
      : [
          createAction(
            "update",
            profile.descriptorPath,
            `Upgrade the profile descriptor from config version ${profile.sourceConfigVersion} to ${CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION}.`,
          ),
        ];

  if (options.write && actions.length > 0) {
    await writeJsonFile(profile.descriptorPath, descriptorFromProfile(profile, cwd));
  }

  printJson({
    ok: true,
    wrote: Boolean(options.write && actions.length > 0),
    profile: profile.name,
    alreadyCurrent: actions.length === 0,
    fromConfigVersion: profile.sourceConfigVersion,
    toConfigVersion: CURRENT_WORKSPACE_PROFILE_CONFIG_VERSION,
    actions,
  });
}

async function buildActiveProfileBundle(cwd: string): Promise<WorkspaceProfileBundle> {
  const profile = resolveWorkspaceProfile({ cwd });
  const envTemplate = await loadWorkspaceProfileEnvTemplate(cwd);
  const files = await collectWorkspaceProfileBundleFiles(profile, cwd, envTemplate);
  return buildWorkspaceProfileBundle({
    profile,
    cwd,
    envTemplate,
    files,
  });
}

async function planProfileRestoreActions(input: {
  cwd: string;
  targetDescriptor: WorkspaceProfileDescriptor;
  mode: "clone" | "bootstrap" | "import";
  bundle: WorkspaceProfileBundle;
  createOnly: boolean;
}): Promise<ProfileAction[]> {
  const cwd = path.resolve(input.cwd);
  const actions: ProfileAction[] = [];
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  const registry = await loadOrInitializeRegistry(cwd, input.targetDescriptor.name);
  const registryExists = await pathExists(registryPath);
  const targetInRegistry = registry.profiles.includes(input.targetDescriptor.name);

  actions.push(
    createAction(
      registryExists
        ? targetInRegistry
          ? "preserve"
          : "update"
        : "create",
      registryPath,
      targetInRegistry
        ? "Keep the workspace profile registry entry for the target profile."
        : "Register the target profile in the workspace profile registry.",
    ),
  );

  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, input.targetDescriptor.name);
  const descriptorExists = await pathExists(descriptorPath);
  actions.push(
    createAction(
      descriptorExists
        ? input.createOnly
          ? "preserve"
          : "update"
        : "create",
      descriptorPath,
      `${descriptorExists && input.createOnly ? "Preserve" : descriptorExists ? "Update" : "Create"} the target profile descriptor.`,
    ),
  );

  const targetAssets = buildWorkspaceProfilePortableAssetManifestForDescriptor(input.targetDescriptor, cwd);
  const sourceFiles = new Map(
    input.bundle.files
      .filter((file): file is WorkspaceProfileBundleFile & { key: WorkspaceProfilePortableAssetKey } => Boolean(file.key))
      .map((file) => [file.key, file]),
  );

  for (const asset of targetAssets) {
    if (asset.key === "envTemplate") {
      const envFilePath = path.resolve(cwd, input.targetDescriptor.envFile);
      const envExists = await pathExists(envFilePath);
      actions.push(
        createAction(
          envExists ? "preserve" : "create",
          envFilePath,
          envExists
            ? "Preserve the existing env file and keep secrets untouched."
            : "Create the target env file from the non-secret template.",
        ),
      );
      continue;
    }

    const sourceFile = sourceFiles.get(asset.key);
    if (!sourceFile || !asset.absolutePath) {
      actions.push(
        createAction(
          "skip",
          asset.relativePath,
          `Skip ${asset.relativePath} because the source profile bundle does not include that portable file.`,
        ),
      );
      continue;
    }

    const targetExists = await pathExists(asset.absolutePath);
    const action =
      targetExists
        ? input.createOnly
          ? "preserve"
          : "update"
        : "create";

    actions.push(
      createAction(
        action,
        asset.absolutePath,
        `${capitalize(action)} ${asset.relativePath} for the target profile.`,
      ),
    );
  }

  return actions;
}

async function applyProfileRestoreActions(input: {
  cwd: string;
  targetDescriptor: WorkspaceProfileDescriptor;
  bundle: WorkspaceProfileBundle;
  createOnly: boolean;
}): Promise<void> {
  const cwd = path.resolve(input.cwd);
  await ensureRegistryIncludesProfile(cwd, input.targetDescriptor.name);

  const descriptorPath = getWorkspaceProfileDescriptorPath(cwd, input.targetDescriptor.name);
  if (!input.createOnly || !(await pathExists(descriptorPath))) {
    await mkdir(path.dirname(descriptorPath), { recursive: true });
    await writeJsonFile(descriptorPath, input.targetDescriptor);
  }

  const targetAssets = buildWorkspaceProfilePortableAssetManifestForDescriptor(input.targetDescriptor, cwd);
  const sourceFiles = new Map(
    input.bundle.files
      .filter((file): file is WorkspaceProfileBundleFile & { key: WorkspaceProfilePortableAssetKey } => Boolean(file.key))
      .map((file) => [file.key, file]),
  );

  for (const asset of targetAssets) {
    if (asset.key === "envTemplate") {
      const envFilePath = path.resolve(cwd, input.targetDescriptor.envFile);
      if (!(await pathExists(envFilePath))) {
        const envTemplate = findWorkspaceProfileBundleFile(input.bundle, "envTemplate");
        if (!envTemplate || typeof envTemplate.content !== "string") {
          throw new AppError("Profile bundle is missing env.template");
        }
        await mkdir(path.dirname(envFilePath), { recursive: true });
        await writeFile(envFilePath, envTemplate.content, "utf8");
      }
      continue;
    }

    const sourceFile = sourceFiles.get(asset.key);
    if (!sourceFile || !asset.absolutePath) {
      continue;
    }

    if (input.createOnly && (await pathExists(asset.absolutePath))) {
      continue;
    }

    await mkdir(path.dirname(asset.absolutePath), { recursive: true });
    if (sourceFile.kind === "json") {
      await writeJsonFile(asset.absolutePath, sourceFile.content);
    } else {
      await writeFile(asset.absolutePath, String(sourceFile.content), "utf8");
    }
  }
}

async function ensureRegistryIncludesProfile(cwd: string, profileName: string): Promise<void> {
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  const existing = await loadOrInitializeRegistry(cwd, profileName);
  const nextProfiles = existing.profiles.includes(profileName)
    ? existing.profiles
    : [...existing.profiles, profileName].sort();
  const nextRegistry: WorkspaceProfileRegistry = {
    version: 1,
    defaultProfile: existing.defaultProfile,
    profiles: nextProfiles,
  };

  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeJsonFile(registryPath, nextRegistry);
}

async function loadOrInitializeRegistry(cwd: string, defaultProfile: string): Promise<WorkspaceProfileRegistry> {
  const registryPath = getWorkspaceProfileRegistryPath(cwd);
  if (!(await pathExists(registryPath))) {
    return buildWorkspaceProfileRegistry([defaultProfile], defaultProfile);
  }

  return readJsonFile<WorkspaceProfileRegistry>(registryPath);
}

function diffDescriptors(
  source: WorkspaceProfileDescriptor,
  target: WorkspaceProfileDescriptor,
): Array<{ field: keyof WorkspaceProfileDescriptor; source: unknown; target: unknown }> {
  const fields: Array<keyof WorkspaceProfileDescriptor> = [
    "configVersion",
    "name",
    "label",
    "kind",
    "envFile",
    "destinationsPath",
    "controlTowerConfigPath",
  ];

  return fields
    .filter((field) => source[field] !== target[field])
    .map((field) => ({
      field,
      source: source[field],
      target: target[field],
    }));
}

function diffBundleFiles(sourceFiles: WorkspaceProfileBundleFile[], targetFiles: WorkspaceProfileBundleFile[]): ProfileDiffEntry[] {
  const sourceMap = new Map(
    sourceFiles
      .filter((file): file is WorkspaceProfileBundleFile & { key: WorkspaceProfilePortableAssetKey } => Boolean(file.key))
      .map((file) => [file.key, file]),
  );
  const targetMap = new Map(
    targetFiles
      .filter((file): file is WorkspaceProfileBundleFile & { key: WorkspaceProfilePortableAssetKey } => Boolean(file.key))
      .map((file) => [file.key, file]),
  );
  const keys = new Set<WorkspaceProfilePortableAssetKey>([
    ...sourceMap.keys(),
    ...targetMap.keys(),
  ]);

  return [...keys]
    .flatMap<ProfileDiffEntry>((key) => {
      const source = sourceMap.get(key);
      const target = targetMap.get(key);
      if (source && !target) {
        return [{
          key,
          relativePath: source.relativePath,
          status: "only-in-source" as const,
        }];
      }
      if (!source && target) {
        return [{
          key,
          relativePath: target.relativePath,
          status: "only-in-target" as const,
        }];
      }
      if (!source || !target) {
        return [];
      }

      return [{
        key,
        relativePath: source.relativePath,
        status: serializePortableContent(source) === serializePortableContent(target) ? "unchanged" : "changed",
      }];
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function serializeProfile(profile: WorkspaceProfile) {
  return {
    name: profile.name,
    label: profile.label,
    kind: profile.kind,
    implicit: profile.implicit,
    configVersion: profile.configVersion,
    sourceConfigVersion: profile.sourceConfigVersion,
    registryPath: profile.registryPath,
    descriptorPath: profile.descriptorPath,
    envFile: profile.envFile,
    destinationsPath: profile.destinationsPath,
    controlTowerConfigPath: profile.controlTowerConfigPath,
    ownedPaths: profile.ownedPaths,
  };
}

function createAction(action: ProfileActionKind, targetPath: string, description: string): ProfileAction {
  return {
    action,
    path: targetPath,
    description,
  };
}

function capitalize(value: string): string {
  return value[0]?.toUpperCase() + value.slice(1);
}

function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
