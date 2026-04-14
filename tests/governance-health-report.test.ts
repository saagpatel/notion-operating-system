import { describe, expect, test } from "vitest";

import { buildGovernanceHealthReport } from "../src/notion/governance-health-report.js";
import type { ActuationAuditSummary } from "../src/notion/local-portfolio-actuation.js";
import type { GovernanceAuditSummary } from "../src/notion/local-portfolio-governance.js";

describe("governance health report", () => {
  test("reports a healthy posture when both audit surfaces are clean", () => {
    const report = buildGovernanceHealthReport({
      governanceSummary: cleanGovernanceSummary(),
      actuationSummary: cleanActuationSummary(),
      githubActionFamilyCount: 2,
      generatedAt: "2026-04-14T12:00:00.000Z",
    });

    expect(report.status).toBe("healthy");
    expect(report.warningCount).toBe(0);
    expect(report.governance.warningCount).toBe(0);
    expect(report.actuation.warningCount).toBe(0);
    expect(report.nextActions).toEqual([
      "No immediate operator follow-up is required. Governance and actuation posture look healthy.",
    ]);
  });

  test("aggregates warnings into a compact operator-facing report", () => {
    const report = buildGovernanceHealthReport({
      governanceSummary: {
        ...cleanGovernanceSummary(),
        missingAuthRefs: ["VERCEL_TOKEN"],
        missingSecretRefs: ["GITHUB_APP_WEBHOOK_SECRET"],
        policiesMissingApprovalRule: ["github.create_issue"],
        endpointModeWarnings: ["GitHub is marked live in config while the provider plan is still shadow-only."],
        identityWarnings: ["github.create_issue is not using the app-first GitHub identity posture."],
      },
      actuationSummary: {
        ...cleanActuationSummary(),
        missingGitHubAuthRefs: ["GITHUB_APP_ID"],
        missingGitHubWebhookRefs: ["GITHUB_APP_WEBHOOK_SECRET"],
        missingVercelAuthRefs: ["VERCEL_TOKEN"],
        blockedRequests: ['Vercel target "evolutionsandbox" is not live-safe: missing vercelTeamSlug.'],
      },
      githubActionFamilyCount: 3,
      generatedAt: "2026-04-14T12:00:00.000Z",
    });

    expect(report.status).toBe("warning");
    expect(report.warningCount).toBe(9);
    expect(report.governance.warningCount).toBe(5);
    expect(report.actuation.warningCount).toBe(4);
    expect(report.nextActions).toContain(
      "Restore the missing live-write credentials before attempting governed GitHub or Vercel actions.",
    );
    expect(report.nextActions).toContain(
      "Restore the webhook secrets before relying on feedback or reconciliation signals.",
    );
    expect(report.nextActions).toContain(
      "Fix the live-safety gaps in the allowlisted actuation targets before running new dry runs or live executions.",
    );
  });
});

function cleanGovernanceSummary(): GovernanceAuditSummary {
  return {
    missingAuthRefs: [],
    missingSecretRefs: [],
    liveMutationPolicies: ["github.create_issue", "vercel.redeploy"],
    policiesMissingApprovalRule: [],
    endpointModeWarnings: [],
    identityWarnings: [],
  };
}

function cleanActuationSummary(): ActuationAuditSummary {
  return {
    missingGitHubAuthRefs: [],
    missingGitHubWebhookRefs: [],
    missingVercelAuthRefs: [],
    liveCapablePolicies: ["github.create_issue", "vercel.redeploy"],
    allowlistedTargets: 4,
    issueReadyTargets: 4,
    commentReadyTargets: 4,
    issueLifecycleReadyTargets: 4,
    supportedActionKeys: [
      "github.create_issue",
      "github.comment_pull_request",
      "vercel.redeploy",
    ],
    blockedRequests: [],
  };
}
