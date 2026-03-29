import { AppError } from "../utils/errors.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_INTELLIGENCE_VIEWS_PATH,
  loadLocalPortfolioIntelligenceViewPlan,
  parseLocalPortfolioIntelligenceViewPlan,
  type LocalPortfolioIntelligenceViewCollection,
  type LocalPortfolioIntelligenceViewPlan,
  type LocalPortfolioIntelligenceViewSpec,
} from "./local-portfolio-intelligence.js";

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

export {
  DEFAULT_LOCAL_PORTFOLIO_INTELLIGENCE_VIEWS_PATH,
  loadLocalPortfolioIntelligenceViewPlan,
  parseLocalPortfolioIntelligenceViewPlan,
};

export interface LocalPortfolioIntelligenceViewValidationResult {
  collection: string;
  name: string;
  viewId?: string;
  type: LocalPortfolioIntelligenceViewSpec["type"];
  referencedProperties: string[];
}

export interface LocalPortfolioIntelligenceViewValidationSummary {
  validatedViews: LocalPortfolioIntelligenceViewValidationResult[];
}

export function validateLocalPortfolioIntelligenceViewPlanAgainstSchemas(
  plan: LocalPortfolioIntelligenceViewPlan,
  schemas: Record<LocalPortfolioIntelligenceViewCollection["key"], DataSourceSchemaSnapshot>,
): LocalPortfolioIntelligenceViewValidationSummary {
  const validatedViews: LocalPortfolioIntelligenceViewValidationResult[] = [];

  for (const collection of plan.collections) {
    const schema = schemas[collection.key];
    if (!schema) {
      throw new AppError(`Missing schema for intelligence view collection "${collection.key}"`);
    }
    if (schema.id !== collection.database.dataSourceId) {
      throw new AppError(
        `Intelligence view collection "${collection.key}" points at "${collection.database.dataSourceId}" but schema came from "${schema.id}"`,
      );
    }

    for (const view of collection.views) {
      validatedViews.push({
        collection: collection.key,
        ...validateViewAgainstSchema(view, schema),
      });
    }
  }

  return { validatedViews };
}

function validateViewAgainstSchema(
  view: LocalPortfolioIntelligenceViewSpec,
  schema: DataSourceSchemaSnapshot,
): Omit<LocalPortfolioIntelligenceViewValidationResult, "collection"> {
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
