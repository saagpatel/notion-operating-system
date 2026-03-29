import { readJsonFile } from "../utils/files.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";
import { AppError } from "../utils/errors.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";

export type LocalPortfolioViewType = "table" | "board" | "gallery";

export interface LocalPortfolioViewSpec {
  name: string;
  viewId?: string;
  type: LocalPortfolioViewType;
  purpose: string;
  configure: string;
}

export interface LocalPortfolioViewPlan {
  version: 1;
  strategy: {
    primary: "notion_mcp";
    fallback: "playwright";
    notes: string[];
  };
  database: {
    name: string;
    databaseUrl: string;
    databaseId: string;
    dataSourceId: string;
  };
  views: LocalPortfolioViewSpec[];
}

export const DEFAULT_LOCAL_PORTFOLIO_VIEWS_PATH = "./config/local-portfolio-views.json";

const STRING_FILTERABLE_TYPES = new Set([
  "rich_text",
  "select",
  "status",
  "title",
  "url",
  "email",
  "phone_number",
]);
const BOOLEAN_FILTERABLE_TYPES = new Set(["checkbox"]);
const GROUPABLE_TYPES = new Set(["select", "status", "multi_select"]);

export async function loadLocalPortfolioViewPlan(
  filePath = DEFAULT_LOCAL_PORTFOLIO_VIEWS_PATH,
): Promise<LocalPortfolioViewPlan> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioViewPlan(raw);
}

export function parseLocalPortfolioViewPlan(raw: unknown): LocalPortfolioViewPlan {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio views config must be an object");
  }

  const plan = raw as Record<string, unknown>;
  const version = plan.version;
  if (version !== 1) {
    throw new AppError(`Unsupported local portfolio views config version "${String(version)}"`);
  }

  const strategy = parseStrategy(plan.strategy);
  const database = parseDatabase(plan.database);
  const views = parseViews(plan.views);

  const uniqueNames = new Set<string>();
  for (const view of views) {
    const key = view.name.trim().toLowerCase();
    if (uniqueNames.has(key)) {
      throw new AppError(`Duplicate local portfolio view name "${view.name}"`);
    }
    uniqueNames.add(key);
  }

  return {
    version: 1,
    strategy,
    database,
    views,
  };
}

export function renderLocalPortfolioViewPlanSummary(plan: LocalPortfolioViewPlan): string {
  const lines = [
    `View sync strategy: ${plan.strategy.primary} primary, ${plan.strategy.fallback} fallback`,
    `Database: ${plan.database.name}`,
    `Database URL: ${plan.database.databaseUrl}`,
    `Data source ID: ${plan.database.dataSourceId}`,
    "",
    "Views:",
  ];

  for (const view of plan.views) {
    lines.push(`- ${view.name} [${view.type}]`);
    if (view.viewId) {
      lines.push(`  View ID: ${view.viewId}`);
    }
    lines.push(`  Purpose: ${view.purpose}`);
    lines.push(`  Configure: ${view.configure}`);
  }

  return lines.join("\n");
}

export interface LocalPortfolioViewValidationResult {
  name: string;
  viewId?: string;
  type: LocalPortfolioViewType;
  referencedProperties: string[];
}

export interface LocalPortfolioViewValidationSummary {
  databaseName: string;
  dataSourceId: string;
  schemaTitle: string;
  validatedViews: LocalPortfolioViewValidationResult[];
}

export function validateLocalPortfolioViewPlanAgainstSchema(
  plan: LocalPortfolioViewPlan,
  schema: DataSourceSchemaSnapshot,
): LocalPortfolioViewValidationSummary {
  if (normalizeNotionId(plan.database.dataSourceId) !== normalizeNotionId(schema.id)) {
    throw new AppError(
      `View plan points at data source "${plan.database.dataSourceId}" but schema came from "${schema.id}"`,
    );
  }

  const validatedViews = plan.views.map((view) => validateViewAgainstSchema(view, schema));
  return {
    databaseName: plan.database.name,
    dataSourceId: plan.database.dataSourceId,
    schemaTitle: schema.title,
    validatedViews,
  };
}

function parseStrategy(raw: unknown): LocalPortfolioViewPlan["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio views config is missing strategy");
  }

  const strategy = raw as Record<string, unknown>;
  if (strategy.primary !== "notion_mcp") {
    throw new AppError('Local portfolio views strategy.primary must be "notion_mcp"');
  }
  if (strategy.fallback !== "playwright") {
    throw new AppError('Local portfolio views strategy.fallback must be "playwright"');
  }
  if (!Array.isArray(strategy.notes) || strategy.notes.some((note) => typeof note !== "string")) {
    throw new AppError("Local portfolio views strategy.notes must be a string array");
  }

  return {
    primary: "notion_mcp",
    fallback: "playwright",
    notes: strategy.notes as string[],
  };
}

function parseDatabase(raw: unknown): LocalPortfolioViewPlan["database"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio views config is missing database");
  }

  const database = raw as Record<string, unknown>;
  const name = requiredString(database.name, "database.name");
  const databaseUrl = requiredString(database.databaseUrl, "database.databaseUrl");
  const databaseId = requiredString(database.databaseId, "database.databaseId");
  const dataSourceId = requiredString(database.dataSourceId, "database.dataSourceId");

  const extractedFromUrl = extractNotionIdFromUrl(databaseUrl);
  if (!extractedFromUrl) {
    throw new AppError(`Could not extract a Notion ID from "${databaseUrl}"`);
  }
  if (normalizeNotionId(databaseId) !== extractedFromUrl) {
    throw new AppError("database.databaseId does not match database.databaseUrl");
  }

  return {
    name,
    databaseUrl,
    databaseId: normalizeNotionId(databaseId),
    dataSourceId: normalizeNotionId(dataSourceId),
  };
}

