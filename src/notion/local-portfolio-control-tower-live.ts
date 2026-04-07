import { Client } from "@notionhq/client";

import type { DirectNotionClient } from "./direct-notion-client.js";
import type {
  ControlTowerBuildSessionRecord,
  ControlTowerProjectRecord,
  LocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { normalizeNotionId } from "../utils/notion-id.js";

export interface NotionPageProperty {
  type: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string | null } | null;
  status?: { name?: string | null } | null;
  multi_select?: Array<{ name?: string }>;
  relation?: Array<{ id: string }>;
  people?: Array<{ id?: string }>;
  checkbox?: boolean;
  date?: { start?: string | null } | null;
  number?: number | null;
  url?: string | null;
}

export interface DataSourcePageRef {
  id: string;
  url: string;
  title: string;
  createdTime?: string;
  properties: Record<string, NotionPageProperty>;
}

export async function ensureLocalPortfolioControlTowerSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
): Promise<void> {
  await sdk.request({
    path: `data_sources/${config.database.dataSourceId}`,
    method: "patch",
    body: {
      properties: {
        "Operating Queue": {
          select: {
            options: colorize([
              ["Shipped", "green"],
              ["Needs Review", "red"],
              ["Needs Decision", "orange"],
              ["Worth Finishing", "blue"],
              ["Resume Now", "green"],
              ["Cold Storage", "gray"],
              ["Watch", "default"],
            ]),
          },
        },
        "Next Review Date": { date: {} },
        "Evidence Freshness": {
          select: {
            options: colorize([
              ["Fresh", "green"],
              ["Aging", "orange"],
              ["Stale", "red"],
            ]),
          },
        },
      },
    },
  });
}

export async function fetchAllPages(
  sdk: Client,
  dataSourceId: string,
  titlePropertyName: string,
): Promise<DataSourcePageRef[]> {
  const pages: DataSourcePageRef[] = [];
  let nextCursor: string | undefined;

  while (true) {
    const response = (await sdk.request({
      path: `data_sources/${dataSourceId}/query`,
      method: "post",
      body: {
        page_size: 100,
        start_cursor: nextCursor,
      },
    })) as {
      results?: Array<{
        id: string;
        url: string;
        created_time?: string;
        in_trash?: boolean;
        archived?: boolean;
        properties?: Record<string, NotionPageProperty>;
      }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const page of response.results ?? []) {
      if (page.in_trash || page.archived) {
        continue;
      }
      pages.push({
        id: normalizeNotionId(page.id),
        url: page.url,
        createdTime: page.created_time,
        title: titleFromProperty(page.properties?.[titlePropertyName]),
        properties: page.properties ?? {},
      });
    }

    if (!response.has_more || !response.next_cursor) {
      break;
    }
    nextCursor = response.next_cursor;
  }

  return pages;
}

export function toControlTowerProjectRecord(page: DataSourcePageRef): ControlTowerProjectRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    currentState: selectValue(page.properties["Current State"]),
    portfolioCall: selectValue(page.properties["Portfolio Call"]),
    momentum: selectValue(page.properties.Momentum),
    needsReview: checkboxValue(page.properties["Needs Review"]),
    nextMove: textValue(page.properties["Next Move"]),
    biggestBlocker: textValue(page.properties["Biggest Blocker"]),
    lastActive: dateValue(page.properties["Last Active"]),
    dateUpdated: dateValue(page.properties["Date Updated"]),
    lastBuildSessionDate: dateValue(page.properties["Last Build Session Date"]),
    buildSessionCount: numberValue(page.properties["Build Session Count"]),
    relatedResearchCount: numberValue(page.properties["Related Research Count"]),
    supportingSkillsCount: numberValue(page.properties["Supporting Skills Count"]),
    linkedToolCount: numberValue(page.properties["Linked Tool Count"]),
    setupFriction: selectValue(page.properties["Setup Friction"]),
    runsLocally: selectValue(page.properties["Runs Locally"]),
    buildMaturity: selectValue(page.properties["Build Maturity"]),
    shipReadiness: selectValue(page.properties["Ship Readiness"]),
    effortToDemo: selectValue(page.properties["Effort to Demo"]),
    effortToShip: selectValue(page.properties["Effort to Ship"]),
    oneLinePitch: textValue(page.properties["One-Line Pitch"]),
    valueOutcome: textValue(page.properties["Value / Outcome"]),
    monetizationValue: textValue(page.properties["Monetization / Strategic Value"]),
    evidenceConfidence: selectValue(page.properties["Evidence Confidence"]),
    docsQuality: selectValue(page.properties["Docs Quality"]),
    testPosture: selectValue(page.properties["Test Posture"]),
    category: selectValue(page.properties.Category),
    operatingQueue: selectValue(page.properties["Operating Queue"]) as ControlTowerProjectRecord["operatingQueue"],
    nextReviewDate: dateValue(page.properties["Next Review Date"]),
    evidenceFreshness: selectValue(page.properties["Evidence Freshness"]) as ControlTowerProjectRecord["evidenceFreshness"],
  };
}

