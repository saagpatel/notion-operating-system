import { AsyncLocalStorage } from "node:async_hooks";

import type { RuntimeConfig } from "../config/runtime-config.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { toErrorMessage } from "../utils/errors.js";
import type { ParsedCliArgs } from "./framework.js";

export const COMMAND_WARNING_CATEGORIES = [
  "partial_success",
  "missing_credentials",
  "unsupported_provider",
  "validation_gap",
  "retry_recovered",
  "stale_data",
] as const;

export const COMMAND_FAILURE_CATEGORIES = [
  "validation_error",
  "policy_blocked",
  "provider_error",
  "reconcile_mismatch",
  "timeout_exhausted",
  "transport_error",
  "unexpected_response",
] as const;

export type CommandRunStatus = "completed" | "warning" | "partial" | "failed";
export type CommandWarningCategory = (typeof COMMAND_WARNING_CATEGORIES)[number];
export type CommandFailureCategory = (typeof COMMAND_FAILURE_CATEGORIES)[number];

export interface CommandRunSummary {
  status?: CommandRunStatus;
  mode?: "live" | "dry-run";
  rowsChanged?: number;
  pagesChanged?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsSkipped?: number;
  warningsCount?: number;
  failureCount?: number;
  retryCount?: number;
  timeoutCount?: number;
  warningCategories?: CommandWarningCategory[];
  failureCategories?: CommandFailureCategory[];
  metadata?: Record<string, unknown>;
}

interface CommandRunContext {
  commandPath: string[];
  runtimeConfig: RuntimeConfig;
  logger: RunLogger;
  startedAt: string;
  startedAtMs: number;
  summary: CommandRunSummary;
}

const storage = new AsyncLocalStorage<CommandRunContext>();

