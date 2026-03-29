import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  deriveOperatingQueue,
  loadLocalPortfolioControlTowerConfig,
  type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  toControlTowerProjectRecord,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { loadLocalPortfolioActuationTargetConfig, type LocalPortfolioActuationTargetConfig } from "./local-portfolio-actuation.js";
import {
  loadLocalPortfolioExternalSignalSourceConfig,
  type ExternalSignalSourceRecord,
  type LocalPortfolioExternalSignalSourceConfig,
  type ManualExternalSignalSeedPlan,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import {
  classifyOperationalRolloutProject,
  ensureGitHubCreateIssueActionRequest,
  renderDecisionMarkdown,
  runRolloutCommandSteps,
  type OperationalRolloutCandidate,
} from "./operational-rollout.js";
import { AppError } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

export const DEFAULT_COHORT_PROJECT_ORDER = ["BattleGrid", "EarthPulse", "Relay", "SynthWave"] as const;

export type CohortProjectTitle = (typeof DEFAULT_COHORT_PROJECT_ORDER)[number];

export interface CohortRolloutProjectPlan {
  title: CohortProjectTitle;
  projectId: string;
  projectUrl: string;
  currentState: string;
  desiredState: string;
  currentQueue: string;
  desiredQueue: string;
  sourceAction: "keep_active" | "upsert_active";
  sourceTitle: string;
  sourceIdentifier: string;
  sourceUrl: string;
  sourceExists: boolean;
  decisionTitle: string;
  requestTitle: string;
  providerRequestKey: string;
  nextMove: string;
  currentNextMove: string;
  rationale: string;
  classification: OperationalRolloutCandidate["classification"];
  githubLane: OperationalRolloutCandidate["githubLane"];
}

export interface CohortRolloutPlan {
  orderedTitles: CohortProjectTitle[];
  projects: CohortRolloutProjectPlan[];
  summary: {
    projectFieldUpdates: number;
    sourceUpserts: number;
    decisionUpserts: number;
    actionRequestPreviews: number;
  };
}

interface CohortFlags {
  live: boolean;
  approve: boolean;
  runDry: boolean;
  runLive: boolean;
  today: string;
  configPath: string;
  selectedTitles: CohortProjectTitle[];
}

interface LiveProjectContext {
  page: DataSourcePageRef;
  record: ControlTowerProjectRecord;
}

interface LiveSourceContext {
  page: DataSourcePageRef;
  record: ExternalSignalSourceRecord;
}

export interface CohortRolloutCommandOptions {
  live?: boolean;
  approve?: boolean;
  runDry?: boolean;
  runLive?: boolean;
  today?: string;
  projects?: string;
  config?: string;
}

export async function runCohortRolloutCommand(
  options: CohortRolloutCommandOptions = {},
): Promise<void> {
  const flags: CohortFlags = {
    live: options.live ?? false,
    approve: options.approve ?? false,
    runDry: options.runDry ?? false,
    runLive: options.runLive ?? false,
    today: options.today ?? losAngelesToday(),
    configPath: options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
    selectedTitles: parseCohortProjectSelection(options.projects),
  };

  if ((flags.runDry || flags.runLive) && !flags.live) {
    throw new AppError("--run-dry and --run-live require --live");
  }

  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for cohort rollout");
  const config = await loadLocalPortfolioControlTowerConfig(flags.configPath);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance) {
      throw new AppError("Cohort rollout requires phases 2, 5, and 6 to be configured");
    }

    const sourceConfig = await loadLocalPortfolioExternalSignalSourceConfig();
    const targetConfig = await loadLocalPortfolioActuationTargetConfig();
    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, sourceSchema, decisionSchema, actionRequestSchema, policySchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.decisions.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
    ]);

    const [projectPages, sourcePages, actionRequestPages, policyPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase6Governance.actionRequests.dataSourceId, actionRequestSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase6Governance.policies.dataSourceId, policySchema.titlePropertyName),
    ]);

    const projectContexts = projectPages.map((page) => ({ page, record: toControlTowerProjectRecord(page) }));
    const sourceContexts = sourcePages.map((page) => ({ page, record: toExternalSignalSourceRecord(page) }));
    const plan = buildCohortRolloutPlan({
      selectedTitles: flags.selectedTitles,
      projects: projectContexts.map((entry) => entry.record),
      githubSources: sourceContexts.map((entry) => entry.record),
      sourceConfig,
      targetConfig,
      today: flags.today,
    });

    if (!flags.live) {
      const output = {
        ok: true,
        live: false,
        today: flags.today,
        selectedProjects: plan.orderedTitles,
        summary: plan.summary,
        projects: plan.projects,
      };
      recordCommandOutputSummary(output, {
        mode: "dry-run",
        metadata: {
          selectedProjects: plan.orderedTitles.length,
        },
      });
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const policies = policyPages.map((page) => toActionPolicyRecord(page));
    const actionRequests = actionRequestPages.map((page) => toActionRequestRecord(page));
    const projectContextByTitle = new Map(projectContexts.map((entry) => [entry.record.title, entry]));
    const sourceContextByProjectId = new Map(
      sourceContexts
        .filter((entry) => entry.record.provider === "GitHub" && entry.record.sourceType === "Repo")
        .flatMap((entry) => entry.record.localProjectIds.map((projectId) => [projectId, entry] as const)),
    );

    const autoApprove = flags.approve || flags.live;
    const writes: Array<{
      title: CohortProjectTitle;
      projectPageId: string;
      sourcePageId: string;
      sourceExisted: boolean;
      decisionId: string;
      requestId: string;
      requestStatus: string;
    }> = [];

    for (const projectPlan of plan.projects) {
      const projectContext = projectContextByTitle.get(projectPlan.title);
      if (!projectContext) {
        throw new AppError(`Could not find project page for "${projectPlan.title}"`);
      }

      const sourceContext = sourceContextByProjectId.get(projectPlan.projectId);
      const ensuredSource = await ensureActiveGitHubSource({
        api,
        dataSourceId: config.phase5ExternalSignals.sources.dataSourceId,
        titlePropertyName: sourceSchema.titlePropertyName,
        projectId: projectPlan.projectId,
        projectTitle: projectPlan.title,
        existingSource: sourceContext,
        sourceConfig,
        targetConfig,
      });

      await api.updatePageProperties({
        pageId: projectPlan.projectId,
        properties: {
          "Current State": selectPropertyValue(projectPlan.desiredState),
          "Portfolio Call": selectPropertyValue("Finish"),
          "Needs Review": { checkbox: false },
          "Date Updated": { date: { start: flags.today } },
          "Next Move": richTextValue(projectPlan.nextMove),
        },
      });

      const decision = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.decisions.dataSourceId,
        titlePropertyName: decisionSchema.titlePropertyName,
        title: projectPlan.decisionTitle,
        properties: {
          [decisionSchema.titlePropertyName]: titleValue(projectPlan.decisionTitle),
          Status: { select: { name: "Committed" } },
          "Decision Type": { select: { name: "Portfolio" } },
          "Decision Owner": peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Proposed On": { date: { start: flags.today } },
          "Decided On": { date: { start: flags.today } },
          "Revisit By": { date: { start: addDays(flags.today, 14) } },
          "Local Project": relationValue([projectPlan.projectId]),
          "Chosen Option": richTextValue(projectPlan.classification),
          Rationale: richTextValue(projectPlan.rationale),
          "Expected Impact": richTextValue(projectPlan.nextMove),
        },
        markdown: renderDecisionMarkdown(toDecisionCandidate(projectPlan)),
      });

      const request = await ensureGitHubCreateIssueActionRequest({
        api,
        config,
        actionRequestTitlePropertyName: actionRequestSchema.titlePropertyName,
        policies,
        actionRequests,
        githubSources: [
          ...sourceContexts
            .filter((entry) => entry.record.id !== ensuredSource.id)
            .map((entry) => entry.record),
          {
            id: ensuredSource.id,
            url: ensuredSource.url,
            title: projectPlan.sourceTitle,
            localProjectIds: [projectPlan.projectId],
            provider: "GitHub",
            sourceType: "Repo",
            identifier: projectPlan.sourceIdentifier,
            sourceUrl: projectPlan.sourceUrl,
            status: "Active",
            environment: "N/A",
            syncStrategy: "Poll",
            lastSyncedAt: "",
          },
        ],
        requestTitle: projectPlan.requestTitle,
        projectId: projectPlan.projectId,
        projectTitle: projectPlan.title,
        projectNextMove: projectPlan.currentNextMove,
        sourceId: ensuredSource.id,
        today: flags.today,
        approve: autoApprove,
        payloadTitle: `${projectPlan.title}: cohort rollout`,
        payloadBody: buildCohortIssueBody(projectPlan),
        providerRequestKey: projectPlan.providerRequestKey,
        approvalReasonApproved: "Approved cohort rollout request so this project can move into the governed GitHub issue lane.",
        approvalReasonPending: "Pending operator approval for the cohort rollout GitHub issue request.",
        executionNotes:
          "Created by the cohort rollout workflow to move this project from Notion review into a governed GitHub issue.",
        markdownPurpose: "Create the governed GitHub issue for this cohort rollout project and use GitHub as the active delivery surface.",
      });

      writes.push({
        title: projectPlan.title,
        projectPageId: projectPlan.projectId,
        sourcePageId: ensuredSource.id,
        sourceExisted: ensuredSource.existed,
        decisionId: decision.id,
        requestId: request.id,
        requestStatus: request.status,
      });
    }

    const execution = {
      dryRuns: [] as Array<{ title: CohortProjectTitle; result: unknown }>,
      liveRuns: [] as Array<{ title: CohortProjectTitle; result: unknown }>,
      followUps: {} as Record<string, unknown>,
      failures: [] as Array<{ step: string; title?: CohortProjectTitle; error: string }>,
    };

    if (flags.runDry || flags.runLive) {
      const dryRunSteps = await runRolloutCommandSteps(
        writes.map((write) => ({
          key: `dryRun:${write.title}`,
          script: "portfolio-audit:action-dry-run",
          args: ["--request", write.requestId],
          title: write.title,
        })),
      );
      for (const write of writes) {
        const result = dryRunSteps.results[`dryRun:${write.title}`];
        if (result !== undefined) {
          execution.dryRuns.push({
            title: write.title,
            result,
          });
        }
      }
      execution.failures.push(
        ...dryRunSteps.failures.map((failure) => ({
          step: failure.key,
          title: failure.title as CohortProjectTitle | undefined,
          error: failure.error,
        })),
      );
      const requestSyncStep = await runRolloutCommandSteps([
        { key: "actionRequestSync", script: "portfolio-audit:action-request-sync", args: ["--live"] },
      ]);
      Object.assign(execution.followUps, requestSyncStep.results);
      execution.failures.push(
        ...requestSyncStep.failures.map((failure) => ({
          step: failure.key,
          title: failure.title as CohortProjectTitle | undefined,
          error: failure.error,
        })),
      );
    }

    if (flags.runLive) {
      const liveRunSteps = await runRolloutCommandSteps(
        writes.map((write) => ({
          key: `liveRun:${write.title}`,
          script: "portfolio-audit:action-runner",
          args: ["--mode", "live", "--request", write.requestId],
          title: write.title,
        })),
      );
      for (const write of writes) {
        const result = liveRunSteps.results[`liveRun:${write.title}`];
        if (result !== undefined) {
          execution.liveRuns.push({
            title: write.title,
            result,
          });
        }
      }
      execution.failures.push(
        ...liveRunSteps.failures.map((failure) => ({
          step: failure.key,
          title: failure.title as CohortProjectTitle | undefined,
          error: failure.error,
        })),
      );
      const liveFollowUpSteps = await runRolloutCommandSteps([
        { key: "actionRequestSyncAfterLive", script: "portfolio-audit:action-request-sync", args: ["--live"] },
        {
          key: "githubSignalSync",
          script: "portfolio-audit:external-signal-sync",
          args: ["--provider", "github", "--live"],
        },
        { key: "webhookShadowDrain", script: "portfolio-audit:webhook-shadow-drain", args: [] },
        { key: "webhookReconcile", script: "portfolio-audit:webhook-reconcile", args: ["--provider", "github"] },
      ]);
      Object.assign(execution.followUps, liveFollowUpSteps.results);
      execution.failures.push(
        ...liveFollowUpSteps.failures.map((failure) => ({
          step: failure.key,
          title: failure.title as CohortProjectTitle | undefined,
          error: failure.error,
        })),
      );
    }

    const finalFollowUpSteps = await runRolloutCommandSteps([
      { key: "controlTowerSync", script: "portfolio-audit:control-tower-sync", args: ["--live"] },
      { key: "reviewPacket", script: "portfolio-audit:review-packet", args: ["--live"] },
    ]);
    Object.assign(execution.followUps, finalFollowUpSteps.results);
    execution.failures.push(
      ...finalFollowUpSteps.failures.map((failure) => ({
        step: failure.key,
        title: failure.title as CohortProjectTitle | undefined,
        error: failure.error,
      })),
    );

    const output = {
      ok: true,
      live: true,
      today: flags.today,
      selectedProjects: plan.orderedTitles,
      summary: plan.summary,
      writes,
      execution,
    };
    recordCommandOutputSummary(
      {
        ...output,
        recordsUpdated: Array.isArray(writes) ? writes.length : undefined,
        failureCount: execution.failures.length,
      },
      {
        mode: "live",
        metadata: {
          selectedProjects: plan.orderedTitles.length,
        },
      },
    );
    console.log(JSON.stringify(output, null, 2));
}

