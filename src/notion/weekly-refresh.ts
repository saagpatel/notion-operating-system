import { spawn } from "node:child_process";
import path from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  renderFreshnessByLayerSection,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { FRESHNESS_COMMAND_CENTER_SECTION } from "./managed-markdown-sections.js";
import { mergeManagedSection, normalizeMarkdown, buildReplaceCommand, assertSafeReplacement } from "../utils/markdown.js";
import { losAngelesToday } from "../utils/date.js";
import {
  buildWeeklyStepContract,
  mapWeeklyStepStatusToCommandStatus,
  type WeeklyRefreshStepContract,
  type WeeklyRefreshStepStatus,
} from "./weekly-refresh-contract.js";

type WeeklyRefreshOverallStatus = "clean" | "completed" | "partial" | "failed";

interface WeeklyRefreshCommandOptions {
  live?: boolean;
  today?: string;
  config?: string;
  owner?: string;
  signalSourceLimit?: number;
  signalMaxEventsPerSource?: number;
}

interface WeeklyRefreshStepDefinition {
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
}

const DEFAULT_OWNER = "saagpatel";

export async function runWeeklyRefreshCommand(
  options: WeeklyRefreshCommandOptions = {},
): Promise<void> {
  resolveRequiredNotionToken("NOTION_TOKEN is required for the weekly refresh orchestrator");

  const flags = {
    live: options.live ?? false,
    today: options.today ?? losAngelesToday(),
    config: options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
    owner: options.owner ?? DEFAULT_OWNER,
    signalSourceLimit: options.signalSourceLimit,
    signalMaxEventsPerSource: options.signalMaxEventsPerSource,
  };
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const externalSignalSourceLimit =
    flags.signalSourceLimit ?? config.phase5ExternalSignals?.syncLimits.maxProjectsInFirstWave ?? 15;
  const externalSignalMaxEventsPerSource =
    flags.signalMaxEventsPerSource ?? Math.min(config.phase5ExternalSignals?.syncLimits.maxEventsPerSource ?? 25, 5);

  const preflightSteps = await runWeeklyRefreshSteps(buildStepDefinitions(flags, false, externalSignalSourceLimit, externalSignalMaxEventsPerSource), {
    stopAfterControlTowerFailure: false,
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
    const liveSteps = await runWeeklyRefreshSteps(buildStepDefinitions(flags, true, externalSignalSourceLimit, externalSignalMaxEventsPerSource), {
      stopAfterControlTowerFailure: true,
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
  if (flags.live) {
    freshness = await persistWeeklyRefreshState({
      configPath: flags.config,
      today: flags.today,
      status: overallStatus,
      liveExecuted,
      needsLiveWrite,
      preflightSummary,
      liveSummary: liveRun?.summary,
    });
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
  };

  recordCommandOutputSummary(output as unknown as Record<string, unknown>, {
    status: mapWeeklyStepStatusToCommandStatus(overallStatus),
    metadata: {
      needsLiveWrite,
      liveExecuted,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

function buildStepDefinitions(
  flags: {
    live: boolean;
    today: string;
    config: string;
    owner: string;
    signalSourceLimit?: number;
    signalMaxEventsPerSource?: number;
  },
  live: boolean,
  externalSignalSourceLimit: number,
  externalSignalMaxEventsPerSource: number,
): WeeklyRefreshStepDefinition[] {
  const sharedArgs = buildSharedArgs(flags, live);
  return [
    {
      key: "support-maintenance",
      title: "GitHub Support Maintenance",
      kind: "script",
      args: ["src/internal/notion-maintenance/github-support-maintenance.ts", ...sharedArgs, "--owner", flags.owner],
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
      args: ["execution", "sync", ...sharedArgs],
      timeoutMs: 15 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
    {
      key: "intelligence-sync",
      title: "Intelligence Sync",
      kind: "cli",
      args: ["intelligence", "sync", ...sharedArgs],
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
      args: [
        "signals",
        "sync",
        ...sharedArgs,
        "--provider",
        "github",
        "--source-limit",
        String(externalSignalSourceLimit),
        "--max-events-per-source",
        String(externalSignalMaxEventsPerSource),
      ],
      timeoutMs: 20 * 60 * 1000,
      skipAfterControlTowerFailure: true,
    },
  ];
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

async function runWeeklyRefreshSteps(
  steps: WeeklyRefreshStepDefinition[],
  options: {
    stopAfterControlTowerFailure: boolean;
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

    const result = await runStep(step);
    results.push(result);

    if (options.stopAfterControlTowerFailure && step.key === "control-tower-sync" && result.status === "failed") {
      controlTowerFailed = true;
    }
  }

  return results;
}

async function runStep(step: WeeklyRefreshStepDefinition): Promise<WeeklyRefreshStepResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const output = await runJsonCommand(step);
      const contract = toStepContract(output, step.args.includes("--live"));
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

async function runJsonCommand(step: WeeklyRefreshStepDefinition): Promise<Record<string, unknown>> {
  const commandPath =
    step.kind === "cli"
      ? ["src/cli.ts", ...step.args]
      : step.args;
  const tsxPath = path.resolve(process.cwd(), "node_modules/.bin/tsx");
  const child = spawn(tsxPath, commandPath, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${step.title} timed out after ${Math.round(step.timeoutMs / 60000)} minutes.`));
    }, step.timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${step.title} exited with code ${exitCode}`);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${step.title} did not return JSON output.`);
  }
  return parseLastJsonObject(trimmed, step.title);
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

async function persistWeeklyRefreshState(input: {
  configPath: string;
  today: string;
  status: WeeklyRefreshOverallStatus;
  liveExecuted: boolean;
  needsLiveWrite: boolean;
  preflightSummary: Record<string, number>;
  liveSummary?: Record<string, number>;
}): Promise<Record<string, string | undefined>> {
  const config = await loadLocalPortfolioControlTowerConfig(input.configPath);
  const summary = {
    needsLiveWrite: input.needsLiveWrite ? "yes" : "no",
    liveExecuted: input.liveExecuted ? "yes" : "no",
    ...prefixCounts("preflight", input.preflightSummary),
    ...prefixCounts("live", input.liveSummary),
  };
  const nextConfig = {
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
    const api = new DirectNotionClient(token);
    const previous = await api.readPageMarkdown(nextConfig.commandCenter.pageId);
    const nextMarkdown = mergeManagedSection(
      previous.markdown,
      renderFreshnessByLayerSection(nextConfig),
      FRESHNESS_COMMAND_CENTER_SECTION.startMarker,
      FRESHNESS_COMMAND_CENTER_SECTION.endMarker,
    );
    if (normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown)) {
      assertSafeReplacement(previous.markdown, nextMarkdown);
      await api.patchPageMarkdown({
        pageId: nextConfig.commandCenter.pageId,
        command: "replace_content",
        newMarkdown: buildReplaceCommand(nextMarkdown),
      });
    }
  }

  return {
    supportMaintenanceLastSyncAt: nextConfig.weeklyMaintenance?.supportMaintenanceLastSyncAt,
    weeklyRefreshLastRunAt: nextConfig.weeklyMaintenance?.weeklyRefreshLastRunAt,
    weeklyReviewLastPublishedAt: nextConfig.weeklyMaintenance?.weeklyReviewLastPublishedAt,
    controlTowerLastSyncAt: nextConfig.phaseState.lastSyncAt,
    executionLastSyncAt: nextConfig.phase2Execution?.lastSyncAt,
    intelligenceLastSyncAt: nextConfig.phase3Intelligence?.lastSyncAt,
    externalSignalsLastSyncAt: nextConfig.phase5ExternalSignals?.lastSyncAt,
  };
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
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ETIMEDOUT|ECONNRESET|ENETUNREACH|timed out/i.test(message);
}

function classifyStepError(
  error: unknown,
): WeeklyRefreshStepResult["failureCategory"] {
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
