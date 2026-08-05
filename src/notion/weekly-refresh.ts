import { spawn } from "node:child_process";
import path from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  addDays,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  diffDays,
  loadLocalPortfolioControlTowerConfig,
  renderFreshnessByLayerSection,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { FRESHNESS_COMMAND_CENTER_SECTION } from "./managed-markdown-sections.js";
import {
  isReadBackRecoverableMarkdownError,
  syncManagedMarkdownSectionWithReadBack,
} from "./managed-markdown-sync.js";
import { mergeManagedSection, normalizeMarkdown } from "../utils/markdown.js";
import { losAngelesToday } from "../utils/date.js";
import { extractNotionIdFromUrl } from "../utils/notion-id.js";
import {
  buildWeeklyStepContract,
  mapWeeklyStepStatusToCommandStatus,
  type WeeklyRefreshStepContract,
  type WeeklyRefreshStepStatus,
} from "./weekly-refresh-contract.js";

type WeeklyRefreshOverallStatus = "clean" | "completed" | "partial" | "failed";

interface WeeklyRefreshCommandOptions {
  fast?: boolean;
  live?: boolean;
  confirmFullLive?: boolean;
  today?: string;
  config?: string;
  owner?: string;
  signalSourceLimit?: number;
  signalMaxEventsPerSource?: number;
  only?: string[];
  skip?: string[];
  maxProjectPages?: number;
  projectOffset?: number;
  projectConcurrency?: number;
  stepTimeoutMinutes?: number;
  maxStepAttempts?: number;
  summaryFirst?: boolean;
  skipKnownBlockedMarkdown?: boolean;
  streamChildOutput?: boolean;
}

export interface WeeklyRefreshStepDefinition {
  key: string;
  title: string;
  kind: "cli" | "script";
  args: string[];
  timeoutMs: number;
  skipAfterControlTowerFailure?: boolean;
}

interface WeeklyRefreshStepResult extends WeeklyRefreshStepContract {
  key: string;
  title: string;
  durationMs: number;
  output?: Record<string, unknown>;
  error?: string;
  failureCategory?: "transport_error" | "timeout_exhausted" | "validation_error" | "unexpected_response" | "provider_error";
  attempts?: number;
}

class WeeklyStepExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly category: NonNullable<WeeklyRefreshStepResult["failureCategory"]>,
  ) {
    super(message);
    this.name = "WeeklyStepExecutionError";
  }
}

interface WeeklyRefreshOutput {
  ok: true;
  liveRequested: boolean;
  liveExecuted: boolean;
  needsLiveWrite: boolean;
  status: WeeklyRefreshOverallStatus;
  today: string;
  config: string;
  preflight: {
    steps: WeeklyRefreshStepResult[];
    summary: Record<string, number>;
  };
  liveRun?: {
    steps: WeeklyRefreshStepResult[];
    summary: Record<string, number>;
  };
  freshness?: Record<string, string | undefined>;
  catchUp?: WeeklyRefreshCatchUpStatus;
}

export interface WeeklyRefreshCatchUpStatus {
  previousRunAt?: string;
  today: string;
  gapDays: number;
  missedRunDays: number;
  missedWeekdays: number;
  catchUpMode: "none" | "weekday_catch_up" | "weekend_catch_up";
  staleDataThresholdDays: number;
  staleBeforeRun: boolean;
  recovered: boolean;
  summary: string;
}

const DEFAULT_OWNER = "saagpatel";
const WEEKLY_STEP_KEYS = [
  "support-maintenance",
  "control-tower-sync",
  "execution-sync",
  "intelligence-sync",
  "review-packet",
  "external-signals",
] as const;

type WeeklyStepKey = (typeof WEEKLY_STEP_KEYS)[number];

const POST_LIVE_FRESHNESS_TIMEOUT_MS = 20_000;
const SLOW_STEP_THRESHOLD_MS = 30_000;
const WEEKLY_PROGRESS_ENV = "NOTION_WEEKLY_PROGRESS";
const EXTERNAL_SIGNAL_LIVE_PROJECT_BATCH_SIZE = 20;
const MISSED_RUN_STALE_THRESHOLD_DAYS = 2;
const OPERATOR_CATCH_UP_DAYS = new Set([0, 5, 6]);

