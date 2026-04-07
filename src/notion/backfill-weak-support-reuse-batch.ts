import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  relationIds,
  relationValue,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();

type SupportKind = "research" | "skill" | "tool";

interface Flags {
  live: boolean;
  today: string;
  config: string;
  batch: string;
}

interface BatchTarget {
  projectTitle: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
}

interface ProjectResult {
  projectTitle: string;
  researchAdded: string[];
  skillAdded: string[];
  toolAdded: string[];
  relatedResearchCount: number;
  supportingSkillsCount: number;
  linkedToolCount: number;
}

const FIRST_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "ComplianceKit",
    researchTitles: [],
    skillTitles: ["Playwright"],
    toolTitles: [],
  },
  {
    projectTitle: "StatusPage",
    researchTitles: [],
    skillTitles: ["WebSockets", "Docker", "Stripe"],
    toolTitles: [],
  },
  {
    projectTitle: "DevToolsTranslator",
    researchTitles: [],
    skillTitles: ["WebSockets"],
    toolTitles: [],
  },
  {
    projectTitle: "FreeLanceInvoice",
    researchTitles: [],
    skillTitles: ["Stripe"],
    toolTitles: [],
  },
  {
    projectTitle: "JobCommandCenter",
    researchTitles: [],
    skillTitles: ["Auth (OAuth/OIDC)"],
    toolTitles: [],
  },
  {
    projectTitle: "WorkdayDebrief",
    researchTitles: [],
    skillTitles: ["Auth (OAuth/OIDC)"],
    toolTitles: [],
  },
  {
    projectTitle: "KBFreshnessDetector",
    researchTitles: [],
    skillTitles: ["Confluence"],
    toolTitles: [],
  },
];

const SECOND_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "ApplyKit",
    researchTitles: [],
    skillTitles: ["AWS", "Okta"],
    toolTitles: [],
  },
  {
    projectTitle: "compliance-suite",
    researchTitles: [],
    skillTitles: ["SOC 2 Compliance", "Zero Trust Architecture"],
    toolTitles: [],
  },
];

const THIRD_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "GPT_RAG",
    researchTitles: [],
    skillTitles: ["Local LLM Inference", "Ollama", "SQL"],
    toolTitles: [],
  },
  {
    projectTitle: "ink",
    researchTitles: [],
    skillTitles: ["Local LLM Inference", "Ollama", "SQL"],
    toolTitles: [],
  },
  {
    projectTitle: "Job Market Heatmap",
    researchTitles: [],
    skillTitles: ["SQL", "Recharts"],
    toolTitles: [],
  },
  {
    projectTitle: "Reddit Sentiment Analyzer",
    researchTitles: [],
    skillTitles: ["SQL", "Recharts"],
    toolTitles: [],
  },
];

const FOURTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "TabTriage",
    researchTitles: [],
    skillTitles: ["window.storage API"],
    toolTitles: [],
  },
  {
    projectTitle: "ApplyKit",
    researchTitles: [],
    skillTitles: [],
    toolTitles: ["LinkedIn"],
  },
  {
    projectTitle: "JSM Ticket Analytics Export",
    researchTitles: [],
    skillTitles: ["Jira/JSM"],
    toolTitles: [],
  },
];

const FIFTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "Browser History Visualizer",
    researchTitles: [],
    skillTitles: ["D3.js Force-Directed Graph Visualization"],
    toolTitles: [],
  },
  {
    projectTitle: "ReturnRadar",
    researchTitles: [],
    skillTitles: ["macOS Desktop"],
    toolTitles: [],
  },
];

const SIXTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "API Reverse",
    researchTitles: [],
    skillTitles: ["Claude.ai Artifacts"],
    toolTitles: [],
  },
  {
    projectTitle: "ModelColosseum",
    researchTitles: [],
    skillTitles: ["Ollama Local LLM Integration"],
    toolTitles: [],
  },
];

const SEVENTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "Browser History Visualizer",
    researchTitles: [],
    skillTitles: ["Recharts Data Visualization"],
    toolTitles: [],
  },
  {
    projectTitle: "SnippetLibrary",
    researchTitles: [],
    skillTitles: ["Xcode / Native macOS Builds"],
    toolTitles: [],
  },
];

const EIGHTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "Browser History Visualizer",
    researchTitles: [],
    skillTitles: [],
    toolTitles: ["Recharts", "Node.js"],
  },
  {
    projectTitle: "DatabaseSchema",
    researchTitles: [],
    skillTitles: ["PostgreSQL"],
    toolTitles: ["PostgreSQL", "Node.js"],
  },
];

const NINTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "AIWorkFlow",
    researchTitles: [],
    skillTitles: ["Slack Platform"],
    toolTitles: [],
  },
  {
    projectTitle: "IncidentReview",
    researchTitles: [],
    skillTitles: ["Privacy / Data Sanitization"],
    toolTitles: [],
  },
];

const TENTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "TerraSynth",
    researchTitles: [],
    skillTitles: ["GitHub Pages"],
    toolTitles: [],
  },
];

const ELEVENTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "DatabaseSchema",
    researchTitles: [],
    skillTitles: [],
    toolTitles: ["React Flow"],
  },
  {
    projectTitle: "SignalFlow",
    researchTitles: [],
    skillTitles: [],
    toolTitles: ["React Flow"],
  },
  {
    projectTitle: "TerraSynth",
    researchTitles: [],
    skillTitles: ["Vitest"],
    toolTitles: [],
  },
  {
    projectTitle: "TabTriage",
    researchTitles: [],
    skillTitles: ["Vitest"],
    toolTitles: [],
  },
];

const TWELFTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "Terroir",
    researchTitles: [],
    skillTitles: [],
    toolTitles: ["CloudKit"],
  },
];

const THIRTEENTH_BATCH_TARGETS: BatchTarget[] = [
  {
    projectTitle: "JobCommandCenter",
    researchTitles: [],
    skillTitles: ["TypeScript Build Hygiene"],
    toolTitles: [],
  },
  {
    projectTitle: "DatabaseSchema",
    researchTitles: [],
    skillTitles: ["TypeScript Build Hygiene"],
    toolTitles: [],
  },
];

const BATCH_TARGETS: Record<string, BatchTarget[]> = {
  first: FIRST_BATCH_TARGETS,
  second: SECOND_BATCH_TARGETS,
  third: THIRD_BATCH_TARGETS,
  fourth: FOURTH_BATCH_TARGETS,
  fifth: FIFTH_BATCH_TARGETS,
  sixth: SIXTH_BATCH_TARGETS,
  seventh: SEVENTH_BATCH_TARGETS,
  eighth: EIGHTH_BATCH_TARGETS,
  ninth: NINTH_BATCH_TARGETS,
  tenth: TENTH_BATCH_TARGETS,
  eleventh: ELEVENTH_BATCH_TARGETS,
  twelfth: TWELFTH_BATCH_TARGETS,
  thirteenth: THIRTEENTH_BATCH_TARGETS,
};

function parseFlags(argv: string[]): Flags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let batch = "first";

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
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
    if (current === "--batch") {
      batch = argv[index + 1] ?? batch;
      index += 1;
    }
  }

  return { live, today, config, batch };
}

