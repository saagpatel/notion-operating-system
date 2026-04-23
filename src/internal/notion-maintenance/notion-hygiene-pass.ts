import "../../config/load-default-env.js";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isDirectExecution } from "../../cli/legacy.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../../cli/context.js";
import { readJsonFile, writeJsonFile } from "../../utils/files.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH,
  type LocalPortfolioExternalSignalSourceConfig,
  type ManualExternalSignalSeedPlan,
} from "../../notion/local-portfolio-external-signals.js";
import {
  datePropertyValue,
  fetchAllPages,
  relationIds,
  relationValue,
  richTextValue,
  selectValue,
  selectPropertyValue,
  textValue,
  titleValue,
  type DataSourcePageRef,
} from "../../notion/local-portfolio-control-tower-live.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

const execFileAsync = promisify(execFile);
const TODAY = losAngelesToday();
const DEFAULT_OWNER = "saagpatel";
const INTAKE_PROJECTS_DATA_SOURCE_ID = "35e04e4d-bcd8-45c0-b783-238edef210f7";

interface Flags {
  live: boolean;
  owner: string;
  limit?: number;
  today: string;
  config: string;
  sourceConfig: string;
}

interface GitHubRepo {
  name: string;
  isArchived: boolean;
  isFork: boolean;
  url: string;
}

interface RepoAuditPlan {
  repo: GitHubRepo;
  displayName: string;
  identifier: string;
  canonicalProjectTitle: string;
  canonicalSourceTitle: string;
  localMatches: DataSourcePageRef[];
  intakeMatches: DataSourcePageRef[];
  sourceMatches: DataSourcePageRef[];
  canonicalLocal?: DataSourcePageRef;
  duplicateLocals: DataSourcePageRef[];
  duplicateIntakes: DataSourcePageRef[];
  canonicalSource?: DataSourcePageRef;
  duplicateSources: DataSourcePageRef[];
  canonicalSourceNeedsUpdate: boolean;
}

interface ManualSeedUpdate {
  identifier: string;
  title: string;
  localProjectId: string;
  sourceUrl: string;
}

const DISPLAY_NAME_OVERRIDES = new Map<string, string>([
  ["APIReverse", "API Reverse"],
  ["BrowserHistoryVisualizer", "Browser History Visualizer"],
  ["devils-advocate", "Devils Advocate"],
  ["GithubRepoAuditor", "GitHub Repo Auditor"],
  ["HowMoneyMoves", "How Money Moves"],
  ["JSMTicketAnalyticsExport", "JSM Ticket Analytics Export"],
  ["JobMarketHeatmap", "Job Market Heatmap"],
  ["LifeCadenceLedger", "Life Cadence Ledger"],
  ["MCPAudit", "MCP Audit"],
  ["mcpforge", "MCP Forge"],
  ["NetworkDecoder", "Network Decoder"],
  ["NetworkMapper", "Network Mapper"],
  ["NeuralNetwork", "Neural Network"],
  ["notion-operating-system", "Notion Operating System"],
  ["PageDiffBookmark", "Page Diff Bookmark"],
  ["personal-ops", "Personal Ops"],
  ["Pulse-Orbit", "Pulse Orbit"],
  ["RedditSentimentAnalyzer", "Reddit Sentiment Analyzer"],
  ["ScreenshottoDataSelect", "Screenshot to Data Select"],
]);

