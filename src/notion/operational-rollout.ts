import { spawn } from "node:child_process";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  datePropertyValue,
  fetchAllPages,
  relationValue,
  richTextValue,
  titleValue,
  toControlTowerProjectRecord,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import {
  loadLocalPortfolioActuationTargetConfig,
  type ActuationTargetRule,
  type LocalPortfolioActuationTargetConfig,
} from "./local-portfolio-actuation.js";
import type { ExternalSignalSourceRecord } from "./local-portfolio-external-signals.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import type { ActionPolicyRecord, ActionRequestRecord } from "./local-portfolio-governance.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";

export type OperationalRolloutClassification =
  | "keep Notion-only"
  | "move to GitHub next"
  | "not worth migrating yet";

export type PriorityQueue = "Resume Now" | "Worth Finishing" | "Needs Decision";

export type GitHubLaneStatus =
  | "active_allowlisted"
  | "active_known_repo"
  | "known_repo_allowlisted"
  | "known_repo"
  | "seeded_needs_mapping"
  | "seeded_not_ready"
  | "none";

export interface OperationalRolloutCandidate {
  projectId: string;
  projectTitle: string;
  queue: PriorityQueue;
  classification: OperationalRolloutClassification;
  rationale: string;
  githubLane: GitHubLaneStatus;
  waveAssignment: "wave1" | "wave2" | "none";
  decisionTitle?: string;
  githubSourceId?: string;
  githubSourceStatus?: ExternalSignalSourceRecord["status"];
  githubIdentifier?: string;
  githubUrl?: string;
  actuationTargetTitle?: string;
  existingNextMove: string;
  recommendedNextMove: string;
}

export interface OperationalRolloutPlan {
  candidates: OperationalRolloutCandidate[];
  wave1Shortlist: OperationalRolloutCandidate[];
  wave2Queue: OperationalRolloutCandidate[];
  pilotCandidate?: OperationalRolloutCandidate;
}

export interface RolloutCommandStep {
  key: string;
  script: string;
  args: string[];
  title?: string;
}

export interface RolloutCommandFailure {
  key: string;
  script: string;
  args: string[];
  title?: string;
  error: string;
}

export interface EnsureGitHubCreateIssueActionRequestInput {
  api: DirectNotionClient;
  config: RolloutContext["config"];
  actionRequestTitlePropertyName: string;
  policies: ActionPolicyRecord[];
  actionRequests: ActionRequestRecord[];
  githubSources: ExternalSignalSourceRecord[];
  requestTitle: string;
  projectId: string;
  projectTitle: string;
  projectNextMove: string;
  sourceId: string;
  today: string;
  approve: boolean;
  payloadTitle: string;
  payloadBody: string;
  providerRequestKey: string;
  approvalReasonApproved: string;
  approvalReasonPending: string;
  executionNotes: string;
  markdownPurpose: string;
}

interface RolloutContext {
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  projects: ControlTowerProjectRecord[];
  githubSources: ExternalSignalSourceRecord[];
  policies: ActionPolicyRecord[];
  actionRequests: ActionRequestRecord[];
  targetConfig: LocalPortfolioActuationTargetConfig;
  decisionTitlePropertyName: string;
  actionRequestTitlePropertyName: string;
}

const PRIORITY_QUEUE_SET = new Set<PriorityQueue>([
  "Resume Now",
  "Worth Finishing",
  "Needs Decision",
]);

const QUEUE_SCORE: Record<Exclude<ControlTowerProjectRecord["operatingQueue"], undefined>, number> = {
  Shipped: 0,
  "Needs Review": 0,
  "Needs Decision": 1,
  "Worth Finishing": 2,
  "Resume Now": 3,
  "Cold Storage": 0,
  Watch: 0,
};

export interface OperationalRolloutCommandOptions {
  live?: boolean;
  runPilotDryRun?: boolean;
  runPilotLive?: boolean;
  approvePilot?: boolean;
  today?: string;
  config?: string;
}

