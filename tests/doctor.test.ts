import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { runDoctor } from "../src/doctor.js";
import type { DestinationConfig } from "../src/types.js";

describe("doctor", () => {
  test("reports missing Notion token while still validating local files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-doctor-"));
    await writeFile(path.join(tempDir, ".env"), "", "utf8");
    await writeDestinationConfig(
      path.join(tempDir, "destinations.json"),
      "11111111-1111-1111-1111-111111111111",
    );

    const report = await runDoctor({
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./destinations.json",
      },
      createNotionClient: () => {
        throw new Error("Notion client should not be constructed when the token is missing");
      },
    });

    expect(report.ok).toBe(false);
    expect(report.runtime.profile.kind).toBe("primary");
    expect(report.checks.find((check) => check.id === "destinations-schema")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "notion-token")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "destination-access")?.status).toBe("skip");
  });

  test("verifies token access and destination reachability when a token is present", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-doctor-"));
    await writeFile(path.join(tempDir, ".env"), "NOTION_TOKEN=secret_test\n", "utf8");
    await writeDestinationConfig(
      path.join(tempDir, "destinations.json"),
      "11111111-1111-1111-1111-111111111111",
    );

    const resolvedAliases: string[] = [];
    const report = await runDoctor({
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./destinations.json",
        NOTION_TOKEN: "secret_test",
        GITHUB_TOKEN: "ghp_test",
      },
      createNotionClient: () => ({
        async verifyAccess() {
          return {
            name: "Test Workspace Bot",
            type: "bot",
          };
        },
        async resolveDestination(destination: DestinationConfig) {
          resolvedAliases.push(destination.alias);
          return { destinationType: destination.destinationType };
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "notion-access")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "destination-access")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "optional-credentials")?.status).toBe("pass");
    expect(resolvedAliases).toEqual(["command_center"]);
  });

  test("fails sandbox doctor when sandbox and primary use the same token", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "shared-token",
      sandboxToken: "shared-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.runtime.profile.name).toBe("sandbox");
    expect(report.runtime.profile.kind).toBe("sandbox");
    expect(report.checks.find((check) => check.id === "sandbox-token-isolation")).toEqual(
      expect.objectContaining({
        status: "fail",
      }),
    );
  });

  test("fails sandbox doctor when destination refs overlap with primary", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "default-token",
      sandboxToken: "sandbox-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "11111111-1111-1111-1111-111111111111",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.checks.find((check) => check.id === "sandbox-target-isolation")).toEqual(
      expect.objectContaining({
        status: "fail",
      }),
    );
  });

  test("fails sandbox doctor when control-tower refs overlap with primary", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "default-token",
      sandboxToken: "sandbox-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "33333333-3333-3333-3333-333333333333",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.checks.find((check) => check.id === "sandbox-target-isolation")).toEqual(
      expect.objectContaining({
        status: "fail",
      }),
    );
  });

  test("fails sandbox doctor when an env override masks the sandbox destinations path", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "default-token",
      sandboxToken: "sandbox-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
      },
      createNotionClient: createPassingNotionClient,
    });

    expect(report.checks.find((check) => check.id === "sandbox-path-overrides")).toEqual(
      expect.objectContaining({
        status: "fail",
      }),
    );
  });

  test("fails sandbox doctor when .env.sandbox masks the profile-owned destinations path", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "default-token",
      sandboxToken: "sandbox-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
      sandboxEnvExtraLines: ["NOTION_DESTINATIONS_PATH=./config/destinations.json"],
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.checks.find((check) => check.id === "sandbox-path-overrides")).toEqual(
      expect.objectContaining({
        status: "fail",
      }),
    );
  });

  test("compares sandbox against the real primary profile instead of hardcoding default", async () => {
    const tempDir = await createSandboxWorkspace({
      primaryProfileName: "alpha",
      defaultToken: "primary-token",
      sandboxToken: "primary-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.checks.find((check) => check.id === "sandbox-token-isolation")).toEqual(
      expect.objectContaining({
        status: "fail",
        message: expect.stringContaining('primary profile "alpha"'),
      }),
    );
  });

  test("passes sandbox doctor when tokens and notion refs are isolated", async () => {
    const tempDir = await createSandboxWorkspace({
      defaultToken: "default-token",
      sandboxToken: "sandbox-token",
      defaultDestinationId: "11111111-1111-1111-1111-111111111111",
      sandboxDestinationId: "22222222-2222-2222-2222-222222222222",
      defaultControlTowerId: "33333333-3333-3333-3333-333333333333",
      sandboxControlTowerId: "44444444-4444-4444-4444-444444444444",
    });

    const report = await runDoctor({
      cwd: tempDir,
      env: {},
      createNotionClient: createPassingNotionClient,
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "sandbox-path-overrides")).toEqual(
      expect.objectContaining({ status: "pass" }),
    );
    expect(report.checks.find((check) => check.id === "sandbox-token-isolation")).toEqual(
      expect.objectContaining({ status: "pass" }),
    );
    expect(report.checks.find((check) => check.id === "sandbox-target-isolation")).toEqual(
      expect.objectContaining({ status: "pass" }),
    );
  });
});

