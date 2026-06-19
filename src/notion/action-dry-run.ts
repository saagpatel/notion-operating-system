import { createNotionSdkClient } from "./notion-sdk.js";

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
  buildVercelPromoteExecutionPayload,
  buildVercelRedeployExecutionPayload,
  buildVercelRollbackExecutionPayload,
  describeGitHubActionPreflight,
  describeVercelPromotePreflight,
  describeVercelRollbackPreflight,
  computePostDryRunReadiness,
  computeActuationExecutionKey,
  evaluateActionRequestReadiness,
  fetchVercelRedeployPreflight,
  fetchVercelPromotePreflight,
  fetchVercelRollbackPreflight,
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
  type VercelPromotePreflight,
  type VercelRollbackPreflight,
  SUPPORTED_ACTION_KEYS,
} from "./local-portfolio-actuation.js";
import { toExternalActionExecutionRecord } from "./local-portfolio-actuation-live.js";
import { AppError } from "../utils/errors.js";
import { UNTRUSTED_CONTENT_NOTICE, untrustedMarkdownEvidence } from "./untrusted-content.js";

const ACTUATION_PACKET_START = "<!-- codex:notion-actuation-packet:start -->";
const ACTUATION_PACKET_END = "<!-- codex:notion-actuation-packet:end -->";

