// Internal historical utility. Kept for compatibility scripts, not the shared operator surface.
import { statSync, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";
import { isDirectExecution } from "../../cli/legacy.js";

const PROJECTS_ROOT = "/Users/d/Projects";
const REPORT_PATH = path.join(PROJECTS_ROOT, "PORTFOLIO-AUDIT-REPORT.md");
const WORKBOOK_PATH = path.join(PROJECTS_ROOT, "PORTFOLIO-AUDIT-REPORT.xlsx");
const REGISTRY_PATH = path.join(PROJECTS_ROOT, "project-registry.md");

const CANONICAL_COLUMNS = [
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

type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

interface InventoryProject {
  projectName: string;
  relativePath: string;
  sourceGroup: string;
  sourceBucket: string;
}

interface SummaryEntry {
  projectName: string;
  legacyCategory?: string;
  completion?: string;
  readiness?: string;
  priority?: string;
  legacyVerdict?: string;
}

interface DetailEntry {
  headingName: string;
  relativePath?: string;
  sectionName: string;
  legacyCategory?: string;
  summary?: string;
  stack?: string;
  externalIntegrations?: string[];
  completion?: string;
  readiness?: string;
  legacyVerdict?: string;
  priority?: string;
}

interface RegistryEntry {
  status?: string;
  tool?: string;
  contextQuality?: string;
  notes?: string;
}

interface ProjectDatasetRow extends Record<CanonicalColumn, string> {
  sourceGroup: string;
  relativePath: string;
  legacyCategory?: string;
  legacyVerdict?: string;
  readiness?: string;
  completion?: string;
  registryStatus?: string;
}

interface ProjectContext {
  inventory: InventoryProject;
  detail?: DetailEntry;
  summary?: SummaryEntry;
  registry?: RegistryEntry;
  inspectedStack?: string;
  anomalies: string[];
}

interface ParsedReport {
  inventorySections: string;
  summaryEntries: Map<string, SummaryEntry>;
  detailEntries: Map<string, DetailEntry>;
  detailEntriesByPath: Map<string, DetailEntry>;
}

const GROUP_DIRECTORIES = [
  "ITPRJsViaClaude",
  "Fun:GamePrjs",
  "FunGamePrjs",
  "MoneyPRJsViaGPT",
  "VanityPRJs",
  "Misc:NoGoPRJs",
] as const;

const EXCLUDED_ROOT_NAMES = new Set([
  ".claude",
  ".codex-maintenance",
  ".cowork",
  ".git",
  "GrokPRJs",
]);

const ROOT_GROUPS = new Set([...GROUP_DIRECTORIES, "claude-code"]);

const PATH_NAME_OVERRIDES = new Map<string, string>([
  ["claude-code/production/rag-knowledge-base", "RAG Knowledge Base"],
  ["FunGamePrjs/OrbitForge", "OrbitForge (staging)"],
]);

const DETAIL_ALIAS_OVERRIDES = new Map<string, string>([
  ["claudecodeproductionragknowledgebase", "ragknowledgebase"],
]);

async function main(): Promise<void> {
  const [reportText, registryText, discoveredProjects] = await Promise.all([
    fs.readFile(REPORT_PATH, "utf8"),
    fs.readFile(REGISTRY_PATH, "utf8"),
    discoverProjects(),
  ]);

  const parsedReport = parseReport(reportText);
  const registryEntries = parseRegistry(registryText);

  const dataset = await buildDataset(discoveredProjects, parsedReport, registryEntries);
  const markdown = buildMarkdownReport(dataset, parsedReport.inventorySections);

  await fs.writeFile(REPORT_PATH, markdown, "utf8");
  await writeWorkbook(dataset);

  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        workbookPath: WORKBOOK_PATH,
        projectCount: dataset.length,
        missingHighValueFields: countHighValueGaps(dataset),
      },
      null,
      2,
    ),
  );
}

