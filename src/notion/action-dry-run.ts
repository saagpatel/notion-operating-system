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
import type { ActionPolicyRecord, ActionRequestRecord } from "./local-portfolio-governance.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import {
  buildGitHubCompensationPlan,
  buildGitHubExecutionPayload,
  buildVercelCompensationPlan,
  buildVercelRedeployExecutionPayload,
  describeGitHubActionPreflight,
  computePostDryRunReadiness,
  computeActuationExecutionKey,
  evaluateActionRequestReadiness,
  fetchVercelRedeployPreflight,
  fetchGitHubActionPreflight,
  loadLocalPortfolioActuationTargetConfig,
  renderActuationPacketSection,
  resolveActuationTarget,
  requirePhase7Actuation,
  summarizeGitHubAssigneeDelta,
  summarizeGitHubLabelDelta,
  type ActuationActionKey,
  type GitHubActionPreflight,
  type VercelRedeployPreflight,
  SUPPORTED_ACTION_KEYS,
} from "./local-portfolio-actuation.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { AppError } from "../utils/errors.js";

const ACTUATION_PACKET_START = "<!-- codex:notion-actuation-packet:start -->";
const ACTUATION_PACKET_END = "<!-- codex:notion-actuation-packet:end -->";

export interface ActionDryRunPreparation {
  target: ReturnType<typeof resolveActuationTarget> | null;
  payload: ReturnType<typeof buildGitHubExecutionPayload> | ReturnType<typeof buildVercelRedeployExecutionPayload> | null;
  preflight?: GitHubActionPreflight | VercelRedeployPreflight;
  idempotencyKey: string;
  preparationError?: string;
}