export interface ActionDryRunPreparation {
  target: ReturnType<typeof resolveActuationTarget> | null;
  payload:
    | ReturnType<typeof buildGitHubExecutionPayload>
    | ReturnType<typeof buildVercelRedeployExecutionPayload>
    | ReturnType<typeof buildVercelPromoteExecutionPayload>
    | ReturnType<typeof buildVercelRollbackExecutionPayload>
    | null;
  preflight?: GitHubActionPreflight | VercelRedeployPreflight | VercelPromotePreflight | VercelRollbackPreflight;
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
    fetchVercelPromotePreflight?: typeof fetchVercelPromotePreflight;
    fetchVercelRollbackPreflight?: typeof fetchVercelRollbackPreflight;
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
    if (input.actionKey === "vercel.rollback") {
      const preflight = await (dependencies.fetchVercelRollbackPreflight ?? fetchVercelRollbackPreflight)({ target });
      const payload = buildVercelRollbackExecutionPayload({
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
    if (input.actionKey === "vercel.promote") {
      const preflight = await (dependencies.fetchVercelPromotePreflight ?? fetchVercelPromotePreflight)({ target });
      const payload = buildVercelPromoteExecutionPayload({
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
    readyForLive: postDryRun.executionIntent === "Ready for Live",
  };
}

export function buildActionDryRunOperatorSummary(input: {
  request: ActionRequestRecord;
  actionKey: ActuationActionKey;
  preparation: ActionDryRunPreparation;
  validationNotes: string[];
  readyForLive: boolean;
}): {
  status: "ready_for_live" | "needs_operator_action" | "blocked";
  target: string;
  nextStep: string;
  safetyNotes: string[];
} {
  const target = input.preparation.target
    ? `${input.preparation.target.source.provider}: ${input.preparation.target.source.id}`
    : "unresolved target";
  if (input.validationNotes.length > 0) {
    return {
      status: input.preparation.preparationError ? "blocked" : "needs_operator_action",
      target,
      nextStep: input.preparation.preparationError
        ? "Fix the target/preflight blocker, then rerun the dry-run."
        : "Resolve the validation notes before approving live execution.",
      safetyNotes: input.validationNotes,
    };
  }
  if (!input.readyForLive) {
    return {
      status: "needs_operator_action",
      target,
      nextStep: "Dry-run passed, but live approval requirements are not satisfied yet.",
      safetyNotes: [
        "Keep the request in dry-run state until approval, freshness, and policy requirements are all satisfied.",
      ],
    };
  }
  return {
    status: "ready_for_live",
    target,
    nextStep: `Request is ready for governed live execution with action ${input.actionKey}.`,
    safetyNotes: [
      "Execute through governance action-runner only; do not mutate the provider manually.",
    ],
  };
}

export function buildActionDryRunExecutionMarkdown(input: {
  request: ActionRequestRecord;
  policy: ActionPolicyRecord;
  actionKey: ActuationActionKey;
  preparation: ActionDryRunPreparation;
  operatorSummary: ReturnType<typeof buildActionDryRunOperatorSummary>;
  validationNotes: string[];
  preflightNotes: string[];
  payload: ActionDryRunPreparation["payload"];
  executionTitle: string;
  executedAt: string;
}): string {
  const target = input.preparation.target;
  const evidenceLines = [
    ...untrustedMarkdownEvidence("Action request title", input.request.title),
    ...(target
      ? [
          ...untrustedMarkdownEvidence("Target source title", target.source.title),
          ...untrustedMarkdownEvidence("Target source identifier", target.source.identifier),
        ]
      : []),
    ...(input.payload?.provider === "GitHub"
      ? [
          ...untrustedMarkdownEvidence("Payload title", input.payload.title, "(comment only)"),
          ...untrustedMarkdownEvidence("Payload body preview", input.payload.body, "(empty)"),
        ]
      : []),
  ];

  return [
    `# ${input.executionTitle}`,
    "",
    `- Action request: [request page](${input.request.url})`,
    `- Policy: ${input.policy.title}`,
    `- Mode: Dry Run`,
    `- Status: ${input.validationNotes.length > 0 ? "Failed" : "Succeeded"}`,
    `- Executed at: ${input.executedAt}`,
    "",
    "## Operator Summary",
    `- Status: ${input.operatorSummary.status}`,
    `- Target: ${input.operatorSummary.target}`,
    `- Next step: ${input.operatorSummary.nextStep}`,
    ...(input.operatorSummary.safetyNotes.length > 0
      ? input.operatorSummary.safetyNotes.map((note) => `- Safety: ${note}`)
      : []),
    "",
    "## Validation Notes",
    ...(input.validationNotes.length > 0 ? input.validationNotes.map((note) => `- ${note}`) : ["- Dry run succeeded."]),
    ...(input.preflightNotes.length > 0
      ? [
          "",
          `## ${input.payload?.provider === "Vercel" ? "Vercel" : "GitHub"} Preflight`,
          UNTRUSTED_CONTENT_NOTICE,
          ...input.preflightNotes.flatMap((note, index) => untrustedMarkdownEvidence(`Preflight note ${index + 1}`, note)),
        ]
      : []),
    "",
    "## Payload Preview",
    ...(input.payload
      ? input.payload.provider === "GitHub"
        ? [
            `- Repo: ${input.payload.owner}/${input.payload.repo}`,
            `- Title: see quoted payload title below`,
            `- Body length: ${input.payload.body?.length ?? 0}`,
          ]
        : input.payload.actionKey === "vercel.redeploy"
          ? [
              `- Project: ${input.payload.projectName}`,
              `- Environment: ${input.payload.targetEnvironment}`,
              `- Deployment basis: ${input.payload.deploymentId}`,
            ]
          : input.payload.actionKey === "vercel.promote"
            ? [
                `- Project: ${input.payload.projectName}`,
                `- Environment: ${input.payload.targetEnvironment}`,
                `- Current deployment: ${input.payload.currentDeploymentId}`,
                `- Promote target: ${input.payload.promoteDeploymentId}`,
              ]
            : [
                `- Project: ${input.payload.projectName}`,
                `- Environment: ${input.payload.targetEnvironment}`,
                `- Current deployment: ${input.payload.currentDeploymentId}`,
                `- Rollback target: ${input.payload.rollbackDeploymentId}`,
              ]
      : ["- Payload preview unavailable."]),
    "",
    "## Quoted Untrusted Evidence",
    UNTRUSTED_CONTENT_NOTICE,
    ...evidenceLines,
  ].join("\n");
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

    const sdk = createNotionSdkClient(token);
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
        : payload?.provider === "Vercel" && actionKey === "vercel.rollback"
          ? describeVercelRollbackPreflight(preflight as VercelRollbackPreflight | undefined)
          : payload?.provider === "Vercel" && actionKey === "vercel.promote"
            ? describeVercelPromotePreflight(preflight as VercelPromotePreflight | undefined)
          : [];
    const operatorSummary = buildActionDryRunOperatorSummary({
      request,
      actionKey,
      preparation,
      validationNotes,
      readyForLive: readiness.readyForLive,
    });
    const executionTitle = `Dry run - ${request.id} - ${now.slice(0, 19)}`;
    const markdown = buildActionDryRunExecutionMarkdown({
      request,
      policy,
      actionKey,
      preparation,
      operatorSummary,
      validationNotes,
      preflightNotes,
      payload,
      executionTitle,
      executedAt: now,
    });

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
        "Compensation Plan": richTextValue(
          payload?.provider === "Vercel"
            ? buildVercelCompensationPlan(payload.actionKey)
            : buildGitHubCompensationPlan(actionKey),
        ),
      },
    });

    await api.updatePageProperties({
      pageId: request.id,
      properties: {
        "Latest Execution": relationValue([created.id]),
        "Latest Execution Status": { select: { name: postDryRun.latestExecutionStatus } },
        "Execution Intent": { select: { name: postDryRun.executionIntent } },
        "Provider Request Key": richTextValue(postDryRun.providerRequestKey),
        "Execution Notes": richTextValue(postDryRun.notes.join(" ")),
      },
    });

    const requestMarkdown = await api.readPageMarkdown(request.id);
    const packet = renderActuationPacketSection({
      request: {
        ...request,
        executionIntent: postDryRun.executionIntent,
        latestExecutionStatus: postDryRun.latestExecutionStatus,
        providerRequestKey: postDryRun.providerRequestKey,
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
        compensationPlan:
          payload?.provider === "Vercel"
            ? buildVercelCompensationPlan(payload.actionKey)
            : buildGitHubCompensationPlan(actionKey),
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
      operatorSummary,
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
