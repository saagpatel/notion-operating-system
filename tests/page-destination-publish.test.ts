import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { RunLogger } from "../src/logging/run-logger.js";
import { Publisher } from "../src/publishing/publisher.js";
import type {
  CreatePageInput,
  DestinationConfig,
  MarkdownPatchInput,
  MarkdownReadResult,
  NotionApi,
  PageSnapshot,
  ResolvedDestination,
} from "../src/types.js";

class FakePageNotionApi implements NotionApi {
  public createCalls: CreatePageInput[] = [];

  public patchCalls: MarkdownPatchInput[] = [];

  public updateCalls: Array<{ pageId: string; properties?: Record<string, unknown> }> = [];

  public async resolveDestination(destination: DestinationConfig): Promise<ResolvedDestination> {
    if (destination.destinationType === "page") {
      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "page",
        pageId: "page-1",
      };
    }
    return {
      alias: destination.alias,
      sourceUrl: destination.sourceUrl,
      destinationType: "data_source",
      dataSourceId: "ds-1",
    };
  }

  public async retrievePage(pageId: string): Promise<PageSnapshot> {
    return { id: pageId, url: `https://notion.so/${pageId}` };
  }

  public async retrieveDataSource() {
    return {
      id: "ds-1",
      title: "Example",
      titlePropertyName: "Title",
      properties: {
        Title: { name: "Title", type: "title", writable: true },
      },
    };
  }

  public async listTemplates() {
    return [];
  }

  public async searchPage() {
    return null;
  }

  public async createPageWithMarkdown(input: CreatePageInput) {
    this.createCalls.push(input);
    return { id: "created-page", url: "https://notion.so/created-page" };
  }

  public async updatePageProperties(input: { pageId: string; properties?: Record<string, unknown> }) {
    this.updateCalls.push(input);
    return { id: input.pageId, url: `https://notion.so/${input.pageId}` };
  }

  public async readPageMarkdown(): Promise<MarkdownReadResult> {
    return {
      markdown: "# Stable page",
      raw: {},
      truncated: false,
      unknownBlockIds: [],
    };
  }

  public async patchPageMarkdown(input: MarkdownPatchInput): Promise<void> {
    this.patchCalls.push(input);
  }
}

describe("Publisher page-destination update flow", () => {
  test("replaces full content on a stable page destination", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-page-publish-"));
    const filePath = path.join(tempDir, "command-center.md");
    await writeFile(filePath, "# Local Portfolio Command Center\n\nFresh content", "utf8");

    const logger = new RunLogger(tempDir);
    await logger.init();

    const api = new FakePageNotionApi();
    const publisher = new Publisher(api, logger);
    const destination: DestinationConfig = {
      alias: "command_center",
      destinationType: "page",
      sourceUrl: "https://www.notion.so/page-1",
      resolvedId: "page-1",
      templateMode: "none",
      titleRule: {
        source: "literal",
        value: "Local Portfolio Command Center",
        fallback: "Local Portfolio Command Center",
      },
      fixedProperties: {},
      defaultProperties: {},
      mode: "replace_full_content",
      safeDefaults: {
        allowDeletingContent: false,
        templatePollIntervalMs: 1500,
        templatePollTimeoutMs: 30000,
      },
    };

    const summary = await publisher.publish(destination, {
      destinationAlias: destination.alias,
      inputFile: filePath,
      dryRun: false,
      live: true,
    });

    expect(api.createCalls).toHaveLength(0);
    expect(api.updateCalls).toHaveLength(1);
    expect(api.patchCalls).toHaveLength(1);
    expect(api.patchCalls[0]?.command).toBe("replace_content");
    expect(summary.pageId).toBe("page-1");
  });
});