export async function prepareActionDryRun(
  input: {
    request: ActionRequestRecord;
    sources: ReturnType<typeof toExternalSignalSourceRecord>[];
    targetConfig: Awaited<ReturnType<typeof loadLocalPortfolioActuationTargetConfig>>;
    actionKey: ActuationActionKey;
  },
  dependencies: {
    fetchPreflight: typeof fetchGitHubActionPreflight;
    fetchVercelPreflight?: typeof fetchVercelRedeployPreflight;
  } = {
    fetchPreflight: fetchGitHubActionPreflight,
  },
): Promise<ActionDryRunPreparation> {
  try {
    const target = resolveActuationTarget({
      request: input.request,
      sources: input.sources,
      targetConfig: input.targetConfig,
      actionKey: input.actionKey,
    });
    if (input.actionKey === "vercel.redeploy") {
      const preflight = await (dependencies.fetchVercelPreflight ?? fetchVercelRedeployPreflight)({ target });
      const payload = buildVercelRedeployExecutionPayload({
        request: input.request,
        target,
        preflight,
      });
      const idempotencyKey = computeActuationExecutionKey({
        requestId: input.request.id,
        actionKey: input.actionKey,
        targetSourceId: target.source.id,
        mode: "Dry Run",
        payload,
      });
      return {
        target,
        payload,
        preflight,
        idempotencyKey,
      };
    }
    const payload = buildGitHubExecutionPayload({
      request: input.request,
      target,
      actionKey: input.actionKey,
    });
    const preflight = await dependencies.fetchPreflight({ payload });
    const idempotencyKey = computeActuationExecutionKey({
      requestId: input.request.id,
      actionKey: input.actionKey,
      targetSourceId: target.source.id,
      mode: "Dry Run",
      payload,
    });
    return {
      target,
      payload,
      preflight,
      idempotencyKey,
    };
  } catch (error) {
    return {
      target: null,
      payload: null,
      preflight: undefined,
      idempotencyKey: "",
      preparationError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function evaluateActionDryRunReadiness(input: {
  request: ActionRequestRecord;
  policies: ActionPolicyRecord[];
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  actionKey: ActuationActionKey;
  latestExecution?: ReturnType<typeof toExternalActionExecutionRecord>;
  preparation: ActionDryRunPreparation;
  today: string;
  executedAt: string;
}): {
  validationNotes: string[];
  postDryRun: ReturnType<typeof computePostDryRunReadiness>;
  readyForLive: boolean;
} {
  const validationNotes = evaluateActionRequestReadiness({
    request: input.request,
    policies: input.policies,
    target: input.preparation.target ?? undefined,
    config: input.config,
    latestDryRun:
      input.latestExecution && input.latestExecution.mode === "Dry Run"
        ? input.latestExecution
        : undefined,
    actionKey: input.actionKey,
    preflight: input.preparation.preflight,
    today: input.today,
  });

  const postDryRun = computePostDryRunReadiness({
    request: input.request,
    policies: input.policies,
    target: input.preparation.target ?? undefined,
    config: input.config,
    actionKey: input.actionKey,
    executedAt: input.executedAt,
    preflightNotes: validationNotes,
    preflight: input.preparation.preflight,
  });

  return {
    validationNotes,
    postDryRun,
    readyForLive: validationNotes.length === 0,
  };
}

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
    if (!SUPPORTED_ACTION_KEYS.includes(policy.title as (typeof SUPPORTED_ACTION_KEYS)[number])) {
      throw new AppError(`Unsupported action policy "${policy.title}" for Phase 7`);
    }
    const actionKey = policy.title as ActuationActionKey;

    const latestExecution = executions
      .filter((execution) => request.latestExecutionIds.includes(execution.id))
      .sort((left, right) => right.executedAt.localeCompare(left.executedAt))[0];
    const preparation = await prepareActionDryRun({
      request,
      sources,
      targetConfig,
      actionKey,
    });

    const now = new Date().toISOString();
    const readiness = evaluateActionDryRunReadiness({
      request,
      policies,
      config,
      actionKey,
      latestExecution,
      preparation,
      today: now.slice(0, 10),
      executedAt: now,
    });
    const { validationNotes, postDryRun } = readiness;
    const target = preparation.target;
    const payload = preparation.payload;
    const preflight = preparation.preflight;
    const idempotencyKey = preparation.idempotencyKey;
    const preflightNotes =
      payload?.provider === "GitHub" && preflight
        ? describeGitHubActionPreflight({ actionKey, preflight: preflight as GitHubActionPreflight })
        : [];
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
        ? payload.provider === "GitHub"
          ? [`- Repo: ${payload.owner}/${payload.repo}`, `- Title: ${payload.title || "(comment only)"}`, `- Body length: ${payload.body?.length ?? 0}`]
          : [
              `- Project: ${payload.projectName}`,
              `- Environment: ${payload.targetEnvironment}`,
              `- Deployment basis: ${payload.deploymentId}`,
            ]
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
        Provider: { select: { name: payload?.provider ?? "GitHub" } },
        "Action Key": richTextValue(actionKey),
        Mode: { select: { name: "Dry Run" } },
        Status: { select: { name: validationNotes.length > 0 ? "Failed" : "Succeeded" } },
        "Idempotency Key": richTextValue(idempotencyKey),
        "Executed At": { date: { start: now } },
        "Issue Number": { number: target?.source.provider === "GitHub" ? request.targetNumber || null : null },
        "Comment ID": richTextValue(""),
        "Label Delta Summary": richTextValue(
          payload?.provider === "GitHub" ? summarizeGitHubLabelDelta({ payload, preflight: preflight as GitHubActionPreflight }) : "",
        ),
        "Assignee Delta Summary": richTextValue(
          payload?.provider === "GitHub"
            ? summarizeGitHubAssigneeDelta({ payload, preflight: preflight as GitHubActionPreflight })
            : "",
        ),
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
        "Compensation Plan": richTextValue(payload?.provider === "Vercel" ? buildVercelCompensationPlan() : buildGitHubCompensationPlan(actionKey)),
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
        provider: payload?.provider ?? "GitHub",
        actionKey,
        mode: "Dry Run",
        status: validationNotes.length > 0 ? "Failed" : "Succeeded",
        idempotencyKey,
        executedAt: now.slice(0, 10),
        providerResultKey: "",
        providerUrl: "",
        issueNumber: payload?.provider === "GitHub" ? request.targetNumber : 0,
        commentId: "",
        labelDeltaSummary:
          payload?.provider === "GitHub" ? summarizeGitHubLabelDelta({ payload, preflight: preflight as GitHubActionPreflight }) : "",
        assigneeDeltaSummary:
          payload?.provider === "GitHub"
            ? summarizeGitHubAssigneeDelta({ payload, preflight: preflight as GitHubActionPreflight })
            : "",
        responseClassification: validationNotes.length > 0 ? "Validation Failure" : "Success",
        reconcileStatus: "Not Needed",
        responseSummary:
          validationNotes.length > 0
            ? "Dry run found validation blockers."
            : preflightNotes.length > 0
              ? `Dry run succeeded. ${preflightNotes.join(" ")}`
              : "Dry run succeeded.",
        failureNotes: validationNotes.join(" "),
        compensationPlan: payload?.provider === "Vercel" ? buildVercelCompensationPlan() : buildGitHubCompensationPlan(actionKey),
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
      readyForLive: readiness.readyForLive,
      validationNotes,
    };
    recordCommandOutputSummary(output, {
      mode: "dry-run",
      status: validationNotes.length > 0 ? "warning" : "completed",
      warningCategories: validationNotes.length > 0 ? ["validation_gap"] : undefined,
      metadata: {
        requestId: request.id,
      },
    });
    console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "action-dry-run"]);
}
