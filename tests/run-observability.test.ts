import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  getCurrentCommandLogger,
  incrementCommandSummary,
  logCommandCompleted,
  logCommandFailed,
  mergeCommandSummary,
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

    await withCommandRunContext(
      {
        commandPath: ["publish"],
        parsed: { options: { dryRun: true }, positionals: [], helpRequested: false },
      },
      async () => {
        await logCommandFailed(new Error("boom"));
      },
    );

    const [logFileName] = await readdir(tempDir);
    expect(logFileName).toBeTruthy();
    const logLines = (await readFile(path.join(tempDir, logFileName!), "utf8"))
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
});