const EXISTING_PROJECT_ALIASES = new Map<string, string[]>([
  ["FreelanceInvoice", ["FreeLanceInvoice"]],
  ["GhostRoutes", ["Ghost Routes"]],
  ["HowMoneyMoves", ["How Money Moves"]],
  ["IncidentManagement", ["IncidentMgmt"]],
  ["InterruptionResumeStudio", ["Interruption Resume Studio"]],
  ["JSMTicketAnalyticsExport", ["JSM Ticket Analytics Export"]],
  ["KBFreshness", ["KBFreshnessDetector"]],
  ["LifeCadenceLedger", ["Life Cadence Ledger"]],
  ["OrbitMechanics", ["OrbitMechanic"]],
  ["PhantomFrequencies", ["Phantom Frequencies"]],
  ["portfolio-actuation-sandbox", ["Sandbox Local Portfolio Project"]],
  ["Pulse-Orbit", ["Pulse Orbit"]],
  ["seismoscope", ["Seismoscope"]],
  ["signal-noise", ["Signal & Noise"]],
  ["sovereign", ["Sovereign"]],
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (shouldShowHelp(argv)) {
    process.stdout.write(
      renderInternalScriptHelp({
        command: "npm run portfolio-audit:notion-hygiene-pass --",
        description:
          "Audit Notion and GitHub alignment, clean duplicate rows, and repair canonical source links.",
        options: [
          { flag: "--help, -h", description: "Show this help message." },
          { flag: "--live", description: "Apply the hygiene fixes in Notion." },
          { flag: "--owner <login>", description: "GitHub owner or org to audit." },
          { flag: "--limit <n>", description: "Limit the number of repos inspected." },
          { flag: "--today <date>", description: "Override the YYYY-MM-DD date anchor." },
          { flag: "--config <path>", description: "Path to the control-tower config file." },
          {
            flag: "--source-config <path>",
            description: "Path to the external signal source config file.",
          },
        ],
      }),
    );
    return;
  }

  const flags = parseFlags(argv);
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for the Notion hygiene pass");
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sourceConfig = await readJsonFile<LocalPortfolioExternalSignalSourceConfig>(flags.sourceConfig);
  const sdk = createNotionSdkClient(token);
  const api = new DirectNotionClient(token);

  const [repos, localProjects, intakeProjects, sourceRows] = await Promise.all([
    listGitHubRepos(flags.owner, flags.limit),
    fetchAllPages(sdk, config.database.dataSourceId, "Name"),
    fetchAllPages(sdk, INTAKE_PROJECTS_DATA_SOURCE_ID, "Project Name"),
    fetchAllPages(sdk, config.phase5ExternalSignals!.sources.dataSourceId, "Name"),
  ]);

  const plans = repos
    .map((repo) => buildRepoAuditPlan({ repo, owner: flags.owner, localProjects, intakeProjects, sourceRows }))
    .filter((plan) => plan.canonicalLocal || plan.intakeMatches.length > 0 || plan.sourceMatches.length > 0)
    .filter(
      (plan) =>
        plan.duplicateLocals.length > 0 ||
        plan.duplicateIntakes.length > 0 ||
        plan.duplicateSources.length > 0 ||
        plan.canonicalSourceNeedsUpdate,
    );

  const archivedLocalRows: Array<{ title: string; id: string; repo: string }> = [];
  const archivedIntakeRows: Array<{ title: string; id: string; repo: string }> = [];
  const canonicalSourcesUpdated: Array<{ title: string; id: string; repo: string }> = [];
  const duplicateSourcesPaused: Array<{ title: string; id: string; repo: string }> = [];
  const manualSeedUpdates: ManualSeedUpdate[] = [];

  if (flags.live) {
    for (const plan of plans) {
      if (!plan.canonicalLocal) {
        continue;
      }

      for (const page of plan.duplicateLocals) {
        await sdk.pages.update({
          page_id: page.id,
          in_trash: true,
        });
        archivedLocalRows.push({
          title: page.title,
          id: page.id,
          repo: plan.repo.name,
        });
      }

      for (const page of plan.duplicateIntakes) {
        await sdk.pages.update({
          page_id: page.id,
          in_trash: true,
        });
        archivedIntakeRows.push({
          title: page.title,
          id: page.id,
          repo: plan.repo.name,
        });
      }

      const canonicalSource = plan.canonicalSource
        ? await repairCanonicalSource({
            api,
            source: plan.canonicalSource,
            projectId: plan.canonicalLocal.id,
            identifier: plan.identifier,
            sourceTitle: plan.canonicalSourceTitle,
            sourceUrl: plan.repo.url,
            today: flags.today,
          })
        : undefined;

      if (canonicalSource) {
        canonicalSourcesUpdated.push({
          title: plan.canonicalSourceTitle,
          id: canonicalSource.id,
          repo: plan.repo.name,
        });
      }

      for (const source of plan.duplicateSources) {
        await pauseDuplicateSource({
          api,
          source,
          canonicalTitle: plan.canonicalSourceTitle,
        });
        duplicateSourcesPaused.push({
          title: source.title,
          id: source.id,
          repo: plan.repo.name,
        });
      }

      manualSeedUpdates.push({
        identifier: plan.identifier,
        title: plan.canonicalSourceTitle,
        localProjectId: plan.canonicalLocal.id,
        sourceUrl: plan.repo.url,
      });
    }

    if (manualSeedUpdates.length > 0) {
      await syncManualSeeds({
        config: sourceConfig,
        filePath: flags.sourceConfig,
        updates: manualSeedUpdates,
      });
    }
  }

  const output = {
    ok: true,
    live: flags.live,
    owner: flags.owner,
    repoCount: repos.length,
    plannedRepoCount: plans.length,
    archiveLocalCount: plans.reduce((total, plan) => total + plan.duplicateLocals.length, 0),
    archiveIntakeCount: plans.reduce((total, plan) => total + plan.duplicateIntakes.length, 0),
    pauseSourceCount: plans.reduce((total, plan) => total + plan.duplicateSources.length, 0),
    canonicalSourceRepairCount: plans.filter((plan) => plan.canonicalSourceNeedsUpdate).length,
    plans: plans.map((plan) => ({
      repo: plan.repo.name,
      canonicalProjectTitle: plan.canonicalProjectTitle,
      canonicalSourceTitle: plan.canonicalSourceTitle,
      canonicalLocal: plan.canonicalLocal
        ? {
            title: plan.canonicalLocal.title,
            id: plan.canonicalLocal.id,
          }
        : null,
      duplicateLocals: plan.duplicateLocals.map((page) => ({ title: page.title, id: page.id })),
      duplicateIntakes: plan.duplicateIntakes.map((page) => ({ title: page.title, id: page.id })),
      canonicalSource: plan.canonicalSource
        ? {
            title: plan.canonicalSource.title,
            id: plan.canonicalSource.id,
          }
        : null,
      duplicateSources: plan.duplicateSources.map((page) => ({ title: page.title, id: page.id })),
      canonicalSourceNeedsUpdate: plan.canonicalSourceNeedsUpdate,
    })),
    archivedLocalRows,
    archivedIntakeRows,
    canonicalSourcesUpdated,
    duplicateSourcesPaused,
    syncedManualSeeds: manualSeedUpdates.map((entry) => entry.identifier),
  };

  recordCommandOutputSummary(output);
  console.log(JSON.stringify(output, null, 2));
}

function parseFlags(argv: string[]): Flags {
  let live = false;
  let owner = DEFAULT_OWNER;
  let limit: number | undefined;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let sourceConfig = DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--owner") {
      owner = argv[index + 1] ?? owner;
      index += 1;
      continue;
    }
    if (current === "--limit") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new AppError("Expected a numeric value after --limit");
      }
      limit = Number(raw);
      index += 1;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
      continue;
    }
    if (current === "--config") {
      config = argv[index + 1] ?? config;
      index += 1;
      continue;
    }
    if (current === "--source-config") {
      sourceConfig = argv[index + 1] ?? sourceConfig;
      index += 1;
    }
  }

  return {
    live,
    owner,
    limit,
    today,
    config,
    sourceConfig,
  };
}