async function createSandboxWorkspace(input: {
  primaryProfileName?: string;
  defaultToken: string;
  sandboxToken: string;
  defaultDestinationId: string;
  sandboxDestinationId: string;
  defaultControlTowerId: string;
  sandboxControlTowerId: string;
  sandboxEnvExtraLines?: string[];
}): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-doctor-sandbox-"));
  const sandboxDir = path.join(tempDir, "config", "profiles", "sandbox");
  const primaryProfileName = input.primaryProfileName ?? "default";
  await mkdir(sandboxDir, { recursive: true });

  await writeFile(
    path.join(tempDir, "config", "profiles.json"),
    JSON.stringify({
      version: 1,
      defaultProfile: "sandbox",
      profiles: [primaryProfileName, "sandbox"],
    }),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, "config", "profiles", `${primaryProfileName}.json`),
    JSON.stringify({
      configVersion: 1,
      name: primaryProfileName,
      label: "Primary Workspace",
      kind: "primary",
      envFile: primaryProfileName === "default" ? ".env" : `.env.${primaryProfileName}`,
      destinationsPath:
        primaryProfileName === "default"
          ? "./config/destinations.json"
          : `./config/profiles/${primaryProfileName}/destinations.json`,
      controlTowerConfigPath:
        primaryProfileName === "default"
          ? "./config/local-portfolio-control-tower.json"
          : `./config/profiles/${primaryProfileName}/local-portfolio-control-tower.json`,
    }),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, "config", "profiles", "sandbox.json"),
    JSON.stringify({
      configVersion: 1,
      name: "sandbox",
      label: "Sandbox Workspace",
      kind: "sandbox",
      envFile: ".env.sandbox",
      destinationsPath: "./config/profiles/sandbox/destinations.json",
      controlTowerConfigPath: "./config/profiles/sandbox/local-portfolio-control-tower.json",
    }),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, primaryProfileName === "default" ? ".env" : `.env.${primaryProfileName}`),
    `NOTION_TOKEN=${input.defaultToken}\n`,
    "utf8",
  );
  await writeFile(
    path.join(tempDir, ".env.sandbox"),
    [`NOTION_TOKEN=${input.sandboxToken}`, ...(input.sandboxEnvExtraLines ?? [])].join("\n").concat("\n"),
    "utf8",
  );

  await writeDestinationConfig(
    path.join(
      tempDir,
      primaryProfileName === "default"
        ? "config/destinations.json"
        : `config/profiles/${primaryProfileName}/destinations.json`,
    ),
    input.defaultDestinationId,
  );
  await writeDestinationConfig(
    path.join(tempDir, "config", "profiles", "sandbox", "destinations.json"),
    input.sandboxDestinationId,
  );
  await writeControlTowerConfig(
    path.join(
      tempDir,
      primaryProfileName === "default"
        ? "config/local-portfolio-control-tower.json"
        : `config/profiles/${primaryProfileName}/local-portfolio-control-tower.json`,
    ),
    input.defaultControlTowerId,
  );
  await writeControlTowerConfig(
    path.join(tempDir, "config", "profiles", "sandbox", "local-portfolio-control-tower.json"),
    input.sandboxControlTowerId,
  );

  return tempDir;
}

async function writeDestinationConfig(targetPath: string, notionId: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify({
      version: 1,
      destinations: [
        {
          alias: "command_center",
          destinationType: "page",
          sourceUrl: `https://www.notion.so/example-${notionId.replace(/-/g, "")}`,
          templateMode: "none",
          titleRule: { source: "literal", value: "Command Center" },
          fixedProperties: {},
          defaultProperties: {},
          mode: "create_new_page",
          safeDefaults: {
            allowDeletingContent: false,
            templatePollIntervalMs: 1000,
            templatePollTimeoutMs: 5000,
          },
        },
      ],
    }),
    "utf8",
  );
}

async function writeControlTowerConfig(targetPath: string, notionId: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify({
      version: 1,
      database: {
        dataSourceId: notionId,
      },
    }),
    "utf8",
  );
}

function createPassingNotionClient(): { verifyAccess: () => Promise<{ name: string; type: string }>; resolveDestination: () => Promise<{ ok: true }> } {
  return {
    async verifyAccess() {
      return {
        name: "Sandbox Bot",
        type: "bot",
      };
    },
    async resolveDestination() {
      return { ok: true };
    },
  };
}
