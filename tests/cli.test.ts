import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { resolveOptionalControlTowerConfigPath } from "../src/cli/context.js";
import { parseCliArgs } from "../src/cli/framework.js";
import { runCli } from "../src/cli/runner.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

afterEach(() => {
  process.exitCode = undefined;
});

describe("cli smoke tests", () => {
  test("renders root help", async () => {
    const result = await runCliForTest(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Notion Operating System CLI");
    expect(result.stdout).toContain("--profile <name>");
    expect(result.stdout).toContain("control-tower");
    expect(result.stderr).toBe("");
  });

  test("renders help for each major command family", async () => {
    const families = [
      ["publish", "publish"],
      ["doctor", "doctor"],
      ["destinations", "check"],
      ["profiles", "show"],
      ["control-tower", "sync"],
      ["execution", "views-validate"],
      ["intelligence", "views-validate"],
      ["signals", "provider-expansion-audit"],
      ["governance", "webhook-reconcile"],
      ["rollout", "operational"],
    ] as const;

    for (const [family, expectedSubcommand] of families) {
      const result = await runCliForTest([family, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(family);
      expect(result.stdout).toContain(expectedSubcommand);
      expect(result.stderr).toBe("");
    }
  });

  test("renders help for the migrated durable subcommands", async () => {
    const commands = [
      ["governance", "audit"],
      ["governance", "views-validate"],
      ["governance", "actuation-audit"],
      ["governance", "webhook-shadow-drain"],
      ["governance", "webhook-reconcile"],
      ["execution", "views-validate"],
      ["intelligence", "views-validate"],
      ["signals", "views-validate"],
      ["signals", "provider-expansion-audit"],
    ];

    for (const command of commands) {
      const result = await runCliForTest([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(command[command.length - 1]!);
      expect(result.stderr).toBe("");
    }
  });

  test("runs doctor json output safely on a fresh machine", async () => {
    const tempDir = await createTempWorkspace();

    const result = await runCliForTest(["doctor", "--json"], {
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
      },
    });

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.runtime.profile.name).toBe("default");
    expect(report.checks.some((check: { id: string }) => check.id === "runtime-config")).toBe(true);
    expect(report.checks.some((check: { id: string }) => check.id === "destinations-schema")).toBe(true);
  });

  test("records command lifecycle events for successful runs", async () => {
    const tempDir = await createTempWorkspace();
    const logDir = path.join(tempDir, "logs");

    const result = await runCliForTest(["doctor", "--json"], {
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
        NOTION_LOG_DIR: "./logs",
      },
    });

    expect(result.exitCode).toBe(1);
    const [logFileName] = await readdir(logDir);
    expect(logFileName).toBeTruthy();
    const logLines = (await readFile(path.join(logDir, logFileName!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string });

    expect(logLines.map((line) => line.action)).toContain("command_started");
    expect(logLines.map((line) => line.action)).toContain("command_completed");
  });

  test("lists configured destination aliases", async () => {
    const tempDir = await createTempWorkspace();

    const result = await runCliForTest(["destinations", "check"], {
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: 1,
      aliases: ["weekly_reviews", "command_center"],
    });
  });

  test("runs migrated safe audit commands through the shared CLI", async () => {
    const governance = await runCliForTest(["governance", "audit"], { cwd: repoRoot });
    const actuation = await runCliForTest(["governance", "actuation-audit"], { cwd: repoRoot });
    const providerExpansion = await runCliForTest(["signals", "provider-expansion-audit"], {
      cwd: repoRoot,
    });

    expect(governance.exitCode).toBe(0);
    expect(JSON.parse(governance.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );

    expect(actuation.exitCode).toBe(0);
    expect(JSON.parse(actuation.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );

    expect(providerExpansion.exitCode).toBe(0);
    expect(JSON.parse(providerExpansion.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );
  });

  test("surfaces publish validation errors without making writes", async () => {
    const tempDir = await createTempWorkspace();

    const result = await runCliForTest(["publish"], {
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("destinationAlias");
  });

  test("records command failures in the run log", async () => {
    const tempDir = await createTempWorkspace();
    const logDir = path.join(tempDir, "logs");

    const result = await runCliForTest(["publish"], {
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./config/destinations.json",
        NOTION_LOG_DIR: "./logs",
      },
    });

    expect(result.exitCode).toBe(1);
    const [logFileName] = await readdir(logDir);
    expect(logFileName).toBeTruthy();
    const logLines = (await readFile(path.join(logDir, logFileName!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string });

    expect(logLines.map((line) => line.action)).toContain("command_failed");
  });
});

describe("cli parser", () => {
  test("parses booleans and repeated values", () => {
    const parsed = parseCliArgs(["--live", "--property", "a=1", "--property", "b=true"], [
      { name: "live", description: "live", type: "boolean" },
      { name: "property", description: "property", type: "string-array" },
    ]);

    expect(parsed.options.live).toBe(true);
    expect(parsed.options.property).toEqual(["a=1", "b=true"]);
  });

  test("keeps a legacy positional config path compatible with named flags", () => {
    const parsed = parseCliArgs(["./control-tower.json", "--today", "2026-03-28"], [
      { name: "today", description: "today", type: "string" },
      { name: "config", description: "config", type: "string" },
    ]);

    expect(
      resolveOptionalControlTowerConfigPath({
        config: parsed.options.config as string | undefined,
        positionals: parsed.positionals,
      }),
    ).toBe("./control-tower.json");
  });

  test("rejects unknown flags", () => {
    expect(() => parseCliArgs(["--mystery"], [])).toThrow('Unknown flag "--mystery"');
  });
});

describe("profiles cli", () => {
  test("lists an implicit default profile on a legacy workspace", async () => {
    const tempDir = await createTempWorkspace();

    const result = await runCliForTest(["profiles", "list"], { cwd: tempDir });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      profiles: [
        expect.objectContaining({
          name: "default",
          implicit: true,
          isActive: true,
        }),
      ],
    });
  });

  test("shows an explicitly selected profile", async () => {
    const tempDir = await createProfiledWorkspace();

    const result = await runCliForTest(["--profile", "work", "profiles", "show"], { cwd: tempDir });
    const payload = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(payload.profile.name).toBe("work");
    expect(payload.profile.implicit).toBe(false);
    expect(payload.profile.destinationsPath).toContain(path.join("config", "profiles", "work", "destinations.json"));
  });

  test("migrates a legacy workspace in preview first and then writes the profile files", async () => {
    const tempDir = await createTempWorkspace();

    const preview = await runCliForTest(["profiles", "migrate"], { cwd: tempDir });
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout)).toEqual(
      expect.objectContaining({
        wrote: false,
        alreadyMaterialized: false,
      }),
    );

    const written = await runCliForTest(["profiles", "migrate", "--write"], { cwd: tempDir });
    expect(written.exitCode).toBe(0);
    expect(JSON.parse(written.stdout)).toEqual(
      expect.objectContaining({
        wrote: true,
      }),
    );

    const registry = JSON.parse(await readFile(path.join(tempDir, "config", "profiles.json"), "utf8"));
    expect(registry.profiles).toContain("default");
  });

  test("exports a non-secret profile bundle and imports it preview-first", async () => {
    const sourceDir = await createProfiledWorkspace();
    await writeFile(path.join(sourceDir, ".env.work"), "NOTION_TOKEN=secret_value\n", "utf8");
    const bundlePath = path.join(sourceDir, "tmp", "work-profile.bundle.json");

    const exportResult = await runCliForTest(
      ["--profile", "work", "profiles", "export", "--output", bundlePath],
      { cwd: sourceDir },
    );
    expect(exportResult.exitCode).toBe(0);

    const bundleText = await readFile(bundlePath, "utf8");
    expect(bundleText).not.toContain("secret_value");
    const bundle = JSON.parse(bundleText);
    expect(bundle.files.some((file: { relativePath: string }) => file.relativePath === "env.template")).toBe(true);

    const targetDir = await createTempWorkspace();
    const previewImport = await runCliForTest(
      ["profiles", "import", "--bundle", bundlePath, "--target", "imported"],
      { cwd: targetDir },
    );
    expect(previewImport.exitCode).toBe(0);
    expect(JSON.parse(previewImport.stdout)).toEqual(
      expect.objectContaining({
        wrote: false,
        targetProfile: "imported",
      }),
    );

    const writeImport = await runCliForTest(
      ["profiles", "import", "--bundle", bundlePath, "--target", "imported", "--write"],
      { cwd: targetDir },
    );
    expect(writeImport.exitCode).toBe(0);

    const importedDescriptor = JSON.parse(
      await readFile(path.join(targetDir, "config", "profiles", "imported.json"), "utf8"),
    );
    expect(importedDescriptor.name).toBe("imported");
    expect(await readFile(path.join(targetDir, ".env.imported"), "utf8")).toContain("NOTION_TOKEN");
  });
});

describe("legacy wrapper compatibility", () => {
  test("governance audit wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/governance-audit.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Audit the governance policy and webhook posture");
  });

  test("execution views validation wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/validate-local-portfolio-execution-views.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Validate the execution saved-view plan");
  });

  test("provider expansion wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/provider-expansion-audit.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("provider expansion");
  });

  test("governance audit wrapper still runs a safe audit path", async () => {
    const result = await runLegacyCommand("src/notion/governance-audit.ts");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );
  });

  test("provider expansion wrapper still runs a safe audit path", async () => {
    const result = await runLegacyCommand("src/notion/provider-expansion-audit.ts");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
      }),
    );
  });

  test("control-tower wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/control-tower-sync.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Refresh control-tower derived fields");
  });

  test("execution wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/execution-sync.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Refresh execution briefs");
  });

  test("governance wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/action-runner.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Run approved action requests");
  });

  test("rollout wrapper delegates to the shared help output", async () => {
    const result = await runLegacyHelp("src/notion/operational-rollout.ts");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Classify rollout candidates");
  });
});