function buildRepoAuditPlan(input: {
  repo: GitHubRepo;
  owner: string;
  localProjects: DataSourcePageRef[];
  intakeProjects: DataSourcePageRef[];
  sourceRows: DataSourcePageRef[];
}): RepoAuditPlan {
  const displayName = displayNameForRepo(input.repo.name);
  const identifier = `${input.owner}/${input.repo.name}`;
  const candidates = buildProjectCandidates(input.repo.name, displayName);

  const localMatches = findAllMatches(input.localProjects, candidates);
  const intakeMatches = findAllMatches(input.intakeProjects, candidates);
  const sourceMatches = findSourceMatches(input.sourceRows, input.owner, input.repo.name, displayName);
  const canonicalLocal = chooseCanonicalLocal(localMatches, intakeMatches, sourceMatches, displayName);
  const canonicalProjectTitle = canonicalLocal?.title ?? displayName;
  const preferredSourceTitle = `${canonicalProjectTitle} - GitHub Repo`;
  const duplicateLocals = canonicalLocal
    ? localMatches.filter((page) => page.id !== canonicalLocal.id && shouldArchiveProjectDuplicate(page, canonicalLocal))
    : [];
  const duplicateIntakes = canonicalLocal
    ? intakeMatches.filter((page) => shouldArchiveProjectDuplicate(page, canonicalLocal))
    : [];
  const canonicalSource =
    sourceMatches.find((page) => page.title === preferredSourceTitle) ??
    chooseCanonicalSource(sourceMatches, identifier, canonicalLocal?.id, input.repo.url);
  const canonicalSourceTitle = determineCanonicalSourceTitle({
    repoName: input.repo.name,
    displayName,
    canonicalLocalTitle: canonicalLocal?.title,
    canonicalSource,
    sourceMatches,
  });
  const duplicateSources = canonicalSource
    ? sourceMatches.filter((page) => page.id !== canonicalSource.id && shouldPauseSourceDuplicate(page, identifier))
    : [];

  return {
    repo: input.repo,
    displayName,
    identifier,
    canonicalProjectTitle,
    canonicalSourceTitle,
    localMatches,
    intakeMatches,
    sourceMatches,
    canonicalLocal,
    duplicateLocals,
    duplicateIntakes,
    canonicalSource,
    duplicateSources,
    canonicalSourceNeedsUpdate: Boolean(
      canonicalLocal &&
        canonicalSource &&
        sourceNeedsUpdate(canonicalSource, canonicalSourceTitle, identifier, canonicalLocal.id, input.repo.url),
    ),
  };
}

