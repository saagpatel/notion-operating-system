import { describe, expect, test } from "vitest";

import {
  buildAppendSectionTailUpdate,
  buildInsertSectionAfterHeadingUpdate,
  isNotionPolicyBlockedError,
  syncManagedMarkdownSection,
} from "../src/notion/managed-markdown-sync.js";
import { limitRelationIds } from "../src/notion/review-packet.js";
import { extractManagedSection, mergeManagedSection, normalizeMarkdown } from "../src/utils/markdown.js";
import { AppError } from "../src/utils/errors.js";

describe("managed markdown sync", () => {
  test("builds a unique tail update for first-time managed section inserts", () => {
    const previousMarkdown = [
      "# Project",
      "## Notes",
      "This page already has a stable tail that should be unique for the append helper.",
      "Closing line for the unique tail.",
    ].join("\n\n");
    const nextSection = [
      "<!-- codex:notion-execution-brief:start -->",
      "## Execution Brief",
      "- One next action",
      "<!-- codex:notion-execution-brief:end -->",
    ].join("\n");

    const update = buildAppendSectionTailUpdate(previousMarkdown, nextSection);

    expect(update).toBeDefined();
    expect(update?.newStr).toContain(nextSection);
    expect(update?.replaceAllMatches).toBe(false);
  });

  test("can insert a first managed section after the page heading", () => {
    const previousMarkdown = ["# RAG Knowledge Base", "Intro paragraph.", "More detail."].join("\n\n");
    const nextSection = [
      "<!-- codex:notion-execution-brief:start -->",
      "## Execution Brief",
      "- One next action",
      "<!-- codex:notion-execution-brief:end -->",
    ].join("\n");

    const update = buildInsertSectionAfterHeadingUpdate(previousMarkdown, nextSection);

    expect(update).toEqual({
      oldStr: "# RAG Knowledge Base",
      newStr: `# RAG Knowledge Base\n\n${nextSection}`,
      replaceAllMatches: false,
    });
  });

  test("detects Cloudflare-backed policy blocks", () => {
    const error = new AppError("blocked", {
      status: 403,
      body: "<html><title>Cloudflare</title><h1>Sorry, you have been blocked</h1></html>",
    });

    expect(isNotionPolicyBlockedError(error)).toBe(true);
    expect(isNotionPolicyBlockedError(new AppError("bad request", { status: 400, body: "validation" }))).toBe(false);
  });

  test("falls back to safe replacement when section update is Cloudflare-blocked", async () => {
    const previousMarkdown = [
      "# Project",
      "<!-- codex:notion-execution-brief:start -->",
      "old",
      "<!-- codex:notion-execution-brief:end -->",
    ].join("\n");
    const nextMarkdown = previousMarkdown.replace("old", "new");
    const calls: Array<{ command: string }> = [];
    const api = {
      patchPageMarkdown: async (input: { command: string }) => {
        calls.push({ command: input.command });
        if (input.command === "update_content") {
          throw new AppError("blocked", {
            status: 403,
            body: "<html><title>Cloudflare</title><h1>Sorry, you have been blocked</h1></html>",
          });
        }
      },
    };

    const mode = await syncManagedMarkdownSection({
      api: api as never,
      pageId: "page-1",
      previousMarkdown,
      nextMarkdown,
      startMarker: "<!-- codex:notion-execution-brief:start -->",
      endMarker: "<!-- codex:notion-execution-brief:end -->",
    });

    expect(mode).toBe("replace_content");
    expect(calls.map((call) => call.command)).toEqual(["update_content", "replace_content"]);
  });

  test("recognizes managed sections after Notion escapes the markers", () => {
    const existing = [
      "# Project",
      "\\<!-- codex:notion-execution-brief:start --\\>",
      "## Execution Brief",
      "Updated: 2026-04-07",
      "\\<!-- codex:notion-execution-brief:end --\\>",
      "## Rest",
      "- Stable",
    ].join("\n");
    const nextSection = [
      "<!-- codex:notion-execution-brief:start -->",
      "## Execution Brief",
      "Updated: 2026-04-08",
      "<!-- codex:notion-execution-brief:end -->",
    ].join("\n");

    expect(
      extractManagedSection(
        existing,
        "<!-- codex:notion-execution-brief:start -->",
        "<!-- codex:notion-execution-brief:end -->",
      ),
    ).toContain("Updated: 2026-04-07");
    expect(
      mergeManagedSection(
        existing,
        nextSection,
        "<!-- codex:notion-execution-brief:start -->",
        "<!-- codex:notion-execution-brief:end -->",
      ),
    ).toContain("Updated: 2026-04-08");
    expect(normalizeMarkdown(existing)).toContain("<!-- codex:notion-execution-brief:start -->");
  });

  test("normalizes Notion-style escaped formatting for idempotent comparison", () => {
    const stored = [
      "# Project",
      "\\<!-- codex:notion-execution-brief:start --\\>",
      "## Execution Brief",
      "- [Legacy build work](https://www.notion.so/32bc21f1caf08123863dc48f4f479b64) \\| Progress",
      "\\<!-- codex:notion-execution-brief:end --\\>",
    ].join("\n");
    const rendered = [
      "# Project",
      "",
      "<!-- codex:notion-execution-brief:start -->",
      "## Execution Brief",
      "- [Legacy build work](https://www.notion.so/Legacy-build-work-32bc21f1caf08123863dc48f4f479b64) | Progress",
      "<!-- codex:notion-execution-brief:end -->",
    ].join("\n");

    expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
  });

  test("normalizes adjacent same-url links that Notion splits during readback", () => {
    const stored = [
      "# Project",
      "- [Claude (](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)[claude.ai](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)[)](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)",
      "- [window.storage](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)[ API](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)",
    ].join("\n");
    const rendered = [
      "# Project",
      "- [Claude (claude.ai)](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)",
      "- [window.storage API](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)",
    ].join("\n");

    expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
  });

  test("normalizes slugged Notion urls that include underscores", () => {
    const stored = "- [Packet](https://www.notion.so/326c21f1caf0813fae47fa49e67efc35)";
    const rendered = "- [Packet](https://www.notion.so/Phase-2-now-packet-GPT_RAG-326c21f1caf0813fae47fa49e67efc35)";

    expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
  });

  test("normalizes Notion urls that lose query parameters on readback", () => {
    const stored = "- [Resume Now](https://www.notion.so/1258652152454b6a81325eb988ec04d4)";
    const rendered = "- [Resume Now](https://www.notion.so/1258652152454b6a81325eb988ec04d4?v=326c21f1caf081dc8903000cadb44c92)";

    expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
  });
});

describe("review packet relation limiting", () => {
  test("caps relation ids at the Notion page-property limit", () => {
    const ids = Array.from({ length: 113 }, (_, index) => `page-${index}`);

    expect(limitRelationIds(ids, 100)).toHaveLength(100);
    expect(limitRelationIds(ids, 100)[0]).toBe("page-0");
    expect(limitRelationIds(ids, 100)[99]).toBe("page-99");
  });
});
