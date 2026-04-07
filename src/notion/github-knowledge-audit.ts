import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH,
  type LocalPortfolioExternalSignalSourceConfig,
} from "./local-portfolio-external-signals.js";
import {
  dateValue,
  datePropertyValue,
  fetchAllPages,
  multiSelectValue,
  numberValue,
  type NotionPageProperty,
  relationIds,
  relationValue,
  richTextValue,
  selectPropertyValue,
  selectValue,
  textValue,
  titleValue,
  titleFromProperty,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const execFileAsync = promisify(execFile);
const TODAY = losAngelesToday();
const DEFAULT_OWNER = "saagpatel";
const DEFAULT_REPO_LIMIT = 200;

const CANONICAL_TOOL_PAGE_IDS = new Map<string, string>([
  ["Ollama", "326c21f1-caf0-81f6-8558-ef78d04f60cb"],
]);

export interface GitHubKnowledgeAuditFlags {
  live: boolean;
  owner: string;
  limit: number;
  today: string;
  config: string;
  sourceConfig: string;
}

interface GitHubRepo {
  name: string;
  description: string;
  url: string;
  isArchived: boolean;
  isFork: boolean;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  primaryLanguage: string;
  topics: string[];
}

interface RepoHighlight {
  repoName: string;
  insight: string;
}

interface SkillSeedDefinition {
  title: string;
  category: string;
  reviewCadence: string;
  projectRelevance: string;
  status: string;
  proofTypes: string[];
  proficiency: number;
  summary: string;
  notes: string;
  repoHighlights: RepoHighlight[];
}

interface ResearchSeedDefinition {
  title: string;
  category: string;
  summary: string;
  keyFindings: string;
  actionable: string;
  confidence: string;
  tags: string[];
  relatedToolTitles: string[];
  researchType: string;
  decisionImpact: string;
  revalidationCadence: string;
  whyItMatters: string[];
  repoHighlights: RepoHighlight[];
}

interface ToolSeedDefinition {
  title: string;
  website: string;
  pricingModel: string;
  whatIPay: string;
  delightScore: number;
  platform: string[];
  stackIntegration: string[];
  myRole: string;
  oneLiner: string;
  whatFrustrates: string;
  comparedTo: string;
  whatDelights: string;
  subscriptionTier: string;
  tags: string[];
  status: string;
  category: string;
  myUseCases: string;
  utilityScore: number;
  repoHighlights: RepoHighlight[];
}

interface ExistingToolLinkDefinition {
  title: string;
  oneLiner: string;
  myUseCases: string;
  repoHighlights: RepoHighlight[];
}

interface ResolvedSkillSeed {
  definition: SkillSeedDefinition;
  projectIds: string[];
  projectTitles: string[];
  lastPracticed: string;
  markdown: string;
}

interface ResolvedResearchSeed {
  definition: ResearchSeedDefinition;
  projectIds: string[];
  projectTitles: string[];
  sourceUrls: string[];
  markdown: string;
}

interface ResolvedToolSeed {
  definition: ToolSeedDefinition;
  projectIds: string[];
  projectTitles: string[];
  dateFirstUsed: string;
  markdown: string;
}

interface ExistingToolLinkPlan {
  title: string;
  projectIds: string[];
  projectTitles: string[];
  repoNames: string[];
  oneLiner: string;
  myUseCases: string;
  markdown: string;
}

interface UpsertResult {
  title: string;
  id: string;
  url: string;
  existed: boolean;
  action: "created" | "refreshed" | "unchanged";
  changedProperties: string[];
  markdownChanged: boolean;
}

interface RelationUpdatePlan {
  projectId: string;
  projectTitle: string;
  researchIds: string[];
  skillIds: string[];
  toolIds: string[];
}

const SKILL_SEEDS: SkillSeedDefinition[] = [
  {
    title: "Anthropic API Integration",
    category: "AI / LLM",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 79,
    summary:
      "Portfolio repos now show a repeatable pattern of integrating Claude through the Anthropic API for generation, classification, and prompt experimentation.",
    notes:
      "Grounded in live GitHub README evidence from ContentEngine, BrowserHistoryVisualizer, and prompt-englab.",
    repoHighlights: [
      {
        repoName: "ContentEngine",
        insight:
          "Uses the Anthropic Claude API for six-format content generation with local-first storage and spend-aware usage tracking.",
      },
      {
        repoName: "BrowserHistoryVisualizer",
        insight:
          "Uses optional Anthropic classification to label browsing history without sending the raw history corpus to a hosted dashboard.",
      },
      {
        repoName: "prompt-englab",
        insight:
          "Treats Anthropic as a first-class provider alongside OpenAI and Ollama inside a prompt workbench with versioning, tests, and cost visibility.",
      },
    ],
  },
  {
    title: "Axum",
    category: "Backend",
    reviewCadence: "Quarterly",
    projectRelevance: "Useful",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 68,
    summary:
      "Hosted portfolio work now includes an Axum-based production architecture instead of staying entirely in desktop and Python lanes.",
    notes:
      "Grounded in the StatusPage repo README and stack declaration.",
    repoHighlights: [
      {
        repoName: "StatusPage",
        insight:
          "Runs the API and monitoring backend in Rust with Axum 0.8 while pairing it with a Next.js frontend and Postgres-backed monitoring loop.",
      },
    ],
  },
  {
    title: "Chrome Extension Development",
    category: "Frontend",
    reviewCadence: "Quarterly",
    projectRelevance: "Useful",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 66,
    summary:
      "The repo set now includes browser-native utility work built as a Manifest V3 Chrome extension instead of only desktop and web app surfaces.",
    notes:
      "Grounded in the PageDiffBookmark README and extension stack.",
    repoHighlights: [
      {
        repoName: "PageDiffBookmark",
        insight:
          "Implements a Chrome Manifest V3 extension with a service worker, side panel UI, diffing pipeline, and chrome.storage.local persistence.",
      },
    ],
  },
  {
    title: "Local-First Product Design",
    category: "Architecture",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 83,
    summary:
      "A major recurring portfolio pattern is local-first product design: keep user data on-device, add cloud calls only where they create clear value, and preserve useful offline fallbacks.",
    notes:
      "Grounded across multiple active repos that explicitly describe privacy-first or local-first operating rules.",
    repoHighlights: [
      {
        repoName: "IncidentManagement",
        insight:
          "Frames the entire app as a local-first macOS desktop workflow with offline incident data and optional local AI analysis.",
      },
      {
        repoName: "ContentEngine",
        insight:
          "Keeps source material, history, and brand profiles on-device and only leaves the machine for Claude generation calls.",
      },
      {
        repoName: "LoreKeeper",
        insight:
          "Uses local state, optional local LLM narration, and strong template fallbacks so the experience still works when no model is available.",
      },
      {
        repoName: "LifeCadenceLedger",
        insight:
          "Defines the product direction as a cadence ledger that is explicitly local-first and cloud-optional from the start.",
      },
    ],
  },
  {
    title: "PDF Export Pipelines",
    category: "Backend",
    reviewCadence: "Quarterly",
    projectRelevance: "Useful",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 74,
    summary:
      "Multiple repos now treat exportable PDF artifacts as part of the real product surface rather than as a later add-on.",
    notes:
      "Grounded in ContentEngine and IncidentManagement export workflows.",
    repoHighlights: [
      {
        repoName: "IncidentManagement",
        insight:
          "Generates leadership-ready DOCX and PDF incident review reports directly from the Rust desktop backend.",
      },
      {
        repoName: "ContentEngine",
        insight:
          "Exports a six-format content repurposing bundle into a single shareable PDF from the local desktop app.",
      },
    ],
  },
  {
    title: "Prompt Evaluation & Versioning",
    category: "AI / LLM",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Hands-on", "Production Use"],
    proficiency: 77,
    summary:
      "Prompt work in the portfolio now looks like real product engineering: versions, named tests, diffing, A/B comparison, and cost visibility.",
    notes:
      "Grounded in the prompt-englab repo README and feature set.",
    repoHighlights: [
      {
        repoName: "prompt-englab",
        insight:
          "Tracks prompt versions with word-level diffs, template variables, test cases, A/B response comparison, and provider cost dashboards in one local workbench.",
      },
    ],
  },
];

const RESEARCH_SEEDS: ResearchSeedDefinition[] = [
  {
    title: "Multi-Provider Prompt Workbenches Need Versioning, Test Cases, and Cost Visibility",
    category: "AI / LLM",
    summary:
      "Prompt tooling becomes materially more trustworthy when it treats prompt changes like product changes: version them, test them, compare outcomes, and watch spend.",
    keyFindings:
      "The repo evidence shows that multi-provider prompting quickly creates evaluation and spend problems unless the workbench includes explicit version history, named test cases, side-by-side comparison, and cost reporting.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["prompt-engineering", "evaluation", "github"],
    relatedToolTitles: ["Anthropic API", "Ollama"],
    researchType: "Technical Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This is the strongest current evidence in the portfolio for treating prompt iteration like software delivery instead of ad hoc prompting.",
      "It also supports future tooling decisions around regression testing, provider switching, and spend control.",
    ],
    repoHighlights: [
      {
        repoName: "prompt-englab",
        insight:
          "The product pairs multi-provider execution with version history, named test cases, A/B comparison, and pricing dashboards in one local workflow.",
      },
    ],
  },
  {
    title: "Privacy-First Desktop AI Apps Work Best With Cloud Generation and Optional Local Analysis",
    category: "AI / LLM",
    summary:
      "The strongest recurring AI product pattern in the repos is not 'all local' or 'all cloud' but a privacy-first hybrid: keep user data and workflow state local, then use the model surface that fits the task.",
    keyFindings:
      "Content generation is handled well with hosted APIs, while sensitive analysis and fallback narration often work best through optional local models or fully local state management.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["desktop", "privacy", "ai"],
    relatedToolTitles: ["Anthropic API", "Ollama"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This pattern now shows up across multiple products, which makes it more like a portfolio doctrine than a one-off implementation choice.",
      "It is useful for future scoping because it clarifies when cloud AI is worth the dependency and when local-first design should stay the default.",
    ],
    repoHighlights: [
      {
        repoName: "ContentEngine",
        insight:
          "Keeps content, history, and brand profiles local while using Claude API calls only for the generation step.",
      },
      {
        repoName: "BrowserHistoryVisualizer",
        insight:
          "Keeps browsing history local and treats Anthropic classification as an optional enhancement instead of a hard dependency.",
      },
      {
        repoName: "IncidentManagement",
        insight:
          "Uses local Ollama analysis for incident clustering so operational data can stay on-device.",
      },
      {
        repoName: "LoreKeeper",
        insight:
          "Uses optional Ollama narration with deterministic fallbacks so the product still functions cleanly without a live model.",
      },
    ],
  },
  {
    title: "Local Incident Tools Converge on Jira Context, Post-Mortems, and Exportable Reviews",
    category: "Operations",
    summary:
      "The incident-management repos point toward a clear product cluster: bring Jira context into a local workflow, structure post-mortems, and make exportable review artifacts easy.",
    keyFindings:
      "Across the repos, the differentiator is not raw ticket CRUD. It is the combination of local troubleshooting context, structured incident review flows, and polished exported outputs for handoffs or leadership review.",
    actionable: "Yes - Immediate",
    confidence: "High",
    tags: ["incident-management", "jira", "operations"],
    relatedToolTitles: ["Jira Service Management", "Ollama", "GitHub"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    whyItMatters: [
      "This cluster creates a clearer product lane for support and operations work than looking at each repo in isolation.",
      "It also suggests that export quality and review readiness are part of the core value proposition, not optional polish.",
    ],
    repoHighlights: [
      {
        repoName: "TicketHandoff",
        insight:
          "Pulls Jira ticket context into a local support workflow and posts structured escalation notes back to Jira.",
      },
      {
        repoName: "IncidentManagement",
        insight:
          "Focuses on blameless post-mortems, AI trend detection, and exportable DOCX/PDF review packets for leadership use.",
      },
      {
        repoName: "StatusPage",
        insight:
          "Carries incident-management ideas into a hosted product with incident timelines, service impact, and notification workflows.",
      },
    ],
  },
  {
    title: "Focused Chrome Extensions Are a Fast Way to Ship Browser Utilities",
    category: "Engineering",
    summary:
      "The repo evidence suggests that small browser utilities can ship effectively as focused Chrome extensions without requiring a heavier web or desktop shell.",
    keyFindings:
      "For narrow monitoring and utility workflows, a Manifest V3 extension with service-worker background tasks and browser-native storage can be the fastest product surface with the least ceremony.",
    actionable: "Yes - Immediate",
    confidence: "Medium",
    tags: ["chrome-extension", "browser", "utility"],
    relatedToolTitles: ["Chrome", "GitHub"],
    researchType: "Technical Pattern",
    decisionImpact: "Near-Term",
    revalidationCadence: "As Needed",
    whyItMatters: [
      "This is a useful counterweight to the portfolio bias toward desktop apps.",
      "It creates a lighter-weight surface for utilities that need browser context and background polling more than full app scaffolding.",
    ],
    repoHighlights: [
      {
        repoName: "PageDiffBookmark",
        insight:
          "Uses a Manifest V3 extension, service-worker background polling, browser-native UI, and chrome.storage.local to ship a focused page-change utility.",
      },
    ],
  },
];

const TOOL_SEEDS: ToolSeedDefinition[] = [
  {
    title: "Anthropic API",
    website: "https://console.anthropic.com",
    pricingModel: "Usage-based",
    whatIPay: "Usage-based; spend scales with generation volume and model choice.",
    delightScore: 8,
    platform: ["API"],
    stackIntegration: ["Desktop App", "Prompt Workbench", "Classification"],
    myRole: "Builder",
    oneLiner:
      "Claude API access layer used across portfolio repos for generation, classification, and multi-provider prompt evaluation.",
    whatFrustrates:
      "Usage costs and model dependency still need guardrails, especially when generation volume is part of the product surface.",
    comparedTo:
      "Often paired against Ollama for local privacy and against OpenAI within multi-provider prompt tooling.",
    whatDelights:
      "Fits cleanly into local-first products where the app owns state locally and only reaches out for the model step that benefits from a hosted model.",
    subscriptionTier: "Pay-as-you-go",
    tags: ["llm", "api", "anthropic", "github-audit"],
    status: "Active",
    category: "AI Tool",
    myUseCases:
      "Content generation, optional classification, and multi-provider prompt experimentation.",
    utilityScore: 8,
    repoHighlights: [
      {
        repoName: "ContentEngine",
        insight:
          "Uses Claude generation as the core output engine inside a Tauri desktop product.",
      },
      {
        repoName: "BrowserHistoryVisualizer",
        insight:
          "Uses optional Claude categorization as a scoped enrichment step for local browsing analytics.",
      },
      {
        repoName: "prompt-englab",
        insight:
          "Uses Anthropic as one of the first-class providers in a local multi-provider prompt workbench.",
      },
    ],
  },
];

const EXISTING_TOOL_LINKS: ExistingToolLinkDefinition[] = [
  {
    title: "GitHub",
    oneLiner:
      "Primary remote collaboration and release surface across the active portfolio, with repos serving as the live source of build evidence.",
    myUseCases:
      "Repository hosting, issue and PR workflow, CI visibility, README-backed project documentation, and GitHub-source portfolio auditing.",
    repoHighlights: [
      { repoName: "IncidentManagement", insight: "Tracked as a live GitHub repo with CI and active portfolio evidence." },
      { repoName: "TicketHandoff", insight: "Tracked as a live GitHub repo with a documented Tauri support workflow." },
      { repoName: "StatusPage", insight: "Tracked as a live GitHub repo for the hosted monitoring and status-page lane." },
      { repoName: "ContentEngine", insight: "Tracked as a live GitHub repo for the Claude-powered desktop content lane." },
      { repoName: "BrowserHistoryVisualizer", insight: "Tracked as a live GitHub repo for local analytics work." },
      { repoName: "PageDiffBookmark", insight: "Tracked as a live GitHub repo for browser-extension work." },
      { repoName: "LoreKeeper", insight: "Tracked as a live GitHub repo for local-first game tooling." },
      { repoName: "LifeCadenceLedger", insight: "Tracked as a live GitHub repo for the personal cadence product lane." },
      { repoName: "prompt-englab", insight: "Tracked as a live GitHub repo for the prompt tooling lane." },
    ],
  },
  {
    title: "Ollama",
    oneLiner:
      "Local model runtime used when portfolio products need private, on-device analysis or optional offline narration without a hosted dependency.",
    myUseCases:
      "Local AI trend detection, optional escalation summaries, offline prompt evaluation, and privacy-first narrative generation.",
    repoHighlights: [
      { repoName: "IncidentManagement", insight: "Used for local AI trend detection across incident history." },
      { repoName: "TicketHandoff", insight: "Used for optional local escalation summaries." },
      { repoName: "LoreKeeper", insight: "Used for optional local NPC dialogue and narration." },
      { repoName: "prompt-englab", insight: "Used as one of the supported local providers in the prompt workbench." },
    ],
  },
  {
    title: "Jira Service Management",
    oneLiner:
      "Operational ticketing system used where the local product experience needs to pull context from Jira and write structured handoff artifacts back.",
    myUseCases:
      "Ticket context ingestion, escalation-note publishing, and incident-adjacent workflow support for ops-focused desktop tools.",
    repoHighlights: [
      { repoName: "TicketHandoff", insight: "Pulls Jira context in and posts handoff notes back to the ticket." },
      { repoName: "IncidentManagement", insight: "Supports the broader incident-review lane that overlaps operational Jira workflows." },
    ],
  },
  {
    title: "Chrome",
    oneLiner:
      "Browser runtime and API surface for lightweight utilities that are better delivered as extensions than as full desktop or hosted apps.",
    myUseCases:
      "Manifest V3 extensions, side panel utilities, background polling, and browser-native storage for focused monitoring tools.",
    repoHighlights: [
      { repoName: "PageDiffBookmark", insight: "Provides the runtime surface and native APIs for the browser utility." },
    ],
  },
];

function parseFlags(argv: string[]): GitHubKnowledgeAuditFlags {
  let live = false;
  let owner = DEFAULT_OWNER;
  let limit = DEFAULT_REPO_LIMIT;
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
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new AppError(`Invalid --limit value "${raw}"`);
      }
      limit = parsed;
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

async function main(): Promise<void> {
  try {
    const output = await runGitHubKnowledgeAudit(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runGitHubKnowledgeAudit(flags: GitHubKnowledgeAuditFlags): Promise<Record<string, unknown>> {
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for the GitHub knowledge audit",
  );
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sourceConfig = await readJsonFile<LocalPortfolioExternalSignalSourceConfig>(flags.sourceConfig);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);
  if (!config.phase5ExternalSignals) {
    throw new AppError("Control tower config is missing phase5ExternalSignals");
  }

  const [projectSchema, skillSchema, researchSchema, toolSchema, sourceSchema, repos] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
    api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
    listGitHubRepos(flags.owner, flags.limit),
  ]);

  const [projectPages, skillPages, researchPages, toolPages, sourcePages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
  ]);

  const projectById = new Map(projectPages.map((page) => [page.id, page]));
  const repoByName = new Map(repos.map((repo) => [repo.name, repo]));
  const repoToProjectId = buildRepoProjectIdMap({
    manualSeeds: sourceConfig.manualSeeds,
    sourcePages,
    owner: flags.owner,
  });

  const selectedRepoNames = unique(
    [
      ...SKILL_SEEDS.flatMap((seed) => seed.repoHighlights.map((highlight) => highlight.repoName)),
      ...RESEARCH_SEEDS.flatMap((seed) => seed.repoHighlights.map((highlight) => highlight.repoName)),
      ...TOOL_SEEDS.flatMap((seed) => seed.repoHighlights.map((highlight) => highlight.repoName)),
      ...EXISTING_TOOL_LINKS.flatMap((seed) => seed.repoHighlights.map((highlight) => highlight.repoName)),
    ],
  );

  validateRepoCoverage(selectedRepoNames, repoByName, repoToProjectId, projectById);
  const readmes = await fetchRepoReadmes(flags.owner, selectedRepoNames);

  const resolvedToolSeeds = TOOL_SEEDS.map((seed) =>
    resolveToolSeed({ definition: seed, projectById, repoByName, repoToProjectId, readmes }),
  );
  const resolvedSkillSeeds = SKILL_SEEDS.map((seed) =>
    resolveSkillSeed({ definition: seed, projectById, repoByName, repoToProjectId, readmes }),
  );
  const resolvedResearchSeeds = RESEARCH_SEEDS.map((seed) =>
    resolveResearchSeed({ definition: seed, projectById, repoByName, repoToProjectId, readmes }),
  );
  const existingToolPlans = EXISTING_TOOL_LINKS.map((definition) =>
    resolveExistingToolLink({ definition, projectById, repoByName, repoToProjectId, readmes }),
  );
  const [skillMarkdownByPageId, researchMarkdownByPageId, toolMarkdownByPageId] = await Promise.all([
    readMarkdownMap(api, skillPages),
    readMarkdownMap(api, researchPages),
    readMarkdownMap(api, toolPages),
  ]);
  const skillMarkdownByTitle = new Map(
    resolvedSkillSeeds.map((seed) => [seed.definition.title, seed.markdown] as const),
  );
  const researchMarkdownByTitle = new Map(
    resolvedResearchSeeds.map((seed) => [seed.definition.title, seed.markdown] as const),
  );
  const toolMarkdownByTitle = new Map(
    resolvedToolSeeds.map((seed) => [seed.definition.title, seed.markdown] as const),
  );

  const dryRunOutput = {
    ok: true,
    live: false,
    repoAudit: summarizeRepoAudit(repos),
    skills: summarizePlannedRowRefreshes({
      pages: skillPages,
      titles: resolvedSkillSeeds.map((seed) => seed.definition.title),
      nextMarkdownByTitle: skillMarkdownByTitle,
      currentMarkdownByPageId: skillMarkdownByPageId,
    }),
    research: summarizePlannedRowRefreshes({
      pages: researchPages,
      titles: resolvedResearchSeeds.map((seed) => seed.definition.title),
      nextMarkdownByTitle: researchMarkdownByTitle,
      currentMarkdownByPageId: researchMarkdownByPageId,
    }),
    tools: summarizePlannedRowRefreshes({
      pages: toolPages,
      titles: resolvedToolSeeds.map((seed) => seed.definition.title),
      nextMarkdownByTitle: toolMarkdownByTitle,
      currentMarkdownByPageId: toolMarkdownByPageId,
    }),
    existingToolUpdates: summarizeExistingToolUpdates(toolPages, existingToolPlans, toolMarkdownByPageId),
    touchedProjects: summarizeTouchedProjects([
      ...resolvedSkillSeeds.flatMap((seed) => seed.projectTitles),
      ...resolvedResearchSeeds.flatMap((seed) => seed.projectTitles),
      ...resolvedToolSeeds.flatMap((seed) => seed.projectTitles),
      ...existingToolPlans.flatMap((seed) => seed.projectTitles),
    ]),
  };

  if (!flags.live) {
    return dryRunOutput;
  }

  const toolResults = await upsertToolSeeds({
    api,
    dataSourceId: config.relatedDataSources.toolsId,
    titlePropertyName: toolSchema.titlePropertyName,
    currentPages: toolPages,
    seeds: resolvedToolSeeds,
    today: flags.today,
  });

  const toolPagesAfterSeeds = await fetchAllPages(
    sdk,
    config.relatedDataSources.toolsId,
    toolSchema.titlePropertyName,
  );
  const skillResults = await upsertSkillSeeds({
    api,
    dataSourceId: config.relatedDataSources.skillsId,
    titlePropertyName: skillSchema.titlePropertyName,
    currentPages: skillPages,
    seeds: resolvedSkillSeeds,
    today: flags.today,
  });
  const researchResults = await upsertResearchSeeds({
    api,
    dataSourceId: config.relatedDataSources.researchId,
    titlePropertyName: researchSchema.titlePropertyName,
    currentPages: researchPages,
    toolPages: toolPagesAfterSeeds,
    seeds: resolvedResearchSeeds,
    today: flags.today,
  });

  const [toolPagesFinal, skillPagesFinal, researchPagesFinal] = await Promise.all([
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
  ]);

  const existingToolRefreshes = await refreshExistingToolLinks({
    api,
    toolPages: toolPagesFinal,
    plans: existingToolPlans,
    today: flags.today,
  });

  const relationPlans = buildProjectRelationPlans({
    projectPages,
    skillPages: skillPagesFinal,
    researchPages: researchPagesFinal,
    toolPages: toolPagesFinal,
    skillTitles: resolvedSkillSeeds.map((seed) => seed.definition.title),
    researchTitles: resolvedResearchSeeds.map((seed) => seed.definition.title),
    newToolTitles: resolvedToolSeeds.map((seed) => seed.definition.title),
    existingToolTitles: existingToolPlans.map((plan) => plan.title),
    skillSeeds: resolvedSkillSeeds,
    researchSeeds: resolvedResearchSeeds,
    toolSeeds: resolvedToolSeeds,
    existingToolPlans,
  });
  const projectUpdates = await updateProjectRelations({
    api,
    projectPages,
    plans: relationPlans,
  });

  return {
    ok: true,
    live: true,
    repoAudit: summarizeRepoAudit(repos),
    toolSeeds: toolResults,
    skillSeeds: skillResults,
    researchSeeds: researchResults,
    existingToolRefreshes,
    projectRelationUpdates: projectUpdates,
  };
}

