import { describe, expect, test } from "vitest";

import {
  classifyActionRunnerFailure,
  evaluateActionRunnerDecision,
  summarizeActionRunnerResults,
  type ActionRunnerResult,
} from "../src/notion/action-runner.js";
import type { ExternalActionExecutionRecord } from "../src/notion/local-portfolio-actuation.js";
import type { ActionPolicyRecord, ActionRequestRecord } from "../src/notion/local-portfolio-governance.js";

describe("action runner hardening", () => {
  test("skips duplicate successful live executions", () => {
    const policy = basePolicy();
    const request = baseRequest();
    const decision = evaluateActionRunnerDecision({
      request,
      policies: [policy],
      executions: [
        baseExecution({
          mode: "Live",
          status: "Succeeded",
          idempotencyKey: "dup-key",
        }),
      ],
      mode: "live",
      actionKey: "github.create_issue",
      idempotencyKey: "dup-key",
    });

    expect(decision).toEqual({
      status: "Skipped",
      notes: "A successful live execution already exists.",
    });
  });

  test("skips live execution when validation blockers remain", () => {
    const decision = evaluateActionRunnerDecision({
      request: baseRequest(),
      policies: [basePolicy()],
      executions: [],
      mode: "live",
      actionKey: "github.create_issue",
      validationNotes: ["Request is not approved."],
    });

    expect(decision).toEqual({
      status: "Skipped",
      notes: "Request is not approved.",
    });
  });

  test("skips requests missing a supported linked policy", () => {
    const unsupportedPolicy = basePolicy({
      title: "vercel.pause_deployment",
    });
    const decision = evaluateActionRunnerDecision({
      request: baseRequest(),
      policies: [unsupportedPolicy],
      executions: [],
      mode: "dry-run",
    });

    expect(decision).toEqual({
      status: "Skipped",
      notes: "Missing supported linked policy.",
    });
  });

  test("summarizes mixed batch results cleanly", () => {
    const summary = summarizeActionRunnerResults([
      { requestId: "request-1", status: "Succeeded" },
      { requestId: "request-2", status: "Skipped", notes: "Already executed." },
      { requestId: "request-3", status: "Failed", notes: "boom" },
    ] satisfies ActionRunnerResult[]);

    expect(summary).toEqual({
      recordsUpdated: 1,
      recordsSkipped: 1,
      failureCount: 1,
    });
  });

  test("classifies provider failures for stable operator output", () => {
    const failure = classifyActionRunnerFailure(
      new Error("Permission Failure: forbidden"),
    );

    expect(failure.failureNotes).toContain("Permission Failure");
    expect(failure.failureClassification).toBe("Permission Failure");
  });
});

function basePolicy(overrides: Partial<ActionPolicyRecord> = {}): ActionPolicyRecord {
  return {
    id: overrides.id ?? "policy-1",
    url: overrides.url ?? "https://notion.so/policy-1",
    title: overrides.title ?? "github.create_issue",
    provider: overrides.provider ?? "GitHub",
    mutationClass: overrides.mutationClass ?? "Issue",
    executionMode: overrides.executionMode ?? "Approved Live",
    identityType: overrides.identityType ?? "GitHub App",
    approvalRule: overrides.approvalRule ?? "Single Approval",
    dryRunRequired: overrides.dryRunRequired ?? true,
    rollbackRequired: overrides.rollbackRequired ?? false,
    defaultExpiryHours: overrides.defaultExpiryHours ?? 72,
    allowedSources: overrides.allowedSources ?? ["Manual"],
    notes: overrides.notes ?? "",
  };
}

function baseRequest(overrides: Partial<ActionRequestRecord> = {}): ActionRequestRecord {
  return {
    id: overrides.id ?? "request-1",
    url: overrides.url ?? "https://notion.so/request-1",
    title: overrides.title ?? "Create issue",
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    policyIds: overrides.policyIds ?? ["policy-1"],
    targetSourceIds: overrides.targetSourceIds ?? ["source-1"],
    status: overrides.status ?? "Approved",
    sourceType: overrides.sourceType ?? "Manual",
    recommendationRunIds: overrides.recommendationRunIds ?? [],
    weeklyReviewIds: overrides.weeklyReviewIds ?? [],
    requestedByIds: overrides.requestedByIds ?? [],
    approverIds: overrides.approverIds ?? [],
    requestedAt: overrides.requestedAt ?? "2026-03-25",
    decidedAt: overrides.decidedAt ?? "2026-03-25",
    expiresAt: overrides.expiresAt ?? "2026-04-01",
    plannedPayloadSummary: overrides.plannedPayloadSummary ?? "Create an issue",
    payloadTitle: overrides.payloadTitle ?? "Create issue",
    payloadBody: overrides.payloadBody ?? "Body",
    targetNumber: overrides.targetNumber ?? 0,
    targetLabels: overrides.targetLabels ?? [],
    targetAssignees: overrides.targetAssignees ?? [],
    executionIntent: overrides.executionIntent ?? "Dry Run",
    latestExecutionIds: overrides.latestExecutionIds ?? [],
    latestExecutionStatus: overrides.latestExecutionStatus ?? "None",
    providerRequestKey: overrides.providerRequestKey ?? "request-1",
    approvalReason: overrides.approvalReason ?? "",
    executionNotes: overrides.executionNotes ?? "",
  };
}

function baseExecution(
  overrides: Partial<ExternalActionExecutionRecord> = {},
): ExternalActionExecutionRecord {
  return {
    id: overrides.id ?? "execution-1",
    url: overrides.url ?? "https://notion.so/execution-1",
    title: overrides.title ?? "Execution",
    actionRequestIds: overrides.actionRequestIds ?? ["request-1"],
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    policyIds: overrides.policyIds ?? ["policy-1"],
    targetSourceIds: overrides.targetSourceIds ?? ["source-1"],
    provider: overrides.provider ?? "GitHub",
    actionKey: overrides.actionKey ?? "github.create_issue",
    mode: overrides.mode ?? "Live",
    status: overrides.status ?? "Succeeded",
    idempotencyKey: overrides.idempotencyKey ?? "key-1",
    executedAt: overrides.executedAt ?? "2026-03-25",
    providerResultKey: overrides.providerResultKey ?? "",
    providerUrl: overrides.providerUrl ?? "",
    issueNumber: overrides.issueNumber ?? 0,
    commentId: overrides.commentId ?? "",
    labelDeltaSummary: overrides.labelDeltaSummary ?? "",
    assigneeDeltaSummary: overrides.assigneeDeltaSummary ?? "",
    responseClassification: overrides.responseClassification ?? "Success",
    reconcileStatus: overrides.reconcileStatus ?? "Pending",
    responseSummary: overrides.responseSummary ?? "",
    failureNotes: overrides.failureNotes ?? "",
    compensationPlan: overrides.compensationPlan ?? "",
  };
}
