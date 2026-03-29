import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { Client } from "@notionhq/client";
import ExcelJS from "exceljs";

import { DirectNotionClient } from "../notion/direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";

const PROJECTS_ROOT = "/Users/d/Projects";
const WORKBOOK_PATH = path.join(PROJECTS_ROOT, "PORTFOLIO-AUDIT-REPORT.xlsx");
const DEFAULT_DATABASE_TITLE = "Local Portfolio Projects";

const ROOT_GROUPS = new Set([
  "ITPRJsViaClaude",
  "Fun:GamePrjs",
  "FunGamePrjs",
  "MoneyPRJsViaGPT",
  "VanityPRJs",
  "Misc:NoGoPRJs",
  "claude-code",
]);

const EXCLUDED_ROOT_NAMES = new Set([
  ".claude",
  ".codex-maintenance",
  ".cowork",
  ".git",
  "GrokPRJs",
]);

const PATH_NAME_OVERRIDES = new Map<string, string>([
  ["claude-code/production/rag-knowledge-base", "RAG Knowledge Base"],
  ["FunGamePrjs/OrbitForge", "OrbitForge (staging)"],
]);

const CANONICAL_COLUMN_NAMES = [
  "Project Name",
  "Status",
  "Pipeline Stage",
  "Category",
  "Verdict",
  "Score",
  "Max Score",
  "Scoring Framework",
  "Stack",
  "Est. Effort",
  "Merged Into",
  "Notes",
  "Batch",
  "Key Integrations",
  "Date Scored",
  "Date Updated",
] as const;

type CanonicalColumnName = (typeof CANONICAL_COLUMN_NAMES)[number];

interface CanonicalWorkbookRow extends Record<CanonicalColumnName, string> {}

interface InventoryProject {
  projectName: string;
  relativePath: string;
  sourceGroup: string;
}

interface ProjectImportRow {
  projectName: string;
  status: string;
  pipelineStage: string;
  category: string;
  verdict: string;
  stack: string;
  mergedInto: string;
  notes: string;
  keyIntegrations: string;
  dateUpdated: string;
  sourceGroup: string;
  localPath: string;
  summary: string;
  completion: string;
  readiness: string;
  registryStatus: string;
  primaryTool: string;
  contextQuality: string;
  auditNotes: string;
  integrationTags: string[];
  needsReview: boolean;
}

interface CreatedDatabaseSummary {
  databaseId: string;
  dataSourceId: string;
  databaseUrl: string;
  rowCount: number;
  samplePageUrl?: string;
  sampleMarkdownPreview?: string;
}

interface DatabaseTarget {
  databaseId: string;
  dataSourceId: string;
  databaseUrl: string;
}

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required");
  }

  const flags = parseFlags(process.argv.slice(2));
  const parent = flags.parent;
  if (!parent) {
    throw new AppError("Expected --parent with a Notion page URL or page ID");
  }

  const parentPageId = normalizeNotionId(extractNotionIdFromUrl(parent) ?? parent);
  const databaseTitle = flags.title ?? DEFAULT_DATABASE_TITLE;

  const [inventory, workbookRows] = await Promise.all([discoverProjects(), loadWorkbookRows()]);
  const importRows = buildImportRows(workbookRows, inventory);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const markdownApi = new DirectNotionClient(token);

  await assertParentPageAccessible(sdk, parentPageId);
  const created = await getOrCreateDatabase(sdk, parentPageId, databaseTitle);
  await ensureDataSourceSchema(sdk, created.dataSourceId, importRows);
  const samplePage = flags.updateExisting
    ? await syncExistingDatabase(sdk, markdownApi, created.dataSourceId, importRows)
    : await populateIntoEmptyDatabase(sdk, markdownApi, created.dataSourceId, importRows);
  const verification = await verifyImport(sdk, markdownApi, created.dataSourceId, samplePage?.id);

  const summary: CreatedDatabaseSummary = {
    databaseId: created.databaseId,
    dataSourceId: created.dataSourceId,
    databaseUrl: created.databaseUrl,
    rowCount: verification.rowCount,
    samplePageUrl: samplePage?.url,
    sampleMarkdownPreview: verification.sampleMarkdownPreview,
  };

  console.log(JSON.stringify(summary, null, 2));
}

