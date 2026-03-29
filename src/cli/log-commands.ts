import { promises as fs } from "node:fs";
import path from "node:path";

import { loadRuntimeConfig } from "../config/runtime-config.js";
import type { CommandRunSummary } from "./run-observability.js";

interface LogLifecycleDetails {
  commandPath?: string;
  profile?: string;
  profileLabel?: string;
  logFilePath?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: CommandRunSummary;
}

interface LogEventRecord {
  action?: string;
  details?: LogLifecycleDetails;
}

export interface RecentRunEntry {
  commandPath: string;
  profile: string;
  profileLabel?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  logFilePath: string;
  summary: CommandRunSummary;
}

export async function runLogsRecentCommand(options: {
  json?: boolean;
  limit?: number;
} = {}): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const runs = await readRecentRuns({
    logDir: runtimeConfig.paths.logDir,
    limit: options.limit ?? 10,
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          runs,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (runs.length === 0) {
    console.log(`No completed run logs found in ${runtimeConfig.paths.logDir}.`);
    return;
  }

  const lines = [`Recent runs (${runs.length})`];
  for (const run of runs) {
    lines.push(
      `- ${run.summary.status ?? "completed"} | ${run.commandPath} | profile=${run.profile} | duration=${run.durationMs ?? 0}ms`,
    );
    lines.push(
      `  counts: created=${run.summary.recordsCreated ?? 0}, updated=${run.summary.recordsUpdated ?? 0}, skipped=${run.summary.recordsSkipped ?? 0}, warnings=${run.summary.warningsCount ?? 0}, failures=${run.summary.failureCount ?? 0}`,
    );
    if ((run.summary.warningCategories?.length ?? 0) > 0) {
      lines.push(`  warnings: ${(run.summary.warningCategories ?? []).join(", ")}`);
    }
    if ((run.summary.failureCategories?.length ?? 0) > 0) {
      lines.push(`  failures: ${(run.summary.failureCategories ?? []).join(", ")}`);
    }
    lines.push(`  completed: ${run.completedAt ?? run.startedAt ?? "unknown"} | log=${run.logFilePath}`);
  }

  console.log(lines.join("\n"));
}

export async function readRecentRuns(input: {
  logDir: string;
  limit: number;
}): Promise<RecentRunEntry[]> {
  const logDir = path.resolve(input.logDir);
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsedRuns = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map(async (entry) => parseRunLogFile(path.join(logDir, entry))),
  );

  return parsedRuns
    .filter((entry): entry is RecentRunEntry => entry !== null)
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.startedAt ?? "");
      const rightTime = Date.parse(right.completedAt ?? right.startedAt ?? "");
      return rightTime - leftTime;
    })
    .slice(0, input.limit);
}

async function parseRunLogFile(filePath: string): Promise<RecentRunEntry | null> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const events: LogEventRecord[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as LogEventRecord);
    } catch {
      return null;
    }
  }

  const lifecycle = [...events]
    .reverse()
    .find((event) => event.action === "command_completed" || event.action === "command_failed");
  if (!lifecycle?.details?.commandPath || !lifecycle.details.summary) {
    return null;
  }

  return {
    commandPath: lifecycle.details.commandPath,
    profile: lifecycle.details.profile ?? "unknown",
    profileLabel: lifecycle.details.profileLabel,
    startedAt: lifecycle.details.startedAt,
    completedAt: lifecycle.details.completedAt,
    durationMs: lifecycle.details.durationMs,
    logFilePath: lifecycle.details.logFilePath ?? filePath,
    summary: lifecycle.details.summary,
  };
}
