import type { CommandFailureCategory, CommandRunStatus, CommandWarningCategory } from "./run-observability.js";
import { mergeCommandSummary } from "./run-observability.js";

export function recordCommandOutputSummary(
  output: Record<string, unknown>,
  options: {
    mode?: "live" | "dry-run";
    status?: CommandRunStatus;
    warningCategories?: CommandWarningCategory[];
    failureCategories?: CommandFailureCategory[];
    metadata?: Record<string, unknown>;
  } = {},
): void {
  const summaryMetadata: Record<string, unknown> = {
    ...(options.metadata ?? {}),
  };

  if (output.ok !== undefined) {
    summaryMetadata.ok = output.ok;
  }

  const summary = {
    status: options.status ?? inferStatus(output),
    mode: options.mode ?? inferMode(output),
    rowsChanged: firstNumber(output, ["changedRows", "changedProjectPages", "projectsUpdated"]),
    pagesChanged: firstNumber(output, ["pagesChanged", "touchedProjects"]),
    recordsCreated: firstNumber(output, ["recordsCreated", "createdCount", "seededCount", "candidateCount"]),
    recordsUpdated: firstNumber(
      output,
      ["recordsUpdated", "updatedCount", "verifiedDeliveryCount", "decisionsUpserted", "lastActiveUpdates", "buildDateUpdates", "buildRelationUpdates"],
    ),
    recordsSkipped: firstNumber(output, ["recordsSkipped", "skippedCount"]),
    warningsCount: firstNumber(output, ["warningsCount", "warningCount"]),
    failureCount: firstNumber(output, ["failureCount", "failures"]),
    warningCategories: options.warningCategories,
    failureCategories: options.failureCategories,
    metadata: summaryMetadata,
  };

  mergeCommandSummary(summary);
}

function inferStatus(output: Record<string, unknown>): CommandRunStatus | undefined {
  if (output.status === "completed" || output.status === "warning" || output.status === "partial" || output.status === "failed") {
    return output.status;
  }

  const failureCount = firstNumber(output, ["failureCount", "failures"]);
  if (typeof failureCount === "number" && failureCount > 0) {
    return "failed";
  }

  const warningCount = firstNumber(output, ["warningsCount", "warningCount"]);
  if (typeof warningCount === "number" && warningCount > 0) {
    return "warning";
  }

  return undefined;
}

function inferMode(output: Record<string, unknown>): "live" | "dry-run" | undefined {
  if (output.mode === "live" || output.mode === "dry-run") {
    return output.mode;
  }

  if (typeof output.live === "boolean") {
    return output.live ? "live" : "dry-run";
  }

  if (typeof output.dryRun === "boolean") {
    return output.dryRun ? "dry-run" : "live";
  }

  return undefined;
}

function firstNumber(output: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}