function parseFlags(argv: string[]): { parent?: string; title?: string; updateExisting?: boolean } {
  const result: { parent?: string; title?: string; updateExisting?: boolean } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith("--")) {
      continue;
    }

    if (current === "--update-existing") {
      result.updateExisting = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      continue;
    }

    if (current === "--parent") {
      result.parent = next;
    }

    if (current === "--title") {
      result.title = next;
    }

    index += 1;
  }

  return result;
}

async function discoverProjects(): Promise<InventoryProject[]> {
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const projects: InventoryProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith(".") || EXCLUDED_ROOT_NAMES.has(entry.name) || ROOT_GROUPS.has(entry.name)) {
      continue;
    }

    projects.push({
      projectName: PATH_NAME_OVERRIDES.get(entry.name) ?? entry.name.trim(),
      relativePath: entry.name,
      sourceGroup: "Standalone Projects",
    });
  }

  const groupedDirectories = [
    "ITPRJsViaClaude",
    "Fun:GamePrjs",
    "FunGamePrjs",
    "MoneyPRJsViaGPT",
    "VanityPRJs",
    "Misc:NoGoPRJs",
  ] as const;

  for (const groupName of groupedDirectories) {
    const groupPath = path.join(PROJECTS_ROOT, groupName);
    const groupEntries = await fs.readdir(groupPath, { withFileTypes: true });
    for (const entry of groupEntries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const relativePath = path.posix.join(groupName, entry.name);
      projects.push({
        projectName: PATH_NAME_OVERRIDES.get(relativePath) ?? entry.name.trim(),
        relativePath,
        sourceGroup: groupName === "FunGamePrjs" ? "FunGamePrjs - Build-Ready Staging" : groupName,
      });
    }
  }

  const ragKbPath = path.posix.join("claude-code", "production", "rag-knowledge-base");
  try {
    const stats = await fs.stat(path.join(PROJECTS_ROOT, ragKbPath));
    if (stats.isDirectory()) {
      projects.push({
        projectName: PATH_NAME_OVERRIDES.get(ragKbPath) ?? "RAG Knowledge Base",
        relativePath: ragKbPath,
        sourceGroup: "Production / Foundation",
      });
    }
  } catch {
    // Ignore when the optional nested project is missing.
  }

  return projects;
}

async function loadWorkbookRows(): Promise<CanonicalWorkbookRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);

  const worksheet = workbook.getWorksheet("Projects");
  if (!worksheet) {
    throw new AppError(`Could not find "Projects" sheet in ${WORKBOOK_PATH}`);
  }

  const rawHeaderValues = worksheet.getRow(1).values as ExcelJS.CellValue[];
  const headerValues: ExcelJS.CellValue[] = rawHeaderValues.slice(1);
  const headerRow = headerValues.map((value: ExcelJS.CellValue) => String(value ?? ""));
  const headerIndexes = new Map<string, number>();
  headerRow.forEach((value: string, index: number) => {
    headerIndexes.set(value, index + 1);
  });

  const missingHeaders = CANONICAL_COLUMN_NAMES.filter((columnName) => !headerIndexes.has(columnName));
  if (missingHeaders.length > 0) {
    throw new AppError(`Workbook is missing expected columns: ${missingHeaders.join(", ")}`);
  }

  const rows: CanonicalWorkbookRow[] = [];
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const projectName = String(row.getCell(headerIndexes.get("Project Name") ?? 1).value ?? "").trim();
    if (!projectName) {
      continue;
    }

    const record = Object.fromEntries(
      CANONICAL_COLUMN_NAMES.map((columnName) => [
        columnName,
        String(row.getCell(headerIndexes.get(columnName) ?? 1).value ?? "").trim(),
      ]),
    ) as CanonicalWorkbookRow;

    rows.push(record);
  }

  return rows;
}

