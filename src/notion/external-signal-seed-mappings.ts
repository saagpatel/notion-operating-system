import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
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

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for external signal mapping seeding");
    }

    const flags = parseFlags(process.argv.slice(2));
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    let config = await loadLocalPortfolioControlTowerConfig(configPath);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (flags.live) {
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
    }).slice(0, flags.limit);

    const results: Array<{ id: string; url: string; existed: boolean; title: string }> = [];
    if (flags.live) {
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

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          seededCount: seedPlans.length,
          limit: flags.limit,
          createdOrUpdated: results,
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

function parseFlags(argv: string[]): { live: boolean; limit: number } {
  let live = false;
  let limit = 15;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--limit") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
      index += 1;
    }
  }

  return { live, limit };
}

void main();
