import { access } from "node:fs/promises";

import { DestinationRegistry } from "./config/destination-registry.js";
import {
  collectSandboxNotionRefOccurrences,
  findSandboxNotionRefOverlaps,
  summarizeSandboxNotionRefOverlaps,
} from "./config/sandbox-isolation.js";
import { resolvePrimaryWorkspaceProfileName } from "./config/profiles.js";
import type { DestinationConfig } from "./types.js";
import { safeLoadRuntimeConfig, type RuntimeConfig } from "./config/runtime-config.js";
import { DirectNotionClient } from "./notion/direct-notion-client.js";
import { toErrorMessage } from "./utils/errors.js";

export type DoctorCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  generatedAt: string;
  nodeVersion: string;
  runtime: {
    cwd: string;
    profile: RuntimeConfig["profile"];
    notion: {
      tokenPresent: boolean;
      version: string;
      retryMaxAttempts: number;
      httpTimeoutMs: number;
    };
    paths: RuntimeConfig["paths"];
    optionalCredentials: RuntimeConfig["optionalCredentials"];
  };
  checks: DoctorCheck[];
}

interface DoctorNotionClient {
  verifyAccess: () => Promise<{ name: string; type: string }>;
  resolveDestination: (destination: DestinationConfig) => Promise<unknown>;
}

