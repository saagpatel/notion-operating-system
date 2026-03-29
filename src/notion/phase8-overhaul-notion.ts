import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Client } from "@notionhq/client";

import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import type { DestinationRegistryConfig } from "../types.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { ensurePhase7ActuationSchema } from "./local-portfolio-actuation-live.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH,
  DEFAULT_LOCAL_PORTFOLIO_GITHUB_VIEWS_PATH,
  ensurePhase7ActuationState,
  ensurePhase8GithubDeepeningState,
  loadLocalPortfolioGitHubActionFamilyConfig,
} from "./local-portfolio-actuation.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "./local-portfolio-roadmap.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { multiSelectValue, richTextValue, titleValue, upsertPageByTitle } from "./local-portfolio-control-tower-live.js";
import { loadLocalPortfolioGovernancePolicyConfig, loadLocalPortfolioWebhookProviderConfig } from "./local-portfolio-governance.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 8 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase6Governance || !config.phase5ExternalSignals) {
      throw new AppError("Phase 8 requires phase6Governance and phase5ExternalSignals to already exist");
    }

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      config = await ensurePhase7ActuationSchema(sdk, config);
      const phase7 = ensurePhase7ActuationState(config, { today });
      const phase8 = ensurePhase8GithubDeepeningState(config, { today });
      config = {
        ...config,
        phase7Actuation: phase7,
        phase8GithubDeepening: {
          ...phase8,
          webhookFeedback: {
            ...phase8.webhookFeedback,
            githubStatus: process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ? "trusted_feedback" : "shadow",
          },
        },
        phaseState: {
          ...config.phaseState,
          currentPhase: Math.max(config.phaseState.currentPhase, 8),
          currentPhaseStatus: "In Progress",
        },
      };
      await saveLocalPortfolioControlTowerConfig(config, configPath);
      await upsertDestinationAliases(config);
      await updateViewPlanDatabaseRefs(config, DEFAULT_LOCAL_PORTFOLIO_ACTUATION_VIEWS_PATH);
      await updateViewPlanDatabaseRefs(config, DEFAULT_LOCAL_PORTFOLIO_GITHUB_VIEWS_PATH);
      await seedGitHubPoliciesAndEndpoints(token, config, today);
    }

    const roadmapMarkdown = renderNotionRoadmapMarkdown({
      generatedAt: today,
      currentPhase: config.phaseState.currentPhase,
      currentPhaseStatus: config.phaseState.currentPhaseStatus,
      baselineMetrics: config.phaseState.baselineMetrics,
      latestMetrics: config.phaseState.lastSyncMetrics,
      lastClosedPhase: config.phaseState.lastClosedPhase,
    });
    const phaseMemoryMarkdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: today,
      currentPhase: config.phaseState.currentPhase,
    });

    await writeFile(path.join(process.cwd(), "docs", "notion-roadmap.md"), roadmapMarkdown, "utf8");
    await writeFile(path.join(process.cwd(), "docs", "notion-phase-memory.md"), phaseMemoryMarkdown, "utf8");

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          currentPhase: config.phaseState.currentPhase,
          currentPhaseStatus: config.phaseState.currentPhaseStatus,
          executionsDataSourceId: config.phase7Actuation?.executions.dataSourceId,
          githubWebhookStatus: config.phase8GithubDeepening?.webhookFeedback.githubStatus,
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

async function upsertDestinationAliases(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  if (!config.phase7Actuation) {
    return;
  }
  const registry = await readJsonFile<DestinationRegistryConfig>(DESTINATIONS_PATH);
  const alias = config.phase7Actuation.executions.destinationAlias;
  const patch: DestinationRegistryConfig["destinations"][number] = {
    alias,
    description: "Create or update external action execution rows.",
    destinationType: "data_source",
    sourceUrl: config.phase7Actuation.executions.databaseUrl,
    resolvedId: config.phase7Actuation.executions.dataSourceId,
    templateMode: "none",
    titleRule: {
      source: "frontmatter",
      frontmatterField: "title",
      fallback: "External Action Execution",
    },
    fixedProperties: {},
    defaultProperties: {},
    mode: "create_new_page",
    safeDefaults: {
      allowDeletingContent: false,
      templatePollIntervalMs: 1500,
      templatePollTimeoutMs: 30000,
    },
  };
  const existingIndex = registry.destinations.findIndex((entry) => entry.alias === alias);
  if (existingIndex >= 0) {
    registry.destinations[existingIndex] = patch;
  } else {
    registry.destinations.push(patch);
  }
  await writeJsonFile(DESTINATIONS_PATH, registry);
}

async function updateViewPlanDatabaseRefs(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
  filePath: string,
): Promise<void> {
  if (!config.phase7Actuation || !config.phase6Governance || !config.phase5ExternalSignals) {
    return;
  }
  const plan = await readJsonFile<Record<string, unknown>>(filePath);
  const collections = Array.isArray(plan.collections) ? plan.collections : [];
  for (const entry of collections) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const collection = entry as Record<string, unknown>;
    const key = collection.key;
    if (key === "actionRequests") {
      collection.database = config.phase6Governance.actionRequests;
    } else if (key === "executions") {
      collection.database = config.phase7Actuation.executions;
    } else if (key === "sources") {
      collection.database = config.phase5ExternalSignals.sources;
    }
  }
  await writeJsonFile(filePath, plan);
}

