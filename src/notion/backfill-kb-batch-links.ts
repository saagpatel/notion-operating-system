import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  multiSelectValue,
  relationIds,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface BatchTarget {
  title: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
  buildSession: {
    title: string;
    type: string;
    outcome: string;
    planned: string;
    shipped: string;
    blockers: string;
    lessons: string;
    nextSteps: string;
    tags: string[];
    tools: string[];
    artifacts: string[];
    scopeDrift: string;
    rating: string;
    followUpNeeded: boolean;
    markdown: string;
  };
}

interface Flags {
  live: boolean;
  today: string;
}

const COMMON_RESEARCH = ["Governed GitHub Issues Should Match the Current Execution Slice"];
const COMMON_TOOLS = ["GitHub", "Notion", "Codex CLI (OpenAI)"];
const COMMON_BUILD_TAGS = ["portfolio", "github", "notion"];
const COMMON_BUILD_ARTIFACTS = ["notion", "github", "build-log"];

const TARGETS: BatchTarget[] = [
  {
    title: "knowledgecore",
    researchTitles: [...COMMON_RESEARCH, "Tauri 2 plus React plus Rust Is the Default Local App Stack"],
    skillTitles: ["Rust", "Tauri", "TypeScript"],
    toolTitles: COMMON_TOOLS,
    buildSession: {
      title: "GitHub publish + operating refresh - knowledgecore",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the safe workspace-command fixes to GitHub and reconnect knowledgecore to the Notion operating layer with real support records.",
      shipped:
        "Published the command-surface repair on GitHub, linked research and skills, and attached a build-log checkpoint so the project is no longer floating outside the operating flow.",
      blockers:
        "Desktop validation still needs a real run after the root package removal, and the project remains a higher-friction setup than the rest of this batch.",
      lessons:
        "This repo was blocked more by stale operating assumptions than by missing code; getting the canonical run surface truthful mattered first.",
      nextSteps:
        "Run the desktop happy path, confirm the Rust workspace gate, and decide whether the current evidence is now strong enough to move beyond the existing readiness caution.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app"],
      tools: COMMON_TOOLS,
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# GitHub publish + operating refresh - knowledgecore",
        "",
        "## What Was Planned",
        "Publish the safe workspace-command fixes to GitHub and reconnect knowledgecore to the Notion operating layer with real support records.",
        "",
        "## What Shipped",
        "Published the command-surface repair on GitHub, linked research and skills, and attached a build-log checkpoint so the project is no longer floating outside the operating flow.",
        "",
        "## Blockers",
        "Desktop validation still needs a real run after the root package removal, and the project remains a higher-friction setup than the rest of this batch.",
        "",
        "## Lessons",
        "This repo was blocked more by stale operating assumptions than by missing code; getting the canonical run surface truthful mattered first.",
        "",
        "## Next Steps",
        "Run the desktop happy path, confirm the Rust workspace gate, and decide whether the current evidence is now strong enough to move beyond the existing readiness caution.",
      ].join("\n"),
    },
  },
  {
    title: "IncidentWorkbench",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Python", "React", "Tauri", "TypeScript"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management", "Slack", "Ollama"],
    buildSession: {
      title: "GitHub publish + operating refresh - IncidentWorkbench",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the lockfile and GitHub wiring work, then attach the execution support records that make IncidentWorkbench visible inside the operating flow.",
      shipped:
        "Pushed the frontend lockfile sync to GitHub and linked the repo to reusable research, skills, tools, and a fresh build-log checkpoint in Notion.",
      blockers:
        "The backend verification bundle still depends on hydrating the Python environment, and the finish call still needs the backend lane to run clean.",
      lessons:
        "This project is close enough to finish that small environment gaps matter more than feature gaps.",
      nextSteps:
        "Create the backend virtualenv, run the Python verification bundle, and confirm the finish posture with one end-to-end report generation pass.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app"],
      tools: [...COMMON_TOOLS, "Jira Service Management", "Slack", "Ollama"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Great",
      followUpNeeded: true,
      markdown: [
        "# GitHub publish + operating refresh - IncidentWorkbench",
        "",
        "## What Was Planned",
        "Publish the lockfile and GitHub wiring work, then attach the execution support records that make IncidentWorkbench visible inside the operating flow.",
        "",
        "## What Shipped",
        "Pushed the frontend lockfile sync to GitHub and linked the repo to reusable research, skills, tools, and a fresh build-log checkpoint in Notion.",
        "",
        "## Blockers",
        "The backend verification bundle still depends on hydrating the Python environment, and the finish call still needs the backend lane to run clean.",
        "",
        "## Lessons",
        "This project is close enough to finish that small environment gaps matter more than feature gaps.",
        "",
        "## Next Steps",
        "Create the backend virtualenv, run the Python verification bundle, and confirm the finish posture with one end-to-end report generation pass.",
      ].join("\n"),
    },
  },
  {
    title: "KBFreshnessDetector",
    researchTitles: [...COMMON_RESEARCH, "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs"],
    skillTitles: ["Rust", "React", "TypeScript", "REST APIs"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
    buildSession: {
      title: "GitHub publish + operating refresh - KBFreshnessDetector",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the repaired verification and perf workflow surface, then reflect the repo's real supporting context in the Notion operating layer.",
      shipped:
        "Pushed the npm-based workflow repairs to GitHub and linked the project to relevant research, skills, tools, and a build-log checkpoint in Notion.",
      blockers:
        "The branch now has a real verification bundle, but the product still needs one live freshness scan and follow-through on the remaining workflow hardening.",
      lessons:
        "A repo can look active in GitHub while still missing the support records that make its operating picture legible in Notion.",
      nextSteps:
        "Run a real freshness scan with live sources, confirm the repaired workflows on GitHub, and tighten any remaining mainline failures into an explicit next slice.",
      tags: [...COMMON_BUILD_TAGS, "knowledge-base"],
      tools: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Great",
      followUpNeeded: true,
      markdown: [
        "# GitHub publish + operating refresh - KBFreshnessDetector",
        "",
        "## What Was Planned",
        "Publish the repaired verification and perf workflow surface, then reflect the repo's real supporting context in the Notion operating layer.",
        "",
        "## What Shipped",
        "Pushed the npm-based workflow repairs to GitHub and linked the project to relevant research, skills, tools, and a build-log checkpoint in Notion.",
        "",
        "## Blockers",
        "The branch now has a real verification bundle, but the product still needs one live freshness scan and follow-through on the remaining workflow hardening.",
        "",
        "## Lessons",
        "A repo can look active in GitHub while still missing the support records that make its operating picture legible in Notion.",
        "",
        "## Next Steps",
        "Run a real freshness scan with live sources, confirm the repaired workflows on GitHub, and tighten any remaining mainline failures into an explicit next slice.",
      ].join("\n"),
    },
  },
  {
    title: "PersonalKBDrafter",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "Tauri", "React", "Jira/JSM", "Confluence", "Prompt Engineering"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
    buildSession: {
      title: "GitHub publish + operating refresh - PersonalKBDrafter",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the safe CI repair for the Tauri workflow and connect the project back to the fuller operating record in Notion.",
      shipped:
        "Pushed the workflow fix to GitHub and linked the project to matching research, skills, tools, and a build-log checkpoint in Notion.",
      blockers:
        "The local happy path still needs a fresh authenticated Jira-to-draft-to-Confluence validation, and the larger in-flight worktree remains unpublished.",
      lessons:
        "The right publish move here was narrow: land the CI fix without bundling the larger active feature slice.",
      nextSteps:
        "Validate the live drafting flow end to end, separate the remaining product changes into clean slices, and keep the GitHub lane aligned with that narrower execution plan.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app", "knowledge-base"],
      tools: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# GitHub publish + operating refresh - PersonalKBDrafter",
        "",
        "## What Was Planned",
        "Publish the safe CI repair for the Tauri workflow and connect the project back to the fuller operating record in Notion.",
        "",
        "## What Shipped",
        "Pushed the workflow fix to GitHub and linked the project to matching research, skills, tools, and a build-log checkpoint in Notion.",
        "",
        "## Blockers",
        "The local happy path still needs a fresh authenticated Jira-to-draft-to-Confluence validation, and the larger in-flight worktree remains unpublished.",
        "",
        "## Lessons",
        "The right publish move here was narrow: land the CI fix without bundling the larger active feature slice.",
        "",
        "## Next Steps",
        "Validate the live drafting flow end to end, separate the remaining product changes into clean slices, and keep the GitHub lane aligned with that narrower execution plan.",
      ].join("\n"),
    },
  },
  {
    title: "ScreenshotAnnotate",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
    ],
    skillTitles: ["Rust", "Tauri", "React", "TypeScript"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management"],
    buildSession: {
      title: "GitHub publish + operating refresh - ScreenshotAnnotate",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the safe verification-bundle change and reconnect ScreenshotAnnotate to the supporting records it needs in the Notion operating flow.",
      shipped:
        "Pushed the verification-bundle update to GitHub and linked the project to supporting research, skills, tools, and a build-log checkpoint in Notion.",
      blockers:
        "The main app feature slice is still larger than the one file I published, and the real macOS capture-to-save happy path still needs to be rerun after the broader work lands.",
      lessons:
        "For a repo with a large active worktree, a narrow verification commit is still useful as long as Notion clearly says the feature slice is still in progress.",
      nextSteps:
        "Publish the remaining app-validation and product slice in clean chunks, then rerun the real screenshot capture and save flow on macOS.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app"],
      tools: [...COMMON_TOOLS, "Jira Service Management"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# GitHub publish + operating refresh - ScreenshotAnnotate",
        "",
        "## What Was Planned",
        "Publish the safe verification-bundle change and reconnect ScreenshotAnnotate to the supporting records it needs in the Notion operating flow.",
        "",
        "## What Shipped",
        "Pushed the verification-bundle update to GitHub and linked the project to supporting research, skills, tools, and a build-log checkpoint in Notion.",
        "",
        "## Blockers",
        "The main app feature slice is still larger than the one file I published, and the real macOS capture-to-save happy path still needs to be rerun after the broader work lands.",
        "",
        "## Lessons",
        "For a repo with a large active worktree, a narrow verification commit is still useful as long as Notion clearly says the feature slice is still in progress.",
        "",
        "## Next Steps",
        "Publish the remaining app-validation and product slice in clean chunks, then rerun the real screenshot capture and save flow on macOS.",
      ].join("\n"),
    },
  },
];

