import { describe, expect, test } from "vitest";

import {
  buildVercelRolloutReadinessSummary,
  fetchLatestDeploymentProbe,
  parseLocalPortfolioVercelRolloutManifest,
} from "../src/notion/vercel-rollout-readiness.js";

describe("vercel rollout readiness", () => {
  test("parses the rollout manifest", () => {
    const manifest = parseLocalPortfolioVercelRolloutManifest({
      version: 1,
      teamId: "team_123",
      teamSlug: "team-slug",
      projects: [
        {
          localProjectTitle: "Premise",
          localProjectId: "project-1",
          vercelProjectName: "premise-debate",
          vercelProjectId: "prj_123",
          scopeType: "Team",
          environment: "Production",
          rolloutOrder: 1,
          reserve: false,
        },
      ],
    });

    expect(manifest.projects[0]?.vercelProjectId).toBe("prj_123");
  });

  test("surfaces readiness blockers per rollout project", () => {
    const summary = buildVercelRolloutReadinessSummary({
      manifest: {
        version: 1,
        teamId: "team_123",
        teamSlug: "team-slug",
        projects: [
          {
            localProjectTitle: "Premise",
            localProjectId: "project-1",
            vercelProjectName: "premise-debate",
            vercelProjectId: "prj_123",
            scopeType: "Team",
            environment: "Production",
            rolloutOrder: 1,
            reserve: false,
          },
        ],
      },
      existingProjectIds: ["project-1"],
      sourceSeeds: [],
      notionSources: [],
      targetRules: [],
      deploymentProbes: {
        prj_123: {
          providerExercised: false,
          latestDeploymentId: "",
          latestDeploymentUrl: "",
          blockers: ["VERCEL_TOKEN is missing for provider verification."],
        },
      },
    });

    expect(summary.allReady).toBe(false);
    expect(summary.projects[0]?.blockers).toEqual(
      expect.arrayContaining([
        "Repo-owned Vercel source seed is missing.",
        "Active Notion Vercel source row is missing.",
        "Repo-owned Vercel actuation target is missing.",
      ]),
    );
  });

  test("flags duplicated Vercel rollout records instead of treating the first match as healthy", () => {
    const summary = buildVercelRolloutReadinessSummary({
      manifest: {
        version: 1,
        teamId: "team_123",
        teamSlug: "team-slug",
        projects: [
          {
            localProjectTitle: "Premise",
            localProjectId: "project-1",
            vercelProjectName: "premise-debate",
            vercelProjectId: "prj_123",
            scopeType: "Team",
            environment: "Production",
            rolloutOrder: 1,
            reserve: false,
          },
        ],
      },
      existingProjectIds: ["project-1"],
      sourceSeeds: [
        {
          title: "premise-debate - Vercel Deployment Project",
          localProjectId: "project-1",
          provider: "Vercel",
          sourceType: "Deployment Project",
          status: "Active",
          environment: "Production",
          syncStrategy: "Poll",
          identifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          providerScopeType: "Team",
          providerScopeId: "team_123",
          providerScopeSlug: "team-slug",
        },
        {
          title: "premise-debate duplicate - Vercel Deployment Project",
          localProjectId: "project-1",
          provider: "Vercel",
          sourceType: "Deployment Project",
          status: "Active",
          environment: "Production",
          syncStrategy: "Poll",
          identifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          providerScopeType: "Team",
          providerScopeId: "team_123",
          providerScopeSlug: "team-slug",
        },
      ],
      notionSources: [
        {
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
          lastSyncedAt: "2026-04-14",
          providerScopeType: "Team",
          providerScopeId: "team_123",
          providerScopeSlug: "team-slug",
        },
        {
          id: "source-2",
          url: "https://notion.so/source-2",
          title: "premise-debate duplicate",
          localProjectIds: ["project-1"],
          provider: "Vercel",
          sourceType: "Deployment Project",
          identifier: "prj_123",
          sourceUrl: "https://vercel.com/team/premise-debate",
          status: "Active",
          environment: "Production",
          syncStrategy: "Poll",
          lastSyncedAt: "2026-04-14",
          providerScopeType: "Team",
          providerScopeId: "team_123",
          providerScopeSlug: "team-slug",
        },
      ],
      targetRules: [
        {
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
        {
          title: "premise-debate duplicate",
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
      deploymentProbes: {
        prj_123: {
          providerExercised: true,
          latestDeploymentId: "dpl_123",
          latestDeploymentUrl: "https://premise.vercel.app",
          blockers: [],
        },
      },
    });

    expect(summary.projects[0]?.blockers).toEqual(
      expect.arrayContaining([
        "Repo-owned Vercel source seed is duplicated.",
        "Active Notion Vercel source row is duplicated.",
        "Repo-owned Vercel actuation target is duplicated.",
      ]),
    );
    expect(summary.projects[0]?.ready).toBe(false);
  });

  test("treats a non-ready latest deployment as a rollout blocker", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          deployments: [
            {
              id: "dpl_123",
              url: "premise.vercel.app",
              readyState: "BUILDING",
            },
          ],
        }),
      }) as Response;

    try {
      process.env.VERCEL_TOKEN = "token";
      const probe = await fetchLatestDeploymentProbe({
        projectId: "prj_123",
        teamId: "team_123",
        teamSlug: "team-slug",
        environment: "Production",
      });

      expect(probe.providerExercised).toBe(true);
      expect(probe.blockers).toEqual([
        "Latest production deployment is not ready yet (state: BUILDING).",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.VERCEL_TOKEN;
    }
  });
});