export async function runWeeklyRefreshCommand(
  options: WeeklyRefreshCommandOptions = {},
): Promise<void> {
  resolveRequiredNotionToken("NOTION_TOKEN is required for the weekly refresh orchestrator");

  const flags = {
    fast: options.fast ?? false,
    live: options.live ?? false,
    confirmFullLive: options.confirmFullLive ?? false,
    today: options.today ?? losAngelesToday(),
    config: options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
    owner: options.owner ?? DEFAULT_OWNER,
    signalSourceLimit: options.signalSourceLimit ?? (options.fast ? 5 : undefined),
    signalMaxEventsPerSource: options.signalMaxEventsPerSource ?? (options.fast ? 5 : undefined),
    only: normalizeStepSelection(options.only),
    skip: normalizeStepSelection(options.skip),
    maxProjectPages: options.maxProjectPages ?? (options.fast ? 10 : undefined),
    projectOffset: options.projectOffset,
    projectConcurrency: options.projectConcurrency ?? (options.fast ? 2 : 1),
    stepTimeoutMinutes: options.stepTimeoutMinutes,
    maxStepAttempts: options.maxStepAttempts ?? (options.fast ? 2 : 5),
    summaryFirst: applyFastBooleanDefault(options.summaryFirst, options.fast),
    skipKnownBlockedMarkdown: applyFastBooleanDefault(
      options.skipKnownBlockedMarkdown,
      options.fast,
    ),
    streamChildOutput: applyFastBooleanDefault(
      options.streamChildOutput,
      options.fast,
    ),
  };
  validateWeeklyRefreshFlags(flags);
  const shouldPersistFullRunState = shouldPersistWeeklyRefreshState({
    live: flags.live,
    only: flags.only,
    skip: flags.skip,
  });
  if (flags.live && !flags.confirmFullLive) {
    throw new Error(
      [
        "Full weekly live refresh is guarded because it can run long multi-lane Notion write loops.",
        "For targeted repair, use the specific lane command and verify it with dry-run/live/dry-run.",
        "To run the full weekly live sequence anyway, pass --confirm-full-live.",
      ].join(" "),
    );
  }
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const externalSignalSourceLimit =
    flags.signalSourceLimit ?? config.phase5ExternalSignals?.syncLimits.maxProjectsInFirstWave ?? 15;
  const externalSignalMaxEventsPerSource =
    flags.signalMaxEventsPerSource ?? Math.min(config.phase5ExternalSignals?.syncLimits.maxEventsPerSource ?? 25, 5);

  const preflightDefinitions = buildStepDefinitions(flags, false, externalSignalSourceLimit, externalSignalMaxEventsPerSource);
  const preflightSteps = await runWeeklyRefreshSteps(preflightDefinitions, {
    maxStepAttempts: flags.maxStepAttempts,
    stopAfterControlTowerFailure: false,
    streamChildOutput: flags.streamChildOutput,
  });
  const preflightSummary = summarizeStepResults(preflightSteps);
  const needsLiveWrite = preflightSteps.some((step) => step.wouldChange);
  const preflightStatus = aggregateOverallStatus(preflightSteps, false);

  let liveRun:
    | {
        steps: WeeklyRefreshStepResult[];
        summary: Record<string, number>;
      }
    | undefined;
  let liveExecuted = false;
  let overallStatus: WeeklyRefreshOverallStatus = preflightStatus;

  logHumanSummary("Preflight", preflightSteps, needsLiveWrite);

  if (flags.live && needsLiveWrite && preflightStatus !== "failed" && preflightStatus !== "partial") {
    assertWeeklyLiveAuthorityBoundary(preflightSteps);
    const liveDefinitions = buildStepDefinitions(flags, true, externalSignalSourceLimit, externalSignalMaxEventsPerSource);
    assertSameWeeklyStepPlan(preflightDefinitions, liveDefinitions);
    const liveSteps = await runWeeklyRefreshSteps(liveDefinitions, {
      maxStepAttempts: flags.maxStepAttempts,
      stopAfterControlTowerFailure: true,
      streamChildOutput: flags.streamChildOutput,
    });
    const liveSummary = summarizeStepResults(liveSteps);
    liveRun = {
      steps: liveSteps,
      summary: liveSummary,
    };
    liveExecuted = true;
    overallStatus = aggregateOverallStatus(liveSteps, true);
    logHumanSummary("Live", liveSteps, false);
  } else if (flags.live && (preflightStatus === "failed" || preflightStatus === "partial")) {
    overallStatus = preflightStatus;
    logHumanMessage("Live run skipped because the preflight found a failing or partial step.");
  } else if (flags.live && !needsLiveWrite) {
    overallStatus = "clean";
    logHumanMessage("Live run skipped because the preflight is already clean.");
  }

  let freshness: Record<string, string | undefined> | undefined;
  const catchUp = buildWeeklyRefreshCatchUpStatus({
    previousRunAt: config.weeklyMaintenance?.weeklyRefreshLastRunAt,
    today: flags.today,
    status: overallStatus,
    needsLiveWrite,
    liveExecuted,
  });
  if (shouldPersistFullRunState) {
    freshness = await persistWeeklyRefreshState({
      configPath: flags.config,
      today: flags.today,
      status: overallStatus,
      liveExecuted,
      needsLiveWrite,
      catchUp,
      preflightSummary,
      liveSummary: liveRun?.summary,
      allowCommandCenterReplacement: true,
    });
  } else if (flags.live) {
    logHumanMessage("Targeted live refresh completed without rewriting full-run weekly freshness state.");
  }

  const output: WeeklyRefreshOutput = {
    ok: true,
    liveRequested: flags.live,
    liveExecuted,
    needsLiveWrite,
    status: overallStatus,
    today: flags.today,
    config: flags.config,
    preflight: {
      steps: preflightSteps,
      summary: preflightSummary,
    },
    liveRun,
    freshness,
    catchUp,
  };

  recordCommandOutputSummary(output as unknown as Record<string, unknown>, {
    status: mapWeeklyStepStatusToCommandStatus(overallStatus),
    metadata: {
      fast: flags.fast,
      needsLiveWrite,
      liveExecuted,
    },
  });
  if (flags.summaryFirst) {
    console.log(JSON.stringify(buildWeeklyRefreshQuickSummary(output), null, 2));
  }
  console.log(JSON.stringify(output, null, 2));
}

export function assertSameWeeklyStepPlan(
  preflight: WeeklyRefreshStepDefinition[],
  live: WeeklyRefreshStepDefinition[],
): void {
  const signature = (steps: WeeklyRefreshStepDefinition[]) =>
    steps.map((step) => `${step.key}:${step.kind}:${step.title}`).join("|");
  if (signature(preflight) !== signature(live)) {
    throw new Error("Weekly live step plan differs from the plan validated during preflight.");
  }
}

