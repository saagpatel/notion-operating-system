import type {
  DestinationConfig,
  MarkdownPatchInput,
  NotionApi,
  PageSnapshot,
  PublishRequest,
  PublishSummary,
  ResolvedDestination,
  TemplateDescriptor,
} from "../types.js";
import type { RunLogger } from "../logging/run-logger.js";
import { parseInputFile } from "../utils/files.js";
import { AppError } from "../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand, validateContentUpdates } from "../utils/markdown.js";
import { buildDataSourceProperties, buildPageDestinationProperties, resolveLookupTitle } from "./property-validator.js";
import { waitForTemplateReadiness } from "./template-ready.js";

export class Publisher {
  public constructor(
    private readonly api: NotionApi | null,
    private readonly logger: RunLogger,
  ) {}

  public async publish(destination: DestinationConfig, request: PublishRequest): Promise<PublishSummary> {
    const parsed = await parseInputFile(request.inputFile);
    const dryRun = request.live ? false : request.dryRun ?? true;

    await this.logger.info("publish_request_loaded", {
      destinationAlias: destination.alias,
      inputFile: parsed.absolutePath,
      dryRun,
      mode: destination.mode,
    });

    const resolvedDestination = await this.resolveDestination(destination, dryRun);
    const warnings: string[] = [];

    if (resolvedDestination.destinationType === "page") {
      const built = buildPageDestinationProperties(destination, parsed, request.titleOverride);
      if (destination.mode === "create_new_page") {
        return this.publishToPageParent({
          destination,
          request,
          resolvedDestination,
          dryRun,
          parsedBody: parsed.body,
          title: built.title,
          properties: built.properties,
          warnings,
        });
      }

      return this.publishToStandalonePage({
        destination,
        request,
        resolvedDestination,
        dryRun,
        parsedBody: parsed.body,
        title: built.title,
        properties: built.properties,
        warnings,
      });
    }

    const schema =
      this.api
        ? await this.api.retrieveDataSource(resolvedDestination.dataSourceId)
        : destination.schemaSnapshot
          ? {
              ...destination.schemaSnapshot,
              id: destination.schemaSnapshot.id ?? resolvedDestination.dataSourceId,
            }
          : (() => {
              throw new AppError(
                `Dry-run without a Notion token requires schemaSnapshot for data source destination "${destination.alias}"`,
              );
            })();
    const built = buildDataSourceProperties({
      destination,
      schema,
      parsed,
      titleOverride: request.titleOverride,
      propertyOverrides: request.propertyOverrides,
    });

    return this.publishToDataSource({
      destination,
      request,
      resolvedDestination,
      dryRun,
      parsedBody: parsed.body,
      title: built.title,
      properties: built.properties,
      warnings,
      titlePropertyName: schema.titlePropertyName,
    });
  }

  private async publishToPageParent({
    destination,
    request,
    resolvedDestination,
    dryRun,
    parsedBody,
    title,
    properties,
    warnings,
  }: {
    destination: DestinationConfig;
    request: PublishRequest;
    resolvedDestination: ResolvedDestination;
    dryRun: boolean;
    parsedBody: string;
    title?: string;
    properties: Record<string, unknown>;
    warnings: string[];
  }): Promise<PublishSummary> {
    if (resolvedDestination.destinationType !== "page") {
      throw new AppError("Expected a page destination");
    }

    if (destination.mode !== "create_new_page") {
      throw new AppError(`Page destinations only support create_new_page in this project`);
    }

    if (dryRun) {
      return {
        destinationAlias: destination.alias,
        dryRun,
        mode: destination.mode,
        resolvedDestination,
        title,
        propertiesApplied: properties,
        warnings,
      };
    }

    const api = this.requireApi();
    const page = await api.createPageWithMarkdown({
      parent: { page_id: resolvedDestination.pageId },
      properties,
      markdown: parsedBody,
    });
    const readback = await api.readPageMarkdown(page.id);
    collectReadWarnings(readback, warnings);

    return {
      destinationAlias: destination.alias,
      dryRun,
      mode: destination.mode,
      resolvedDestination,
      pageId: page.id,
      pageUrl: page.url,
      title,
      propertiesApplied: properties,
      finalMarkdownReadback: readback,
      warnings,
    };
  }