function buildImportRows(workbookRows: CanonicalWorkbookRow[], inventory: InventoryProject[]): ProjectImportRow[] {
  const inventoryByProjectName = new Map(inventory.map((project) => [project.projectName, project] as const));

  return workbookRows.map((row) => {
    const sourceProject = inventoryByProjectName.get(row["Project Name"]);
    const parsedNotes = parseNotes(row.Notes);
    const integrationTags = deriveIntegrationTags(row["Key Integrations"], row.Stack, parsedNotes.summary);
    const auditNotes = parsedNotes.auditNotes || deriveFallbackAuditNote(row);

    return {
      projectName: row["Project Name"],
      status: row.Status,
      pipelineStage: row["Pipeline Stage"],
      category: row.Category,
      verdict: row.Verdict,
      stack: row.Stack,
      mergedInto: row["Merged Into"],
      notes: row.Notes,
      keyIntegrations: row["Key Integrations"],
      dateUpdated: row["Date Updated"],
      sourceGroup: sourceProject?.sourceGroup ?? "Unmapped",
      localPath: sourceProject?.relativePath ?? "",
      summary: parsedNotes.summary,
      completion: parsedNotes.completion,
      readiness: parsedNotes.readiness,
      registryStatus: parsedNotes.registryStatus,
      primaryTool: parsedNotes.primaryTool,
      contextQuality: parsedNotes.contextQuality,
      auditNotes,
      integrationTags,
      needsReview: auditNotes.length > 0,
    };
  });
}

function parseNotes(notes: string): {
  summary: string;
  completion: string;
  readiness: string;
  registryStatus: string;
  primaryTool: string;
  contextQuality: string;
  auditNotes: string;
} {
  const markers = [notes.indexOf(" Legacy completion:"), notes.indexOf(" Registry:")].filter((value) => value >= 0);
  const firstMarkerIndex = markers.length > 0 ? Math.min(...markers) : -1;
  const summary = (firstMarkerIndex >= 0 ? notes.slice(0, firstMarkerIndex) : notes).trim().replace(/\s+\.$/, ".");

  const completionMatch = notes.match(/Legacy completion:\s*(.*?)(?=\.\s+Legacy readiness:|\.\s+Registry:|$)/);
  const readinessMatch = notes.match(/Legacy readiness:\s*(.*?)(?=\.\s+Registry:|$)/);
  const registryMatch = notes.match(/Registry:\s*registry\s+([^,]+),\s*tool\s+([^,]+),\s*context\s+([^\.]+)\.?/i);

  let remaining = firstMarkerIndex >= 0 ? notes.slice(firstMarkerIndex).trim() : "";
  remaining = remaining.replace(/Legacy completion:\s*.*?(?=\.\s+Legacy readiness:|\.\s+Registry:|$)/, "");
  remaining = remaining.replace(/Legacy readiness:\s*.*?(?=\.\s+Registry:|$)/, "");
  remaining = remaining.replace(/Registry:\s*registry\s+[^,]+,\s*tool\s+[^,]+,\s*context\s+[^\.]+\.?/i, "");
  remaining = remaining.replace(/^\.+|\.+$/g, "").replace(/\s+/g, " ").trim();
  if (/^[^A-Za-z0-9]+$/.test(remaining)) {
    remaining = "";
  }

  return {
    summary,
    completion: (completionMatch?.[1] ?? "").trim(),
    readiness: (readinessMatch?.[1] ?? "").trim(),
    registryStatus: normalizeRegistryValue(registryMatch?.[1] ?? ""),
    primaryTool: normalizeRegistryValue(registryMatch?.[2] ?? ""),
    contextQuality: normalizeRegistryValue(registryMatch?.[3] ?? ""),
    auditNotes: remaining,
  };
}

function normalizeRegistryValue(value: string): string {
  return value.trim().replace(/\.$/, "");
}

function deriveFallbackAuditNote(row: CanonicalWorkbookRow): string {
  if (row.Status === "Merged" && !row["Merged Into"]) {
    return "Merged status needs a confirmed target project.";
  }

  return "";
}

