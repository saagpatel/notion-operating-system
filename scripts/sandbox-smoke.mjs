#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const cliPath = path.join(repoRoot, "src", "cli.ts");
const excludedEntries = new Set([
  ".git",
  ".DS_Store",
  "dist",
  "logs",
  "node_modules",
  "tmp",
  "var",
]);

await run();

async function run() {
  await assertExists(path.join(repoRoot, ".env"), "Expected a local .env for primary-profile comparison.");
  await assertExists(path.join(repoRoot, ".env.sandbox"), "Expected a local .env.sandbox for sandbox rehearsal.");

  const workspace = await createTempWorkspace();
  const baseEnv = scrubbedSandboxEnv();
  const commandPaths = [
    "control-tower sync",
    "control-tower views-validate",
    "execution sync",
    "execution views-validate",
    "intelligence sync",
    "intelligence views-validate",
    "signals sync",
    "signals views-validate",
    "governance action-request-sync",
    "governance views-validate",
  ];

  try {
    const doctor = await runJson(
      ["--profile", "sandbox", "doctor", "--json"],
      workspace,
      baseEnv,
      "sandbox doctor",
    );
    const doctorChecks = new Map((doctor.checks ?? []).map((check) => [check.id, check]));
    for (const id of [
      "notion-access",
      "destination-access",
      "sandbox-path-overrides",
      "sandbox-token-isolation",
      "sandbox-target-isolation",
    ]) {
      const check = doctorChecks.get(id);
      if (!check || check.status !== "pass") {
        throw new Error(`Sandbox doctor did not pass check "${id}".`);
      }
    }

    const controlTower = await runJson(
      ["--profile", "sandbox", "control-tower", "sync"],
      workspace,
      baseEnv,
      "control-tower dry-run",
    );
    if (controlTower.live !== false || typeof controlTower.changedRows !== "number") {
      throw new Error("Control-tower dry-run did not return the expected dry-run summary.");
    }
    if (typeof controlTower.metrics?.totalProjects !== "number") {
      throw new Error("Control-tower dry-run did not return the expected metrics payload.");
    }

    await runJson(
      ["--profile", "sandbox", "control-tower", "views-validate"],
      workspace,
      baseEnv,
      "control-tower views validate",
    );
    await runJson(
      ["--profile", "sandbox", "execution", "sync", "--live"],
      workspace,
      baseEnv,
      "execution live-safe sync",
    );
    await runJson(
      ["--profile", "sandbox", "execution", "views-validate"],
      workspace,
      baseEnv,
      "execution views validate",
    );
    await runJson(
      ["--profile", "sandbox", "intelligence", "sync", "--live"],
      workspace,
      baseEnv,
      "intelligence live-safe sync",
    );
    await runJson(
      ["--profile", "sandbox", "intelligence", "views-validate"],
      workspace,
      baseEnv,
      "intelligence views validate",
    );
    await runJson(
      ["--profile", "sandbox", "signals", "sync", "--live", "--provider", "github"],
      workspace,
      baseEnv,
      "signals live-safe sync",
    );
    await runJson(
      ["--profile", "sandbox", "signals", "views-validate"],
      workspace,
      baseEnv,
      "signals views validate",
    );
    await runJson(
      ["--profile", "sandbox", "governance", "action-request-sync", "--live"],
      workspace,
      baseEnv,
      "governance live-safe sync",
    );
    await runJson(
      ["--profile", "sandbox", "governance", "views-validate"],
      workspace,
      baseEnv,
      "governance views validate",
    );

    const recentRuns = await runJson(
      ["--profile", "sandbox", "logs", "recent", "--json"],
      workspace,
      baseEnv,
      "sandbox recent logs",
    );
    const recordedPaths = new Set((recentRuns.runs ?? []).map((run) => run.commandPath));
    for (const commandPath of commandPaths) {
      if (!recordedPaths.has(commandPath)) {
        throw new Error(`Sandbox smoke logs are missing "${commandPath}".`);
      }
    }

    process.stdout.write("Sandbox smoke passed.\n");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createTempWorkspace() {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-sandbox-smoke-"));
  const workspace = path.join(parentDir, "workspace");
  await cp(repoRoot, workspace, {
    recursive: true,
    filter: (source) => !excludedEntries.has(path.basename(source)),
  });
  return workspace;
}

function scrubbedSandboxEnv() {
  const env = { ...process.env };
  for (const key of [
    "NOTION_TOKEN",
    "NOTION_PROFILE",
    "NOTION_DESTINATIONS_PATH",
    "NOTION_LOG_DIR",
    "NOTION_RETRY_MAX_ATTEMPTS",
    "NOTION_CONTROL_TOWER_CONFIG_PATH",
  ]) {
    delete env[key];
  }
  return env;
}

async function runJson(argv, cwd, env, label) {
  const result = await runCli(argv, cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(extractTrailingJson(result.stdout));
  } catch (error) {
    throw new Error(`${label} returned non-JSON output:\n${result.stdout || String(error)}`);
  }
}

async function runCli(argv, cwd, env) {
  try {
    const { stdout, stderr } = await execFileAsync(tsxBin, [cliPath, ...argv], {
      cwd,
      env,
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

async function assertExists(filePath, errorMessage) {
  try {
    await access(filePath);
  } catch {
    throw new Error(errorMessage);
  }
}

function extractTrailingJson(stdout) {
  const trimmed = stdout.trim();
  const objectStart = trimmed.lastIndexOf("\n{");
  if (objectStart >= 0) {
    return trimmed.slice(objectStart + 1);
  }
  const arrayStart = trimmed.lastIndexOf("\n[");
  if (arrayStart >= 0) {
    return trimmed.slice(arrayStart + 1);
  }
  return trimmed;
}
