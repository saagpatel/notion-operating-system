#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const BLOCKED_PATTERNS = [
  /^\.env$/,
  /^\.env\.(?!example$)/,
  /^logs\//,
  /^tmp\//,
  /^dist\//,
  /^node_modules\//,
  /^var\//,
  /^coverage\//,
  /\.log$/i,
  /\.jsonl$/i,
  /^\.DS_Store$/,
];

export function validateStagedFiles(files) {
  const blocked = files.filter((file) => BLOCKED_PATTERNS.some((pattern) => pattern.test(file)));

  return {
    ok: blocked.length === 0,
    blocked,
  };
}

export function getStagedFiles() {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  });

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const files = process.argv.slice(2);
  const stagedFiles = files.length > 0 ? files : getStagedFiles();
  const result = validateStagedFiles(stagedFiles);

  if (result.ok) {
    return;
  }

  console.error("Refusing to commit staged machine-local or generated files:");
  for (const file of result.blocked) {
    console.error(`- ${file}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