export async function runOperationalRolloutCommand(
  options: OperationalRolloutCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for the operational rollout command",
  );
  const flags: ParsedFlags = {
    live: options.live ?? false,
    runPilotDryRun: options.runPilotDryRun ?? false,
    runPilotLive: options.runPilotLive ?? false,
    approvePilot: options.approvePilot ?? false,
    today: options.today ?? losAngelesToday(),
    configPath: options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  };

  if (flags.runPilotLive && !flags.live) {
    throw new AppError("--run-pilot-live requires --live");
  }
  if (flags.approvePilot && !flags.live) {
    throw new AppError("--approve-pilot requires --live");
  }
  if (flags.runPilotDryRun && !flags.live) {
    throw new AppError("--run-pilot-dry-run requires --live");
  }

  const baselineResults = await runBaselineCommands(flags);
  const context = await loadRolloutContext(token, flags.configPath);
    const plan = buildOperationalRolloutPlan({
      projects: context.projects,
      githubSources: context.githubSources,
      targetConfig: context.targetConfig,
    });

    if (!flags.live) {
      const output = {
        ok: true,
        live: false,
        baseline: baselineResults,
        classifications: plan.candidates,
        wave1Shortlist: plan.wave1Shortlist.map(summarizeCandidate),
        wave2Queue: plan.wave2Queue.map(summarizeCandidate),
        pilotCandidate: plan.pilotCandidate ? summarizeCandidate(plan.pilotCandidate) : undefined,
      };
      recordCommandOutputSummary(output, {
        mode: "dry-run",
        metadata: {
          shortlistedProjects: plan.wave1Shortlist.length,
        },
      });
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const api = new DirectNotionClient(token);
    const writes = await applyOperationalRollout({
      api,
      context,
      plan,
      today: flags.today,
    });

    // Refresh derived control-tower signals after manual project updates.
    const postClassificationBaseline = await runScriptJson("portfolio-audit:control-tower-sync", ["--live"]);

    let pilotRequest: Awaited<ReturnType<typeof ensurePilotActionRequest>> | undefined;
    const pilotRuns: Record<string, unknown> = {};
    const pilotRunFailures: RolloutCommandFailure[] = [];

    if (plan.pilotCandidate) {
      pilotRequest = await ensurePilotActionRequest({
        api,
        config: context.config,
        actionRequestTitlePropertyName: context.actionRequestTitlePropertyName,
        policies: context.policies,
        actionRequests: context.actionRequests,
        pilot: plan.pilotCandidate,
        githubSources: context.githubSources,
        today: flags.today,
        approve: flags.approvePilot || flags.runPilotLive,
      });

      const postCreateSteps = await runRolloutCommandSteps([
        { key: "requestSyncAfterCreate", script: "portfolio-audit:action-request-sync", args: ["--live"] },
        { key: "githubSignalSync", script: "portfolio-audit:external-signal-sync", args: ["--provider", "github", "--live"] },
      ]);
      Object.assign(pilotRuns, postCreateSteps.results);
      pilotRunFailures.push(...postCreateSteps.failures);

      if (flags.runPilotDryRun || flags.runPilotLive) {
        const dryRunSteps = await runRolloutCommandSteps([
          { key: "dryRun", script: "portfolio-audit:action-dry-run", args: ["--request", pilotRequest.id], title: plan.pilotCandidate.projectTitle },
          { key: "requestSyncAfterDryRun", script: "portfolio-audit:action-request-sync", args: ["--live"] },
        ]);
        Object.assign(pilotRuns, dryRunSteps.results);
        pilotRunFailures.push(...dryRunSteps.failures);
      }

      if (flags.runPilotLive) {
        const liveSteps = await runRolloutCommandSteps([
          { key: "liveRun", script: "portfolio-audit:action-runner", args: ["--mode", "live", "--request", pilotRequest.id], title: plan.pilotCandidate.projectTitle },
          { key: "requestSyncAfterLive", script: "portfolio-audit:action-request-sync", args: ["--live"] },
          { key: "webhookDrain", script: "portfolio-audit:webhook-shadow-drain", args: [] },
          { key: "webhookReconcile", script: "portfolio-audit:webhook-reconcile", args: ["--provider", "github"] },
        ]);
        Object.assign(pilotRuns, liveSteps.results);
        pilotRunFailures.push(...liveSteps.failures);
      }
    }

    const output = {
      ok: true,
      live: true,
      baseline: baselineResults,
      postClassificationBaseline,
      classifications: plan.candidates,
      wave1Shortlist: plan.wave1Shortlist.map(summarizeCandidate),
      wave2Queue: plan.wave2Queue.map(summarizeCandidate),
      pilotCandidate: plan.pilotCandidate ? summarizeCandidate(plan.pilotCandidate) : undefined,
      writes,
      pilotRequest,
      pilotRuns,
      pilotRunFailures,
    };
    recordCommandOutputSummary(
      {
        ...output,
        recordsUpdated: Array.isArray(writes) ? writes.length : undefined,
        failureCount: pilotRunFailures.length,
      },
      {
        mode: "live",
        metadata: {
          shortlistedProjects: plan.wave1Shortlist.length,
        },
      },
    );
    console.log(JSON.stringify(output, null, 2));
}

