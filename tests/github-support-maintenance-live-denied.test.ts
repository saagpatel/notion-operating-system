/**
 * The combined support-maintenance command must never run live.
 *
 * It wraps two independent product actions. Live, it used to take the knowledge
 * audit's ungoverned Notion writes to completion and only then reach the
 * support hygiene lane, which refuses without an approval envelope, leaving a
 * half-executed run behind. One flag cannot carry authority for both lanes, so
 * the combined view is read-only and each lane keeps its own governed command.
 */
import { describe, expect, test } from "vitest";

import { runGitHubSupportMaintenance } from "../src/internal/notion-maintenance/github-support-maintenance.js";

describe("combined GitHub support maintenance", () => {
  test("live execution is denied before any product action runs", async () => {
    await expect(
      runGitHubSupportMaintenance({
        live: true,
        owner: "fixture-owner",
        limit: 1,
        today: "2026-01-01",
        // Paths that do not exist: reaching them at all would mean the guard
        // let the run start, so the denial must happen before any file or
        // network access is attempted.
        config: "/nonexistent/control-tower.json",
        sourceConfig: "/nonexistent/sources.json",
      }),
    ).rejects.toThrow(/authority cannot be inherited across product actions/i);
  });
});
