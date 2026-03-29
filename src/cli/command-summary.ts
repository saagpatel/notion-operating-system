import { mergeCommandSummary } from "./run-observability.js";

export function recordCommandOutputSummary(
  output: Record<string, unknown>,
  options: {
    mode?: "live" | "dry-run";
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
    metadata: summaryMetadata,
  };

  mergeCommandSummary(summary);
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