async function run(flags: Flags): Promise<void> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for KB batch link backfill");
  }

  const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);

  const [projectSchema, buildSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.buildLogId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, buildPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  const buildByTitle = new Map(buildPages.map((page) => [page.title, page]));
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
    const researchIds = uniqueIds([
      ...relationIds(projectPage.properties["Related Research"]),
      ...target.researchTitles.map((title) => requirePage(researchByTitle, title, "research").id),
    ]);
    const skillIds = uniqueIds([
      ...relationIds(projectPage.properties["Supporting Skills"]),
      ...target.skillTitles.map((title) => requirePage(skillByTitle, title, "skill").id),
    ]);
    const toolIds = uniqueIds([
      ...relationIds(projectPage.properties["Tool Stack Records"]),
      ...target.toolTitles.map((title) => requirePage(toolByTitle, title, "tool").id),
    ]);

    const existingBuild = buildByTitle.get(target.buildSession.title);
    const buildPage = flags.live
      ? await upsertPageByTitle({
          api,
          dataSourceId: config.relatedDataSources.buildLogId,
          titlePropertyName: buildSchema.titlePropertyName,
          title: target.buildSession.title,
          properties: {
            [buildSchema.titlePropertyName]: titleValue(target.buildSession.title),
            "Session Date": { date: { start: flags.today } },
            "Session Type": selectPropertyValue(target.buildSession.type),
            Outcome: selectPropertyValue(target.buildSession.outcome),
            "What Was Planned": richTextValue(target.buildSession.planned),
            "What Shipped": richTextValue(target.buildSession.shipped),
            "Blockers Hit": richTextValue(target.buildSession.blockers),
            "Lessons Learned": richTextValue(target.buildSession.lessons),
            "Next Steps": richTextValue(target.buildSession.nextSteps),
            "Tools Used": multiSelectValue(target.buildSession.tools),
            "Artifacts Updated": multiSelectValue(target.buildSession.artifacts),
            Tags: multiSelectValue(target.buildSession.tags),
            "Scope Drift": selectPropertyValue(target.buildSession.scopeDrift),
            "Session Rating": selectPropertyValue(target.buildSession.rating),
            "Follow-up Needed": { checkbox: target.buildSession.followUpNeeded },
            "Local Project": relationValue([projectPage.id]),
            Duration: richTextValue(""),
            "Model Used": { select: null },
            "Tech Debt Created": richTextValue(""),
          },
          markdown: target.buildSession.markdown,
        })
      : {
          id: existingBuild?.id ?? `dry-run-build-${projectPage.id}`,
          url: existingBuild?.url ?? "",
          existed: Boolean(existingBuild?.id),
        };

    const buildSessionIds = uniqueIds([...relationIds(projectPage.properties["Build Sessions"]), buildPage.id]);

    if (flags.live) {
      await api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          "Date Updated": { date: { start: flags.today } },
          "Related Research": relationValue(researchIds),
          "Supporting Skills": relationValue(skillIds),
          "Tool Stack Records": relationValue(toolIds),
          "Build Sessions": relationValue(buildSessionIds),
          "Related Research Count": { number: researchIds.length },
          "Supporting Skills Count": { number: skillIds.length },
          "Linked Tool Count": { number: toolIds.length },
          "Last Build Session": richTextValue(target.buildSession.title),
          "Last Build Session Date": { date: { start: flags.today } },
          "Build Session Count": { number: buildSessionIds.length },
        },
      });
    }

    results.push({
      title: target.title,
      projectId: projectPage.id,
      researchIds,
      skillIds,
      toolIds,
      buildPageId: buildPage.id,
    });
  }

  if (flags.live) {
    for (const result of results) {
      for (const pageId of result.researchIds) {
        const nextIds = uniqueIds([...(researchProjectIds.get(pageId) ?? []), result.projectId]);
        researchProjectIds.set(pageId, nextIds);
        await api.updatePageProperties({
          pageId,
          properties: {
            "Related Local Projects": relationValue(nextIds),
          },
        });
      }
      for (const pageId of result.skillIds) {
        const nextIds = uniqueIds([...(skillProjectIds.get(pageId) ?? []), result.projectId]);
        skillProjectIds.set(pageId, nextIds);
        await api.updatePageProperties({
          pageId,
          properties: {
            "Related Local Projects": relationValue(nextIds),
          },
        });
      }
      for (const pageId of result.toolIds) {
        const nextIds = uniqueIds([...(toolProjectIds.get(pageId) ?? []), result.projectId]);
        toolProjectIds.set(pageId, nextIds);
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
          buildSessionCount: 1,
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

if (process.argv[1]?.endsWith("backfill-kb-batch-links.ts")) {
  void main();
}
