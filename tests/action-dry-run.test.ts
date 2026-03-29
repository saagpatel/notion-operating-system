import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, test } from "vitest";

import {
  evaluateActionDryRunReadiness,
  prepareActionDryRun,
} from "../src/notion/action-dry-run.js";
import { parseLocalPortfolioActuationTargetConfig } from "../src/notion/local-portfolio-actuation.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import type { ExternalSignalSourceRecord } from "../src/notion/local-portfolio-external-signals.js";
import type { ActionPolicyRecord, ActionRequestRecord } from "../src/notion/local-portfolio-governance.js";

describe("action dry run hardening", () => {
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  test("keeps dry-run preparation stable when preflight fails", async () => {
    const request = baseRequest();
    const source = baseSource();
    const targetConfig = parseLocalPortfolioActuationTargetConfig({
      version: 1,
      strategy: {
        primary: "repo_config",
        fallback: "manual_review",
        notes: [],
      },
      defaults: {
        allowedActions: ["github.create_issue"],
        titlePrefix: "[Portfolio]",
        defaultLabels: [],
        supportsIssueCreate: true,
        supportsPrComment: true,
      },
      targets: [],
    });

    const preparation = await prepareActionDryRun(
      {
        request,
        sources: [source],
        targetConfig,
        actionKey: "github.create_issue",
      },
      {
        fetchPreflight: async () => {
          throw new Error("Permission Failure: forbidden");
        },
      },
    );

    expect(preparation.target).toBeNull();
    expect(preparation.payload).toBeNull();
    expect(preparation.idempotencyKey).toBe("");
    expect(preparation.preparationError).toContain("Permission Failure");
  });

  test("marks the request not ready for live when validation blockers remain", async () => {
    const config = await readControlConfig();
    const request = baseRequest({
      status: "Draft",
      payloadBody: "",
    });
    const preparation = {
      target: null,
      payload: null,
      preflight: undefined,
      idempotencyKey: "",
    };

    const readiness = evaluateActionDryRunReadiness({
      request,
      policies: [basePolicy()],
      config,
      actionKey: "github.create_issue",
      preparation,
      today: "2026-03-29",
      executedAt: "2026-03-29T12:00:00.000Z",
    });

    expect(readiness.readyForLive).toBe(false);
    expect(readiness.postDryRun.executionIntent).toBe("Dry Run");
    expect(readiness.postDryRun.latestExecutionStatus).toBe("Problem");
    expect(readiness.validationNotes).toContain("Request is not approved.");
    expect(readiness.validationNotes).toContain("Payload body is missing.");
    expect(readiness.validationNotes).toContain("Target GitHub source is not resolved.");
  });

  test("moves to ready-for-live when the dry run is valid and credentials exist", async () => {
    process.env = {
      ...previousEnv,
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY_PEM: "private-key",
    };
    const config = await readControlConfig();
    const request = baseRequest({
      executionIntent: "Dry Run",
    });
    const source = baseSource();
    const targetConfig = parseLocalPortfolioActuationTargetConfig({
      version: 1,
      strategy: {
        primary: "repo_config",
        fallback: "manual_review",
        notes: [],
      },
      defaults: {
        allowedActions: ["github.create_issue"],
        titlePrefix: "[Portfolio]",
        defaultLabels: [],
        supportsIssueCreate: true,
        supportsPrComment: true,
      },
      targets: [],
    });

    const preparation = await prepareActionDryRun({
      request,
      sources: [source],
      targetConfig,
      actionKey: "github.create_issue",
    });
    const readiness = evaluateActionDryRunReadiness({
      request,
      policies: [basePolicy()],
      config,
      actionKey: "github.create_issue",
      preparation,
      today: "2026-03-29",
      executedAt: "2026-03-29T12:00:00.000Z",
    });

    expect(readiness.validationNotes).toEqual([]);
    expect(readiness.readyForLive).toBe(true);
    expect(readiness.postDryRun.executionIntent).toBe("Ready for Live");
    expect(readiness.postDryRun.latestExecutionStatus).toBe("Dry Run Passed");
  });
});

async function readControlConfig() {
  const file = new URL("../config/local-portfolio-control-tower.json", import.meta.url);
  const raw = JSON.parse(await readFile(file, "utf8"));
  return parseLocalPortfolioControlTowerConfig(raw);
}

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
    requestedAt: overrides.requestedAt ?? "2026-03-28",
    decidedAt: overrides.decidedAt ?? "2026-03-28",
    expiresAt: overrides.expiresAt ?? "2026-04-02",
    plannedPayloadSummary: overrides.plannedPayloadSummary ?? "Create an issue",
    payloadTitle: overrides.payloadTitle ?? "Create issue",
    payloadBody: overrides.payloadBody ?? "Issue body",
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

function baseSource(overrides: Partial<ExternalSignalSourceRecord> = {}): ExternalSignalSourceRecord {
  return {
    id: overrides.id ?? "source-1",
    url: overrides.url ?? "https://notion.so/source-1",
    title: overrides.title ?? "owner/repo",
    localProjectIds: overrides.localProjectIds ?? ["project-1"],
    provider: overrides.provider ?? "GitHub",
    sourceType: overrides.sourceType ?? "Repo",
    identifier: overrides.identifier ?? "owner/repo",
    sourceUrl: overrides.sourceUrl ?? "https://github.com/owner/repo",
    status: overrides.status ?? "Active",
    environment: overrides.environment ?? "N/A",
    syncStrategy: overrides.syncStrategy ?? "Poll",
    lastSyncedAt: overrides.lastSyncedAt ?? "2026-03-28",
  };
}
