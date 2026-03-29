import { execFileSync } from "node:child_process";
import { statSync, type Dirent, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

const PROJECTS_ROOT = "/Users/d/Projects";
const REPORT_PATH = path.join(PROJECTS_ROOT, "PORTFOLIO-AUDIT-REPORT.md");
const REGISTRY_PATH = path.join(PROJECTS_ROOT, "project-registry.md");
const WORKBOOK_PATH = path.join(PROJECTS_ROOT, "PORTFOLIO-AUDIT-REPORT.xlsx");

const GROUP_DIRECTORIES = [
  "ITPRJsViaClaude",
  "Fun:GamePrjs",
  "FunGamePrjs",
  "MoneyPRJsViaGPT",
  "VanityPRJs",
  "Misc:NoGoPRJs",
  "GrokPRJs",
] as const;

const EXCLUDED_ROOT_NAMES = new Set([
  ".claude",
  ".codex-maintenance",
  ".cowork",
  ".git",
]);

const ROOT_GROUPS = new Set([...GROUP_DIRECTORIES, "claude-code"]);

const PATH_NAME_OVERRIDES = new Map<string, string>([
  ["claude-code/production/rag-knowledge-base", "RAG Knowledge Base"],
  ["FunGamePrjs/OrbitForge", "OrbitForge (staging)"],
  ["Fun:GamePrjs/ CryptForge", "CryptForge"],
]);

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

export interface ProjectIntelligenceRow {
  projectName: string;
  relativePath: string;
  sourceGroup: string;
  canonicalStatus: string;
  canonicalPipelineStage: string;
  canonicalCategory: string;
  canonicalVerdict: string;
  canonicalSummary: string;
  canonicalNotes: string;
  canonicalDateUpdated: string;
  currentState: string;
  portfolioCall: string;
  oneLinePitch: string;
  nextMove: string;
  biggestBlocker: string;
  momentum: string;
  lastActive: string;
  localPath: string;
  stack: string;
  projectShape: string[];
  deploymentSurface: string[];
  docsQuality: string;
  testPosture: string;
  evidenceConfidence: string;
  needsReview: boolean;
  startHere: string;
  primaryRunCommand: string;
  primaryContextDoc: string;
  setupFriction: string;
  runsLocally: string;
  lastMeaningfulWork: string;
  primaryUser: string;
  problemSolved: string;
  valueOutcome: string;
  buildMaturity: string;
  shipReadiness: string;
  effortToDemo: string;
  effortToShip: string;
  monetizationValue: string;
  keyIntegrations: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
  registryStatus: string;
  primaryTool: string;
  contextQuality: string;
  completion: string;
  readiness: string;
  mergedInto: string;
  setupPrerequisites: string[];
  contextDocs: string[];
}

export interface ScopeReconciliationItem {
  projectName: string;
  relativePath: string;
  classification: string;
  notes: string;
}

export interface ScopeReconciliation {
  auditedProjectCount: number;
  discoveredDirectoryCount: number;
  matchedProjectCount: number;
  extraDiscovered: ScopeReconciliationItem[];
  unmatchedAudited: string[];
}

interface InventoryProject {
  projectName: string;
  relativePath: string;
  sourceGroup: string;
  sourceBucket: string;
}

interface WorkbookRow extends Record<CanonicalColumn, string> {}

interface RegistryEntry {
  status?: string;
  tool?: string;
  contextQuality?: string;
  notes?: string;
}

interface DetailEntry {
  headingName: string;
  relativePath?: string;
  sectionName: string;
  category?: string;
  summary?: string;
  problemSolved?: string;
  intendedUser?: string;
  strategicValue?: string;
  stack?: string;
  architecture?: string;
  integrations?: string[];
  aiUsage?: string;
  storage?: string;
  entryPoint?: string;
  completion?: string;
  readiness?: string;
  whatWorks?: string;
  missing?: string;
  toMvp?: string;
  toShipReady?: string;
  codeQuality?: string;
  operational?: string;
  verdict?: string;
  priority?: string;
  blocker?: string;
  quickWins?: string;
  integration?: string;
}

interface ProjectSignals {
  hasReadme: boolean;
  hasAgents: boolean;
  hasClaude: boolean;
  hasPackageJson: boolean;
  hasCargoToml: boolean;
  hasPyproject: boolean;
  hasTests: boolean;
  packageManager: string;
  packageScripts: string[];
  contextDocs: string[];
  primaryContextDoc: string;
  claudeOverview: string;
  claudeCurrentPhase: string;
  claudeTechStack: string;
  primaryRunCommand: string;
  setupPrerequisites: string[];
  gitLastActive: string;
  filesystemLastActive: string;
}

interface ParsedSources {
  workbookRows: Map<string, WorkbookRow>;
  detailEntries: Map<string, DetailEntry>;
  detailEntriesByPath: Map<string, DetailEntry>;
  registryEntries: Map<string, RegistryEntry>;
}

export async function buildProjectIntelligenceDataset(): Promise<{
  projects: ProjectIntelligenceRow[];
  scope: ScopeReconciliation;
}> {
  const [inventory, discoveredAll, sources] = await Promise.all([
    discoverInventoryProjects(),
    discoverAllProjectDirectories(),
    loadParsedSources(),
  ]);

  const inventoryByKey = new Map(inventory.map((item) => [normalizeKey(item.projectName), item] as const));
  const detailByPath = sources.detailEntriesByPath;

  const projects = await Promise.all(
    inventory.map(async (project) => {
      const workbookRow = sources.workbookRows.get(normalizeKey(project.projectName));
      const detail =
        detailByPath.get(normalizePathKey(project.relativePath)) ??
        sources.detailEntries.get(normalizeKey(project.projectName));
      const registry =
        sources.registryEntries.get(normalizeKey(project.projectName)) ??
        sources.registryEntries.get(normalizeKey(detail?.headingName ?? ""));
      const projectPath = path.join(PROJECTS_ROOT, project.relativePath);
      const signals = await inspectProjectSignals(projectPath, detail);

      return buildProjectRow({
        inventory: project,
        workbookRow,
        detail,
        registry,
        signals,
      });
    }),
  );

  const scope = buildScopeReconciliation({
    auditedProjects: projects,
    inventoryByKey,
    discoveredAll,
  });

  return {
    projects: projects.sort((left, right) => left.projectName.localeCompare(right.projectName)),
    scope,
  };
}

export function buildProjectProfileMarkdown(
  project: ProjectIntelligenceRow,
  links: {
    buildSessions?: Array<{ title: string; url: string; date?: string }>;
    research?: Array<{ title: string; url: string }>;
    skills?: Array<{ title: string; url: string }>;
    tools?: Array<{ title: string; url: string }>;
  } = {},
): string {
  const buildSessions = links.buildSessions ?? [];
  const research = links.research ?? [];
  const skills = links.skills ?? [];
  const tools = links.tools ?? [];
  const strategicValue = project.monetizationValue && project.monetizationValue !== project.valueOutcome
    ? project.monetizationValue
    : "";

  const lines = [
    `# ${project.projectName}`,
    "",
    "## Snapshot",
    `- One-line pitch: ${project.oneLinePitch || "Needs review."}`,
    `- Current state: ${project.currentState || "Needs review"}`,
    `- Portfolio call: ${project.portfolioCall || "Needs review"}`,
    `- Momentum: ${project.momentum || "Unknown"}`,
    project.lastActive ? `- Last active: ${project.lastActive}` : "- Last active: Unknown",
    project.buildMaturity ? `- Build maturity: ${project.buildMaturity}` : "",
    project.shipReadiness ? `- Ship readiness: ${project.shipReadiness}` : "",
    project.effortToDemo ? `- Effort to demo: ${project.effortToDemo}` : "",
    project.effortToShip ? `- Effort to ship: ${project.effortToShip}` : "",
    "",
    "## Resume Fast",
    `- Start here: ${project.startHere || "Open the strongest context doc and verify local boot commands."}`,
    `- First file to read: ${project.primaryContextDoc ? `\`${project.primaryContextDoc}\`` : "README or context doc not detected."}`,
    `- First command to run: ${project.primaryRunCommand ? `\`${project.primaryRunCommand}\`` : "Run command needs review."}`,
    `- Setup prerequisites: ${project.setupPrerequisites.length > 0 ? project.setupPrerequisites.join(", ") : "Review repo docs."}`,
    `- Likely blocker: ${project.biggestBlocker || "No blocker captured yet."}`,
    `- Best immediate next task: ${project.nextMove || "Choose the shortest path to a working demo."}`,
    "",
    "## Why It Exists",
    project.problemSolved || "Problem statement not captured yet.",
    "",
    project.primaryUser || project.valueOutcome
      ? "## Product / User Fit"
      : "",
    project.primaryUser ? `- Primary user: ${project.primaryUser}` : "",
    project.valueOutcome ? `- Value / outcome: ${project.valueOutcome}` : "",
    strategicValue ? `- Strategic value: ${strategicValue}` : "",
    "",
    "## Current Reality",
    project.lastMeaningfulWork ? `- Last meaningful work: ${project.lastMeaningfulWork}` : "",
    project.whatWorks ? `- What works: ${project.whatWorks}` : "",
    project.missingCorePieces ? `- Missing core pieces: ${project.missingCorePieces}` : "",
    project.runsLocally ? `- Runs locally: ${project.runsLocally}` : "",
    project.setupFriction ? `- Setup friction: ${project.setupFriction}` : "",
    "",
    "## Technical Footprint",
    `- Stack: ${project.stack || "Needs review"}`,
    project.projectShape.length > 0 ? `- Project shape: ${project.projectShape.join(", ")}` : "",
    project.deploymentSurface.length > 0 ? `- Deployment surface: ${project.deploymentSurface.join(", ")}` : "",
    project.keyIntegrations ? `- Key integrations: ${project.keyIntegrations}` : "",
    `- Docs quality: ${project.docsQuality || "Unknown"}`,
    `- Test posture: ${project.testPosture || "Unknown"}`,
    project.contextDocs.length > 0 ? `- Context docs: ${project.contextDocs.join(", ")}` : "",
    "",
    "## Shipping Path",
    project.nextMove ? `- Next move: ${project.nextMove}` : "",
    project.biggestBlocker ? `- Biggest blocker: ${project.biggestBlocker}` : "",
    project.effortToDemo ? `- Effort to demo: ${project.effortToDemo}` : "",
    project.effortToShip ? `- Effort to ship: ${project.effortToShip}` : "",
    "",
    "## Risks / Unknowns",
    project.knownRisks || project.projectHealthNotes || "No material risk summary captured yet.",
    "",
    "## Linked Activity",
    `- Build sessions: ${formatLinkedItems(buildSessions, (item) => `${item.date ? `${item.date} - ` : ""}${item.title}`)}`,
    `- Related research: ${formatLinkedItems(research, (item) => item.title)}`,
    `- Supporting skills: ${formatLinkedItems(skills, (item) => item.title)}`,
    `- Tool stack records: ${formatLinkedItems(tools, (item) => item.title)}`,
    "",
    "## Evidence",
    `- Local path: \`${project.localPath}\``,
    `- Registry context: ${[project.registryStatus, project.primaryTool, project.contextQuality].filter(Boolean).join(" | ") || "Not captured"}`,
    `- Evidence confidence: ${project.evidenceConfidence || "Unknown"}`,
    project.projectHealthNotes ? `- Health notes: ${project.projectHealthNotes}` : "",
    project.canonicalNotes ? `- Legacy audit note: ${project.canonicalNotes}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export function deriveCurrentState(input: {
  canonicalStatus?: string;
  readiness?: string;
  completion?: string;
  lastActive?: string;
  registryStatus?: string;
  canonicalVerdict?: string;
}): string {
  const status = (input.canonicalStatus ?? "").toLowerCase();
  const readiness = (input.readiness ?? "").toLowerCase();
  const verdict = (input.canonicalVerdict ?? "").toLowerCase();
  const lastActive = input.lastActive ?? "";
  const completion = parseCompletionPercent(input.completion);
  const registry = (input.registryStatus ?? "").toLowerCase();

  if (status.includes("shipped") || readiness.includes("v1 live")) {
    return "Shipped";
  }
  if (status.includes("abandoned") || registry === "archived" || verdict.includes("skip")) {
    return "Archived";
  }
  if (isRecent(lastActive, 14) || registry === "active") {
    return "Active Build";
  }
  if (readiness.includes("ship-ready") || readiness.includes("complete") || (completion ?? 0) >= 90) {
    return "Ready to Demo";
  }
  if (status.includes("handoff")) {
    return "Ready for Review";
  }
  if (registry === "parked") {
    return "Parked";
  }
  return "Needs Decision";
}

export function derivePrimaryRunCommand(input: {
  entryPoint?: string;
  packageScripts?: string[];
  packageManager?: string;
  hasCargoToml?: boolean;
  hasPackageJson?: boolean;
  hasPyproject?: boolean;
  hasTauri?: boolean;
  stack?: string;
  summary?: string;
}): string {
  const text = `${input.stack ?? ""} ${input.summary ?? ""}`.toLowerCase();
  if (input.entryPoint) {
    return input.entryPoint;
  }

  const packageScripts = input.packageScripts ?? [];
  const packageManager = input.packageManager || "npm";
  const preferredScript =
    ["dev:tauri", "tauri:dev", "dev", "start", "desktop", "app", "web"].find((script) => packageScripts.includes(script)) ??
    packageScripts[0];

  if (preferredScript) {
    return `${packageManager} run ${preferredScript}`;
  }
  if (input.hasTauri || text.includes("tauri")) {
    return "cargo tauri dev";
  }
  if (text.includes("godot")) {
    return "Open project.godot in Godot";
  }
  if (text.includes("swiftui") || text.includes("swift")) {
    return "Open the Xcode project and run locally";
  }
  if (input.hasCargoToml) {
    return "cargo run";
  }
  if (input.hasPyproject) {
    return "python -m <module>";
  }
  if (input.hasPackageJson) {
    return `${packageManager} run dev`;
  }
  if (/resume|cover letter|document vault|documents/.test(text)) {
    return "Open the local files directly";
  }
  return "";
}

export function deriveDocsQuality(input: {
  hasReadme: boolean;
  hasAgents: boolean;
  hasClaude: boolean;
  contextDocsCount: number;
}): string {
  if ((input.hasClaude && input.contextDocsCount >= 2) || (input.hasAgents && input.hasClaude)) {
    return "Strong";
  }
  if (input.hasReadme || input.hasAgents || input.hasClaude || input.contextDocsCount >= 1) {
    return "Usable";
  }
  if (input.contextDocsCount > 0) {
    return "Thin";
  }
  return "Missing";
}

export function deriveTestPosture(input: {
  hasTests: boolean;
  completion?: string;
  codeQuality?: string;
}): string {
  const text = `${input.codeQuality ?? ""} ${input.completion ?? ""}`.toLowerCase();
  if (/strong|comprehensive|158|130\+|85\+|44 test|328 tests|33\/33|18\/18|37 tests/i.test(text)) {
    return "Strong";
  }
  if (input.hasTests) {
    return "Some";
  }
  if (text.includes("tests: not yet") || text.includes("tests: low") || text.includes("tests: none")) {
    return "Sparse";
  }
  return "Unknown";
}

function buildProjectRow(input: {
  inventory: InventoryProject;
  workbookRow?: WorkbookRow;
  detail?: DetailEntry;
  registry?: RegistryEntry;
  signals: ProjectSignals;
}): ProjectIntelligenceRow {
  const workbookRow = input.workbookRow;
  const detail = input.detail;
  const registry = input.registry;
  const signals = input.signals;

  const canonicalStatus =
    firstNonEmpty(workbookRow?.Status, deriveFallbackStatus(signals)) ?? "";
  const canonicalPipelineStage =
    firstNonEmpty(workbookRow?.["Pipeline Stage"], deriveFallbackPipelineStage(canonicalStatus)) ?? "";
  const canonicalCategory =
    firstNonEmpty(
      workbookRow?.Category,
      detail?.category,
      deriveFallbackCategory({
        summary: signals.claudeOverview,
        projectName: input.inventory.projectName,
      }),
    ) ?? "";
  const canonicalVerdict =
    firstNonEmpty(
      workbookRow?.Verdict,
      detail?.verdict,
      deriveFallbackVerdict(canonicalStatus, signals.claudeOverview),
    ) ?? "";
  const canonicalNotes = workbookRow?.Notes ?? "";
  const completion = firstNonEmpty(detail?.completion, extractLegacyField(canonicalNotes, "Legacy completion")) ?? "";
  const readiness = firstNonEmpty(detail?.readiness, extractLegacyField(canonicalNotes, "Legacy readiness")) ?? "";
  const canonicalSummary =
    firstNonEmpty(detail?.summary, extractSummaryFromNotes(canonicalNotes), signals.claudeOverview) ?? "";
  const stack =
    firstNonEmpty(
      detail?.stack,
      workbookRow?.Stack,
      inspectStackFromNotes(canonicalNotes),
      signals.claudeTechStack,
    ) ?? "";
  const keyIntegrations = firstNonEmpty(
    detail?.integrations?.join(", "),
    workbookRow?.["Key Integrations"],
    detail?.integration,
  ) ?? "";
  const lastActive = firstNonEmpty(signals.gitLastActive, signals.filesystemLastActive, workbookRow?.["Date Updated"]) ?? "";

  const currentState = deriveCurrentState({
    canonicalStatus,
    readiness,
    completion,
    lastActive,
    registryStatus: registry?.status,
    canonicalVerdict,
  });
  const buildMaturity = deriveBuildMaturity(completion, readiness, currentState);
  const shipReadiness = deriveShipReadiness(readiness, currentState, completion);
  const docsQuality = deriveDocsQuality({
    hasReadme: signals.hasReadme,
    hasAgents: signals.hasAgents,
    hasClaude: signals.hasClaude,
    contextDocsCount: signals.contextDocs.length,
  });
  const testPosture = deriveTestPosture({
    hasTests: signals.hasTests,
    completion,
    codeQuality: detail?.codeQuality,
  });
  const evidenceConfidence = deriveEvidenceConfidence({
    detail,
    docsQuality,
    testPosture,
    hasManifest: signals.hasPackageJson || signals.hasCargoToml || signals.hasPyproject,
  });
  const primaryRunCommand = derivePrimaryRunCommand({
    entryPoint: detail?.entryPoint,
    packageScripts: signals.packageScripts,
    packageManager: signals.packageManager,
    hasCargoToml: signals.hasCargoToml,
    hasPackageJson: signals.hasPackageJson,
    hasPyproject: signals.hasPyproject,
    hasTauri: stack.toLowerCase().includes("tauri"),
    stack,
    summary: canonicalSummary,
  });
  const startHere = buildStartHere(signals.primaryContextDoc, primaryRunCommand, detail?.quickWins, detail?.toMvp);
  const biggestBlocker =
    firstNonEmpty(
      detail?.blocker,
      summarizeMissing(detail?.missing),
      deriveBlockerFromOperational(detail?.operational),
      deriveFallbackBlocker(currentState, canonicalVerdict),
    ) ?? "";
  const nextMove = firstNonEmpty(detail?.toMvp, detail?.quickWins, detail?.toShipReady, deriveFallbackNextMove(primaryRunCommand)) ?? "";
  const oneLinePitch = canonicalSummary || (firstNonEmpty(detail?.problemSolved, detail?.strategicValue) ?? "");
  const momentum = deriveMomentum(lastActive);
  const deploymentSurface = deriveDeploymentSurface(stack, canonicalSummary, input.inventory.sourceGroup);
  const projectShape = deriveProjectShape(canonicalCategory, canonicalSummary, input.inventory.sourceGroup);
  const setupFriction = deriveSetupFriction(detail?.operational, signals);
  const runsLocally = deriveRunsLocally(detail?.operational, currentState, signals);
  const effortToDemo = deriveEffortToDemo(detail?.toMvp, buildMaturity, setupFriction);
  const effortToShip = deriveEffortToShip(detail?.toShipReady, shipReadiness);
  const portfolioCall = derivePortfolioCall(canonicalVerdict, currentState, buildMaturity);
  const valueOutcome = firstNonEmpty(detail?.strategicValue, deriveValueFromCategory(canonicalCategory, canonicalSummary)) ?? "";
  const knownRisks = compactText([
    biggestBlocker,
    extractRiskHints(detail?.missing),
    extractRiskHints(detail?.operational),
  ]);
  const projectHealthNotes = compactText([
    canonicalNotes,
    registry?.notes,
    detail?.codeQuality,
    detail?.operational,
    signals.claudeCurrentPhase ? `Backfilled from CLAUDE.md. ${signals.claudeCurrentPhase}` : "",
  ]);
  const needsReview =
    evidenceConfidence === "Low" ||
    !signals.primaryContextDoc ||
    !primaryRunCommand ||
    input.inventory.projectName.includes("(staging)") ||
    input.inventory.relativePath === "claude-code/production/rag-knowledge-base";

  return {
    projectName: input.inventory.projectName,
    relativePath: input.inventory.relativePath,
    sourceGroup: input.inventory.sourceGroup,
    canonicalStatus,
    canonicalPipelineStage,
    canonicalCategory,
    canonicalVerdict,
    canonicalSummary,
    canonicalNotes,
    canonicalDateUpdated: workbookRow?.["Date Updated"] ?? "",
    currentState,
    portfolioCall,
    oneLinePitch,
    nextMove,
    biggestBlocker,
    momentum,
    lastActive,
    localPath: input.inventory.relativePath,
    stack,
    projectShape,
    deploymentSurface,
    docsQuality,
    testPosture,
    evidenceConfidence,
    needsReview,
    startHere,
    primaryRunCommand,
    primaryContextDoc: signals.primaryContextDoc,
    setupFriction,
    runsLocally,
    lastMeaningfulWork: firstNonEmpty(detail?.whatWorks, deriveLastMeaningfulWork(lastActive, currentState)) ?? "",
    primaryUser: firstNonEmpty(detail?.intendedUser, deriveDefaultUser(canonicalCategory, canonicalSummary)) ?? "",
    problemSolved: firstNonEmpty(detail?.problemSolved, canonicalSummary) ?? "",
    valueOutcome,
    buildMaturity,
    shipReadiness,
    effortToDemo,
    effortToShip,
    monetizationValue: firstNonEmpty(detail?.strategicValue, deriveStrategicValue(canonicalCategory, canonicalSummary)) ?? "",
    keyIntegrations,
    projectHealthNotes,
    knownRisks,
    whatWorks: detail?.whatWorks ?? "",
    missingCorePieces: detail?.missing ?? "",
    registryStatus: registry?.status ?? "",
    primaryTool: registry?.tool ?? "",
    contextQuality: registry?.contextQuality ?? "",
    completion,
    readiness,
    mergedInto: workbookRow?.["Merged Into"] ?? "",
    setupPrerequisites: signals.setupPrerequisites,
    contextDocs: signals.contextDocs,
  };
}

async function loadParsedSources(): Promise<ParsedSources> {
  const [reportText, registryText, workbookRows] = await Promise.all([
    fs.readFile(REPORT_PATH, "utf8"),
    fs.readFile(REGISTRY_PATH, "utf8"),
    loadWorkbookRows(),
  ]);

  const detailEntries = parseDetailSections(reportText);
  return {
    workbookRows: workbookRows,
    detailEntries: detailEntries.byName,
    detailEntriesByPath: detailEntries.byPath,
    registryEntries: parseRegistry(registryText),
  };
}

async function loadWorkbookRows(): Promise<Map<string, WorkbookRow>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.getWorksheet("Projects");
  if (!worksheet) {
    return new Map();
  }

  const headerValues = ((worksheet.getRow(1).values as ExcelJS.CellValue[]) ?? []).slice(1).map((value) => String(value ?? ""));
  const headerIndex = new Map<string, number>();
  headerValues.forEach((header, index) => headerIndex.set(header, index + 1));

  const rows = new Map<string, WorkbookRow>();
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const projectName = String(row.getCell(headerIndex.get("Project Name") ?? 1).value ?? "").trim();
    if (!projectName) {
      continue;
    }
    const record = Object.fromEntries(
      CANONICAL_COLUMNS.map((column) => [column, String(row.getCell(headerIndex.get(column) ?? 1).value ?? "").trim()]),
    ) as WorkbookRow;
    rows.set(normalizeKey(projectName), record);
  }

  return rows;
}

async function discoverInventoryProjects(): Promise<InventoryProject[]> {
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const discovered: InventoryProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith(".") || EXCLUDED_ROOT_NAMES.has(entry.name) || ROOT_GROUPS.has(entry.name)) {
      continue;
    }
    discovered.push({
      projectName: PATH_NAME_OVERRIDES.get(entry.name) ?? entry.name.trim(),
      relativePath: entry.name,
      sourceGroup: "Standalone Projects",
      sourceBucket: "root",
    });
  }

  for (const groupName of GROUP_DIRECTORIES.filter((group) => group !== "GrokPRJs")) {
    const groupPath = path.join(PROJECTS_ROOT, groupName);
    const groupEntries = await safeReadDir(groupPath);
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

async function discoverAllProjectDirectories(): Promise<InventoryProject[]> {
  const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
  const discovered: InventoryProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || EXCLUDED_ROOT_NAMES.has(entry.name)) {
      continue;
    }

    if (entry.name === "claude-code") {
      const ragKbPath = path.posix.join("claude-code", "production", "rag-knowledge-base");
      const ragKbStat = await safeStat(path.join(PROJECTS_ROOT, ragKbPath));
      if (ragKbStat?.isDirectory()) {
        discovered.push({
          projectName: PATH_NAME_OVERRIDES.get(ragKbPath) ?? "RAG Knowledge Base",
          relativePath: ragKbPath,
          sourceGroup: "claude-code",
          sourceBucket: "claude-code",
        });
      }
      continue;
    }

    if (ROOT_GROUPS.has(entry.name)) {
      const groupEntries = await safeReadDir(path.join(PROJECTS_ROOT, entry.name));
      for (const child of groupEntries) {
        if (!child.isDirectory() || child.name.startsWith(".")) {
          continue;
        }
        const relativePath = path.posix.join(entry.name, child.name);
        discovered.push({
          projectName: PATH_NAME_OVERRIDES.get(relativePath) ?? child.name.trim(),
          relativePath,
          sourceGroup: entry.name,
          sourceBucket: entry.name,
        });
      }
      continue;
    }

    discovered.push({
      projectName: PATH_NAME_OVERRIDES.get(entry.name) ?? entry.name.trim(),
      relativePath: entry.name,
      sourceGroup: "Standalone Projects",
      sourceBucket: "root",
    });
  }

  return discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function buildScopeReconciliation(input: {
  auditedProjects: ProjectIntelligenceRow[];
  inventoryByKey: Map<string, InventoryProject>;
  discoveredAll: InventoryProject[];
}): ScopeReconciliation {
  const auditedKeys = new Set(input.auditedProjects.map((project) => normalizeKey(project.projectName)));
  const extraDiscovered: ScopeReconciliationItem[] = [];

  for (const project of input.discoveredAll) {
    const key = normalizeKey(project.projectName);
    if (auditedKeys.has(key)) {
      continue;
    }

    let classification = "Needs review";
    let notes = "Project directory is outside the current audited set.";
    if (project.sourceBucket === "GrokPRJs") {
      classification = "Excluded legacy archive";
      notes = "Legacy Grok-built project kept out of the current audited portfolio.";
    } else if (project.relativePath.includes("ready") || project.relativePath.includes("readiness")) {
      classification = "Staging duplicate";
      notes = "Readiness or staging artifact better tracked under the base project.";
    }

    extraDiscovered.push({
      projectName: project.projectName,
      relativePath: project.relativePath,
      classification,
      notes,
    });
  }

  const unmatchedAudited = input.auditedProjects
    .filter((project) => !input.inventoryByKey.has(normalizeKey(project.projectName)))
    .map((project) => project.projectName);

  return {
    auditedProjectCount: input.auditedProjects.length,
    discoveredDirectoryCount: input.discoveredAll.length,
    matchedProjectCount: input.auditedProjects.length - unmatchedAudited.length,
    extraDiscovered,
    unmatchedAudited,
  };
}

function parseDetailSections(reportText: string): {
  byName: Map<string, DetailEntry>;
  byPath: Map<string, DetailEntry>;
} {
  const lines = reportText.split("\n");
  const byName = new Map<string, DetailEntry>();
  const byPath = new Map<string, DetailEntry>();
  let currentSection = "";
  let currentHeading = "";
  let buffer: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    const detail = parseDetailBlock(currentSection, currentHeading, buffer.join("\n").trim());
    byName.set(normalizeKey(detail.headingName), detail);
    if (detail.relativePath) {
      byPath.set(normalizePathKey(detail.relativePath), detail);
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
  return { byName, byPath };
}

function parseDetailBlock(sectionName: string, heading: string, text: string): DetailEntry {
  const headingName = heading.replace(/^\d+\.?\s+/, "").trim();
  const purposeBlock = extractSectionBlock(text, "Purpose");
  const technicalBlock = extractSectionBlock(text, "Technical Profile");
  const strategicBlock = extractSectionBlock(text, "Strategic Assessment");

  return {
    headingName,
    sectionName,
    relativePath: extractInlineField(text, "Path")?.replace(/^\.\/+/, ""),
    category: extractInlineField(text, "Category"),
    summary: extractInlineField(text, "Summary"),
    problemSolved: firstNonEmpty(
      extractListItem(purposeBlock, "Problem solved"),
      extractInlineField(text, "Purpose"),
    ),
    intendedUser: firstNonEmpty(
      extractListItem(purposeBlock, "Intended user"),
      extractInlineField(text, "Intended user"),
    ),
    strategicValue: firstNonEmpty(
      extractListItem(purposeBlock, "Strategic value"),
      extractInlineField(text, "Strategic value"),
    ),
    stack: firstNonEmpty(extractListItem(technicalBlock, "Stack"), extractInlineField(text, "Stack"), extractInlineField(text, "Technical Profile")),
    architecture: firstNonEmpty(extractListItem(technicalBlock, "Architecture"), extractInlineField(text, "Architecture")),
    integrations: splitCommaList(
      firstNonEmpty(
        extractListItem(technicalBlock, "External integrations"),
        extractInlineField(text, "Integrations"),
      ),
    ),
    aiUsage: firstNonEmpty(extractListItem(technicalBlock, "AI/LLM usage"), extractInlineField(text, "AI/LLM")),
    storage: firstNonEmpty(extractListItem(technicalBlock, "Data storage"), extractInlineField(text, "Storage")),
    entryPoint: firstNonEmpty(extractListItem(technicalBlock, "Entry point"), extractInlineField(text, "Entry")),
    completion: extractInlineField(text, "Completion"),
    readiness: extractInlineField(text, "Readiness"),
    whatWorks: firstNonEmpty(extractInlineField(text, "What works"), extractInlineField(text, "Works")),
    missing: extractInlineField(text, "Missing"),
    toMvp: extractInlineField(text, "To MVP"),
    toShipReady: extractInlineField(text, "To ship-ready"),
    codeQuality: extractInlineField(text, "Code Quality"),
    operational: extractInlineField(text, "Operational"),
    verdict: firstNonEmpty(extractBulletField(strategicBlock, "Verdict"), extractInlineField(text, "Verdict")),
    priority: firstNonEmpty(extractBulletTailField(strategicBlock, "Priority"), extractInlineField(text, "Priority")),
    blocker: firstNonEmpty(extractBulletTailField(strategicBlock, "Blocker"), extractInlineField(text, "Blocker")),
    quickWins: firstNonEmpty(extractBulletTailField(strategicBlock, "Quick wins"), extractInlineField(text, "Quick wins")),
    integration: firstNonEmpty(extractBulletTailField(strategicBlock, "Integration"), extractInlineField(text, "Integration")),
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

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
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

async function inspectProjectSignals(projectPath: string, detail?: DetailEntry): Promise<ProjectSignals> {
  const rootFiles = await safeReadDir(projectPath);
  const filenames = new Set(rootFiles.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const hasReadme = Array.from(filenames).some((name) => /^README/i.test(name));
  const hasAgents = filenames.has("AGENTS.md");
  const hasClaude = filenames.has("CLAUDE.md");
  const hasPackageJson = filenames.has("package.json");
  const hasCargoToml = filenames.has("Cargo.toml") || Boolean(await safeStat(path.join(projectPath, "src-tauri", "Cargo.toml")));
  const hasPyproject = filenames.has("pyproject.toml") || filenames.has("requirements.txt");
  const hasTests = Boolean(
    await safeStat(path.join(projectPath, "tests")) ||
      await safeStat(path.join(projectPath, "test")) ||
      await safeStat(path.join(projectPath, "__tests__")),
  );

  const contextDocs = ["CLAUDE.md", "AGENTS.md", "README.md", "DISCOVERY-SUMMARY.md", "IMPLEMENTATION-ROADMAP.md", "RESUMPTION-PROMPT.md", "HINSITE.md"]
    .filter((name) => filenames.has(name) || Boolean(statExists(path.join(projectPath, name))))
    .map((name) => name);

  const packageJson = hasPackageJson ? await safeReadJson(path.join(projectPath, "package.json")) : null;
  const packageScripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? Object.keys(packageJson.scripts as Record<string, unknown>) : [];
  const packageManager = detectPackageManager(projectPath, packageJson);
  const claudeContext = hasClaude ? await readClaudeContext(path.join(projectPath, "CLAUDE.md")) : emptyClaudeContext();

  const primaryContextDoc = firstNonEmpty(
    contextDocs.find((name) => name === "CLAUDE.md"),
    contextDocs.find((name) => name === "AGENTS.md"),
    contextDocs.find((name) => name === "README.md"),
    contextDocs[0],
  ) ?? "";

  const setupPrerequisites = deriveSetupPrerequisites({
    detail,
    hasPackageJson,
    hasCargoToml,
    hasPyproject,
    packageJson,
  });

  return {
    hasReadme,
    hasAgents,
    hasClaude,
    hasPackageJson,
    hasCargoToml,
    hasPyproject,
    hasTests,
    packageManager,
    packageScripts,
    contextDocs,
    primaryContextDoc,
    claudeOverview: claudeContext.overview,
    claudeCurrentPhase: claudeContext.currentPhase,
    claudeTechStack: claudeContext.techStack,
    primaryRunCommand: "",
    setupPrerequisites,
    gitLastActive: readGitDate(projectPath),
    filesystemLastActive: safeDateFromPath(projectPath),
  };
}

function emptyClaudeContext(): { overview: string; currentPhase: string; techStack: string } {
  return {
    overview: "",
    currentPhase: "",
    techStack: "",
  };
}

async function readClaudeContext(filePath: string): Promise<{ overview: string; currentPhase: string; techStack: string }> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return {
      overview: collapseMarkdownText(extractMarkdownSection(text, "Overview")),
      currentPhase: collapseMarkdownText(extractMarkdownSection(text, "Current Phase")),
      techStack: extractTechStack(extractMarkdownSection(text, "Tech Stack")),
    };
  } catch {
    return emptyClaudeContext();
  }
}

function extractMarkdownSection(text: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function extractTechStack(section: string): string {
  if (!section) {
    return "";
  }

  const bullets = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map((line) => line.replace(/^-+\s*/, "").replace(/\*\*/g, "").trim());

  return bullets.join(", ");
}

function collapseMarkdownText(section: string): string {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("|") && !line.startsWith("-"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveFallbackStatus(signals: ProjectSignals): string | undefined {
  const phase = signals.claudeCurrentPhase.toLowerCase();
  if (/feature complete|v1\.0|phase complete|all 4 phases implemented/.test(phase)) {
    return "Shipped";
  }
  if (/phase 0/.test(phase) && !signals.hasPackageJson && !signals.hasCargoToml && !signals.hasPyproject) {
    return "Planned";
  }
  if (phase || signals.hasPackageJson || signals.hasCargoToml || signals.hasPyproject) {
    return "In Progress";
  }
  return undefined;
}

function deriveFallbackPipelineStage(status: string): string | undefined {
  switch (status) {
    case "Planned":
      return "Implementation Plan";
    case "In Progress":
      return "Building in Claude Code";
    case "Handoff Ready":
      return "Handoff Docs Generated";
    case "Shipped":
      return "Post-Build Review Done";
    default:
      return undefined;
  }
}

function deriveFallbackCategory(input: { summary: string; projectName: string }): string | undefined {
  const text = `${input.projectName} ${input.summary}`.toLowerCase();
  if (/argument|reasoning|decision|llm|chain-of-thought|research synthesis/.test(text)) {
    return "Reasoning Tool";
  }
  if (/log stream|ambient monitoring|claude code build logs|menu bar/.test(text)) {
    return "Dev Tool";
  }
  if (/it\b|ticket|support|incident/.test(text)) {
    return "IT Tool";
  }
  if (/desktop|macos|local-first|overlay|notifications|warranty|return window|deep-work/.test(text)) {
    return "Desktop App";
  }
  return undefined;
}

function deriveFallbackVerdict(status: string, summary: string): string | undefined {
  if (status === "Shipped") {
    return "Strong Candidate";
  }
  if (summary) {
    return "Worth Building";
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveBuildMaturity(completion: string, readiness: string, currentState: string): string {
  const percent = parseCompletionPercent(completion) ?? 0;
  const ready = readiness.toLowerCase();
  if (currentState === "Shipped") {
    return "Shippable";
  }
  if (ready.includes("ship-ready") || percent >= 90) {
    return "Demoable";
  }
  if (percent >= 75) {
    return "Feature Complete";
  }
  if (percent >= 45) {
    return "Functional Core";
  }
  if (percent > 0) {
    return "Scaffolded";
  }
  return "Idea";
}

function deriveShipReadiness(readiness: string, currentState: string, completion: string): string {
  const percent = parseCompletionPercent(completion) ?? 0;
  const ready = readiness.toLowerCase();
  if (currentState === "Shipped") {
    return "Ship-Ready";
  }
  if (ready.includes("ship-ready") || ready.includes("v1 live")) {
    return "Ship-Ready";
  }
  if (ready.includes("feature-complete") || percent >= 85) {
    return "Near Ship";
  }
  if (percent >= 50) {
    return "Needs Hardening";
  }
  return "Not Ready";
}

function derivePortfolioCall(verdict: string, currentState: string, buildMaturity: string): string {
  const normalized = verdict.toLowerCase();
  if (normalized.includes("merged")) {
    return "Merge";
  }
  if (normalized.includes("skip") || currentState === "Archived") {
    return "Archive";
  }
  if (currentState === "Shipped") {
    return "Polish";
  }
  if (buildMaturity === "Demoable" || buildMaturity === "Feature Complete") {
    return "Finish";
  }
  if (normalized.includes("strong") || normalized.includes("worth")) {
    return "Build Now";
  }
  return "Hold";
}

function deriveMomentum(lastActive: string): string {
  if (isRecent(lastActive, 14)) {
    return "Hot";
  }
  if (isRecent(lastActive, 45)) {
    return "Warm";
  }
  return "Cold";
}

function deriveDeploymentSurface(stack: string, summary: string, sourceGroup: string): string[] {
  const text = `${stack} ${summary} ${sourceGroup}`.toLowerCase();
  const values = new Set<string>();
  if (/tauri|swiftui|desktop|menu bar|macos|godot/.test(text)) {
    values.add("Desktop");
  }
  if (/next\.js|react spa|web app|portal|dashboard/.test(text)) {
    values.add("Web");
  }
  if (/fastapi|axum|rest api|backend/.test(text)) {
    values.add("API");
  }
  if (/slack bot|slack bolt|statuspage|bot/.test(text)) {
    values.add("Bot");
  }
  if (/cli/.test(text)) {
    values.add("CLI");
  }
  if (/game|godot|roguelike|dungeon|penguin|ecosystem/.test(text)) {
    values.add("Game");
  }
  if (/library|foundation|reusable/.test(text)) {
    values.add("Library");
  }
  if (/it tool|knowledge management|incident|support/.test(text)) {
    values.add("Internal Tool");
  }
  if (values.size === 0 && /commercial saas|portal|statuspage|resume|document|job/.test(text)) {
    values.add("Web");
  }
  if (values.size === 0 && /utility|desktop|swiftui|swift|tauri/.test(text)) {
    values.add("Desktop");
  }
  if (values.size === 0 && /compliance|ops|internal/.test(text)) {
    values.add("Internal Tool");
  }
  return [...values];
}

function deriveProjectShape(category: string, summary: string, sourceGroup: string): string[] {
  const text = `${category} ${summary} ${sourceGroup}`.toLowerCase();
  const values = new Set<string>();
  if (/commercial|saas|productized|toolkit|dashboard|app/.test(text)) {
    values.add("Product");
  }
  if (/tool|workbench|dashboard|manager|translator|clipboard/.test(text)) {
    values.add("Tool");
  }
  if (/system|foundation|infrastructure|knowledge base/.test(text)) {
    values.add("System");
  }
  if (/experiment|poc|exploration/.test(text)) {
    values.add("Experiment");
  }
  if (/consulting|client/.test(text)) {
    values.add("Client Work");
  }
  if (/game|roguelike|companion|ecosystem|crawler/.test(text) || sourceGroup.includes("Game")) {
    values.add("Game");
  }
  if (/creative|studio|album|visual/.test(text)) {
    values.add("Creative");
  }
  if (values.size === 0) {
    values.add("Tool");
  }
  return [...values];
}

function deriveSetupFriction(operational: string | undefined, signals: ProjectSignals): string {
  const text = (operational ?? "").toLowerCase();
  const ecosystemCount = [signals.hasPackageJson, signals.hasCargoToml, signals.hasPyproject].filter(Boolean).length;
  if (text.includes("simple")) {
    return "Low";
  }
  if (text.includes("moderate-high") || text.includes("high") || ecosystemCount >= 3) {
    return "High";
  }
  if (text.includes("moderate") || ecosystemCount === 2) {
    return "Medium";
  }
  return "Low";
}

function deriveRunsLocally(operational: string | undefined, currentState: string, signals: ProjectSignals): string {
  const text = (operational ?? "").toLowerCase();
  if (text.includes("runs: yes") || text.includes("runs yes") || currentState === "Shipped") {
    return "Yes";
  }
  if (text.includes("partial") || text.includes("runs partially")) {
    return "Partial";
  }
  if (text.includes("likely yes")) {
    return "Likely";
  }
  if (signals.hasPackageJson || signals.hasCargoToml || signals.hasPyproject) {
    return "Unknown";
  }
  return "Unknown";
}

function deriveEffortToDemo(toMvp: string | undefined, buildMaturity: string, setupFriction: string): string {
  const text = (toMvp ?? "").toLowerCase();
  if (/<\s*2|30 min|15 min|20 min|already/.test(text) || buildMaturity === "Demoable") {
    return "<2h";
  }
  if (/1 day|24-36 hrs|24–36 hrs|2-3 hrs/.test(text)) {
    return "1 day";
  }
  if (/2-3 days|2–3 days/.test(text) || buildMaturity === "Feature Complete") {
    return "2-3 days";
  }
  if (/8-12 weeks|week/.test(text) || setupFriction === "High") {
    return "1 week+";
  }
  return buildMaturity === "Functional Core" ? "2-3 days" : "Unknown";
}

function deriveEffortToShip(toShip: string | undefined, shipReadiness: string): string {
  const text = (toShip ?? "").toLowerCase();
  if (/already shipped|already at mvp|already/.test(text) || shipReadiness === "Ship-Ready") {
    return "<1 day";
  }
  if (/2-3 days|30-60 min|one-time/.test(text) || shipReadiness === "Near Ship") {
    return "2-3 days";
  }
  if (/1 week|week/.test(text) || shipReadiness === "Needs Hardening") {
    return "1 week";
  }
  if (/8-12 weeks|2\+ weeks/.test(text) || shipReadiness === "Not Ready") {
    return "2+ weeks";
  }
  return "Unknown";
}

function deriveEvidenceConfidence(input: {
  detail?: DetailEntry;
  docsQuality: string;
  testPosture: string;
  hasManifest: boolean;
}): string {
  const score =
    (input.detail?.problemSolved ? 1 : 0) +
    (input.detail?.whatWorks ? 1 : 0) +
    (input.detail?.missing ? 1 : 0) +
    (input.docsQuality === "Strong" ? 1 : 0) +
    (input.testPosture === "Strong" ? 1 : 0) +
    (input.hasManifest ? 1 : 0);

  if (score >= 5) {
    return "High";
  }
  if (score >= 3) {
    return "Medium";
  }
  return "Low";
}

function buildStartHere(primaryContextDoc: string, primaryRunCommand: string, quickWins?: string, toMvp?: string): string {
  const docPart = primaryContextDoc ? `Open \`${primaryContextDoc}\`` : "Open the strongest available repo doc";
  const commandPart = primaryRunCommand ? `then run \`${primaryRunCommand}\`` : "then confirm the right local boot command";
  const actionPart = firstNonEmpty(quickWins, toMvp) ? `, then tackle: ${firstNonEmpty(quickWins, toMvp)}` : "";
  return `${docPart}, ${commandPart}${actionPart}`.trim();
}

function deriveLastMeaningfulWork(lastActive: string, currentState: string): string {
  if (lastActive) {
    return `Local repository activity observed on ${lastActive}; current state is ${currentState.toLowerCase()}.`;
  }
  return "";
}

function deriveDefaultUser(category: string, summary: string): string {
  const text = `${category} ${summary}`.toLowerCase();
  if (/it tool|incident|support|ticket|kb/.test(text)) {
    return "IT and support operators";
  }
  if (/commercial|saas|startup|founder/.test(text)) {
    return "Small-team operators and founders";
  }
  if (/game|creative|studio|album/.test(text)) {
    return "Self-directed creative users";
  }
  if (/dev tool|translator|rag|spec/.test(text)) {
    return "Developers and technical operators";
  }
  return "Primary user needs review";
}

function deriveValueFromCategory(category: string, summary: string): string {
  const text = `${category} ${summary}`.toLowerCase();
  if (/incident|ticket|kb|support/.test(text)) {
    return "Shortens repetitive operational work and improves response quality.";
  }
  if (/commercial|saas|portal|compliance/.test(text)) {
    return "Can become recurring revenue or portfolio-proof commercial work.";
  }
  if (/game|creative|studio/.test(text)) {
    return "Strong showcase value and a credible portfolio story when polished.";
  }
  if (/dev tool|rag|reasoning|knowledge/.test(text)) {
    return "Reusable technical leverage across multiple future projects.";
  }
  return "";
}

function deriveStrategicValue(category: string, summary: string): string {
  const text = `${category} ${summary}`.toLowerCase();
  if (/commercial|saas|compliance|job|application/.test(text)) {
    return "Commercial upside with strong portfolio proof.";
  }
  if (/incident|support|knowledge/.test(text)) {
    return "Operational leverage across IT-focused tools and workflows.";
  }
  if (/game|creative|studio/.test(text)) {
    return "High showcase value if finished to a presentable demo.";
  }
  if (/foundation|library|reusable/.test(text)) {
    return "Infrastructure leverage across the broader portfolio.";
  }
  return "";
}

function summarizeMissing(missing?: string): string | undefined {
  if (!missing) {
    return undefined;
  }
  const firstClause = missing.split(/[.;]/)[0]?.trim();
  return firstClause || undefined;
}

function deriveBlockerFromOperational(operational?: string): string | undefined {
  if (!operational) {
    return undefined;
  }
  const text = operational.toLowerCase();
  if (text.includes("missing:")) {
    const match = operational.match(/Missing:\s*(.+?)(?:\s+\|\s+|$)/i);
    return match?.[1]?.trim();
  }
  return undefined;
}

function deriveFallbackNextMove(primaryRunCommand: string): string {
  if (!primaryRunCommand) {
    return "Confirm the correct local boot path, then verify the first usable workflow.";
  }
  return `Run ${primaryRunCommand}, verify the happy path, and capture the first blocker.`;
}

function deriveFallbackBlocker(currentState: string, verdict: string): string {
  const state = currentState.toLowerCase();
  const verdictText = verdict.toLowerCase();
  if (state === "archived" || verdictText.includes("skip")) {
    return "No active blocker captured because the current portfolio call is to hold or archive the project.";
  }
  if (state === "needs decision") {
    return "The main blocker is deciding whether this project should be resumed, merged, or parked.";
  }
  if (state === "ready to demo" || state === "ready for review") {
    return "No single blocker is documented; the remaining work appears to be polish, validation, or release prep.";
  }
  return "A specific blocker is not documented yet; rerun the primary workflow and capture the first failure.";
}

function extractRiskHints(text?: string): string {
  if (!text) {
    return "";
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237).trim()}...` : normalized;
}

function deriveSetupPrerequisites(input: {
  detail?: DetailEntry;
  hasPackageJson: boolean;
  hasCargoToml: boolean;
  hasPyproject: boolean;
  packageJson: Record<string, unknown> | null;
}): string[] {
  const values = new Set<string>();
  const text = `${input.detail?.stack ?? ""} ${input.detail?.integrations?.join(", ") ?? ""} ${input.detail?.operational ?? ""}`.toLowerCase();
  if (input.hasPackageJson) {
    values.add("Node.js");
  }
  if (input.hasCargoToml) {
    values.add("Rust toolchain");
  }
  if (input.hasPyproject) {
    values.add("Python");
  }
  if (text.includes("ollama")) {
    values.add("Ollama");
  }
  if (text.includes("docker")) {
    values.add("Docker");
  }
  if (text.includes("postgres")) {
    values.add("PostgreSQL");
  }
  if (text.includes("supabase")) {
    values.add("Supabase project");
  }
  if (text.includes("vercel")) {
    values.add("Vercel or local env vars");
  }
  return [...values];
}

function detectPackageManager(projectPath: string, packageJson: Record<string, unknown> | null): string {
  const packageManager = typeof packageJson?.packageManager === "string" ? packageJson.packageManager : "";
  if (packageManager.startsWith("pnpm")) {
    return "pnpm";
  }
  if (packageManager.startsWith("yarn")) {
    return "yarn";
  }
  if (packageManager.startsWith("bun")) {
    return "bun";
  }
  if (statExists(path.join(projectPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (statExists(path.join(projectPath, "yarn.lock"))) {
    return "yarn";
  }
  if (statExists(path.join(projectPath, "bun.lockb")) || statExists(path.join(projectPath, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function extractSectionBlock(text: string, label: string): string {
  const blockMatch = text.match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z][^\\n]*:\\*\\*|\\n---|$)`));
  return blockMatch?.[1]?.trim() ?? "";
}

