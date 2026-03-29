#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

await run();

async function run() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "notion-os-packed-install-"));
  const artifactsDir = path.join(workspace, "artifacts");
  const consumerDir = path.join(workspace, "consumer");

  await mkdir(artifactsDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });
  const packOutput = await runCommand(npmBin, ["pack", "--json", "--pack-destination", artifactsDir], repoRoot);
  const packEntries = JSON.parse(packOutput.stdout);
  const packEntry = packEntries.at(0);
  if (!packEntry?.filename) {
    throw new Error(`npm pack did not return a tarball filename: ${packOutput.stdout}`);
  }

  const tarballPath = path.join(artifactsDir, packEntry.filename);

  await runCommand(npmBin, ["init", "-y"], consumerDir);
  await runCommand(npmBin, ["install", "--ignore-scripts", tarballPath], consumerDir);

  await runCommand(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        "const core = await import('notion-operating-system');",
        "if (!('Publisher' in core) || !('loadRuntimeConfig' in core)) throw new Error('missing core exports');",
        "const advanced = await import('notion-operating-system/advanced');",
        "if (!('DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH' in advanced)) throw new Error('missing advanced exports');",
      ].join(" "),
    ],
    consumerDir,
  );

  const binPath = path.join(
    consumerDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "notion-os.cmd" : "notion-os",
  );
  const help = await runCommand(binPath, ["--help"], consumerDir);
  if (!help.stdout.includes("notion-os")) {
    throw new Error(`Installed notion-os bin did not print help output:\n${help.stdout}\n${help.stderr}`);
  }

  process.stdout.write("Packed install smoke passed.\n");
}

async function runCommand(command, args, cwd) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error;
    throw new Error(
      `Command failed in ${cwd}: ${command} ${args.join(" ")}\n${failure.stderr || failure.stdout || failure.message}`,
    );
  }
}
