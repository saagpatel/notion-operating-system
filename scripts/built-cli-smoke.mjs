#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const cliPath = path.join(repoRoot, "dist", "src", "cli.js");

await run();

async function run() {
  const workspace = await createTempWorkspace();

  await expectSuccess(["--help"]);
  await expectSuccess(["logs", "--help"]);
  await expectSuccess(["logs", "recent", "--help"]);
  await expectSuccess(["control-tower", "--help"]);
  await expectSuccess(["governance", "--help"]);
  await expectSuccess(["signals", "--help"]);
  await expectSuccess(["governance", "audit", "--help"]);
  await expectSuccess(["governance", "views-validate", "--help"]);
  await expectSuccess(["governance", "actuation-audit", "--help"]);
  await expectSuccess(["governance", "webhook-shadow-drain", "--help"]);
  await expectSuccess(["governance", "webhook-reconcile", "--help"]);
  await expectSuccess(["execution", "views-validate", "--help"]);
  await expectSuccess(["intelligence", "views-validate", "--help"]);
  await expectSuccess(["signals", "views-validate", "--help"]);
  await expectSuccess(["signals", "provider-expansion-audit", "--help"]);

  const doctor = await runCli(["doctor", "--json"], {
    cwd: workspace,
    env: {
      NOTION_DESTINATIONS_PATH: "./config/destinations.json",
    },
  });
  if (doctor.exitCode !== 1) {
    throw new Error(`Expected doctor --json to exit 1 on the temp workspace, got ${doctor.exitCode}`);
  }
  const doctorReport = JSON.parse(doctor.stdout);
  if (doctorReport.runtime?.profile?.name !== "default") {
    throw new Error("Built doctor smoke did not report the default profile.");
  }

  const destinations = await runCli(["destinations", "check"], {
    cwd: workspace,
    env: {
      NOTION_DESTINATIONS_PATH: "./config/destinations.json",
    },
  });
  if (destinations.exitCode !== 0) {
    throw new Error(`Built destinations check failed:\n${destinations.stderr || destinations.stdout}`);
  }
  const payload = JSON.parse(destinations.stdout);
  if (JSON.stringify(payload.aliases) !== JSON.stringify(["weekly_reviews", "command_center"])) {
    throw new Error(`Built destinations check returned unexpected aliases: ${JSON.stringify(payload)}`);
  }

  const recentRuns = await runCli(["logs", "recent", "--json"], {
    cwd: workspace,
    env: {
      NOTION_LOG_DIR: "./logs",
    },
  });
  if (recentRuns.exitCode !== 0) {
    throw new Error(`Built logs recent failed:\n${recentRuns.stderr || recentRuns.stdout}`);
  }
  const recentPayload = JSON.parse(recentRuns.stdout);
  if (!Array.isArray(recentPayload.runs) || recentPayload.runs.length < 2) {
    throw new Error(`Built logs recent returned unexpected payload: ${JSON.stringify(recentPayload)}`);
  }

  process.stdout.write("Built CLI smoke passed.\n");
}

async function expectSuccess(argv) {
  const result = await runCli(argv);
  if (result.exitCode !== 0) {
    throw new Error(`Built CLI command failed (${argv.join(" ")}):\n${result.stderr || result.stdout}`);
  }
}

async function runCli(argv, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...argv], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
    });
    return {
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code ?? 1,
    };
  }
}

async function createTempWorkspace() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-built-smoke-"));
  const configDir = path.join(tempDir, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(tempDir, ".env"), "", "utf8");
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