async function discoverProjects(): Promise<InventoryProject[]> {
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const discovered: InventoryProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const name = entry.name;
    if (name.startsWith(".") || EXCLUDED_ROOT_NAMES.has(name)) {
      continue;
    }

    if (ROOT_GROUPS.has(name)) {
      continue;
    }

    discovered.push({
      projectName: PATH_NAME_OVERRIDES.get(name) ?? name.trim(),
      relativePath: name,
      sourceGroup: "Standalone Projects",
      sourceBucket: "root",
    });
  }

  for (const groupName of GROUP_DIRECTORIES) {
    const groupPath = path.join(PROJECTS_ROOT, groupName);
    const groupEntries = await fs.readdir(groupPath, { withFileTypes: true });
    for (const entry of groupEntries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const relativePath = path.posix.join(groupName, entry.name);
      discovered.push({
        projectName: PATH_NAME_OVERRIDES.get(relativePath) ?? entry.name.trim(),
        relativePath,
        sourceGroup: groupName === "FunGamePrjs" ? "FunGamePrjs - Build-Ready Staging" : groupName,
        sourceBucket: groupName,
      });
    }
  }

  const ragKbPath = path.posix.join("claude-code", "production", "rag-knowledge-base");
  const ragKbStat = await safeStat(path.join(PROJECTS_ROOT, ragKbPath));
  if (ragKbStat?.isDirectory()) {
    discovered.push({
      projectName: PATH_NAME_OVERRIDES.get(ragKbPath) ?? "RAG Knowledge Base",
      relativePath: ragKbPath,
      sourceGroup: "Production / Foundation",
      sourceBucket: "claude-code",
    });
  }

  return discovered.sort((left, right) => left.projectName.localeCompare(right.projectName));
}

function parseReport(reportText: string): ParsedReport {
  const standaloneMarker = "\n## Standalone Projects";
  const inventoryStart = reportText.indexOf(standaloneMarker);
  const generatedSummaryMatch = reportText.match(/\n## 1\. (?:Portfolio Summary Table|Audit Methodology)\n/);
  const summaryIndex = generatedSummaryMatch ? reportText.indexOf(generatedSummaryMatch[0]) : -1;

  if (summaryIndex === -1 || inventoryStart === -1) {
    throw new Error("Could not find expected report sections in PORTFOLIO-AUDIT-REPORT.md");
  }

  const inventorySections = reportText.slice(inventoryStart, summaryIndex).trim();
  const summaryEntries = parseSummaryTable(reportText.slice(summaryIndex));
  const { detailEntries, detailEntriesByPath } = parseDetailSections(inventorySections);

  return {
    inventorySections,
    summaryEntries,
    detailEntries,
    detailEntriesByPath,
  };
}

function parseSummaryTable(text: string): Map<string, SummaryEntry> {
  const rows = new Map<string, SummaryEntry>();
  const sectionMatch = text.match(/## 1\. Portfolio Summary Table([\s\S]*?)\n## 2\./);
  if (!sectionMatch) {
    return rows;
  }

  const lines = (sectionMatch[1] ?? "").split("\n");
  for (const line of lines) {
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 7 || cells[0] === "#" || cells[0] === "---" || cells[0] === "**TOTALS**") {
      continue;
    }
    const [
      _indexCell = "",
      projectName = "",
      legacyCategory = "",
      completion = "",
      readiness = "",
      priority = "",
      legacyVerdict = "",
    ] = cells;
    rows.set(normalizeKey(projectName), {
      projectName,
      legacyCategory,
      completion,
      readiness,
      priority,
      legacyVerdict,
    });
  }
  return rows;
}

function parseDetailSections(inventorySections: string): {
  detailEntries: Map<string, DetailEntry>;
  detailEntriesByPath: Map<string, DetailEntry>;
} {
  const rows = new Map<string, DetailEntry>();
  const rowsByPath = new Map<string, DetailEntry>();
  const lines = inventorySections.split("\n");
  let currentSection = "";
  let currentHeading = "";
  let buffer: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    const detail = parseDetailBlock(currentSection, currentHeading, buffer.join("\n").trim());
    rows.set(normalizeKey(detail.headingName), detail);
    const alias = DETAIL_ALIAS_OVERRIDES.get(normalizeKey(detail.headingName));
    if (alias) {
      rows.set(alias, detail);
    }
    if (detail.relativePath) {
      rowsByPath.set(normalizePathKey(detail.relativePath), detail);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentSection = line.replace(/^##\s+/, "").trim();
      currentHeading = "";
      continue;
    }
    if (line.startsWith("### ")) {
      flush();
      currentHeading = line.replace(/^###\s+/, "").trim();
      continue;
    }
    if (currentHeading) {
      buffer.push(line);
    }
  }

  flush();
  return {
    detailEntries: rows,
    detailEntriesByPath: rowsByPath,
  };
}

function parseDetailBlock(sectionName: string, heading: string, text: string): DetailEntry {
  const headingName = heading
    .replace(/^\**\d+[a-z]?\.?\s+/, "")
    .replace(/^\*\*/, "")
    .replace(/\*\*$/, "")
    .trim();

  const relativePath = extractInlineField(text, "Path")?.replace(/^\.\/+/, "");
  return {
    headingName,
    relativePath,
    sectionName,
    legacyCategory: extractInlineField(text, "Category"),
    summary: extractInlineField(text, "Summary"),
    stack: extractInlineField(text, "Stack") ?? extractTechnicalProfileStack(text),
    externalIntegrations: extractTechnicalProfileListItem(text, "External integrations"),
    completion: extractInlineField(text, "Completion"),
    readiness: extractInlineField(text, "Readiness"),
    legacyVerdict:
      extractBulletField(text, "Verdict") ??
      extractInlineField(text, "Verdict") ??
      extractVerdictFromCompactLine(text),
    priority:
      extractBulletTailField(text, "Priority") ??
      extractInlineField(text, "Priority") ??
      extractPriorityFromCompactLine(text),
  };
}

function parseRegistry(registryText: string): Map<string, RegistryEntry> {
  const entries = new Map<string, RegistryEntry>();
  const lines = registryText.split("\n");
  let header: string[] | null = null;

  for (const line of lines) {
    if (!line.startsWith("|")) {
      header = null;
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    }

    if (cells.includes("Project") && cells.includes("Status")) {
      header = cells;
      continue;
    }

    if (!header || cells.length !== header.length) {
      continue;
    }

    const row = Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ""]));
    if (!row.Project) {
      continue;
    }
    entries.set(normalizeKey(row.Project), {
      status: row.Status,
      tool: row.Tool,
      contextQuality: row["Context Quality"],
      notes: row.Notes,
    });
  }

  return entries;
}