function buildProjectCandidates(repoName: string, displayName: string): string[] {
  const aliases = EXISTING_PROJECT_ALIASES.get(repoName) ?? [];
  return uniqueStrings([repoName, displayName, ...aliases]);
}

function findAllMatches(pages: DataSourcePageRef[], candidates: string[]): DataSourcePageRef[] {
  const normalizedCandidates = new Set(candidates.map(normalizeKey));
  return pages.filter((page) => normalizedCandidates.has(normalizeKey(page.title)));
}

function findSourceMatches(
  pages: DataSourcePageRef[],
  owner: string,
  repoName: string,
  displayName: string,
): DataSourcePageRef[] {
  const identifier = `${owner}/${repoName}`;
  const candidates = new Set([
    normalizeKey(identifier),
    normalizeKey(`${displayName} - GitHub Repo`),
    normalizeKey(`${displayName} GitHub Repo`),
    normalizeKey(`${repoName} - GitHub Repo`),
    normalizeKey(`${repoName} GitHub Repo`),
    normalizeKey(displayName),
    normalizeKey(repoName),
  ]);

  return pages.filter((page) => {
    const titleKey = normalizeKey(page.title);
    const identifierKey = normalizeKey(textValue(page.properties.Identifier));
    return candidates.has(titleKey) || candidates.has(identifierKey);
  });
}

