import { z } from "zod";

export const PublishModeSchema = z.enum([
  "create_new_page",
  "update_existing_page",
  "replace_full_content",
  "targeted_search_replace",
]);

export const DestinationTypeSchema = z.enum(["data_source", "page"]);
export const TemplateModeSchema = z.enum(["none", "default", "specific"]);

export const TitleRuleSchema = z.object({
  source: z.enum(["literal", "filename", "first_heading", "frontmatter", "none"]),
  value: z.string().optional(),
  frontmatterField: z.string().optional(),
  propertyName: z.string().optional(),
  fallback: z.string().optional(),
});

export const LookupRuleSchema = z.object({
  by: z.enum(["page_id", "url", "title", "query"]),
  value: z.string().optional(),
  titleProperty: z.string().optional(),
  queryProperty: z.string().optional(),
});

export const SafeDefaultsSchema = z
  .object({
    allowDeletingContent: z.boolean().default(false),
    templatePollIntervalMs: z.number().int().positive().default(1500),
    templatePollTimeoutMs: z.number().int().positive().default(30000),
  })
  .default({
    allowDeletingContent: false,
    templatePollIntervalMs: 1500,
    templatePollTimeoutMs: 30000,
  });

export const SchemaSnapshotPropertySchema = z.object({
  name: z.string(),
  type: z.string(),
  writable: z.boolean(),
});

export const SchemaSnapshotSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  titlePropertyName: z.string(),
  properties: z.record(z.string(), SchemaSnapshotPropertySchema),
});

export const DestinationSchema = z.object({
  alias: z.string().min(1),
  description: z.string().optional(),
  destinationType: DestinationTypeSchema,
  sourceUrl: z.string().min(1),
  resolvedId: z.string().optional(),
  templateMode: TemplateModeSchema.default("none"),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  titleRule: TitleRuleSchema.default({
    source: "first_heading",
    fallback: "Untitled",
  }),
  fixedProperties: z.record(z.string(), z.unknown()).default({}),
  defaultProperties: z.record(z.string(), z.unknown()).default({}),
  mode: PublishModeSchema,
  lookup: LookupRuleSchema.optional(),
  safeDefaults: SafeDefaultsSchema,
  postTemplatePatchMode: z.enum(["none", "replace_content"]).optional(),
  schemaSnapshot: SchemaSnapshotSchema.optional(),
});

export const DestinationRegistrySchema = z.object({
  version: z.literal(1),
  destinations: z.array(DestinationSchema),
});

export const ContentUpdateSchema = z.object({
  oldStr: z.string().min(1),
  newStr: z.string(),
  replaceAllMatches: z.boolean().default(false),
});

export const PublishRequestSchema = z.object({
  destinationAlias: z.string().min(1),
  inputFile: z.string().min(1),
  dryRun: z.boolean().optional(),
  live: z.boolean().optional(),
  titleOverride: z.string().optional(),
  propertyOverrides: z.record(z.string(), z.unknown()).optional(),
  lookupOverride: LookupRuleSchema.optional(),
  contentUpdates: z.array(ContentUpdateSchema).optional(),
  allowDeletingContent: z.boolean().optional(),
});

export type PublishMode = z.infer<typeof PublishModeSchema>;
export type DestinationType = z.infer<typeof DestinationTypeSchema>;
export type TemplateMode = z.infer<typeof TemplateModeSchema>;
export type TitleRule = z.infer<typeof TitleRuleSchema>;
export type LookupRule = z.infer<typeof LookupRuleSchema>;
export type SafeDefaults = z.infer<typeof SafeDefaultsSchema>;
export type DestinationConfig = z.infer<typeof DestinationSchema>;
export type DestinationRegistryConfig = z.infer<typeof DestinationRegistrySchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export type ContentUpdate = z.infer<typeof ContentUpdateSchema>;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  action: string;
  details?: Record<string, unknown>;
}

export interface ParsedInputFile {
  absolutePath: string;
  rawText: string;
  body: string;
  frontmatter: Record<string, unknown>;
  firstHeading?: string;
  basename: string;
}

export interface ResolvedDestinationBase {
  alias: string;
  sourceUrl: string;
}

export interface ResolvedPageDestination extends ResolvedDestinationBase {
  destinationType: "page";
  pageId: string;
}

export interface ResolvedDataSourceDestination extends ResolvedDestinationBase {
  destinationType: "data_source";
  dataSourceId: string;
}

export type ResolvedDestination = ResolvedPageDestination | ResolvedDataSourceDestination;

export interface TemplateDescriptor {
  id: string;
  name: string;
  isDefault: boolean;
}

export type WritablePropertyType =
  | "title"
  | "rich_text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "people"
  | "relation"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "files";

export interface PropertySchema {
  id?: string;
  name: string;
  type: string;
  writable: boolean;
}

export interface DataSourceSchemaSnapshot {
  id: string;
  title: string;
  titlePropertyName: string;
  properties: Record<string, PropertySchema>;
}

export interface PageSnapshot {
  id: string;
  url: string;
  title?: string;
}

export interface MarkdownReadResult {
  markdown: string;
  raw: Record<string, unknown>;
  truncated: boolean;
  unknownBlockIds: string[];
}

export interface CreatePageInput {
  parent: { page_id?: string; data_source_id?: string };
  properties: Record<string, unknown>;
  markdown?: string;
  template?: { type: "default" } | { type: "template_id"; template_id: string };
}

export interface PageUpdateInput {
  pageId: string;
  properties?: Record<string, unknown>;
}

export interface MarkdownPatchInput {
  pageId: string;
  command: "replace_content" | "update_content";
  newMarkdown?: string;
  contentUpdates?: ContentUpdate[];
  recordClientErrorAsFailure?: boolean;
}

export interface SearchPageOptions {
  dataSourceId?: string;
  titleProperty?: string;
  exactTitle?: string;
  query?: string;
}

export interface NotionApi {
  resolveDestination(destination: DestinationConfig): Promise<ResolvedDestination>;
  retrievePage(pageId: string): Promise<PageSnapshot>;
  retrieveDataSource(dataSourceId: string): Promise<DataSourceSchemaSnapshot>;
  listTemplates(dataSourceId: string): Promise<TemplateDescriptor[]>;
  searchPage(options: SearchPageOptions): Promise<PageSnapshot | null>;
  createPageWithMarkdown(input: CreatePageInput): Promise<PageSnapshot>;
  updatePageProperties(input: PageUpdateInput): Promise<PageSnapshot>;
  readPageMarkdown(pageId: string): Promise<MarkdownReadResult>;
  patchPageMarkdown(input: MarkdownPatchInput): Promise<void>;
}

export interface PublishSummary {
  destinationAlias: string;
  dryRun: boolean;
  mode: PublishMode;
  resolvedDestination: ResolvedDestination;
  pageId?: string;
  pageUrl?: string;
  title?: string;
  propertiesApplied: Record<string, unknown>;
  templateUsed?: string;
  finalMarkdownReadback?: MarkdownReadResult;
  warnings: string[];
}
