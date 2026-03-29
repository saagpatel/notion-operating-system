import type {
  DataSourceSchemaSnapshot,
  DestinationConfig,
  PageSnapshot,
  ParsedInputFile,
} from "../types.js";
import { AppError } from "../utils/errors.js";
import { resolveTitle } from "../utils/markdown.js";

export interface BuiltPropertiesResult {
  title?: string;
  properties: Record<string, unknown>;
}

export function buildPageDestinationProperties(
  destination: DestinationConfig,
  parsed: ParsedInputFile,
  titleOverride?: string,
): BuiltPropertiesResult {
  const title = resolveTitle(parsed, destination.titleRule, titleOverride);
  if (!title) {
    throw new AppError(`Destination "${destination.alias}" requires a page title`);
  }

  return {
    title,
    properties: {
      title: toTitleProperty(title),
    },
  };
}

export const buildPageParentProperties = buildPageDestinationProperties;

export function buildDataSourceProperties({
  destination,
  schema,
  parsed,
  titleOverride,
  propertyOverrides,
}: {
  destination: DestinationConfig;
  schema: DataSourceSchemaSnapshot;
  parsed: ParsedInputFile;
  titleOverride?: string;
  propertyOverrides?: Record<string, unknown>;
}): BuiltPropertiesResult {
  const title = resolveTitle(parsed, destination.titleRule, titleOverride);
  const merged = {
    ...destination.defaultProperties,
    ...(propertyOverrides ?? {}),
    ...destination.fixedProperties,
  };

  const properties: Record<string, unknown> = {};
  for (const [name, rawValue] of Object.entries(merged)) {
    const propertySchema = schema.properties[name];
    if (!propertySchema) {
      throw new AppError(`Property "${name}" does not exist in data source "${schema.title}"`);
    }
    if (!propertySchema.writable) {
      throw new AppError(`Property "${name}" is not writable in data source "${schema.title}"`);
    }

    properties[name] = convertPropertyValue(propertySchema.type, rawValue);
  }

  if (title) {
    properties[schema.titlePropertyName] = toTitleProperty(title);
  }

  return {
    title,
    properties,
  };
}

export function resolveLookupTitle(destination: DestinationConfig, title?: string): string | undefined {
  if (destination.lookup?.by === "title" && destination.lookup.value) {
    return destination.lookup.value;
  }

  return title;
}

function toTitleProperty(value: string): { title: Array<{ type: "text"; text: { content: string } }> } {
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

function toRichTextProperty(value: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return {
    rich_text: [
      {
        type: "text",
        text: {
          content: value,
        },
      },
    ],
  };
}

function convertPropertyValue(type: string, rawValue: unknown): unknown {
  switch (type) {
    case "title":
      if (typeof rawValue !== "string") {
        throw new AppError("Title properties must be strings");
      }
      return toTitleProperty(rawValue);
    case "rich_text":
      if (typeof rawValue !== "string") {
        throw new AppError("Rich text properties must be strings");
      }
      return toRichTextProperty(rawValue);
    case "number":
      if (typeof rawValue !== "number") {
        throw new AppError("Number properties must be numbers");
      }
      return { number: rawValue };
    case "checkbox":
      if (typeof rawValue !== "boolean") {
        throw new AppError("Checkbox properties must be booleans");
      }
      return { checkbox: rawValue };
    case "select":
      if (typeof rawValue !== "string") {
        throw new AppError("Select properties must be strings");
      }
      return { select: { name: rawValue } };
    case "status":
      if (typeof rawValue !== "string") {
        throw new AppError("Status properties must be strings");
      }
      return { status: { name: rawValue } };
    case "multi_select":
      if (!Array.isArray(rawValue) || rawValue.some((value) => typeof value !== "string")) {
        throw new AppError("Multi-select properties must be string arrays");
      }
      return { multi_select: rawValue.map((value) => ({ name: value })) };
    case "date":
      if (typeof rawValue === "string") {
        return { date: { start: rawValue } };
      }
      if (
        typeof rawValue === "object" &&
        rawValue !== null &&
        typeof (rawValue as { start?: unknown }).start === "string"
      ) {
        const date = rawValue as { start: string; end?: string; time_zone?: string };
        return { date };
      }
      throw new AppError("Date properties must be ISO strings or objects with start");
    case "people":
      if (!Array.isArray(rawValue) || rawValue.some((value) => typeof value !== "string")) {
        throw new AppError("People properties must be arrays of Notion user IDs");
      }
      return { people: rawValue.map((id) => ({ id })) };
    case "relation":
      if (!Array.isArray(rawValue) || rawValue.some((value) => typeof value !== "string")) {
        throw new AppError("Relation properties must be arrays of page IDs");
      }
      return { relation: rawValue.map((id) => ({ id })) };
    case "url":
      if (typeof rawValue !== "string") {
        throw new AppError("URL properties must be strings");
      }
      return { url: rawValue };
    case "email":
      if (typeof rawValue !== "string") {
        throw new AppError("Email properties must be strings");
      }
      return { email: rawValue };
    case "phone_number":
      if (typeof rawValue !== "string") {
        throw new AppError("Phone number properties must be strings");
      }
      return { phone_number: rawValue };
    case "files":
      if (!Array.isArray(rawValue)) {
        throw new AppError("Files properties must be arrays");
      }
      return {
        files: rawValue.map((file) => {
          if (
            typeof file !== "object" ||
            file === null ||
            typeof (file as { name?: unknown }).name !== "string" ||
            typeof (file as { url?: unknown }).url !== "string"
          ) {
            throw new AppError("Files properties must be arrays of { name, url }");
          }

          const typedFile = file as { name: string; url: string };
          return {
            name: typedFile.name,
            type: "external",
            external: {
              url: typedFile.url,
            },
          };
        }),
      };
    default:
      throw new AppError(`Property type "${type}" is not supported by this publisher yet`);
  }
}