async function buildDataset(
  discoveredProjects: InventoryProject[],
  parsedReport: ParsedReport,
  registryEntries: Map<string, RegistryEntry>,
): Promise<ProjectDatasetRow[]> {
  const rows = await Promise.all(
    discoveredProjects.map(async (inventory) => {
      const detail =
        parsedReport.detailEntriesByPath.get(normalizePathKey(inventory.relativePath)) ??
        parsedReport.detailEntries.get(normalizeKey(inventory.projectName));
      const summary =
        parsedReport.summaryEntries.get(normalizeKey(inventory.projectName)) ??
        parsedReport.summaryEntries.get(normalizeKey(detail?.headingName ?? ""));
      const registry =
        registryEntries.get(normalizeKey(inventory.projectName)) ??
        registryEntries.get(normalizeKey(detail?.headingName ?? ""));

      const anomalies: string[] = [];
      const pathBasename = path.posix.basename(inventory.relativePath);
      if (pathBasename !== pathBasename.trim()) {
        anomalies.push("Filesystem folder name contains leading or trailing whitespace.");
      }
      if (inventory.projectName.includes("(staging)")) {
        anomalies.push("Staging copy kept as a separate local project row.");
      }
      if (inventory.relativePath === "job-search-2026") {
        anomalies.push("Document vault rather than a software codebase.");
      }

      return buildRow({
        inventory,
        detail,
        summary,
        registry,
        inspectedStack: await inspectProjectStack(path.join(PROJECTS_ROOT, inventory.relativePath)),
        anomalies,
      });
    }),
  );

  const baseRows = new Map(
    rows
      .filter((row) => !row["Project Name"].includes("(staging)"))
      .map((row) => [normalizeKey(row["Project Name"]), row] as const),
  );

  for (const row of rows) {
    if (!row["Project Name"].includes("(staging)")) {
      continue;
    }
    const baseName = row["Project Name"].replace(/\s+\(staging\)$/i, "");
    const baseRow = baseRows.get(normalizeKey(baseName));
    if (!baseRow) {
      continue;
    }
    row.Status = row.Status || baseRow.Status;
    row["Pipeline Stage"] = row["Pipeline Stage"] || baseRow["Pipeline Stage"];
    row.Verdict = row.Verdict || baseRow.Verdict;
    row.Category = row.Category || baseRow.Category;
    row.Stack = row.Stack || baseRow.Stack;
    if (!row.Notes.includes("Staging copy")) {
      row.Notes = appendSentence(row.Notes, "Staging copy kept as a separate local project row.");
    }
  }

  return rows.sort((left, right) => left["Project Name"].localeCompare(right["Project Name"]));
}