async function listGitHubRepos(owner: string, limit: number): Promise<GitHubRepo[]> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "repo",
      "list",
      owner,
      "--source",
      "--limit",
      String(limit),
      "--json",
      "name,description,url,isArchived,isFork,isPrivate,createdAt,updatedAt,primaryLanguage,repositoryTopics",
    ],
    {
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const raw = JSON.parse(stdout) as Array<{
    name: string;
    description?: string | null;
    url: string;
    isArchived: boolean;
    isFork: boolean;
    isPrivate: boolean;
    createdAt: string;
    updatedAt: string;
    primaryLanguage?: { name?: string | null } | null;
    repositoryTopics?: Array<{ name?: string | null }> | null;
  }>;

  return raw.map((repo) => ({
    name: repo.name,
    description: repo.description?.trim() ?? "",
    url: repo.url,
    isArchived: repo.isArchived,
    isFork: repo.isFork,
    isPrivate: repo.isPrivate,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    primaryLanguage: repo.primaryLanguage?.name?.trim() ?? "",
    topics: (repo.repositoryTopics ?? [])
      .map((topic) => topic.name?.trim() ?? "")
      .filter((topic) => topic.length > 0),
  }));
}

async function fetchRepoReadmes(owner: string, repoNames: string[]): Promise<Map<string, string>> {
  const readmes = new Map<string, string>();

  for (const repoName of repoNames) {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${owner}/${repoName}/readme`,
        "-H",
        "Accept: application/vnd.github.raw+json",
      ],
      {
        maxBuffer: 5 * 1024 * 1024,
      },
    );
    const markdown = stdout.trim();
    if (!markdown) {
      throw new AppError(`README lookup returned empty content for ${owner}/${repoName}`);
    }
    readmes.set(repoName, markdown);
  }

  return readmes;
}

function buildRepoProjectIdMap(input: {
  manualSeeds: LocalPortfolioExternalSignalSourceConfig["manualSeeds"];
  sourcePages: DataSourcePageRef[];
  owner: string;
}): Map<string, string> {
  const repoToProjectId = new Map<string, string>();

  for (const seed of input.manualSeeds) {
    if (seed.provider !== "GitHub" || !seed.identifier) {
      continue;
    }
    const normalized = seed.identifier.trim();
    const prefix = `${input.owner}/`;
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    const repoName = normalized.slice(prefix.length);
    if (repoName) {
      repoToProjectId.set(repoName, seed.localProjectId);
    }
  }

  for (const page of input.sourcePages) {
    const identifier = page.properties.Identifier?.rich_text
      ?.map((entry) => entry.plain_text ?? "")
      .join("")
      .trim();
    const sourceUrl = page.properties["Source URL"]?.url?.trim() ?? "";
    const projectId = relationIds(page.properties["Local Project"])[0];
    if (!projectId) {
      continue;
    }

    const repoName = extractRepoName({
      identifier,
      sourceUrl,
      owner: input.owner,
    });
    if (repoName) {
      repoToProjectId.set(repoName, projectId);
    }
  }

  return repoToProjectId;
}

function extractRepoName(input: {
  identifier?: string;
  sourceUrl?: string;
  owner: string;
}): string {
  const identifier = input.identifier?.trim() ?? "";
  if (identifier.startsWith(`${input.owner}/`)) {
    return identifier.slice(input.owner.length + 1);
  }

  const sourceUrl = input.sourceUrl?.trim() ?? "";
  const marker = `github.com/${input.owner}/`;
  const position = sourceUrl.indexOf(marker);
  if (position >= 0) {
    return sourceUrl.slice(position + marker.length);
  }

  return "";
}

function validateRepoCoverage(
  repoNames: string[],
  repoByName: Map<string, GitHubRepo>,
  repoToProjectId: Map<string, string>,
  projectById: Map<string, DataSourcePageRef>,
): void {
  for (const repoName of repoNames) {
    if (!repoByName.has(repoName)) {
      throw new AppError(`Could not find GitHub repo "${repoName}" in the live audit`);
    }
    const projectId = repoToProjectId.get(repoName);
    if (!projectId) {
      throw new AppError(`Could not find a GitHub source mapping for repo "${repoName}"`);
    }
    if (!projectById.has(projectId)) {
      throw new AppError(`Mapped local project ${projectId} for repo "${repoName}" is missing`);
    }
  }
}

function resolveToolSeed(input: {
  definition: ToolSeedDefinition;
  projectById: Map<string, DataSourcePageRef>;
  repoByName: Map<string, GitHubRepo>;
  repoToProjectId: Map<string, string>;
  readmes: Map<string, string>;
}): ResolvedToolSeed {
  const projectIds = resolveProjectIds(input.definition.repoHighlights, input.repoToProjectId);
  const projectTitles = resolveProjectTitles(projectIds, input.projectById);
  const repos = input.definition.repoHighlights.map((highlight) => requireRepo(input.repoByName, highlight.repoName));
  ensureReadmes(input.definition.repoHighlights, input.readmes);

  return {
    definition: input.definition,
    projectIds,
    projectTitles,
    dateFirstUsed: repos
      .map((repo) => repo.createdAt.slice(0, 10))
      .sort()[0] ?? TODAY,
    markdown: renderToolMarkdown(input.definition, projectTitles, repos),
  };
}

function resolveSkillSeed(input: {
  definition: SkillSeedDefinition;
  projectById: Map<string, DataSourcePageRef>;
  repoByName: Map<string, GitHubRepo>;
  repoToProjectId: Map<string, string>;
  readmes: Map<string, string>;
}): ResolvedSkillSeed {
  const projectIds = resolveProjectIds(input.definition.repoHighlights, input.repoToProjectId);
  const projectTitles = resolveProjectTitles(projectIds, input.projectById);
  const repos = input.definition.repoHighlights.map((highlight) => requireRepo(input.repoByName, highlight.repoName));
  ensureReadmes(input.definition.repoHighlights, input.readmes);

  return {
    definition: input.definition,
    projectIds,
    projectTitles,
    lastPracticed: repos
      .map((repo) => repo.updatedAt.slice(0, 10))
      .sort()
      .at(-1) ?? TODAY,
    markdown: renderSkillMarkdown(input.definition, projectTitles, repos),
  };
}

function resolveResearchSeed(input: {
  definition: ResearchSeedDefinition;
  projectById: Map<string, DataSourcePageRef>;
  repoByName: Map<string, GitHubRepo>;
  repoToProjectId: Map<string, string>;
  readmes: Map<string, string>;
}): ResolvedResearchSeed {
  const projectIds = resolveProjectIds(input.definition.repoHighlights, input.repoToProjectId);
  const projectTitles = resolveProjectTitles(projectIds, input.projectById);
  const repos = input.definition.repoHighlights.map((highlight) => requireRepo(input.repoByName, highlight.repoName));
  ensureReadmes(input.definition.repoHighlights, input.readmes);

  return {
    definition: input.definition,
    projectIds,
    projectTitles,
    sourceUrls: repos.map((repo) => repo.url),
    markdown: renderResearchMarkdown(input.definition, projectTitles, repos),
  };
}

function resolveExistingToolLink(input: {
  definition: ExistingToolLinkDefinition;
  projectById: Map<string, DataSourcePageRef>;
  repoByName: Map<string, GitHubRepo>;
  repoToProjectId: Map<string, string>;
  readmes: Map<string, string>;
}): ExistingToolLinkPlan {
  ensureReadmes(input.definition.repoHighlights, input.readmes);
  for (const highlight of input.definition.repoHighlights) {
    requireRepo(input.repoByName, highlight.repoName);
  }
  const projectIds = resolveProjectIds(input.definition.repoHighlights, input.repoToProjectId);

  return {
    title: input.definition.title,
    projectIds,
    projectTitles: resolveProjectTitles(projectIds, input.projectById),
    repoNames: input.definition.repoHighlights.map((highlight) => highlight.repoName),
    oneLiner: input.definition.oneLiner,
    myUseCases: input.definition.myUseCases,
    markdown: renderExistingToolMarkdown(
      input.definition.title,
      input.definition.oneLiner,
      input.definition.myUseCases,
      input.definition.repoHighlights,
      resolveProjectTitles(projectIds, input.projectById),
      input.definition.repoHighlights.map((highlight) => requireRepo(input.repoByName, highlight.repoName)),
    ),
  };
}

function buildToolSeedProperties(seed: ResolvedToolSeed, today: string): Record<string, unknown> {
  return {
    Website: { url: seed.definition.website },
    "Pricing Model": selectPropertyValue(seed.definition.pricingModel),
    "What I Pay": richTextValue(seed.definition.whatIPay),
    "Delight Score": { number: seed.definition.delightScore },
    Platform: multiSelectValue(seed.definition.platform),
    "Linked Local Projects": relationValue(seed.projectIds),
    "Stack Integration": multiSelectValue(seed.definition.stackIntegration),
    "Date First Used": datePropertyValue(seed.dateFirstUsed),
    "My Role": selectPropertyValue(seed.definition.myRole),
    "One-Liner": richTextValue(seed.definition.oneLiner),
    "What Frustrates": richTextValue(seed.definition.whatFrustrates),
    "Compared To": richTextValue(seed.definition.comparedTo),
    "What Delights": richTextValue(seed.definition.whatDelights),
    "Subscription Tier": richTextValue(seed.definition.subscriptionTier),
    Tags: multiSelectValue(seed.definition.tags),
    "Last Reviewed": datePropertyValue(today),
    Status: selectPropertyValue(seed.definition.status),
    Category: selectPropertyValue(seed.definition.category),
    "My Use Cases": richTextValue(seed.definition.myUseCases),
    "Utility Score": { number: seed.definition.utilityScore },
  };
}

function buildSkillSeedProperties(seed: ResolvedSkillSeed): Record<string, unknown> {
  return {
    Projects: richTextValue(seed.projectTitles.join(", ")),
    Category: selectPropertyValue(seed.definition.category),
    "Review Cadence": selectPropertyValue(seed.definition.reviewCadence),
    "Project Relevance": selectPropertyValue(seed.definition.projectRelevance),
    "Related Local Projects": relationValue(seed.projectIds),
    Status: selectPropertyValue(seed.definition.status),
    "Proof Type": multiSelectValue(seed.definition.proofTypes),
    "Last Practiced": datePropertyValue(seed.lastPracticed),
    Proficiency: { number: seed.definition.proficiency },
    Notes: richTextValue(seed.definition.notes),
    "Needs Link Review": { checkbox: false },
    Source: multiSelectValue(["GitHub"]),
  };
}

function buildResearchSeedProperties(
  seed: ResolvedResearchSeed,
  relatedToolIds: string[],
  today: string,
): Record<string, unknown> {
  return {
    Category: selectPropertyValue(seed.definition.category),
    Summary: richTextValue(seed.definition.summary),
    "Key Findings": richTextValue(seed.definition.keyFindings),
    Actionable: selectPropertyValue(seed.definition.actionable),
    Confidence: selectPropertyValue(seed.definition.confidence),
    Sources: richTextValue(renderSourcesText(seed.sourceUrls)),
    "Source URLs": { url: seed.sourceUrls[0] ?? null },
    "Date Researched": datePropertyValue(today),
    "Last Verified": datePropertyValue(today),
    Tags: multiSelectValue(seed.definition.tags),
    "Related Tools": relationValue(relatedToolIds),
    "Related Local Projects": relationValue(seed.projectIds),
    "Related Projects": relationValue([]),
    "Research Type": selectPropertyValue(seed.definition.researchType),
    "Decision Impact": selectPropertyValue(seed.definition.decisionImpact),
    "Revalidation Cadence": selectPropertyValue(seed.definition.revalidationCadence),
  };
}

function buildExistingToolRefreshProperties(plan: ExistingToolLinkPlan, today: string): Record<string, unknown> {
  return {
    "Linked Local Projects": relationValue(plan.projectIds),
    "Last Reviewed": datePropertyValue(today),
    "One-Liner": richTextValue(plan.oneLiner),
    "My Use Cases": richTextValue(plan.myUseCases),
  };
}

async function upsertToolSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  currentPages: DataSourcePageRef[];
  seeds: ResolvedToolSeed[];
  today: string;
}): Promise<UpsertResult[]> {
  const currentPagesByTitle = buildExactTitleMap(input.currentPages);
  const results: UpsertResult[] = [];

  for (const seed of input.seeds) {
    const properties = {
      [input.titlePropertyName]: titleValue(seed.definition.title),
      ...buildToolSeedProperties(seed, input.today),
    };
    let changedProperties = Object.keys(properties);
    let markdownChanged = true;
    const existing = await input.api.searchPage({
      dataSourceId: input.dataSourceId,
      exactTitle: seed.definition.title,
      titleProperty: input.titlePropertyName,
    });
    if (existing) {
      const existingMarkdown = await input.api.readPageMarkdown(existing.id);
      const currentPage = resolveToolPageByTitle(currentPagesByTitle, seed.definition.title);
      changedProperties = listChangedProperties(currentPage.properties, properties, ["Last Reviewed"]);
      markdownChanged =
        normalizeMarkdownForComparison(existingMarkdown.markdown) !==
        normalizeMarkdownForComparison(seed.markdown);
      if (changedProperties.length === 0 && !markdownChanged) {
        results.push({
          title: seed.definition.title,
          id: existing.id,
          url: existing.url,
          existed: true,
          action: "unchanged",
          changedProperties,
          markdownChanged,
        });
        continue;
      }
    }
    const result = await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.definition.title,
      properties,
      markdown: seed.markdown,
    });
    results.push({
      title: seed.definition.title,
      id: result.id,
      url: result.url,
      existed: result.existed,
      action: result.existed ? "refreshed" : "created",
      changedProperties,
      markdownChanged,
    });
  }

  return results;
}

async function upsertSkillSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  currentPages: DataSourcePageRef[];
  seeds: ResolvedSkillSeed[];
  today: string;
}): Promise<UpsertResult[]> {
  const currentPagesByTitle = buildExactTitleMap(input.currentPages);
  const results: UpsertResult[] = [];

  for (const seed of input.seeds) {
    const properties = {
      [input.titlePropertyName]: titleValue(seed.definition.title),
      ...buildSkillSeedProperties(seed),
    };
    let changedProperties = Object.keys(properties);
    let markdownChanged = true;
    const existing = await input.api.searchPage({
      dataSourceId: input.dataSourceId,
      exactTitle: seed.definition.title,
      titleProperty: input.titlePropertyName,
    });
    if (existing) {
      const existingMarkdown = await input.api.readPageMarkdown(existing.id);
      const currentPage = requireExactTitle(currentPagesByTitle, seed.definition.title, "skill");
      changedProperties = listChangedProperties(currentPage.properties, properties);
      markdownChanged =
        normalizeMarkdownForComparison(existingMarkdown.markdown) !==
        normalizeMarkdownForComparison(seed.markdown);
      if (changedProperties.length === 0 && !markdownChanged) {
        results.push({
          title: seed.definition.title,
          id: existing.id,
          url: existing.url,
          existed: true,
          action: "unchanged",
          changedProperties,
          markdownChanged,
        });
        continue;
      }
    }
    const result = await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.definition.title,
      properties,
      markdown: seed.markdown,
    });
    results.push({
      title: seed.definition.title,
      id: result.id,
      url: result.url,
      existed: result.existed,
      action: result.existed ? "refreshed" : "created",
      changedProperties,
      markdownChanged,
    });
  }

  return results;
}

async function upsertResearchSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  currentPages: DataSourcePageRef[];
  toolPages: DataSourcePageRef[];
  seeds: ResolvedResearchSeed[];
  today: string;
}): Promise<UpsertResult[]> {
  const currentPagesByTitle = buildExactTitleMap(input.currentPages);
  const toolPagesByTitle = buildExactTitleMap(input.toolPages);
  const results: UpsertResult[] = [];

  for (const seed of input.seeds) {
    const toolIds = seed.definition.relatedToolTitles.map((title) =>
      resolveToolPageByTitle(toolPagesByTitle, title).id,
    );
    const properties = {
      [input.titlePropertyName]: titleValue(seed.definition.title),
      ...buildResearchSeedProperties(seed, toolIds, input.today),
    };
    let changedProperties = Object.keys(properties);
    let markdownChanged = true;
    const existing = await input.api.searchPage({
      dataSourceId: input.dataSourceId,
      exactTitle: seed.definition.title,
      titleProperty: input.titlePropertyName,
    });
    if (existing) {
      const existingMarkdown = await input.api.readPageMarkdown(existing.id);
      const currentPage = requireExactTitle(currentPagesByTitle, seed.definition.title, "research");
      changedProperties = listChangedProperties(currentPage.properties, properties, [
        "Date Researched",
        "Last Verified",
      ]);
      markdownChanged =
        normalizeMarkdownForComparison(existingMarkdown.markdown) !==
        normalizeMarkdownForComparison(seed.markdown);
      if (changedProperties.length === 0 && !markdownChanged) {
        results.push({
          title: seed.definition.title,
          id: existing.id,
          url: existing.url,
          existed: true,
          action: "unchanged",
          changedProperties,
          markdownChanged,
        });
        continue;
      }
    }
    const result = await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.definition.title,
      properties,
      markdown: seed.markdown,
    });
    results.push({
      title: seed.definition.title,
      id: result.id,
      url: result.url,
      existed: result.existed,
      action: result.existed ? "refreshed" : "created",
      changedProperties,
      markdownChanged,
    });
  }

  return results;
}

async function refreshExistingToolLinks(input: {
  api: DirectNotionClient;
  toolPages: DataSourcePageRef[];
  plans: ExistingToolLinkPlan[];
  today: string;
}): Promise<
  Array<{
    title: string;
    pageId: string;
    addedProjectCount: number;
    totalProjectCount: number;
    action: "refreshed" | "unchanged";
    changedProperties: string[];
    markdownChanged: boolean;
  }>
> {
  const toolPagesByTitle = buildExactTitleMap(input.toolPages);
  const toolPageById = new Map(input.toolPages.map((page) => [page.id, page]));
  const results: Array<{
    title: string;
    pageId: string;
    addedProjectCount: number;
    totalProjectCount: number;
    action: "refreshed" | "unchanged";
    changedProperties: string[];
    markdownChanged: boolean;
  }> = [];

  for (const plan of input.plans) {
    const page = resolveToolPageByTitle(toolPagesByTitle, plan.title);
    const existingIds = relationIds(page.properties["Linked Local Projects"]);
    const nextIds = unique([...existingIds, ...plan.projectIds]);
    const properties = buildExistingToolRefreshProperties(
      {
        ...plan,
        projectIds: nextIds,
      },
      input.today,
    );
    const currentPage = toolPageById.get(page.id) ?? page;
    const changedProperties = listChangedProperties(currentPage.properties, properties, ["Last Reviewed"]);
    const existingMarkdown = await input.api.readPageMarkdown(page.id);
    const markdownChanged =
      normalizeMarkdownForComparison(existingMarkdown.markdown) !==
      normalizeMarkdownForComparison(plan.markdown);
    if (changedProperties.length > 0 || markdownChanged) {
      await input.api.updatePageProperties({
        pageId: page.id,
        properties,
      });
      if (markdownChanged) {
        await input.api.patchPageMarkdown({
          pageId: page.id,
          command: "replace_content",
          newMarkdown: plan.markdown,
        });
      }
    }
    results.push({
      title: plan.title,
      pageId: page.id,
      addedProjectCount: nextIds.length - existingIds.length,
      totalProjectCount: nextIds.length,
      action: changedProperties.length > 0 || markdownChanged ? "refreshed" : "unchanged",
      changedProperties,
      markdownChanged,
    });
  }

  return results;
}

function buildProjectRelationPlans(input: {
  projectPages: DataSourcePageRef[];
  skillPages: DataSourcePageRef[];
  researchPages: DataSourcePageRef[];
  toolPages: DataSourcePageRef[];
  skillTitles: string[];
  researchTitles: string[];
  newToolTitles: string[];
  existingToolTitles: string[];
  skillSeeds: ResolvedSkillSeed[];
  researchSeeds: ResolvedResearchSeed[];
  toolSeeds: ResolvedToolSeed[];
  existingToolPlans: ExistingToolLinkPlan[];
}): RelationUpdatePlan[] {
  const skillPagesByTitle = buildExactTitleMap(input.skillPages);
  const researchPagesByTitle = buildExactTitleMap(input.researchPages);
  const toolPagesByTitle = buildExactTitleMap(input.toolPages);
  const plansByProjectId = new Map<string, RelationUpdatePlan>();

  const ensurePlan = (projectPage: DataSourcePageRef): RelationUpdatePlan => {
    const existing = plansByProjectId.get(projectPage.id);
    if (existing) {
      return existing;
    }
    const created: RelationUpdatePlan = {
      projectId: projectPage.id,
      projectTitle: projectPage.title,
      researchIds: [],
      skillIds: [],
      toolIds: [],
    };
    plansByProjectId.set(projectPage.id, created);
    return created;
  };

  for (const seed of input.skillSeeds) {
    const page = requireExactTitle(skillPagesByTitle, seed.definition.title, "skill");
    for (const projectId of seed.projectIds) {
      ensurePlan(requirePageById(input.projectPages, projectId)).skillIds.push(page.id);
    }
  }

  for (const seed of input.researchSeeds) {
    const page = requireExactTitle(researchPagesByTitle, seed.definition.title, "research");
    for (const projectId of seed.projectIds) {
      ensurePlan(requirePageById(input.projectPages, projectId)).researchIds.push(page.id);
    }
  }

  for (const seed of input.toolSeeds) {
    const page = resolveToolPageByTitle(toolPagesByTitle, seed.definition.title);
    for (const projectId of seed.projectIds) {
      ensurePlan(requirePageById(input.projectPages, projectId)).toolIds.push(page.id);
    }
  }

  for (const plan of input.existingToolPlans) {
    const page = resolveToolPageByTitle(toolPagesByTitle, plan.title);
    for (const projectId of plan.projectIds) {
      ensurePlan(requirePageById(input.projectPages, projectId)).toolIds.push(page.id);
    }
  }

  return Array.from(plansByProjectId.values()).map((plan) => ({
    ...plan,
    researchIds: unique(plan.researchIds),
    skillIds: unique(plan.skillIds),
    toolIds: unique(plan.toolIds),
  }));
}

async function updateProjectRelations(input: {
  api: DirectNotionClient;
  projectPages: DataSourcePageRef[];
  plans: RelationUpdatePlan[];
}): Promise<Array<{ projectTitle: string; researchAdded: number; skillsAdded: number; toolsAdded: number }>> {
  const projectById = new Map(input.projectPages.map((page) => [page.id, page]));
  const results: Array<{ projectTitle: string; researchAdded: number; skillsAdded: number; toolsAdded: number }> = [];

  for (const plan of input.plans) {
    const page = projectById.get(plan.projectId);
    if (!page) {
      throw new AppError(`Could not find local project ${plan.projectId} while syncing relations`);
    }
    const currentResearch = relationIds(page.properties["Related Research"]);
    const currentSkills = relationIds(page.properties["Supporting Skills"]);
    const currentTools = relationIds(page.properties["Tool Stack Records"]);
    const nextResearch = unique([...currentResearch, ...plan.researchIds]);
    const nextSkills = unique([...currentSkills, ...plan.skillIds]);
    const nextTools = unique([...currentTools, ...plan.toolIds]);

    await input.api.updatePageProperties({
      pageId: page.id,
      properties: {
        "Related Research": relationValue(nextResearch),
        "Supporting Skills": relationValue(nextSkills),
        "Tool Stack Records": relationValue(nextTools),
      },
    });

    results.push({
      projectTitle: plan.projectTitle,
      researchAdded: nextResearch.length - currentResearch.length,
      skillsAdded: nextSkills.length - currentSkills.length,
      toolsAdded: nextTools.length - currentTools.length,
    });
  }

  return results;
}

function renderSkillMarkdown(definition: SkillSeedDefinition, projectTitles: string[], repos: GitHubRepo[]): string {
  return [
    `# ${definition.title}`,
    "",
    "## Summary",
    definition.summary,
    "",
    "## Repo evidence",
    ...definition.repoHighlights.map((highlight) => {
      const repo = repos.find((candidate) => candidate.name === highlight.repoName);
      return `- ${highlight.repoName}: ${highlight.insight}${repo ? ` (${repo.url})` : ""}`;
    }),
    "",
    "## Related projects",
    ...projectTitles.map((title) => `- ${title}`),
    "",
    "## Why this skill matters",
    "- This now shows up as direct build evidence in the portfolio rather than only as an inferred capability.",
    "- It should improve future project linking and make the skill library reflect actual repo-backed work.",
  ].join("\n");
}

