import { Client } from "@notionhq/client";

import type {
  ContentUpdate,
  CreatePageInput,
  DataSourceSchemaSnapshot,
  DestinationConfig,
  MarkdownPatchInput,
  MarkdownReadResult,
  NotionApi,
  PageSnapshot,
  PageUpdateInput,
  PropertySchema,
  ResolvedDestination,
  SearchPageOptions,
  TemplateDescriptor,
} from "../types.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";
import { AppError } from "../utils/errors.js";
import { NotionHttp } from "./http.js";
import type { RunLogger } from "../logging/run-logger.js";

export class DirectNotionClient implements NotionApi {
  private readonly sdk: Client;

  private readonly http: NotionHttp;

  public constructor(token: string, logger?: RunLogger) {
    this.sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    this.http = new NotionHttp({ token, notionVersion: "2026-03-11", logger });
  }

  public async resolveDestination(destination: DestinationConfig): Promise<ResolvedDestination> {
    if (destination.destinationType === "page") {
      const pageId = normalizeNotionId(
        destination.resolvedId ?? extractRequiredId(destination.sourceUrl, destination.alias),
      );
      const page = await this.retrievePage(pageId);
      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "page",
        pageId: page.id,
      };
    }

    const storedId = destination.resolvedId ? normalizeNotionId(destination.resolvedId) : undefined;
    if (storedId) {
      const dataSource = await this.retrieveDataSource(storedId);
      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "data_source",
        dataSourceId: dataSource.id,
      };
    }

    if (destination.sourceUrl.startsWith("collection://")) {
      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "data_source",
      dataSourceId: normalizeNotionId(destination.sourceUrl.split("://")[1] ?? ""),
      };
    }

    const objectId = extractRequiredId(destination.sourceUrl, destination.alias);

    try {
      const dataSource = await this.retrieveDataSource(objectId);
      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "data_source",
        dataSourceId: dataSource.id,
      };
    } catch {
      const database = (await this.sdk.request({
        path: `databases/${objectId}`,
        method: "get",
      })) as { id: string; data_sources?: Array<{ id: string }> };

      const firstDataSource = database.data_sources?.[0];
      if (!firstDataSource) {
        throw new AppError(`Database for alias "${destination.alias}" has no data sources`);
      }

      if ((database.data_sources?.length ?? 0) > 1) {
        throw new AppError(
          `Database for alias "${destination.alias}" exposes multiple data sources; store a resolvedId instead of only a database URL`,
        );
      }

      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "data_source",
        dataSourceId: normalizeNotionId(firstDataSource.id),
      };
    }
  }

  public async retrievePage(pageId: string): Promise<PageSnapshot> {
    const response = (await this.sdk.pages.retrieve({ page_id: pageId })) as {
      id: string;
      url: string;
      properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
    };
    const title = findPageTitle(response.properties);
    return {
      id: normalizeNotionId(response.id),
      url: response.url,
      title,
    };
  }

  public async retrieveDataSource(dataSourceId: string): Promise<DataSourceSchemaSnapshot> {
    const response = (await this.sdk.request({
      path: `data_sources/${dataSourceId}`,
      method: "get",
    })) as {
      id: string;
      title?: unknown;
      name?: string;
      properties: Record<string, { id?: string; name?: string; type: string }>;
    };

    const properties = Object.fromEntries(
      Object.entries(response.properties).map(([name, property]) => [
        name,
        mapPropertySchema(name, property),
      ]),
    );

    const titlePropertyName = Object.values(properties).find((property) => property.type === "title")?.name;
    if (!titlePropertyName) {
      throw new AppError(`Data source ${dataSourceId} does not expose a title property`);
    }

    return {
      id: normalizeNotionId(response.id),
      title: response.name ?? richTextToPlainText(response.title) ?? "Untitled data source",
      titlePropertyName,
      properties,
    };
  }

  public async listTemplates(dataSourceId: string): Promise<TemplateDescriptor[]> {
    const response = (await this.sdk.request({
      path: `data_sources/${dataSourceId}/templates`,
      method: "get",
    })) as { results?: Array<{ id: string; name?: string; is_default?: boolean }> };

    return (response.results ?? []).map((template) => ({
      id: normalizeNotionId(template.id),
      name: template.name ?? template.id,
      isDefault: Boolean(template.is_default),
    }));
  }

  public async searchPage(options: SearchPageOptions): Promise<PageSnapshot | null> {
    if (options.dataSourceId && options.exactTitle) {
      const filter = {
        property: options.titleProperty ?? "title",
        title: {
          equals: options.exactTitle,
        },
      };
      const response = (await this.sdk.request({
        path: `data_sources/${options.dataSourceId}/query`,
        method: "post",
        body: {
          filter,
          page_size: 1,
        },
      })) as { results?: Array<{ id: string; url: string; properties?: Record<string, unknown> }> };
      const result = response.results?.[0];
      return result
        ? {
            id: normalizeNotionId(result.id),
            url: result.url,
            title: options.exactTitle,
          }
        : null;
    }

    if (!options.query && !options.exactTitle) {
      return null;
    }

    const response = await this.sdk.search({
      query: options.query ?? options.exactTitle ?? "",
      filter: {
        property: "object",
        value: "page",
      },
      page_size: 10,
    });

    const result = response.results[0] as { id: string; url: string } | undefined;
    return result
      ? {
          id: normalizeNotionId(result.id),
          url: result.url,
          title: options.exactTitle ?? options.query,
        }
      : null;
  }

  public async createPageWithMarkdown(input: CreatePageInput): Promise<PageSnapshot> {
    const response = await this.http.requestJson<{ id: string; url: string }>("/pages", {
      method: "POST",
      body: {
        parent: input.parent,
        properties: input.properties,
        markdown: input.markdown,
        template: input.template,
      },
    });

    return {
      id: normalizeNotionId(response.id),
      url: response.url,
    };
  }

  public async updatePageProperties(input: PageUpdateInput): Promise<PageSnapshot> {
    const response = (await this.sdk.pages.update({
      page_id: input.pageId,
      properties: input.properties as never,
    })) as { id: string; url: string };

    return {
      id: normalizeNotionId(response.id),
      url: response.url,
    };
  }

  public async readPageMarkdown(pageId: string): Promise<MarkdownReadResult> {
    const response = await this.http.requestJson<Record<string, unknown>>(`/pages/${pageId}/markdown`);
    const markdown = typeof response.markdown === "string" ? response.markdown : "";
    const unknownBlockIds = Array.isArray(response.unknown_block_ids)
      ? response.unknown_block_ids.filter((value): value is string => typeof value === "string")
      : [];

    return {
      markdown,
      raw: response,
      truncated: Boolean(response.truncated),
      unknownBlockIds,
    };
  }

  public async patchPageMarkdown(input: MarkdownPatchInput): Promise<void> {
    const body =
      input.command === "replace_content"
        ? {
            type: "replace_content",
            replace_content: {
              new_str: input.newMarkdown ?? "",
              allow_deleting_content: false,
            },
          }
        : {
            type: "update_content",
            update_content: {
              content_updates: (input.contentUpdates ?? []).map((update: ContentUpdate) => ({
                old_str: update.oldStr,
                new_str: update.newStr,
                replace_all_matches: update.replaceAllMatches,
              })),
              allow_deleting_content: false,
            },
          };

    await this.http.requestJson(`/pages/${input.pageId}/markdown`, {
      method: "PATCH",
      body,
    });
  }
}

function extractRequiredId(sourceUrl: string, alias: string): string {
  const id = extractNotionIdFromUrl(sourceUrl);
  if (!id) {
    throw new AppError(`Could not resolve a Notion ID from destination "${alias}"`);
  }

  return id;
}

function mapPropertySchema(name: string, property: { id?: string; name?: string; type: string }): PropertySchema {
  return {
    id: property.id,
    name: property.name ?? name,
    type: property.type,
    writable: !NON_WRITABLE_PROPERTY_TYPES.has(property.type),
  };
}

const NON_WRITABLE_PROPERTY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "verification",
  "button",
]);

function findPageTitle(
  properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>,
): string | undefined {
  if (!properties) {
    return undefined;
  }

  for (const property of Object.values(properties)) {
    if (property.type === "title" && property.title) {
      return property.title.map((part) => part.plain_text ?? "").join("");
    }
  }

  return undefined;
}

function richTextToPlainText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const plainText = value
    .map((item) =>
      typeof item === "object" && item !== null && typeof (item as { plain_text?: unknown }).plain_text === "string"
        ? (item as { plain_text: string }).plain_text
        : "",
    )
    .join("")
    .trim();

  return plainText || undefined;
}