function deriveIntegrationTags(keyIntegrations: string, stack: string, summary: string): string[] {
  const haystack = `${keyIntegrations} ${stack} ${summary}`.toLowerCase();
  const tags = new Set<string>();

  const keywords: Array<[string, RegExp]> = [
    ["Slack", /\bslack\b/],
    ["Claude API", /\bclaude api\b|\banthropic\b/],
    ["GitHub", /\bgithub\b/],
    ["Jira", /\bjira\b/],
    ["Google Workspace", /\bgoogle workspace\b|\bgoogle calendar\b|\bgoogle tasks\b|\bgoogle sheets\b/],
    ["Stripe", /\bstripe\b/],
    ["Supabase", /\bsupabase\b/],
    ["Ollama", /\bollama\b|\bllama\.cpp\b|\blm studio\b/],
    ["Vercel", /\bvercel\b/],
    ["FFmpeg", /\bffmpeg\b/],
    ["PostgreSQL", /\bpostgres\b|\bpostgresql\b|\bpgvector\b/],
    ["SQLite", /\bsqlite\b|\bfts5\b|\bsqlcipher\b/],
    ["Qdrant", /\bqdrant\b/],
    ["OCR", /\bocr\b|\bvision\b|\btesseract\b/],
    ["YouTube", /\byoutube\b/],
  ];

  for (const [label, pattern] of keywords) {
    if (pattern.test(haystack)) {
      tags.add(label);
    }
  }

  return [...tags];
}

async function assertParentPageAccessible(sdk: Client, parentPageId: string): Promise<void> {
  await sdk.pages.retrieve({ page_id: parentPageId });
}

async function getOrCreateDatabase(
  sdk: Client,
  parentPageId: string,
  databaseTitle: string,
): Promise<DatabaseTarget> {
  const response = await sdk.blocks.children.list({
    block_id: parentPageId,
    page_size: 100,
  });

  const duplicate = response.results.find((result) => {
    const block = result as { type?: string; child_database?: { title?: string } };
    return block.type === "child_database" && block.child_database?.title?.trim() === databaseTitle;
  });

  if (duplicate) {
    const existing = (await sdk.request({
      path: `databases/${duplicate.id}`,
      method: "get",
    })) as { id: string; url: string; data_sources?: Array<{ id: string }> };

    const existingDataSourceId = existing.data_sources?.[0]?.id;
    if (!existingDataSourceId) {
      throw new AppError(`Existing child database "${databaseTitle}" did not expose a data source ID`);
    }

    return {
      databaseId: normalizeNotionId(existing.id),
      dataSourceId: normalizeNotionId(existingDataSourceId),
      databaseUrl: existing.url,
    };
  }

  const created = (await sdk.request({
    path: "databases",
    method: "post",
    body: {
      parent: {
        type: "page_id",
        page_id: parentPageId,
      },
      title: [
        {
          type: "text",
          text: {
            content: databaseTitle,
          },
        },
      ],
    },
  })) as { id: string; url: string; data_sources?: Array<{ id: string }> };

  const dataSourceId = created.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new AppError("Created database did not return a data source ID");
  }

  return {
    databaseId: normalizeNotionId(created.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    databaseUrl: created.url,
  };
}

async function ensureDataSourceSchema(
  sdk: Client,
  dataSourceId: string,
  rows: ProjectImportRow[],
): Promise<void> {
  await sdk.request({
    path: `data_sources/${dataSourceId}`,
    method: "patch",
    body: {
      properties: buildDataSourceProperties(rows),
    },
  });
}

async function assertDataSourceEmpty(sdk: Client, dataSourceId: string): Promise<void> {
  const response = (await sdk.request({
    path: `data_sources/${dataSourceId}/query`,
    method: "post",
    body: {
      page_size: 1,
    },
  })) as { results?: Array<unknown> };

  if ((response.results?.length ?? 0) > 0) {
    throw new AppError("Target data source already contains rows; refusing to duplicate-import into it");
  }
}

