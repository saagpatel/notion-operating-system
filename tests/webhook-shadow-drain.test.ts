import { describe, expect, test } from "vitest";

import type { ExternalActionExecutionRecord } from "../src/notion/local-portfolio-actuation.js";
import {
  extractGitHubReconcileCandidate,
  findMatchingGitHubExecutionForReceipt,
} from "../src/notion/webhook-shadow-drain.js";

describe("webhook shadow drain reconcile matching", () => {
  test("prefers the live execution over dry run rows for the same issue", () => {
    const executions: ExternalActionExecutionRecord[] = [
      baseExecution({
        id: "dry-run-1",
        mode: "Dry Run",
        issueNumber: 3,
        actionKey: "github.add_issue_comment",
        reconcileStatus: "Not Needed",
      }),
      baseExecution({
        id: "live-1",
        mode: "Live",
        issueNumber: 3,
        actionKey: "github.add_issue_comment",
        commentId: "4104597108",
        reconcileStatus: "Pending",
      }),
    ];

    const match = findMatchingGitHubExecutionForReceipt({
      executions,
      matchedSourceId: "source-1",
      candidate: {
        issueNumber: 3,
        commentId: "4104597108",
        actionKeys: ["github.add_issue_comment"],
      },
    });

    expect(match?.id).toBe("live-1");
  });

  test("extracts issue comment reconcile candidates", () => {
    const candidate = extractGitHubReconcileCandidate(
      JSON.stringify({
        action: "created",
        issue: { number: 9 },
        comment: { id: 12345 },
      }),
      "issue_comment",
    );

    expect(candidate).toEqual({
      issueNumber: 9,
      commentId: "12345",
      actionKeys: ["github.add_issue_comment"],
    });
  });
});

function baseExecution(overrides: Partial<ExternalActionExecutionRecord> = {}): ExternalActionExecutionRecord {
  return {
    id: "execution-1",
    url: "https://notion.so/execution-1",
    title: "Execution",
    actionRequestIds: ["request-1"],
    localProjectIds: ["project-1"],
    policyIds: ["policy-1"],
    targetSourceIds: ["source-1"],
    provider: "GitHub",
    actionKey: "github.add_issue_comment",
    mode: "Live",
    status: "Succeeded",
    idempotencyKey: "idempotency-1",
    executedAt: "2026-03-21",
    providerResultKey: "",
    providerUrl: "",
    issueNumber: 1,
    commentId: "",
    labelDeltaSummary: "",
    assigneeDeltaSummary: "",
    responseClassification: "Success",
    reconcileStatus: "Pending",
    responseSummary: "Created GitHub issue comment.",
    failureNotes: "",
    compensationPlan: "",
    ...overrides,
  };
}
