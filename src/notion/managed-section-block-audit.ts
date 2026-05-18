import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { DirectNotionClient, type NotionBlockChild } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import { TODAY_FOCUS_END, TODAY_FOCUS_START } from "./today-focus.js";

export interface ManagedSectionBlockAuditOptions {
  today?: string;
  config?: string;
  section?: string;
}

export type ManagedSectionBlockAuditStatus =
  | "marker_span_found"
  | "missing_start_marker"
  | "missing_end_marker"
  | "multiple_start_markers"
  | "multiple_end_markers"
  | "end_before_start";

export interface ManagedSectionBlockAudit {
  status: ManagedSectionBlockAuditStatus;
  topLevelBlockCount: number;
  startIndex?: number;
  endIndex?: number;
  startBlockId?: string;
  endBlockId?: string;
  spanBlockCount?: number;
  spanBlockTypes?: string[];
  canReadWithBlocks: boolean;
  canReplaceWithBlocks: boolean;
  recommendedWriteMode: "markdown-rest-managed-section";
  decision: string;
}

export async function runManagedSectionBlockAuditCommand(
  options: ManagedSectionBlockAuditOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for managed-section-audit",
  );
  const today = options.today ?? losAngelesToday();
  const section = options.section ?? "today-focus";
  const markers = resolveManagedSectionMarkers(section);
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
  const api = new DirectNotionClient(token);
  const weekStart = startOfWeekMonday(today);
  const weeklySchema = await api.retrieveDataSource(
    config.relatedDataSources.weeklyReviewsId,
  );
  const weeklyPages = await fetchAllPages(
    api,
    config.relatedDataSources.weeklyReviewsId,
    weeklySchema.titlePropertyName,
  );
  const weeklyReview = weeklyPages.find(
    (page) => page.title === `Week of ${weekStart}`,
  );

  if (!weeklyReview) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          today,
          weekStart,
          section,
          weeklyReviewFound: false,
          audit: null,
          decision:
            "No weekly review page exists for the date anchor, so there is no managed section to inspect.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const blocks = await listAllTopLevelBlocks(api, weeklyReview.id);
  const audit = inspectManagedSectionBlocks({
    blocks,
    startMarker: markers.startMarker,
    endMarker: markers.endMarker,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        today,
        weekStart,
        section,
        weeklyReviewFound: true,
        weeklyReviewPageId: weeklyReview.id,
        weeklyReviewUrl: weeklyReview.url,
        audit,
      },
      null,
      2,
    ),
  );
}

export function inspectManagedSectionBlocks(input: {
  blocks: NotionBlockChild[];
  startMarker: string;
  endMarker: string;
}): ManagedSectionBlockAudit {
  const blocks = input.blocks.filter((block) => !block.archived && !block.inTrash);
  const startMatches = findMarkerMatches(blocks, input.startMarker);
  const endMatches = findMarkerMatches(blocks, input.endMarker);
  const base = {
    topLevelBlockCount: blocks.length,
    canReadWithBlocks: false,
    canReplaceWithBlocks: false,
    recommendedWriteMode: "markdown-rest-managed-section" as const,
    decision:
      "Keep managed-section writes on the markdown REST path until block replacement has a transactional or rollback-safe writer.",
  };

  if (startMatches.length === 0) {
    return { ...base, status: "missing_start_marker" };
  }
  if (endMatches.length === 0) {
    return { ...base, status: "missing_end_marker" };
  }
  if (startMatches.length > 1) {
    return { ...base, status: "multiple_start_markers" };
  }
  if (endMatches.length > 1) {
    return { ...base, status: "multiple_end_markers" };
  }

  const startIndex = startMatches[0]!;
  const endIndex = endMatches[0]!;
  if (endIndex <= startIndex) {
    return {
      ...base,
      status: "end_before_start",
      startIndex,
      endIndex,
      startBlockId: blocks[startIndex]?.id,
      endBlockId: blocks[endIndex]?.id,
    };
  }

  const span = blocks.slice(startIndex, endIndex + 1);
  return {
    ...base,
    status: "marker_span_found",
    startIndex,
    endIndex,
    startBlockId: blocks[startIndex]?.id,
    endBlockId: blocks[endIndex]?.id,
    spanBlockCount: span.length,
    spanBlockTypes: span.map((block) => block.type),
    canReadWithBlocks: true,
  };
}

async function listAllTopLevelBlocks(
  api: DirectNotionClient,
  pageId: string,
): Promise<NotionBlockChild[]> {
  const blocks: NotionBlockChild[] = [];
  let nextCursor: string | undefined;

  while (true) {
    const response = await api.listBlockChildren({
      blockId: pageId,
      pageSize: 100,
      startCursor: nextCursor,
    });
    blocks.push(...response.results);
    if (!response.hasMore || !response.nextCursor) {
      return blocks;
    }
    nextCursor = response.nextCursor;
  }
}

function resolveManagedSectionMarkers(section: string): {
  startMarker: string;
  endMarker: string;
} {
  if (section === "today-focus") {
    return {
      startMarker: TODAY_FOCUS_START,
      endMarker: TODAY_FOCUS_END,
    };
  }
  throw new Error(
    `Unsupported managed section "${section}". Supported sections: today-focus`,
  );
}

function findMarkerMatches(blocks: NotionBlockChild[], marker: string): number[] {
  const normalizedMarker = marker.trim();
  return blocks.flatMap((block, index) =>
    block.plainText.trim() === normalizedMarker ? [index] : [],
  );
}