function buildDataSourceProperties(rows: ProjectImportRow[]): Record<string, unknown> {
  return {
    Status: {
      select: {
        options: buildSelectOptions(rows.map((row) => row.status), {
          Planned: "purple",
          "Handoff Ready": "orange",
          "In Progress": "green",
          Shipped: "default",
          Abandoned: "red",
          Merged: "brown",
        }),
      },
    },
    "Pipeline Stage": {
      select: {
        options: buildSelectOptions(rows.map((row) => row.pipelineStage), {
          "Implementation Plan": "purple",
          "Handoff Docs Generated": "orange",
          "Building in Claude Code": "green",
          "Post-Build Review Done": "default",
        }),
      },
    },
    Category: {
      select: {
        options: buildSelectOptions(rows.map((row) => row.category), {
          "IT Tool": "blue",
          "Desktop App": "purple",
          "Commercial SaaS": "green",
          "Creative Tool": "pink",
          "Reasoning Tool": "gray",
          "Dev Tool": "default",
          Monetization: "brown",
        }),
      },
    },
    Verdict: {
      select: {
        options: buildSelectOptions(rows.map((row) => row.verdict), {
          "Strong Candidate": "green",
          "Worth Building": "blue",
          "Low Priority": "default",
          Skip: "red",
          "Merged Into Other": "brown",
        }),
      },
    },
    Summary: { rich_text: {} },
    Completion: { rich_text: {} },
    Readiness: { rich_text: {} },
    Stack: { rich_text: {} },
    "Source Group": {
      select: {
        options: buildSelectOptions(rows.map((row) => row.sourceGroup), {
          "Standalone Projects": "default",
          ITPRJsViaClaude: "blue",
          "Fun:GamePrjs": "pink",
          "FunGamePrjs - Build-Ready Staging": "orange",
          MoneyPRJsViaGPT: "purple",
          VanityPRJs: "gray",
          "Misc:NoGoPRJs": "red",
          "Production / Foundation": "green",
        }),
      },
    },
    "Local Path": { rich_text: {} },
    "Registry Status": {
      select: {
        options: buildSelectOptions(rows.map((row) => row.registryStatus), {
          active: "green",
          recent: "blue",
          parked: "gray",
          archived: "brown",
          unknown: "default",
        }),
      },
    },
    "Primary Tool": {
      select: {
        options: buildSelectOptions(rows.map((row) => row.primaryTool), {
          codex: "blue",
          "claude-code": "purple",
          gpt: "orange",
          grok: "red",
          unknown: "default",
        }),
      },
    },
    "Context Quality": {
      select: {
        options: buildSelectOptions(rows.map((row) => row.contextQuality), {
          full: "green",
          standard: "blue",
          boilerplate: "gray",
          none: "red",
          unknown: "default",
        }),
      },
    },
    "Merged Into": { rich_text: {} },
    "Key Integrations": { rich_text: {} },
    "Integration Tags": {
      multi_select: {
        options: buildMultiSelectOptions(rows.flatMap((row) => row.integrationTags), {
          Slack: "orange",
          "Claude API": "purple",
          GitHub: "default",
          Jira: "blue",
          "Google Workspace": "green",
          Stripe: "yellow",
          Supabase: "gray",
          Ollama: "pink",
          Vercel: "brown",
          FFmpeg: "red",
          PostgreSQL: "blue",
          SQLite: "gray",
          Qdrant: "purple",
          OCR: "orange",
          YouTube: "red",
        }),
      },
    },
    "Audit Notes": { rich_text: {} },
    "Date Updated": { date: {} },
    "Needs Review": { checkbox: {} },
  };
}

function buildSelectOptions(values: string[], colorOverrides: Record<string, string>): Array<{ name: string; color: string }> {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      name: value,
      color: colorOverrides[value] ?? "default",
    }));
}

function buildMultiSelectOptions(
  values: string[],
  colorOverrides: Record<string, string>,
): Array<{ name: string; color: string }> {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      name: value,
      color: colorOverrides[value] ?? "default",
    }));
}

