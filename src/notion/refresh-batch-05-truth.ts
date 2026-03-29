import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import { fetchAllPages, richTextValue } from "./local-portfolio-control-tower-live.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

interface RefreshTarget {
  title: string;
  biggestBlocker: string;
  nextMove: string;
  openPrCount: number;
  recentFailedWorkflowRuns: number;
}

interface Flags {
  live: boolean;
}

const TODAY = losAngelesToday();

const TARGETS: RefreshTarget[] = [
  {
    title: "ApplyKit",
    biggestBlocker:
      "Mainline verify is green and the repo now passes the local verify path; the only recurring GitHub failure still active is the schedule-only scorecard job, while the preserved dirty tree still needs to be narrowed into one publishable local release-candidate slice.",
    nextMove:
      "Turn the current packet-detail, export, and local release-candidate validation work into one publishable slice, and treat the schedule-only scorecard lane as follow-up automation rather than a product blocker.",
    openPrCount: 0,
    recentFailedWorkflowRuns: 11,
  },
  {
    title: "AuraForge",
    biggestBlocker:
      "The root repo builds and tests cleanly, and the former Dependabot PR was closed so it no longer blocks readiness; the remaining work is narrowing the preserved dirty tree into the next publishable product slice.",
    nextMove:
      "Continue the current desktop authoring and quality slice from the canonical root repo, and revisit dependency maintenance in a dedicated follow-up lane instead of treating it as a release blocker.",
    openPrCount: 0,
    recentFailedWorkflowRuns: 10,
  },
  {
    title: "IncidentReview",
    biggestBlocker:
      "The root repo now passes the canonical UI, unit, contract, and smoke gates, and the release-please plus dependency PR lanes were closed; the remaining work is the current UI and report slice while schedule-only scorecard and mutation jobs stay outside ship readiness.",
    nextMove:
      "Resume the current UI and report slice from the canonical root repo, and revisit release automation, dependency maintenance, and mutation testing as explicit follow-up lanes rather than current blockers.",
    openPrCount: 0,
    recentFailedWorkflowRuns: 12,
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for batch-05 truth refresh");
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

      if (flags.live) {
        await api.updatePageProperties({
          pageId: page.id,
          properties: {
            "Date Updated": { date: { start: TODAY } },
            "Biggest Blocker": richTextValue(target.biggestBlocker),
            "Next Move": richTextValue(target.nextMove),
            "Open PR Count": { number: target.openPrCount },
            "Recent Failed Workflow Runs": { number: target.recentFailedWorkflowRuns },
            "Latest External Activity": { date: { start: TODAY } },
            "External Signal Updated": { date: { start: TODAY } },
          },
        });
      }

      results.push({
        title: target.title,
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

if (process.argv[1]?.endsWith("refresh-batch-05-truth.ts")) {
  void main();
}