export function toBuildSessionRecord(page: DataSourcePageRef): ControlTowerBuildSessionRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    sessionDate: dateValue(page.properties["Session Date"]),
    outcome: selectValue(page.properties.Outcome),
    localProjectIds: relationIds(page.properties["Local Project"]),
  };
}

export async function upsertPageByTitle(options: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  title: string;
  properties: Record<string, unknown>;
  markdown: string;
}): Promise<{ id: string; url: string; existed: boolean }> {
  const existing = await options.api.searchPage({
    dataSourceId: options.dataSourceId,
    exactTitle: options.title,
    titleProperty: options.titlePropertyName,
  });

  if (existing) {
    await options.api.updatePageProperties({
      pageId: existing.id,
      properties: options.properties,
    });
    await options.api.patchPageMarkdown({
      pageId: existing.id,
      command: "replace_content",
      newMarkdown: options.markdown,
    });
    return {
      id: existing.id,
      url: existing.url,
      existed: true,
    };
  }

  const titleProperty =
    options.properties[options.titlePropertyName] ?? titleValue(options.title);
  const created = await options.api.createPageWithMarkdown({
    parent: {
      data_source_id: options.dataSourceId,
    },
    properties: {
      [options.titlePropertyName]: titleProperty,
    },
    markdown: options.markdown,
  });
  const nonTitleProperties = Object.fromEntries(
    Object.entries(options.properties).filter(([name]) => name !== options.titlePropertyName),
  );
  if (Object.keys(nonTitleProperties).length > 0) {
    await options.api.updatePageProperties({
      pageId: created.id,
      properties: nonTitleProperties,
    });
  }
  return {
    id: created.id,
    url: created.url,
    existed: false,
  };
}

export function relationIds(property?: NotionPageProperty): string[] {
  return (property?.relation ?? []).map((entry) => normalizeNotionId(entry.id));
}

export function titleFromProperty(property?: NotionPageProperty): string {
  return (property?.title ?? []).map((item) => item.plain_text ?? "").join("").trim();
}

export function textValue(property?: NotionPageProperty): string {
  return (property?.rich_text ?? []).map((item) => item.plain_text ?? "").join("").trim();
}

export function selectValue(property?: NotionPageProperty): string {
  return property?.select?.name?.trim() || property?.status?.name?.trim() || "";
}

export function checkboxValue(property?: NotionPageProperty): boolean {
  return Boolean(property?.checkbox);
}

export function dateValue(property?: NotionPageProperty): string {
  return property?.date?.start?.slice(0, 10) ?? "";
}

export function numberValue(property?: NotionPageProperty): number {
  return typeof property?.number === "number" ? property.number : 0;
}

export function richTextValue(value: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return {
    rich_text: value
      ? [
          {
            type: "text",
            text: {
              content: value,
            },
          },
        ]
      : [],
  };
}

export function titleValue(value: string): { title: Array<{ type: "text"; text: { content: string } }> } {
  return {
    title: [
      {
        type: "text",
        text: {
          content: value,
        },
      },
    ],
  };
}

export function selectPropertyValue(value: string | undefined): { select?: { name: string } } {
  return value ? { select: { name: value } } : {};
}

export function datePropertyValue(value: string | undefined): { date?: { start: string } } {
  return value ? { date: { start: value } } : {};
}

export function relationValue(ids: string[]): { relation: Array<{ id: string }> } {
  return {
    relation: ids.map((id) => ({ id })),
  };
}

export function multiSelectValue(values: string[]): { multi_select: Array<{ name: string }> } {
  return {
    multi_select: values.map((value) => ({ name: value })),
  };
}

function colorize(entries: Array<[string, string]>): Array<{ name: string; color: string }> {
  return entries.map(([name, color]) => ({ name, color }));
}