interface DoctorOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  createNotionClient?: (token: string) => DoctorNotionClient;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const runtimeEnv = options.env ?? process.env;
  const runtimeResult = safeLoadRuntimeConfig({
    cwd: options.cwd,
    env: options.env,
  });
  const runtimeConfig = runtimeResult.config;
  const checks: DoctorCheck[] = [];
  const createNotionClient = options.createNotionClient ?? createDefaultNotionClient;
  const nodeVersion = options.nodeVersion ?? process.versions.node;

  checks.push(checkNodeVersion(nodeVersion));

  if (runtimeResult.success) {
    checks.push({
      id: "runtime-config",
      label: "Runtime config",
      status: "pass",
      message: "Runtime config loaded successfully.",
    });
  } else {
    checks.push({
      id: "runtime-config",
      label: "Runtime config",
      status: "fail",
      message: `Runtime config has invalid values: ${runtimeResult.issues.join("; ")}`,
    });
  }

  const envFilePath = runtimeConfig.paths.envFile;
  const envFileExists = await pathExists(envFilePath);
  checks.push({
    id: "env-file",
    label: ".env file",
    status: envFileExists ? "pass" : "warn",
    message: envFileExists
      ? "Local .env file is present."
      : "Local .env file is missing. You can create it from .env.example.",
  });

  const destinationsPath = runtimeConfig.paths.destinationsPath;
  if (!(await pathExists(destinationsPath))) {
    checks.push({
      id: "destinations-file",
      label: "Destination config",
      status: "fail",
      message: `Destination config was not found at ${destinationsPath}.`,
    });
  } else {
    checks.push({
      id: "destinations-file",
      label: "Destination config",
      status: "pass",
      message: "Destination config file is present.",
    });

    try {
      const registry = await DestinationRegistry.load(destinationsPath);
      checks.push({
        id: "destinations-schema",
        label: "Destination schema",
        status: "pass",
        message: `Destination config is valid and exposes ${registry.destinations.length} alias(es).`,
      });

      const notionToken = runtimeConfig.notion.token;
      if (!notionToken) {
        checks.push({
          id: "notion-token",
          label: "Notion token",
          status: "fail",
          message: "NOTION_TOKEN is missing.",
        });
        checks.push({
          id: "notion-access",
          label: "Notion access",
          status: "skip",
          message: "Skipped because NOTION_TOKEN is missing.",
        });
        checks.push({
          id: "destination-access",
          label: "Destination access",
          status: "skip",
          message: "Skipped because NOTION_TOKEN is missing.",
        });
      } else {
        checks.push({
          id: "notion-token",
          label: "Notion token",
          status: "pass",
          message: "NOTION_TOKEN is present.",
        });

        try {
          const client = createNotionClient(notionToken);
          const accessSummary = await client.verifyAccess();
          checks.push({
            id: "notion-access",
            label: "Notion access",
            status: "pass",
            message: `Notion token is valid for ${accessSummary.name} (${accessSummary.type}).`,
          });

          const inaccessibleAliases: string[] = [];
          for (const destination of registry.destinations) {
            try {
              await client.resolveDestination(destination);
            } catch (error) {
              inaccessibleAliases.push(`${destination.alias}: ${toErrorMessage(error)}`);
            }
          }

          checks.push({
            id: "destination-access",
            label: "Destination access",
            status: inaccessibleAliases.length === 0 ? "pass" : "fail",
            message:
              inaccessibleAliases.length === 0
                ? `All configured destinations are reachable (${registry.destinations.length} checked).`
                : `Some configured destinations are not reachable: ${inaccessibleAliases.join("; ")}`,
          });
        } catch (error) {
          checks.push({
            id: "notion-access",
            label: "Notion access",
            status: "fail",
            message: `Notion token check failed: ${toErrorMessage(error)}`,
          });
          checks.push({
            id: "destination-access",
            label: "Destination access",
            status: "skip",
            message: "Skipped because the Notion token could not be verified.",
          });
        }
      }
    } catch (error) {
      checks.push({
        id: "destinations-schema",
        label: "Destination schema",
        status: "fail",
        message: `Destination config is invalid: ${toErrorMessage(error)}`,
      });
    }
  }

  checks.push(buildOptionalCredentialCheck(runtimeConfig));
  if (runtimeConfig.profile.kind === "sandbox") {
    checks.push(...(await buildSandboxIsolationChecks(runtimeConfig, runtimeEnv)));
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt: new Date().toISOString(),
    nodeVersion,
    runtime: {
      cwd: runtimeConfig.cwd,
      profile: runtimeConfig.profile,
      notion: {
        tokenPresent: Boolean(runtimeConfig.notion.token),
        version: runtimeConfig.notion.version,
        retryMaxAttempts: runtimeConfig.notion.retryMaxAttempts,
        httpTimeoutMs: runtimeConfig.notion.httpTimeoutMs,
      },
      paths: runtimeConfig.paths,
      optionalCredentials: runtimeConfig.optionalCredentials,
    },
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    report.ok ? "Doctor summary: setup looks healthy." : "Doctor summary: setup needs attention.",
    `Node.js: ${report.nodeVersion}`,
    `Active profile: ${report.runtime.profile.name}${report.runtime.profile.implicit ? " (implicit legacy default)" : ""}`,
    `Profile kind: ${report.runtime.profile.kind}`,
    `Env file: ${report.runtime.paths.envFile}`,
    `Destinations path: ${report.runtime.paths.destinationsPath}`,
    `Control tower path: ${report.runtime.paths.controlTowerConfigPath}`,
    `Log dir: ${report.runtime.paths.logDir}`,
    "",
  ];

  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase()} ${check.label}: ${check.message}`);
  }

  return lines.join("\n");
}

function buildOptionalCredentialCheck(runtimeConfig: RuntimeConfig): DoctorCheck {
  const { present, missing } = runtimeConfig.optionalCredentials;
  if (present.length > 0) {
    return {
      id: "optional-credentials",
      label: "Optional advanced credentials",
      status: "pass",
      message: `Configured ${present.length} optional credential(s): ${present.join(", ")}.`,
    };
  }

  return {
    id: "optional-credentials",
    label: "Optional advanced credentials",
    status: "warn",
    message: `No optional advanced credentials are configured yet. Missing: ${missing.join(", ")}.`,
  };
}

async function buildSandboxIsolationChecks(
  runtimeConfig: RuntimeConfig,
  env: NodeJS.ProcessEnv,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const primaryProfileName = resolvePrimaryWorkspaceProfileName({
    cwd: runtimeConfig.cwd,
    env,
  });
  const primaryRuntime = safeLoadRuntimeConfig({
    cwd: runtimeConfig.cwd,
    env,
    profile: primaryProfileName,
  }).config;

  const sandboxDescriptorDestinationsPath = safeLoadRuntimeConfig({
    cwd: runtimeConfig.cwd,
    env: {},
    profile: runtimeConfig.profile.name,
    hydrateEnvFile: false,
  }).config.paths.destinationsPath;

  if (runtimeConfig.paths.destinationsPath !== sandboxDescriptorDestinationsPath) {
    checks.push({
      id: "sandbox-path-overrides",
      label: "Sandbox path isolation",
      status: "fail",
      message:
        `Sandbox is resolving destinations from ${runtimeConfig.paths.destinationsPath}, which masks the profile-owned path ` +
        `${sandboxDescriptorDestinationsPath}. Unset NOTION_DESTINATIONS_PATH before live sandbox use.`,
    });
  } else {
    checks.push({
      id: "sandbox-path-overrides",
      label: "Sandbox path isolation",
      status: "pass",
      message: "Sandbox is resolving the profile-owned destinations path without an env override collision.",
    });
  }

  const sandboxToken = runtimeConfig.notion.token?.trim();
  const primaryToken = primaryRuntime.notion.token?.trim();
  const sameToken = Boolean(sandboxToken && primaryToken && sandboxToken === primaryToken);
  checks.push({
    id: "sandbox-token-isolation",
    label: "Sandbox token isolation",
    status: sameToken ? "fail" : "pass",
    message: sameToken
      ? `Sandbox and primary profile "${primaryProfileName}" are using the same effective NOTION_TOKEN. Point sandbox at a separate workspace token.`
      : `Sandbox and primary profile "${primaryProfileName}" are using different effective Notion tokens.`,
  });

  const [sandboxRefs, primaryRefs] = await Promise.all([
    collectSandboxNotionRefOccurrences(runtimeConfig.paths),
    collectSandboxNotionRefOccurrences(primaryRuntime.paths),
  ]);
  const overlaps = findSandboxNotionRefOverlaps(primaryRefs, sandboxRefs);
  checks.push({
    id: "sandbox-target-isolation",
    label: "Sandbox target isolation",
    status: overlaps.length > 0 ? "fail" : "pass",
    message:
      overlaps.length > 0
        ? `Sandbox still overlaps primary profile "${primaryProfileName}" Notion targets. ${summarizeSandboxNotionRefOverlaps(overlaps)}`
        : `Sandbox Notion target references are isolated from primary profile "${primaryProfileName}".`,
  });

  return checks;
}

function checkNodeVersion(nodeVersion: string): DoctorCheck {
  const major = Number(nodeVersion.split(".")[0] ?? "0");
  if (major >= 20) {
    return {
      id: "node-version",
      label: "Node.js version",
      status: "pass",
      message: `Node.js ${nodeVersion} satisfies the >=20 requirement.`,
    };
  }

  return {
    id: "node-version",
    label: "Node.js version",
    status: "fail",
    message: `Node.js ${nodeVersion} is too old. Use Node.js 20 or newer.`,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function createDefaultNotionClient(token: string) {
  return new DirectNotionClient(token);
}
