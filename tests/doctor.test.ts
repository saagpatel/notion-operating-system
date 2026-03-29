import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { runDoctor } from "../src/doctor.js";
import type { DestinationConfig } from "../src/types.js";

describe("doctor", () => {
  test("reports missing Notion token while still validating local files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-doctor-"));
    await writeFile(
      path.join(tempDir, "destinations.json"),
      JSON.stringify({
        version: 1,
        destinations: [
          {
            alias: "weekly_review",
            destinationType: "page",
            sourceUrl: "https://www.notion.so/example",
            templateMode: "none",
            titleRule: { source: "filename" },
            fixedProperties: {},
            defaultProperties: {},
            mode: "create_new_page",
            safeDefaults: {
              allowDeletingContent: false,
              templatePollIntervalMs: 1000,
              templatePollTimeoutMs: 5000,
            },
          },
        ],
      }),
      "utf8",
    );

    const report = await runDoctor({
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./destinations.json",
      },
      createNotionClient: () => {
        throw new Error("Notion client should not be constructed when the token is missing");
      },
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "destinations-schema")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "notion-token")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "destination-access")?.status).toBe("skip");
  });

  test("verifies token access and destination reachability when a token is present", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-doctor-"));
    await writeFile(path.join(tempDir, ".env"), "NOTION_TOKEN=secret_test\n", "utf8");
    await writeFile(
      path.join(tempDir, "destinations.json"),
      JSON.stringify({
        version: 1,
        destinations: [
          {
            alias: "command_center",
            destinationType: "page",
            sourceUrl: "https://www.notion.so/example",
            templateMode: "none",
            titleRule: { source: "literal", value: "Command Center" },
            fixedProperties: {},
            defaultProperties: {},
            mode: "create_new_page",
            safeDefaults: {
              allowDeletingContent: false,
              templatePollIntervalMs: 1000,
              templatePollTimeoutMs: 5000,
            },
          },
        ],
      }),
      "utf8",
    );

    const resolvedAliases: string[] = [];
    const report = await runDoctor({
      cwd: tempDir,
      env: {
        NOTION_DESTINATIONS_PATH: "./destinations.json",
        NOTION_TOKEN: "secret_test",
        GITHUB_TOKEN: "ghp_test",
      },
      createNotionClient: () => ({
        async verifyAccess() {
          return {
            name: "Test Workspace Bot",
            type: "bot",
          };
        },
        async resolveDestination(destination: DestinationConfig) {
          resolvedAliases.push(destination.alias);
          return { destinationType: destination.destinationType };
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "notion-access")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "destination-access")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "optional-credentials")?.status).toBe("pass");
    expect(resolvedAliases).toEqual(["command_center"]);
  });
});
