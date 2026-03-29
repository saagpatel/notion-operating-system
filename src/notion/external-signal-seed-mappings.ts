import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { AppError } from "../utils/errors.js";
import {
  buildExternalSignalSeedPlans,
  loadLocalPortfolioExternalSignalSourceConfig,
} from "./local-portfolio-external-signals.js";
import { ensurePhase5ExternalSignalSchema } from "./local-portfolio-external-signals-live.js";
import {
  fetchAllPages,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import { toIntelligenceProjectRecord } from "./local-portfolio-intelligence-live.js";
import { toWorkPacketRecord } from "./local-portfolio-execution-live.js";

export interface ExternalSignalSeedMappingsCommandOptions {
  live?: boolean;
  limit?: number;
  config?: string;
}

export async function runExternalSignalSeedMappingsCommand(
  options: ExternalSignalSeedMappingsCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for external signal mapping seeding",
  );
  const live = options.live ?? false;
  const limit = options.limit ?? 15;
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let config = await loadLocalPortfolioControlTowerConfig(configPath);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (live) {
      config = await ensurePhase5ExternalSignalSchema(sdk, config);
    }
    if (!config.phase5ExternalSignals) {
      throw new AppError("Control tower config is missing phase5ExternalSignals");
    }

    const sourceConfig = await loadLocalPortfolioExternalSignalSourceConfig();
    const [projectSchema, packetSchema, sourceSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
    ]);
    const [projectPages, packetPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution!.packets.dataSourceId, packetSchema.titlePropertyName),
    ]);

    const seedPlans = buildExternalSignalSeedPlans({
      projects: projectPages.map((page) => toIntelligenceProjectRecord(page)),
      packets: packetPages.map((page) => toWorkPacketRecord(page)),
      sourceConfig,
    }).slice(0, limit);

    const results: Array<{ id: string; url: string; existed: boolean; title: string }> = [];
    if (live) {
      for (const plan of seedPlans) {
        const result = await upsertPageByTitle({
          api,
          dataSourceId: config.phase5ExternalSignals.sources.dataSourceId,
          titlePropertyName: sourceSchema.titlePropertyName,
          title: plan.title,
          properties: {
            [sourceSchema.titlePropertyName]: titleValue(plan.title),
            "Local Project": relationValue([plan.localProjectId]),
            Provider: selectPropertyValue(plan.provider),
            "Source Type": selectPropertyValue(plan.sourceType),
            Status: selectPropertyValue(plan.status),
            Environment: selectPropertyValue(plan.environment),
            "Sync Strategy": selectPropertyValue(plan.syncStrategy),
            Identifier: richTextValue(plan.identifier ?? ""),
            "Source URL": plan.sourceUrl ? { url: plan.sourceUrl } : { url: null },
          },
          markdown: [
            `# ${plan.title}`,
            "",
            `- Provider: ${plan.provider}`,
            `- Source type: ${plan.sourceType}`,
            `- Status: ${plan.status}`,
            ...(plan.identifier ? [`- Identifier: ${plan.identifier}`] : []),
            ...(plan.sourceUrl ? [`- Source URL: ${plan.sourceUrl}`] : []),
            "",
            plan.identifier
              ? "This row was seeded from repo-owned manual mapping config for live GitHub telemetry."
              : "This row was seeded automatically for the bounded Phase 5 priority slice. Add a real identifier before activating live sync.",
          ].join("\n"),
        });
        results.push({ ...result, title: plan.title });
      }
    }

    const output = {
      ok: true,
      live,
      seededCount: seedPlans.length,
      limit,
      createdOrUpdated: results,
    };
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["signals", "seed-mappings"]);
}