function buildRow(context: ProjectContext): ProjectDatasetRow {
  const legacyCategory = firstNonEmpty(context.summary?.legacyCategory, context.detail?.legacyCategory);
  const completion = firstNonEmpty(context.summary?.completion, context.detail?.completion);
  const readiness = firstNonEmpty(context.summary?.readiness, context.detail?.readiness);
  const legacyVerdict = firstNonEmpty(context.summary?.legacyVerdict, context.detail?.legacyVerdict);
  const priority = firstNonEmpty(context.summary?.priority, context.detail?.priority);
  const stack = firstNonEmpty(context.detail?.stack, context.inspectedStack);
  const keyIntegrations = context.detail?.externalIntegrations?.join(", ") ?? "";

  const row: ProjectDatasetRow = {
    "Project Name": context.inventory.projectName,
    Status: deriveStatus(legacyVerdict, completion, readiness, context.registry?.status, context.detail?.summary),
    "Pipeline Stage": derivePipelineStage(
      context.registry?.status,
      context.registry?.contextQuality,
      completion,
      readiness,
      legacyVerdict,
    ),
    Category: deriveCategory(legacyCategory, stack, context.detail?.summary),
    Verdict: deriveVerdict(legacyVerdict, priority),
    Score: "",
    "Max Score": "",
    "Scoring Framework": "",
    Stack: stack ?? "",
    "Est. Effort": "",
    "Merged Into": extractMergedInto(legacyVerdict),
    Notes: buildNotes(context),
    Batch: "",
    "Key Integrations": keyIntegrations,
    "Date Scored": "",
    "Date Updated": safeDateFromPath(path.join(PROJECTS_ROOT, context.inventory.relativePath)),
    sourceGroup: context.inventory.sourceGroup,
    relativePath: context.inventory.relativePath,
    legacyCategory,
    legacyVerdict,
    readiness,
    completion,
    registryStatus: context.registry?.status,
  };

  if (row.Status === "Merged" && !row["Merged Into"]) {
    row.Notes = appendSentence(row.Notes, "Merged target needs manual confirmation.");
  }
  if (!row.Category) {
    row.Notes = appendSentence(row.Notes, "Category left blank under the conservative Notion mapping.");
  }
  if (context.inventory.relativePath === "Misc:NoGoPRJs/app") {
    row.Stack = row.Stack || "SwiftUI";
  }
  if (context.inventory.projectName === "PomGambler" || context.inventory.projectName === "PomGambler-prod") {
    row.Category = row.Category || "Desktop App";
  }
  if (context.inventory.relativePath === "claude-code/production/rag-knowledge-base") {
    row.Status = row.Status || "Handoff Ready";
    row["Pipeline Stage"] = row["Pipeline Stage"] || "Post-Build Review Done";
    row.Verdict = row.Verdict || "Strong Candidate";
    row.Stack = row.Stack || "Python, FastAPI, SQLite, Qdrant, React";
  }
  if (context.inventory.relativePath === "job-search-2026") {
    row.Status = row.Status || "Shipped";
    row["Pipeline Stage"] = row["Pipeline Stage"] || "Post-Build Review Done";
    row.Category = row.Category || "Monetization";
    row.Verdict = row.Verdict || "Low Priority";
    row.Stack = row.Stack || "Documents, PDF, DOCX";
  }

  return row;
}

function deriveStatus(
  legacyVerdict?: string,
  completion?: string,
  readiness?: string,
  registryStatus?: string,
  summary?: string,
): string {
  const verdict = (legacyVerdict ?? "").toLowerCase();
  const completionValue = parseCompletionPercent(completion);
  const ready = (readiness ?? "").toLowerCase();
  const registry = (registryStatus ?? "").toLowerCase();
  const summaryText = (summary ?? "").toLowerCase();

  if (verdict.includes("merge")) {
    return "Merged";
  }
  if (summaryText.includes("v1 shipped") || summaryText.includes("already shipped") || ready.includes("v1 live")) {
    return "Shipped";
  }
  if (
    ready.includes("ship-ready") ||
    ready.includes("complete") ||
    completionValue === 100 ||
    (typeof completionValue === "number" && completionValue >= 85 && (verdict.includes("ship") || verdict.includes("release")))
  ) {
    return "Handoff Ready";
  }
  if ((verdict.includes("archive") || verdict.includes("delete")) && !verdict.includes("ship") && !verdict.includes("release")) {
    return "Abandoned";
  }
  if (registry === "active" || registry === "recent") {
    return "In Progress";
  }
  if (typeof completionValue === "number" && completionValue > 0) {
    return "Planned";
  }
  return "";
}

function derivePipelineStage(
  registryStatus?: string,
  contextQuality?: string,
  completion?: string,
  readiness?: string,
  legacyVerdict?: string,
): string {
  const registry = (registryStatus ?? "").toLowerCase();
  const context = (contextQuality ?? "").toLowerCase();
  const completionValue = parseCompletionPercent(completion);
  const ready = (readiness ?? "").toLowerCase();
  const verdict = (legacyVerdict ?? "").toLowerCase();

  if (
    ready.includes("v1 live") ||
    ready.includes("ship-ready") ||
    ready.includes("complete") ||
    (typeof completionValue === "number" && completionValue >= 85)
  ) {
    return "Post-Build Review Done";
  }
  if (context === "full") {
    return "Handoff Docs Generated";
  }
  if ((registry === "active" || registry === "recent") && !verdict.includes("archive")) {
    return "Building in Claude Code";
  }
  if (typeof completionValue === "number" && completionValue > 0) {
    return "Implementation Plan";
  }
  return "";
}

