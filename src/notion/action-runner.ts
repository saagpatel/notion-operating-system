import "dotenv/config";

import { Client } from "@notionhq/client";

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

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the action runner");
    }
    const flags = parseFlags(process.argv.slice(2));
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
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
        flags.request
          ? request.id === flags.request
          : request.status === "Approved" &&
            (flags.mode === "live"
              ? request.executionIntent === "Ready for Live"
              : (request.executionIntent || "Dry Run") === "Dry Run"),
      )
      .slice(0, flags.limit ?? (flags.mode === "live" ? phase7.runnerLimits.maxLivePerRun : phase7.runnerLimits.maxDryRunsPerRun));

    const results: Array<{ requestId: string; executionId?: string; status: string; notes?: string }> = [];

    for (const request of requests) {
      const policy = policies.find((entry) => request.policyIds.includes(entry.id));
      if (!policy || !SUPPORTED_GITHUB_ACTION_KEYS.includes(policy.title as (typeof SUPPORTED_GITHUB_ACTION_KEYS)[number])) {
        results.push({ requestId: request.id, status: "Skipped", notes: "Missing supported linked policy." });
        continue;
      }
      const actionKey = policy.title as ActuationActionKey;
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
      if (validationNotes.length > 0 && flags.mode === "live") {
        results.push({ requestId: request.id, status: "Skipped", notes: validationNotes.join(" ") });
        continue;
      }

      const modeLabel = flags.mode === "live" ? "Live" : "Dry Run";
      const idempotencyKey = computeActuationExecutionKey({
        requestId: request.id,
        actionKey,
        targetSourceId: target.source.id,
        mode: modeLabel,
        payload,
      });
      const duplicate =
        flags.mode === "live"
          ? executions.find(
              (execution) => execution.mode === "Live" && execution.status === "Succeeded" && execution.idempotencyKey === idempotencyKey,
            )
          : undefined;
      if (duplicate && flags.mode === "live") {
        results.push({ requestId: request.id, status: "Skipped", notes: "A successful live execution already exists." });
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
          "Reconcile Status": { select: { name: flags.mode === "live" ? "Pending" : "Not Needed" } },
          "Compensation Plan": richTextValue(
            buildGitHubCompensationPlan(actionKey),
          ),
        },
      });

      try {
        const postDryRun =
          flags.mode === "dry-run"
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
          flags.mode === "live"
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
          flags.mode === "live"
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
        if (flags.mode === "live") {
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
            flags.mode === "live"
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
          validationNotes: flags.mode === "live" ? [] : postDryRun!.notes,
        });
        results.push({ requestId: request.id, executionId: draftExecution.id, status: finalStatus });
      } catch (error) {
        const failureNotes = toErrorMessage(error);
        const failureClassification = classifyGitHubFailureMessage(failureNotes);
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
              `Latest ${flags.mode === "live" ? "live" : "dry run"} execution failed: ${failureNotes}`,
            ),
          },
        });
        await updateActuationPacket({
          api,
          request: {
            ...request,
            executionIntent: "Dry Run",
            latestExecutionStatus: "Problem",
            executionNotes: `Latest ${flags.mode === "live" ? "live" : "dry run"} execution failed: ${failureNotes}`,
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
            actionKey: policy.title,
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
            responseClassification: failureClassification as GitHubResponseClassification,
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

      if (flags.mode === "live") {
        await delay(phase7.runnerLimits.minSecondsBetweenWrites * 1000);
      }
    }

    console.log(JSON.stringify({ ok: true, mode: flags.mode, results }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
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

function parseFlags(argv: string[]): { request?: string; mode: "dry-run" | "live"; limit?: number } {
  let request: string | undefined;
  let mode: "dry-run" | "live" = "dry-run";
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--request") {
      request = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--mode") {
      const value = argv[index + 1];
      if (value === "dry-run" || value === "live") {
        mode = value;
      }
      index += 1;
      continue;
    }
    if (current === "--limit") {
      limit = Number(argv[index + 1]);
      index += 1;
    }
  }
  return { request, mode, limit };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
