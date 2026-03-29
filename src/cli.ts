import "dotenv/config";

import path from "node:path";

import { DestinationRegistry } from "./config/destination-registry.js";
import { RunLogger } from "./logging/run-logger.js";
import { DirectNotionClient } from "./notion/direct-notion-client.js";
import { Publisher } from "./publishing/publisher.js";
import { PublishRequestSchema } from "./types.js";
import { readJsonFile } from "./utils/files.js";
import { AppError, toErrorMessage } from "./utils/errors.js";

async function main(): Promise<void> {
  const logger = new RunLogger(process.env.NOTION_LOG_DIR ?? "./logs");
  await logger.init();

  try {
    const command = process.argv[2];
    if (!command) {
      throw new AppError("Expected a command: publish or destinations");
    }

    const registry = await DestinationRegistry.load(process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json");

    if (command === "publish") {
      await runPublish(registry, logger);
      return;
    }

    if (command === "destinations") {
      await runDestinations(registry, logger);
      return;
    }

    throw new AppError(`Unknown command "${command}"`);
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

async function runPublish(registry: DestinationRegistry, logger: RunLogger): Promise<void> {
  const args = parseFlags(process.argv.slice(3));
  const requestFile = getStringFlag(args, "request");
  const request = requestFile
    ? registry.parseRequestFile(await readJsonFile<unknown>(path.resolve(requestFile)))
    : PublishRequestSchema.parse({
        destinationAlias: getStringFlag(args, "destination"),
        inputFile: getStringFlag(args, "file"),
        dryRun: getBooleanFlag(args, "live") ? false : getBooleanFlag(args, "dryRun") ?? true,
        live: getBooleanFlag(args, "live"),
        titleOverride: getStringFlag(args, "title"),
        propertyOverrides: parsePropertyOverrides(args.property),
      });

  const destination = registry.getDestination(request.destinationAlias);
  const notionToken = process.env.NOTION_TOKEN?.trim();
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

  console.log(JSON.stringify(summary, null, 2));
}

async function runDestinations(registry: DestinationRegistry, logger: RunLogger): Promise<void> {
  const subcommand = process.argv[3];
  if (!subcommand) {
    throw new AppError(`Expected a destinations subcommand: check or resolve`);
  }

  if (subcommand === "check") {
    console.log(
      JSON.stringify(
        {
          version: 1,
          aliases: registry.destinations.map((destination) => destination.alias),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (subcommand === "resolve") {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for destinations resolve");
    }

    const api = new DirectNotionClient(token, logger);
    for (const destination of registry.destinations) {
      const resolved = await api.resolveDestination(destination);
      const resolvedId = resolved.destinationType === "page" ? resolved.pageId : resolved.dataSourceId;
      await registry.saveResolvedId(destination.alias, resolvedId);
      await logger.info("destination_resolved", {
        alias: destination.alias,
        resolvedId,
      });
    }
    return;
  }

  throw new AppError(`Unknown destinations subcommand "${subcommand}"`);
}

function parseFlags(argv: string[]): Record<string, string | boolean | string[] | undefined> {
  const flags: Record<string, string | boolean | string[] | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }
    if (!current.startsWith("--")) {
      continue;
    }

    const key = toCamelCase(current.slice(2));
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    if (key === "property") {
      const existing = Array.isArray(flags[key]) ? flags[key] : [];
      flags[key] = [...existing, next];
    } else {
      flags[key] = next;
    }

    index += 1;
  }

  return flags;
}

function parsePropertyOverrides(values: string | boolean | string[] | undefined): Record<string, unknown> | undefined {
  if (!values) {
    return undefined;
  }

  const items = Array.isArray(values) ? values : [values];
  const parsed: Record<string, unknown> = {};

  for (const item of items) {
    if (typeof item !== "string") {
      continue;
    }
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

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function getStringFlag(
  flags: Record<string, string | boolean | string[] | undefined>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function getBooleanFlag(
  flags: Record<string, string | boolean | string[] | undefined>,
  key: string,
): boolean | undefined {
  const value = flags[key];
  return typeof value === "boolean" ? value : undefined;
}

void main();