  private async publishToStandalonePage({
    destination,
    request,
    resolvedDestination,
    dryRun,
    parsedBody,
    title,
    properties,
    warnings,
  }: {
    destination: DestinationConfig;
    request: PublishRequest;
    resolvedDestination: ResolvedDestination;
    dryRun: boolean;
    parsedBody: string;
    title?: string;
    properties: Record<string, unknown>;
    warnings: string[];
  }): Promise<PublishSummary> {
    if (resolvedDestination.destinationType !== "page") {
      throw new AppError("Expected a page destination");
    }

    if (destination.mode === "create_new_page") {
      throw new AppError("Standalone page updates do not support create_new_page");
    }

    const targetPage = dryRun
      ? {
          id: resolvedDestination.pageId,
          url: resolvedDestination.sourceUrl,
        }
      : await this.requireApi().retrievePage(resolvedDestination.pageId);

    if (dryRun) {
      return {
        destinationAlias: destination.alias,
        dryRun,
        mode: destination.mode,
        resolvedDestination,
        pageId: targetPage.id,
        pageUrl: targetPage.url,
        title,
        propertiesApplied: properties,
        warnings,
      };
    }

    const liveApi = this.requireApi();

    if (Object.keys(properties).length > 0) {
      await liveApi.updatePageProperties({
        pageId: targetPage.id,
        properties,
      });
    }

    if (destination.mode === "replace_full_content") {
      if (!destination.safeDefaults.allowDeletingContent) {
        const previous = await liveApi.readPageMarkdown(targetPage.id);
        assertSafeReplacement(previous.markdown, parsedBody);
      }

      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "replace_content",
        newMarkdown: buildReplaceCommand(parsedBody),
      });
    } else if (destination.mode === "targeted_search_replace") {
      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "update_content",
        contentUpdates: validateContentUpdates(request.contentUpdates),
      });
    } else if (destination.mode === "update_existing_page" && request.contentUpdates?.length) {
      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "update_content",
        contentUpdates: request.contentUpdates,
      });
    }

    const readback = await liveApi.readPageMarkdown(targetPage.id);
    collectReadWarnings(readback, warnings);

    return {
      destinationAlias: destination.alias,
      dryRun,
      mode: destination.mode,
      resolvedDestination,
      pageId: targetPage.id,
      pageUrl: targetPage.url,
      title,
      propertiesApplied: properties,
      finalMarkdownReadback: readback,
      warnings,
    };
  }

  private async publishToDataSource({
    destination,
    request,
    resolvedDestination,
    dryRun,
    parsedBody,
    title,
    properties,
    warnings,
    titlePropertyName,
  }: {
    destination: DestinationConfig;
    request: PublishRequest;
    resolvedDestination: ResolvedDestination;
    dryRun: boolean;
    parsedBody: string;
    title?: string;
    properties: Record<string, unknown>;
    warnings: string[];
    titlePropertyName: string;
  }): Promise<PublishSummary> {
    if (resolvedDestination.destinationType !== "data_source") {
      throw new AppError("Expected a data source destination");
    }

    const api = dryRun ? null : this.requireApi();

    if (destination.mode === "create_new_page") {
      const template = api ? await resolveTemplate(api, destination, resolvedDestination.dataSourceId) : undefined;

      if (dryRun) {
        return {
          destinationAlias: destination.alias,
          dryRun,
          mode: destination.mode,
          resolvedDestination,
          title,
          propertiesApplied: properties,
          templateUsed: template?.name,
          warnings,
        };
      }

      const liveApi = this.requireApi();
      const page = await liveApi.createPageWithMarkdown({
        parent: { data_source_id: resolvedDestination.dataSourceId },
        properties,
        markdown: template ? undefined : parsedBody,
        template: template
          ? template.isDefault
            ? { type: "default" }
            : { type: "template_id", template_id: template.id }
          : undefined,
      });

      if (template && parsedBody.trim().length > 0 && destination.postTemplatePatchMode !== "none") {
        await waitForTemplateReadiness({
          api: liveApi,
          pageId: page.id,
          timeoutMs: destination.safeDefaults.templatePollTimeoutMs,
          intervalMs: destination.safeDefaults.templatePollIntervalMs,
          logger: this.logger,
        });

        await liveApi.patchPageMarkdown({
          pageId: page.id,
          command: "replace_content",
          newMarkdown: buildReplaceCommand(parsedBody),
        });
      }

      const readback = await liveApi.readPageMarkdown(page.id);
      collectReadWarnings(readback, warnings);

      return {
        destinationAlias: destination.alias,
        dryRun,
        mode: destination.mode,
        resolvedDestination,
        pageId: page.id,
        pageUrl: page.url,
        title,
        propertiesApplied: properties,
        templateUsed: template?.name,
        finalMarkdownReadback: readback,
        warnings,
      };
    }

    const targetPage = await resolveTargetPage({
      api,
      destination,
      request,
      resolvedDestination,
      title,
      titlePropertyName,
      dryRun,
    });

    if (dryRun) {
      return {
        destinationAlias: destination.alias,
        dryRun,
        mode: destination.mode,
        resolvedDestination,
        pageId: targetPage?.id,
        pageUrl: targetPage?.url,
        title,
        propertiesApplied: properties,
        warnings,
      };
    }

    if (!targetPage) {
      throw new AppError(`Could not locate a target page for alias "${destination.alias}"`);
    }

    const liveApi = this.requireApi();

    await liveApi.updatePageProperties({
      pageId: targetPage.id,
      properties,
    });

    if (destination.mode === "replace_full_content") {
      if (!destination.safeDefaults.allowDeletingContent) {
        const previous = await liveApi.readPageMarkdown(targetPage.id);
        assertSafeReplacement(previous.markdown, parsedBody);
      }

      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "replace_content",
        newMarkdown: buildReplaceCommand(parsedBody),
      });
    } else if (destination.mode === "targeted_search_replace") {
      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "update_content",
        contentUpdates: validateContentUpdates(request.contentUpdates),
      });
    } else if (destination.mode === "update_existing_page" && request.contentUpdates?.length) {
      await liveApi.patchPageMarkdown({
        pageId: targetPage.id,
        command: "update_content",
        contentUpdates: request.contentUpdates,
      });
    }

    const readback = await liveApi.readPageMarkdown(targetPage.id);
    collectReadWarnings(readback, warnings);

    return {
      destinationAlias: destination.alias,
      dryRun,
      mode: destination.mode,
      resolvedDestination,
      pageId: targetPage.id,
      pageUrl: targetPage.url,
      title,
      propertiesApplied: properties,
      finalMarkdownReadback: readback,
      warnings,
    };
  }

  private async resolveDestination(destination: DestinationConfig, dryRun: boolean): Promise<ResolvedDestination> {
    if (!this.api) {
      if (destination.destinationType === "page") {
        if (!destination.resolvedId) {
          throw new AppError(
            `Dry-run without a Notion token requires resolvedId for page destination "${destination.alias}"`,
          );
        }
        return {
          alias: destination.alias,
          sourceUrl: destination.sourceUrl,
          destinationType: "page",
          pageId: destination.resolvedId,
        };
      }

      if (!destination.resolvedId) {
        throw new AppError(
          `Dry-run without a Notion token requires resolvedId for data source destination "${destination.alias}"`,
        );
      }

      return {
        alias: destination.alias,
        sourceUrl: destination.sourceUrl,
        destinationType: "data_source",
        dataSourceId: destination.resolvedId,
      };
    }

    return this.api.resolveDestination(destination);
  }

  private requireApi(): NotionApi {
    if (!this.api) {
      throw new AppError("NOTION_TOKEN is required for live validation or live publishing");
    }

    return this.api;
  }
}