export function buildOperationalRolloutPlan(input: {
  projects: ControlTowerProjectRecord[];
  githubSources: ExternalSignalSourceRecord[];
  targetConfig: LocalPortfolioActuationTargetConfig;
}): OperationalRolloutPlan {
  const candidates = input.projects
    .filter(isPriorityProject)
    .map((project) => classifyOperationalRolloutProject({ project, githubSources: input.githubSources, targetConfig: input.targetConfig }))
    .sort(compareCandidatePriority);

  const moveCandidates = candidates.filter((candidate) => candidate.classification === "move to GitHub next");
  const existingRepoShortlist = moveCandidates.filter((candidate) =>
    ["active_allowlisted", "active_known_repo", "known_repo_allowlisted", "known_repo"].includes(candidate.githubLane),
  );

  const wave1Shortlist = existingRepoShortlist.slice(0, 2);
  if (wave1Shortlist.length === 0) {
    const seededCandidate = moveCandidates.find((candidate) => candidate.githubLane === "seeded_needs_mapping");
    if (seededCandidate) {
      wave1Shortlist.push(seededCandidate);
    }
  }

  const wave1ProjectIds = new Set(wave1Shortlist.map((candidate) => candidate.projectId));
  const wave2Queue = moveCandidates
    .filter((candidate) => !wave1ProjectIds.has(candidate.projectId))
    .slice(0, 2);

  const wave2ProjectIds = new Set(wave2Queue.map((candidate) => candidate.projectId));
  const finalCandidates: OperationalRolloutCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    waveAssignment: wave1ProjectIds.has(candidate.projectId)
      ? "wave1"
      : wave2ProjectIds.has(candidate.projectId)
        ? "wave2"
        : "none",
  }));

  return {
    candidates: finalCandidates,
    wave1Shortlist: finalCandidates.filter((candidate) => wave1ProjectIds.has(candidate.projectId)),
    wave2Queue: finalCandidates.filter((candidate) => wave2ProjectIds.has(candidate.projectId)),
    pilotCandidate:
      finalCandidates.find((candidate) => candidate.projectId === wave1Shortlist.find((entry) => entry.githubLane === "active_allowlisted")?.projectId) ??
      finalCandidates.find((candidate) => wave1ProjectIds.has(candidate.projectId)),
  };
}