function chooseCanonicalLocal(
  localMatches: DataSourcePageRef[],
  intakeMatches: DataSourcePageRef[],
  sourceMatches: DataSourcePageRef[],
  canonicalTitle: string,
): DataSourcePageRef | undefined {
  const pages = [...localMatches];
  if (pages.length === 0) {
    return undefined;
  }

  return [...pages].sort((left, right) => {
    const scoreDiff =
      scoreLocalPage(right, intakeMatches, sourceMatches, canonicalTitle) -
      scoreLocalPage(left, intakeMatches, sourceMatches, canonicalTitle);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return compareCreatedTime(left.createdTime, right.createdTime);
  })[0];
}

function scoreLocalPage(
  page: DataSourcePageRef,
  intakeMatches: DataSourcePageRef[],
  sourceMatches: DataSourcePageRef[],
  canonicalTitle: string,
): number {
  let score = 0;
  if (normalizeKey(page.title) === normalizeKey(canonicalTitle)) {
    score += 100;
  }
  if (!hasQualifier(page.title)) {
    score += 40;
  }
  if (isLegacyDuplicateTitle(page.title)) {
    score -= 200;
  }
  if (isNonCanonicalQualifiedTitle(page.title)) {
    score -= 120;
  }
  if (sourceMatches.some((source) => relationIds(source.properties["Local Project"]).includes(page.id))) {
    score += 250;
  }
  if (intakeMatches.some((intake) => normalizeKey(intake.title) === normalizeKey(page.title))) {
    score += 20;
  }
  score += relationIds(page.properties["Build Sessions"]).length * 15;
  score += relationIds(page.properties["Related Research"]).length * 8;
  score += relationIds(page.properties["Supporting Skills"]).length * 8;
  score += relationIds(page.properties["Tool Stack Records"]).length * 8;
  score += filledTextScore(textValue(page.properties["One-Line Pitch"]), 20);
  score += filledTextScore(textValue(page.properties["Next Move"]), 15);
  score += filledTextScore(textValue(page.properties["Biggest Blocker"]), 10);
  score += filledTextScore(textValue(page.properties["Value / Outcome"]), 15);
  score += filledTextScore(textValue(page.properties["Start Here"]), 10);
  score += selectValue(page.properties["Current State"]) ? 12 : 0;
  score += selectValue(page.properties["Portfolio Call"]) ? 8 : 0;
  return score;
}

function chooseCanonicalSource(
  sourceMatches: DataSourcePageRef[],
  identifier: string,
  canonicalLocalId: string | undefined,
  sourceUrl: string,
): DataSourcePageRef | undefined {
  if (sourceMatches.length === 0) {
    return undefined;
  }

  return [...sourceMatches].sort((left, right) => {
    const scoreDiff =
      scoreSourcePage(right, identifier, canonicalLocalId, sourceUrl) -
      scoreSourcePage(left, identifier, canonicalLocalId, sourceUrl);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return compareCreatedTime(left.createdTime, right.createdTime);
  })[0];
}

function scoreSourcePage(
  page: DataSourcePageRef,
  identifier: string,
  canonicalLocalId: string | undefined,
  sourceUrl: string,
): number {
  let score = 0;
  if (normalizeKey(textValue(page.properties.Identifier)) === normalizeKey(identifier)) {
    score += 250;
  }
  if (canonicalLocalId && relationIds(page.properties["Local Project"]).includes(canonicalLocalId)) {
    score += 120;
  }
  if (selectValue(page.properties.Status) === "Active") {
    score += 50;
  }
  if ((page.properties["Source URL"]?.url ?? "").trim() === sourceUrl) {
    score += 25;
  }
  if (isLegacyDuplicateTitle(page.title)) {
    score -= 200;
  }
  if (isRawIdentifierTitle(page.title)) {
    score -= 120;
  }
  if (hasCanonicalSourceSuffix(page.title)) {
    score += 40;
  }
  return score;
}

