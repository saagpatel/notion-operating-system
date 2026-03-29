import { readdir, readFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages, relationValue, titleValue } from "./local-portfolio-control-tower-live.js";
import { requirePhase5ExternalSignals } from "./local-portfolio-external-signals.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import {
  createWebhookReceiptEnvelope,
  loadLocalPortfolioWebhookProviderConfig,
  type WebhookReceiptEnvelope,
} from "./local-portfolio-governance.js";
import {
  ensurePhase6GovernanceSchema,
  toWebhookDeliveryRecord,
  toWebhookEndpointRecord,
} from "./local-portfolio-governance-live.js";
import type { ExternalActionExecutionRecord } from "./local-portfolio-actuation.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

interface GitHubReconcileCandidate {
  issueNumber: number;
  commentId: string;
  actionKeys: string[];
}

export interface WebhookShadowDrainCommandOptions {
  config?: string;
}

export async function runWebhookShadowDrainCommand(
  options: WebhookShadowDrainCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for webhook shadow drain");
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  const providerConfig = await loadLocalPortfolioWebhookProviderConfig();
  const pendingDir = path.resolve(providerConfig.spoolDirectory, "pending");
  const processedDir = path.resolve(providerConfig.spoolDirectory, "processed");
  await mkdir(processedDir, { recursive: true });

  const entries = (await readdir(pendingDir)).filter((entry) => entry.endsWith(".json")).sort();
  const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
  let config = await loadLocalPortfolioControlTowerConfig(configPath);
  config = await ensurePhase6GovernanceSchema(sdk, config);

  const api = new DirectNotionClient(token);
  const phase5 = requirePhase5ExternalSignals(config);
  const phase6 = config.phase6Governance!;
  const executionSchemaPromise = config.phase7Actuation
    ? api.retrieveDataSource(config.phase7Actuation.executions.dataSourceId)
    : Promise.resolve(undefined);
  const [deliverySchema, receiptSchema, endpointSchema, sourceSchema, eventSchema, executionSchema] = await Promise.all([
    api.retrieveDataSource(phase6.webhookDeliveries.dataSourceId),
    api.retrieveDataSource(phase6.webhookReceipts.dataSourceId),
    api.retrieveDataSource(phase6.webhookEndpoints.dataSourceId),
    api.retrieveDataSource(phase5.sources.dataSourceId),
    api.retrieveDataSource(phase5.events.dataSourceId),
    executionSchemaPromise,
  ]);

  const executionPagesPromise =
    config.phase7Actuation && executionSchema
      ? fetchAllPages(sdk, config.phase7Actuation.executions.dataSourceId, executionSchema.titlePropertyName)
      : Promise.resolve([]);
  const [deliveryPages, endpointPages, sourcePages, eventPages, executionPages] = await Promise.all([
    fetchAllPages(sdk, phase6.webhookDeliveries.dataSourceId, deliverySchema.titlePropertyName),
    fetchAllPages(sdk, phase6.webhookEndpoints.dataSourceId, endpointSchema.titlePropertyName),
    fetchAllPages(sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
    fetchAllPages(sdk, phase5.events.dataSourceId, eventSchema.titlePropertyName),
    executionPagesPromise,
  ]);

  const deliveries = deliveryPages.map((page) => toWebhookDeliveryRecord(page));
  const endpoints = endpointPages.map((page) => toWebhookEndpointRecord(page));
  const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
  const executions = executionPages.map((page) => toExternalActionExecutionRecord(page));
  const existingEventKeys = new Set(eventPages.map((page) => page.properties["Event Key"]?.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? ""));
  const deliveryMap = new Map(deliveries.map((delivery) => [`${delivery.provider}::${delivery.deliveryId}`, delivery]));

  let receiptCount = 0;
  let createdDeliveryCount = 0;
  let updatedDeliveryCount = 0;
  let createdEventCount = 0;

  for (const entry of entries) {
    const absolute = path.join(pendingDir, entry);
    let envelope: WebhookReceiptEnvelope;
    try {
      envelope = JSON.parse(await readFile(absolute, "utf8")) as WebhookReceiptEnvelope;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const providerName = envelope.provider === "github" ? "GitHub" : envelope.provider === "vercel" ? "Vercel" : "Google Calendar";
    const endpoint = endpoints.find(
      (candidate) =>
        candidate.provider === providerName && candidate.receiverPath === envelope.endpointPath,
    );
    const deliveryKey = `${providerName}::${envelope.deliveryId}`;
    const existingDelivery = deliveryMap.get(deliveryKey);
    const normalizedEvent = envelope.verificationResult === "Valid" ? createWebhookReceiptEnvelopeToEvent(envelope) : undefined;
    const matchedSource =
      normalizedEvent &&
      sources.find(
        (source) =>
          source.provider === providerName &&
          (source.identifier === normalizedEvent.sourceIdValue || source.sourceUrl === normalizedEvent.sourceUrl),
      );
    const localProjectIds = matchedSource?.localProjectIds ?? [];
    let externalEventId: string | undefined;

    if (!existingDelivery) {
      const created = await api.createPageWithMarkdown({
        parent: { data_source_id: phase6.webhookDeliveries.dataSourceId },
        properties: {
          [deliverySchema.titlePropertyName]: titleValue(`${providerName} delivery ${envelope.deliveryId}`),
        },
        markdown: [
          `# ${providerName} delivery ${envelope.deliveryId}`,
          "",
          `- Provider: ${providerName}`,
          `- Event type: ${envelope.eventType}`,
          `- Verification result: ${envelope.verificationResult}`,
          "",
          envelope.failureNotes || "Verified shadow-mode delivery.",
        ].join("\n"),
      });
      await api.updatePageProperties({
        pageId: created.id,
        properties: {
          Endpoint: relationValue(endpoint ? [endpoint.id] : []),
          "Local Project": relationValue(localProjectIds),
          Provider: { select: { name: providerName } },
          Status: { select: { name: envelope.status } },
          "Event Type": { rich_text: [{ type: "text", text: { content: envelope.eventType } }] },
          "Delivery ID": { rich_text: [{ type: "text", text: { content: envelope.deliveryId } }] },
          "Received At": { date: { start: envelope.receivedAt.slice(0, 10) } },
          "Verification Result": { select: { name: envelope.verificationResult } },
          "Event Key": { rich_text: [{ type: "text", text: { content: envelope.eventKey } }] },
          "Body Digest": { rich_text: [{ type: "text", text: { content: envelope.bodyDigest } }] },
          "Headers Excerpt": { rich_text: [{ type: "text", text: { content: JSON.stringify(envelope.headers) } }] },
          "Raw Excerpt": { rich_text: [{ type: "text", text: { content: envelope.body.slice(0, 1900) } }] },
          "Failure Notes": { rich_text: [{ type: "text", text: { content: envelope.failureNotes || "" } }] },
          "First Seen At": { date: { start: envelope.receivedAt.slice(0, 10) } },
          "Last Seen At": { date: { start: envelope.receivedAt.slice(0, 10) } },
          "Receipt Count": { number: 1 },
        },
      });
      const createdRecord = {
        id: created.id,
        url: created.url,
        title: `${providerName} delivery ${envelope.deliveryId}`,
        provider: providerName as (typeof deliveries)[number]["provider"],
        endpointIds: endpoint ? [endpoint.id] : [],
        localProjectIds,
        externalSignalEventIds: [],
        status: envelope.status,
        eventType: envelope.eventType,
        deliveryId: envelope.deliveryId,
        receivedAt: envelope.receivedAt.slice(0, 10),
        verificationResult: envelope.verificationResult,
        eventKey: envelope.eventKey,
        bodyDigest: envelope.bodyDigest,
        headersExcerpt: JSON.stringify(envelope.headers),
        rawExcerpt: envelope.body.slice(0, 280),
        failureNotes: envelope.failureNotes,
        firstSeenAt: envelope.receivedAt.slice(0, 10),
        lastSeenAt: envelope.receivedAt.slice(0, 10),
        receiptCount: 1,
      };
      deliveryMap.set(deliveryKey, createdRecord);
      createdDeliveryCount += 1;
    } else {
      await api.updatePageProperties({
        pageId: existingDelivery.id,
        properties: {
          Status: { select: { name: "Duplicate" } },
          "Last Seen At": { date: { start: envelope.receivedAt.slice(0, 10) } },
          "Receipt Count": { number: existingDelivery.receiptCount + 1 },
          "Failure Notes": { rich_text: [{ type: "text", text: { content: envelope.failureNotes || existingDelivery.failureNotes || "" } }] },
        },
      });
      existingDelivery.status = "Duplicate";
      existingDelivery.receiptCount += 1;
      existingDelivery.lastSeenAt = envelope.receivedAt.slice(0, 10);
      updatedDeliveryCount += 1;
    }

    const activeDelivery = deliveryMap.get(deliveryKey)!;
    if (normalizedEvent && matchedSource && !existingEventKeys.has(normalizedEvent.eventKey) && envelope.verificationResult === "Valid") {
      const createdEvent = await api.createPageWithMarkdown({
        parent: { data_source_id: phase5.events.dataSourceId },
        properties: {
          [eventSchema.titlePropertyName]: titleValue(normalizedEvent.title),
        },
        markdown: [
          `# ${normalizedEvent.title}`,
          "",
          normalizedEvent.summary,
          "",
          `Raw excerpt: ${normalizedEvent.rawExcerpt}`,
        ].join("\n"),
      });
      externalEventId = createdEvent.id;
      existingEventKeys.add(normalizedEvent.eventKey);
      await api.updatePageProperties({
        pageId: createdEvent.id,
        properties: {
          "Local Project": relationValue(localProjectIds),
          Source: relationValue([matchedSource.id]),
          Provider: { select: { name: normalizedEvent.provider } },
          "Signal Type": { select: { name: normalizedEvent.signalType } },
          "Occurred At": { date: { start: normalizedEvent.occurredAt } },
          Status: { rich_text: [{ type: "text", text: { content: normalizedEvent.status } }] },
          Environment: { select: { name: normalizedEvent.environment } },
          Severity: { select: { name: normalizedEvent.severity } },
          "Source ID": { rich_text: [{ type: "text", text: { content: normalizedEvent.sourceIdValue } }] },
          "Source URL": { url: normalizedEvent.sourceUrl || null },
          "Event Key": { rich_text: [{ type: "text", text: { content: normalizedEvent.eventKey } }] },
          Summary: { rich_text: [{ type: "text", text: { content: normalizedEvent.summary } }] },
          "Raw Excerpt": { rich_text: [{ type: "text", text: { content: normalizedEvent.rawExcerpt } }] },
        },
      });
      createdEventCount += 1;
    }

    const receipt = await api.createPageWithMarkdown({
      parent: { data_source_id: phase6.webhookReceipts.dataSourceId },
      properties: {
        [receiptSchema.titlePropertyName]: titleValue(`${providerName} receipt ${envelope.requestId}`),
      },
      markdown: [
        `# ${providerName} receipt ${envelope.requestId}`,
        "",
        `- Verification: ${envelope.verificationResult}`,
        `- Event type: ${envelope.eventType}`,
        `- Delivery id: ${envelope.deliveryId}`,
        "",
        envelope.failureNotes || "Shadow-mode receipt captured successfully.",
      ].join("\n"),
    });
    await api.updatePageProperties({
      pageId: receipt.id,
      properties: {
        Endpoint: relationValue(endpoint ? [endpoint.id] : []),
        Delivery: relationValue(activeDelivery ? [activeDelivery.id] : []),
        Provider: { select: { name: providerName } },
        "Received At": { date: { start: envelope.receivedAt.slice(0, 10) } },
        "Verification Result": { select: { name: envelope.verificationResult } },
        Duplicate: { checkbox: Boolean(existingDelivery) },
        "Drain Status": { select: { name: "Written" } },
        "Delivery ID": { rich_text: [{ type: "text", text: { content: envelope.deliveryId } }] },
        "Event Type": { rich_text: [{ type: "text", text: { content: envelope.eventType } }] },
        "Event Key": { rich_text: [{ type: "text", text: { content: envelope.eventKey } }] },
        "Body Digest": { rich_text: [{ type: "text", text: { content: envelope.bodyDigest } }] },
        "Headers Excerpt": { rich_text: [{ type: "text", text: { content: JSON.stringify(envelope.headers) } }] },
        "Raw Excerpt": { rich_text: [{ type: "text", text: { content: envelope.body.slice(0, 1900) } }] },
        "Failure Notes": { rich_text: [{ type: "text", text: { content: envelope.failureNotes || "" } }] },
      },
    });
    receiptCount += 1;

    if (externalEventId) {
      await api.updatePageProperties({
        pageId: activeDelivery.id,
        properties: {
          "External Signal Event": relationValue([externalEventId]),
          Status: { select: { name: "Processed" } },
        },
      });
    }

    if (config.phase7Actuation && envelope.verificationResult === "Valid" && providerName === "GitHub") {
      const candidate = extractGitHubReconcileCandidate(envelope.body, envelope.eventType);
      if (candidate) {
        const matchingExecution = matchedSource
          ? findMatchingGitHubExecutionForReceipt({
              executions,
              matchedSourceId: matchedSource.id,
              candidate,
            })
          : undefined;
        if (matchingExecution) {
          await api.updatePageProperties({
            pageId: matchingExecution.id,
            properties: {
              "Reconcile Status": { select: { name: "Confirmed" } },
              "Response Summary": {
                rich_text: [{ type: "text", text: { content: `${matchingExecution.responseSummary} Webhook feedback confirmed the GitHub outcome.`.trim() } }],
              },
            },
          });
          matchingExecution.reconcileStatus = "Confirmed";
          matchingExecution.responseSummary = `${matchingExecution.responseSummary} Webhook feedback confirmed the GitHub outcome.`.trim();
        }
      }
    }

    try {
      await rename(absolute, path.join(processedDir, entry));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  const output = {
    ok: true,
    drainedFiles: entries.length,
    receiptCount,
    createdDeliveryCount,
    updatedDeliveryCount,
    createdEventCount,
  };
  recordCommandOutputSummary(output, {
    metadata: {
      drainedFiles: entries.length,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    await runWebhookShadowDrainCommand({
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

function createWebhookReceiptEnvelopeToEvent(envelope: WebhookReceiptEnvelope) {
  const parsedPayload = JSON.parse(envelope.body) as Record<string, unknown>;
  const provider = envelope.provider;
  if (provider === "github") {
    const repository = (parsedPayload.repository ?? {}) as Record<string, unknown>;
    const repoFullName = typeof repository.full_name === "string" ? repository.full_name.trim() : "";
    const repoUrl = typeof repository.html_url === "string" ? repository.html_url.trim() : "";
    if (envelope.eventType === "issues") {
      const issue = (parsedPayload.issue ?? {}) as Record<string, unknown>;
      const issueNumber = typeof issue.number === "number" ? issue.number : undefined;
      const title = typeof issue.title === "string" ? issue.title.trim() : "Issue";
      const status = typeof parsedPayload.action === "string" ? parsedPayload.action.trim() : "updated";
      const occurredAt = typeof issue.updated_at === "string" ? issue.updated_at.slice(0, 10) : envelope.receivedAt.slice(0, 10);
      return {
        provider: "GitHub" as const,
        signalType: "Issue" as const,
        status,
        severity: ["opened", "edited", "reopened", "assigned", "labeled"].includes(status.toLowerCase()) ? ("Info" as const) : ("Watch" as const),
        occurredAt,
        title: issueNumber ? `Issue #${issueNumber} - ${title}` : title,
        sourceIdValue: repoFullName,
        sourceUrl: typeof issue.html_url === "string" ? issue.html_url.trim() : repoUrl,
        environment: "N/A" as const,
        eventKey: envelope.eventKey,
        summary: `${repoFullName || "GitHub repo"} issue event is ${status}.`,
        rawExcerpt: envelope.body.slice(0, 280),
      };
    }
    if (envelope.eventType === "issue_comment") {
      const issue = (parsedPayload.issue ?? {}) as Record<string, unknown>;
      const comment = (parsedPayload.comment ?? {}) as Record<string, unknown>;
      const issueNumber = typeof issue.number === "number" ? issue.number : undefined;
      const status = typeof parsedPayload.action === "string" ? parsedPayload.action.trim() : "created";
      const occurredAt = typeof comment.updated_at === "string" ? comment.updated_at.slice(0, 10) : envelope.receivedAt.slice(0, 10);
      const isPullRequestComment = !!(issue.pull_request && typeof issue.pull_request === "object");
      return {
        provider: "GitHub" as const,
        signalType: "Issue Comment" as const,
        status,
        severity: "Info" as const,
        occurredAt,
        title: issueNumber
          ? `${isPullRequestComment ? "PR" : "Issue"} comment on #${issueNumber}`
          : "Issue comment",
        sourceIdValue: repoFullName,
        sourceUrl: typeof comment.html_url === "string" ? comment.html_url.trim() : repoUrl,
        environment: "N/A" as const,
        eventKey: envelope.eventKey,
        summary: `${repoFullName || "GitHub repo"} ${isPullRequestComment ? "PR" : "issue"} comment is ${status}.`,
        rawExcerpt: envelope.body.slice(0, 280),
      };
    }
    if (envelope.eventType === "pull_request") {
      const pullRequest = (parsedPayload.pull_request ?? {}) as Record<string, unknown>;
      const prNumber = typeof pullRequest.number === "number" ? pullRequest.number : undefined;
      const title = typeof pullRequest.title === "string" ? pullRequest.title.trim() : "Pull Request";
      const status = typeof parsedPayload.action === "string" ? parsedPayload.action.trim() : "open";
      const occurredAt = typeof pullRequest.updated_at === "string" ? pullRequest.updated_at.slice(0, 10) : envelope.receivedAt.slice(0, 10);
      return {
        provider: "GitHub" as const,
        signalType: "Pull Request" as const,
        status,
        severity: ["closed", "merged"].includes(status.toLowerCase()) ? ("Info" as const) : ("Watch" as const),
        occurredAt,
        title: prNumber ? `PR #${prNumber} - ${title}` : title,
        sourceIdValue: repoFullName,
        sourceUrl: typeof pullRequest.html_url === "string" ? pullRequest.html_url.trim() : repoUrl,
        environment: "N/A" as const,
        eventKey: envelope.eventKey,
        summary: `${repoFullName || "GitHub repo"} pull request is ${status}.`,
        rawExcerpt: envelope.body.slice(0, 280),
      };
    }
    if (envelope.eventType === "workflow_run") {
      const workflowRun = (parsedPayload.workflow_run ?? {}) as Record<string, unknown>;
      const status =
        typeof workflowRun.conclusion === "string"
          ? workflowRun.conclusion.trim()
          : typeof workflowRun.status === "string"
            ? workflowRun.status.trim()
            : "unknown";
      const occurredAt = typeof workflowRun.updated_at === "string" ? workflowRun.updated_at.slice(0, 10) : envelope.receivedAt.slice(0, 10);
      return {
        provider: "GitHub" as const,
        signalType: "Workflow Run" as const,
        status,
        severity: ["failed", "failure", "error", "timed_out", "cancelled", "canceled"].includes(status.toLowerCase()) ? ("Risk" as const) : ("Info" as const),
        occurredAt,
        title: `${typeof workflowRun.name === "string" ? workflowRun.name.trim() : "Workflow Run"} - ${repoFullName || "GitHub"}`,
        sourceIdValue: repoFullName,
        sourceUrl: typeof workflowRun.html_url === "string" ? workflowRun.html_url.trim() : repoUrl,
        environment: "N/A" as const,
        eventKey: envelope.eventKey,
        summary: `${repoFullName || "GitHub repo"} workflow run is ${status}.`,
        rawExcerpt: envelope.body.slice(0, 280),
      };
    }
  }
  if (provider === "vercel") {
    const project = (parsedPayload.project ?? {}) as Record<string, unknown>;
    const deployment = (parsedPayload.deployment ?? {}) as Record<string, unknown>;
    const projectId =
      typeof project.id === "string" ? project.id.trim() : typeof parsedPayload.projectId === "string" ? parsedPayload.projectId.trim() : "";
    const projectName =
      typeof project.name === "string" ? project.name.trim() : typeof parsedPayload.projectName === "string" ? parsedPayload.projectName.trim() : projectId;
    const status =
      typeof deployment.state === "string" ? deployment.state.trim() : typeof parsedPayload.state === "string" ? parsedPayload.state.trim() : envelope.eventType;
    const occurredAt =
      typeof deployment.createdAt === "string" ? deployment.createdAt.slice(0, 10) : typeof parsedPayload.createdAt === "string" ? parsedPayload.createdAt.slice(0, 10) : envelope.receivedAt.slice(0, 10);
    return {
      provider: "Vercel" as const,
      signalType: "Deployment" as const,
      status,
      severity: ["failed", "error", "canceled", "cancelled"].includes(status.toLowerCase()) ? ("Risk" as const) : ("Info" as const),
      occurredAt,
      title: `${projectName || "Vercel project"} deployment`,
      sourceIdValue: projectId || projectName,
      sourceUrl:
        typeof deployment.url === "string" ? deployment.url.trim() : typeof parsedPayload.url === "string" ? parsedPayload.url.trim() : "",
      environment:
        (typeof deployment.target === "string" && deployment.target === "production") ||
        (typeof parsedPayload.target === "string" && parsedPayload.target === "production")
          ? ("Production" as const)
          : ("Preview" as const),
      eventKey: envelope.eventKey,
      summary: `${projectName || "Vercel project"} deployment is ${status}.`,
      rawExcerpt: envelope.body.slice(0, 280),
    };
  }
  return undefined;
}

export function findMatchingGitHubExecutionForReceipt(input: {
  executions: ExternalActionExecutionRecord[];
  matchedSourceId: string;
  candidate: GitHubReconcileCandidate;
}): ExternalActionExecutionRecord | undefined {
  const candidates = input.executions.filter(
    (execution) =>
      execution.provider === "GitHub" &&
      execution.status === "Succeeded" &&
      execution.reconcileStatus !== "Confirmed" &&
      execution.mode === "Live" &&
      execution.targetSourceIds.includes(input.matchedSourceId) &&
      ((input.candidate.commentId && execution.commentId === input.candidate.commentId) ||
        (input.candidate.issueNumber > 0 &&
          execution.issueNumber === input.candidate.issueNumber &&
          input.candidate.actionKeys.includes(execution.actionKey))),
  );

  if (input.candidate.commentId) {
    const exactCommentMatch = candidates.find((execution) => execution.commentId === input.candidate.commentId);
    if (exactCommentMatch) {
      return exactCommentMatch;
    }
  }

  return candidates[0];
}

export function extractGitHubReconcileCandidate(
  body: string,
  eventType: string,
): GitHubReconcileCandidate | undefined {
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (eventType === "issues") {
    const issue = (parsedPayload.issue ?? {}) as Record<string, unknown>;
    const issueNumber = typeof issue.number === "number" ? issue.number : 0;
    const action = typeof parsedPayload.action === "string" ? parsedPayload.action.trim() : "";
    if (!issueNumber) {
      return undefined;
    }
    return {
      issueNumber,
      commentId: "",
      actionKeys:
        action === "opened"
          ? ["github.create_issue"]
          : ["github.update_issue", "github.set_issue_labels", "github.set_issue_assignees"],
    };
  }
  if (eventType === "issue_comment") {
    const issue = (parsedPayload.issue ?? {}) as Record<string, unknown>;
    const comment = (parsedPayload.comment ?? {}) as Record<string, unknown>;
    const issueNumber = typeof issue.number === "number" ? issue.number : 0;
    const commentId = typeof comment.id === "number" ? String(comment.id) : "";
    const isPullRequestComment = !!(issue.pull_request && typeof issue.pull_request === "object");
    return {
      issueNumber,
      commentId,
      actionKeys: [isPullRequestComment ? "github.comment_pull_request" : "github.add_issue_comment"],
    };
  }
  return undefined;
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "webhook-shadow-drain"]);
}