export function parseCohortProjectSelection(raw?: string): CohortProjectTitle[] {
  if (!raw?.trim()) {
    return [...DEFAULT_COHORT_PROJECT_ORDER];
  }

  const requested = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalid = requested.filter(
    (entry): entry is string => !DEFAULT_COHORT_PROJECT_ORDER.includes(entry as CohortProjectTitle),
  );
  if (invalid.length > 0) {
    throw new AppError(`Unsupported cohort projects: ${invalid.join(", ")}`);
  }

  const selected = new Set(requested as CohortProjectTitle[]);
  return DEFAULT_COHORT_PROJECT_ORDER.filter((title) => selected.has(title));
}

export function buildCohortIssueNextMove(existingNextMove: string): string {
  const focus = existingNextMove.trim() || "Define the first delivery slice and capture it in GitHub.";
  return `Move to GitHub next: create and work from the governed GitHub issue. Delivery focus: ${focus}`;
}

export function buildCohortRolloutPlan(input: {
  selectedTitles: CohortProjectTitle[];
  projects: ControlTowerProjectRecord[];
  githubSources: ExternalSignalSourceRecord[];
  sourceConfig: LocalPortfolioExternalSignalSourceConfig;
  targetConfig: LocalPortfolioActuationTargetConfig;
  today: string;
}): CohortRolloutPlan {
  const projectByTitle = new Map(input.projects.map((project) => [project.title, project]));
  const projects = input.selectedTitles.map((title) => {
    const project = projectByTitle.get(title);
    if (!project) {
      throw new AppError(`Could not find cohort project "${title}"`);
    }

    const target = input.targetConfig.targets.find((entry) => entry.title === title || entry.localProjectId === project.id);
    if (!target?.sourceIdentifier || !target.sourceUrl) {
      throw new AppError(`Missing GitHub actuation target for "${title}"`);
    }

    const existingSource = input.githubSources.find(
      (source) =>
        source.provider === "GitHub" &&
        source.sourceType === "Repo" &&
        source.localProjectIds.includes(project.id) &&
        (source.identifier === target.sourceIdentifier || source.sourceUrl === target.sourceUrl),
    );
    const manualSeed =
      input.sourceConfig.manualSeeds.find(
        (seed) =>
          seed.localProjectId === project.id &&
          seed.provider === "GitHub" &&
          seed.sourceType === "Repo",
      ) ?? buildFallbackGitHubSeed(project.id, title, target.sourceIdentifier, target.sourceUrl);

    const alignedProject = applyCohortProjectAlignment(project, input.today);
    const projectedSource = existingSource
      ? existingSource
      : {
          id: `planned-${project.id}`,
          url: "",
          title: manualSeed.title,
          localProjectIds: [project.id],
          provider: "GitHub" as const,
          sourceType: "Repo" as const,
          identifier: manualSeed.identifier ?? target.sourceIdentifier,
          sourceUrl: manualSeed.sourceUrl ?? target.sourceUrl,
          status: "Active" as const,
          environment: "N/A" as const,
          syncStrategy: "Poll" as const,
          lastSyncedAt: "",
        };
    const classificationSources = [
      ...input.githubSources.filter((source) => !source.localProjectIds.includes(project.id)),
      projectedSource,
    ];
    const candidate = classifyOperationalRolloutProject({
      project: alignedProject,
      githubSources: classificationSources,
      targetConfig: input.targetConfig,
    });
    if (!candidate.decisionTitle) {
      throw new AppError(`Cohort project "${title}" did not produce a GitHub rollout decision`);
    }

    const sourceAction: CohortRolloutProjectPlan["sourceAction"] =
      existingSource?.status === "Active" ? "keep_active" : "upsert_active";

    return {
      title,
      projectId: project.id,
      projectUrl: project.url,
      currentState: project.currentState,
      desiredState: alignedProject.currentState,
      currentQueue: project.operatingQueue ?? "",
      desiredQueue: alignedProject.operatingQueue ?? "",
      sourceAction,
      sourceTitle: manualSeed.title,
      sourceIdentifier: manualSeed.identifier ?? target.sourceIdentifier,
      sourceUrl: manualSeed.sourceUrl ?? target.sourceUrl,
      sourceExists: Boolean(existingSource),
      decisionTitle: candidate.decisionTitle,
      requestTitle: `Cohort rollout - ${title} - GitHub issue`,
      providerRequestKey: `cohort-rollout:${project.id}:github.create_issue`,
      nextMove: alignedProject.nextMove,
      currentNextMove: project.nextMove,
      rationale: candidate.rationale,
      classification: candidate.classification,
      githubLane: candidate.githubLane,
    };
  });

  return {
    orderedTitles: [...input.selectedTitles],
    projects,
    summary: {
      projectFieldUpdates: projects.length,
      sourceUpserts: projects.filter((project) => project.sourceAction === "upsert_active").length,
      decisionUpserts: projects.length,
      actionRequestPreviews: projects.length,
    },
  };
}