function determineCanonicalSourceTitle(input: {
  repoName: string;
  displayName: string;
  canonicalLocalTitle?: string;
  canonicalSource?: DataSourcePageRef;
  sourceMatches: DataSourcePageRef[];
}): string {
  const fallbackBaseTitle = input.canonicalLocalTitle ?? input.displayName;
  const localBasedTitle = `${fallbackBaseTitle} - GitHub Repo`;

  if (input.sourceMatches.some((page) => page.title === localBasedTitle)) {
    return localBasedTitle;
  }

  if (!input.canonicalSource) {
    return localBasedTitle;
  }

  if (isLegacyDuplicateTitle(input.canonicalSource.title) || isRawIdentifierTitle(input.canonicalSource.title)) {
    return localBasedTitle;
  }

  if (
    input.sourceMatches.length > 1 &&
    input.sourceMatches.some((page) => page.title === localBasedTitle) &&
    input.canonicalSource.title !== localBasedTitle
  ) {
    return localBasedTitle;
  }

  return input.canonicalSource.title;
}

function shouldArchiveProjectDuplicate(page: DataSourcePageRef, canonicalPage: DataSourcePageRef): boolean {
  if (page.id === canonicalPage.id) {
    return false;
  }
  if (normalizeKey(page.title) !== normalizeKey(canonicalPage.title)) {
    return false;
  }
  if (isNonCanonicalQualifiedTitle(page.title)) {
    return false;
  }
  if (isLegacyDuplicateTitle(page.title)) {
    return true;
  }
  return !hasQualifier(page.title) && !hasQualifier(canonicalPage.title);
}

function shouldPauseSourceDuplicate(page: DataSourcePageRef, identifier: string): boolean {
  if (selectValue(page.properties.Status) === "Paused") {
    return false;
  }
  return (
    normalizeKey(textValue(page.properties.Identifier)) === normalizeKey(identifier) ||
    isLegacyDuplicateTitle(page.title) ||
    isRawIdentifierTitle(page.title) ||
    hasCanonicalSourceSuffix(page.title)
  );
}

function sourceNeedsUpdate(
  page: DataSourcePageRef,
  canonicalTitle: string,
  identifier: string,
  canonicalLocalId: string,
  sourceUrl: string,
): boolean {
  return (
    page.title !== canonicalTitle ||
    textValue(page.properties.Identifier) !== identifier ||
    !relationIds(page.properties["Local Project"]).includes(canonicalLocalId) ||
    selectValue(page.properties.Status) !== "Active" ||
    (page.properties["Source URL"]?.url ?? "") !== sourceUrl
  );
}

async function repairCanonicalSource(input: {
  api: DirectNotionClient;
  source: DataSourcePageRef;
  projectId: string;
  identifier: string;
  sourceTitle: string;
  sourceUrl: string;
  today: string;
}): Promise<{ id: string; url: string }> {
  await input.api.updatePageProperties({
    pageId: input.source.id,
    properties: {
      Name: titleValue(input.sourceTitle),
      "Local Project": relationValue([input.projectId]),
      Provider: selectPropertyValue("GitHub"),
      "Source Type": selectPropertyValue("Repo"),
      Status: selectPropertyValue("Active"),
      Environment: selectPropertyValue("N/A"),
      "Sync Strategy": selectPropertyValue("Poll"),
      Identifier: richTextValue(input.identifier),
      "Source URL": { url: input.sourceUrl },
      "Last Synced At": datePropertyValue(input.today),
    },
  });
  await input.api.patchPageMarkdown({
    pageId: input.source.id,
    command: "replace_content",
    newMarkdown: renderCanonicalSourceMarkdown(input.sourceTitle, input.identifier, input.sourceUrl),
  });
  return {
    id: input.source.id,
    url: input.source.url,
  };
}

