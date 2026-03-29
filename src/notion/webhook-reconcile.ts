import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import { requirePhase6Governance } from "./local-portfolio-governance.js";
import { toWebhookDeliveryRecord } from "./local-portfolio-governance-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for webhook reconcile");
    }

    const flags = parseFlags(process.argv.slice(2));
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    const phase6 = requirePhase6Governance(config);

    const api = new DirectNotionClient(token);
    const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
    const deliverySchema = await api.retrieveDataSource(phase6.webhookDeliveries.dataSourceId);
    const deliveryPages = await fetchAllPages(sdk, phase6.webhookDeliveries.dataSourceId, deliverySchema.titlePropertyName);
    const deliveries = deliveryPages.map((page) => toWebhookDeliveryRecord(page));

    const providerName = flags.provider === "github" ? "GitHub" : flags.provider === "vercel" ? "Vercel" : "Google Calendar";
    const reconcileNeeded = deliveries.filter(
      (delivery) =>
        delivery.provider === providerName &&
        (delivery.status === "Failed" || delivery.verificationResult === "Duplicate"),
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          provider: flags.provider,
          reconcileNeeded: reconcileNeeded.map((delivery) => ({
            title: delivery.title,
            url: delivery.url,
            status: delivery.status,
            verificationResult: delivery.verificationResult,
            receiptCount: delivery.receiptCount,
          })),
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

function parseFlags(argv: string[]): { provider: "github" | "vercel" | "google_calendar" } {
  let provider: "github" | "vercel" | "google_calendar" = "github";
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--provider") {
      const next = argv[index + 1];
      if (next === "github" || next === "vercel" || next === "google_calendar") {
        provider = next;
      }
      index += 1;
    }
  }
  return { provider };
}

void main();
