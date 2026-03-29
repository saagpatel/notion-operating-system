#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(repoRoot, "tmp", "release");
const manifestPath = path.join(releaseDir, "pack-result.json");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const requiredEntries = [
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
  "package/CHANGELOG.md",
  "package/dist/src/index.js",
  "package/dist/src/advanced.js",
  "package/dist/src/cli.js",
];
const forbiddenPrefixes = [
  "package/src/",
  "package/docs/",
  "package/tests/",
  "package/node_modules/",
  "package/.github/",
  "package/logs/",
  "package/tmp/",
  "package/var/",
];

await run();

async function run() {
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  const packOutput = await runCommand(npmBin, ["pack", "--json", "--pack-destination", releaseDir]);
  const packEntries = JSON.parse(packOutput.stdout);
  const packEntry = packEntries.at(0);
  if (!packEntry?.filename) {
    throw new Error(`npm pack did not return a tarball filename: ${packOutput.stdout}`);
  }

  const tarballPath = path.join(releaseDir, packEntry.filename);
  const tarListing = await runCommand("tar", ["-tf", tarballPath]);
  const entries = tarListing.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const requiredEntry of requiredEntries) {
    if (!entries.includes(requiredEntry)) {
      throw new Error(`Packed tarball is missing required entry: ${requiredEntry}`);
    }
  }

  for (const forbiddenPrefix of forbiddenPrefixes) {
    if (entries.some((entry) => entry.startsWith(forbiddenPrefix))) {
      throw new Error(`Packed tarball unexpectedly includes repo-only content under ${forbiddenPrefix}`);
    }
  }

  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const result = {
    ok: true,
    packageName: packageJson.name,
    version: packageJson.version,
    tarballPath,
    tarballFilename: packEntry.filename,
    shasum: packEntry.shasum,
    integrity: packEntry.integrity,
    releaseDir,
  };

  await writeFile(manifestPath, JSON.stringify(result, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runCommand(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: repoRoot,
      env: process.env,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const failure = error;
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${failure.stderr || failure.stdout || failure.message}`,
    );
  }
}