function renderResearchMarkdown(
  definition: ResearchSeedDefinition,
  projectTitles: string[],
  repos: GitHubRepo[],
): string {
  return [
    `# ${definition.title}`,
    "",
    "## Summary",
    definition.summary,
    "",
    "## Key findings",
    definition.keyFindings,
    "",
    "## GitHub evidence",
    ...definition.repoHighlights.map((highlight) => {
      const repo = repos.find((candidate) => candidate.name === highlight.repoName);
      return `- ${highlight.repoName}: ${highlight.insight}${repo ? ` (${repo.url})` : ""}`;
    }),
    "",
    "## Why it matters",
    ...definition.whyItMatters.map((line) => `- ${line}`),
    "",
    "## Related projects",
    ...projectTitles.map((title) => `- ${title}`),
  ].join("\n");
}

function renderToolMarkdown(definition: ToolSeedDefinition, projectTitles: string[], repos: GitHubRepo[]): string {
  return [
    `# ${definition.title}`,
    "",
    "## One-liner",
    definition.oneLiner,
    "",
    "## Repo evidence",
    ...definition.repoHighlights.map((highlight) => {
      const repo = repos.find((candidate) => candidate.name === highlight.repoName);
      return `- ${highlight.repoName}: ${highlight.insight}${repo ? ` (${repo.url})` : ""}`;
    }),
    "",
    "## Current portfolio use cases",
    ...definition.myUseCases.split(/;\s*/).map((line) => `- ${line}`),
    "",
    "## Linked projects",
    ...projectTitles.map((title) => `- ${title}`),
  ].join("\n");
}