async function pauseDuplicateSource(input: {
  api: DirectNotionClient;
  source: DataSourcePageRef;
  canonicalTitle: string;
}): Promise<void> {
  await input.api.updatePageProperties({
    pageId: input.source.id,
    properties: {
      Status: selectPropertyValue("Paused"),
      Environment: selectPropertyValue("N/A"),
      "Sync Strategy": selectPropertyValue("Poll"),
      "Last Synced At": { date: null },
    },
  });
  await input.api.patchPageMarkdown({
    pageId: input.source.id,
    command: "replace_content",
    newMarkdown: [
      `# ${input.source.title}`,
      "",
      "- Status: Paused",
      `- Canonical repo source: ${input.canonicalTitle}`,
      "",
      "This duplicate GitHub source row was paused during the Notion hygiene pass so one canonical repo mapping stays active.",
    ].join("\n"),
  });
}

function renderCanonicalSourceMarkdown(title: string, identifier: string, sourceUrl: string): string {
  return [
    `# ${title}`,
    "",
    "- Provider: GitHub",
    "- Source type: Repo",
    "- Status: Active",
    `- Identifier: ${identifier}`,
    `- Source URL: ${sourceUrl}`,
    "",
    "This row is the canonical GitHub repo mapping maintained by the Notion hygiene pass.",
  ].join("\n");
}

async function syncManualSeeds(input: {
  config: LocalPortfolioExternalSignalSourceConfig;
  filePath: string;
  updates: ManualSeedUpdate[];
}): Promise<void> {
  const updateByIdentifier = new Map<string, ManualSeedUpdate>(
    input.updates.map((entry) => [entry.identifier, entry]),
  );
  const nextSeeds = input.config.manualSeeds.map((seed) => {
    if (!seed.identifier) {
      return seed;
    }
    const update = updateByIdentifier.get(seed.identifier);
    if (!update) {
      return seed;
    }
    const nextSeed: ManualExternalSignalSeedPlan = {
      ...seed,
      title: update.title,
      localProjectId: update.localProjectId,
      provider: "GitHub",
      sourceType: "Repo",
      status: "Active",
      environment: "N/A",
      syncStrategy: "Poll",
      sourceUrl: update.sourceUrl,
    };
    return nextSeed;
  });

  await writeJsonFile(input.filePath, {
    ...input.config,
    manualSeeds: nextSeeds,
  });
}

async function listGitHubRepos(owner: string, limit?: number): Promise<GitHubRepo[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["repo", "list", owner, "--limit", String(limit ?? 200), "--json", "name,isArchived,isFork,url"],
    {
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const repos = JSON.parse(stdout) as GitHubRepo[];
  return repos.filter((repo) => !repo.isArchived && !repo.isFork);
}

function displayNameForRepo(repoName: string): string {
  const override = DISPLAY_NAME_OVERRIDES.get(repoName);
  if (override) {
    return override;
  }

  const withSpaces = repoName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();

  return withSpaces
    .split(/\s+/)
    .map((part) => (part === part.toUpperCase() ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ")
    .replace(/\bGithub\b/g, "GitHub");
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\(.*?\)/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function filledTextScore(value: string, points: number): number {
  return value.trim().length > 0 ? points : 0;
}

function hasQualifier(title: string): boolean {
  return /\(.+?\)/.test(title);
}

function isLegacyDuplicateTitle(title: string): boolean {
  return /\blegacy\b|\bduplicate\b/i.test(title);
}

function isNonCanonicalQualifiedTitle(title: string): boolean {
  if (!hasQualifier(title)) {
    return false;
  }
  return !/\((legacy import|legacy)\)/i.test(title);
}

function isRawIdentifierTitle(title: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(title);
}

function hasCanonicalSourceSuffix(title: string): boolean {
  return / - GitHub Repo$/.test(title);
}

function compareCreatedTime(left: string | undefined, right: string | undefined): number {
  const leftTime = left ? new Date(left).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right ? new Date(right).getTime() : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((error) => {
    const message = toErrorMessage(error);
    console.error(message);
    process.exit(1);
  });
}
