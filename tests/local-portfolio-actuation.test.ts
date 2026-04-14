import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildActuationAuditSummary,
  computeGitHubActionPreflight,
  buildGitHubExecutionPayload,
  buildVercelRedeployExecutionPayload,
  buildVercelRollbackExecutionPayload,
  computeActuationExecutionKey,
  computePostDryRunReadiness,
  describeGitHubActionPreflight,
  ensurePhase7ActuationState,
  evaluateActionRequestReadiness,
  fetchVercelRollbackPreflight,
  formatVercelRollbackRequestKey,
  parseLocalPortfolioActuationTargetConfig,
  parseLocalPortfolioActuationViewPlan,
  resolveActuationTarget,
  summarizeGitHubAssigneeDelta,
  summarizeGitHubLabelDelta,
  validateLocalPortfolioActuationViewPlanAgainstSchemas,
} from "../src/notion/local-portfolio-actuation.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import type { ActionPolicyRecord, ActionRequestRecord } from "../src/notion/local-portfolio-governance.js";
import type { ExternalSignalSourceRecord } from "../src/notion/local-portfolio-external-signals.js";
import { renderNotionPhaseMemoryMarkdown } from "../src/notion/local-portfolio-roadmap.js";

describe("local portfolio actuation", () => {
  test("parses the phase-7 actuation configs", async () => {
    const [targetsRaw, viewsRaw] = await Promise.all([
      readConfig("../config/local-portfolio-actuation-targets.json"),
      readConfig("../config/local-portfolio-actuation-views.json"),
    ]);
    const targets = parseLocalPortfolioActuationTargetConfig(targetsRaw);
    const views = parseLocalPortfolioActuationViewPlan(viewsRaw);
    expect(targets.defaults.allowedActions).toContain("github.create_issue");
    expect(targets.defaults.allowedActions).toContain("github.update_issue");
    expect(targets.targets.find((target) => target.title === "evolutionsandbox")?.allowedActions).toContain("vercel.rollback");
    expect(views.collections).toHaveLength(3);
  });

  test("builds phase-7 state and audit summaries", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const nextConfig = {
      ...controlConfig,
      phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
    };
    const summary = buildActuationAuditSummary({
      controlConfig: nextConfig,
      policyConfig: {
        policies: [
          {
            title: "github.create_issue",
            provider: "GitHub",
            executionMode: "Approved Live",
          },
        ],
      },
      targetConfig: parseLocalPortfolioActuationTargetConfig(await readConfig("../config/local-portfolio-actuation-targets.json")),
    });
    expect(nextConfig.phase7Actuation?.rolloutProfile).toBe("github_first_issues_then_comments");
    expect(summary.liveCapablePolicies).toContain("github.create_issue");
  });

  test("resolves GitHub targets, renders payloads, and computes idempotency keys", () => {
    const request = baseRequest({
      payloadTitle: "Investigate blocker",
      payloadBody: "We need to capture the current blocker and next step.",
      targetSourceIds: ["source-1"],
    });
    const source: ExternalSignalSourceRecord = {
      id: "source-1",
      url: "https://notion.so/source-1",
      title: "owner/repo",
      localProjectIds: ["project-1"],
      provider: "GitHub",
      sourceType: "Repo",
      identifier: "owner/repo",
      sourceUrl: "https://github.com/owner/repo",
      status: "Active",
      environment: "N/A",
      syncStrategy: "Poll",
      lastSyncedAt: "2026-03-17",
    };
    const targetConfig = parseLocalPortfolioActuationTargetConfig({
      version: 1,
      strategy: {
        primary: "repo_config",
        fallback: "manual_review",
        notes: [],
      },
      defaults: {
        allowedActions: ["github.create_issue", "github.update_issue"],
        titlePrefix: "[Portfolio]",
        defaultLabels: ["portfolio"],
        supportsIssueCreate: true,
        supportsPrComment: true,
      },
      targets: [],
    });
    const target = resolveActuationTarget({
      request,
      sources: [source],
      targetConfig,
      actionKey: "github.create_issue",
    });
    const payload = buildGitHubExecutionPayload({
      request,
      target,
      actionKey: "github.create_issue",
    });
    const key = computeActuationExecutionKey({
      requestId: request.id,
      actionKey: "github.create_issue",
      targetSourceId: source.id,
      mode: "Live",
      payload,
    });

    expect(payload.title).toContain("[Portfolio]");
    expect(key).toHaveLength(64);
  });

  test("validates actuation views against representative schemas", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const phase7 = ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" });
    const parsedPlan = parseLocalPortfolioActuationViewPlan(
      await readConfig("../config/local-portfolio-actuation-views.json"),
    );
    const plan = {
      ...parsedPlan,
      collections: parsedPlan.collections.map((collection) => ({
        ...collection,
        database:
          collection.key === "actionRequests"
            ? controlConfig.phase6Governance!.actionRequests
            : collection.key === "executions"
              ? phase7.executions
              : controlConfig.phase5ExternalSignals!.sources,
      })),
    };
    const summary = validateLocalPortfolioActuationViewPlanAgainstSchemas({
      plan,
      schemas: {
        actionRequests: {
          id: controlConfig.phase6Governance!.actionRequests.dataSourceId,
          title: "External Action Requests",
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            "Execution Intent": { name: "Execution Intent", type: "select", writable: true },
            "Requested At": { name: "Requested At", type: "date", writable: true },
            "Decided At": { name: "Decided At", type: "date", writable: true },
            Policy: { name: "Policy", type: "relation", writable: true },
            "Target Source": { name: "Target Source", type: "relation", writable: true },
            "Latest Execution": { name: "Latest Execution", type: "relation", writable: true },
            "Latest Execution Status": { name: "Latest Execution Status", type: "select", writable: true },
            "Execution Notes": { name: "Execution Notes", type: "rich_text", writable: true },
          },
        },
        executions: {
          id: phase7.executions.dataSourceId,
          title: phase7.executions.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Mode: { name: "Mode", type: "select", writable: true },
            Status: { name: "Status", type: "select", writable: true },
            "Executed At": { name: "Executed At", type: "date", writable: true },
            "Idempotency Key": { name: "Idempotency Key", type: "rich_text", writable: true },
            "Provider URL": { name: "Provider URL", type: "url", writable: true },
          },
        },
        sources: {
          id: controlConfig.phase5ExternalSignals!.sources.dataSourceId,
          title: controlConfig.phase5ExternalSignals!.sources.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            Provider: { name: "Provider", type: "select", writable: true },
            Status: { name: "Status", type: "select", writable: true },
          },
        },
      },
    });
    expect(summary.validatedViews.length).toBeGreaterThan(0);
  });

  test("evaluates readiness and phase memory through phase eight", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const request = baseRequest({
      payloadTitle: "Investigate blocker",
      payloadBody: "Need follow-up.",
      targetSourceIds: ["source-1"],
      executionIntent: "Ready for Live",
      targetLabels: ["bug"],
    });
    const policy: ActionPolicyRecord = {
      id: "policy-1",
      url: "https://notion.so/policy-1",
      title: "github.create_issue",
      provider: "GitHub",
      mutationClass: "Issue",
      executionMode: "Approved Live",
      identityType: "GitHub App",
      approvalRule: "Single Approval",
      dryRunRequired: true,
      rollbackRequired: false,
      defaultExpiryHours: 72,
      allowedSources: ["Manual"],
      notes: "",
    };
    const notes = evaluateActionRequestReadiness({
      request,
      policies: [policy],
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      actionKey: "github.create_issue",
      today: "2026-03-17",
    });
    expect(notes.length).toBeGreaterThan(0);

    const markdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: "2026-03-17",
      currentPhase: 8,
    });
    expect(markdown).toContain("Phase 7 gave us controlled actuation");
    expect(markdown).toContain("Phase 8 gave us a mature GitHub action lane");
    expect(markdown).toContain("## Phase 9");
  });

  test("builds label and assignee GitHub payloads", () => {
    const target = {
      source: {
        id: "source-1",
        url: "https://notion.so/source-1",
        title: "owner/repo",
        localProjectIds: ["project-1"],
        provider: "GitHub",
        sourceType: "Repo",
        identifier: "owner/repo",
        sourceUrl: "https://github.com/owner/repo",
        status: "Active",
        environment: "N/A",
        syncStrategy: "Poll",
        lastSyncedAt: "2026-03-17",
      },
      rule: {
        title: "owner/repo",
        sourceIdentifier: "owner/repo",
        allowedActions: ["github.set_issue_labels", "github.set_issue_assignees"],
        defaultLabels: [],
        supportsIssueCreate: true,
        supportsPrComment: true,
      },
      provider: "GitHub",
      owner: "owner",
      repo: "repo",
    } satisfies ReturnType<typeof resolveActuationTarget>;

    const labelPayload = buildGitHubExecutionPayload({
      request: baseRequest({ targetNumber: 12, targetLabels: ["bug", "triage"] }),
      target,
      actionKey: "github.set_issue_labels",
    });
    const assigneePayload = buildGitHubExecutionPayload({
      request: baseRequest({ targetNumber: 12, targetAssignees: ["octocat"] }),
      target,
      actionKey: "github.set_issue_assignees",
    });

    expect(labelPayload.labels).toEqual(["bug", "triage"]);
    expect(assigneePayload.assignees).toEqual(["octocat"]);
  });

  test("computes additive-only label and assignee preflight deltas", () => {
    const labelPayload = {
      provider: "GitHub",
      actionKey: "github.set_issue_labels",
      owner: "owner",
      repo: "repo",
      issueNumber: 12,
      labels: ["bug", "triage"],
      assignees: [],
    } satisfies ReturnType<typeof buildGitHubExecutionPayload>;
    const assigneePayload = {
      provider: "GitHub",
      actionKey: "github.set_issue_assignees",
      owner: "owner",
      repo: "repo",
      issueNumber: 12,
      labels: [],
      assignees: ["octocat", "hubot"],
    } satisfies ReturnType<typeof buildGitHubExecutionPayload>;

    const labelPreflight = computeGitHubActionPreflight({
      payload: labelPayload,
      issueSnapshot: {
        issueNumber: 12,
        title: "Issue",
        body: "Body",
        labels: ["bug", "existing"],
        assignees: [],
        isPullRequest: false,
        providerUrl: "https://github.com/owner/repo/issues/12",
      },
    });
    const assigneePreflight = computeGitHubActionPreflight({
      payload: assigneePayload,
      issueSnapshot: {
        issueNumber: 12,
        title: "Issue",
        body: "Body",
        labels: [],
        assignees: ["octocat", "someone-else"],
        isPullRequest: false,
        providerUrl: "https://github.com/owner/repo/issues/12",
      },
      assignableAssignees: ["octocat"],
    });

    expect(labelPreflight.labelsToAdd).toEqual(["triage"]);
    expect(labelPreflight.blockedLabelRemovals).toEqual(["existing"]);
    expect(summarizeGitHubLabelDelta({ payload: labelPayload, preflight: labelPreflight })).toContain("Blocked removals");

    expect(assigneePreflight.assigneesToAdd).toEqual([]);
    expect(assigneePreflight.blockedAssigneeRemovals).toEqual(["someone-else"]);
    expect(assigneePreflight.unassignableAssignees).toEqual(["hubot"]);
    expect(summarizeGitHubAssigneeDelta({ payload: assigneePayload, preflight: assigneePreflight })).toContain(
      "Not assignable",
    );
  });

  test("detects no-op issue updates and keeps them non-blocking", () => {
    const payload = {
      provider: "GitHub",
      actionKey: "github.update_issue",
      owner: "owner",
      repo: "repo",
      issueNumber: 14,
      title: "Same title",
      body: "Same body",
      labels: [],
      assignees: [],
    } satisfies ReturnType<typeof buildGitHubExecutionPayload>;
    const preflight = computeGitHubActionPreflight({
      payload,
      issueSnapshot: {
        issueNumber: 14,
        title: "Same title",
        body: "Same body",
        labels: [],
        assignees: [],
        isPullRequest: false,
        providerUrl: "https://github.com/owner/repo/issues/14",
      },
    });

    expect(preflight.noMaterialChange).toBe(true);
    expect(describeGitHubActionPreflight({ actionKey: "github.update_issue", preflight })[0]).toContain("would skip");
  });

  test("surfaces additive-only blockers in readiness evaluation", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const request = baseRequest({
      payloadTitle: "Issue title",
      payloadBody: "Issue body",
      targetSourceIds: ["source-1"],
      targetNumber: 18,
      executionIntent: "Ready for Live",
      targetAssignees: ["octocat", "hubot"],
    });
    const policy: ActionPolicyRecord = {
      id: "policy-1",
      url: "https://notion.so/policy-1",
      title: "github.set_issue_assignees",
      provider: "GitHub",
      mutationClass: "Issue",
      executionMode: "Approved Live",
      identityType: "GitHub App",
      approvalRule: "Single Approval",
      dryRunRequired: true,
      rollbackRequired: false,
      defaultExpiryHours: 72,
      allowedSources: ["Manual"],
      notes: "",
    };
    const notes = evaluateActionRequestReadiness({
      request,
      policies: [policy],
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      actionKey: "github.set_issue_assignees",
      preflight: {
        issueSnapshot: {
          issueNumber: 18,
          title: "Issue",
          body: "Body",
          labels: [],
          assignees: ["someone-else"],
          isPullRequest: false,
          providerUrl: "https://github.com/owner/repo/issues/18",
        },
        titleWillChange: false,
        bodyWillChange: false,
        labelsToAdd: [],
        blockedLabelRemovals: [],
        assigneesToAdd: ["octocat"],
        blockedAssigneeRemovals: ["someone-else"],
        unassignableAssignees: ["hubot"],
        missingPullRequestPermission: false,
        noMaterialChange: false,
      },
      today: "2026-03-17",
    });

    expect(notes.join(" ")).toContain("cannot remove existing assignees");
    expect(notes.join(" ")).toContain("not assignable");
  });

  test("surfaces missing pull request permission before live PR comments", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const request = baseRequest({
      payloadBody: "Comment body",
      targetSourceIds: ["source-1"],
      targetNumber: 2,
      executionIntent: "Ready for Live",
    });
    const policy: ActionPolicyRecord = {
      id: "policy-1",
      url: "https://notion.so/policy-1",
      title: "github.comment_pull_request",
      provider: "GitHub",
      mutationClass: "Comment",
      executionMode: "Approved Live",
      identityType: "GitHub App",
      approvalRule: "Single Approval",
      dryRunRequired: true,
      rollbackRequired: false,
      defaultExpiryHours: 48,
      allowedSources: ["Manual"],
      notes: "",
    };
    const notes = evaluateActionRequestReadiness({
      request,
      policies: [policy],
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      actionKey: "github.comment_pull_request",
      preflight: {
        issueSnapshot: {
          issueNumber: 2,
          title: "PR title",
          body: "PR body",
          labels: [],
          assignees: [],
          isPullRequest: true,
          providerUrl: "https://github.com/owner/repo/pull/2",
        },
        titleWillChange: false,
        bodyWillChange: false,
        labelsToAdd: [],
        blockedLabelRemovals: [],
        assigneesToAdd: [],
        blockedAssigneeRemovals: [],
        unassignableAssignees: [],
        missingPullRequestPermission: true,
        noMaterialChange: false,
      },
      today: "2026-03-17",
    });

    expect(notes.join(" ")).toContain("missing pull request permission");
  });

  test("requires dual approval and an allowlisted source before live execution", async () => {
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const request = baseRequest({
      executionIntent: "Ready for Live",
      sourceType: "Recommendation",
      approverIds: ["approver-1"],
      targetSourceIds: ["source-1"],
    });
    const policy: ActionPolicyRecord = {
      id: "policy-1",
      url: "https://notion.so/policy-1",
      title: "vercel.redeploy",
      provider: "Vercel",
      mutationClass: "Deployment Control",
      executionMode: "Approved Live",
      identityType: "Team Token",
      approvalRule: "Dual Approval",
      dryRunRequired: true,
      rollbackRequired: false,
      defaultExpiryHours: 24,
      allowedSources: ["Manual"],
      notes: "",
    };
    const notes = evaluateActionRequestReadiness({
      request,
      policies: [policy],
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      actionKey: "vercel.redeploy",
      preflight: {
        providerExercised: true,
        noRedeployCandidate: false,
        targetEnvironment: "Production",
        latestDeployment: {
          deploymentId: "dpl_123",
          deploymentUrl: "https://example.vercel.app",
          projectId: "prj_123",
          readyState: "READY",
          environment: "Production",
          createdAt: "2026-03-17T00:00:00.000Z",
        },
      },
      today: "2026-03-17",
      target: {
        provider: "Vercel",
        source: {
          id: "source-1",
          url: "https://notion.so/source-1",
          title: "premise-debate",
          localProjectIds: ["project-1"],
          provider: "Vercel",
          sourceType: "Deployment Project",
          identifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          status: "Active",
          environment: "Production",
          syncStrategy: "Poll",
          lastSyncedAt: "2026-03-17",
          providerScopeType: "Team",
          providerScopeId: "team_123",
          providerScopeSlug: "team-slug",
        },
        rule: {
          title: "premise-debate",
          provider: "Vercel",
          sourceIdentifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          localProjectId: "project-1",
          allowedActions: ["vercel.redeploy"],
          defaultLabels: [],
          supportsIssueCreate: false,
          supportsPrComment: false,
          vercelProjectId: "prj_123",
          vercelTeamId: "team_123",
          vercelTeamSlug: "team-slug",
          vercelScopeType: "Team",
          vercelEnvironment: "Production",
        },
        projectId: "prj_123",
        projectName: "premise-debate",
        teamId: "team_123",
        teamSlug: "team-slug",
        scopeType: "Team",
        environment: "Production",
      },
    });

    expect(notes.join(" ")).toContain("not allowlisted by policy");
    expect(notes.join(" ")).toContain("Two distinct approvers");
  });

  test("rejects ambiguous Vercel target matches", () => {
    const request = baseRequest({
      title: "Redeploy premise-debate",
      targetSourceIds: ["source-1"],
      localProjectIds: ["project-1"],
    });
    const source: ExternalSignalSourceRecord = {
      id: "source-1",
      url: "https://notion.so/source-1",
      title: "premise-debate",
      localProjectIds: ["project-1"],
      provider: "Vercel",
      sourceType: "Deployment Project",
      identifier: "prj_123",
      sourceUrl: "https://vercel.com/team/premise-debate",
      status: "Active",
      environment: "Production",
      syncStrategy: "Poll",
      lastSyncedAt: "2026-03-17",
      providerScopeType: "Team",
      providerScopeId: "team_123",
      providerScopeSlug: "team-slug",
    };

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
      targets: [
        {
          title: "premise-debate A",
          provider: "Vercel",
          sourceIdentifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          localProjectId: "project-1",
          allowedActions: ["vercel.redeploy"],
          defaultLabels: [],
          supportsIssueCreate: false,
          supportsPrComment: false,
          vercelProjectId: "prj_123",
          vercelTeamId: "team_123",
          vercelTeamSlug: "team-slug",
          vercelScopeType: "Team",
          vercelEnvironment: "Production",
        },
        {
          title: "premise-debate B",
          provider: "Vercel",
          sourceIdentifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          localProjectId: "project-1",
          allowedActions: ["vercel.redeploy"],
          defaultLabels: [],
          supportsIssueCreate: false,
          supportsPrComment: false,
          vercelProjectId: "prj_123",
          vercelTeamId: "team_123",
          vercelTeamSlug: "team-slug",
          vercelScopeType: "Team",
          vercelEnvironment: "Production",
        },
      ],
    });

    expect(() =>
      resolveActuationTarget({
        request,
        sources: [source],
        targetConfig,
        actionKey: "vercel.redeploy",
      }),
    ).toThrow("multiple Vercel allowlist rules");
  });

  test("rejects Vercel preflight deployments that do not match the target project", () => {
    const request = baseRequest({
      title: "Redeploy premise-debate",
    });
    expect(() =>
      buildVercelRedeployExecutionPayload({
        request,
        target: {
          provider: "Vercel",
          source: {
            id: "source-1",
            url: "https://notion.so/source-1",
            title: "premise-debate",
            localProjectIds: ["project-1"],
            provider: "Vercel",
            sourceType: "Deployment Project",
            identifier: "prj_123",
            sourceUrl: "https://vercel.com/team/premise-debate",
            status: "Active",
            environment: "Production",
            syncStrategy: "Poll",
            lastSyncedAt: "2026-03-17",
            providerScopeType: "Team",
            providerScopeId: "team_123",
            providerScopeSlug: "team-slug",
          },
          rule: {
            title: "premise-debate",
            provider: "Vercel",
            sourceIdentifier: "prj_123",
            sourceUrl: "https://vercel.com/team/premise-debate",
            localProjectId: "project-1",
            allowedActions: ["vercel.redeploy"],
            defaultLabels: [],
            supportsIssueCreate: false,
            supportsPrComment: false,
            vercelProjectId: "prj_123",
            vercelTeamId: "team_123",
            vercelTeamSlug: "team-slug",
            vercelScopeType: "Team",
            vercelEnvironment: "Production",
          },
          projectId: "prj_123",
          projectName: "premise-debate",
          teamId: "team_123",
          teamSlug: "team-slug",
          scopeType: "Team",
          environment: "Production",
        },
        preflight: {
          providerExercised: true,
          noRedeployCandidate: false,
          targetEnvironment: "Production",
          latestDeployment: {
            deploymentId: "dpl_123",
            deploymentUrl: "https://example.vercel.app",
            projectId: "prj_other",
            readyState: "READY",
            environment: "Production",
            createdAt: "2026-03-17T00:00:00.000Z",
          },
        },
      }),
    ).toThrow("wrong project");
  });

  test("pins the rollback candidate during dry run and requires the same target for live", async () => {
    process.env.VERCEL_TOKEN = "token";
    const controlConfig = parseLocalPortfolioControlTowerConfig(
      await readConfig("../config/local-portfolio-control-tower.json"),
    );
    const request = baseRequest({
      title: "Rollback evolutionsandbox",
      targetSourceIds: ["source-1"],
      approverIds: ["approver-1"],
    });
    const policy: ActionPolicyRecord = {
      id: "policy-1",
      url: "https://notion.so/policy-1",
      title: "vercel.rollback",
      provider: "Vercel",
      mutationClass: "Deployment Control",
      executionMode: "Approved Live",
      identityType: "Team Token",
      approvalRule: "Single Approval",
      dryRunRequired: true,
      rollbackRequired: false,
      defaultExpiryHours: 12,
      allowedSources: ["Manual"],
      notes: "",
    };
    const target = {
      provider: "Vercel" as const,
      source: {
        id: "source-1",
        url: "https://notion.so/source-1",
        title: "evolutionsandbox",
        localProjectIds: ["project-1"],
        provider: "Vercel" as const,
        sourceType: "Deployment Project" as const,
        identifier: "prj_123",
        sourceUrl: "https://vercel.com/team/evolutionsandbox",
        status: "Active" as const,
        environment: "Production" as const,
        syncStrategy: "Poll" as const,
        lastSyncedAt: "2026-03-17",
        providerScopeType: "Team" as const,
        providerScopeId: "team_123",
        providerScopeSlug: "team-slug",
      },
        rule: {
          title: "evolutionsandbox",
          provider: "Vercel" as const,
        sourceIdentifier: "prj_123",
        sourceUrl: "https://vercel.com/team/evolutionsandbox",
        localProjectId: "project-1",
        allowedActions: ["vercel.redeploy", "vercel.rollback"] as Array<"vercel.redeploy" | "vercel.rollback">,
        defaultLabels: [],
        supportsIssueCreate: false,
        supportsPrComment: false,
        vercelProjectId: "prj_123",
        vercelTeamId: "team_123",
        vercelTeamSlug: "team-slug",
          vercelScopeType: "Team" as const,
          vercelEnvironment: "Production" as const,
        },
      projectId: "prj_123",
      projectName: "evolutionsandbox",
      teamId: "team_123",
      teamSlug: "team-slug",
      scopeType: "Team" as const,
      environment: "Production" as const,
    };
    const preflight = {
      providerExercised: true,
      noRollbackCandidate: false,
      targetEnvironment: "Production" as const,
      currentDeployment: {
        deploymentId: "dpl_current",
        deploymentUrl: "https://current.vercel.app",
        projectId: "prj_123",
        readyState: "READY",
        environment: "Production" as const,
        createdAt: "2026-03-17T02:00:00.000Z",
        aliasAssigned: true,
      },
      rollbackCandidate: {
        deploymentId: "dpl_prev",
        deploymentUrl: "https://previous.vercel.app",
        projectId: "prj_123",
        readyState: "READY",
        environment: "Production" as const,
        createdAt: "2026-03-16T02:00:00.000Z",
        aliasAssigned: false,
      },
    };

    const readiness = computePostDryRunReadiness({
      request,
      policies: [policy],
      target,
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      actionKey: "vercel.rollback",
      executedAt: "2026-03-17T03:00:00.000Z",
      preflightNotes: [],
      preflight,
    });

    expect(readiness.executionIntent).toBe("Ready for Live");
    expect(readiness.providerRequestKey).toBe(formatVercelRollbackRequestKey({ projectId: "prj_123", deploymentId: "dpl_prev" }));

    const liveNotes = evaluateActionRequestReadiness({
      request: {
        ...request,
        executionIntent: "Ready for Live",
        approverIds: ["approver-1"],
        providerRequestKey: readiness.providerRequestKey,
      },
      policies: [policy],
      target,
      config: {
        ...controlConfig,
        phase7Actuation: ensurePhase7ActuationState(controlConfig, { today: "2026-03-17" }),
      },
      latestDryRun: {
        id: "dry-run-1",
        url: "https://notion.so/dry-run-1",
        title: "Fresh dry run",
        actionRequestIds: [request.id],
        localProjectIds: request.localProjectIds,
        policyIds: request.policyIds,
        targetSourceIds: request.targetSourceIds,
        provider: "Vercel",
        actionKey: "vercel.rollback",
        mode: "Dry Run",
        status: "Succeeded",
        idempotencyKey: "dry-run-key",
        executedAt: "2026-03-17T03:00:00.000Z",
        providerResultKey: readiness.providerRequestKey,
        providerUrl: "https://previous.vercel.app",
        issueNumber: 0,
        commentId: "",
        labelDeltaSummary: "",
        assigneeDeltaSummary: "",
        responseClassification: "Success",
        reconcileStatus: "Not Needed",
        responseSummary: "",
        failureNotes: "",
        compensationPlan: "",
      },
      actionKey: "vercel.rollback",
      preflight,
      today: "2026-03-17",
    });

    expect(liveNotes).toEqual([]);
  });

  test("rejects rollback live execution when the pinned candidate drifts", () => {
    const request = baseRequest({
      title: "Rollback evolutionsandbox",
      executionIntent: "Ready for Live",
      providerRequestKey: formatVercelRollbackRequestKey({ projectId: "prj_123", deploymentId: "dpl_old" }),
    });

    expect(() =>
      buildVercelRollbackExecutionPayload({
        request,
        target: {
          provider: "Vercel",
          source: {
            id: "source-1",
            url: "https://notion.so/source-1",
            title: "evolutionsandbox",
            localProjectIds: ["project-1"],
            provider: "Vercel" as const,
            sourceType: "Deployment Project" as const,
            identifier: "prj_123",
            sourceUrl: "https://vercel.com/team/evolutionsandbox",
            status: "Active" as const,
            environment: "Production" as const,
            syncStrategy: "Poll" as const,
            lastSyncedAt: "2026-03-17",
        providerScopeType: "Team" as const,
            providerScopeId: "team_123",
            providerScopeSlug: "team-slug",
          },
          rule: {
            title: "evolutionsandbox",
            provider: "Vercel" as const,
            sourceIdentifier: "prj_123",
            sourceUrl: "https://vercel.com/team/evolutionsandbox",
            localProjectId: "project-1",
            allowedActions: ["vercel.redeploy", "vercel.rollback"] as Array<"vercel.redeploy" | "vercel.rollback">,
            defaultLabels: [],
            supportsIssueCreate: false,
            supportsPrComment: false,
            vercelProjectId: "prj_123",
            vercelTeamId: "team_123",
            vercelTeamSlug: "team-slug",
            vercelScopeType: "Team" as const,
            vercelEnvironment: "Production" as const,
          },
          projectId: "prj_123",
          projectName: "evolutionsandbox",
          teamId: "team_123",
          teamSlug: "team-slug",
          scopeType: "Team",
          environment: "Production",
        },
        preflight: {
          providerExercised: true,
          noRollbackCandidate: false,
          targetEnvironment: "Production",
          currentDeployment: {
            deploymentId: "dpl_current",
            deploymentUrl: "https://current.vercel.app",
            projectId: "prj_123",
            readyState: "READY",
            environment: "Production",
            createdAt: "2026-03-17T02:00:00.000Z",
            aliasAssigned: true,
          },
          rollbackCandidate: {
            deploymentId: "dpl_new",
            deploymentUrl: "https://new.vercel.app",
            projectId: "prj_123",
            readyState: "READY",
            environment: "Production",
            createdAt: "2026-03-16T02:00:00.000Z",
            aliasAssigned: false,
          },
        },
      }),
    ).toThrow("no longer matches the approved dry-run candidate");
  });

  test("rollback preflight prefers the aliased current deployment and explicit rollback candidates", async () => {
    const originalFetch = globalThis.fetch;
    process.env.VERCEL_TOKEN = "token";
    const responses = [
      {
        deployments: [
          {
            id: "dpl_previous",
            projectId: "prj_123",
            url: "previous.vercel.app",
            readyState: "READY",
            target: "production",
            createdAt: "2026-03-17T01:00:00.000Z",
            aliasAssigned: 0,
            readySubstate: "STAGED",
          },
          {
            id: "dpl_current",
            projectId: "prj_123",
            url: "current.vercel.app",
            readyState: "READY",
            target: "production",
            createdAt: "2026-03-16T01:00:00.000Z",
            aliasAssigned: 2,
            readySubstate: "PROMOTED",
          },
        ],
      },
      {
        deployments: [
          {
            id: "dpl_previous",
            projectId: "prj_123",
            url: "previous.vercel.app",
            readyState: "READY",
            target: "production",
            createdAt: "2026-03-17T01:00:00.000Z",
            aliasAssigned: 0,
            isRollbackCandidate: true,
          },
        ],
      },
    ];
    let callIndex = 0;
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responses[callIndex++] ?? responses.at(-1)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const preflight = await fetchVercelRollbackPreflight({
        target: {
          provider: "Vercel",
          source: {
            id: "source-1",
            url: "https://notion.so/source-1",
            title: "evolutionsandbox",
            localProjectIds: ["project-1"],
            provider: "Vercel",
            sourceType: "Deployment Project",
            identifier: "prj_123",
            sourceUrl: "https://vercel.com/team/evolutionsandbox",
            status: "Active",
            environment: "Production",
            syncStrategy: "Poll",
            lastSyncedAt: "2026-03-17",
            providerScopeType: "Team",
            providerScopeId: "team_123",
            providerScopeSlug: "team-slug",
          },
          rule: {
            title: "evolutionsandbox",
            provider: "Vercel",
            sourceIdentifier: "prj_123",
            sourceUrl: "https://vercel.com/team/evolutionsandbox",
            localProjectId: "project-1",
            allowedActions: ["vercel.redeploy", "vercel.rollback"],
            defaultLabels: [],
            supportsIssueCreate: false,
            supportsPrComment: false,
            vercelProjectId: "prj_123",
            vercelTeamId: "team_123",
            vercelTeamSlug: "team-slug",
            vercelScopeType: "Team",
            vercelEnvironment: "Production",
          },
          projectId: "prj_123",
          projectName: "evolutionsandbox",
          teamId: "team_123",
          teamSlug: "team-slug",
          scopeType: "Team",
          environment: "Production",
        },
      });

      expect(preflight?.currentDeployment?.deploymentId).toBe("dpl_current");
      expect(preflight?.rollbackCandidate?.deploymentId).toBe("dpl_previous");
      expect(preflight?.noRollbackCandidate).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("allows personal-scope Vercel targets without team identifiers", () => {
    const request = baseRequest({
      title: "Redeploy solo project",
      targetSourceIds: ["source-1"],
      localProjectIds: ["project-1"],
    });
    const source: ExternalSignalSourceRecord = {
      id: "source-1",
      url: "https://notion.so/source-1",
      title: "solo-project",
      localProjectIds: ["project-1"],
      provider: "Vercel",
      sourceType: "Deployment Project",
      identifier: "prj_personal",
      sourceUrl: "https://vercel.com/solo-project",
      status: "Active",
      environment: "Production",
      syncStrategy: "Poll",
      lastSyncedAt: "2026-03-17",
      providerScopeType: "Personal",
    };
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
      targets: [
        {
          title: "solo-project",
          provider: "Vercel",
          sourceIdentifier: "prj_personal",
          sourceUrl: "https://vercel.com/solo-project",
          localProjectId: "project-1",
          allowedActions: ["vercel.redeploy"],
          defaultLabels: [],
          supportsIssueCreate: false,
          supportsPrComment: false,
          vercelProjectId: "prj_personal",
          vercelScopeType: "Personal",
          vercelEnvironment: "Production",
        },
      ],
    });

    const target = resolveActuationTarget({
      request,
      sources: [source],
      targetConfig,
      actionKey: "vercel.redeploy",
    });
    const payload = buildVercelRedeployExecutionPayload({
      request,
      target,
      preflight: {
        providerExercised: true,
        noRedeployCandidate: false,
        targetEnvironment: "Production",
        latestDeployment: {
          deploymentId: "dpl_123",
          deploymentUrl: "https://solo-project.vercel.app",
          projectId: "prj_personal",
          readyState: "READY",
          environment: "Production",
          createdAt: "2026-03-17T00:00:00.000Z",
        },
      },
    });

    expect(target.scopeType).toBe("Personal");
    expect(target.teamId).toBeUndefined();
    expect(target.teamSlug).toBeUndefined();
    expect(payload.scopeType).toBe("Personal");
    expect(payload.teamId).toBeUndefined();
    expect(payload.teamSlug).toBeUndefined();
  });
});

function baseRequest(overrides: Partial<ActionRequestRecord>): ActionRequestRecord {
  return {
    id: "request-1",
    url: "https://notion.so/request-1",
    title: "Create GitHub issue",
    localProjectIds: ["project-1"],
    policyIds: ["policy-1"],
    targetSourceIds: [],
    status: "Approved",
    sourceType: "Manual",
    recommendationRunIds: [],
    weeklyReviewIds: [],
    requestedByIds: [],
    approverIds: [],
    requestedAt: "2026-03-17",
    decidedAt: "2026-03-17",
    expiresAt: "2026-03-18",
    plannedPayloadSummary: "",
    payloadTitle: "",
    payloadBody: "",
    targetNumber: 0,
    targetLabels: [],
    targetAssignees: [],
    executionIntent: "Dry Run",
    latestExecutionIds: [],
    latestExecutionStatus: "None",
    providerRequestKey: "",
    approvalReason: "",
    executionNotes: "",
    ...overrides,
  };
}

async function readConfig(relativePath: string) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}