function deriveCategory(legacyCategory?: string, stack?: string, summary?: string): string {
  const source = `${legacyCategory ?? ""} ${stack ?? ""} ${summary ?? ""}`.toLowerCase();
  if (source.includes("it tool")) {
    return "IT Tool";
  }
  if (
    source.includes("compliance") ||
    source.includes("questionnaire") ||
    source.includes("binder") ||
    source.includes("sop")
  ) {
    return "IT Tool";
  }
  if (source.includes("saas") || source.includes("supabase") || source.includes("stripe") || source.includes("portal")) {
    return "Commercial SaaS";
  }
  if (source.includes("dev tool") || source.includes("api client") || source.includes("postgresql ide")) {
    return "Dev Tool";
  }
  if (source.includes("prompt engineering") || source.includes("workbench")) {
    return "Dev Tool";
  }
  if (source.includes("reasoning") || source.includes("knowledge") || source.includes("rag")) {
    return "Reasoning Tool";
  }
  if (
    source.includes("desktop") ||
    source.includes("tauri") ||
    source.includes("electron") ||
    source.includes("swiftui") ||
    source.includes("godot") ||
    source.includes("native macos")
  ) {
    return "Desktop App";
  }
  if (source.includes("file transfer") || source.includes("encryption") || source.includes("topology")) {
    return "IT Tool";
  }
  if (source.includes("terrain") || source.includes("visualizer") || source.includes("tutorial generation")) {
    return "Creative Tool";
  }
  if (source.includes("creative") || source.includes("visualizer") || source.includes("editor") || source.includes("studio")) {
    return "Creative Tool";
  }
  return "";
}

function deriveVerdict(legacyVerdict?: string, priority?: string): string {
  const verdict = (legacyVerdict ?? "").toLowerCase();
  const priorityText = (priority ?? "").toLowerCase();

  if (verdict.includes("merge")) {
    return "Merged Into Other";
  }
  if (verdict.includes("archive") || verdict.includes("delete")) {
    if (verdict.includes("ship") || verdict.includes("release") || verdict.includes("complete")) {
      if (priorityText.includes("high")) {
        return "Strong Candidate";
      }
      if (priorityText.includes("medium")) {
        return "Worth Building";
      }
      return "Low Priority";
    }
    return "Skip";
  }
  if (priorityText.includes("high")) {
    return "Strong Candidate";
  }
  if (priorityText.includes("🔥")) {
    return "Strong Candidate";
  }
  if (priorityText.includes("medium")) {
    return "Worth Building";
  }
  if (priorityText.includes("🟡")) {
    return "Worth Building";
  }
  if (priorityText.includes("low")) {
    return "Low Priority";
  }
  if (priorityText.includes("🔵") || priorityText.includes("🗄️")) {
    return "Low Priority";
  }
  return "";
}

function extractMergedInto(legacyVerdict?: string): string {
  const match = (legacyVerdict ?? "").match(/merge(?:d)?(?: into)?\s+([A-Za-z0-9().\- ]+)/i);
  return match?.[1]?.trim() ?? "";
}

function buildNotes(context: ProjectContext): string {
  const parts: string[] = [];
  const completion = firstNonEmpty(context.summary?.completion, context.detail?.completion);
  const readiness = firstNonEmpty(context.summary?.readiness, context.detail?.readiness);
  if (context.detail?.summary) {
    parts.push(context.detail.summary);
  }
  if (completion) {
    parts.push(`Legacy completion: ${completion}.`);
  }
  if (readiness) {
    parts.push(`Legacy readiness: ${readiness}.`);
  }
  if (context.registry?.status || context.registry?.tool || context.registry?.contextQuality) {
    const registryBits = [
      context.registry?.status ? `registry ${context.registry.status}` : "",
      context.registry?.tool ? `tool ${context.registry.tool}` : "",
      context.registry?.contextQuality ? `context ${context.registry.contextQuality}` : "",
    ].filter(Boolean);
    if (registryBits.length > 0) {
      parts.push(`Registry: ${registryBits.join(", ")}.`);
    }
  }
  for (const anomaly of context.anomalies) {
    parts.push(anomaly);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function inspectProjectStack(projectPath: string): Promise<string> {
  const hints = new Set<string>();
  const packageJsonPath = path.join(projectPath, "package.json");
  const cargoTomlPath = path.join(projectPath, "Cargo.toml");
  const tauriCargoTomlPath = path.join(projectPath, "src-tauri", "Cargo.toml");
  const godotPath = path.join(projectPath, "project.godot");
  const goModPath = path.join(projectPath, "go.mod");
  const pyprojectPath = path.join(projectPath, "pyproject.toml");

  const packageJson = await safeReadJson(packageJsonPath);
  if (packageJson) {
    const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) } as Record<string, string>;
    if (deps.next) {
      hints.add("Next.js");
    }
    if (deps.react) {
      hints.add("React");
    }
    if (deps.vue) {
      hints.add("Vue");
    }
    if (deps["@sveltejs/kit"] || deps.svelte) {
      hints.add("SvelteKit");
    }
    if (deps.typescript || (await safeStat(path.join(projectPath, "tsconfig.json")))) {
      hints.add("TypeScript");
    }
    if (deps.sqlite || deps["better-sqlite3"] || deps["sql.js"]) {
      hints.add("SQLite");
    }
  }

  if ((await safeStat(cargoTomlPath)) || (await safeStat(tauriCargoTomlPath))) {
    hints.add("Rust");
  }
  if (await safeStat(tauriCargoTomlPath)) {
    hints.add("Tauri");
  }
  if (await safeStat(godotPath)) {
    hints.add("Godot");
  }
  if (await safeStat(goModPath)) {
    hints.add("Go");
  }
  if (await safeStat(pyprojectPath)) {
    hints.add("Python");
  }

  return Array.from(hints).join(", ");
}

