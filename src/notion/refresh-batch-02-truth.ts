import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  richTextValue,
  selectPropertyValue,
} from "./local-portfolio-control-tower-live.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

interface RefreshTarget {
  title: string;
  write: boolean;
  currentState?: "Active Build";
  portfolioCall?: "Finish";
  runsLocally?: "Unknown";
  biggestBlocker?: string;
  nextMove?: string;
  openPrCount: number;
  recentFailedWorkflowRuns: number;
  latestExternalActivity?: string;
  externalSignalUpdated?: string;
}

interface Flags {
  live: boolean;
}

const TODAY = losAngelesToday();

const TARGETS: RefreshTarget[] = [
  {
    title: "OrbitForge",
    write: false,
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "PomGambler",
    write: false,
    openPrCount: 0,
    recentFailedWorkflowRuns: 0,
  },
  {
    title: "ContentEngine",
    write: true,
    currentState: "Active Build",
    portfolioCall: "Finish",
    runsLocally: "Unknown",
    biggestBlocker:
      "The repo is active again, with a dirty local working tree plus two open dependency PRs and eight recent failed workflow runs still obscuring the next finish slice.",
    nextMove:
      "Treat ContentEngine as an active finish lane, narrow the current dirty repo into one bounded publishable slice, and decide which dependency or workflow noise matters for that slice.",
    openPrCount: 2,
    recentFailedWorkflowRuns: 8,
    latestExternalActivity: "2026-03-22",
    externalSignalUpdated: TODAY,
  },
  {
    title: "FreeLanceInvoice",
    write: true,
    currentState: "Active Build",
    portfolioCall: "Finish",
    runsLocally: "Unknown",
    biggestBlocker:
      "The repo is active again, but the local working tree is still heavily dirty and two open dependency PRs still sit on top of the finish lane.",
    nextMove:
      "Treat FreeLanceInvoice as an active finish lane, define the next bounded slice from the current dirty repo, and decide which dependency PRs should stay separate from that work.",
    openPrCount: 2,
    recentFailedWorkflowRuns: 0,
    latestExternalActivity: "2026-03-22",
    externalSignalUpdated: TODAY,
  },
  {
    title: "StatusPage",
    write: true,
    currentState: "Active Build",
    portfolioCall: "Finish",
    runsLocally: "Unknown",
    biggestBlocker:
      "The repo is active again, with one open dependency PR and seven recent failed workflow runs still making the next finish slice noisy even though the local repo is clean on main.",
    nextMove:
      "Treat StatusPage as an active finish lane, choose the next bounded slice from the live main branch, and separate the dependency and workflow noise from the product work that actually needs finishing.",
    openPrCount: 1,
    recentFailedWorkflowRuns: 7,
    latestExternalActivity: "2026-03-22",
    externalSignalUpdated: TODAY,
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for batch-02 truth refresh");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig("./config/local-portfolio-control-tower.json");
    const api = new DirectNotionClient(token);
    const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });

    const projectSchema = await api.retrieveDataSource(config.database.dataSourceId);
    const projectPages = await fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName);
    const projectByTitle = new Map(projectPages.map((page) => [page.title, page] as const));

    const results: Array<Record<string, unknown>> = [];

    for (const target of TARGETS) {
      const page = projectByTitle.get(target.title);
      if (!page) {
        throw new AppError(`Could not find project page for "${target.title}"`);
      }

      if (flags.live && target.write) {
        await api.updatePageProperties({
          pageId: page.id,
          properties: {
            "Date Updated": { date: { start: TODAY } },
            "Current State": selectPropertyValue(target.currentState),
            "Portfolio Call": selectPropertyValue(target.portfolioCall),
            "Needs Review": { checkbox: false },
            "Runs Locally": selectPropertyValue(target.runsLocally),
            "Biggest Blocker": richTextValue(target.biggestBlocker ?? ""),
            "Next Move": richTextValue(target.nextMove ?? ""),
            "Open PR Count": { number: target.openPrCount },
            "Recent Failed Workflow Runs": { number: target.recentFailedWorkflowRuns },
            "Latest External Activity": target.latestExternalActivity
              ? { date: { start: target.latestExternalActivity } }
              : { date: null },
            "External Signal Updated": target.externalSignalUpdated
              ? { date: { start: target.externalSignalUpdated } }
              : { date: null },
          },
        });
      }

      results.push({
        title: target.title,
        write: target.write,
        openPrCount: target.openPrCount,
        recentFailedWorkflowRuns: target.recentFailedWorkflowRuns,
        dateUpdated: TODAY,
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
  return {
    live: argv.includes("--live"),
  };
}

if (process.argv[1]?.endsWith("refresh-batch-02-truth.ts")) {
  void main();
}
