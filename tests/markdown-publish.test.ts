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

class FakeNotionApi implements NotionApi {
  public createCalls: CreatePageInput[] = [];

  public patchCalls: MarkdownPatchInput[] = [];

  public readCalls: string[] = [];

  public async resolveDestination(destination: DestinationConfig): Promise<ResolvedDestination> {
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
      title: "Weekly Reviews",
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
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  public async updatePageProperties() {
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  public async readPageMarkdown(pageId: string): Promise<MarkdownReadResult> {
    this.readCalls.push(pageId);
    return {
      markdown: "# Final",
      raw: {},
      truncated: false,
      unknownBlockIds: [],
    };
  }

  public async patchPageMarkdown(input: MarkdownPatchInput): Promise<void> {
    this.patchCalls.push(input);
  }
}

describe("Publisher create flow", () => {
  test("creates a new page with markdown for create_new_page destinations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-publish-"));
    const filePath = path.join(tempDir, "weekly.md");
    await writeFile(filePath, "# Weekly Review", "utf8");

    const logger = new RunLogger(tempDir);
    await logger.init();

    const api = new FakeNotionApi();
    const publisher = new Publisher(api, logger);
    const destination: DestinationConfig = {
      alias: "weekly_review",
      destinationType: "data_source",
      sourceUrl: "collection://ds-1",
      resolvedId: "ds-1",
      templateMode: "none",
      titleRule: {
        source: "first_heading",
        fallback: "Fallback",
      },
      fixedProperties: {},
      defaultProperties: {},
      mode: "create_new_page",
      safeDefaults: {
        allowDeletingContent: false,
        templatePollIntervalMs: 1500,
        templatePollTimeoutMs: 30000,
      },
    };

    const summary = await publisher.publish(destination, {
      destinationAlias: "weekly_review",
      inputFile: filePath,
      dryRun: false,
      live: true,
    });

    expect(api.createCalls).toHaveLength(1);
    expect(api.createCalls[0]?.markdown).toBe("# Weekly Review");
    expect(summary.pageId).toBe("page-1");
  });
});
