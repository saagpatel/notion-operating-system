import "dotenv/config";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
} from "./local-portfolio-control-tower.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH,
} from "./local-portfolio-external-signals.js";
import {
  runGitHubKnowledgeAudit,
  type GitHubKnowledgeAuditFlags,
} from "./github-knowledge-audit.js";
import {
  runSupportDatabaseHygienePass,
  type SupportDatabaseHygieneFlags,
} from "./support-database-hygiene-pass.js";

const TODAY = losAngelesToday();
const DEFAULT_OWNER = "saagpatel";

interface Flags {
  live: boolean;
  owner: string;
  limit: number;
  today: string;
  config: string;
  sourceConfig: string;
}

function parseFlags(argv: string[]): Flags {
  let live = false;
  let owner = DEFAULT_OWNER;
  let limit = 200;
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
      limit = Number(argv[index + 1] ?? limit);
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

  return { live, owner, limit, today, config, sourceConfig };
}

async function main(): Promise<void> {
  try {
    const flags = parseFlags(process.argv.slice(2));
    const output = await runGitHubSupportMaintenance(flags);
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runGitHubSupportMaintenance(flags: Flags): Promise<Record<string, unknown>> {
  const githubFlags: GitHubKnowledgeAuditFlags = {
    live: flags.live,
    owner: flags.owner,
    limit: flags.limit,
    today: flags.today,
    config: flags.config,
    sourceConfig: flags.sourceConfig,
  };
  const supportFlags: SupportDatabaseHygieneFlags = {
    live: flags.live,
    today: flags.today,
    config: flags.config,
  };

  const githubKnowledgeAudit = await runGitHubKnowledgeAudit(githubFlags);
  const supportDatabaseHygiene = await runSupportDatabaseHygienePass(supportFlags);

  return {
    ok: true,
    live: flags.live,
    owner: flags.owner,
    today: flags.today,
    githubKnowledgeAudit,
    supportDatabaseHygiene,
  };
}

if (process.argv[1]?.endsWith("github-support-maintenance.ts")) {
  void main();
}
