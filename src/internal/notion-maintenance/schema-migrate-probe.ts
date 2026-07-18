/**
 * Side-effect-free by default. Live capability probes require an exact,
 * one-shot IrreversibleActionEnvelopeV1 and use nonce-owned schema property.
 */

import type { Client } from "@notionhq/client";

import { isDirectExecution } from "../../cli/legacy.js";
import { requireNotionToken } from "../../config/runtime-config.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";
import { loadLocalPortfolioControlTowerConfig } from "../../notion/local-portfolio-control-tower.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import {
  approvalPath,
  claimEnvelope,
  createClaimedActionFailureRecorder,
  emitReceipt,
  loadEnvelope,
  planDigest,
  sourceRevision,
  validateEnvelope,
} from "./irreversible-action.js";

type DataSourceShape = { properties?: Record<string, { id?: string; type?: string }> };

export function probePlan(dataSourceId: string, actionId: string) {
  const nonce = actionId.replace(/[^A-Za-z0-9]/g, "").slice(-12);
  return {
    operation: "notion.schema_rollup_probe",
    data_source_id: dataSourceId,
    property_name: `_Probe Build Session Count ${nonce}`,
    create: {
      rollup: {
        relation_property_name: "Build Sessions",
        rollup_property_name: "Session Title",
        function: "count",
      },
    },
    cleanup: "compare-property-id-before-delete",
  };
}

async function retrieveDataSource(sdk: Client, dataSourceId: string): Promise<DataSourceShape> {
  return (await sdk.request({
    path: `data_sources/${dataSourceId}`,
    method: "get",
  })) as DataSourceShape;
}

export async function runLiveProbe(input: {
  sdk: Client;
  dataSourceId: string;
  approvalFile: string;
  sourceRevision?: string;
  claimStateDir?: string;
  receiptDir?: string;
}): Promise<Record<string, unknown>> {
  const envelope = loadEnvelope(input.approvalFile);
  const plan = probePlan(input.dataSourceId, envelope.action_id);
  validateEnvelope({
    envelope,
    actionKind: "notion.schema_probe",
    canonicalTargets: {
      data_source_id: input.dataSourceId,
      property_name: plan.property_name,
    },
    sourceRevision: input.sourceRevision ?? sourceRevision(),
    plan,
    effectCount: 2,
    deletionCount: 1,
    requiredReadback: ["property_absent_after_cleanup"],
  });
  const before = await retrieveDataSource(input.sdk, input.dataSourceId);
  if (before.properties?.[plan.property_name] !== undefined) {
    throw new Error("nonce-owned probe property already exists; refusing to overwrite");
  }
  claimEnvelope(envelope, input.claimStateDir);
  const failure = createClaimedActionFailureRecorder({
    envelope,
    target: {
      data_source_id: input.dataSourceId,
      property_name: plan.property_name,
    },
    providerReference: `notion:probe:${envelope.provider_idempotency_key}`,
    receiptDir: input.receiptDir,
  });
  let createdPropertyId: string | undefined;
  try {
    failure.markEffectAttempted();
    const createdResponse = (await input.sdk.request({
      path: `data_sources/${input.dataSourceId}`,
      method: "patch",
      body: { properties: { [plan.property_name]: plan.create } },
    })) as DataSourceShape;
    createdPropertyId = createdResponse.properties?.[plan.property_name]?.id;
    if (!createdPropertyId) {
      throw new Error("provider did not return the created probe property id");
    }

    const beforeCleanup = await retrieveDataSource(input.sdk, input.dataSourceId);
    const currentProperty = beforeCleanup.properties?.[plan.property_name];
    if (currentProperty?.id !== createdPropertyId) {
      throw new Error("probe property identity changed; refusing cleanup");
    }
    failure.markEffectAttempted();
    await input.sdk.request({
      path: `data_sources/${input.dataSourceId}`,
      method: "patch",
      body: { properties: { [plan.property_name]: null } },
    });
    const after = await retrieveDataSource(input.sdk, input.dataSourceId);
    if (after.properties?.[plan.property_name] !== undefined) {
      throw new Error("probe cleanup readback failed");
    }
  } catch (error) {
    failure.fail(error, createdPropertyId ? "cleanup_and_readback" : "property_creation");
  }
  emitReceipt({
    envelope,
    target: {
      data_source_id: input.dataSourceId,
      property_name: plan.property_name,
    },
    providerReference: `notion:property:${createdPropertyId}`,
    readbackResult: { property_absent: true },
    terminalOutcome: "succeeded",
    receiptDir: input.receiptDir,
  });
  return {
    ok: true,
    action_id: envelope.action_id,
    plan_digest: planDigest(plan),
    property_id: createdPropertyId,
    property_absent_after_cleanup: true,
  };
}

export async function runProbe(input: {
  live: boolean;
  dataSourceId: string;
  approvalFile?: string;
  sdkFactory?: () => Client;
}): Promise<Record<string, unknown>> {
  if (!input.live) {
    return {
      mode: "side-effect-free",
      data_source_id: input.dataSourceId,
      live_requires: [
        "--live",
        "--approval <IrreversibleActionEnvelopeV1.json>",
        "unique action-owned property",
        "compare-before-delete cleanup",
      ],
    };
  }
  if (!input.approvalFile || !input.sdkFactory) {
    throw new Error("live probe requires approval and an authenticated SDK factory");
  }
  return runLiveProbe({
    sdk: input.sdkFactory(),
    dataSourceId: input.dataSourceId,
    approvalFile: input.approvalFile,
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (shouldShowHelp(argv)) {
    process.stdout.write(
      renderInternalScriptHelp({
        command: "npm run schema-migrate-probe --",
        description:
          "Run the historical schema migration probe that verifies rollup property creation against the Local Portfolio Projects data source.",
        options: [
          { flag: "--help, -h", description: "Show this help message." },
          {
            flag: "--live",
            description: "Run the envelope-gated live capability probe.",
          },
          {
            flag: "--approval <path>",
            description: "Exact IrreversibleActionEnvelopeV1 required with --live.",
          },
        ],
        notes: [
          "Default execution is side-effect-free and does not construct a Notion client.",
        ],
      }),
    );
    return;
  }
  const config = await loadLocalPortfolioControlTowerConfig();
  const dataSourceId = config.database.dataSourceId;
  const live = argv.includes("--live");
  const result = await runProbe({
    live,
    dataSourceId,
    approvalFile: live ? approvalPath(argv) : undefined,
    sdkFactory: live
      ? () =>
          createNotionSdkClient(
            requireNotionToken("NOTION_TOKEN is required for live schema-migrate-probe"),
          )
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
