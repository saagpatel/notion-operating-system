import { describe, expect, test } from "vitest";

import {
  inspectManagedSectionBlocks,
  type ManagedSectionBlockAudit,
} from "../src/notion/managed-section-block-audit.js";
import type { NotionBlockChild } from "../src/notion/direct-notion-client.js";

describe("managed section block audit", () => {
  test("finds a top-level marker span without enabling block writes", () => {
    const audit = inspectManagedSectionBlocks({
      blocks: [
        block("intro", "paragraph", "Overview"),
        block("start", "paragraph", "<!-- codex:notion-today-focus:start -->"),
        block("heading", "heading_2", "Daily Focus - 2026-05-18"),
        block("item", "numbered_list_item", "AIWorkFlow - next action"),
        block("end", "paragraph", "<!-- codex:notion-today-focus:end -->"),
      ],
      startMarker: "<!-- codex:notion-today-focus:start -->",
      endMarker: "<!-- codex:notion-today-focus:end -->",
    });

    expect(audit).toMatchObject<Partial<ManagedSectionBlockAudit>>({
      status: "marker_span_found",
      startIndex: 1,
      endIndex: 4,
      spanBlockCount: 4,
      canReadWithBlocks: true,
      canReplaceWithBlocks: false,
      recommendedWriteMode: "markdown-rest-managed-section",
    });
    expect(audit.spanBlockTypes).toEqual([
      "paragraph",
      "heading_2",
      "numbered_list_item",
      "paragraph",
    ]);
  });

  test("reports ambiguous marker spans", () => {
    const audit = inspectManagedSectionBlocks({
      blocks: [
        block("start-a", "paragraph", "start"),
        block("start-b", "paragraph", "start"),
        block("end", "paragraph", "end"),
      ],
      startMarker: "start",
      endMarker: "end",
    });

    expect(audit.status).toBe("multiple_start_markers");
    expect(audit.canReadWithBlocks).toBe(false);
    expect(audit.canReplaceWithBlocks).toBe(false);
  });

  test("ignores archived marker blocks", () => {
    const audit = inspectManagedSectionBlocks({
      blocks: [
        { ...block("old-start", "paragraph", "start"), archived: true },
        block("body", "paragraph", "body"),
        block("end", "paragraph", "end"),
      ],
      startMarker: "start",
      endMarker: "end",
    });

    expect(audit.status).toBe("missing_start_marker");
  });
});

function block(
  id: string,
  type: string,
  plainText: string,
): NotionBlockChild {
  return {
    id,
    type,
    plainText,
    hasChildren: false,
    archived: false,
    inTrash: false,
  };
}