async function populateIntoEmptyDatabase(
  sdk: Client,
  markdownApi: DirectNotionClient,
  dataSourceId: string,
  rows: ProjectImportRow[],
): Promise<{ id: string; url: string } | undefined> {
  await assertDataSourceEmpty(sdk, dataSourceId);
  return populateRows(markdownApi, dataSourceId, rows);
}

async function syncExistingDatabase(
  sdk: Client,
  markdownApi: DirectNotionClient,
  dataSourceId: string,
  rows: ProjectImportRow[],
): Promise<{ id: string; url: string } | undefined> {
  const existingPages = await listExistingPages(sdk, dataSourceId);
  let samplePage: { id: string; url: string } | undefined;

  for (const [index, row] of rows.entries()) {
    const existing = existingPages.get(row.projectName);
    if (existing) {
      await markdownApi.updatePageProperties({
        pageId: existing.id,
        properties: buildPageProperties(row, { clearEmpty: true }),
      });
      await markdownApi.patchPageMarkdown({
        pageId: existing.id,
        command: "replace_content",
        newMarkdown: buildProjectMarkdown(row),
      });
      if (!samplePage) {
        samplePage = existing;
      }
    } else {
      const created = await markdownApi.createPageWithMarkdown({
        parent: {
          data_source_id: dataSourceId,
        },
        properties: buildPageProperties(row),
        markdown: buildProjectMarkdown(row),
      });
      if (!samplePage) {
        samplePage = created;
      }
    }

    if ((index + 1) % 10 === 0 || index === rows.length - 1) {
      console.log(`Synced ${index + 1}/${rows.length} project rows...`);
    }
  }

  return samplePage;
}

async function listExistingPages(sdk: Client, dataSourceId: string): Promise<Map<string, { id: string; url: string }>> {
  const response = (await sdk.request({
    path: `data_sources/${dataSourceId}/query`,
    method: "post",
    body: {
      page_size: 100,
    },
  })) as {
    results?: Array<{
      id: string;
      url: string;
      properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
    }>;
  };

  const mapped = new Map<string, { id: string; url: string }>();
  for (const result of response.results ?? []) {
    const title = (result.properties?.Name?.title ?? [])
      .map((entry) => entry.plain_text ?? "")
      .join("")
      .trim();
    if (title) {
      mapped.set(title, {
        id: normalizeNotionId(result.id),
        url: result.url,
      });
    }
  }

  return mapped;
}

async function populateRows(
  markdownApi: DirectNotionClient,
  dataSourceId: string,
  rows: ProjectImportRow[],
): Promise<{ id: string; url: string } | undefined> {
  let samplePage: { id: string; url: string } | undefined;

  for (const [index, row] of rows.entries()) {
    const created = await markdownApi.createPageWithMarkdown({
      parent: {
        data_source_id: dataSourceId,
      },
      properties: buildPageProperties(row),
      markdown: buildProjectMarkdown(row),
    });

    if (!samplePage) {
      samplePage = created;
    }

    if ((index + 1) % 10 === 0 || index === rows.length - 1) {
      console.log(`Imported ${index + 1}/${rows.length} project rows...`);
    }
  }

  return samplePage;
}

