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
import { ensurePhase6GovernanceSchema } from "./local-portfolio-governance-live.js";
import { DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_VIEWS_PATH } from "./local-portfolio-governance.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "./local-portfolio-roadmap.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { upsertPageByTitle, titleValue, multiSelectValue, selectPropertyValue, richTextValue } from "./local-portfolio-control-tower-live.js";
import { loadLocalPortfolioGovernancePolicyConfig, loadLocalPortfolioWebhookProviderConfig } from "./local-portfolio-governance.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 6 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);

    if (flags.live) {
      const sdk = new Client({
        auth: token,
        notionVersion: "2026-03-11",
      });
      config = await ensurePhase6GovernanceSchema(sdk, config);
      config = {
        ...config,
        phaseState: {
          ...config.phaseState,
          currentPhase: Math.max(config.phaseState.currentPhase, 6),
          currentPhaseStatus: "In Progress",
        },
      };
      await saveLocalPortfolioControlTowerConfig(config, configPath);
      await upsertDestinationAliases(config);
      await updateViewPlanDatabaseRefs(config);
      await seedGovernancePoliciesAndEndpoints(token, config, today);
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
          policiesDataSourceId: config.phase6Governance?.policies.dataSourceId,
          actionRequestsDataSourceId: config.phase6Governance?.actionRequests.dataSourceId,
          webhookEndpointsDataSourceId: config.phase6Governance?.webhookEndpoints.dataSourceId,
          webhookDeliveriesDataSourceId: config.phase6Governance?.webhookDeliveries.dataSourceId,
          webhookReceiptsDataSourceId: config.phase6Governance?.webhookReceipts.dataSourceId,
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
  if (!config.phase6Governance) {
    return;
  }
  const registry = await readJsonFile<DestinationRegistryConfig>(DESTINATIONS_PATH);
  const upsert = (alias: string, patch: DestinationRegistryConfig["destinations"][number]) => {
    const existingIndex = registry.destinations.findIndex((destination) => destination.alias === alias);
    if (existingIndex >= 0) {
      registry.destinations[existingIndex] = patch;
      return;
    }
    registry.destinations.push(patch);
  };

  for (const entry of [
    config.phase6Governance.policies,
    config.phase6Governance.actionRequests,
    config.phase6Governance.webhookEndpoints,
    config.phase6Governance.webhookDeliveries,
    config.phase6Governance.webhookReceipts,
  ]) {
    upsert(entry.destinationAlias, {
      alias: entry.destinationAlias,
      description: `Create or update ${entry.name.toLowerCase()} rows.`,
      destinationType: "data_source",
      sourceUrl: entry.databaseUrl,
      resolvedId: entry.dataSourceId,
      templateMode: "none",
      titleRule: {
        source: "frontmatter",
        frontmatterField: "title",
        fallback: entry.name.replace(/s$/, ""),
      },
      fixedProperties: {},
      defaultProperties: {},
      mode: "create_new_page",
      safeDefaults: {
        allowDeletingContent: false,
        templatePollIntervalMs: 1500,
        templatePollTimeoutMs: 30000,
      },
    });
  }

  await writeJsonFile(DESTINATIONS_PATH, registry);
}

async function updateViewPlanDatabaseRefs(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  if (!config.phase6Governance) {
    return;
  }
  const plan = await readJsonFile<Record<string, unknown>>(DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_VIEWS_PATH);
  const collections = Array.isArray(plan.collections) ? plan.collections : [];

  for (const entry of collections) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const collection = entry as Record<string, unknown>;
    const key = collection.key;
    if (key === "policies") {
      collection.database = config.phase6Governance.policies;
    } else if (key === "actionRequests") {
      collection.database = config.phase6Governance.actionRequests;
    } else if (key === "endpoints") {
      collection.database = config.phase6Governance.webhookEndpoints;
    } else if (key === "deliveries") {
      collection.database = config.phase6Governance.webhookDeliveries;
    } else if (key === "receipts") {
      collection.database = config.phase6Governance.webhookReceipts;
    }
  }

  await writeJsonFile(DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_VIEWS_PATH, plan);
}

async function seedGovernancePoliciesAndEndpoints(
  token: string,
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
  today: string,
): Promise<void> {
  if (!config.phase6Governance) {
    return;
  }

  const [policyConfig, providerConfig] = await Promise.all([
    loadLocalPortfolioGovernancePolicyConfig(),
    loadLocalPortfolioWebhookProviderConfig(),
  ]);
  const api = new DirectNotionClient(token);
  const [policySchema, endpointSchema] = await Promise.all([
    api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
    api.retrieveDataSource(config.phase6Governance.webhookEndpoints.dataSourceId),
  ]);

  for (const policy of policyConfig.policies) {
    const markdown = [
      `# ${policy.actionKey}`,
      "",
      `- Provider: ${policy.provider}`,
      `- Mutation class: ${policy.mutationClass}`,
      `- Execution mode: ${policy.executionMode}`,
      `- Identity type: ${policy.identityType}`,
      `- Approval rule: ${policy.approvalRule}`,
      `- Dry run required: ${policy.dryRunRequired ? "Yes" : "No"}`,
      `- Rollback required: ${policy.rollbackRequired ? "Yes" : "No"}`,
      "",
      policy.notes,
    ].join("\n");

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

  const endpointPlans = [
    {
      title: "GitHub Shadow Receiver",
      provider: "GitHub",
      mode: "Shadow",
      identityType: "GitHub App",
      providerKey: "github",
    },
    {
      title: "GitHub Live Receiver",
      provider: "GitHub",
      mode: "Disabled",
      identityType: "GitHub App",
      providerKey: "github",
    },
    {
      title: "Vercel Receiver",
      provider: "Vercel",
      mode: "Disabled",
      identityType: "Team Token",
      providerKey: "vercel",
    },
  ] as const;

  for (const plan of endpointPlans) {
    const provider = providerConfig.providers.find((entry) => entry.key === plan.providerKey);
    if (!provider) {
      continue;
    }
    const markdown = [
      `# ${plan.title}`,
      "",
      `- Provider: ${plan.provider}`,
      `- Mode: ${plan.mode}`,
      `- Path: ${provider.endpointPath}`,
      "",
      provider.notes.join("\n"),
    ].join("\n");

    await upsertPageByTitle({
      api,
      dataSourceId: config.phase6Governance.webhookEndpoints.dataSourceId,
      titlePropertyName: endpointSchema.titlePropertyName,
      title: plan.title,
      properties: {
        [endpointSchema.titlePropertyName]: titleValue(plan.title),
        Provider: { select: { name: plan.provider } },
        Mode: { select: { name: plan.mode } },
        "Receiver Path": richTextValue(provider.endpointPath),
        "Subscribed Events": richTextValue(provider.subscribedEvents.join(", ")),
        "Secret Env Var": richTextValue(provider.secretEnvVar),
        "Identity Type": { select: { name: plan.identityType } },
        "Replay Window Minutes": { number: provider.replayWindowMinutes },
        "Last Delivery At": { date: null },
        Notes: richTextValue(provider.notes.join(" ")),
      },
      markdown,
    });
  }
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
