import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
	deriveExternalSignalSyncFailureCategories,
	deriveExternalSignalSyncStatus,
	deriveExternalSignalSyncWarningCategories,
	normalizeProviderName,
	type ProviderSyncResult,
	syncGithubSources,
	syncNotificationHubSources,
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
				providerExercised: false,
			}),
		);
		expect(result[0]?.notes[0]).toContain("Provider not exercised");
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
				providerExercised: true,
			},
			{
				provider: "Vercel",
				status: "Partial",
				itemsSeen: 0,
				itemsWritten: 0,
				itemsDeduped: 0,
				failures: 0,
				notes: [
					"Provider scaffold exists, but live sync is intentionally deferred in the first Phase 5 slice.",
				],
				cursor: "",
				events: [],
				syncedSourceIds: [],
				providerExercised: false,
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
				notes: ["Missing GITHUB_TOKEN for GitHub sync."],
				cursor: "",
				events: [],
				syncedSourceIds: [],
				providerExercised: false,
			},
		];

		expect(deriveExternalSignalSyncStatus(results)).toBe("warning");
		expect(deriveExternalSignalSyncWarningCategories(results)).toEqual([
			"missing_credentials",
		]);
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
				providerExercised: false,
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
				providerExercised: true,
			},
		];

		expect(deriveExternalSignalSyncFailureCategories(results)).toEqual(
			expect.arrayContaining(["validation_error", "provider_error"]),
		);
	});
});

describe("notification hub sync", () => {
	let tmpDir: string;

	afterEach(async () => {
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}
	});

	test("returns empty succeeded when no source rows exist", async () => {
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[],
			10,
			"2026-04-14",
			new Set(),
			[],
		);

		expect(result.status).toBe("Succeeded");
		expect(result.providerExercised).toBe(false);
		expect(result.events).toHaveLength(0);
		expect(result.notes[0]).toContain("no active Notification Hub source row");
	});

	test("fails safely when log file does not exist", async () => {
		process.env["NOTIFICATION_HUB_LOG_PATH"] =
			"/tmp/nh-test-nonexistent-path-12345/events.jsonl";
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.status).toBe("Failed");
		expect(result.failures).toBe(1);
		expect(result.notes[0]).toContain("log not found");
	});

	test("reads JSONL and maps events with matched projects", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const events = [
			{
				source: "cc",
				level: "info",
				title: "Session done",
				body: "Completed auth refactor",
				project: "my-project",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "aaa111",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "info",
			},
			{
				source: "codex",
				level: "urgent",
				title: "Security alert",
				body: "Possible XSS in form handler",
				project: "my-project",
				timestamp: "2026-04-14T11:00:00Z",
				event_id: "bbb222",
				received_at: "2026-04-14T11:00:01Z",
				classified_level: "urgent",
			},
			{
				source: "cc",
				level: "info",
				title: "Orphan event",
				body: "No project assigned",
				project: null,
				timestamp: "2026-04-14T12:00:00Z",
				event_id: "ccc333",
				received_at: "2026-04-14T12:00:01Z",
				classified_level: "info",
			},
		];
		await writeFile(
			logPath,
			events.map((e) => JSON.stringify(e)).join("\n"),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);

		expect(result.status).toBe("Succeeded");
		expect(result.itemsSeen).toBe(3);
		expect(result.events).toHaveLength(2); // ccc333 skipped (null project)
		expect(result.events[0]).toMatchObject({
			provider: "Notification Hub",
			signalType: "Notification",
			severity: "Info",
			localProjectId: "project-abc",
			sourceIdValue: "aaa111",
		});
		expect(result.events[1]).toMatchObject({
			severity: "Risk", // urgent → Risk
			sourceIdValue: "bbb222",
		});
		expect(result.notes[0]).toContain("1 event(s) skipped");
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];
	});

	test("deduplicates events already in eventKeySet", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const event = {
			source: "cc",
			level: "info",
			title: "Dup event",
			body: "Already synced",
			project: "my-project",
			timestamp: "2026-04-14T10:00:00Z",
			event_id: "ddd444",
			received_at: "2026-04-14T10:00:01Z",
			classified_level: "info",
		};
		await writeFile(logPath, JSON.stringify(event), "utf8");

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const existingKey = "notification_hub::ddd444";
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set([existingKey]),
			[{ id: "project-abc", title: "my-project" }],
		);

		expect(result.events).toHaveLength(0);
		expect(result.itemsDeduped).toBe(1);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];
	});

	test("resolves project names case-insensitively and via kebab variants", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const events = [
			{
				source: "cc",
				level: "info",
				title: "E1",
				body: "body",
				project: "Ghost Routes",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "e01",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "info",
			},
			{
				source: "cc",
				level: "info",
				title: "E2",
				body: "body",
				project: "ghost-routes",
				timestamp: "2026-04-14T10:01:00Z",
				event_id: "e02",
				received_at: "2026-04-14T10:01:01Z",
				classified_level: "info",
			},
		];
		await writeFile(
			logPath,
			events.map((e) => JSON.stringify(e)).join("\n"),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-ghost", title: "Ghost Routes" }],
		);

		expect(result.events).toHaveLength(2);
		expect(result.events[0]?.localProjectId).toBe("project-ghost");
		expect(result.events[1]?.localProjectId).toBe("project-ghost");
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];
	});

	test("normalizeProviderName maps Notification Hub to notification_hub key", () => {
		expect(normalizeProviderName("Notification Hub")).toBe("notification_hub");
	});
});

function notificationHubProvider(
	overrides: Partial<ExternalSignalProviderPlan> = {},
): ExternalSignalProviderPlan {
	return {
		key: overrides.key ?? "notification_hub",
		displayName: overrides.displayName ?? "Notification Hub",
		enabled: overrides.enabled ?? true,
		authEnvVar: overrides.authEnvVar ?? "NOTIFICATION_HUB_LOG_PATH",
		baseUrl: overrides.baseUrl ?? "",
		syncStrategy: overrides.syncStrategy ?? "incremental",
		sourceTypes: overrides.sourceTypes ?? ["Event Log"],
		notes: overrides.notes ?? [],
	};
}

function notificationHubSource(
	overrides: Partial<ExternalSignalSourceRecord> = {},
): ExternalSignalSourceRecord {
	return {
		id: overrides.id ?? "nh-source-1",
		url: overrides.url ?? "https://notion.so/nh-source-1",
		title: overrides.title ?? "notification-hub",
		localProjectIds: overrides.localProjectIds ?? [],
		provider: overrides.provider ?? "Notification Hub",
		sourceType: overrides.sourceType ?? "Event Log",
		identifier: overrides.identifier ?? "notification-hub",
		sourceUrl: overrides.sourceUrl ?? "",
		status: overrides.status ?? "Active",
		environment: overrides.environment ?? "N/A",
		syncStrategy: overrides.syncStrategy ?? "Incremental",
		lastSyncedAt: overrides.lastSyncedAt ?? "",
	};
}

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
