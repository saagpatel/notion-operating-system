import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages, relationValue, richTextValue, titleValue } from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import {
  buildGitHubCompensationPlan,
  buildGitHubExecutionPayload,
  describeGitHubActionPreflight,
  computePostDryRunReadiness,
  computeActuationExecutionKey,
  evaluateActionRequestReadiness,
  fetchGitHubActionPreflight,
  loadLocalPortfolioActuationTargetConfig,
  renderActuationPacketSection,
  resolveActuationTarget,
  requirePhase7Actuation,
  summarizeGitHubAssigneeDelta,
  summarizeGitHubLabelDelta,
  type ActuationActionKey,
  type GitHubActionPreflight,
  SUPPORTED_GITHUB_ACTION_KEYS,
} from "./local-portfolio-actuation.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { AppError } from "../utils/errors.js";

const ACTUATION_PACKET_START = "<!-- codex:notion-actuation-packet:start -->";
const ACTUATION_PACKET_END = "<!-- codex:notion-actuation-packet:end -->";

export interface ActionDryRunCommandOptions {
  request?: string;
  config?: string;
}

export async function runActionDryRunCommand(
  options: ActionDryRunCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for action dry runs");
  if (!options.request) {
    throw new AppError("--request <page-id> is required");
  }
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
    const phase7 = requirePhase7Actuation(config);
    if (!config.phase6Governance || !config.phase5ExternalSignals) {
      throw new AppError("Phase 7 dry run requires phase6Governance and phase5ExternalSignals");
    }

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);
    const targetConfig = await loadLocalPortfolioActuationTargetConfig();

    const [requestSchema, policySchema, sourceSchema, executionSchema] = await Promise.all([
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
      api.retrieveDataSource(phase7.executions.dataSourceId),
    ]);

    const [requestPages, policyPages, sourcePages, executionPages] = await Promise.all([
      fetchAllPages(sdk, config.phase6Governance.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase6Governance.policies.dataSourceId, policySchema.titlePropertyName),
      fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, phase7.executions.dataSourceId, executionSchema.titlePropertyName),
    ]);

    const request = requestPages
      .map((page) => toActionRequestRecord(page))
      .find((entry) => entry.id === options.request);
    if (!request) {
      throw new AppError(`Could not find action request "${options.request}"`);
    }
    const policies = policyPages.map((page) => toActionPolicyRecord(page));
    const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
    const executions = executionPages.map((page) => toExternalActionExecutionRecord(page));
    const policy = policies.find((entry) => request.policyIds.includes(entry.id));
    if (!policy) {
      throw new AppError(`Action request "${request.title}" is missing a linked policy`);
    }
    if (!SUPPORTED_GITHUB_ACTION_KEYS.includes(policy.title as (typeof SUPPORTED_GITHUB_ACTION_KEYS)[number])) {
      throw new AppError(`Unsupported action policy "${policy.title}" for Phase 7`);
    }
    const actionKey = policy.title as ActuationActionKey;

    let target = null;
    let payload = null;
    let preflight: GitHubActionPreflight | undefined;
    let idempotencyKey = "";
    const latestExecution = executions
      .filter((execution) => request.latestExecutionIds.includes(execution.id))
      .sort((left, right) => right.executedAt.localeCompare(left.executedAt))[0];

    try {
      target = resolveActuationTarget({
        request,
        sources,
        targetConfig,
        actionKey,
      });
      payload = buildGitHubExecutionPayload({
        request,
        target,
        actionKey,
      });
      preflight = await fetchGitHubActionPreflight({ payload });
      idempotencyKey = computeActuationExecutionKey({
        requestId: request.id,
        actionKey,
        targetSourceId: target.source.id,
        mode: "Dry Run",
        payload,
      });
    } catch {
      // Validation notes below will capture why the request is not ready.
    }

    const validationNotes = evaluateActionRequestReadiness({
      request,
      policies,
      target: target ?? undefined,
      config,
      latestDryRun:
        latestExecution && latestExecution.mode === "Dry Run" ? latestExecution : undefined,
      actionKey,
      preflight,
      today: new Date().toISOString().slice(0, 10),
    });

    const now = new Date().toISOString();
    const postDryRun = computePostDryRunReadiness({
      request,
      policies,
      target: target ?? undefined,
      config,
      actionKey,
      executedAt: now,
      preflightNotes: validationNotes,
      preflight,
    });
    const preflightNotes = payload ? describeGitHubActionPreflight({ actionKey, preflight }) : [];
    const executionTitle = `Dry run - ${request.title} - ${now.slice(0, 19)}`;
    const markdown = [
      `# ${executionTitle}`,
      "",
      `- Action request: [${request.title}](${request.url})`,
      `- Policy: ${policy.title}`,
      `- Mode: Dry Run`,
      `- Status: ${validationNotes.length > 0 ? "Failed" : "Succeeded"}`,
      `- Executed at: ${now}`,
      "",
      "## Validation Notes",
      ...(validationNotes.length > 0 ? validationNotes.map((note) => `- ${note}`) : ["- Dry run succeeded."]),
      ...(preflightNotes.length > 0 ? ["", "## GitHub Preflight", ...preflightNotes.map((note) => `- ${note}`)] : []),
      "",
      "## Payload Preview",
      ...(payload
        ? [`- Repo: ${payload.owner}/${payload.repo}`, `- Title: ${payload.title || "(comment only)"}`, `- Body length: ${payload.body?.length ?? 0}`]
        : ["- Payload preview unavailable."]),
    ].join("\n");

    const created = await api.createPageWithMarkdown({
      parent: { data_source_id: phase7.executions.dataSourceId },
      properties: {
        [executionSchema.titlePropertyName]: titleValue(executionTitle),
      },
      markdown,
    });
    await api.updatePageProperties({
      pageId: created.id,
      properties: {
        "Action Request": relationValue([request.id]),
        "Local Project": relationValue(request.localProjectIds),
        Policy: relationValue(request.policyIds),
        "Target Source": relationValue(target ? [target.source.id] : []),
        Provider: { select: { name: "GitHub" } },
        "Action Key": richTextValue(actionKey),
        Mode: { select: { name: "Dry Run" } },
        Status: { select: { name: validationNotes.length > 0 ? "Failed" : "Succeeded" } },
        "Idempotency Key": richTextValue(idempotencyKey),
        "Executed At": { date: { start: now } },
        "Issue Number": { number: target?.source.provider === "GitHub" ? request.targetNumber || null : null },
        "Comment ID": richTextValue(""),
        "Label Delta Summary": richTextValue(payload ? summarizeGitHubLabelDelta({ payload, preflight }) : ""),
        "Assignee Delta Summary": richTextValue(payload ? summarizeGitHubAssigneeDelta({ payload, preflight }) : ""),
        "Response Classification": { select: { name: validationNotes.length > 0 ? "Validation Failure" : "Success" } },
        "Reconcile Status": { select: { name: "Not Needed" } },
        "Response Summary": richTextValue(
          validationNotes.length > 0
            ? "Dry run found validation blockers."
            : preflightNotes.length > 0
              ? `Dry run succeeded. ${preflightNotes.join(" ")}`
              : "Dry run succeeded.",
        ),
        "Failure Notes": richTextValue(validationNotes.join(" ")),
        "Compensation Plan": richTextValue(buildGitHubCompensationPlan(actionKey)),
      },
    });

    await api.updatePageProperties({
      pageId: request.id,
      properties: {
        "Latest Execution": relationValue([created.id]),
        "Latest Execution Status": { select: { name: postDryRun.latestExecutionStatus } },
        "Execution Intent": { select: { name: postDryRun.executionIntent } },
        "Execution Notes": richTextValue(postDryRun.notes.join(" ")),
      },
    });

    const requestMarkdown = await api.readPageMarkdown(request.id);
    const packet = renderActuationPacketSection({
      request: {
        ...request,
        executionIntent: postDryRun.executionIntent,
        latestExecutionStatus: postDryRun.latestExecutionStatus,
        executionNotes: postDryRun.notes.join(" "),
      },
      payload,
      preflight,
      target,
      latestExecution: {
        id: created.id,
        url: created.url,
        title: executionTitle,
        actionRequestIds: [request.id],
        localProjectIds: request.localProjectIds,
        policyIds: request.policyIds,
        targetSourceIds: target ? [target.source.id] : [],
        provider: "GitHub",
        actionKey,
        mode: "Dry Run",
        status: validationNotes.length > 0 ? "Failed" : "Succeeded",
        idempotencyKey,
        executedAt: now.slice(0, 10),
        providerResultKey: "",
        providerUrl: "",
        issueNumber: request.targetNumber,
        commentId: "",
        labelDeltaSummary: payload ? summarizeGitHubLabelDelta({ payload, preflight }) : "",
        assigneeDeltaSummary: payload ? summarizeGitHubAssigneeDelta({ payload, preflight }) : "",
        responseClassification: validationNotes.length > 0 ? "Validation Failure" : "Success",
        reconcileStatus: "Not Needed",
        responseSummary:
          validationNotes.length > 0
            ? "Dry run found validation blockers."
            : preflightNotes.length > 0
              ? `Dry run succeeded. ${preflightNotes.join(" ")}`
              : "Dry run succeeded.",
        failureNotes: validationNotes.join(" "),
        compensationPlan: buildGitHubCompensationPlan(actionKey),
      },
      validationNotes: postDryRun.notes,
      idempotencyKey,
    });
    const updatedMarkdown = mergeManagedSection(
      requestMarkdown.markdown,
      packet,
      ACTUATION_PACKET_START,
      ACTUATION_PACKET_END,
    );
    if (updatedMarkdown !== requestMarkdown.markdown) {
      await api.patchPageMarkdown({
        pageId: request.id,
        command: "replace_content",
        newMarkdown: updatedMarkdown,
      });
    }

    const output = {
      ok: true,
      requestId: request.id,
      executionId: created.id,
      executionUrl: created.url,
      readyForLive: validationNotes.length === 0,
      validationNotes,
    };
    recordCommandOutputSummary(output, {
      mode: "dry-run",
      metadata: {
        requestId: request.id,
      },
    });
    console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "action-dry-run"]);
}
