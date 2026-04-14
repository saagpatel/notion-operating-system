import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, test, vi } from "vitest";

import { parseLocalPortfolioActuationTargetConfig } from "../src/notion/local-portfolio-actuation.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import { loadLocalPortfolioExternalSignalProviderConfig } from "../src/notion/local-portfolio-external-signals.js";
import {
  buildProviderExpansionAuditSummary,
  inferActuationTargetProvider,
} from "../src/notion/local-portfolio-provider-expansion.js";
import {
  loadLocalPortfolioGovernancePolicyConfig,
  parseLocalPortfolioWebhookProviderConfig,
} from "../src/notion/local-portfolio-governance.js";

describe("local portfolio provider expansion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("infers GitHub targets from the current actuation config", async () => {
    const targetConfig = parseLocalPortfolioActuationTargetConfig(
      await readConfig("../config/local-portfolio-actuation-targets.json"),
    );
    const firstTarget = targetConfig.targets[0];

    expect(firstTarget).toBeDefined();
    expect(inferActuationTargetProvider(firstTarget!)).toBe("GitHub");
  });

  test("builds a provider expansion audit with Vercel as the next candidate", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-github-token");
    vi.stubEnv("VERCEL_TOKEN", "");

    const [controlConfig, policyConfig, webhookConfig, externalProviderConfig, targetConfig] = await Promise.all([
      readConfig("../config/local-portfolio-control-tower.json").then(parseLocalPortfolioControlTowerConfig),
      loadLocalPortfolioGovernancePolicyConfig(),
      readConfig("../config/local-portfolio-webhook-providers.json").then(parseLocalPortfolioWebhookProviderConfig),
      loadLocalPortfolioExternalSignalProviderConfig(),
      readConfig("../config/local-portfolio-actuation-targets.json").then(parseLocalPortfolioActuationTargetConfig),
    ]);

    const summary = buildProviderExpansionAuditSummary({
      controlConfig,
      policyConfig,
      webhookConfig,
      externalProviderConfig,
      targetConfig,
    });

    const github = summary.providers.find((provider) => provider.provider === "GitHub");
    const vercel = summary.providers.find((provider) => provider.provider === "Vercel");

    expect(summary.githubBaselineTrusted).toBe(true);
    expect(summary.candidateProviders[0]).toBe("Vercel");
    expect(github?.readiness).toBe("ready");
    expect(github?.targetCount).toBeGreaterThan(0);
    expect(vercel?.readiness).toBe("scaffolded");
    expect(vercel?.runnerSupportedActionKeys).toContain("vercel.redeploy");
    expect(vercel?.targetCount).toBeGreaterThan(0);
    expect(vercel?.blockers).toContain("Missing VERCEL_TOKEN for provider sync.");
    expect(vercel?.nextStep).toContain("Set VERCEL_TOKEN");
  });

  test("keeps non-GitHub provider expansion blocked until GitHub is trusted", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-github-token");
    vi.stubEnv("VERCEL_TOKEN", "");

    const [controlConfig, policyConfig, webhookConfig, externalProviderConfig, targetConfig] = await Promise.all([
      readConfig("../config/local-portfolio-control-tower.json").then(parseLocalPortfolioControlTowerConfig),
      loadLocalPortfolioGovernancePolicyConfig(),
      readConfig("../config/local-portfolio-webhook-providers.json").then(parseLocalPortfolioWebhookProviderConfig),
      loadLocalPortfolioExternalSignalProviderConfig(),
      readConfig("../config/local-portfolio-actuation-targets.json").then(parseLocalPortfolioActuationTargetConfig),
    ]);

    const summary = buildProviderExpansionAuditSummary({
      controlConfig: {
        ...controlConfig,
        phase8GithubDeepening: {
          ...controlConfig.phase8GithubDeepening!,
          webhookFeedback: {
            ...controlConfig.phase8GithubDeepening!.webhookFeedback,
            githubStatus: "shadow",
          },
        },
      },
      policyConfig,
      webhookConfig,
      externalProviderConfig,
      targetConfig,
    });

    const vercel = summary.providers.find((provider) => provider.provider === "Vercel");

    expect(summary.githubBaselineTrusted).toBe(false);
    expect(vercel?.blockers).toContain(
      "GitHub is not yet marked as trusted feedback, so provider expansion should stay gated.",
    );
    expect(vercel?.nextStep).toContain("Keep expansion paused");
  });
});

async function readConfig(relativePath: string): Promise<unknown> {
  const file = new URL(relativePath, import.meta.url);
  const text = await readFile(file, "utf8");
  return JSON.parse(text);
}
