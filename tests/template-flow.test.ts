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
  TemplateDescriptor,
} from "../src/types.js";

class TemplateApi implements NotionApi {
  public patchCalls: MarkdownPatchInput[] = [];

  private reads = 0;

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
      title: "Decision Log",
      titlePropertyName: "Title",
      properties: {
        Title: { name: "Title", type: "title", writable: true },
      },
    };
  }

  public async listTemplates(): Promise<TemplateDescriptor[]> {
    return [{ id: "tpl-1", name: "Default", isDefault: true }];
  }

  public async searchPage() {
    return null;
  }

  public async createPageWithMarkdown(_input: CreatePageInput): Promise<PageSnapshot> {
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  public async updatePageProperties(): Promise<PageSnapshot> {
    return { id: "page-1", url: "https://notion.so/page-1" };
  }

  public async readPageMarkdown(): Promise<MarkdownReadResult> {
    this.reads += 1;
    return {
      markdown: this.reads >= 2 ? "# Template ready" : "",
      raw: {},
      truncated: false,
      unknownBlockIds: [],
    };
  }

  public async patchPageMarkdown(input: MarkdownPatchInput): Promise<void> {
    this.patchCalls.push(input);
  }
}

describe("Publisher template flow", () => {
  test("waits for template readiness before replacing markdown", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-template-"));
    const filePath = path.join(tempDir, "decision.md");
    await writeFile(filePath, "# Decision", "utf8");

    const logger = new RunLogger(tempDir);
    await logger.init();

    const publisher = new Publisher(new TemplateApi(), logger);
    const destination: DestinationConfig = {
      alias: "decision_log",
      destinationType: "data_source",
      sourceUrl: "collection://ds-1",
      resolvedId: "ds-1",
      templateMode: "default",
      titleRule: {
        source: "first_heading",
        fallback: "Fallback",
      },
      fixedProperties: {},
      defaultProperties: {},
      mode: "create_new_page",
      safeDefaults: {
        allowDeletingContent: false,
        templatePollIntervalMs: 1,
        templatePollTimeoutMs: 100,
      },
      postTemplatePatchMode: "replace_content",
    };

    await publisher.publish(destination, {
      destinationAlias: "decision_log",
      inputFile: filePath,
      dryRun: false,
      live: true,
    });

    expect((publisher as unknown as { api: TemplateApi }).api?.patchCalls ?? []).toHaveLength(1);
  });
});
