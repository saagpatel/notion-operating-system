import "dotenv/config";

import { Client } from "@notionhq/client";

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
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface Target {
  title: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
}

interface Flags {
  live: boolean;
  today: string;
}

const COMMON_RESEARCH = ["Governed GitHub Issues Should Match the Current Execution Slice"];
const COMMON_TOOLS = ["GitHub", "Notion", "Codex CLI (OpenAI)"];

const TARGETS: Target[] = [
  {
    title: "IncidentWorkbench",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Python", "React", "Tauri", "TypeScript"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management", "Slack", "Ollama"],
  },
  {
    title: "KBFreshnessDetector",
    researchTitles: [...COMMON_RESEARCH, "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs"],
    skillTitles: ["Rust", "React", "TypeScript", "REST APIs"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
  },
];

async function run(flags: Flags): Promise<void> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for KB support-rollup repair");
  }

  const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
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
  const researchProjectIds = new Map(
    researchPages.map((page) => [page.id, relationIds(page.properties["Related Local Projects"])]),
  );
  const skillProjectIds = new Map(
    skillPages.map((page) => [page.id, relationIds(page.properties["Related Local Projects"])]),
  );
  const toolProjectIds = new Map(
    toolPages.map((page) => [page.id, relationIds(page.properties["Linked Local Projects"])]),
  );

  const results = [];

  for (const target of TARGETS) {
    const projectPage = requirePage(projectByTitle, target.title, "project");
    const researchIds = uniqueIds(target.researchTitles.map((title) => requirePage(researchByTitle, title, "research").id));
    const skillIds = uniqueIds(target.skillTitles.map((title) => requirePage(skillByTitle, title, "skill").id));
    const toolIds = uniqueIds(target.toolTitles.map((title) => requirePage(toolByTitle, title, "tool").id));

    if (flags.live) {
      await api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          "Date Updated": { date: { start: flags.today } },
          "Related Research": relationValue(researchIds),
          "Supporting Skills": relationValue(skillIds),
          "Tool Stack Records": relationValue(toolIds),
          "Related Research Count": { number: researchIds.length },
          "Supporting Skills Count": { number: skillIds.length },
          "Linked Tool Count": { number: toolIds.length },
        },
      });
    }

    results.push({
      title: target.title,
      projectId: projectPage.id,
      researchIds,
      skillIds,
      toolIds,
    });
  }

  if (flags.live) {
    for (const result of results) {
      for (const pageId of result.researchIds) {
        const nextIds = uniqueIds([...(researchProjectIds.get(pageId) ?? []), result.projectId]);
        await api.updatePageProperties({
          pageId,
          properties: {
            "Related Local Projects": relationValue(nextIds),
          },
        });
      }
      for (const pageId of result.skillIds) {
        const nextIds = uniqueIds([...(skillProjectIds.get(pageId) ?? []), result.projectId]);
        await api.updatePageProperties({
          pageId,
          properties: {
            "Related Local Projects": relationValue(nextIds),
          },
        });
      }
      for (const pageId of result.toolIds) {
        const nextIds = uniqueIds([...(toolProjectIds.get(pageId) ?? []), result.projectId]);
        await api.updatePageProperties({
          pageId,
          properties: {
            "Linked Local Projects": relationValue(nextIds),
          },
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        live: flags.live,
        today: flags.today,
        results: results.map((result) => ({
          title: result.title,
          relatedResearchCount: result.researchIds.length,
          supportingSkillsCount: result.skillIds.length,
          linkedToolCount: result.toolIds.length,
        })),
      },
      null,
      2,
    ),
  );
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

function parseFlags(argv: string[]): Flags {
  let live = false;
  let today = losAngelesToday();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
    }
  }

  return { live, today };
}

async function main(): Promise<void> {
  try {
    await run(parseFlags(process.argv.slice(2)));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("fix-kb-support-rollups.ts")) {
  void main();
}