function buildMarkdownReport(dataset: ProjectDatasetRow[], inventorySections: string): string {
  const today = formatDate(new Date());
  const totalProjects = dataset.length;
  const fieldCoverage = buildFieldCoverage(dataset);

  return [
    "# Portfolio Audit Report",
    "",
    `> Generated: ${today} | In-scope local projects: ${totalProjects} | Notion-mirror rows: ${totalProjects}`,
    "",
    "---",
    "",
    "## Table of Contents",
    "",
    "1. [Standalone and grouped local project audit](#standalone-projects-18)",
    "2. [Audit Methodology](#1-audit-methodology)",
    "3. [Canonical Notion-Mirror Portfolio Table](#2-canonical-notion-mirror-portfolio-table)",
    "4. [Coverage Summary](#3-coverage-summary)",
    "5. [Breakdown by Notion Fields](#4-breakdown-by-notion-fields)",
    "6. [Accuracy Findings](#5-accuracy-findings)",
    "7. [Recommended Next Sync Steps](#6-recommended-next-sync-steps)",
    "",
    "---",
    "",
    inventorySections.trim(),
    "",
    "---",
    "",
    "## 1. Audit Methodology",
    "",
    "- Scope: local-only portfolio audit using the current `/Users/d/Projects` filesystem, the existing detailed audit narrative, and `project-registry.md` as supporting context.",
    "- Mapping policy: conservative. When a Notion-style field could not be supported clearly from local evidence or explicit existing audit text, it was left blank.",
    "- Canonical schema: the exact current Notion `📦 Project Portfolio` columns are mirrored below and used for the workbook.",
    "- Important note: these rows are aligned to the Notion field model, but they do not assume the live Notion values are already true for local projects.",
    "",
    "## 2. Canonical Notion-Mirror Portfolio Table",
    "",
    buildCanonicalMarkdownTable(dataset),
    "",
    "## 3. Coverage Summary",
    "",
    `- Total in-scope local projects: ${totalProjects}`,
    `- Projects with a mapped \`Status\`: ${fieldCoverage.Status}/${totalProjects}`,
    `- Projects with a mapped \`Pipeline Stage\`: ${fieldCoverage["Pipeline Stage"]}/${totalProjects}`,
    `- Projects with a mapped \`Category\`: ${fieldCoverage.Category}/${totalProjects}`,
    `- Projects with a mapped \`Verdict\`: ${fieldCoverage.Verdict}/${totalProjects}`,
    `- Projects with a derived \`Stack\`: ${fieldCoverage.Stack}/${totalProjects}`,
    `- Projects with \`Key Integrations\`: ${fieldCoverage["Key Integrations"]}/${totalProjects}`,
    `- Projects still missing one or more high-value Notion fields: ${countHighValueGaps(dataset)}`,
    "",
    "### Source Group Counts",
    "",
    buildCountTable("Source Group", "Projects", countBySource(dataset)),
    "",
    "### Field Coverage",
    "",
    buildCountTable("Field", "Non-empty Rows", Object.entries(fieldCoverage)),
    "",
    "## 4. Breakdown by Notion Fields",
    "",
    "### Status",
    "",
    buildCountTable("Status", "Projects", countBy(dataset, "Status")),
    "",
    "### Pipeline Stage",
    "",
    buildCountTable("Pipeline Stage", "Projects", countBy(dataset, "Pipeline Stage")),
    "",
    "### Category",
    "",
    buildCountTable("Category", "Projects", countBy(dataset, "Category")),
    "",
    "### Verdict",
    "",
    buildCountTable("Verdict", "Projects", countBy(dataset, "Verdict")),
    "",
    "## 5. Accuracy Findings",
    "",
    "- The canonical local scope remains 65 projects once grouped folders are counted and obvious meta folders are excluded.",
    "- `GrokPRJs` remains out of scope for this local audit, matching the original report intent.",
    "- `FunGamePrjs/OrbitForge` is kept as a separate staging row and surfaced as `OrbitForge (staging)`.",
    "- `Fun:GamePrjs/ CryptForge` has a filesystem folder name with leading whitespace; the project name is normalized to `CryptForge` in the canonical table.",
    "- `job-search-2026` stays in scope because the original audit included it, but it is flagged in notes as a document vault rather than a software codebase.",
    "- Scoring-only Notion fields (`Score`, `Max Score`, `Scoring Framework`, `Date Scored`) remain blank because the local audit did not provide enough high-confidence evidence to fill them conservatively.",
    "",
    "### Rows Flagged for Manual Review",
    "",
    buildReviewTable(
      dataset.filter(
        (row) =>
          row.Notes.includes("Staging copy") ||
          row.Notes.includes("whitespace") ||
          row.Notes.includes("Document vault"),
      ),
    ),
    "",
    "## 6. Recommended Next Sync Steps",
    "",
    "- Decide whether the staged copies (`DesktopPEt-ready`, `EarthPulse-readiness`, `OrbitForge (staging)`) should remain first-class portfolio rows or be tracked as release artifacts under their base projects.",
    "- Decide whether `job-search-2026` should stay in the portfolio audit or move to a separate document/archive inventory.",
    "- If you want tighter Notion alignment later, the next safe manual pass is to fill only `Score`, `Max Score`, `Scoring Framework`, `Batch`, and `Date Scored` for projects that already have explicit scoring evidence elsewhere.",
    "- If you want exact local-to-Notion syncing later, the workbook created alongside this report is now structured to make that mapping tractable.",
    "",
  ].join("\n");
}

