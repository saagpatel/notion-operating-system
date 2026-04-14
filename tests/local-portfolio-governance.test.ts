import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  buildGovernanceAuditSummary,
  buildLogicalDeliveryKey,
  buildRequestExpiryDate,
  createWebhookReceiptEnvelope,
  ensurePhase6GovernanceState,
  loadLocalPortfolioGovernancePolicyConfig,
  parseLocalPortfolioGovernancePolicyConfig,
  parseLocalPortfolioGovernanceViewPlan,
  parseLocalPortfolioWebhookProviderConfig,
  shouldExpireActionRequest,
  validateLocalPortfolioGovernanceViewPlanAgainstSchemas,
  verifyGitHubSignature,
  verifyVercelSignature,
  type ActionRequestRecord,
} from "../src/notion/local-portfolio-governance.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import { renderNotionPhaseMemoryMarkdown } from "../src/notion/local-portfolio-roadmap.js";

describe("local portfolio governance", () => {
  test("parses the phase-6 governance configs", async () => {
    const [policiesRaw, providersRaw, viewsRaw] = await Promise.all([
      readConfig("../config/local-portfolio-governance-policies.json"),
      readConfig("../config/local-portfolio-webhook-providers.json"),
      readConfig("../config/local-portfolio-governance-views.json"),
    ]);

    const policies = parseLocalPortfolioGovernancePolicyConfig(policiesRaw);
    const providers = parseLocalPortfolioWebhookProviderConfig(providersRaw);
    const views = parseLocalPortfolioGovernanceViewPlan(viewsRaw);

    expect(policies.policies).toHaveLength(8);
    expect(policies.policies.find((policy) => policy.actionKey === "vercel.rollback")?.executionMode).toBe("Approved Live");
    expect(policies.policies.find((policy) => policy.actionKey === "vercel.promote_or_rollback")).toBeUndefined();
    expect(providers.providers).toHaveLength(2);
    expect(views.collections).toHaveLength(5);
  });

  test("builds phase-6 governance state and audit summaries", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const policyConfig = await loadLocalPortfolioGovernancePolicyConfig();
    const providerConfig = parseLocalPortfolioWebhookProviderConfig(
      await readConfig("../config/local-portfolio-webhook-providers.json"),
    );
    const nextConfig = {
      ...controlConfig,
      phase6Governance: ensurePhase6GovernanceState(controlConfig, { today: "2026-03-17" }),
    };

    const summary = buildGovernanceAuditSummary({
      controlConfig: nextConfig,
      policyConfig,
      providerConfig,
    });

    expect(nextConfig.phase6Governance?.identityPosture).toBe("app_first_least_privilege");
    expect(nextConfig.phase6Governance?.phaseMemory.phase6Added).toContain("Phase 6 gave us");
    expect(summary.liveMutationPolicies).toContain("github.create_issue");
  });

  test("validates governance views against representative schemas", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const phase6 = ensurePhase6GovernanceState(controlConfig, { today: "2026-03-17" });
    const parsedPlan = parseLocalPortfolioGovernanceViewPlan(
      await readConfig("../config/local-portfolio-governance-views.json"),
    );
    const plan = {
      ...parsedPlan,
      collections: parsedPlan.collections.map((collection) => ({
        ...collection,
        database:
          collection.key === "policies"
            ? phase6.policies
            : collection.key === "actionRequests"
              ? phase6.actionRequests
              : collection.key === "endpoints"
                ? phase6.webhookEndpoints
                : collection.key === "deliveries"
                  ? phase6.webhookDeliveries
                  : phase6.webhookReceipts,
      })),
    };

    const summary = validateLocalPortfolioGovernanceViewPlanAgainstSchemas({
      plan,
      schemas: {
        policies: {
          id: phase6.policies.dataSourceId,
          title: phase6.policies.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            "Mutation Class": { name: "Mutation Class", type: "select", writable: true },
            "Execution Mode": { name: "Execution Mode", type: "select", writable: true },
            "Approval Rule": { name: "Approval Rule", type: "select", writable: true },
            "Identity Type": { name: "Identity Type", type: "select", writable: true },
            "Dry Run Required": { name: "Dry Run Required", type: "checkbox", writable: true },
            "Rollback Required": { name: "Rollback Required", type: "checkbox", writable: true },
          },
        },
        actionRequests: {
          id: phase6.actionRequests.dataSourceId,
          title: phase6.actionRequests.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            "Local Project": { name: "Local Project", type: "relation", writable: true },
            Policy: { name: "Policy", type: "relation", writable: true },
            "Requested At": { name: "Requested At", type: "date", writable: true },
            "Decided At": { name: "Decided At", type: "date", writable: true },
            "Expires At": { name: "Expires At", type: "date", writable: true },
          },
        },
        endpoints: {
          id: phase6.webhookEndpoints.dataSourceId,
          title: phase6.webhookEndpoints.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            Mode: { name: "Mode", type: "select", writable: true },
            "Receiver Path": { name: "Receiver Path", type: "rich_text", writable: true },
            "Secret Env Var": { name: "Secret Env Var", type: "rich_text", writable: true },
            "Replay Window Minutes": { name: "Replay Window Minutes", type: "number", writable: true },
            "Last Delivery At": { name: "Last Delivery At", type: "date", writable: true },
          },
        },
        deliveries: {
          id: phase6.webhookDeliveries.dataSourceId,
          title: phase6.webhookDeliveries.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            "Verification Result": { name: "Verification Result", type: "select", writable: true },
            "Event Type": { name: "Event Type", type: "rich_text", writable: true },
            "Last Seen At": { name: "Last Seen At", type: "date", writable: true },
            "Receipt Count": { name: "Receipt Count", type: "number", writable: true },
            "Failure Notes": { name: "Failure Notes", type: "rich_text", writable: true },
          },
        },
        receipts: {
          id: phase6.webhookReceipts.dataSourceId,
          title: phase6.webhookReceipts.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            "Received At": { name: "Received At", type: "date", writable: true },
            "Verification Result": { name: "Verification Result", type: "select", writable: true },
            "Drain Status": { name: "Drain Status", type: "select", writable: true },
            "Failure Notes": { name: "Failure Notes", type: "rich_text", writable: true },
          },
        },
      },
    });

    expect(summary.validatedViews.length).toBeGreaterThan(0);
  });

  test("verifies GitHub and Vercel signatures and builds receipt envelopes", async () => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = "secret-gh";
    process.env.VERCEL_WEBHOOK_SECRET = "secret-vercel";
    const providerConfig = parseLocalPortfolioWebhookProviderConfig(
      await readConfig("../config/local-portfolio-webhook-providers.json"),
    );
    const githubProvider = providerConfig.providers.find((provider) => provider.key === "github")!;
    const vercelProvider = providerConfig.providers.find((provider) => provider.key === "vercel")!;

    const githubBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
      pull_request: {
        number: 42,
        title: "Improve webhook safety",
        html_url: "https://github.com/owner/repo/pull/42",
        updated_at: "2026-03-17T12:00:00Z",
      },
    });
    const githubSignature = `sha256=${createHmac("sha256", "secret-gh").update(githubBody).digest("hex")}`;
    expect(verifyGitHubSignature("secret-gh", githubBody, githubSignature)).toBe(true);

    const githubEnvelope = createWebhookReceiptEnvelope({
      providerPlan: githubProvider,
      headers: {
        "x-github-delivery": "delivery-1",
        "x-github-event": "pull_request",
        "x-hub-signature-256": githubSignature,
      },
      body: githubBody,
      receivedAt: "2026-03-17T12:00:00Z",
      requestId: "request-1",
    });
    expect(githubEnvelope.verificationResult).toBe("Valid");
    expect(githubEnvelope.eventType).toBe("pull_request");

    const vercelBody = JSON.stringify({
      id: "evt_123",
      type: "deployment.ready",
      project: { id: "prj_123", name: "ship-project" },
      deployment: {
        state: "READY",
        url: "https://ship-project.vercel.app",
        target: "production",
        createdAt: "2026-03-17T12:00:00Z",
      },
    });
    const vercelSignature = createHmac("sha1", "secret-vercel").update(vercelBody).digest("hex");
    expect(verifyVercelSignature("secret-vercel", vercelBody, vercelSignature)).toBe(true);
  });

  test("handles delivery keys, expiry, and phase memory through phase seven", () => {
    expect(buildLogicalDeliveryKey("github", "ABC-123")).toBe("github::abc-123");
    expect(buildRequestExpiryDate("2026-03-17", 24)).toBe("2026-03-18");

    const request: ActionRequestRecord = {
      id: "request-1",
      url: "https://notion.so/request-1",
      title: "Create GitHub issue for blocker",
      localProjectIds: ["project-1"],
      policyIds: ["policy-1"],
      targetSourceIds: [],
      status: "Approved",
      sourceType: "Manual",
      recommendationRunIds: [],
      weeklyReviewIds: [],
      requestedByIds: [],
      approverIds: [],
      requestedAt: "2026-03-16",
      decidedAt: "2026-03-17",
      expiresAt: "2026-03-17",
      plannedPayloadSummary: "",
      payloadTitle: "Blocked issue",
      payloadBody: "Need follow-up.",
      targetNumber: 0,
      targetLabels: [],
      targetAssignees: [],
      executionIntent: "Dry Run",
      latestExecutionIds: [],
      latestExecutionStatus: "None",
      providerRequestKey: "",
      approvalReason: "",
      executionNotes: "",
    };
    expect(shouldExpireActionRequest(request, "2026-03-18")).toBe(true);

    const markdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: "2026-03-17",
      currentPhase: 6,
    });
    expect(markdown).toContain("Phase 6 gave us cross-system governance");
    expect(markdown).toContain("## Phase 7");
    expect(markdown).toContain("## Phase 8");
  });
});

async function readConfig(relativePath: string) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}