export function classifyOperationalRolloutProject(input: {
  project: ControlTowerProjectRecord;
  githubSources: ExternalSignalSourceRecord[];
  targetConfig: LocalPortfolioActuationTargetConfig;
}): OperationalRolloutCandidate {
  if (!input.project.operatingQueue || !PRIORITY_QUEUE_SET.has(input.project.operatingQueue as PriorityQueue)) {
    throw new AppError(`Project "${input.project.title}" is outside the operational rollout priority slice`);
  }
  const queue = input.project.operatingQueue as PriorityQueue;
  const projectSource = input.githubSources.find(
    (source) =>
      source.provider === "GitHub" &&
      source.sourceType === "Repo" &&
      source.localProjectIds.includes(input.project.id),
  );
  const targetRule = findActuationTarget({
    targetConfig: input.targetConfig,
    projectId: input.project.id,
    source: projectSource,
  });

  const hasKnownRepo = Boolean(
    projectSource?.identifier ||
      projectSource?.sourceUrl ||
      targetRule?.sourceIdentifier ||
      targetRule?.sourceUrl,
  );
  const hasActiveMapping = Boolean(
    projectSource &&
      projectSource.status === "Active" &&
      (projectSource.identifier || projectSource.sourceUrl),
  );
  const matureForGitHub = ["Feature Complete", "Demoable", "Functional Core"].includes(input.project.buildMaturity);
  const shipReadyForGitHub = ["Ship-Ready", "Near Ship", "Needs Hardening"].includes(input.project.shipReadiness);
  const locallyOperable = ["Yes", "Partial", "Likely"].includes(input.project.runsLocally);
  const highFriction = input.project.setupFriction === "High";
  const seededGitHubRow = Boolean(projectSource);
  const explicitlyAllowlisted = Boolean(targetRule);

  let classification: OperationalRolloutClassification;
  let githubLane: GitHubLaneStatus;
  let rationale: string;

  if (input.project.currentState === "Needs Decision" && input.project.shipReadiness === "Not Ready" && highFriction) {
    classification = "not worth migrating yet";
    githubLane = seededGitHubRow ? "seeded_not_ready" : "none";
    rationale = "High setup friction plus low readiness makes GitHub migration noise right now.";
  } else if (hasActiveMapping && explicitlyAllowlisted) {
    classification = "move to GitHub next";
    githubLane = "active_allowlisted";
    rationale = "This project already has an active GitHub source and an explicit actuation target, so it is the safest live pilot.";
  } else if (hasActiveMapping) {
    classification = "move to GitHub next";
    githubLane = "active_known_repo";
    rationale = "This project already has an active GitHub repo mapping and can move into the GitHub lane without inventing identifiers.";
  } else if (hasKnownRepo && explicitlyAllowlisted) {
    classification = "move to GitHub next";
    githubLane = "known_repo_allowlisted";
    rationale = "The repo identity is already known and allowlisted; activate it after the first live pilot succeeds.";
  } else if (hasKnownRepo) {
    classification = "move to GitHub next";
    githubLane = "known_repo";
    rationale = "The repo identity is already known, so this can join the GitHub lane without redesigning the project.";
  } else if (seededGitHubRow && matureForGitHub && shipReadyForGitHub && locallyOperable && !highFriction) {
    classification = "move to GitHub next";
    githubLane = "seeded_needs_mapping";
    rationale = "The project looks mature enough for GitHub next, but the repo mapping still needs to be confirmed.";
  } else {
    classification = "keep Notion-only";
    githubLane = seededGitHubRow ? "seeded_not_ready" : "none";
    rationale = "The existing Notion review and execution loop is the better operating surface for this project right now.";
  }

  return {
    projectId: input.project.id,
    projectTitle: input.project.title,
    queue,
    classification,
    rationale,
    githubLane,
    waveAssignment: "none",
    decisionTitle:
      classification === "keep Notion-only"
        ? undefined
        : `Operational rollout - ${input.project.title} - ${classification}`,
    githubSourceId: projectSource?.id,
    githubSourceStatus: projectSource?.status,
    githubIdentifier: projectSource?.identifier || targetRule?.sourceIdentifier,
    githubUrl: projectSource?.sourceUrl || targetRule?.sourceUrl,
    actuationTargetTitle: targetRule?.title,
    existingNextMove: stripOperationalPrefix(input.project.nextMove),
    recommendedNextMove: buildRecommendedNextMove({
      classification,
      lane: githubLane,
      nextMove: stripOperationalPrefix(input.project.nextMove),
    }),
  };
}