function applyCohortProjectAlignment(project: ControlTowerProjectRecord, today: string): ControlTowerProjectRecord {
  const currentState = "Active Build";
  const portfolioCall = "Finish";
  const needsReview = false;
  const nextMove = buildCohortIssueNextMove(project.nextMove);

  return {
    ...project,
    currentState,
    portfolioCall,
    needsReview,
    dateUpdated: today,
    nextMove,
    operatingQueue: deriveOperatingQueue({
      currentState,
      needsReview,
      portfolioCall,
      runsLocally: project.runsLocally,
      setupFriction: project.setupFriction,
      momentum: project.momentum,
    }),
  };
}

function buildFallbackGitHubSeed(
  projectId: string,
  projectTitle: CohortProjectTitle,
  sourceIdentifier: string,
  sourceUrl: string,
): ManualExternalSignalSeedPlan {
  return {
    title: `${projectTitle} GitHub Repo`,
    localProjectId: projectId,
    provider: "GitHub",
    sourceType: "Repo",
    status: "Active",
    environment: "N/A",
    syncStrategy: "Poll",
    identifier: sourceIdentifier,
    sourceUrl,
  };
}

async function ensureActiveGitHubSource(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectId: string;
  projectTitle: CohortProjectTitle;
  existingSource?: LiveSourceContext;
  sourceConfig: LocalPortfolioExternalSignalSourceConfig;
  targetConfig: LocalPortfolioActuationTargetConfig;
}): Promise<{ id: string; url: string; existed: boolean }> {
  const target = input.targetConfig.targets.find(
    (entry) => entry.title === input.projectTitle || entry.localProjectId === input.projectId,
  );
  if (!target?.sourceIdentifier || !target.sourceUrl) {
    throw new AppError(`Missing GitHub actuation target for "${input.projectTitle}"`);
  }

  const manualSeed =
    input.sourceConfig.manualSeeds.find(
      (seed) =>
        seed.localProjectId === input.projectId &&
        seed.provider === "GitHub" &&
        seed.sourceType === "Repo",
    ) ?? buildFallbackGitHubSeed(input.projectId, input.projectTitle, target.sourceIdentifier, target.sourceUrl);

  const title = manualSeed.title;
  const properties = {
    [input.titlePropertyName]: titleValue(title),
    "Local Project": relationValue([input.projectId]),
    Provider: selectPropertyValue("GitHub"),
    "Source Type": selectPropertyValue("Repo"),
    Status: selectPropertyValue("Active"),
    Environment: selectPropertyValue("N/A"),
    "Sync Strategy": selectPropertyValue("Poll"),
    Identifier: richTextValue(manualSeed.identifier ?? target.sourceIdentifier),
    "Source URL": { url: manualSeed.sourceUrl ?? target.sourceUrl },
  };

  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title,
    properties,
    markdown: [
      `# ${title}`,
      "",
      "- Provider: GitHub",
      "- Source type: Repo",
      "- Status: Active",
      `- Identifier: ${manualSeed.identifier ?? target.sourceIdentifier}`,
      `- Source URL: ${manualSeed.sourceUrl ?? target.sourceUrl}`,
      "",
      "This row is maintained by the cohort rollout workflow so the governed GitHub issue lane has an active repo mapping.",
    ].join("\n"),
  });
}

