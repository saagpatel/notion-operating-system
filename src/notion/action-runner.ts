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
  classifyGitHubFailureMessage,
  computePostDryRunReadiness,
  computeActuationExecutionKey,
  describeGitHubActionPreflight,
  evaluateActionRequestReadiness,
  executeGitHubAction,
  fetchGitHubActionPreflight,
  loadLocalPortfolioActuationTargetConfig,
  renderActuationPacketSection,
  resolveActuationTarget,
  requirePhase7Actuation,
  summarizeGitHubAssigneeDelta,
  summarizeGitHubLabelDelta,
  type ActuationActionKey,
  type GitHubActionPreflight,
  type GitHubExecutionResult,
  type GitHubReconcileStatus,
  type GitHubResponseClassification,
  SUPPORTED_GITHUB_ACTION_KEYS,
  type ExternalActionExecutionRecord,
} from "./local-portfolio-actuation.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

const ACTUATION_PACKET_START = "<!-- codex:notion-actuation-packet:start -->";
const ACTUATION_PACKET_END = "<!-- codex:notion-actuation-packet:end -->";

export interface ActionRunnerResult {
  requestId: string;
  executionId?: string;
  status: "Succeeded" | "Skipped" | "Failed";
  notes?: string;
}

export interface ActionRunnerDecisionInput {
  request: Pick<ActionRequestRecord, "id" | "policyIds">;
  policies: ActionPolicyRecord[];
  executions: Array<Pick<ExternalActionExecutionRecord, "id" | "mode" | "status" | "idempotencyKey">>;
  mode: "dry-run" | "live";
  actionKey?: string;
  idempotencyKey?: string;
  validationNotes?: string[];
}

export function evaluateActionRunnerDecision(
  input: ActionRunnerDecisionInput,
): { status: "execute" } | { status: "Skipped"; notes: string } {
  const policy = input.policies.find((entry) => input.request.policyIds.includes(entry.id));
  if (
    !policy ||
    !SUPPORTED_GITHUB_ACTION_KEYS.includes(policy.title as (typeof SUPPORTED_GITHUB_ACTION_KEYS)[number])
  ) {
    return { status: "Skipped", notes: "Missing supported linked policy." };
  }

  const validationNotes = input.validationNotes ?? [];
  if (input.mode === "live" && validationNotes.length > 0) {
    return { status: "Skipped", notes: validationNotes.join(" ") };
  }

  if (input.mode === "live" && input.idempotencyKey) {
    const duplicate = input.executions.find(
      (execution) =>
        execution.mode === "Live" &&
        execution.status === "Succeeded" &&
        execution.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) {
      return { status: "Skipped", notes: "A successful live execution already exists." };
    }
  }

  return { status: "execute" };
}

export function summarizeActionRunnerResults(results: ActionRunnerResult[]): {
  recordsUpdated: number;
  recordsSkipped: number;
  failureCount: number;
} {
  return {
    recordsUpdated: results.filter((result) => result.status === "Succeeded").length,
    recordsSkipped: results.filter((result) => result.status === "Skipped").length,
    failureCount: results.filter((result) => result.status === "Failed").length,
  };
}

export function classifyActionRunnerFailure(error: unknown): {
  failureNotes: string;
  failureClassification: GitHubResponseClassification;
} {
  const failureNotes = toErrorMessage(error);
  return {
    failureNotes,
    failureClassification: classifyGitHubFailureMessage(failureNotes) as GitHubResponseClassification,
  };
}

export interface ActionRunnerCommandOptions {
  request?: string;
  mode?: "dry-run" | "live";
  limit?: number;
  config?: string;
}