function compareCandidatePriority(left: OperationalRolloutCandidate, right: OperationalRolloutCandidate): number {
  const leftScore = rankingScore(left);
  const rightScore = rankingScore(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return left.projectTitle.localeCompare(right.projectTitle);
}

function rankingScore(candidate: OperationalRolloutCandidate): number {
  const laneScore: Record<GitHubLaneStatus, number> = {
    active_allowlisted: 1000,
    active_known_repo: 850,
    known_repo_allowlisted: 700,
    known_repo: 600,
    seeded_needs_mapping: 400,
    seeded_not_ready: 100,
    none: 50,
  };
  const classificationScore: Record<OperationalRolloutClassification, number> = {
    "move to GitHub next": 200,
    "keep Notion-only": 100,
    "not worth migrating yet": 0,
  };
  return classificationScore[candidate.classification] + laneScore[candidate.githubLane] + (QUEUE_SCORE[candidate.queue] ?? 0) * 25;
}

function isPriorityProject(project: ControlTowerProjectRecord): boolean {
  return Boolean(project.operatingQueue && PRIORITY_QUEUE_SET.has(project.operatingQueue as PriorityQueue));
}

function buildRecommendedNextMove(input: {
  classification: OperationalRolloutClassification;
  lane: GitHubLaneStatus;
  nextMove: string;
}): string {
  const nextMove = input.nextMove || "define the next move and keep the project visible in weekly review.";
  switch (input.classification) {
    case "move to GitHub next":
      if (["active_allowlisted", "active_known_repo"].includes(input.lane)) {
        return `Move to GitHub next: use the existing repo mapping and operator approval flow. Delivery focus: ${nextMove}`;
      }
      return `Move to GitHub next: confirm the repo mapping, then activate the GitHub source for wave 2. Delivery focus: ${nextMove}`;
    case "not worth migrating yet":
      return `Do not migrate to GitHub yet: keep this in review/defer mode until readiness improves. Follow-up: ${nextMove}`;
    default:
      return `Operate in Notion-only mode for now: keep review, packets, and tasks current. Delivery focus: ${nextMove}`;
  }
}

function stripOperationalPrefix(value: string): string {
  const prefixes = [
    "Move to GitHub next: use the existing repo mapping and operator approval flow. Delivery focus: ",
    "Move to GitHub next: confirm the repo mapping, then activate the GitHub source for wave 2. Delivery focus: ",
    "Do not migrate to GitHub yet: keep this in review/defer mode until readiness improves. Follow-up: ",
    "Operate in Notion-only mode for now: keep review, packets, and tasks current. Delivery focus: ",
    "use the existing repo mapping and operator approval flow. Delivery focus: ",
    "confirm the repo mapping, then activate the GitHub source for wave 2. Delivery focus: ",
    "keep this in review/defer mode until readiness improves. Follow-up: ",
    "keep review, packets, and tasks current. Delivery focus: ",
  ];
  let normalized = value.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length).trim();
        changed = true;
      }
    }
  }
  return normalized;
}

async function runBaselineCommands(flags: ParsedFlags): Promise<Record<string, unknown>> {
  const liveArgs = flags.live ? ["--live"] : [];
  return {
    viewsValidate: await runScriptJson("portfolio-audit:views-validate", []),
    controlTowerSync: await runScriptJson("portfolio-audit:control-tower-sync", liveArgs),
    reviewPacket: await runScriptJson("portfolio-audit:review-packet", liveArgs),
    recommendationRun: await runScriptJson("portfolio-audit:recommendation-run", ["--type", "weekly", ...liveArgs]),
  };
}

async function loadRolloutContext(token: string, configPath: string): Promise<RolloutContext> {
  const config = await loadLocalPortfolioControlTowerConfig(configPath);
  if (!config.phase5ExternalSignals || !config.phase6Governance || !config.phase2Execution) {
    throw new AppError("Operational rollout requires phases 2, 5, and 6 to be configured");
  }

  const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
  const api = new DirectNotionClient(token);
  const targetConfig = await loadLocalPortfolioActuationTargetConfig();
  const [projectSchema, sourceSchema, policySchema, requestSchema, decisionSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
    api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
    api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
    api.retrieveDataSource(config.phase2Execution.decisions.dataSourceId),
  ]);
  const [projectPages, sourcePages, policyPages, requestPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
    fetchAllPages(sdk, config.phase6Governance.policies.dataSourceId, policySchema.titlePropertyName),
    fetchAllPages(sdk, config.phase6Governance.actionRequests.dataSourceId, requestSchema.titlePropertyName),
  ]);

  return {
    config,
    projects: projectPages.map((page) => toControlTowerProjectRecord(page)),
    githubSources: sourcePages
      .map((page) => toExternalSignalSourceRecord(page))
      .filter((source) => source.provider === "GitHub" && source.sourceType === "Repo"),
    policies: policyPages.map((page) => toActionPolicyRecord(page)),
    actionRequests: requestPages.map((page) => toActionRequestRecord(page)),
    targetConfig,
    decisionTitlePropertyName: decisionSchema.titlePropertyName,
    actionRequestTitlePropertyName: requestSchema.titlePropertyName,
  };
}