function toDecisionCandidate(projectPlan: CohortRolloutProjectPlan): OperationalRolloutCandidate {
  return {
    projectId: projectPlan.projectId,
    projectTitle: projectPlan.title,
    queue: projectPlan.desiredQueue as OperationalRolloutCandidate["queue"],
    classification: projectPlan.classification,
    rationale: projectPlan.rationale,
    githubLane: projectPlan.githubLane,
    waveAssignment: "none",
    decisionTitle: projectPlan.decisionTitle,
    githubIdentifier: projectPlan.sourceIdentifier,
    githubUrl: projectPlan.sourceUrl,
    existingNextMove: projectPlan.currentNextMove,
    recommendedNextMove: projectPlan.nextMove,
  };
}

function buildCohortIssueBody(projectPlan: CohortRolloutProjectPlan): string {
  return [
    `This issue was created through the Notion cohort rollout for **${projectPlan.title}**.`,
    "",
    "## Why this exists",
    "- Move this project out of Notion review mode and into the governed GitHub delivery lane.",
    "- Keep the current next slice tracked in the repo where execution will happen.",
    "",
    "## Current focus",
    projectPlan.currentNextMove || "Define the next delivery slice.",
    "",
    "## Done when",
    "- The GitHub issue exists and is linked in the Notion actuation trail.",
    "- GitHub becomes the active delivery surface for the next project slice.",
  ].join("\n");
}

function peopleValue(id?: string): { people: Array<{ id: string }> } {
  return id ? { people: [{ id }] } : { people: [] };
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["rollout", "cohort"]);
}
