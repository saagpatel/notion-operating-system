#!/usr/bin/env node

import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const excludedEntries = new Set([
  ".git",
  ".DS_Store",
  ".env",
  "dist",
  "logs",
  "node_modules",
  "tmp",
  "var",
]);

await run();

async function run() {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-fresh-clone-"));
  const workspace = path.join(parentDir, "repo");
  await runCommand("git", ["clone", "--no-local", repoRoot, workspace], parentDir);
  await copyWorkspace(repoRoot, workspace);

  await runCommand(npmBin, ["ci"], workspace);
  await runCommand(npmBin, ["run", "build"], workspace);
  await runCommand(npmBin, ["run", "verify"], workspace);

  const scrubbedEnv = { ...process.env };
  for (const key of [
    "NOTION_TOKEN",
    "NOTION_PROFILE",
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "GOOGLE_CALENDAR_TOKEN",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY_PEM",
    "GITHUB_APP_WEBHOOK_SECRET",
    "VERCEL_WEBHOOK_SECRET",
    "GITHUB_BREAK_GLASS_TOKEN",
    "VERCEL_BREAK_GLASS_TOKEN",
  ]) {
    delete scrubbedEnv[key];
  }

  const tsxBin = path.join(
    workspace,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  const doctor = await runCommand(tsxBin, ["src/cli.ts", "doctor", "--json"], workspace, {
    allowFailure: true,
    env: scrubbedEnv,
  });
  if (doctor.exitCode !== 1) {
    throw new Error(`Expected doctor --json to exit 1 without local secrets, got ${doctor.exitCode}.`);
  }
  const report = JSON.parse(doctor.stdout);
  if (report.runtime?.profile?.name !== "default") {
    throw new Error("Fresh clone doctor report did not resolve the default profile.");
  }

  process.stdout.write("Fresh clone verification passed.\n");
}

async function copyWorkspace(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludedEntries.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    await cp(sourcePath, targetPath, {
      recursive: true,
      preserveTimestamps: true,
    });
  }
}

async function runCommand(command, args, cwd, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: options.env ?? process.env,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    if (options.allowFailure) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exitCode: error.code ?? 1,
      };
    }

    const failure = error;
    throw new Error(
      `Command failed in ${cwd}: ${command} ${args.join(" ")}\n${failure.stderr || failure.stdout || failure.message}`,
    );
  }
}