async function seedGitHubPoliciesAndEndpoints(
  token: string,
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
  today: string,
): Promise<void> {
  if (!config.phase6Governance) {
    return;
  }
  const [policyConfig, providerConfig, githubFamilies] = await Promise.all([
    loadLocalPortfolioGovernancePolicyConfig(),
    loadLocalPortfolioWebhookProviderConfig(),
    loadLocalPortfolioGitHubActionFamilyConfig(),
  ]);
  const api = new DirectNotionClient(token);
  const [policySchema, endpointSchema, buildSchema] = await Promise.all([
    api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
    api.retrieveDataSource(config.phase6Governance.webhookEndpoints.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.buildLogId),
  ]);

  for (const policy of policyConfig.policies) {
    const family = githubFamilies.families.find((entry) => entry.actionKey === policy.actionKey);
    const markdown = [
      `# ${policy.actionKey}`,
      "",
      `- Provider: ${policy.provider}`,
      `- Mutation class: ${policy.mutationClass}`,
      `- Execution mode: ${policy.executionMode}`,
      `- Identity type: ${policy.identityType}`,
      `- Approval rule: ${policy.approvalRule}`,
      family ? `- Permission family: ${family.permissionFamily}` : "",
      "",
      policy.notes,
      family ? `\nFamily notes: ${family.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await upsertPageByTitle({
      api,
      dataSourceId: config.phase6Governance.policies.dataSourceId,
      titlePropertyName: policySchema.titlePropertyName,
      title: policy.actionKey,
      properties: {
        [policySchema.titlePropertyName]: titleValue(policy.actionKey),
        Provider: { select: { name: policy.provider } },
        "Mutation Class": { select: { name: policy.mutationClass } },
        "Execution Mode": { select: { name: policy.executionMode } },
        "Identity Type": { select: { name: policy.identityType } },
        "Approval Rule": { select: { name: policy.approvalRule } },
        "Dry Run Required": { checkbox: policy.dryRunRequired },
        "Rollback Required": { checkbox: policy.rollbackRequired },
        "Default Expiry Hours": { number: policy.defaultExpiryHours },
        "Allowed Sources": multiSelectValue(policy.allowedSources),
        Notes: richTextValue(policy.notes),
      },
      markdown,
    });
  }

  const githubProvider = providerConfig.providers.find((entry) => entry.key === "github");
  if (githubProvider) {
    const receiverTitle = "GitHub Trusted Feedback Receiver";
    const receiverMode = process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ? "Live" : "Shadow";
    const markdown = [
      `# ${receiverTitle}`,
      "",
      `- Provider: GitHub`,
      `- Mode: ${receiverMode}`,
      `- Path: ${githubProvider.endpointPath}`,
      `- Events: ${githubProvider.subscribedEvents.join(", ")}`,
      "",
      ...githubProvider.notes,
    ].join("\n");

    await upsertPageByTitle({
      api,
      dataSourceId: config.phase6Governance.webhookEndpoints.dataSourceId,
      titlePropertyName: endpointSchema.titlePropertyName,
      title: receiverTitle,
      properties: {
        [endpointSchema.titlePropertyName]: titleValue(receiverTitle),
        Provider: { select: { name: "GitHub" } },
        Mode: { select: { name: receiverMode } },
        "Receiver Path": richTextValue(githubProvider.endpointPath),
        "Subscribed Events": richTextValue(githubProvider.subscribedEvents.join(", ")),
        "Secret Env Var": richTextValue(githubProvider.secretEnvVar),
        "Identity Type": { select: { name: "GitHub App" } },
        "Replay Window Minutes": { number: githubProvider.replayWindowMinutes },
        Notes: richTextValue(githubProvider.notes.join(" ")),
      },
      markdown,
    });
  }

  const buildTitle = "Phase 8 kickoff - GitHub Deepening and Hardening";
  await upsertPageByTitle({
    api,
    dataSourceId: config.relatedDataSources.buildLogId,
    titlePropertyName: buildSchema.titlePropertyName,
    title: buildTitle,
    properties: {
      [buildSchema.titlePropertyName]: titleValue(buildTitle),
      "Session Date": { date: { start: today } },
      Tags: multiSelectValue(["notion", "portfolio", "phase-8", "github"]),
      "What Was Planned": richTextValue(
        "Deepen the GitHub lane into issue lifecycle actions, PR comments, stronger security, and richer operator visibility.",
      ),
      "What Shipped": richTextValue(
        "Phase 8 schema, config, GitHub action families, webhook feedback plumbing, and deeper GitHub policy coverage.",
      ),
      "Next Steps": richTextValue(
        "Run dry-run and live acceptance flows for issue update, labels, assignees, issue comments, and PR comments.",
      ),
    },
    markdown: [
      `# ${buildTitle}`,
      "",
      "Phase 8 extends the existing GitHub-first lane rather than creating a new actuation architecture.",
    ].join("\n"),
  });
}

function parseFlags(argv: string[]): { live: boolean; today?: string } {
  let live = false;
  let today: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1];
      index += 1;
    }
  }
  return { live, today };
}

void main();
