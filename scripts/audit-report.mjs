#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const [, , inputPath, ...flags] = process.argv;

if (!inputPath) {
  throw new Error(
    "Usage: node scripts/audit-report.mjs <audit-json-path> [--fail-on-vulnerabilities]",
  );
}

const failOnVulnerabilities = flags.includes("--fail-on-vulnerabilities");
let report;
try {
  report = JSON.parse(await readFile(inputPath, "utf8"));
} catch (error) {
  process.stderr.write(`Invalid audit JSON: ${error.message}\n`);
  process.exit(1);
}

if (report && Object.hasOwn(report, "error")) {
  process.stderr.write("Unusable audit report: contains an error.\n");
  process.exit(1);
}

const vulnerabilities = report?.metadata?.vulnerabilities;
if (
  !vulnerabilities ||
  typeof vulnerabilities !== "object" ||
  Array.isArray(vulnerabilities)
) {
  process.stderr.write(
    "Unusable audit report: missing metadata.vulnerabilities object.\n",
  );
  process.exit(1);
}
if (!Number.isInteger(vulnerabilities.total) || vulnerabilities.total < 0) {
  process.stderr.write(
    "Unusable audit report: vulnerabilities.total must be a non-negative integer.\n",
  );
  process.exit(1);
}

const summary = {
  ok: vulnerabilities.total === 0,
  total: vulnerabilities.total,
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