async function applyOperationalRollout(input: {
  api: DirectNotionClient;
  context: RolloutContext;
  plan: OperationalRolloutPlan;
  today: string;
}): Promise<{ projectsUpdated: number; decisionsUpserted: number }> {
  let projectsUpdated = 0;
  let decisionsUpserted = 0;

  for (const candidate of input.plan.candidates) {
    const project = input.context.projects.find((entry) => entry.id === candidate.projectId);
    if (!project) {
      continue;
    }
    const nextMoveChanged = project.nextMove.trim() !== candidate.recommendedNextMove.trim();
    const dateChanged = project.dateUpdated !== input.today;
    if (nextMoveChanged || dateChanged) {
      await input.api.updatePageProperties({
        pageId: candidate.projectId,
        properties: {
          "Next Move": richTextValue(candidate.recommendedNextMove),
          "Date Updated": datePropertyValue(input.today),
        },
      });
      projectsUpdated += 1;
    }

    if (candidate.classification === "keep Notion-only" || !candidate.decisionTitle) {
      continue;
    }

    await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.context.config.phase2Execution!.decisions.dataSourceId,
      titlePropertyName: input.context.decisionTitlePropertyName,
      title: candidate.decisionTitle,
      properties: {
        [input.context.decisionTitlePropertyName]: titleValue(candidate.decisionTitle),
        Status: { select: { name: "Committed" } },
        "Decision Type": { select: { name: "Portfolio" } },
        "Decision Owner": peopleValue(input.context.config.phase2Execution?.defaultOwnerUserId),
        "Proposed On": { date: { start: input.today } },
        "Decided On": { date: { start: input.today } },
        "Revisit By": { date: { start: addDays(input.today, 14) } },
        "Local Project": relationValue([candidate.projectId]),
        "Chosen Option": richTextValue(candidate.classification),
        Rationale: richTextValue(candidate.rationale),
        "Expected Impact": richTextValue(candidate.recommendedNextMove),
      },
      markdown: renderDecisionMarkdown(candidate),
    });
    decisionsUpserted += 1;
  }

  return { projectsUpdated, decisionsUpserted };
}

async function ensurePilotActionRequest(input: {
  api: DirectNotionClient;
  config: RolloutContext["config"];
  actionRequestTitlePropertyName: string;
  policies: ActionPolicyRecord[];
  actionRequests: ActionRequestRecord[];
  pilot: OperationalRolloutCandidate;
  githubSources: ExternalSignalSourceRecord[];
  today: string;
  approve: boolean;
}): Promise<{ id: string; url: string; existed: boolean; title: string; status: string }> {
  if (!input.config.phase6Governance || !input.config.phase2Execution) {
    throw new AppError("Operational rollout pilot requires phases 2 and 6");
  }
  if (!input.pilot.githubSourceId) {
    throw new AppError(`Pilot candidate "${input.pilot.projectTitle}" does not have an active GitHub source`);
  }

  return ensureGitHubCreateIssueActionRequest({
    api: input.api,
    config: input.config,
    actionRequestTitlePropertyName: input.actionRequestTitlePropertyName,
    policies: input.policies,
    actionRequests: input.actionRequests,
    githubSources: input.githubSources,
    requestTitle: `Operational rollout pilot - ${input.pilot.projectTitle} - GitHub issue`,
    projectId: input.pilot.projectId,
    projectTitle: input.pilot.projectTitle,
    projectNextMove: input.pilot.existingNextMove,
    sourceId: input.pilot.githubSourceId,
    today: input.today,
    approve: input.approve,
    payloadTitle: `${input.pilot.projectTitle}: operational rollout pilot`,
    payloadBody: renderPilotIssueBody(input.pilot),
    providerRequestKey: `operational-rollout:${input.pilot.projectId}:github.create_issue`,
    approvalReasonApproved: "Approved as the safest-path first live pilot for the operational rollout.",
    approvalReasonPending: "Pending operator approval for the first live GitHub pilot.",
    executionNotes:
      "This request was generated by the operational rollout workflow and is intended to validate the GitHub issue-creation lane.",
    markdownPurpose: "Validate the first governed live GitHub issue path using the existing Notion operating system.",
  });
}