function renderExistingToolMarkdown(
  title: string,
  oneLiner: string,
  myUseCases: string,
  repoHighlights: RepoHighlight[],
  projectTitles: string[],
  repos: GitHubRepo[],
): string {
  return [
    `# ${title}`,
    "",
    "## One-liner",
    oneLiner,
    "",
    "## GitHub-backed evidence",
    ...repoHighlights.map((highlight) => {
      const repo = repos.find((candidate) => candidate.name === highlight.repoName);
      return `- ${highlight.repoName}: ${highlight.insight}${repo ? ` (${repo.url})` : ""}`;
    }),
    "",
    "## Current portfolio use cases",
    ...myUseCases.split(/;\s*/).map((line) => `- ${line}`),
    "",
    "## Linked projects",
    ...projectTitles.map((titleValue) => `- ${titleValue}`),
  ].join("\n");
}

function renderSourcesText(sourceUrls: string[]): string {
  const urls = unique(sourceUrls);
  return `GitHub README audit on ${TODAY}: ${urls.join(", ")}`;
}

function summarizeRepoAudit(repos: GitHubRepo[]): {
  repoCount: number;
  privateRepoCount: number;
  topLanguages: Array<{ language: string; count: number }>;
  topTopics: Array<{ topic: string; count: number }>;
} {
  const languageCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  for (const repo of repos) {
    if (repo.primaryLanguage) {
      languageCounts.set(repo.primaryLanguage, (languageCounts.get(repo.primaryLanguage) ?? 0) + 1);
    }
    for (const topic of repo.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }

  return {
    repoCount: repos.length,
    privateRepoCount: repos.filter((repo) => repo.isPrivate).length,
    topLanguages: topLanguageEntries(languageCounts),
    topTopics: topTopicEntries(topicCounts),
  };
}

function summarizePlannedRowRefreshes(input: {
  pages: DataSourcePageRef[];
  titles: string[];
  nextMarkdownByTitle: Map<string, string>;
  currentMarkdownByPageId: Map<string, string>;
}): {
  totalPlanned: number;
  existing: number;
  new: number;
  refreshNeeded: number;
  unchanged: number;
  titles: string[];
  refreshTitles: string[];
} {
  const pagesByTitle = buildExactTitleMap(input.pages);
  const refreshTitles: string[] = [];
  let existing = 0;

  for (const title of input.titles) {
    const matches = pagesByTitle.get(title) ?? [];
    if (matches.length === 0) {
      continue;
    }
    existing += 1;
    const page = matches[0]!;
    const nextMarkdown = normalizeMarkdownForComparison(input.nextMarkdownByTitle.get(title) ?? "");
    const currentMarkdown = normalizeMarkdownForComparison(input.currentMarkdownByPageId.get(page.id) ?? "");
    if (nextMarkdown !== currentMarkdown) {
      refreshTitles.push(title);
    }
  }

  return {
    totalPlanned: input.titles.length,
    existing,
    new: input.titles.length - existing,
    refreshNeeded: refreshTitles.length,
    unchanged: existing - refreshTitles.length,
    titles: input.titles,
    refreshTitles,
  };
}

function summarizeExistingToolUpdates(
  toolPages: DataSourcePageRef[],
  plans: ExistingToolLinkPlan[],
  currentMarkdownByPageId: Map<string, string>,
): {
  totalPlanned: number;
  existing: number;
  refreshNeeded: number;
  unchanged: number;
  details: Array<{
    title: string;
    exists: boolean;
    targetProjectCount: number;
    addedProjectCount: number;
    markdownChanged: boolean;
    refreshNeeded: boolean;
  }>;
} {
  const pagesByTitle = buildExactTitleMap(toolPages);
  const details = plans.map((plan) => {
    const matches = pagesByTitle.get(plan.title) ?? [];
    if (matches.length === 0) {
      return {
        title: plan.title,
        exists: false,
        targetProjectCount: plan.projectIds.length,
        addedProjectCount: plan.projectIds.length,
        markdownChanged: true,
        refreshNeeded: true,
      };
    }
    const page = resolveToolPageByTitle(pagesByTitle, plan.title);
    const existingIds = relationIds(page.properties["Linked Local Projects"]);
    const nextIds = unique([...existingIds, ...plan.projectIds]);
    const currentMarkdown = normalizeMarkdownForComparison(currentMarkdownByPageId.get(page.id) ?? "");
    const markdownChanged = currentMarkdown !== normalizeMarkdownForComparison(plan.markdown);
    const addedProjectCount = nextIds.length - existingIds.length;
    return {
      title: plan.title,
      exists: true,
      targetProjectCount: plan.projectIds.length,
      addedProjectCount,
      markdownChanged,
      refreshNeeded: markdownChanged || addedProjectCount > 0,
    };
  });

  return {
    totalPlanned: plans.length,
    existing: details.filter((detail) => detail.exists).length,
    refreshNeeded: details.filter((detail) => detail.refreshNeeded).length,
    unchanged: details.filter((detail) => detail.exists && !detail.refreshNeeded).length,
    details,
  };
}

function summarizeTouchedProjects(projectTitles: string[]): { count: number; titles: string[] } {
  return {
    count: unique(projectTitles).length,
    titles: unique(projectTitles).sort((left, right) => left.localeCompare(right)),
  };
}

function buildExactTitleMap(pages: DataSourcePageRef[]): Map<string, DataSourcePageRef[]> {
  const pagesByTitle = new Map<string, DataSourcePageRef[]>();
  for (const page of pages) {
    const existing = pagesByTitle.get(page.title) ?? [];
    existing.push(page);
    pagesByTitle.set(page.title, existing);
  }
  return pagesByTitle;
}

function resolveToolPageByTitle(
  toolPagesByTitle: Map<string, DataSourcePageRef[]>,
  title: string,
): DataSourcePageRef {
  const exactMatches = toolPagesByTitle.get(title) ?? [];
  if (exactMatches.length === 0) {
    throw new AppError(`Could not find tool page titled "${title}"`);
  }
  const canonicalId = CANONICAL_TOOL_PAGE_IDS.get(title);
  if (canonicalId) {
    const canonical = exactMatches.find((page) => page.id === canonicalId);
    if (canonical) {
      return canonical;
    }
  }
  return exactMatches[0]!;
}

function requireExactTitle(
  pagesByTitle: Map<string, DataSourcePageRef[]>,
  title: string,
  kind: string,
): DataSourcePageRef {
  const matches = pagesByTitle.get(title) ?? [];
  if (matches.length === 0) {
    throw new AppError(`Could not find ${kind} page titled "${title}"`);
  }
  return matches[0]!;
}

function requirePageById(projectPages: DataSourcePageRef[], projectId: string): DataSourcePageRef {
  const page = projectPages.find((candidate) => candidate.id === projectId);
  if (!page) {
    throw new AppError(`Could not find local project page ${projectId}`);
  }
  return page;
}

function resolveProjectIds(
  highlights: RepoHighlight[],
  repoToProjectId: Map<string, string>,
): string[] {
  return unique(
    highlights.map((highlight) => {
      const projectId = repoToProjectId.get(highlight.repoName);
      if (!projectId) {
        throw new AppError(`Could not resolve local project id for repo "${highlight.repoName}"`);
      }
      return projectId;
    }),
  );
}

function resolveProjectTitles(projectIds: string[], projectById: Map<string, DataSourcePageRef>): string[] {
  return projectIds.map((projectId) => {
    const page = projectById.get(projectId);
    if (!page) {
      throw new AppError(`Could not find local project row ${projectId}`);
    }
    return page.title;
  });
}

function requireRepo(repoByName: Map<string, GitHubRepo>, repoName: string): GitHubRepo {
  const repo = repoByName.get(repoName);
  if (!repo) {
    throw new AppError(`Could not find GitHub repo "${repoName}" in the live audit set`);
  }
  return repo;
}

function ensureReadmes(highlights: RepoHighlight[], readmes: Map<string, string>): void {
  for (const highlight of highlights) {
    if (!readmes.get(highlight.repoName)?.trim()) {
      throw new AppError(`Missing README evidence for repo "${highlight.repoName}"`);
    }
  }
}

async function readMarkdownMap(
  api: DirectNotionClient,
  pages: DataSourcePageRef[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    pages.map(async (page) => [page.id, (await api.readPageMarkdown(page.id)).markdown] as const),
  );
  return new Map(entries);
}

function listChangedProperties(
  existingProperties: Record<string, NotionPageProperty>,
  nextProperties: Record<string, unknown>,
  ignoredProperties: string[] = [],
): string[] {
  const ignored = new Set(ignoredProperties);
  return Object.entries(nextProperties)
    .filter(([name]) => !ignored.has(name))
    .filter(([name, value]) => !managedPropertyEquals(existingProperties[name], value))
    .map(([name]) => name);
}

function managedPropertyEquals(existing: NotionPageProperty | undefined, target: unknown): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const value = target as Record<string, unknown>;

  if ("title" in value) {
    return titleFromProperty(existing) === plainTextFromRichValue(value.title);
  }
  if ("rich_text" in value) {
    return textValue(existing) === plainTextFromRichValue(value.rich_text);
  }
  if ("select" in value) {
    return selectValue(existing) === selectName(value.select);
  }
  if ("multi_select" in value) {
    return sameStringSet(multiSelectNames(existing), multiSelectNamesFromValue(value.multi_select));
  }
  if ("relation" in value) {
    return sameStringSet(relationIds(existing), relationIdsFromValue(value.relation));
  }
  if ("checkbox" in value) {
    return Boolean(existing?.checkbox) === Boolean(value.checkbox);
  }
  if ("date" in value) {
    return dateValue(existing) === dateStart(value.date);
  }
  if ("number" in value) {
    return numberValue(existing) === (typeof value.number === "number" ? value.number : 0);
  }
  if ("url" in value) {
    const existingUrl = existing?.url?.trim() ?? "";
    const nextUrl = typeof value.url === "string" ? value.url.trim() : "";
    return existingUrl === nextUrl;
  }
  return false;
}

