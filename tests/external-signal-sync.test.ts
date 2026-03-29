import { afterEach, describe, expect, test } from "vitest";

import {
  deriveExternalSignalSyncFailureCategories,
  deriveExternalSignalSyncStatus,
  deriveExternalSignalSyncWarningCategories,
  normalizeProviderName,
  type ProviderSyncResult,
  syncGithubSources,
  syncProviders,
} from "../src/notion/external-signal-sync.js";
import type {
  ExternalSignalProviderPlan,
  ExternalSignalSourceRecord,
} from "../src/notion/local-portfolio-external-signals.js";

describe("external signal sync hardening", () => {
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  test("does not silently coerce unknown source providers into github", () => {
    expect(normalizeProviderName("Render" as never)).toBeUndefined();
  });

  test("fails safely when GitHub credentials are missing", async () => {
    process.env = {
      ...previousEnv,
      GITHUB_TOKEN: "",
    };

    const result = await syncGithubSources(
      baseProvider(),
      [baseSource()],
      5,
      "2026-03-29",
      new Set(),
    );

    expect(result.status).toBe("Failed");
    expect(result.failures).toBe(1);
    expect(result.notes[0]).toContain("Missing GITHUB_TOKEN");
  });

  test("treats active sources without a linked project as safe failures", async () => {
    process.env = {
      ...previousEnv,
      GITHUB_TOKEN: "gh-token",
    };

    const result = await syncGithubSources(
      baseProvider(),
      [baseSource({ localProjectIds: [] })],
      5,
      "2026-03-29",
      new Set(),
    );

    expect(result.status).toBe("Failed");
    expect(result.failures).toBe(1);
    expect(result.notes[0]).toContain("missing a linked Local Project");
  });

  test("keeps unsupported source providers out of the GitHub live lane", async () => {
    const result = await syncProviders({
      flags: {
        provider: "github",
        live: false,
      },
      today: "2026-03-29",
      phase5: {
        syncLimits: {
          maxEventsPerSource: 5,
        },
      } as never,
      providers: [baseProvider()],
      sources: [baseSource({ provider: "Render" as never })],
      eventKeySet: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        provider: "GitHub",
        itemsSeen: 0,
        itemsWritten: 0,
        failures: 0,
      }),
    );
    expect(result[0]?.notes[0]).toContain("No active GitHub sources are ready for sync.");
  });

  test("classifies mixed-provider partial success with stable warning categories", () => {
    const results: ProviderSyncResult[] = [
      {
        provider: "GitHub",
        status: "Succeeded",
        itemsSeen: 3,
        itemsWritten: 2,
        itemsDeduped: 1,
        failures: 0,
        notes: [],
        cursor: "",
        events: [],
        syncedSourceIds: ["source-1"],
      },
      {
        provider: "Vercel",
        status: "Partial",
        itemsSeen: 0,
        itemsWritten: 0,
        itemsDeduped: 0,
        failures: 0,
        notes: ["Provider scaffold exists, but live sync is intentionally deferred in the first Phase 5 slice."],
        cursor: "",
        events: [],
        syncedSourceIds: [],
      },
    ];

    expect(deriveExternalSignalSyncStatus(results)).toBe("partial");
    expect(deriveExternalSignalSyncWarningCategories(results)).toEqual(
      expect.arrayContaining(["partial_success", "unsupported_provider"]),
    );
  });

  test("classifies missing provider credentials as a warning", () => {
    const results: ProviderSyncResult[] = [
      {
        provider: "GitHub",
        status: "Failed",
        itemsSeen: 0,
        itemsWritten: 0,
        itemsDeduped: 0,
        failures: 1,
        notes: ["Missing GITHUB_TOKEN for live GitHub sync."],
        cursor: "",
        events: [],
        syncedSourceIds: [],
      },
    ];

    expect(deriveExternalSignalSyncStatus(results)).toBe("warning");
    expect(deriveExternalSignalSyncWarningCategories(results)).toEqual(["missing_credentials"]);
    expect(deriveExternalSignalSyncFailureCategories(results)).toBeUndefined();
  });

  test("classifies provider-shape failures separately from missing credentials", () => {
    const results: ProviderSyncResult[] = [
      {
        provider: "GitHub",
        status: "Failed",
        itemsSeen: 0,
        itemsWritten: 0,
        itemsDeduped: 0,
        failures: 1,
        notes: ["Source owner/repo is missing a linked Local Project."],
        cursor: "",
        events: [],
        syncedSourceIds: [],
      },
      {
        provider: "Vercel",
        status: "Failed",
        itemsSeen: 0,
        itemsWritten: 0,
        itemsDeduped: 0,
        failures: 1,
        notes: ["Unexpected provider failure while loading deployment events."],
        cursor: "",
        events: [],
        syncedSourceIds: [],
      },
    ];

    expect(deriveExternalSignalSyncFailureCategories(results)).toEqual(
      expect.arrayContaining(["validation_error", "provider_error"]),
    );
  });
});

function baseProvider(
  overrides: Partial<ExternalSignalProviderPlan> = {},
): ExternalSignalProviderPlan {
  return {
    key: overrides.key ?? "github",
    displayName: overrides.displayName ?? "GitHub",
    enabled: overrides.enabled ?? true,
    authEnvVar: overrides.authEnvVar ?? "GITHUB_TOKEN",
    baseUrl: overrides.baseUrl ?? "https://api.github.com",
    syncStrategy: overrides.syncStrategy ?? "poll",
    sourceTypes: overrides.sourceTypes ?? ["Repo"],
    notes: overrides.notes ?? [],
  };
}

function baseSource(
  overrides: Partial<ExternalSignalSourceRecord> = {},
): ExternalSignalSourceRecord {
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
    lastSyncedAt: overrides.lastSyncedAt ?? "",
  };
}