async function main(): Promise<void> {
  try {
    const output = await runWeakSupportReuseBackfill(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runWeakSupportReuseBackfill(flags: Flags): Promise<Record<string, unknown>> {
  const targets = BATCH_TARGETS[flags.batch];
  if (!targets) {
    throw new AppError(
      `Unknown weak support reuse batch "${flags.batch}". Expected one of: ${Object.keys(BATCH_TARGETS).join(", ")}`,
    );
  }

  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for weak support reuse backfill");
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);

  const [projectSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  const researchByTitle = new Map(researchPages.map((page) => [page.title, page]));
  const skillByTitle = new Map(skillPages.map((page) => [page.title, page]));
  const toolByTitle = new Map(toolPages.map((page) => [page.title, page]));

  ensurePagesExist(projectByTitle, uniqueTitles(targets.map((target) => target.projectTitle)), "project");
  ensurePagesExist(researchByTitle, uniqueTitles(targets.flatMap((target) => target.researchTitles)), "research");
  ensurePagesExist(skillByTitle, uniqueTitles(targets.flatMap((target) => target.skillTitles)), "skill");
  ensurePagesExist(toolByTitle, uniqueTitles(targets.flatMap((target) => target.toolTitles)), "tool");

  const results: ProjectResult[] = [];

  for (const target of targets) {
    const projectPage = requirePage(projectByTitle, target.projectTitle, "project");
    const currentResearchIds = relationIds(projectPage.properties["Related Research"]);
    const currentSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
    const currentToolIds = relationIds(projectPage.properties["Tool Stack Records"]);

    const addedResearchIds = target.researchTitles
      .map((title) => requirePage(researchByTitle, title, "research").id)
      .filter((id) => !currentResearchIds.includes(id));
    const addedSkillIds = target.skillTitles
      .map((title) => requirePage(skillByTitle, title, "skill").id)
      .filter((id) => !currentSkillIds.includes(id));
    const addedToolIds = target.toolTitles
      .map((title) => requirePage(toolByTitle, title, "tool").id)
      .filter((id) => !currentToolIds.includes(id));

    const nextResearchIds = uniqueIds([...currentResearchIds, ...addedResearchIds]);
    const nextSkillIds = uniqueIds([...currentSkillIds, ...addedSkillIds]);
    const nextToolIds = uniqueIds([...currentToolIds, ...addedToolIds]);

    if (
      flags.live &&
      (addedResearchIds.length > 0 || addedSkillIds.length > 0 || addedToolIds.length > 0)
    ) {
      await api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          "Related Research": relationValue(nextResearchIds),
          "Supporting Skills": relationValue(nextSkillIds),
          "Tool Stack Records": relationValue(nextToolIds),
          "Related Research Count": { number: nextResearchIds.length },
          "Supporting Skills Count": { number: nextSkillIds.length },
          "Linked Tool Count": { number: nextToolIds.length },
        },
      });
    }

    results.push({
      projectTitle: target.projectTitle,
      researchAdded: target.researchTitles.filter((title) =>
        addedResearchIds.includes(requirePage(researchByTitle, title, "research").id),
      ),
      skillAdded: target.skillTitles.filter((title) =>
        addedSkillIds.includes(requirePage(skillByTitle, title, "skill").id),
      ),
      toolAdded: target.toolTitles.filter((title) => addedToolIds.includes(requirePage(toolByTitle, title, "tool").id)),
      relatedResearchCount: nextResearchIds.length,
      supportingSkillsCount: nextSkillIds.length,
      linkedToolCount: nextToolIds.length,
    });
  }

  if (flags.live) {
    await syncReverseRelations({
      api,
      targets,
      projectByTitle,
      researchByTitle,
      skillByTitle,
      toolByTitle,
    });
  }

  return {
    ok: true,
    live: flags.live,
    today: flags.today,
    batch: flags.batch,
    targetCount: targets.length,
    projectsChangedCount: results.filter(
      (result) => result.researchAdded.length + result.skillAdded.length + result.toolAdded.length > 0,
    ).length,
    results,
  };
}

async function syncReverseRelations(input: {
  api: DirectNotionClient;
  targets: BatchTarget[];
  projectByTitle: Map<string, DataSourcePageRef>;
  researchByTitle: Map<string, DataSourcePageRef>;
  skillByTitle: Map<string, DataSourcePageRef>;
  toolByTitle: Map<string, DataSourcePageRef>;
}): Promise<void> {
  for (const target of input.targets) {
    const projectId = requirePage(input.projectByTitle, target.projectTitle, "project").id;

    for (const title of target.researchTitles) {
      const page = requirePage(input.researchByTitle, title, "research");
      const nextIds = uniqueIds([...relationIds(page.properties["Related Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(nextIds),
        },
      });
    }

    for (const title of target.skillTitles) {
      const page = requirePage(input.skillByTitle, title, "skill");
      const nextIds = uniqueIds([...relationIds(page.properties["Related Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(nextIds),
        },
      });
    }

    for (const title of target.toolTitles) {
      const page = requirePage(input.toolByTitle, title, "tool");
      const nextIds = uniqueIds([...relationIds(page.properties["Linked Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Linked Local Projects": relationValue(nextIds),
        },
      });
    }
  }
}

function ensurePagesExist(pageMap: Map<string, DataSourcePageRef>, titles: string[], kind: string): void {
  for (const title of titles) {
    if (!pageMap.has(title)) {
      throw new AppError(`Could not find ${kind} page for "${title}"`);
    }
  }
}

function requirePage(pageMap: Map<string, DataSourcePageRef>, title: string, kind: string): DataSourcePageRef {
  const page = pageMap.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page for "${title}"`);
  }
  return page;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function uniqueTitles(titles: string[]): string[] {
  return [...new Set(titles)];
}

if (process.argv[1]?.endsWith("backfill-weak-support-reuse-batch.ts")) {
  void main();
}