export async function runActionRunnerCommand(
  options: ActionRunnerCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for the action runner");
  const mode = options.mode ?? "dry-run";
  const config = await loadLocalPortfolioControlTowerConfig(
    options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  );
    const phase7 = requirePhase7Actuation(config);
    if (!config.phase6Governance || !config.phase5ExternalSignals) {
      throw new AppError("Phase 7 action runner requires phase6Governance and phase5ExternalSignals");
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

    const policies = policyPages.map((page) => toActionPolicyRecord(page));
    const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
    const executions = executionPages.map((page) => toExternalActionExecutionRecord(page));
    const requests = requestPages
      .map((page) => toActionRequestRecord(page))
      .filter((request) =>
        options.request
          ? request.id === options.request
          : request.status === "Approved" &&
            (mode === "live"
              ? request.executionIntent === "Ready for Live"
              : (request.executionIntent || "Dry Run") === "Dry Run"),
      )
      .slice(0, options.limit ?? (mode === "live" ? phase7.runnerLimits.maxLivePerRun : phase7.runnerLimits.maxDryRunsPerRun));

    const results: ActionRunnerResult[] = [];

    for (const request of requests) {
      const policy = policies.find((entry) => request.policyIds.includes(entry.id));
      const baselineDecision = evaluateActionRunnerDecision({
        request,
        policies,
        executions,
        mode,
      });
      if (baselineDecision.status === "Skipped") {
        results.push({ requestId: request.id, status: "Skipped", notes: baselineDecision.notes });
        continue;
      }
      const actionKey = policy!.title as ActuationActionKey;
      const latestDryRun = executions
        .filter((execution) => request.latestExecutionIds.includes(execution.id))
        .find((execution) => execution.mode === "Dry Run");
      let target;
      let payload;
      let preflight: GitHubActionPreflight | undefined;
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
      } catch (error) {
        results.push({ requestId: request.id, status: "Skipped", notes: toErrorMessage(error) });
        continue;
      }

      const validationNotes = evaluateActionRequestReadiness({
        request,
        policies,
        target,
        config,
        latestDryRun,
        actionKey,
        preflight,
        today: new Date().toISOString().slice(0, 10),
      });
      const modeLabel = mode === "live" ? "Live" : "Dry Run";
      const idempotencyKey = computeActuationExecutionKey({
        requestId: request.id,
        actionKey,
        targetSourceId: target.source.id,
        mode: modeLabel,
        payload,
      });
      const decision = evaluateActionRunnerDecision({
        request,
        policies,
        executions,
        mode,
        actionKey,
        idempotencyKey,
        validationNotes,
      });
      if (decision.status === "Skipped") {
        results.push({ requestId: request.id, status: "Skipped", notes: decision.notes });
        continue;
      }

      const now = new Date().toISOString();
      const executionTitle = `${modeLabel} run - ${request.title} - ${now.slice(0, 19)}`;
      const draftExecution = await api.createPageWithMarkdown({
        parent: { data_source_id: phase7.executions.dataSourceId },
        properties: {
          [executionSchema.titlePropertyName]: titleValue(executionTitle),
        },
        markdown: `# ${executionTitle}\n\n- Status: Started\n- Request: [${request.title}](${request.url})`,
      });
      await api.updatePageProperties({
        pageId: draftExecution.id,
        properties: {
          "Action Request": relationValue([request.id]),
          "Local Project": relationValue(request.localProjectIds),
          Policy: relationValue(request.policyIds),
          "Target Source": relationValue([target.source.id]),
          Provider: { select: { name: "GitHub" } },
          "Action Key": richTextValue(actionKey),
          Mode: { select: { name: modeLabel } },
          Status: { select: { name: "Started" } },
          "Idempotency Key": richTextValue(idempotencyKey),
          "Executed At": { date: { start: now } },
          "Issue Number": { number: request.targetNumber || null },
          "Comment ID": richTextValue(""),
          "Label Delta Summary": richTextValue(summarizeGitHubLabelDelta({ payload, preflight })),
          "Assignee Delta Summary": richTextValue(summarizeGitHubAssigneeDelta({ payload, preflight })),
          "Response Classification": { select: { name: "Success" } },
          "Reconcile Status": { select: { name: mode === "live" ? "Pending" : "Not Needed" } },
          "Compensation Plan": richTextValue(
            buildGitHubCompensationPlan(actionKey),
          ),
        },
      });

      try {
        const postDryRun =
          mode === "dry-run"
            ? computePostDryRunReadiness({
                request,
                policies,
                target,
                config,
                actionKey,
                executedAt: now,
                preflightNotes: validationNotes,
                preflight,
              })
            : undefined;
        const providerResult: GitHubExecutionResult =
          mode === "live"
            ? await executeGitHubAction({ payload, preflight })
            : {
                executionStatus: "Succeeded",
                providerResultKey: "",
                providerUrl: "",
                issueNumber: request.targetNumber,
                commentId: "",
                labelDeltaSummary: summarizeGitHubLabelDelta({ payload, preflight }),
                assigneeDeltaSummary: summarizeGitHubAssigneeDelta({ payload, preflight }),
                responseClassification: validationNotes.length > 0 ? "Validation Failure" : "Success",
                reconcileStatus: "Not Needed",
                responseSummary:
                  validationNotes.length > 0
                    ? "Dry run found validation blockers."
                    : describeGitHubActionPreflight({ actionKey, preflight }).length > 0
                      ? `Dry run succeeded. ${describeGitHubActionPreflight({ actionKey, preflight }).join(" ")}`
                      : "Dry run succeeded.",
              };
        const finalStatus =
          mode === "live"
            ? providerResult.executionStatus
            : validationNotes.length > 0
              ? "Failed"
              : "Succeeded";
        await api.updatePageProperties({
          pageId: draftExecution.id,
          properties: {
            Status: { select: { name: finalStatus } },
            "Provider Result Key": richTextValue(providerResult.providerResultKey),
            "Provider URL": { url: providerResult.providerUrl || null },
            "Issue Number": { number: providerResult.issueNumber || null },
            "Comment ID": richTextValue(providerResult.commentId),
            "Label Delta Summary": richTextValue(providerResult.labelDeltaSummary),
            "Assignee Delta Summary": richTextValue(providerResult.assigneeDeltaSummary),
            "Response Classification": { select: { name: providerResult.responseClassification } },
            "Reconcile Status": { select: { name: providerResult.reconcileStatus } },
            "Response Summary": richTextValue(providerResult.responseSummary),
            "Failure Notes": richTextValue(validationNotes.join(" ")),
          },
        });
        if (mode === "live") {
          await api.updatePageProperties({
            pageId: request.id,
            properties: {
              Status: { select: { name: "Executed" } },
              "Latest Execution": relationValue([draftExecution.id]),
              "Latest Execution Status": { select: { name: "Executed" } },
              "Execution Intent": { select: { name: "Dry Run" } },
              "Execution Notes": richTextValue(providerResult.responseSummary),
              "Provider Request Key": richTextValue(providerResult.providerResultKey),
            },
          });
        } else {
          await api.updatePageProperties({
            pageId: request.id,
            properties: {
              "Latest Execution": relationValue([draftExecution.id]),
              "Latest Execution Status": { select: { name: postDryRun!.latestExecutionStatus } },
              "Execution Intent": { select: { name: postDryRun!.executionIntent } },
              "Execution Notes": richTextValue(postDryRun!.notes.join(" ")),
            },
          });
        }

        await updateActuationPacket({
          api,
          request:
            mode === "live"
              ? {
                  ...request,
                  executionIntent: "Dry Run",
                  latestExecutionStatus: "Executed",
                  executionNotes: providerResult.responseSummary,
                }
              : {
                  ...request,
                  executionIntent: postDryRun!.executionIntent,
                  latestExecutionStatus: postDryRun!.latestExecutionStatus,
                  executionNotes: postDryRun!.notes.join(" "),
                },
          payload,
          preflight,
          target,
          latestExecution: {
            id: draftExecution.id,
            url: draftExecution.url,
            title: executionTitle,
            actionRequestIds: [request.id],
            localProjectIds: request.localProjectIds,
            policyIds: request.policyIds,
            targetSourceIds: [target.source.id],
            provider: "GitHub",
            actionKey,
            mode: modeLabel,
            status: finalStatus,
            idempotencyKey,
            executedAt: now.slice(0, 10),
            providerResultKey: providerResult.providerResultKey,
            providerUrl: providerResult.providerUrl,
            issueNumber: providerResult.issueNumber,
            commentId: providerResult.commentId,
            labelDeltaSummary: providerResult.labelDeltaSummary,
            assigneeDeltaSummary: providerResult.assigneeDeltaSummary,
            responseClassification: providerResult.responseClassification,
            reconcileStatus: providerResult.reconcileStatus,
            responseSummary: providerResult.responseSummary,
            failureNotes: validationNotes.join(" "),
            compensationPlan: buildGitHubCompensationPlan(actionKey),
          },
          idempotencyKey,
          validationNotes: mode === "live" ? [] : postDryRun!.notes,
        });
        results.push({ requestId: request.id, executionId: draftExecution.id, status: finalStatus });
      } catch (error) {
        const { failureNotes, failureClassification } = classifyActionRunnerFailure(error);
        await api.updatePageProperties({
          pageId: draftExecution.id,
          properties: {
            Status: { select: { name: "Failed" } },
            "Response Classification": { select: { name: failureClassification } },
            "Failure Notes": richTextValue(failureNotes),
          },
        });
        await api.updatePageProperties({
          pageId: request.id,
          properties: {
            "Latest Execution": relationValue([draftExecution.id]),
            "Latest Execution Status": { select: { name: "Problem" } },
            "Execution Intent": { select: { name: "Dry Run" } },
            "Execution Notes": richTextValue(
              `Latest ${mode === "live" ? "live" : "dry run"} execution failed: ${failureNotes}`,
            ),
          },
        });
        await updateActuationPacket({
          api,
          request: {
            ...request,
            executionIntent: "Dry Run",
            latestExecutionStatus: "Problem",
            executionNotes: `Latest ${mode === "live" ? "live" : "dry run"} execution failed: ${failureNotes}`,
          },
          payload,
          preflight,
          target,
          latestExecution: {
            id: draftExecution.id,
            url: draftExecution.url,
            title: executionTitle,
            actionRequestIds: [request.id],
            localProjectIds: request.localProjectIds,
            policyIds: request.policyIds,
            targetSourceIds: [target.source.id],
            provider: "GitHub",
            actionKey,
            mode: modeLabel,
            status: "Failed",
            idempotencyKey,
            executedAt: now.slice(0, 10),
            providerResultKey: "",
            providerUrl: "",
            issueNumber: request.targetNumber,
            commentId: "",
            labelDeltaSummary: summarizeGitHubLabelDelta({ payload, preflight }),
            assigneeDeltaSummary: summarizeGitHubAssigneeDelta({ payload, preflight }),
            responseClassification: failureClassification,
            reconcileStatus: "Mismatch" as GitHubReconcileStatus,
            responseSummary: "",
            failureNotes,
            compensationPlan: buildGitHubCompensationPlan(actionKey),
          },
          idempotencyKey,
          validationNotes: [failureNotes],
        });
        results.push({ requestId: request.id, executionId: draftExecution.id, status: "Failed", notes: failureNotes });
      }

      if (mode === "live") {
        await delay(phase7.runnerLimits.minSecondsBetweenWrites * 1000);
      }
    }

  const output = { ok: true, mode, results };
  recordCommandOutputSummary(
    {
      ...output,
      ...summarizeActionRunnerResults(results),
    },
    {
      mode,
      status: deriveActionRunnerSummaryStatus(results),
      warningCategories: deriveActionRunnerWarningCategories(results),
      failureCategories: deriveActionRunnerFailureCategories(results),
      metadata: {
        resultCount: results.length,
      },
    },
  );
  console.log(JSON.stringify(output, null, 2));
}

