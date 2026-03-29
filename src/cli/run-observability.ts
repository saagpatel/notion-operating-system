import { AsyncLocalStorage } from "node:async_hooks";

import type { RuntimeConfig } from "../config/runtime-config.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { toErrorMessage } from "../utils/errors.js";
import type { ParsedCliArgs } from "./framework.js";

export interface CommandRunSummary {
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

  context.summary = {
    ...context.summary,
    ...patch,
    metadata: {
      ...(context.summary.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
  };
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
  return {
    commandPath: context.commandPath.join(" "),
    profile: context.runtimeConfig.profile.name,
    profileLabel: context.runtimeConfig.profile.label,
    logFilePath: context.logger.filePath,
    startedAt: context.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - context.startedAtMs,
    summary: context.summary,
    ...extra,
  };
}
