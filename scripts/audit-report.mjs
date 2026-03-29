#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const [, , inputPath, ...flags] = process.argv;

if (!inputPath) {
  throw new Error("Usage: node scripts/audit-report.mjs <audit-json-path> [--fail-on-vulnerabilities]");
}

const failOnVulnerabilities = flags.includes("--fail-on-vulnerabilities");
const report = JSON.parse(await readFile(inputPath, "utf8"));
const vulnerabilities = report.metadata?.vulnerabilities ?? {};
const summary = {
  ok: Number(vulnerabilities.total ?? 0) === 0,
  total: Number(vulnerabilities.total ?? 0),
  info: Number(vulnerabilities.info ?? 0),
  low: Number(vulnerabilities.low ?? 0),
  moderate: Number(vulnerabilities.moderate ?? 0),
  high: Number(vulnerabilities.high ?? 0),
  critical: Number(vulnerabilities.critical ?? 0),
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (failOnVulnerabilities && summary.total > 0) {
  process.exitCode = 1;
}