async function updateActuationPacket(input: {
  api: DirectNotionClient;
  request: ReturnType<typeof toActionRequestRecord>;
  payload: ReturnType<typeof buildGitHubExecutionPayload>;
  preflight?: GitHubActionPreflight;
  target: ReturnType<typeof resolveActuationTarget>;
  latestExecution: ExternalActionExecutionRecord;
  idempotencyKey: string;
  validationNotes: string[];
}): Promise<void> {
  const markdown = await input.api.readPageMarkdown(input.request.id);
  const section = renderActuationPacketSection({
    request: {
      ...input.request,
      executionIntent:
        input.latestExecution.mode === "Dry Run" && input.latestExecution.status === "Succeeded"
          ? "Ready for Live"
          : input.request.executionIntent,
    },
    payload: input.payload,
    preflight: input.preflight,
    target: input.target,
    latestExecution: input.latestExecution,
    validationNotes: input.validationNotes,
    idempotencyKey: input.idempotencyKey,
  });
  const updated = mergeManagedSection(markdown.markdown, section, ACTUATION_PACKET_START, ACTUATION_PACKET_END);
  if (updated !== markdown.markdown) {
    await input.api.patchPageMarkdown({
      pageId: input.request.id,
      command: "replace_content",
      newMarkdown: updated,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["governance", "action-runner"]);
}

export function deriveActionRunnerSummaryStatus(results: ActionRunnerResult[]): "completed" | "partial" | "failed" {
  const hasFailures = results.some((result) => result.status === "Failed");
  const hasNonFailure = results.some((result) => result.status !== "Failed");
  if (hasFailures && hasNonFailure) {
    return "partial";
  }
  return hasFailures ? "failed" : "completed";
}

export function deriveActionRunnerWarningCategories(
  results: ActionRunnerResult[],
): Array<"partial_success" | "validation_gap"> | undefined {
  const categories = new Set<"partial_success" | "validation_gap">();
  const hasFailures = results.some((result) => result.status === "Failed");
  const hasNonFailure = results.some((result) => result.status !== "Failed");
  if (hasFailures && hasNonFailure) {
    categories.add("partial_success");
  }
  if (results.some((result) => result.status === "Skipped" && /validation|policy|approval/i.test(result.notes ?? ""))) {
    categories.add("validation_gap");
  }
  return categories.size > 0 ? [...categories] : undefined;
}

export function deriveActionRunnerFailureCategories(
  results: ActionRunnerResult[],
): Array<"provider_error"> | undefined {
  return results.some((result) => result.status === "Failed") ? ["provider_error"] : undefined;
}
