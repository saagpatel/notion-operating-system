import { describe, expect, test, vi } from "vitest";

import {
  archivePagePrestateDigest,
  performPortfolioHygieneEffect,
} from "../src/internal/notion-maintenance/notion-hygiene-pass.js";
import type { NotionHygieneEffect } from "../src/internal/notion-maintenance/notion-hygiene-authority.js";

function fixture() {
  let markdown = "# Duplicate\n\nOriginal content";
  let page: Record<string, unknown> = {
    object: "page",
    id: "page-duplicate",
    url: "https://notion.example/page-duplicate",
    created_time: "2026-08-01T00:00:00.000Z",
    last_edited_time: "2026-08-01T00:00:00.000Z",
    archived: false,
    in_trash: false,
    parent: { type: "data_source_id", data_source_id: "db-1" },
    properties: {
      Name: {
        id: "title",
        type: "title",
        title: [{ plain_text: "Duplicate" }],
      },
      Projects: {
        id: "relation",
        type: "relation",
        relation: [{ id: "project-1" }],
        has_more: false,
      },
    },
  };
  const update = vi.fn().mockResolvedValue({});
  const sdk = {
    pages: {
      retrieve: vi.fn().mockImplementation(async () => structuredClone(page)),
      update,
    },
  };
  const api = {
    retrievePagePropertyItems: vi.fn(),
    readPageMarkdown: vi.fn().mockImplementation(async () => ({
      markdown,
      raw: { markdown },
      truncated: false,
      unknownBlockIds: [],
    })),
  };
  return {
    api,
    sdk,
    update,
    setMarkdown(value: string) {
      markdown = value;
    },
    setPage(value: Record<string, unknown>) {
      page = value;
    },
    page() {
      return structuredClone(page);
    },
  };
}

function archiveEffect(expectedPrestateDigest: string): NotionHygieneEffect {
  return {
    effectId: "archive:page-duplicate",
    kind: "page_archive",
    targetId: "page-duplicate",
    payload: {
      expected_prestate_digest: expectedPrestateDigest,
      in_trash: true,
    },
  };
}

describe("Notion hygiene archive prestate", () => {
  test("refuses an archive when provider properties changed after approval", async () => {
    const state = fixture();
    const markEffectAttempted = vi.fn();
    const digest = await archivePagePrestateDigest({
      pageId: "page-duplicate",
      sdk: state.sdk as never,
      api: state.api as never,
    });
    const changed = state.page();
    const properties = changed.properties as Record<string, unknown>;
    properties.Name = {
      id: "title",
      type: "title",
      title: [{ plain_text: "No longer a duplicate" }],
    };
    state.setPage(changed);

    await expect(
      performPortfolioHygieneEffect({
        effect: archiveEffect(digest),
        sdk: state.sdk as never,
        api: state.api as never,
        markEffectAttempted,
      }),
    ).rejects.toThrow(/changed after plan approval/i);
    expect(markEffectAttempted).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  test("refuses an archive when page content changed after approval", async () => {
    const state = fixture();
    const markEffectAttempted = vi.fn();
    const digest = await archivePagePrestateDigest({
      pageId: "page-duplicate",
      sdk: state.sdk as never,
      api: state.api as never,
    });
    state.setMarkdown("# Duplicate\n\nMaterially changed content");

    await expect(
      performPortfolioHygieneEffect({
        effect: archiveEffect(digest),
        sdk: state.sdk as never,
        api: state.api as never,
        markEffectAttempted,
      }),
    ).rejects.toThrow(/changed after plan approval/i);
    expect(markEffectAttempted).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  test("archives only when the complete provider prestate still matches", async () => {
    const state = fixture();
    const markEffectAttempted = vi.fn();
    const digest = await archivePagePrestateDigest({
      pageId: "page-duplicate",
      sdk: state.sdk as never,
      api: state.api as never,
    });

    await expect(
      performPortfolioHygieneEffect({
        effect: archiveEffect(digest),
        sdk: state.sdk as never,
        api: state.api as never,
        markEffectAttempted,
      }),
    ).resolves.toBe("notion:page:page-duplicate");
    expect(state.update).toHaveBeenCalledWith({
      page_id: "page-duplicate",
      in_trash: true,
    });
    expect(markEffectAttempted).toHaveBeenCalledTimes(1);
  });
});
