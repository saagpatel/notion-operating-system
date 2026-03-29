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
  projectUpdate: {
    biggestBlocker: string;
    nextMove: string;
    runsLocally: string;
    shipReadiness: string;
  };
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
    projectUpdate: {
      biggestBlocker: "The desktop launch still needs a real pass after the stale root package shim was removed.",
      nextMove:
        "Run the desktop launch from the desktop workspace and decide whether the remaining doc-only edits belong in a separate follow-up publish.",
      runsLocally: "Partial",
      shipReadiness: "Not Ready",
    },
    buildSession: {
      title: "Workspace cleanup publish - knowledgecore",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Publish the broader workspace cleanup slice so the canonical run surface matches the real desktop workspace layout.",
      shipped:
        "Removed the stale root package shim, updated the lean dev launcher to target the desktop workspace, and pushed the cleanup slice to GitHub.",
      blockers:
        "The desktop happy path still needs a real launch pass, and the remaining local AGENTS or docpack edits were intentionally left out of this publish.",
      lessons:
        "When a monorepo entrypoint drifts away from the real workspace, a small cleanup slice can unlock more readiness truth than another feature would.",
      nextSteps:
        "Run the desktop launch flow from the desktop workspace, then decide whether the remaining doc-only edits belong in a separate follow-up publish.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app"],
      tools: COMMON_TOOLS,
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# Workspace cleanup publish - knowledgecore",
        "",
        "## What Was Planned",
        "Publish the broader workspace cleanup slice so the canonical run surface matches the real desktop workspace layout.",
        "",
        "## What Shipped",
        "Removed the stale root package shim, updated the lean dev launcher to target the desktop workspace, and pushed the cleanup slice to GitHub.",
        "",
        "## Blockers",
        "The desktop happy path still needs a real launch pass, and the remaining local AGENTS or docpack edits were intentionally left out of this publish.",
        "",
        "## Lessons",
        "When a monorepo entrypoint drifts away from the real workspace, a small cleanup slice can unlock more readiness truth than another feature would.",
        "",
        "## Next Steps",
        "Run the desktop launch flow from the desktop workspace, then decide whether the remaining doc-only edits belong in a separate follow-up publish.",
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
    projectUpdate: {
      biggestBlocker:
        "The published branch still needs a fresh authenticated Jira-to-draft-to-Confluence happy-path run, but the Confluence URL persistence gap is now closed.",
      nextMove:
        "Run the live Jira-to-draft-to-Confluence flow and confirm the relaunch or reconnect path now survives without losing the publish URL context.",
      runsLocally: "Partial",
      shipReadiness: "Needs Hardening",
    },
    buildSession: {
      title: "Confluence persistence publish - PersonalKBDrafter",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Close the reconnect gap in the publish path by persisting Confluence base URLs alongside the existing Jira-backed settings flow.",
      shipped:
        "Pushed the Confluence URL persistence fix, added backend fallback for status, space loading, and publish calls, and tightened disconnect behavior so stale frontend URLs are cleared.",
      blockers:
        "The authenticated Jira-to-draft-to-Confluence happy path still needs a fresh live run, but the relaunch and reconnect settings path is now stronger than it was before this slice.",
      lessons:
        "Persisting service URLs in one place matters more than it first appears when publish dialogs and connection badges depend on them after relaunch.",
      nextSteps:
        "Run the live Jira-to-draft-to-Confluence flow with real credentials and confirm Confluence reconnect, space loading, and publish behavior all survive relaunch cleanly.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app", "knowledge-base"],
      tools: [...COMMON_TOOLS, "Jira Service Management", "Confluence", "Ollama"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# Confluence persistence publish - PersonalKBDrafter",
        "",
        "## What Was Planned",
        "Close the reconnect gap in the publish path by persisting Confluence base URLs alongside the existing Jira-backed settings flow.",
        "",
        "## What Shipped",
        "Pushed the Confluence URL persistence fix, added backend fallback for status, space loading, and publish calls, and tightened disconnect behavior so stale frontend URLs are cleared.",
        "",
        "## Blockers",
        "The authenticated Jira-to-draft-to-Confluence happy path still needs a fresh live run, but the relaunch and reconnect settings path is now stronger than it was before this slice.",
        "",
        "## Lessons",
        "Persisting service URLs in one place matters more than it first appears when publish dialogs and connection badges depend on them after relaunch.",
        "",
        "## Next Steps",
        "Run the live Jira-to-draft-to-Confluence flow with real credentials and confirm Confluence reconnect, space loading, and publish behavior all survive relaunch cleanly.",
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
    projectUpdate: {
      biggestBlocker:
        "The published branch still needs a real macOS capture-to-save happy-path run, but the Tauri payload boundary now matches the React app's expected shape.",
      nextMove:
        "Run the real macOS capture-to-save flow and confirm history thumbnails, ticket metadata, and upload badges now survive end to end.",
      runsLocally: "Partial",
      shipReadiness: "Needs Hardening",
    },
    buildSession: {
      title: "Payload boundary publish - ScreenshotAnnotate",
      type: "Build",
      outcome: "Shipped",
      planned:
        "Close the backend-to-frontend payload mismatch so capture, export, and history objects arrive in the shape the React app already expects.",
      shipped:
        "Pushed camelCase serialization for capture, export, history, and storage payloads, plus regression tests that lock the Tauri boundary to the UI contract.",
      blockers:
        "The real macOS capture-to-save happy path still needs a fresh run, but the data-shape mismatch that could quietly break thumbnails and metadata is now closed.",
      lessons:
        "Desktop apps can look healthy while the Rust-to-React boundary quietly drifts; contract-level serialization checks pay for themselves quickly.",
      nextSteps:
        "Rerun the real macOS capture-to-save flow and confirm the saved history view now shows thumbnails, timestamps, and upload metadata correctly.",
      tags: [...COMMON_BUILD_TAGS, "desktop-app"],
      tools: [...COMMON_TOOLS, "Jira Service Management"],
      artifacts: COMMON_BUILD_ARTIFACTS,
      scopeDrift: "None",
      rating: "Good",
      followUpNeeded: true,
      markdown: [
        "# Payload boundary publish - ScreenshotAnnotate",
        "",
        "## What Was Planned",
        "Close the backend-to-frontend payload mismatch so capture, export, and history objects arrive in the shape the React app already expects.",
        "",
        "## What Shipped",
        "Pushed camelCase serialization for capture, export, history, and storage payloads, plus regression tests that lock the Tauri boundary to the UI contract.",
        "",
        "## Blockers",
        "The real macOS capture-to-save happy path still needs a fresh run, but the data-shape mismatch that could quietly break thumbnails and metadata is now closed.",
        "",
        "## Lessons",
        "Desktop apps can look healthy while the Rust-to-React boundary quietly drifts; contract-level serialization checks pay for themselves quickly.",
        "",
        "## Next Steps",
        "Rerun the real macOS capture-to-save flow and confirm the saved history view now shows thumbnails, timestamps, and upload metadata correctly.",
      ].join("\n"),
    },
  },
];

async function run(flags: Flags): Promise<void> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for KB large-slice link backfill");
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
          "Biggest Blocker": richTextValue(target.projectUpdate.biggestBlocker),
          "Next Move": richTextValue(target.projectUpdate.nextMove),
          "Runs Locally": selectPropertyValue(target.projectUpdate.runsLocally),
          "Ship Readiness": selectPropertyValue(target.projectUpdate.shipReadiness),
        },
      });
    }

    results.push({
      title: target.title,
      projectId: projectPage.id,
      researchIds,
      skillIds,
      toolIds,
      buildSessionIds,
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
          buildSessionCount: result.buildSessionIds.length,
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

if (process.argv[1]?.endsWith("backfill-kb-large-slice-links.ts")) {
  void main();
}