function buildPageProperties(
  row: ProjectImportRow,
  options: { clearEmpty?: boolean } = {},
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    Name: {
      title: toRichText(row.projectName),
    },
    Status: row.status ? { select: { name: row.status } } : undefined,
    "Pipeline Stage": row.pipelineStage ? { select: { name: row.pipelineStage } } : undefined,
    Category: row.category ? { select: { name: row.category } } : undefined,
    Verdict: row.verdict ? { select: { name: row.verdict } } : undefined,
    Summary: row.summary ? { rich_text: toRichText(row.summary) } : undefined,
    Completion: row.completion ? { rich_text: toRichText(row.completion) } : undefined,
    Readiness: row.readiness ? { rich_text: toRichText(row.readiness) } : undefined,
    Stack: row.stack ? { rich_text: toRichText(row.stack) } : undefined,
    "Source Group": row.sourceGroup ? { select: { name: row.sourceGroup } } : undefined,
    "Local Path": row.localPath ? { rich_text: toRichText(row.localPath) } : undefined,
    "Registry Status": row.registryStatus ? { select: { name: row.registryStatus } } : undefined,
    "Primary Tool": row.primaryTool ? { select: { name: row.primaryTool } } : undefined,
    "Context Quality": row.contextQuality ? { select: { name: row.contextQuality } } : undefined,
    "Merged Into": row.mergedInto
      ? { rich_text: toRichText(row.mergedInto) }
      : options.clearEmpty
        ? { rich_text: [] }
        : undefined,
    "Key Integrations": row.keyIntegrations
      ? { rich_text: toRichText(row.keyIntegrations) }
      : options.clearEmpty
        ? { rich_text: [] }
        : undefined,
    "Integration Tags": row.integrationTags.length > 0
      ? { multi_select: row.integrationTags.map((name) => ({ name })) }
      : options.clearEmpty
        ? { multi_select: [] }
        : undefined,
    "Audit Notes": row.auditNotes
      ? { rich_text: toRichText(row.auditNotes) }
      : options.clearEmpty
        ? { rich_text: [] }
        : undefined,
    "Date Updated": row.dateUpdated ? { date: { start: row.dateUpdated } } : undefined,
    "Needs Review": { checkbox: row.needsReview },
  };

  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  const chunks = chunkText(value, 1900);
  return chunks.map((content) => ({
    type: "text",
    text: {
      content,
    },
  }));
}

function chunkText(value: string, maxLength: number): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(" ", maxLength);
    if (splitIndex < maxLength * 0.6) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function buildProjectMarkdown(row: ProjectImportRow): string {
  const lines = [
    `# ${row.projectName}`,
    "",
    "## Snapshot",
    `- Summary: ${row.summary || "See properties for the canonical audit row."}`,
    `- Status: ${row.status || "Unknown"}`,
    `- Pipeline stage: ${row.pipelineStage || "Unknown"}`,
    `- Verdict: ${row.verdict || "Unknown"}`,
    `- Category: ${row.category || "Unknown"}`,
    `- Source group: ${row.sourceGroup || "Unknown"}`,
    `- Local path: ${row.localPath || "Not mapped"}`,
    row.dateUpdated ? `- Last local update observed: ${row.dateUpdated}` : "",
    row.completion ? `- Legacy completion signal: ${row.completion}` : "",
    row.readiness ? `- Legacy readiness signal: ${row.readiness}` : "",
    row.mergedInto ? `- Merged into: ${row.mergedInto}` : "",
    "",
    "## Build Context",
    `- Stack: ${row.stack || "Not captured in the audit."}`,
    row.keyIntegrations ? `- Key integrations: ${row.keyIntegrations}` : "- Key integrations: None noted in the local audit.",
    row.registryStatus || row.primaryTool || row.contextQuality
      ? `- Registry context: status ${row.registryStatus || "unknown"}, tool ${row.primaryTool || "unknown"}, context ${row.contextQuality || "unknown"}`
      : "",
    "",
    "## Audit Notes",
    row.auditNotes || "No extra manual-review notes were attached to this row during the current local audit pass.",
  ].filter(Boolean);

  return lines.join("\n");
}

async function verifyImport(
  sdk: Client,
  markdownApi: DirectNotionClient,
  dataSourceId: string,
  samplePageId?: string,
): Promise<{ rowCount: number; sampleMarkdownPreview?: string }> {
  const queryResponse = (await sdk.request({
    path: `data_sources/${dataSourceId}/query`,
    method: "post",
    body: {
      page_size: 100,
    },
  })) as { results?: Array<unknown> };

  let sampleMarkdownPreview: string | undefined;
  if (samplePageId) {
    const markdown = await markdownApi.readPageMarkdown(samplePageId);
    sampleMarkdownPreview = markdown.markdown.split("\n").slice(0, 10).join("\n");
  }

  return {
    rowCount: queryResponse.results?.length ?? 0,
    sampleMarkdownPreview,
  };
}

main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exitCode = 1;
});