function plainTextFromRichValue(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "";
      }
      const text = (entry as { text?: { content?: unknown } }).text?.content;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

function multiSelectNames(property?: NotionPageProperty): string[] {
  return (property?.multi_select ?? []).map((entry) => entry.name?.trim() ?? "").filter(Boolean);
}

function multiSelectNamesFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "";
      }
      const name = (entry as { name?: unknown }).name;
      return typeof name === "string" ? name.trim() : "";
    })
    .filter(Boolean);
}

function relationIdsFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return "";
      }
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean);
}

function selectName(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name.trim() : "";
}

function dateStart(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const start = (value as { start?: unknown }).start;
  return typeof start === "string" ? start.slice(0, 10) : "";
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSorted = unique(left.filter(Boolean)).sort();
  const rightSorted = unique(right.filter(Boolean)).sort();
  if (leftSorted.length !== rightSorted.length) {
    return false;
  }
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function normalizeMarkdownForComparison(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function topLanguageEntries(counts: Map<string, number>): Array<{ language: string; count: number }> {
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 10)
    .map(([language, count]) => ({ language, count }));
}

function topTopicEntries(counts: Map<string, number>): Array<{ topic: string; count: number }> {
  return Array.from(counts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 10)
    .map(([topic, count]) => ({ topic, count }));
}

if (process.argv[1]?.endsWith("github-knowledge-audit.ts")) {
  void main();
}