async function resolveTemplate(
  api: NotionApi,
  destination: DestinationConfig,
  dataSourceId: string,
): Promise<TemplateDescriptor | undefined> {
  if (destination.templateMode === "none") {
    return undefined;
  }

  const templates = await api.listTemplates(dataSourceId);
  if (destination.templateMode === "default") {
    const template = templates.find((entry) => entry.isDefault);
    if (!template) {
      throw new AppError(`No default template found for alias "${destination.alias}"`);
    }
    return template;
  }

  if (destination.templateId) {
    const template = templates.find((entry) => entry.id === destination.templateId);
    if (!template) {
      throw new AppError(`Template ${destination.templateId} not found for alias "${destination.alias}"`);
    }
    return template;
  }

  if (destination.templateName) {
    const template = templates.find((entry) => entry.name === destination.templateName);
    if (!template) {
      throw new AppError(`Template "${destination.templateName}" not found for alias "${destination.alias}"`);
    }
    return template;
  }

  throw new AppError(`Destination "${destination.alias}" uses templateMode=specific but has no templateId or templateName`);
}

async function resolveTargetPage({
  api,
  destination,
  request,
  resolvedDestination,
  title,
  titlePropertyName,
  dryRun,
}: {
  api: NotionApi | null;
  destination: DestinationConfig;
  request: PublishRequest;
  resolvedDestination: ResolvedDestination;
  title?: string;
  titlePropertyName: string;
  dryRun: boolean;
}): Promise<PageSnapshot | null> {
  const lookup = request.lookupOverride ?? destination.lookup;
  if (!lookup) {
    throw new AppError(`Destination "${destination.alias}" requires lookup rules for update modes`);
  }

  if (lookup.by === "page_id") {
    if (!lookup.value) {
      throw new AppError(`Lookup rule "page_id" for "${destination.alias}" requires a value`);
    }
    if (dryRun && !api) {
      return {
        id: lookup.value,
        url: lookup.value,
      };
    }
    return api?.retrievePage(lookup.value) ?? null;
  }

  if (lookup.by === "url") {
    if (!lookup.value) {
      throw new AppError(`Lookup rule "url" for "${destination.alias}" requires a value`);
    }
    if (dryRun && !api) {
      return {
        id: lookup.value,
        url: lookup.value,
      };
    }
    const resolved = await api?.resolveDestination({
      alias: destination.alias,
      description: destination.description,
      destinationType: "page",
      sourceUrl: lookup.value,
      templateMode: destination.templateMode,
      titleRule: destination.titleRule,
      fixedProperties: destination.fixedProperties,
      defaultProperties: destination.defaultProperties,
      mode: destination.mode,
      lookup: destination.lookup,
      safeDefaults: destination.safeDefaults,
      postTemplatePatchMode: destination.postTemplatePatchMode,
    });
    if (!resolved || resolved.destinationType !== "page") {
      return null;
    }
    return api?.retrievePage(resolved.pageId) ?? null;
  }

  const effectiveTitle =
    lookup.by === "title" ? lookup.value || resolveLookupTitle(destination, title) : undefined;
  if (!api || resolvedDestination.destinationType !== "data_source") {
    return effectiveTitle
      ? {
          id: effectiveTitle,
          url: effectiveTitle,
          title: effectiveTitle,
        }
      : null;
  }

  if (lookup.by === "title") {
    return api.searchPage({
      dataSourceId: resolvedDestination.dataSourceId,
      exactTitle: effectiveTitle,
      titleProperty: lookup.titleProperty || titlePropertyName,
    });
  }

  return api.searchPage({
    query: lookup.value,
  });
}

function collectReadWarnings(
  readback: { truncated: boolean; unknownBlockIds: string[] },
  warnings: string[],
): void {
  if (readback.truncated) {
    warnings.push("Final markdown readback reported truncation.");
  }
  if (readback.unknownBlockIds.length > 0) {
    warnings.push(`Final markdown readback contained unknown_block_ids: ${readback.unknownBlockIds.join(", ")}`);
  }
}