async function createTempWorkspace(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-cli-"));
  const configDir = path.join(tempDir, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(tempDir, ".env"),
    "",
    "utf8",
  );
  await writeFile(
    path.join(configDir, "destinations.json"),
    JSON.stringify({
      version: 1,
      destinations: [
        {
          alias: "weekly_reviews",
          destinationType: "page",
          sourceUrl: "https://www.notion.so/weekly",
          templateMode: "none",
          titleRule: { source: "filename" },
          fixedProperties: {},
          defaultProperties: {},
          mode: "create_new_page",
          safeDefaults: {
            allowDeletingContent: false,
            templatePollIntervalMs: 1000,
            templatePollTimeoutMs: 5000,
          },
        },
        {
          alias: "command_center",
          destinationType: "page",
          sourceUrl: "https://www.notion.so/command-center",
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

  return tempDir;
}

async function createProfiledWorkspace(): Promise<string> {
  const tempDir = await createTempWorkspace();
  const profileConfigDir = path.join(tempDir, "config", "profiles", "work");
  await mkdir(profileConfigDir, { recursive: true });
  await writeFile(
    path.join(tempDir, "config", "profiles.json"),
    JSON.stringify({
      version: 1,
      defaultProfile: "work",
      profiles: ["work"],
    }),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, "config", "profiles", "work.json"),
    JSON.stringify({
      name: "work",
      label: "Work Workspace",
      envFile: ".env.work",
      destinationsPath: "./config/profiles/work/destinations.json",
      controlTowerConfigPath: "./config/profiles/work/local-portfolio-control-tower.json",
    }),
    "utf8",
  );
  await writeFile(
    path.join(profileConfigDir, "destinations.json"),
    await readFile(path.join(tempDir, "config", "destinations.json"), "utf8"),
    "utf8",
  );
  await writeFile(
    path.join(profileConfigDir, "local-portfolio-control-tower.json"),
    JSON.stringify({ version: 1, profile: "work" }),
    "utf8",
  );
  await writeFile(
    path.join(profileConfigDir, "local-portfolio-views.json"),
    JSON.stringify({ version: 1, views: [] }),
    "utf8",
  );
  await writeFile(path.join(tempDir, ".env.work"), "", "utf8");

  return tempDir;
}

async function runCliForTest(
  argv: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const previousCwd = process.cwd();
  const restoreEnv = applyEnvOverrides(options.env);
  const previousLog = console.log;
  const previousError = console.error;

  try {
    if (options.cwd) {
      process.chdir(options.cwd);
    }

    console.log = (...values: unknown[]) => {
      stdout.push(values.map((value) => String(value)).join(" "));
    };
    console.error = (...values: unknown[]) => {
      stderr.push(values.map((value) => String(value)).join(" "));
    };

    await runCli(argv, {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      setExitCode: (code) => {
        exitCode = code;
      },
    });
  } finally {
    if (typeof process.exitCode === "number" && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }

    console.log = previousLog;
    console.error = previousError;
    process.chdir(previousCwd);
    restoreEnv();
    process.exitCode = undefined;
  }

  return {
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    exitCode,
  };
}

function applyEnvOverrides(overrides: Record<string, string | undefined> | undefined): () => void {
  if (!overrides) {
    return () => {};
  }

  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function runLegacyHelp(relativeScriptPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runLegacyCommand(relativeScriptPath, ["--help"]);
}

async function runLegacyCommand(
  relativeScriptPath: string,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(tsxBin, [relativeScriptPath, ...args], {
      cwd: repoRoot,
      env: process.env,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };

    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}