function buildStepDefinitions(
  flags: {
    live: boolean;
    today: string;
    config: string;
    owner: string;
    signalSourceLimit?: number;
    signalMaxEventsPerSource?: number;
    only?: WeeklyStepKey[];
    skip?: WeeklyStepKey[];
    maxProjectPages?: number;
    projectOffset?: number;
    projectConcurrency: number;
    stepTimeoutMinutes?: number;
    skipKnownBlockedMarkdown: boolean;
  },
  live: boolean,
  externalSignalSourceLimit: number,
  externalSignalMaxEventsPerSource: number,
): WeeklyRefreshStepDefinition[] {
  const sharedArgs = buildSharedArgs(flags, live);
  const steps: WeeklyRefreshStepDefinition[] = [
    {
      key: "support-maintenance",
      title: "GitHub Support Maintenance",
      kind: "script",
      // The combined support surface spans two product actions and is
      // intentionally dry-run-only. A full weekly live pass may re-check a
      // clean support preflight, but it must never forward live authority to
      // this wrapper.
      args: buildWeeklySupportMaintenanceArgs(flags),
      timeoutMs: 10 * 60 * 1000,
    },
    {
      key: "control-tower-sync",
      title: "Control Tower Sync",
      kind: "cli",
      args: ["control-tower", "sync", ...sharedArgs],
      timeoutMs: 10 * 60 * 1000,
      skipAfterControlTowerFailure: false,
    },
    {
      key: "execution-sync",
      title: "Execution Sync",
      kind: "cli",
      args: [
        "execution",
        "sync",
        ...sharedArgs,
        ...(flags.maxProjectPages === undefined ? [] : ["--project-limit", String(flags.maxProjectPages)]),
        ...(flags.projectOffset === undefined ? [] : ["--project-offset", String(flags.projectOffset)]),
        "--project-concurrency",
        String(flags.projectConcurrency),
        ...(flags.skipKnownBlockedMarkdown ? ["--skip-known-blocked-markdown"] : []),
      ],
      timeoutMs: 15 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
    {
      key: "intelligence-sync",
      title: "Intelligence Sync",
      kind: "cli",
      args: [
        "intelligence",
        "sync",
        ...sharedArgs,
        ...(flags.maxProjectPages === undefined ? [] : ["--project-limit", String(flags.maxProjectPages)]),
        ...(flags.projectOffset === undefined ? [] : ["--project-offset", String(flags.projectOffset)]),
        "--project-concurrency",
        String(flags.projectConcurrency),
        ...(flags.skipKnownBlockedMarkdown ? ["--skip-known-blocked-markdown"] : []),
      ],
      timeoutMs: 15 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
    {
      key: "review-packet",
      title: "Weekly Review Packet",
      kind: "cli",
      args: ["control-tower", "review-packet", ...sharedArgs],
      timeoutMs: 10 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
    {
      key: "external-signals",
      title: "External Signal Sync",
      kind: "cli",
      args: buildExternalSignalStepArgs({
        flags,
        sharedArgs,
        externalSignalSourceLimit,
        externalSignalMaxEventsPerSource,
      }),
      timeoutMs: 20 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
  ];
  const expandedSteps = expandExternalSignalLiveProjectBatches(steps, flags, live, {
    sharedArgs,
    externalSignalSourceLimit,
    externalSignalMaxEventsPerSource,
  });
  return applyStepFilters(
    flags.stepTimeoutMinutes === undefined
      ? expandedSteps
      : expandedSteps.map((step) => ({
          ...step,
          timeoutMs: Math.max(
            step.timeoutMs,
            Math.max(1, flags.stepTimeoutMinutes!) * 60 * 1000,
          ),
        })),
    {
      only: flags.only,
      skip: flags.skip,
    },
  );
}

function buildExternalSignalStepArgs(input: {
  flags: {
    maxProjectPages?: number;
    projectOffset?: number;
    projectConcurrency: number;
    skipKnownBlockedMarkdown: boolean;
  };
  sharedArgs: string[];
  externalSignalSourceLimit: number;
  externalSignalMaxEventsPerSource: number;
  projectLimitOverride?: number;
  projectOffsetOverride?: number;
  projectConcurrencyOverride?: number;
}): string[] {
  const projectLimit = input.projectLimitOverride ?? input.flags.maxProjectPages;
  const projectOffset = input.projectOffsetOverride ?? input.flags.projectOffset;
  const projectConcurrency =
    input.projectConcurrencyOverride ?? input.flags.projectConcurrency;
  return [
    "signals",
    "sync",
    ...input.sharedArgs,
    "--provider",
    "github",
    "--source-limit",
    String(input.externalSignalSourceLimit),
    "--max-events-per-source",
    String(input.externalSignalMaxEventsPerSource),
    ...(projectLimit === undefined && projectOffset === undefined
      ? []
      : ["--write-scope", "project-pages"]),
    ...(projectLimit === undefined ? [] : ["--project-limit", String(projectLimit)]),
    ...(projectOffset === undefined ? [] : ["--project-offset", String(projectOffset)]),
    "--project-concurrency",
    String(projectConcurrency),
    ...(input.flags.skipKnownBlockedMarkdown ? ["--skip-known-blocked-markdown"] : []),
  ];
}

export function expandExternalSignalLiveProjectBatches(
  steps: WeeklyRefreshStepDefinition[],
  flags: {
    maxProjectPages?: number;
    projectOffset?: number;
    projectConcurrency: number;
    skipKnownBlockedMarkdown: boolean;
  },
  live: boolean,
  context: {
    sharedArgs: string[];
    externalSignalSourceLimit: number;
    externalSignalMaxEventsPerSource: number;
  },
): WeeklyRefreshStepDefinition[] {
  if (
    !live ||
    flags.projectOffset !== undefined ||
    flags.maxProjectPages === undefined ||
    flags.maxProjectPages <= EXTERNAL_SIGNAL_LIVE_PROJECT_BATCH_SIZE
  ) {
    return steps;
  }

  return steps.flatMap((step) => {
    if (step.key !== "external-signals") {
      return [step];
    }

    const batches = buildProjectBatches(
      flags.maxProjectPages!,
      EXTERNAL_SIGNAL_LIVE_PROJECT_BATCH_SIZE,
    );
    return batches.map((batch, index) => ({
      ...step,
      title: `${step.title} (batch ${index + 1}/${batches.length})`,
      args: buildExternalSignalStepArgs({
        flags,
        sharedArgs: context.sharedArgs,
        externalSignalSourceLimit: context.externalSignalSourceLimit,
        externalSignalMaxEventsPerSource: context.externalSignalMaxEventsPerSource,
        projectLimitOverride: batch.limit,
        projectOffsetOverride: batch.offset,
        projectConcurrencyOverride: 1,
      }),
    }));
  });
}

function buildProjectBatches(
  totalLimit: number,
  batchSize: number,
): Array<{ offset: number; limit: number }> {
  const batches: Array<{ offset: number; limit: number }> = [];
  for (let offset = 0; offset < totalLimit; offset += batchSize) {
    batches.push({
      offset,
      limit: Math.min(batchSize, totalLimit - offset),
    });
  }
  return batches;
}

function buildSharedArgs(
  flags: { today: string; config: string },
  live: boolean,
): string[] {
  const args = ["--today", flags.today, "--config", flags.config];
  if (live) {
    args.unshift("--live");
  }
  return args;
}

export function buildWeeklySupportMaintenanceArgs(flags: {
  today: string;
  config: string;
  owner: string;
}): string[] {
  return [
    "src/internal/notion-maintenance/github-support-maintenance.ts",
    ...buildSharedArgs(flags, false),
    "--owner",
    flags.owner,
  ];
}

async function runWeeklyRefreshSteps(
  steps: WeeklyRefreshStepDefinition[],
  options: {
    maxStepAttempts: number;
    stopAfterControlTowerFailure: boolean;
    streamChildOutput: boolean;
  },
): Promise<WeeklyRefreshStepResult[]> {
  const results: WeeklyRefreshStepResult[] = [];
  let controlTowerFailed = false;

  for (const step of steps) {
    if (controlTowerFailed && step.skipAfterControlTowerFailure) {
      results.push(
        buildSkippedStep(step, step.args.includes("--live"), "Skipped because control-tower sync failed."),
      );
      continue;
    }

    const result = await runStep(step, {
      maxStepAttempts: options.maxStepAttempts,
      streamChildOutput: options.streamChildOutput,
    });
    results.push(result);

    if (options.stopAfterControlTowerFailure && step.key === "control-tower-sync" && result.status === "failed") {
      controlTowerFailed = true;
    }
  }

  return results;
}

async function runStep(
  step: WeeklyRefreshStepDefinition,
  options: { maxStepAttempts: number; streamChildOutput: boolean },
): Promise<WeeklyRefreshStepResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown;
  const maxAttempts = options.maxStepAttempts;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      if (options.streamChildOutput) {
        logHumanMessage(
          `Starting ${step.args.includes("--live") ? "live" : "preflight"} step: ${step.title} (attempt ${attempts}/${maxAttempts}).`,
        );
      }
      const output = await runJsonCommand(step, {
        streamChildOutput: options.streamChildOutput,
      });
      const contract = toStepContract(output, step.args.includes("--live"));
      if (options.streamChildOutput) {
        logHumanMessage(
          `Finished ${step.title}: ${contract.status} in ${formatDuration(Date.now() - startedAt)}.`,
        );
      }
      return {
        key: step.key,
        title: step.title,
        durationMs: Date.now() - startedAt,
        attempts,
        ...contract,
        output,
      };
    } catch (error) {
      lastError = error;
      if (!shouldRetryStepError(error) || attempts >= maxAttempts) {
        break;
      }
      logHumanMessage(`${step.title} hit a transient network error. Retrying (${attempts}/${maxAttempts}).`);
      await waitMs(Math.min(30_000, attempts * attempts * 2_000));
    }
  }
  return {
    key: step.key,
    title: step.title,
    durationMs: Date.now() - startedAt,
    attempts,
    ...buildWeeklyStepContract({
      live: step.args.includes("--live"),
      wouldChange: false,
      status: "failed",
      warnings: [],
    }),
    error: lastError instanceof Error ? lastError.message : String(lastError),
    failureCategory: classifyStepError(lastError),
  };
}

function toStepContract(
  output: Record<string, unknown>,
  live: boolean,
): WeeklyRefreshStepContract {
  const status = typeof output.status === "string" ? output.status as WeeklyRefreshStepStatus : undefined;
  const wouldChange = typeof output.wouldChange === "boolean"
    ? output.wouldChange
    : inferWouldChange(output);
  const summaryCounts = isRecord(output.summaryCounts) ? numericRecord(output.summaryCounts) : undefined;
  const warnings = Array.isArray(output.warnings)
    ? output.warnings.filter((value): value is string => typeof value === "string")
    : [];
  const skippedReason = typeof output.skippedReason === "string" ? output.skippedReason : undefined;

  return buildWeeklyStepContract({
    live,
    status,
    wouldChange,
    summaryCounts,
    warnings,
    skippedReason,
  });
}

async function runJsonCommand(
  step: WeeklyRefreshStepDefinition,
  options: { streamChildOutput: boolean },
): Promise<Record<string, unknown>> {
  const commandPath =
    step.kind === "cli"
      ? ["src/cli.ts", ...step.args]
      : step.args;
  const tsxPath = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  const child = spawn(tsxPath, commandPath, {
    cwd: process.cwd(),
    env: buildWeeklyRefreshChildEnv(process.env, options.streamChildOutput),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr += text;
    if (options.streamChildOutput) {
      process.stderr.write(prefixChildStderr(step.title, text));
    }
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new WeeklyStepExecutionError(
        `${step.title} timed out after ${Math.round(step.timeoutMs / 60000)} minutes.`,
        true,
        "timeout_exhausted",
      ));
    }, step.timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `${step.title} exited with code ${exitCode}`;
    const retryable = /fetch failed|ETIMEDOUT|ECONNRESET|ENETUNREACH|timed out|transport/i.test(message);
    throw new WeeklyStepExecutionError(
      message,
      retryable,
      retryable ? "transport_error" : "unexpected_response",
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${step.title} did not return JSON output.`);
  }
  return parseLastJsonObject(trimmed, step.title);
}

function prefixChildStderr(stepTitle: string, text: string): string {
  return text
    .split(/(?<=\n)/)
    .filter((line) => line.length > 0)
    .map((line) => `[weekly-refresh:${stepTitle}] ${line}`)
    .join("");
}

export function buildWeeklyRefreshChildEnv(
  env: NodeJS.ProcessEnv,
  streamChildOutput: boolean,
): NodeJS.ProcessEnv {
  const next = { ...env };
  if (streamChildOutput) {
    next[WEEKLY_PROGRESS_ENV] = "1";
  } else {
    delete next[WEEKLY_PROGRESS_ENV];
  }
  return next;
}

function buildSkippedStep(
  step: WeeklyRefreshStepDefinition,
  live: boolean,
  skippedReason: string,
): WeeklyRefreshStepResult {
  return {
    key: step.key,
    title: step.title,
    durationMs: 0,
    ...buildWeeklyStepContract({
      live,
      wouldChange: false,
      skippedReason,
    }),
  };
}

function summarizeStepResults(steps: WeeklyRefreshStepResult[]): Record<string, number> {
  return {
    totalSteps: steps.length,
    cleanSteps: steps.filter((step) => step.status === "clean").length,
    driftSteps: steps.filter((step) => step.status === "drift").length,
    completedSteps: steps.filter((step) => step.status === "completed").length,
    partialSteps: steps.filter((step) => step.status === "partial").length,
    failedSteps: steps.filter((step) => step.status === "failed").length,
    skippedSteps: steps.filter((step) => step.status === "skipped").length,
  };
}

function aggregateOverallStatus(
  steps: WeeklyRefreshStepResult[],
  live: boolean,
): WeeklyRefreshOverallStatus {
  if (steps.some((step) => step.status === "failed")) {
    return "failed";
  }
  if (steps.some((step) => step.status === "partial" || step.status === "skipped")) {
    return "partial";
  }
  if (live) {
    return steps.some((step) => step.status === "completed") ? "completed" : "clean";
  }
  return steps.some((step) => step.status === "drift") ? "completed" : "clean";
}

export function normalizeStepSelection(values: string[] | undefined): WeeklyStepKey[] | undefined {
  const selected = (values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (selected.length === 0) {
    return undefined;
  }
  const invalid = selected.filter((value) => !isWeeklyStepKey(value));
  if (invalid.length > 0) {
    throw new Error(`Unknown weekly refresh step(s): ${invalid.join(", ")}. Valid steps: ${WEEKLY_STEP_KEYS.join(", ")}`);
  }
  return [...new Set(selected)] as WeeklyStepKey[];
}

export function applyStepFilters(
  steps: WeeklyRefreshStepDefinition[],
  filters: {
    only?: WeeklyStepKey[];
    skip?: WeeklyStepKey[];
  },
): WeeklyRefreshStepDefinition[] {
  if (filters.only?.length && filters.skip?.length) {
    throw new Error("--only and --skip cannot be used together");
  }
  if (filters.only?.length) {
    return steps.filter((step) => filters.only!.includes(step.key as WeeklyStepKey));
  }
  if (filters.skip?.length) {
    return steps.filter((step) => !filters.skip!.includes(step.key as WeeklyStepKey));
  }
  return steps;
}

export function applyFastBooleanDefault(
  explicitValue: boolean | undefined,
  fast: boolean | undefined,
): boolean {
  return (explicitValue ?? false) || (fast ?? false);
}

function validateWeeklyRefreshFlags(flags: {
  fast?: boolean;
  maxProjectPages?: number;
  projectOffset?: number;
  projectConcurrency: number;
  stepTimeoutMinutes?: number;
  maxStepAttempts: number;
  only?: WeeklyStepKey[];
  skip?: WeeklyStepKey[];
}): void {
  if (flags.only?.length && flags.skip?.length) {
    throw new Error("--only and --skip cannot be used together");
  }
  for (const [name, value] of [
    ["--max-project-pages", flags.maxProjectPages],
    ["--step-timeout-minutes", flags.stepTimeoutMinutes],
    ["--max-step-attempts", flags.maxStepAttempts],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (flags.projectOffset !== undefined && (!Number.isInteger(flags.projectOffset) || flags.projectOffset < 0)) {
    throw new Error("--project-offset must be a non-negative integer");
  }
  if (!Number.isInteger(flags.projectConcurrency) || flags.projectConcurrency < 1) {
    throw new Error("--project-concurrency must be a positive integer");
  }
}

export function assertWeeklyLiveAuthorityBoundary(
  steps: Array<{ key: string; wouldChange: boolean; status: string }>,
): void {
  const supportDrift = steps.some(
    (step) =>
      step.key === "support-maintenance" &&
      (step.wouldChange || step.status === "drift"),
  );
  if (supportDrift) {
    throw new Error(
      [
        "Weekly live execution is blocked before any live child command because support maintenance has drift.",
        "The combined support command cannot inherit authority for its independent product actions.",
        "Run the GitHub knowledge audit and support-database hygiene lanes separately, using the hygiene approval envelope when that plan has effects, then repeat the weekly preflight.",
      ].join(" "),
    );
  }
}

function isWeeklyStepKey(value: string): value is WeeklyStepKey {
  return (WEEKLY_STEP_KEYS as readonly string[]).includes(value);
}

export function buildWeeklyRefreshQuickSummary(output: WeeklyRefreshOutput): Record<string, unknown> {
  const summarySource = output.liveRun?.steps ?? output.preflight.steps;
  const failedSteps = summarySource
    .filter((step) => step.status === "failed")
    .map((step) => step.key);
  const partialSteps = summarySource
    .filter((step) => step.status === "partial")
    .map((step) => step.key);
  const slowSteps = summarySource
    .filter((step) => step.durationMs >= SLOW_STEP_THRESHOLD_MS)
    .map((step) => ({
      key: step.key,
      durationSeconds: Math.round(step.durationMs / 1000),
      thresholdSeconds: SLOW_STEP_THRESHOLD_MS / 1000,
    }));
  const timing = buildWeeklyRefreshTimingSummary(summarySource);
  return {
    ok: true,
    summaryFirst: true,
    fastWorkflowHint: "Use --fast for scoped triage, known-blocked markdown skipping, streamed progress, and lower retry budget.",
    status: output.status,
    needsLiveWrite: output.needsLiveWrite,
    liveExecuted: output.liveExecuted,
    summary: output.liveRun?.summary ?? output.preflight.summary,
    timing,
    failedSteps,
    partialSteps,
    slowSteps,
    operatorNotes: buildWeeklyRefreshOperatorNotes(output),
    catchUp: output.catchUp,
    recoveryPlan: buildWeeklyRefreshRecoveryPlan(output, failedSteps, partialSteps),
    recommendedNextCommands: deriveWeeklyRefreshNextCommands(output, failedSteps, partialSteps),
  };
}

export function buildWeeklyRefreshCatchUpStatus(input: {
  previousRunAt?: string;
  today: string;
  status?: WeeklyRefreshOverallStatus;
  needsLiveWrite?: boolean;
  liveExecuted?: boolean;
  staleDataThresholdDays?: number;
}): WeeklyRefreshCatchUpStatus {
  const staleDataThresholdDays =
    input.staleDataThresholdDays ?? MISSED_RUN_STALE_THRESHOLD_DAYS;
  const hasValidPreviousRunAt =
    input.previousRunAt !== undefined && isValidIsoDate(input.previousRunAt);
  const hasValidToday = isValidIsoDate(input.today);
  const gapDays =
    hasValidPreviousRunAt && hasValidToday
      ? Math.max(0, diffDays(input.previousRunAt!, input.today))
      : 0;
  const missedRunDays = Math.max(0, gapDays - 1);
  const missedWeekdays = hasValidPreviousRunAt && hasValidToday
    ? countMissedWeekdays(input.previousRunAt!, input.today)
    : 0;
  const catchUpMode =
    missedRunDays === 0
      ? "none"
      : isOperatorCatchUpDay(input.today)
        ? "weekend_catch_up"
        : "weekday_catch_up";
  const staleBeforeRun = gapDays > staleDataThresholdDays;
  const healthyStatus = input.status === "clean" || input.status === "completed";
  const recovered =
    staleBeforeRun &&
    healthyStatus &&
    (input.liveExecuted === true || input.needsLiveWrite === false);
  const summary = formatCatchUpSummary({
    previousRunAt: input.previousRunAt,
    hasValidPreviousRunAt,
    hasValidToday,
    gapDays,
    missedRunDays,
    missedWeekdays,
    catchUpMode,
    staleBeforeRun,
    recovered,
  });

  return {
    previousRunAt: input.previousRunAt,
    today: input.today,
    gapDays,
    missedRunDays,
    missedWeekdays,
    catchUpMode,
    staleDataThresholdDays,
    staleBeforeRun,
    recovered,
    summary,
  };
}

function countMissedWeekdays(previousRunAt: string, today: string): number {
  if (!isValidIsoDate(previousRunAt) || !isValidIsoDate(today)) {
    return 0;
  }
  const gapDays = Math.max(0, diffDays(previousRunAt, today));
  let count = 0;
  for (let offset = 1; offset < gapDays; offset += 1) {
    if (!isWeekend(addDays(previousRunAt, offset))) {
      count += 1;
    }
  }
  return count;
}

function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function isOperatorCatchUpDay(date: string): boolean {
  if (!isValidIsoDate(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return OPERATOR_CATCH_UP_DAYS.has(parsed.getUTCDay());
}

function isWeekend(date: string): boolean {
  if (!isValidIsoDate(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay();
  return day === 0 || day === 6;
}

function formatCatchUpSummary(input: {
  previousRunAt?: string;
  hasValidPreviousRunAt: boolean;
  hasValidToday: boolean;
  gapDays: number;
  missedRunDays: number;
  missedWeekdays: number;
  catchUpMode: WeeklyRefreshCatchUpStatus["catchUpMode"];
  staleBeforeRun: boolean;
  recovered: boolean;
}): string {
  if (!input.previousRunAt) {
    return "No prior weekly refresh run is recorded.";
  }
  if (!input.hasValidPreviousRunAt) {
    return "Prior weekly refresh run date is invalid; catch-up status was not calculated.";
  }
  if (!input.hasValidToday) {
    return "Current weekly refresh date is invalid; catch-up status was not calculated.";
  }
  if (input.missedRunDays === 0) {
    return "No missed run days since the previous refresh.";
  }
  const mode =
    input.catchUpMode === "weekend_catch_up"
      ? "weekend catch-up"
      : "weekday catch-up";
  const stale = input.staleBeforeRun ? "stale before this run" : "within freshness threshold";
  const recovered = input.recovered ? "; recovered" : "";
  return `${mode}: ${input.missedRunDays} missed run day(s), ${input.missedWeekdays} missed weekday(s), ${stale}${recovered}.`;
}

export function buildWeeklyRefreshTimingSummary(
  steps: Pick<WeeklyRefreshStepResult, "key" | "title" | "status" | "durationMs">[],
): Record<string, unknown> {
  const totalDurationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
  const stepTimings = steps
    .map((step) => ({
      key: step.key,
      title: step.title,
      status: step.status,
      durationSeconds: Math.round(step.durationMs / 1000),
      durationMinutes: roundOneDecimal(step.durationMs / 60000),
      percentOfRun:
        totalDurationMs > 0
          ? Math.round((step.durationMs / totalDurationMs) * 100)
          : 0,
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds);
  const longestStep = stepTimings[0]
    ? {
        key: stepTimings[0].key,
        title: stepTimings[0].title,
        durationSeconds: stepTimings[0].durationSeconds,
      }
    : undefined;

  return {
    totalDurationSeconds: Math.round(totalDurationMs / 1000),
    totalDurationMinutes: roundOneDecimal(totalDurationMs / 60000),
    slowStepThresholdSeconds: SLOW_STEP_THRESHOLD_MS / 1000,
    longestStep,
    stepTimings,
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${roundOneDecimal(durationMs / 60000)}m`;
}

function deriveWeeklyRefreshNextCommands(
  output: WeeklyRefreshOutput,
  failedSteps: string[],
  partialSteps: string[],
): string[] {
  const commands: string[] = [];
  for (const step of [...failedSteps, ...partialSteps].slice(0, 3)) {
    commands.push(`npm run maintenance:weekly-refresh -- --today ${output.today} --only ${step} --fast --step-timeout-minutes 5`);
  }
  if (commands.length === 0 && output.needsLiveWrite) {
    const driftSteps = output.preflight.steps
      .filter((step) => step.status === "drift" || step.wouldChange)
      .slice(0, 3);
    for (const step of driftSteps) {
      commands.push(buildWeeklyRefreshLiveRepairCommand(output.today, step));
      if (isExternalSignalFullScopeBacklogDrift(step)) {
        commands.push(`npm run maintenance:weekly-refresh -- --today ${output.today} --only ${step.key} --summary-first --stream-child-output`);
      }
    }
    if (commands.length === 0) {
      commands.push(`npm run maintenance:weekly-refresh -- --today ${output.today} --fast`);
    }
  }
  return commands;
}

export function buildWeeklyRefreshRecoveryPlan(
  output: WeeklyRefreshOutput,
  failedSteps: string[],
  partialSteps: string[],
): Array<{ step: string; reason: string; command: string }> {
  const plan: Array<{ step: string; reason: string; command: string }> = [];
  for (const step of [...failedSteps, ...partialSteps].slice(0, 3)) {
    plan.push({
      step,
      reason: failedSteps.includes(step)
        ? "Step failed or exhausted retries; rerun the lane alone with a short timeout to inspect the real blocker."
        : "Step returned partial output; rerun the lane alone before attempting live repair.",
      command: `npm run maintenance:weekly-refresh -- --today ${output.today} --only ${step} --fast --step-timeout-minutes 5 --stream-child-output`,
    });
  }
  if (plan.length === 0 && output.needsLiveWrite) {
    const driftSteps = output.preflight.steps
      .filter((step) => step.status === "drift" || step.wouldChange)
      .slice(0, 3);
    for (const step of driftSteps) {
      plan.push({
        step: step.key,
        reason: step.key === "support-maintenance"
          ? "Support drift spans independent product actions; inspect the combined dry-run, execute only the drifting constituent lane with its own authority, then repeat the weekly preflight."
          : isExternalSignalFullScopeBacklogDrift(step)
          ? "External Signal Sync is in a full-scope provider/source backlog; run this lane live without --fast, then repeat the same full-scope dry-run until it reports clean."
          : "Dry-run found drift; run only this lane live, then repeat the same lane dry-run.",
        command: buildWeeklyRefreshLiveRepairCommand(output.today, step),
      });
    }
  }
  return plan;
}

function buildWeeklyRefreshLiveRepairCommand(today: string, step: WeeklyRefreshStepResult): string {
  if (step.key === "support-maintenance") {
    return `npm run portfolio-audit:github-support-maintenance -- --today ${today}`;
  }
  const fastFlag = isExternalSignalFullScopeBacklogDrift(step) ? "" : " --fast";
  return `npm run maintenance:weekly-refresh -- --today ${today} --only ${step.key}${fastFlag} --live --confirm-full-live`;
}

function buildWeeklyRefreshOperatorNotes(output: WeeklyRefreshOutput): string[] {
  return output.preflight.steps
    .filter(isExternalSignalFullScopeBacklogDrift)
    .map((step) => {
      const changed = step.summaryCounts.projectExternalSignalBriefsWouldChange ?? 0;
      const evaluated = step.summaryCounts.evaluatedProjectCount ?? step.summaryCounts.targetProjectCount ?? 0;
      const sources = step.summaryCounts.syncedSourceCount ?? step.summaryCounts.targetProjectCount ?? 0;
      return `External Signal Sync is processing a full-scope provider/source window: ${changed} project brief(s) would change across ${evaluated} evaluated project(s) and ${sources} source(s). Use the full-scope targeted live/dry-run loop, not --fast, until the lane reports clean.`;
    });
}

function isExternalSignalFullScopeBacklogDrift(step: WeeklyRefreshStepResult): boolean {
  if (step.key !== "external-signals" || !(step.status === "drift" || step.wouldChange)) {
    return false;
  }
  const changedBriefs = step.summaryCounts.projectExternalSignalBriefsWouldChange ?? 0;
  const projectLimit = step.summaryCounts.projectRefreshLimit ?? 0;
  const syncedSources = step.summaryCounts.syncedSourceCount ?? 0;
  return changedBriefs > 0 && projectLimit === 0 && syncedSources > 0;
}

export function shouldPersistWeeklyRefreshState(input: {
  live: boolean;
  only?: string[];
  skip?: string[];
}): boolean {
  return input.live && !input.only?.length && !input.skip?.length;
}

async function persistWeeklyRefreshState(input: {
  configPath: string;
  today: string;
  status: WeeklyRefreshOverallStatus;
  liveExecuted: boolean;
  needsLiveWrite: boolean;
  catchUp: WeeklyRefreshCatchUpStatus;
  allowCommandCenterReplacement: boolean;
  preflightSummary: Record<string, number>;
  liveSummary?: Record<string, number>;
}): Promise<Record<string, string | undefined>> {
  const config = await loadLocalPortfolioControlTowerConfig(input.configPath);
  const summary = {
    needsLiveWrite: input.needsLiveWrite ? "yes" : "no",
    liveExecuted: input.liveExecuted ? "yes" : "no",
    previousRunAt: input.catchUp.previousRunAt ?? "",
    gapDays: input.catchUp.gapDays,
    missedRunDays: input.catchUp.missedRunDays,
    missedWeekdays: input.catchUp.missedWeekdays,
    catchUpMode: input.catchUp.catchUpMode,
    staleDataThresholdDays: input.catchUp.staleDataThresholdDays,
    staleBeforeRun: input.catchUp.staleBeforeRun ? "yes" : "no",
    catchUpRecovered: input.catchUp.recovered ? "yes" : "no",
    catchUpSummary: input.catchUp.summary,
    ...prefixCounts("preflight", input.preflightSummary),
    ...prefixCounts("live", input.liveSummary),
  };
  let nextConfig: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>> = {
    ...config,
    weeklyMaintenance: {
      ...config.weeklyMaintenance,
      weeklyRefreshLastRunAt: input.today,
      weeklyRefreshLastStatus: input.status,
      weeklyRefreshLastSummary: summary,
    },
  };
  await saveLocalPortfolioControlTowerConfig(nextConfig, input.configPath);

  if (nextConfig.commandCenter.pageId) {
    const token = resolveRequiredNotionToken("NOTION_TOKEN is required to refresh the command center freshness section");
    const api = new DirectNotionClient(token, undefined, {
      maxAttempts: 1,
      timeoutMs: POST_LIVE_FRESHNESS_TIMEOUT_MS,
    });
    try {
      const previous = await api.readPageMarkdown(nextConfig.commandCenter.pageId);
      const nextMarkdown = mergeManagedSection(
        previous.markdown,
        renderFreshnessByLayerSection(nextConfig),
        FRESHNESS_COMMAND_CENTER_SECTION.startMarker,
        FRESHNESS_COMMAND_CENTER_SECTION.endMarker,
      );
      if (normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown)) {
        try {
          await syncManagedMarkdownSectionWithReadBack({
            api,
            pageId: nextConfig.commandCenter.pageId,
            previousMarkdown: previous.markdown,
            nextMarkdown,
            startMarker: FRESHNESS_COMMAND_CENTER_SECTION.startMarker,
            endMarker: FRESHNESS_COMMAND_CENTER_SECTION.endMarker,
            maxAttempts: 2,
          });
        } catch (error) {
          if (!isReadBackRecoverableMarkdownError(error)) {
            throw error;
          }
          if (!input.allowCommandCenterReplacement) {
            logHumanMessage("Command center freshness markdown patch did not complete during targeted refresh; leaving the existing page in place.");
            return buildWeeklyRefreshFreshness(nextConfig);
          }
          nextConfig = await replaceCommandCenterPageAfterPatchFailure({
            api,
            config: nextConfig,
            configPath: input.configPath,
            markdown: nextMarkdown,
          });
        }
      }
    } catch (error) {
      if (input.allowCommandCenterReplacement || !isPostLiveFreshnessTransportError(error)) {
        throw error;
      }
      logHumanMessage("Command center freshness refresh timed out during targeted refresh; weekly state was saved and the existing page is unchanged.");
      return buildWeeklyRefreshFreshness(nextConfig);
    }
  }

  return {
    ...buildWeeklyRefreshFreshness(nextConfig),
  };
}

function buildWeeklyRefreshFreshness(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Record<string, string | undefined> {
  return {
    supportMaintenanceLastSyncAt: config.weeklyMaintenance?.supportMaintenanceLastSyncAt,
    weeklyRefreshLastRunAt: config.weeklyMaintenance?.weeklyRefreshLastRunAt,
    weeklyReviewLastPublishedAt: config.weeklyMaintenance?.weeklyReviewLastPublishedAt,
    controlTowerLastSyncAt: config.phaseState.lastSyncAt,
    executionLastSyncAt: config.phase2Execution?.lastSyncAt,
    intelligenceLastSyncAt: config.phase3Intelligence?.lastSyncAt,
    externalSignalsLastSyncAt: config.phase5ExternalSignals?.lastSyncAt,
  };
}

async function replaceCommandCenterPageAfterPatchFailure(input: {
  api: DirectNotionClient;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  configPath: string;
  markdown: string;
}): Promise<Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>> {
  const parentPageId = extractNotionIdFromUrl(input.config.commandCenter.parentPageUrl);
  if (!parentPageId) {
    throw new Error("Control tower command center parentPageUrl is not a Notion page URL");
  }

  const created = await input.api.createPageWithMarkdown({
    parent: { page_id: parentPageId },
    properties: {
      title: [
        {
          type: "text",
          text: { content: input.config.commandCenter.title },
        },
      ],
    },
    markdown: stripLeadingMarkdownTitle(input.markdown, input.config.commandCenter.title),
  });
  const nextConfig = {
    ...input.config,
    commandCenter: {
      ...input.config.commandCenter,
      pageId: created.id,
      pageUrl: created.url,
    },
  };
  await saveLocalPortfolioControlTowerConfig(nextConfig, input.configPath);
  const registry = await DestinationRegistry.load(loadRuntimeConfig().paths.destinationsPath);
  await registry.patchDestination(nextConfig.destinations.commandCenterAlias, {
    sourceUrl: created.url,
    resolvedId: created.id,
    mode: "replace_full_content",
  });
  return nextConfig;
}

function isPostLiveFreshnessTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Notion request (transport error|timed out|returned retryable error responses).*(GET|PATCH) \/pages\/.*\/markdown/i.test(message);
}

function stripLeadingMarkdownTitle(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== `# ${title}`) {
    return markdown;
  }
  const [, maybeBlank, ...rest] = lines;
  return (maybeBlank?.trim() === "" ? rest : [maybeBlank, ...rest]).join("\n").trim();
}

