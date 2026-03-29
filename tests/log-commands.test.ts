import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { readRecentRuns } from "../src/cli/log-commands.js";

describe("log commands", () => {
  test("reads recent runs newest first and skips malformed or incomplete logs", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-os-log-reader-"));
    await mkdir(tempDir, { recursive: true });

    await writeFile(
      path.join(tempDir, "older.jsonl"),
      [
        JSON.stringify({
          action: "command_started",
          details: {
            commandPath: "doctor",
            profile: "default",
            logFilePath: path.join(tempDir, "older.jsonl"),
            startedAt: "2026-03-29T10:00:00.000Z",
            completedAt: "2026-03-29T10:00:01.000Z",
            durationMs: 1000,
            summary: {
              status: "completed",
              warningsCount: 0,
              failureCount: 0,
            },
          },
        }),
        JSON.stringify({
          action: "command_completed",
          details: {
            commandPath: "doctor",
            profile: "default",
            logFilePath: path.join(tempDir, "older.jsonl"),
            startedAt: "2026-03-29T10:00:00.000Z",
            completedAt: "2026-03-29T10:00:01.000Z",
            durationMs: 1000,
            summary: {
              status: "completed",
              warningsCount: 0,
              failureCount: 0,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(tempDir, "newer.jsonl"),
      [
        JSON.stringify({
          action: "command_started",
          details: {
            commandPath: "signals sync",
            profile: "work",
            logFilePath: path.join(tempDir, "newer.jsonl"),
            startedAt: "2026-03-29T11:00:00.000Z",
            completedAt: "2026-03-29T11:00:02.000Z",
            durationMs: 2000,
            summary: {
              status: "partial",
              warningsCount: 1,
              warningCategories: ["partial_success"],
              failureCount: 1,
            },
          },
        }),
        JSON.stringify({
          action: "command_completed",
          details: {
            commandPath: "signals sync",
            profile: "work",
            logFilePath: path.join(tempDir, "newer.jsonl"),
            startedAt: "2026-03-29T11:00:00.000Z",
            completedAt: "2026-03-29T11:00:02.000Z",
            durationMs: 2000,
            summary: {
              status: "partial",
              warningsCount: 1,
              warningCategories: ["partial_success"],
              failureCount: 1,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    await writeFile(path.join(tempDir, "malformed.jsonl"), "{not-json}\n", "utf8");
    await writeFile(
      path.join(tempDir, "incomplete.jsonl"),
      JSON.stringify({
        action: "command_started",
        details: {
          commandPath: "publish",
        },
      }),
      "utf8",
    );

    const runs = await readRecentRuns({ logDir: tempDir, limit: 10 });

    expect(runs).toHaveLength(2);
    expect(runs[0]?.commandPath).toBe("signals sync");
    expect(runs[1]?.commandPath).toBe("doctor");
    expect(runs[0]?.summary.warningCategories).toEqual(["partial_success"]);
  });
});
