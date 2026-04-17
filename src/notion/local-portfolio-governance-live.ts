import type { Client } from "@notionhq/client";

import { AppError } from "../utils/errors.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type { DataSourcePageRef, NotionPageProperty } from "./local-portfolio-control-tower-live.js";
import {
  checkboxValue,
  dateValue,
  numberValue,
  relationIds,
  selectValue,
  textValue,
} from "./local-portfolio-control-tower-live.js";
import {
  ensurePhase6GovernanceState,
  type GovernanceDatabaseRef,
  type ActionPolicyRecord,
  type ActionRequestRecord,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
  type WebhookReceiptRecord,
} from "./local-portfolio-governance.js";

export async function ensurePhase6GovernanceSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
): Promise<LocalPortfolioControlTowerConfig> {
  const nextPhase6 = ensurePhase6GovernanceState(config, {
    today: config.phase6Governance?.baselineCapturedAt ?? config.phase5ExternalSignals?.lastSyncAt ?? "2026-03-17",
  });

  const policies = await ensureDataSourceRef({
    sdk,
    existing: config.phase6Governance?.policies,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Action Policies",
    titlePropertyName: "Name",
    destinationAlias: "external_action_policies",
  });
  const actionRequests = await ensureDataSourceRef({
    sdk,
    existing: config.phase6Governance?.actionRequests,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "External Action Requests",
    titlePropertyName: "Name",
    destinationAlias: "external_action_requests",
  });
  const webhookEndpoints = await ensureDataSourceRef({
    sdk,
    existing: config.phase6Governance?.webhookEndpoints,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "Webhook Endpoints",
    titlePropertyName: "Name",
    destinationAlias: "webhook_endpoints",
  });
  const webhookDeliveries = await ensureDataSourceRef({
    sdk,
    existing: config.phase6Governance?.webhookDeliveries,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "Webhook Deliveries",
    titlePropertyName: "Name",
    destinationAlias: "webhook_deliveries",
  });
  const webhookReceipts = await ensureDataSourceRef({
    sdk,
    existing: config.phase6Governance?.webhookReceipts,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "Webhook Receipts",
    titlePropertyName: "Name",
    destinationAlias: "webhook_receipts",
  });

  await Promise.all([
    sdk.request({
      path: `data_sources/${policies.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Provider: { select: { options: colorize([["GitHub", "gray"], ["Vercel", "blue"], ["Google Calendar", "yellow"]]) } },
          "Mutation Class": { select: { options: colorize([["Read", "default"], ["Comment", "blue"], ["Issue", "green"], ["Deployment Control", "red"]]) } },
          "Execution Mode": { select: { options: colorize([["Disabled", "gray"], ["Shadow", "orange"], ["Approved Live", "green"]]) } },
          "Identity Type": { select: { options: colorize([["GitHub App", "blue"], ["Team Token", "orange"], ["Break Glass Token", "red"]]) } },
          "Approval Rule": { select: { options: colorize([["No Write", "gray"], ["Single Approval", "blue"], ["Dual Approval", "orange"], ["Emergency", "red"]]) } },
          "Dry Run Required": { checkbox: {} },
          "Rollback Required": { checkbox: {} },
          "Default Expiry Hours": { number: { format: "number" } },
          "Allowed Sources": { multi_select: { options: colorize([["Recommendation", "blue"], ["Weekly Review", "green"], ["Manual", "default"]]) } },
          Notes: { rich_text: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${actionRequests.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Local Project": { relation: relationSchema(config.database.dataSourceId) },
          Policy: { relation: relationSchema(policies.dataSourceId) },
          Status: { select: { options: colorize([["Draft", "default"], ["Pending Approval", "orange"], ["Approved", "green"], ["Rejected", "red"], ["Expired", "gray"], ["Canceled", "gray"], ["Shadow Logged", "blue"], ["Executed", "green"]]) } },
          "Source Type": { select: { options: colorize([["Recommendation", "blue"], ["Weekly Review", "green"], ["Manual", "default"]]) } },
          "Recommendation Run": { relation: relationSchema(config.phase3Intelligence!.recommendationRuns.dataSourceId) },
          "Weekly Review": { relation: relationSchema(config.relatedDataSources.weeklyReviewsId) },
          "Requested By": { people: {} },
          Approver: { people: {} },
          "Requested At": { date: {} },
          "Decided At": { date: {} },
          "Expires At": { date: {} },
          "Planned Payload Summary": { rich_text: {} },
          "Payload Title": { rich_text: {} },
          "Payload Body": { rich_text: {} },
          "Target Number": { number: { format: "number" } },
          "Target Labels": { rich_text: {} },
          "Target Assignees": { rich_text: {} },
          "Provider Request Key": { rich_text: {} },
          "Approval Reason": { rich_text: {} },
          "Execution Notes": { rich_text: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${webhookEndpoints.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Provider: { select: { options: colorize([["GitHub", "gray"], ["Vercel", "blue"], ["Google Calendar", "yellow"]]) } },
          Mode: { select: { options: colorize([["Disabled", "gray"], ["Shadow", "orange"], ["Live", "green"]]) } },
          "Receiver Path": { rich_text: {} },
          "Subscribed Events": { rich_text: {} },
          "Secret Env Var": { rich_text: {} },
          "Identity Type": { select: { options: colorize([["GitHub App", "blue"], ["Team Token", "orange"], ["Break Glass Token", "red"]]) } },
          "Replay Window Minutes": { number: { format: "number" } },
          "Last Delivery At": { date: {} },
          Notes: { rich_text: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${webhookDeliveries.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Endpoint: { relation: relationSchema(webhookEndpoints.dataSourceId) },
          "Local Project": { relation: relationSchema(config.database.dataSourceId) },
          "External Signal Event": { relation: relationSchema(config.phase5ExternalSignals!.events.dataSourceId) },
          Provider: { select: { options: colorize([["GitHub", "gray"], ["Vercel", "blue"], ["Google Calendar", "yellow"]]) } },
          Status: { select: { options: colorize([["Received", "default"], ["Verified", "green"], ["Rejected", "red"], ["Duplicate", "orange"], ["Processed", "blue"], ["Failed", "red"]]) } },
          "Event Type": { rich_text: {} },
          "Delivery ID": { rich_text: {} },
          "Received At": { date: {} },
          "Verification Result": { select: { options: colorize([["Valid", "green"], ["Invalid Signature", "red"], ["Unknown Endpoint", "orange"], ["Expired", "gray"], ["Duplicate", "orange"]]) } },
          "Event Key": { rich_text: {} },
          "Body Digest": { rich_text: {} },
          "Headers Excerpt": { rich_text: {} },
          "Raw Excerpt": { rich_text: {} },
          "Failure Notes": { rich_text: {} },
          "First Seen At": { date: {} },
          "Last Seen At": { date: {} },
          "Receipt Count": { number: { format: "number" } },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${webhookReceipts.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Endpoint: { relation: relationSchema(webhookEndpoints.dataSourceId) },
          Delivery: { relation: relationSchema(webhookDeliveries.dataSourceId) },
          Provider: { select: { options: colorize([["GitHub", "gray"], ["Vercel", "blue"], ["Google Calendar", "yellow"]]) } },
          "Received At": { date: {} },
          "Verification Result": { select: { options: colorize([["Valid", "green"], ["Invalid Signature", "red"], ["Unknown Endpoint", "orange"], ["Expired", "gray"], ["Duplicate", "orange"]]) } },
          Duplicate: { checkbox: {} },
          "Drain Status": { select: { options: colorize([["Pending", "default"], ["Written", "green"], ["Skipped", "gray"], ["Failed", "red"]]) } },
          "Delivery ID": { rich_text: {} },
          "Event Type": { rich_text: {} },
          "Event Key": { rich_text: {} },
          "Body Digest": { rich_text: {} },
          "Headers Excerpt": { rich_text: {} },
          "Raw Excerpt": { rich_text: {} },
          "Failure Notes": { rich_text: {} },
        },
      },
    }),
  ]);

  return {
    ...config,
    phase6Governance: {
      ...nextPhase6,
      policies,
      actionRequests,
      webhookEndpoints,
      webhookDeliveries,
      webhookReceipts,
    },
  };
}

export function toActionPolicyRecord(page: DataSourcePageRef): ActionPolicyRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    provider: selectValue(page.properties.Provider) as ActionPolicyRecord["provider"],
    mutationClass: selectValue(page.properties["Mutation Class"]) as ActionPolicyRecord["mutationClass"],
    executionMode: selectValue(page.properties["Execution Mode"]) as ActionPolicyRecord["executionMode"],
    identityType: selectValue(page.properties["Identity Type"]) as ActionPolicyRecord["identityType"],
    approvalRule: selectValue(page.properties["Approval Rule"]) as ActionPolicyRecord["approvalRule"],
    dryRunRequired: checkboxValue(page.properties["Dry Run Required"]),
    rollbackRequired: checkboxValue(page.properties["Rollback Required"]),
    defaultExpiryHours: numberValue(page.properties["Default Expiry Hours"]),
    allowedSources: multiSelectNames(page.properties["Allowed Sources"]) as ActionPolicyRecord["allowedSources"],
    notes: textValue(page.properties.Notes),
  };
}

export function toActionRequestRecord(page: DataSourcePageRef): ActionRequestRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    localProjectIds: relationIds(page.properties["Local Project"]),
    policyIds: relationIds(page.properties.Policy),
    targetSourceIds: relationIds(page.properties["Target Source"]),
    status: selectValue(page.properties.Status) as ActionRequestRecord["status"],
    sourceType: selectValue(page.properties["Source Type"]) as ActionRequestRecord["sourceType"],
    recommendationRunIds: relationIds(page.properties["Recommendation Run"]),
    weeklyReviewIds: relationIds(page.properties["Weekly Review"]),
    requestedByIds: peopleIds(page.properties["Requested By"]),
    approverIds: peopleIds(page.properties.Approver),
    requestedAt: dateValue(page.properties["Requested At"]),
    decidedAt: dateValue(page.properties["Decided At"]),
    expiresAt: dateValue(page.properties["Expires At"]),
    plannedPayloadSummary: textValue(page.properties["Planned Payload Summary"]),
    payloadTitle: textValue(page.properties["Payload Title"]),
    payloadBody: textValue(page.properties["Payload Body"]),
    targetNumber: numberValue(page.properties["Target Number"]),
    targetLabels: parseDelimitedText(textValue(page.properties["Target Labels"])),
    targetAssignees: parseDelimitedText(textValue(page.properties["Target Assignees"])),
    executionIntent:
      (selectValue(page.properties["Execution Intent"]) as ActionRequestRecord["executionIntent"]) || "Dry Run",
    latestExecutionIds: relationIds(page.properties["Latest Execution"]),
    latestExecutionStatus:
      (selectValue(page.properties["Latest Execution Status"]) as ActionRequestRecord["latestExecutionStatus"]) || "None",
    providerRequestKey: textValue(page.properties["Provider Request Key"]),
    approvalReason: textValue(page.properties["Approval Reason"]),
    executionNotes: textValue(page.properties["Execution Notes"]),
  };
}

export function toWebhookEndpointRecord(page: DataSourcePageRef): WebhookEndpointRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    provider: selectValue(page.properties.Provider) as WebhookEndpointRecord["provider"],
    mode: selectValue(page.properties.Mode) as WebhookEndpointRecord["mode"],
    receiverPath: textValue(page.properties["Receiver Path"]),
    subscribedEvents: textValue(page.properties["Subscribed Events"]),
    secretEnvVar: textValue(page.properties["Secret Env Var"]),
    identityType: selectValue(page.properties["Identity Type"]) as WebhookEndpointRecord["identityType"],
    replayWindowMinutes: numberValue(page.properties["Replay Window Minutes"]),
    lastDeliveryAt: dateValue(page.properties["Last Delivery At"]),
    notes: textValue(page.properties.Notes),
  };
}

export function toWebhookDeliveryRecord(page: DataSourcePageRef): WebhookDeliveryRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    provider: selectValue(page.properties.Provider) as WebhookDeliveryRecord["provider"],
    endpointIds: relationIds(page.properties.Endpoint),
    localProjectIds: relationIds(page.properties["Local Project"]),
    externalSignalEventIds: relationIds(page.properties["External Signal Event"]),
    status: selectValue(page.properties.Status) as WebhookDeliveryRecord["status"],
    eventType: textValue(page.properties["Event Type"]),
    deliveryId: textValue(page.properties["Delivery ID"]),
    receivedAt: dateValue(page.properties["Received At"]),
    verificationResult: selectValue(page.properties["Verification Result"]) as WebhookDeliveryRecord["verificationResult"],
    eventKey: textValue(page.properties["Event Key"]),
    bodyDigest: textValue(page.properties["Body Digest"]),
    headersExcerpt: textValue(page.properties["Headers Excerpt"]),
    rawExcerpt: textValue(page.properties["Raw Excerpt"]),
    failureNotes: textValue(page.properties["Failure Notes"]),
    firstSeenAt: dateValue(page.properties["First Seen At"]),
    lastSeenAt: dateValue(page.properties["Last Seen At"]),
    receiptCount: numberValue(page.properties["Receipt Count"]),
  };
}

export function toWebhookReceiptRecord(page: DataSourcePageRef): WebhookReceiptRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    provider: selectValue(page.properties.Provider) as WebhookReceiptRecord["provider"],
    endpointIds: relationIds(page.properties.Endpoint),
    deliveryIds: relationIds(page.properties.Delivery),
    receivedAt: dateValue(page.properties["Received At"]),
    verificationResult: selectValue(page.properties["Verification Result"]) as WebhookReceiptRecord["verificationResult"],
    duplicate: checkboxValue(page.properties.Duplicate),
    drainStatus: selectValue(page.properties["Drain Status"]) as WebhookReceiptRecord["drainStatus"],
    deliveryIdValue: textValue(page.properties["Delivery ID"]),
    eventType: textValue(page.properties["Event Type"]),
    eventKey: textValue(page.properties["Event Key"]),
    bodyDigest: textValue(page.properties["Body Digest"]),
    headersExcerpt: textValue(page.properties["Headers Excerpt"]),
    rawExcerpt: textValue(page.properties["Raw Excerpt"]),
    failureNotes: textValue(page.properties["Failure Notes"]),
  };
}

async function ensureDataSourceRef(input: {
  sdk: Client;
  existing:
    | {
        name: string;
        databaseUrl: string;
        databaseId: string;
        dataSourceId: string;
        destinationAlias: string;
      }
    | undefined;
  parentPageUrl: string;
  title: string;
  titlePropertyName: string;
  destinationAlias: string;
}): Promise<GovernanceDatabaseRef> {
  if (input.existing && !input.existing.databaseUrl.includes("00000000000000000000000000000000")) {
    return input.existing;
  }

  const parentPageId = extractNotionIdFromUrl(input.parentPageUrl);
  if (!parentPageId) {
    throw new AppError(`Could not resolve parent page id from "${input.parentPageUrl}"`);
  }

  const response = (await input.sdk.request({
    path: "databases",
    method: "post",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: toRichText(input.title),
      properties: {
        [input.titlePropertyName]: {
          title: {},
        },
      },
    },
  })) as { id: string; url: string; data_sources?: Array<{ id: string }> };

  const dataSourceId = response.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new AppError(`Notion did not return a data source for "${input.title}"`);
  }

  return {
    name: input.title,
    databaseUrl: response.url,
    databaseId: normalizeNotionId(response.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    destinationAlias: input.destinationAlias,
  };
}

function relationSchema(dataSourceId: string): { data_source_id: string; single_property: Record<string, never> } {
  return {
    data_source_id: dataSourceId,
    single_property: {},
  };
}

function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  return [{ type: "text", text: { content: value } }];
}

function colorize(options: Array<[string, string]>): Array<{ name: string; color: string }> {
  return options.map(([name, color]) => ({ name, color }));
}

function multiSelectNames(property?: NotionPageProperty): string[] {
  return Array.isArray(property?.multi_select)
    ? property.multi_select
        .map((entry) => entry?.name?.trim() ?? "")
        .filter(Boolean)
    : [];
}

function peopleIds(property?: NotionPageProperty): string[] {
  return Array.isArray(property?.people)
    ? property.people
        .map((entry) => (typeof entry?.id === "string" ? normalizeNotionId(entry.id) : ""))
        .filter(Boolean)
    : [];
}

function parseDelimitedText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
