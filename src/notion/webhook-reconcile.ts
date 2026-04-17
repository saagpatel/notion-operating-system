import { createNotionSdkClient } from "./notion-sdk.js";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import { requirePhase6Governance } from "./local-portfolio-governance.js";
import type { WebhookDeliveryRecord } from "./local-portfolio-governance.js";
import { toWebhookDeliveryRecord } from "./local-portfolio-governance-live.js";
import { toErrorMessage } from "../utils/errors.js";

export interface WebhookReconcileCommandOptions {
  provider?: "github" | "vercel" | "google_calendar";
  config?: string;
}

export async function runWebhookReconcileCommand(
  options: WebhookReconcileCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for webhook reconcile");
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
  const phase6 = requirePhase6Governance(config);

  const api = new DirectNotionClient(token);
  const sdk = createNotionSdkClient(token);
  const deliverySchema = await api.retrieveDataSource(phase6.webhookDeliveries.dataSourceId);
  const deliveryPages = await fetchAllPages(sdk, phase6.webhookDeliveries.dataSourceId, deliverySchema.titlePropertyName);
  const deliveries = deliveryPages.map((page) => toWebhookDeliveryRecord(page));
  const provider = options.provider ?? "github";
  const reconcileNeeded = findWebhookDeliveriesNeedingReconcile(deliveries, provider);
  const output = {
    ok: true,
    provider,
    reconcileNeeded: reconcileNeeded.map((delivery) => ({
      title: delivery.title,
      url: delivery.url,
      status: delivery.status,
      verificationResult: delivery.verificationResult,
      receiptCount: delivery.receiptCount,
    })),
  };
  recordCommandOutputSummary(
    {
      ...output,
      recordsSkipped: reconcileNeeded.length,
      warningsCount: reconcileNeeded.length > 0 ? 1 : 0,
    },
    {
      status: reconcileNeeded.length > 0 ? "warning" : "completed",
      warningCategories: reconcileNeeded.length > 0 ? ["stale_data"] : undefined,
      metadata: {
        provider,
      },
    },
  );
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    const flags = parseWebhookReconcileFlags(process.argv.slice(2));
    await runWebhookReconcileCommand({
      provider: flags.provider,
      config:
        process.argv[2]?.startsWith("--")
          ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
          : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
    });
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export function parseWebhookReconcileFlags(argv: string[]): { provider: "github" | "vercel" | "google_calendar" } {
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

export function findWebhookDeliveriesNeedingReconcile(
  deliveries: WebhookDeliveryRecord[],
  provider: "github" | "vercel" | "google_calendar",
): WebhookDeliveryRecord[] {
  const providerName = provider === "github" ? "GitHub" : provider === "vercel" ? "Vercel" : "Google Calendar";
  return deliveries.filter(
    (delivery) =>
      delivery.provider === providerName &&
      (delivery.status === "Failed" || delivery.verificationResult === "Duplicate"),
  );
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "webhook-reconcile"]);
}