function buildCanonicalMarkdownTable(dataset: ProjectDatasetRow[]): string {
  const header = `| ${CANONICAL_COLUMNS.join(" | ")} |`;
  const separator = `| ${CANONICAL_COLUMNS.map(() => "---").join(" | ")} |`;
  const rows = dataset.map((row) => {
    const cells = CANONICAL_COLUMNS.map((column) => escapeCell(row[column]));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, separator, ...rows].join("\n");
}

function buildCountTable(labelHeader: string, valueHeader: string, entries: Array<[string, number]>): string {
  const rows = entries
    .filter(([, value]) => value > 0)
    .map(([label, value]) => `| ${escapeCell(label || "(blank)")} | ${value} |`);
  return [`| ${labelHeader} | ${valueHeader} |`, "| --- | ---: |", ...rows].join("\n");
}

function buildReviewTable(rows: ProjectDatasetRow[]): string {
  if (rows.length === 0) {
    return "| Project Name | Review Note |\n| --- | --- |\n| None | No manual review rows were flagged. |";
  }

  return [
    "| Project Name | Review Note |",
    "| --- | --- |",
    ...rows.map((row) => `| ${escapeCell(row["Project Name"])} | ${escapeCell(row.Notes)} |`),
  ].join("\n");
}

function buildFieldCoverage(dataset: ProjectDatasetRow[]): Record<CanonicalColumn, number> {
  return Object.fromEntries(
    CANONICAL_COLUMNS.map((column) => [column, dataset.filter((row) => row[column].trim().length > 0).length]),
  ) as Record<CanonicalColumn, number>;
}

async function writeWorkbook(dataset: ProjectDatasetRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  workbook.modified = new Date();

  const projectsSheet = workbook.addWorksheet("Projects", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  projectsSheet.columns = CANONICAL_COLUMNS.map((column) => ({
    header: column,
    key: column,
    width: column === "Notes" ? 60 : column === "Stack" ? 34 : column === "Key Integrations" ? 28 : 18,
  }));
  projectsSheet.autoFilter = {
    from: "A1",
    to: `${columnLetter(CANONICAL_COLUMNS.length)}1`,
  };

  for (const row of dataset) {
    projectsSheet.addRow(Object.fromEntries(CANONICAL_COLUMNS.map((column) => [column, row[column]])));
  }
  projectsSheet.getRow(1).font = { bold: true };

  const analysisSheet = workbook.addWorksheet("Analysis", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const coverage = buildFieldCoverage(dataset);
  const sections: Array<{ title: string; rows: Array<[string, number]> }> = [
    { title: "Status counts", rows: countBy(dataset, "Status") },
    { title: "Pipeline Stage counts", rows: countBy(dataset, "Pipeline Stage") },
    { title: "Category counts", rows: countBy(dataset, "Category") },
    { title: "Verdict counts", rows: countBy(dataset, "Verdict") },
    { title: "Source group counts", rows: countBySource(dataset) },
    { title: "Field coverage", rows: Object.entries(coverage) },
  ];

  let rowIndex = 1;
  for (const section of sections) {
    analysisSheet.getCell(`A${rowIndex}`).value = section.title;
    analysisSheet.getCell(`A${rowIndex}`).font = { bold: true };
    rowIndex += 1;
    analysisSheet.getCell(`A${rowIndex}`).value = "Label";
    analysisSheet.getCell(`B${rowIndex}`).value = "Count";
    analysisSheet.getRow(rowIndex).font = { bold: true };
    rowIndex += 1;
    for (const [label, count] of section.rows.filter(([, value]) => value > 0)) {
      analysisSheet.getCell(`A${rowIndex}`).value = label || "(blank)";
      analysisSheet.getCell(`B${rowIndex}`).value = count;
      rowIndex += 1;
    }
    rowIndex += 1;
  }

  analysisSheet.getCell("D1").value = "Coverage notes";
  analysisSheet.getCell("D1").font = { bold: true };
  analysisSheet.getCell("D2").value =
    "Conservative mapping: uncertain Notion fields are intentionally blank. Use the Projects sheet as the canonical machine-sortable companion to the Markdown audit.";
  analysisSheet.getCell("D4").value = "Projects missing one or more high-value fields";
  analysisSheet.getCell("E4").value = countHighValueGaps(dataset);

  await workbook.xlsx.writeFile(WORKBOOK_PATH);
}

function countBy(dataset: ProjectDatasetRow[], column: CanonicalColumn): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of dataset) {
    const value = row[column].trim();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function countBySource(dataset: ProjectDatasetRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of dataset) {
    counts.set(row.sourceGroup, (counts.get(row.sourceGroup) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function countHighValueGaps(dataset: ProjectDatasetRow[]): number {
  return dataset.filter((row) => !row.Status || !row.Category || !row.Verdict || !row.Stack || !row["Date Updated"]).length;
}

function extractInlineField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s+(.+)`));
  return match?.[1]?.replace(/\s+\|\s+\*\*.*$/, "").trim();
}

function extractBulletField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`-\\s+${escapeRegExp(label)}:\\s+\\*\\*(.+?)\\*\\*`));
  return match?.[1]?.trim();
}

function extractBulletTailField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`-\\s+${escapeRegExp(label)}:\\s+(.+)`));
  return match?.[1]?.replace(/\*\*/g, "").trim();
}

function extractVerdictFromCompactLine(text: string): string | undefined {
  const match = text.match(/\*\*Verdict:\*\*\s+\*\*(.+?)\*\*/);
  return match?.[1]?.trim();
}

function extractPriorityFromCompactLine(text: string): string | undefined {
  const match = text.match(/\*\*Priority:\*\*\s+(.+)/);
  return match?.[1]?.trim();
}

function extractTechnicalProfileStack(text: string): string | undefined {
  const compact = text.match(/\*\*Technical Profile:\*\*\s+(.+)/);
  if (compact?.[1]) {
    return compact[1].replace(/^- Stack:\s*/i, "").trim();
  }
  const block = text.match(/\*\*Technical Profile:\*\*([\s\S]*?)(?=\n\*\*[A-Z]|\n---|$)/);
  if (!block?.[1]) {
    return undefined;
  }
  const match = block[1].match(/- Stack:\s+(.+)/);
  return match?.[1]?.trim();
}

function extractTechnicalProfileListItem(text: string, label: string): string[] | undefined {
  const block = text.match(/\*\*Technical Profile:\*\*([\s\S]*?)(?=\n\*\*[A-Z]|\n---|$)/);
  if (!block?.[1]) {
    return undefined;
  }
  const match = block[1].match(new RegExp(`- ${escapeRegExp(label)}:\\s+(.+)`));
  if (!match?.[1]) {
    return undefined;
  }
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCompletionPercent(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/(\d{1,3})(?:-(\d{1,3}))?%/);
  if (!match) {
    return undefined;
  }
  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : undefined;
  return typeof second === "number" ? Math.round((first + second) / 2) : first;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\([^)]*\)/g, (match) => match.toLowerCase())
    .replace(/[^a-z0-9]+/g, "");
}

function normalizePathKey(value: string): string {
  return value.replace(/^\.\/+/, "").replace(/\\/g, "/").toLowerCase();
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function appendSentence(base: string, sentence: string): string {
  return base ? `${base} ${sentence}` : sentence;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function safeReadJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function safeDateFromPath(filePath: string): string {
  try {
    return formatDate(statSync(filePath).mtime);
  } catch {
    return "";
  }
}

function columnLetter(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (isDirectExecution(import.meta.url)) {
  void main();
}