export async function ensureGitHubCreateIssueActionRequest(
  input: EnsureGitHubCreateIssueActionRequestInput,
): Promise<{ id: string; url: string; existed: boolean; title: string; status: string }> {
  if (!input.config.phase6Governance || !input.config.phase2Execution) {
    throw new AppError("GitHub create-issue action requests require phases 2 and 6");
  }
  const policy = input.policies.find((entry) => entry.title === "github.create_issue");
  if (!policy) {
    throw new AppError('Could not find the "github.create_issue" action policy');
  }
  const source = input.githubSources.find((entry) => entry.id === input.sourceId);
  if (!source || source.status !== "Active") {
    throw new AppError(`Project "${input.projectTitle}" does not have an active GitHub source`);
  }

  const existing = input.actionRequests.find((entry) => entry.title === input.requestTitle);
  if (existing?.status === "Executed") {
    return {
      id: existing.id,
      url: existing.url,
      existed: true,
      title: input.requestTitle,
      status: existing.status,
    };
  }

  const status = existing?.status === "Approved" || input.approve ? "Approved" : "Pending Approval";

  const properties = {
    [input.actionRequestTitlePropertyName]: titleValue(input.requestTitle),
    "Local Project": relationValue([input.projectId]),
    Policy: relationValue([policy.id]),
    "Target Source": relationValue([source.id]),
    Status: { select: { name: status } },
    "Source Type": { select: { name: "Manual" } },
    "Requested By": peopleValue(input.config.phase2Execution.defaultOwnerUserId),
    Approver: status === "Approved" ? peopleValue(input.config.phase2Execution.defaultOwnerUserId) : { people: [] },
    "Requested At": { date: { start: input.today } },
    "Decided At": status === "Approved" ? { date: { start: input.today } } : { date: null },
    "Expires At": { date: { start: addDays(input.today, policy.defaultExpiryHours >= 48 ? 3 : 2) } },
    "Planned Payload Summary": richTextValue(
      `Create the governed GitHub issue for ${input.projectTitle} using the existing Notion operator workflow.`,
    ),
    "Payload Title": richTextValue(input.payloadTitle),
    "Payload Body": richTextValue(input.payloadBody),
    "Provider Request Key": richTextValue(input.providerRequestKey),
    "Approval Reason": richTextValue(
      input.approve
        ? input.approvalReasonApproved
        : input.approvalReasonPending,
    ),
    "Execution Notes": richTextValue(input.executionNotes),
  };
  const markdown = renderCreateIssueRequestMarkdown({
    title: input.requestTitle,
    projectTitle: input.projectTitle,
    projectNextMove: input.projectNextMove,
    sourceUrl: source.sourceUrl,
    status,
    purpose: input.markdownPurpose,
  });

  if (existing) {
    await input.api.updatePageProperties({
      pageId: existing.id,
      properties,
    });
    await input.api.patchPageMarkdown({
      pageId: existing.id,
      command: "replace_content",
      newMarkdown: markdown,
    });
    return {
      id: existing.id,
      url: existing.url,
      existed: true,
      title: input.requestTitle,
      status,
    };
  }

  const created = await input.api.createPageWithMarkdown({
    parent: { data_source_id: input.config.phase6Governance.actionRequests.dataSourceId },
    properties: {
      [input.actionRequestTitlePropertyName]: titleValue(input.requestTitle),
    },
    markdown,
  });
  await input.api.updatePageProperties({
    pageId: created.id,
    properties,
  });
  return {
    id: created.id,
    url: created.url,
    existed: false,
    title: input.requestTitle,
    status,
  };
}

