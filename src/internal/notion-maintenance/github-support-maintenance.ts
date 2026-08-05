import "../../config/load-default-env.js";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH,
} from "../../notion/local-portfolio-external-signals.js";
import {
  runGitHubKnowledgeAudit,
  type GitHubKnowledgeAuditFlags,
} from "./github-knowledge-audit.js";
import {
  runSupportDatabaseHygienePass,
  type SupportDatabaseHygieneFlags,
} from "./support-database-hygiene-pass.js";
import { loadEnvelope } from "./irreversible-action.js";
import { buildWeeklyStepContract, mapWeeklyStepStatusToCommandStatus } from "../../notion/weekly-refresh-contract.js";

const TODAY = losAngelesToday();
const DEFAULT_OWNER = "saagpatel";

interface Flags {
  live: boolean;
  owner: string;
  limit: number;
  today: string;
  config: string;
  sourceConfig: string;
  approval?: string;
}

function parseFlags(argv: string[]): Flags {
  let live = false;
  let owner = DEFAULT_OWNER;
  let limit = 200;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let sourceConfig = DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH;
  let approval: string | undefined;

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
      continue;
    }
    if (current === "--approval") {
      approval = argv[index + 1];
      index += 1;
    }
  }

  return { live, owner, limit, today, config, sourceConfig, approval };
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (shouldShowHelp(argv)) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:github-support-maintenance --",
          description: "Run the narrow GitHub-backed support-maintenance lane.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--live", description: "Apply the maintenance actions live." },
            { flag: "--owner <name>", description: "GitHub owner to inspect. Defaults to saagpatel." },
            { flag: "--limit <count>", description: "Maximum repositories to inspect. Defaults to 200." },
            { flag: "--today <date>", description: "Override the date anchor in YYYY-MM-DD format." },
            { flag: "--config <path>", description: "Path to the control-tower config file." },
            { flag: "--source-config <path>", description: "Path to the external-signal source config file." },
            {
              flag: "--approval <path>",
              description: "Exact hygiene IrreversibleActionEnvelopeV1 required with --live.",
            },
          ],
        }),
      );
      return;
    }

    const flags = parseFlags(argv);
    const output = await runGitHubSupportMaintenance(flags);
    recordCommandOutputSummary(output, {
      status: mapWeeklyStepStatusToCommandStatus(
        typeof output.status === "string" ? output.status as Parameters<typeof mapWeeklyStepStatusToCommandStatus>[0] : "clean",
      ),
    });
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
    approval: flags.approval,
  };

  // In live mode, compute the exact hygiene plan before any maintenance write.
  // Only a non-empty destructive plan requires and consumes an envelope.
  const supportPreflight = flags.live
    ? await runSupportDatabaseHygienePass({
        ...supportFlags,
        live: false,
        approval: undefined,
      })
    : undefined;
  const hygieneEffectCount = supportPreflight
    ? numberAt(supportPreflight, ["approvalPlan", "effect_count"])
    : 0;
  assertSupportApprovalBeforeLiveWrites({
    live: flags.live,
    hygieneEffectCount,
    approval: flags.approval,
  });
  if (flags.live && hygieneEffectCount > 0) {
    const envelope = loadEnvelope(flags.approval!);
    if (
      envelope.schema !== "IrreversibleActionEnvelopeV1" ||
      envelope.action_kind !== "notion.support_database_hygiene"
    ) {
      throw new Error(
        "--approval must authorize notion.support_database_hygiene",
      );
    }
  }
  const supportDatabaseHygiene = flags.live && hygieneEffectCount > 0
    ? await runSupportDatabaseHygienePass(supportFlags)
    : supportPreflight;
  const githubKnowledgeAudit = await runGitHubKnowledgeAudit(githubFlags);
  const resolvedSupportDatabaseHygiene =
    supportDatabaseHygiene ?? await runSupportDatabaseHygienePass(supportFlags);

  const githubRefreshCount = numberAt(githubKnowledgeAudit, ["skills", "new"]) +
    numberAt(githubKnowledgeAudit, ["skills", "refreshNeeded"]) +
    numberAt(githubKnowledgeAudit, ["research", "new"]) +
    numberAt(githubKnowledgeAudit, ["research", "refreshNeeded"]) +
    numberAt(githubKnowledgeAudit, ["tools", "new"]) +
    numberAt(githubKnowledgeAudit, ["tools", "refreshNeeded"]) +
    numberAt(githubKnowledgeAudit, ["existingToolUpdates", "refreshNeeded"]);
  const hygieneActions =
    numberAt(resolvedSupportDatabaseHygiene, ["duplicateGroupCount"]) +
    numberAt(resolvedSupportDatabaseHygiene, ["lowRiskArchiveCount"]) +
    numberAt(resolvedSupportDatabaseHygiene, ["forcedNearDuplicateMergeCount"]);
  const contract = buildWeeklyStepContract({
    live: flags.live,
    wouldChange: githubRefreshCount > 0 || hygieneActions > 0,
    summaryCounts: {
      githubRefreshCount,
      hygieneActions,
      touchedProjects: numberAt(githubKnowledgeAudit, ["touchedProjects", "count"]),
      duplicateGroupCount: numberAt(resolvedSupportDatabaseHygiene, ["duplicateGroupCount"]),
      lowRiskArchiveCount: numberAt(resolvedSupportDatabaseHygiene, ["lowRiskArchiveCount"]),
      forcedNearDuplicateMergeCount: numberAt(resolvedSupportDatabaseHygiene, ["forcedNearDuplicateMergeCount"]),
    },
  });

  if (flags.live) {
    const config = await loadLocalPortfolioControlTowerConfig(flags.config);
    await saveLocalPortfolioControlTowerConfig(
      {
        ...config,
        weeklyMaintenance: {
          ...config.weeklyMaintenance,
          supportMaintenanceLastSyncAt: flags.today,
        },
      },
      flags.config,
    );
  }

  return {
    ok: true,
    live: flags.live,
    status: contract.status,
    wouldChange: contract.wouldChange,
    summaryCounts: contract.summaryCounts,
    warnings: contract.warnings,
    owner: flags.owner,
    today: flags.today,
    githubKnowledgeAudit,
    supportDatabaseHygiene: resolvedSupportDatabaseHygiene,
  };
}

export function assertSupportApprovalBeforeLiveWrites(input: {
  live: boolean;
  hygieneEffectCount: number;
  approval?: string;
}): void {
  if (input.live && input.hygieneEffectCount > 0 && !input.approval) {
    throw new Error(
      "--live requires --approval <IrreversibleActionEnvelopeV1.json> before any maintenance write",
    );
  }
}

function numberAt(source: Record<string, unknown>, path: string[]): number {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return 0;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

if (process.argv[1]?.endsWith("github-support-maintenance.ts")) {
  void main();
}
