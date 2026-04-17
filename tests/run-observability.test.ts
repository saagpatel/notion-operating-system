import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  getCurrentCommandLogger,
  incrementCommandSummary,
  getCommandRunSummary,
  logCommandCompleted,
  logCommandFailed,
  mergeCommandSummary,
  recordCommandFailureCategory,
  recordCommandWarningCategory,
  withCommandRunContext,
} from "../src/cli/run-observability.js";

describe("run observability", () => {
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  test("records command lifecycle and merged summary on success", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-observability-"));
    process.env = {
      ...previousEnv,
      NOTION_LOG_DIR: tempDir,
    };

    let logFilePath = "";
    await withCommandRunContext(
      {
        commandPath: ["doctor"],
        parsed: { options: { live: false }, positionals: [], helpRequested: false },
      },
      async () => {
        mergeCommandSummary({ rowsChanged: 2, metadata: { profile: "default" } });
        incrementCommandSummary("warningsCount", 1);
        logFilePath = getCurrentCommandLogger()?.filePath ?? "";
        await logCommandCompleted();
      },
    );

    expect(logFilePath).toBeTruthy();
    const logLines = (await readFile(logFilePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string; details?: Record<string, unknown> });

    expect(logLines.map((line) => line.action)).toEqual(["command_started", "command_completed"]);
    expect(logLines[1]?.details?.summary).toEqual(
      expect.objectContaining({
        rowsChanged: 2,
        warningsCount: 1,
      }),
    );
  });

  test("records failed command lifecycle entries", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-observability-failure-"));
    process.env = {
      ...previousEnv,
      NOTION_LOG_DIR: tempDir,
    };

    let logFilePath = "";
    await withCommandRunContext(
      {
        commandPath: ["publish"],
        parsed: { options: { dryRun: true }, positionals: [], helpRequested: false },
      },
      async () => {
        logFilePath = getCurrentCommandLogger()?.filePath ?? "";
        await logCommandFailed(new Error("boom"));
      },
    );

    expect(logFilePath).toBeTruthy();
    const logLines = (await readFile(logFilePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string; details?: Record<string, unknown> });

    expect(logLines.map((line) => line.action)).toEqual(["command_started", "command_failed"]);
    expect(logLines[1]?.details?.summary).toEqual(
      expect.objectContaining({
        failureCount: 1,
      }),
    );
  });

  test("upgrades clean, warning, partial, and failed summaries predictably", async () => {
    const statuses: Array<string | undefined> = [];

    await withCommandRunContext(
      {
        commandPath: ["signals", "sync"],
        parsed: { options: { live: true }, positionals: [], helpRequested: false },
      },
      async () => {
        statuses.push(getCommandRunSummary()?.status);
        recordCommandWarningCategory("retry_recovered");
        statuses.push(getCommandRunSummary()?.status);
        mergeCommandSummary({
          recordsUpdated: 2,
          failureCount: 1,
          warningCategories: ["partial_success"],
        });
        statuses.push(getCommandRunSummary()?.status);
        recordCommandFailureCategory("provider_error");
        statuses.push(getCommandRunSummary()?.status);
      },
    );

    expect(statuses).toEqual(["completed", "warning", "partial", "failed"]);
  });

  test("deduplicates warning and failure categories", async () => {
    let summary: ReturnType<typeof getCommandRunSummary>;

    await withCommandRunContext(
      {
        commandPath: ["governance", "audit"],
        parsed: { options: {}, positionals: [], helpRequested: false },
      },
      async () => {
        recordCommandWarningCategory("validation_gap");
        recordCommandWarningCategory("validation_gap");
        recordCommandFailureCategory("unexpected_response");
        recordCommandFailureCategory("unexpected_response");
        summary = getCommandRunSummary();
      },
    );

    expect(summary?.warningCategories).toEqual(["validation_gap"]);
    expect(summary?.failureCategories).toEqual(["unexpected_response"]);
    expect(summary?.warningsCount).toBe(1);
  });
});