export async function runRolloutCommandSteps(
  steps: RolloutCommandStep[],
  runner: (script: string, args: string[]) => Promise<unknown> = runScriptJson,
): Promise<{ results: Record<string, unknown>; failures: RolloutCommandFailure[] }> {
  const results: Record<string, unknown> = {};
  const failures: RolloutCommandFailure[] = [];

  for (const step of steps) {
    try {
      results[step.key] = await runner(step.script, step.args);
    } catch (error) {
      failures.push({
        key: step.key,
        script: step.script,
        args: [...step.args],
        title: step.title,
        error: toErrorMessage(error),
      });
    }
  }

  return { results, failures };
}

export function renderDecisionMarkdown(candidate: OperationalRolloutCandidate): string {
  return [
    `# ${candidate.projectTitle} operational rollout decision`,
    "",
    `- Classification: ${candidate.classification}`,
    `- Queue: ${candidate.queue}`,
    `- GitHub lane: ${candidate.githubLane}`,
    "",
    "## Rationale",
    candidate.rationale,
    "",
    "## Next Move",
    candidate.recommendedNextMove,
  ].join("\n");
}

function renderPilotIssueBody(candidate: OperationalRolloutCandidate): string {
  return [
    `This issue was created through the Notion operational rollout pilot for **${candidate.projectTitle}**.`,
    "",
    "## Why this exists",
    "- Validate the governed GitHub issue-creation lane on a real project.",
    "- Turn the current next move into a tracked GitHub work item.",
    "",
    "## Current focus",
    candidate.existingNextMove || "Define the next delivery slice.",
    "",
    "## Done when",
    "- The GitHub issue exists and is visible in the actuation ledger.",
    "- The issue can be used as the next operator-backed execution item for this project.",
  ].join("\n");
}

function renderCreateIssueRequestMarkdown(input: {
  title: string;
  projectTitle: string;
  projectNextMove: string;
  sourceUrl: string;
  status: string;
  purpose: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    `- Status: ${input.status}`,
    `- Project: ${input.projectTitle}`,
    input.sourceUrl ? `- Target repo: ${input.sourceUrl}` : "",
    "",
    "## Requested issue",
    input.projectNextMove || "Create a first tracked next step for the project.",
    "",
    "## Purpose",
    input.purpose,
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeCandidate(candidate: OperationalRolloutCandidate): Record<string, unknown> {
  return {
    projectTitle: candidate.projectTitle,
    queue: candidate.queue,
    classification: candidate.classification,
    githubLane: candidate.githubLane,
    waveAssignment: candidate.waveAssignment,
    githubIdentifier: candidate.githubIdentifier,
    actuationTargetTitle: candidate.actuationTargetTitle,
    rationale: candidate.rationale,
  };
}

function findActuationTarget(input: {
  targetConfig: LocalPortfolioActuationTargetConfig;
  projectId: string;
  source?: ExternalSignalSourceRecord;
}): ActuationTargetRule | undefined {
  return input.targetConfig.targets.find(
    (target) =>
      (target.localProjectId && target.localProjectId === input.projectId) ||
      (input.source?.identifier && target.sourceIdentifier === input.source.identifier) ||
      (input.source?.sourceUrl && target.sourceUrl === input.source.sourceUrl),
  );
}

export async function runScriptJson(script: string, args: string[]): Promise<unknown> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const invocation = ["run", script];
  if (args.length > 0) {
    invocation.push("--", ...args);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, invocation, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError(`Command "${script}" failed: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const jsonText = extractJsonText(stdout);
      try {
        resolve(jsonText ? JSON.parse(jsonText) : {});
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });
  });
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
  return {
    people: userId ? [{ id: userId }] : [],
  };
}

function extractJsonText(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  const braceIndex = trimmed.indexOf("{");
  const bracketIndex = trimmed.indexOf("[");
  const indices = [braceIndex, bracketIndex].filter((value) => value >= 0);
  const startIndex = indices.length > 0 ? Math.min(...indices) : -1;
  const endIndex = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (startIndex < 0 || endIndex <= startIndex) {
    return undefined;
  }
  return trimmed.slice(startIndex, endIndex + 1);
}

interface ParsedFlags {
  live: boolean;
  runPilotDryRun: boolean;
  runPilotLive: boolean;
  approvePilot: boolean;
  today: string;
  configPath: string;
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["rollout", "operational"]);
}
