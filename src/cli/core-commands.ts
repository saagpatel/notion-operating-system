import path from "node:path";

import { DestinationRegistry } from "../config/destination-registry.js";
import { createCommandLogger, createCommandRuntimeContext, loadCommandDestinationRegistry, resolveRequiredNotionToken } from "./context.js";
import { formatDoctorReport, runDoctor } from "../doctor.js";
import { DirectNotionClient } from "../notion/direct-notion-client.js";
import { Publisher } from "../publishing/publisher.js";
import { PublishRequestSchema } from "../types.js";
import { readJsonFile } from "../utils/files.js";
import { recordCommandOutputSummary } from "./command-summary.js";

export async function runPublishCommand(options: {
  request?: string;
  destination?: string;
  file?: string;
  dryRun?: boolean;
  live?: boolean;
  title?: string;
  property?: string[];
}): Promise<void> {
  const context = createCommandRuntimeContext();
  const logger = await createCommandLogger(context);
  const registry = await loadCommandDestinationRegistry(context);
  const request = options.request
    ? registry.parseRequestFile(await readJsonFile<unknown>(path.resolve(options.request)))
    : PublishRequestSchema.parse({
        destinationAlias: options.destination,
        inputFile: options.file,
        dryRun: options.live ? false : options.dryRun ?? true,
        live: options.live,
        titleOverride: options.title,
        propertyOverrides: parsePropertyOverrides(options.property),
      });

  const destination = registry.getDestination(request.destinationAlias);
  const notionToken = context.runtimeConfig.notion.token;
  const api = notionToken ? new DirectNotionClient(notionToken, logger) : null;
  const publisher = new Publisher(api, logger);

  const summary = await publisher.publish(destination, request);
  await logger.info("publish_complete", {
    destinationAlias: summary.destinationAlias,
    dryRun: summary.dryRun,
    pageId: summary.pageId,
    pageUrl: summary.pageUrl,
    warnings: summary.warnings,
  });

  recordCommandOutputSummary(summary as unknown as Record<string, unknown>, {
    metadata: {
      destinationAlias: summary.destinationAlias,
      pageId: summary.pageId,
    },
  });
  console.log(JSON.stringify(summary, null, 2));
}

export async function runDoctorCommand(options: { json?: boolean }): Promise<void> {
  const report = await runDoctor();
  recordCommandOutputSummary(
    {
      ok: report.ok,
      failureCount: report.checks.filter((check) => check.status === "fail").length,
      warningsCount: report.checks.filter((check) => check.status === "warn").length,
    },
    {
      metadata: {
        profile: report.runtime.profile.name,
      },
    },
  );
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

export async function runDestinationsCheckCommand(): Promise<void> {
  const registry = await DestinationRegistry.load();
  const output = {
    version: 1,
    aliases: registry.destinations.map((destination) => destination.alias),
  };
  recordCommandOutputSummary(output, {
    metadata: {
      aliasCount: output.aliases.length,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

export async function runDestinationsResolveCommand(): Promise<void> {
  const context = createCommandRuntimeContext();
  const logger = await createCommandLogger(context);
  const registry = await loadCommandDestinationRegistry(context);
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for destinations resolve", context);
  const api = new DirectNotionClient(token, logger);

  let resolvedCount = 0;
  for (const destination of registry.destinations) {
    const resolved = await api.resolveDestination(destination);
    const resolvedId = resolved.destinationType === "page" ? resolved.pageId : resolved.dataSourceId;
    await registry.saveResolvedId(destination.alias, resolvedId);
    await logger.info("destination_resolved", {
      alias: destination.alias,
      resolvedId,
    });
    resolvedCount += 1;
  }

  recordCommandOutputSummary(
    {
      ok: true,
      recordsUpdated: resolvedCount,
    },
    {
      metadata: {
        aliasCount: registry.destinations.length,
      },
    },
  );
}

function parsePropertyOverrides(values: string[] | undefined): Record<string, unknown> | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const parsed: Record<string, unknown> = {};
  for (const item of values) {
    const [key, ...valueParts] = item.split("=");
    if (!key) {
      continue;
    }
    const rawValue = valueParts.join("=");
    parsed[key] = parseJsonish(rawValue);
  }

  return parsed;
}

function parseJsonish(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