function prefixCounts(
  prefix: string,
  counts: Record<string, number> | undefined,
): Record<string, number> {
  if (!counts) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [`${prefix}${capitalize(key)}`, value]),
  );
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function inferWouldChange(output: Record<string, unknown>): boolean {
  const directKeys = [
    "changedRows",
    "changedProjectPages",
    "createdEventCount",
    "createdSyncRunCount",
    "derivedRowsWouldChange",
    "projectExecutionBriefsWouldChange",
    "projectRecommendationBriefsWouldChange",
    "projectExternalSignalBriefsWouldChange",
  ];
  return directKeys.some((key) => typeof output[key] === "number" && Number(output[key]) > 0);
}

function parseLastJsonObject(
  stdout: string,
  title: string,
): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const slice = lines.slice(index).join("\n").trim();
    if (!slice.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(slice) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  throw new Error(`${title} did not return parseable JSON output.`);
}

function numericRecord(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function logHumanSummary(
  label: string,
  steps: WeeklyRefreshStepResult[],
  needsLiveWrite: boolean,
): void {
  const summary = summarizeStepResults(steps);
  const suffix = label === "Preflight" ? ` needsLiveWrite=${String(needsLiveWrite)}` : "";
  logHumanMessage(
    `${label}: clean=${summary.cleanSteps}, drift=${summary.driftSteps}, completed=${summary.completedSteps}, partial=${summary.partialSteps}, failed=${summary.failedSteps}, skipped=${summary.skippedSteps}.${suffix}`,
  );
}

function logHumanMessage(message: string): void {
  console.error(`[weekly-refresh] ${message}`);
}

function shouldRetryStepError(error: unknown): boolean {
  if (error instanceof WeeklyStepExecutionError) {
    return error.retryable;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ETIMEDOUT|ECONNRESET|ENETUNREACH|timed out/i.test(message);
}

function classifyStepError(
  error: unknown,
): WeeklyRefreshStepResult["failureCategory"] {
  if (error instanceof WeeklyStepExecutionError) {
    return error.category;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return "timeout_exhausted";
  }
  if (/fetch failed|ETIMEDOUT|ECONNRESET|ENETUNREACH|transport/i.test(message)) {
    return "transport_error";
  }
  if (/provider request failed/i.test(message)) {
    return "provider_error";
  }
  if (/validation/i.test(message)) {
    return "validation_error";
  }
  return "unexpected_response";
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["maintenance", "weekly-refresh"]);
}
