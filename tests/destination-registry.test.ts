import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { describe, expect, test } from "vitest";

import { DestinationRegistry } from "../src/config/destination-registry.js";

describe("DestinationRegistry", () => {
  test("loads registry config and resolves aliases", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-registry-"));
    const filePath = path.join(tempDir, "destinations.json");
    await writeFile(
      filePath,
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

    const registry = await DestinationRegistry.load(filePath);
    expect(registry.getDestination("weekly_review").destinationType).toBe("page");
  });

  test("updates the in-memory registry when a destination is patched repeatedly", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-registry-"));
    const filePath = path.join(tempDir, "destinations.json");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        destinations: [
          {
            alias: "command_center",
            destinationType: "page",
            sourceUrl: "https://www.notion.so/parent",
            resolvedId: "parent",
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

    const registry = await DestinationRegistry.load(filePath);
    await registry.patchDestination("command_center", {
      sourceUrl: "https://www.notion.so/page-1",
      resolvedId: "page-1",
    });
    await registry.patchDestination("command_center", {
      mode: "replace_full_content",
    });

    const reloaded = await DestinationRegistry.load(filePath);
    const destination = reloaded.getDestination("command_center");
    expect(destination.sourceUrl).toBe("https://www.notion.so/page-1");
    expect(destination.resolvedId).toBe("page-1");
    expect(destination.mode).toBe("replace_full_content");
  });
});