export async function withCommandRunContext<T>(
  input: {
    commandPath: string[];
    parsed: ParsedCliArgs;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const runtimeConfig = loadRuntimeConfig();
  const logger = RunLogger.fromRuntimeConfig(runtimeConfig, { mirrorToConsole: false });
  await logger.init();

  const context: CommandRunContext = {
    commandPath: input.commandPath,
    runtimeConfig,
    logger,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    summary: {
      status: "completed",
      mode: deriveCommandMode(input.parsed),
    },
  };

  await logger.info("command_started", buildLifecycleDetails(context, { status: "started" }));
  return storage.run(context, fn);
}

export async function logCommandCompleted(): Promise<void> {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  await context.logger.info("command_completed", buildLifecycleDetails(context, { status: "completed" }));
}

export async function logCommandFailed(error: unknown): Promise<void> {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  context.summary.failureCount = (context.summary.failureCount ?? 0) + 1;
  await context.logger.error(
    "command_failed",
    buildLifecycleDetails(context, {
      status: "failed",
      errorMessage: toErrorMessage(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorDetails: error instanceof Error && "details" in error ? (error as { details?: unknown }).details : undefined,
    }),
  );
}

export function getCurrentCommandLogger(): RunLogger | undefined {
  return storage.getStore()?.logger;
}

export function getCurrentCommandRuntimeConfig(): RuntimeConfig | undefined {
  return storage.getStore()?.runtimeConfig;
}

export function mergeCommandSummary(patch: Partial<CommandRunSummary>): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  const mergedStatus = mergeSummaryStatus(context.summary.status, patch.status);
  context.summary = normalizeCommandSummary({
    ...context.summary,
    ...patch,
    status: mergedStatus,
    warningCategories: mergeUniqueCategories(context.summary.warningCategories, patch.warningCategories),
    failureCategories: mergeUniqueCategories(context.summary.failureCategories, patch.failureCategories),
    metadata: {
      ...(context.summary.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
  });
}

export function incrementCommandSummary<K extends Exclude<keyof CommandRunSummary, "mode" | "metadata">>(
  key: K,
  amount = 1,
): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  const currentValue = context.summary[key];
  const currentNumber = typeof currentValue === "number" ? currentValue : 0;
  context.summary[key] = (currentNumber + amount) as CommandRunSummary[K];
}

export function getCommandRunSummary(): CommandRunSummary | undefined {
  return storage.getStore()?.summary;
}

export function recordCommandWarningCategory(
  category: CommandWarningCategory,
  options: {
    count?: number;
    status?: CommandRunStatus;
  } = {},
): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  const warningCategories = mergeUniqueCategories(context.summary.warningCategories, [category]);
  const isNewCategory = warningCategories.length !== (context.summary.warningCategories?.length ?? 0);
  const incrementBy = isNewCategory ? options.count ?? 1 : 0;

  context.summary = normalizeCommandSummary({
    ...context.summary,
    warningsCount: (context.summary.warningsCount ?? 0) + incrementBy,
    warningCategories,
    status: mergeSummaryStatus(
      context.summary.status,
      options.status ?? (category === "partial_success" ? "partial" : "warning"),
    ),
  });
}

export function recordCommandFailureCategory(
  category: CommandFailureCategory,
  options: {
    count?: number;
  } = {},
): void {
  const context = storage.getStore();
  if (!context) {
    return;
  }

  const failureCategories = mergeUniqueCategories(context.summary.failureCategories, [category]);
  const isNewCategory = failureCategories.length !== (context.summary.failureCategories?.length ?? 0);
  const incrementBy = isNewCategory ? options.count ?? 0 : 0;

  context.summary = normalizeCommandSummary({
    ...context.summary,
    failureCount: (context.summary.failureCount ?? 0) + incrementBy,
    failureCategories,
    status: mergeSummaryStatus(context.summary.status, "failed"),
  });
}

function deriveCommandMode(parsed: ParsedCliArgs): CommandRunSummary["mode"] | undefined {
  if (parsed.options.live === true) {
    return "live";
  }

  if (parsed.options.dryRun === true || parsed.options.mode === "dry-run") {
    return "dry-run";
  }

  return undefined;
}

function buildLifecycleDetails(
  context: CommandRunContext,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const summary = normalizeCommandSummary(context.summary);
  return {
    commandPath: context.commandPath.join(" "),
    profile: context.runtimeConfig.profile.name,
    profileLabel: context.runtimeConfig.profile.label,
    logFilePath: context.logger.filePath,
    startedAt: context.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - context.startedAtMs,
    summary,
    ...extra,
  };
}

function mergeSummaryStatus(
  current: CommandRunStatus | undefined,
  next: CommandRunStatus | undefined,
): CommandRunStatus | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }

  return severityRank(next) > severityRank(current) ? next : current;
}

function severityRank(status: CommandRunStatus): number {
  switch (status) {
    case "completed":
      return 0;
    case "warning":
      return 1;
    case "partial":
      return 2;
    case "failed":
      return 3;
  }
}

function mergeUniqueCategories<T extends string>(current: T[] | undefined, next: T[] | undefined): T[] {
  const merged = new Set<T>(current ?? []);
  for (const value of next ?? []) {
    merged.add(value);
  }
  return [...merged];
}

function normalizeCommandSummary(summary: CommandRunSummary): CommandRunSummary {
  const warningCategories = [...new Set(summary.warningCategories ?? [])];
  const failureCategories = [...new Set(summary.failureCategories ?? [])];
  const failureCount = summary.failureCount ?? 0;
  const warningsCount = summary.warningsCount ?? 0;
  const hasPartialSuccess = summary.status === "partial" || warningCategories.includes("partial_success");
  const hasSuccessfulWork = (summary.recordsCreated ?? 0) > 0 || (summary.recordsUpdated ?? 0) > 0 || (summary.recordsSkipped ?? 0) > 0;

  let status = summary.status;
  if (status === "failed" || failureCategories.length > 0) {
    status = "failed";
  } else if (hasPartialSuccess || (failureCount > 0 && hasSuccessfulWork)) {
    status = "partial";
  } else if (failureCount > 0) {
    status = "failed";
  } else if (warningsCount > 0 || warningCategories.length > 0 || status === "warning") {
    status = "warning";
  } else {
    status = "completed";
  }

  return {
    ...summary,
    status,
    warningCategories,
    failureCategories,
  };
}
