import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  relationValue,
  richTextValue,
  selectPropertyValue,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface RefreshTarget {
  title: string;
  runsLocally: "Yes" | "Partial" | "Unknown";
  biggestBlocker: string;
  nextMove: string;
  toolTitles: string[];
  openPrCount: number;
  recentFailedWorkflowRuns: number;
}

interface Flags {
  live: boolean;
}

const TODAY = losAngelesToday();
const COMMON_TOOL_TITLES = ["GitHub", "Notion", "Codex CLI (OpenAI)"];

const TARGETS: RefreshTarget[] = [
  {
    title: "SlackIncidentBot",
    runsLocally: "Partial",
    biggestBlocker:
      "GitHub CI and Docker are green, but the project still lacks fresh local runtime proof for the Slack plus PostgreSQL happy path.",
    nextMove:
      "Run the bot locally with real Slack and PostgreSQL configuration, verify the health path and first incident flow, then record the first blocker or green proof.",
    toolTitles: [...COMMON_TOOL_TITLES, "Slack", "PostgreSQL"],
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "SmartClipboard",
    runsLocally: "Partial",
    biggestBlocker:
      "The npm install baseline is incomplete, so the repo cannot yet reach a truthful local build or app run.",
    nextMove:
      "Restore the npm install baseline, rerun the primary build path, and capture the first blocker that survives setup cleanup.",
    toolTitles: COMMON_TOOL_TITLES,
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "SnippetLibrary",
    runsLocally: "Yes",
    biggestBlocker:
      "swift build and swift test pass, but the current dirty tree still needs to be narrowed into a governed execution slice.",
    nextMove:
      "Keep the passing Swift baseline, define the first small execution slice from the dirty tree, and record the first blocker or green proof.",
    toolTitles: [...COMMON_TOOL_TITLES, "Ollama"],
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "TicketDashboard",
    runsLocally: "Partial",
    biggestBlocker:
      "The npm install baseline is incomplete, so the desktop build path cannot yet produce a truthful finish check.",
    nextMove:
      "Restore the npm install baseline, rerun the desktop build path, and capture the first blocker that survives setup cleanup.",
    toolTitles: [...COMMON_TOOL_TITLES, "Jira Service Management"],
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "TicketDocumentation",
    runsLocally: "Partial",
    biggestBlocker:
      "The pnpm install baseline is incomplete, so the repo still cannot reach a truthful local build and first blocker beyond setup drift.",
    nextMove:
      "Restore the pnpm install baseline, rerun the build path, and capture the first blocker that survives setup cleanup.",
    toolTitles: [...COMMON_TOOL_TITLES, "Ollama", "Jira Service Management"],
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for governance batch truth refresh");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, toolSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
    ]);

    const [projectPages, toolPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    ]);

    const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const toolByTitle = new Map(toolPages.map((page) => [page.title, page]));

    const results: Array<Record<string, unknown>> = [];

    for (const target of TARGETS) {
      const project = projectByTitle.get(target.title);
      if (!project) {
        throw new AppError(`Missing project page for ${target.title}`);
      }

      const toolIds = target.toolTitles.map((title) => {
        const tool = toolByTitle.get(title);
        if (!tool) {
          throw new AppError(`Missing tool page for ${title}`);
        }
        return tool.id;
      });

      if (flags.live) {
        await api.updatePageProperties({
          pageId: project.id,
          properties: {
            "Date Updated": { date: { start: TODAY } },
            "Runs Locally": selectPropertyValue(target.runsLocally),
            "Biggest Blocker": richTextValue(target.biggestBlocker),
            "Next Move": richTextValue(target.nextMove),
            "Tool Stack Records": relationValue(toolIds),
            "Linked Tool Count": { number: toolIds.length },
            "Open PR Count": { number: target.openPrCount },
            "Recent Failed Workflow Runs": { number: target.recentFailedWorkflowRuns },
            "Latest External Activity": { date: { start: TODAY } },
            "External Signal Updated": { date: { start: TODAY } },
          },
        });
      }

      results.push({
        title: target.title,
        runsLocally: target.runsLocally,
        toolCount: toolIds.length,
        openPrCount: target.openPrCount,
        recentFailedWorkflowRuns: target.recentFailedWorkflowRuns,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          today: TODAY,
          results,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

function parseFlags(argv: string[]): Flags {
  let live = false;
  for (const arg of argv) {
    if (arg === "--live") {
      live = true;
    }
  }
  return { live };
}

if (process.argv[1]?.endsWith("refresh-governance-batch-truth.ts")) {
  void main();
}