function parseViews(raw: unknown): LocalPortfolioViewSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("Local portfolio views config must include at least one view");
  }

  return raw.map((item, index) => parseView(item, index));
}

function parseView(raw: unknown, index: number): LocalPortfolioViewSpec {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`View at index ${index} must be an object`);
  }

  const view = raw as Record<string, unknown>;
  const name = requiredString(view.name, `views[${index}].name`);
  const viewId = optionalNotionId(view.viewId, `views[${index}].viewId`);
  const type = requiredString(view.type, `views[${index}].type`);
  const purpose = requiredString(view.purpose, `views[${index}].purpose`);
  const configure = requiredString(view.configure, `views[${index}].configure`);

  if (type !== "table" && type !== "board" && type !== "gallery") {
    throw new AppError(`Unsupported view type "${type}" for "${name}"`);
  }

  return {
    name,
    viewId,
    type,
    purpose,
    configure,
  };
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function optionalNotionId(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string when provided`);
  }

  const extracted = extractNotionIdFromUrl(value.trim());
  if (!extracted) {
    throw new AppError(`${fieldName} must be a valid Notion ID or view:// URL`);
  }

  return extracted;
}

function validateViewAgainstSchema(
  view: LocalPortfolioViewSpec,
  schema: DataSourceSchemaSnapshot,
): LocalPortfolioViewValidationResult {
  const referencedProperties = new Set<string>();
  let sawGroupBy = false;

  for (const statement of splitStatements(view.configure)) {
    if (statement.startsWith("SHOW ")) {
      const properties = extractQuotedValues(statement, "SHOW");
      if (properties.length === 0) {
        throw new AppError(`View "${view.name}" has a SHOW statement with no properties`);
      }
      for (const propertyName of properties) {
        assertPropertyExists(schema, view.name, propertyName);
        referencedProperties.add(propertyName);
      }
      continue;
    }

    if (statement.startsWith("SORT BY ")) {
      const match = statement.match(/^SORT BY "([^"]+)" (ASC|DESC)$/);
      if (!match) {
        throw new AppError(`View "${view.name}" has an unsupported SORT BY statement: ${statement}`);
      }
      const propertyName = getRequiredMatchGroup(match, 1, view.name, statement);
      assertPropertyExists(schema, view.name, propertyName);
      referencedProperties.add(propertyName);
      continue;
    }

    if (statement.startsWith("FILTER ")) {
      const match = statement.match(/^FILTER "([^"]+)" = (true|false|"[^"]+")$/);
      if (!match) {
        throw new AppError(`View "${view.name}" has an unsupported FILTER statement: ${statement}`);
      }

      const propertyName = getRequiredMatchGroup(match, 1, view.name, statement);
      const property = assertPropertyExists(schema, view.name, propertyName);
      referencedProperties.add(propertyName);

      const rawValue = getRequiredMatchGroup(match, 2, view.name, statement);
      if (rawValue === "true" || rawValue === "false") {
        assertPropertyType(view.name, property, BOOLEAN_FILTERABLE_TYPES, "checkbox filter");
      } else {
        assertPropertyType(view.name, property, STRING_FILTERABLE_TYPES, "string filter");
      }
      continue;
    }

    if (statement.startsWith("GROUP BY ")) {
      const match = statement.match(/^GROUP BY "([^"]+)"$/);
      if (!match) {
        throw new AppError(`View "${view.name}" has an unsupported GROUP BY statement: ${statement}`);
      }
      const propertyName = getRequiredMatchGroup(match, 1, view.name, statement);
      const property = assertPropertyExists(schema, view.name, propertyName);
      assertPropertyType(view.name, property, GROUPABLE_TYPES, "grouping");
      referencedProperties.add(propertyName);
      sawGroupBy = true;
      continue;
    }

    throw new AppError(`View "${view.name}" has an unsupported configure statement: ${statement}`);
  }

  if (view.type === "board" && !sawGroupBy) {
    throw new AppError(`Board view "${view.name}" must include a GROUP BY statement`);
  }

  return {
    name: view.name,
    viewId: view.viewId,
    type: view.type,
    referencedProperties: [...referencedProperties],
  };
}

function splitStatements(configure: string): string[] {
  return configure
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function extractQuotedValues(statement: string, commandName: string): string[] {
  if (!statement.startsWith(`${commandName} `)) {
    throw new AppError(`Unsupported ${commandName} statement: ${statement}`);
  }
  return Array.from(statement.matchAll(/"([^"]+)"/g), (match) => match[1]).filter(
    (value): value is string => typeof value === "string",
  );
}

function getRequiredMatchGroup(match: RegExpMatchArray, index: number, viewName: string, statement: string): string {
  const value = match[index];
  if (!value) {
    throw new AppError(`View "${viewName}" has an unsupported configure statement: ${statement}`);
  }
  return value;
}

function assertPropertyExists(
  schema: DataSourceSchemaSnapshot,
  viewName: string,
  propertyName: string,
): PropertySchema {
  const property = schema.properties[propertyName];
  if (!property) {
    throw new AppError(`View "${viewName}" references missing property "${propertyName}"`);
  }
  return property;
}

function assertPropertyType(
  viewName: string,
  property: PropertySchema,
  allowedTypes: Set<string>,
  usage: string,
): void {
  if (!allowedTypes.has(property.type)) {
    throw new AppError(
      `View "${viewName}" uses property "${property.name}" for ${usage}, but its type is "${property.type}"`,
    );
  }
}