function extractInlineField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s+(.+)`));
  return match?.[1]?.replace(/\s+\|\s+\*\*.*$/, "").trim();
}

function extractListItem(block: string, label: string): string | undefined {
  if (!block) {
    return undefined;
  }
  const lineMatch = block.match(new RegExp(`-\\s+${escapeRegExp(label)}:\\s+(.+)`));
  if (lineMatch?.[1]) {
    return lineMatch[1].trim();
  }
  return undefined;
}

function extractBulletField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`-\\s+${escapeRegExp(label)}:\\s+\\*\\*(.+?)\\*\\*`));
  return match?.[1]?.trim();
}

function extractBulletTailField(text: string, label: string): string | undefined {
  const match = text.match(new RegExp(`-\\s+${escapeRegExp(label)}:\\s+(.+)`));
  return match?.[1]?.replace(/\*\*/g, "").trim();
}

function extractSummaryFromNotes(notes: string): string {
  const index = notes.indexOf(" Legacy completion:");
  const base = index >= 0 ? notes.slice(0, index) : notes;
  return base.trim().replace(/\s+\.$/, ".");
}

function inspectStackFromNotes(notes: string): string {
  const match = notes.match(/Stack:\s*(.+?)(?:\.|$)/i);
  return match?.[1]?.trim() ?? "";
}

function extractLegacyField(notes: string, label: string): string {
  const match = notes.match(new RegExp(`${escapeRegExp(label)}:\\s*(.*?)(?=\\.\\s+[A-Z]|$)`));
  return match?.[1]?.trim() ?? "";
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

function splitCommaList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function compactText(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .join(" ");
}

function formatLinkedItems<T extends { title: string; url: string }>(items: T[], label: (item: T) => string): string {
  if (items.length === 0) {
    return "None linked yet";
  }
  return items.map((item) => `[${label(item)}](${item.url})`).join(", ");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9]+/g, "");
}

function normalizePathKey(value: string): string {
  return value.replace(/^\.\/+/, "").replace(/\\/g, "/").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecent(dateString: string, days: number): boolean {
  if (!dateString) {
    return false;
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  const delta = now.getTime() - date.getTime();
  return delta <= days * 24 * 60 * 60 * 1000;
}

function readGitDate(projectPath: string): string {
  if (!statExists(path.join(projectPath, ".git"))) {
    return "";
  }
  try {
    return execFileSync("git", ["log", "-1", "--format=%cs"], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function safeDateFromPath(filePath: string): string {
  try {
    return formatDate(statSync(filePath).mtime);
  } catch {
    return "";
  }
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

async function safeReadDir(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function statExists(filePath: string): boolean {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}
