import type { CommandRunStatus } from "../cli/run-observability.js";

export type WeeklyRefreshStepStatus =
  | "clean"
  | "drift"
  | "completed"
  | "partial"
  | "failed"
  | "skipped";

export interface WeeklyRefreshStepContract {
  status: WeeklyRefreshStepStatus;
  wouldChange: boolean;
  live: boolean;
  summaryCounts: Record<string, number>;
  warnings: string[];
  skippedReason?: string;
}

export function buildWeeklyStepContract(input: {
  live: boolean;
  wouldChange: boolean;
  summaryCounts?: Record<string, number>;
  warnings?: string[];
  status?: WeeklyRefreshStepStatus;
  skippedReason?: string;
}): WeeklyRefreshStepContract {
  const summaryCounts = normalizeSummaryCounts(input.summaryCounts);
  const warnings = input.warnings ?? [];
  const status =
    input.status ??
    (input.skippedReason
      ? "skipped"
      : input.live
        ? input.wouldChange
          ? "completed"
          : "clean"
        : input.wouldChange
          ? "drift"
          : "clean");

  return {
    status,
    wouldChange: input.wouldChange,
    live: input.live,
    summaryCounts,
    warnings,
    skippedReason: input.skippedReason,
  };
}

export function mapWeeklyStepStatusToCommandStatus(
  status: WeeklyRefreshStepStatus,
): CommandRunStatus {
  switch (status) {
    case "drift":
      return "warning";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    case "clean":
    case "completed":
    case "skipped":
    default:
      return "completed";
  }
}

function normalizeSummaryCounts(
  summaryCounts: Record<string, number> | undefined,
): Record<string, number> {
  if (!summaryCounts) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(summaryCounts).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}
