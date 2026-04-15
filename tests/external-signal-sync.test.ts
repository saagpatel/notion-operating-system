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
	syncRepoAuditorSources,
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

	// T-3: empty JSONL file
	test("T-3: empty JSONL file returns 0 events without throwing", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");
		await writeFile(logPath, "", "utf8");

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.status).toBe("Succeeded");
		expect(result.events).toHaveLength(0);
		expect(result.itemsSeen).toBe(0);
	});

	// T-4: classified_level absent defaults to Info
	test("T-4: JSONL line missing classified_level defaults to Info severity", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const event = {
			source: "cc",
			level: "info",
			title: "Event without classified_level",
			body: "body text",
			project: "my-project",
			timestamp: "2026-04-14T10:00:00Z",
			event_id: "no-level-111",
			received_at: "2026-04-14T10:00:01Z",
			// classified_level intentionally omitted
		};
		await writeFile(logPath, JSON.stringify(event), "utf8");

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.severity).toBe("Info");
	});

	// T-7: malformed JSON line in JSONL file
	test("T-7: malformed JSON line in JSONL is skipped, valid event is returned", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const validEvent = {
			source: "cc",
			level: "info",
			title: "Valid event",
			body: "body text",
			project: "my-project",
			timestamp: "2026-04-14T10:00:00Z",
			event_id: "valid-001",
			received_at: "2026-04-14T10:00:01Z",
			classified_level: "info",
		};
		const lines = [JSON.stringify(validEvent), "{broken"].join("\n");
		await writeFile(logPath, lines, "utf8");

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		// Calling directly (not via expect wrapper) to capture result and verify no throw
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		// Valid line is returned, broken line is silently skipped, no throw
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.sourceIdValue).toBe("valid-001");
	});

	// T-8: maxEventsPerSource cap is respected
	test("T-8: maxEventsPerSource cap is respected — 3 events, cap at 2", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const events = [
			{
				source: "cc",
				level: "info",
				title: "E1",
				body: "b1",
				project: "my-project",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "cap001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "info",
			},
			{
				source: "cc",
				level: "info",
				title: "E2",
				body: "b2",
				project: "my-project",
				timestamp: "2026-04-14T10:01:00Z",
				event_id: "cap002",
				received_at: "2026-04-14T10:01:01Z",
				classified_level: "info",
			},
			{
				source: "cc",
				level: "info",
				title: "E3",
				body: "b3",
				project: "my-project",
				timestamp: "2026-04-14T10:02:00Z",
				event_id: "cap003",
				received_at: "2026-04-14T10:02:01Z",
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
			2, // maxEventsPerSource = 2
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(2);
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

describe("repo auditor sync", () => {
	let tmpDir: string;

	afterEach(async () => {
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}
		delete process.env["GITHUB_AUDITOR_OUTPUT_DIR"];
	});

	test("returns empty succeeded when no source rows exist", async () => {
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[],
			10,
			"2026-04-14",
			new Set(),
			[],
		);

		expect(result.status).toBe("Succeeded");
		expect(result.providerExercised).toBe(false);
		expect(result.events).toHaveLength(0);
		expect(result.notes[0]).toContain("no active Repo Auditor source row");
	});

	test("fails safely when output directory does not exist", async () => {
		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] =
			"/tmp/ra-test-nonexistent-path-12345";
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[],
		);

		expect(result.status).toBe("Failed");
		expect(result.failures).toBe(1);
		expect(result.notes[0]).toContain("not accessible");
	});

	test("fails safely when output directory has no report files", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[],
		);

		expect(result.status).toBe("Failed");
		expect(result.failures).toBe(1);
		expect(result.notes[0]).toContain("No audit-report-*.json");
	});

	test("reads report and maps grade-based severity", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-10T00:00:00Z",
			audits: [
				{
					metadata: { name: "my-project", full_name: "owner/my-project" },
					grade: "A",
					overall_score: 0.95,
					completeness_tier: "High",
					interest_tier: "High",
					flags: [],
				},
				{
					metadata: { name: "risky-repo", full_name: "owner/risky-repo" },
					grade: "D",
					overall_score: 0.25,
					completeness_tier: "Low",
					interest_tier: "Low",
					flags: ["no_readme", "no_tests"],
				},
				{
					metadata: { name: "orphan-repo", full_name: "owner/orphan-repo" },
					grade: "B",
					overall_score: 0.8,
					flags: [],
				},
			],
		};
		await writeFile(
			join(tmpDir, "audit-report-saagpatel-2026-04-10.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[
				{ id: "proj-a", title: "my-project" },
				{ id: "proj-b", title: "risky-repo" },
			],
		);

		expect(result.status).toBe("Succeeded");
		expect(result.itemsSeen).toBe(3);
		expect(result.events).toHaveLength(2); // orphan-repo unmatched
		expect(result.events[0]).toMatchObject({
			provider: "Repo Auditor",
			signalType: "Audit",
			severity: "Info", // grade A
			localProjectId: "proj-a",
			sourceIdValue: "owner/my-project::2026-04-10",
		});
		expect(result.events[1]).toMatchObject({
			severity: "Risk", // grade D
			localProjectId: "proj-b",
		});
		expect(result.notes[0]).toContain("Report date: 2026-04-10");
		expect(result.notes[1]).toContain("1 audit(s) skipped");
	});

	test("deduplicates events already in eventKeySet", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-10",
			audits: [
				{
					metadata: { name: "my-project", full_name: "owner/my-project" },
					grade: "B",
					overall_score: 0.8,
					flags: [],
				},
			],
		};
		await writeFile(
			join(tmpDir, "audit-report-2026-04-10.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const existingKey = "repo_auditor::owner/my-project::2026-04-10";
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set([existingKey]),
			[{ id: "proj-a", title: "my-project" }],
		);

		expect(result.events).toHaveLength(0);
		expect(result.itemsDeduped).toBe(1);
	});

	test("maps grade C to Watch severity", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-10",
			audits: [
				{
					metadata: { name: "my-project", full_name: "owner/my-project" },
					grade: "C",
					overall_score: 0.55,
					flags: [],
				},
			],
		};
		await writeFile(
			join(tmpDir, "audit-report-2026-04-10.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "proj-a", title: "my-project" }],
		);

		expect(result.events[0]?.severity).toBe("Watch");
	});

	test("normalizeProviderName maps Repo Auditor to repo_auditor key", () => {
		expect(normalizeProviderName("Repo Auditor")).toBe("repo_auditor");
	});

	test("skips audit entry with absent full_name AND name and records malformed counter", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-14",
			audits: [
				{
					metadata: {}, // no full_name, no name
					grade: "A",
					overall_score: 0.95,
					flags: [],
				},
				{
					metadata: { name: "my-project", full_name: "owner/my-project" },
					grade: "B",
					overall_score: 0.8,
					flags: [],
				},
			],
		};
		await writeFile(
			join(tmpDir, "audit-report-2026-04-14.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "proj-a", title: "my-project" }],
		);

		// The malformed entry should be skipped, not included as an event
		const keys = result.events.map((e) => e.sourceIdValue);
		expect(keys.every((k) => k.includes("owner/my-project"))).toBe(true);
		// Note should mention the missing full_name/name
		const malformedNote = result.notes.find((n) =>
			n.includes("missing full_name/name"),
		);
		expect(malformedNote).toBeDefined();
		// No event for the blank-metadata entry
		expect(result.events.every((e) => e.sourceIdValue !== "::2026-04-14")).toBe(
			true,
		);
	});

	test("falls back to results field when audits key is absent", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-14",
			results: [
				{
					metadata: { name: "my-project", full_name: "owner/my-project" },
					grade: "B",
					overall_score: 0.8,
					flags: [],
				},
			],
			// intentionally no `audits` key
		};
		await writeFile(
			join(tmpDir, "audit-report-2026-04-14.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "proj-a", title: "my-project" }],
		);

		expect(result.status).toBe("Succeeded");
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.sourceIdValue).toBe(
			"owner/my-project::2026-04-14",
		);
	});

	test("returns Failed status and does not throw when report file contains invalid JSON", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		await writeFile(
			join(tmpDir, "audit-report-2026-04-14.json"),
			"{not valid json",
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		// Calling directly to capture result; a thrown error would fail the async test automatically
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			10,
			"2026-04-14",
			new Set(),
			[],
		);

		expect(result.status).toBe("Failed");
		expect(result.failures).toBe(1);
	});

	test("maxEventsPerSource cap is respected — 3 audit entries, cap at 2", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-14",
			audits: [
				{
					metadata: { name: "proj-a", full_name: "owner/proj-a" },
					grade: "A",
					overall_score: 0.95,
					flags: [],
				},
				{
					metadata: { name: "proj-b", full_name: "owner/proj-b" },
					grade: "B",
					overall_score: 0.8,
					flags: [],
				},
				{
					metadata: { name: "proj-c", full_name: "owner/proj-c" },
					grade: "C",
					overall_score: 0.55,
					flags: [],
				},
			],
		};
		await writeFile(
			join(tmpDir, "audit-report-2026-04-14.json"),
			JSON.stringify(report),
			"utf8",
		);

		process.env["GITHUB_AUDITOR_OUTPUT_DIR"] = tmpDir;
		const result = await syncRepoAuditorSources(
			repoAuditorProvider(),
			[repoAuditorSource()],
			2, // maxEventsPerSource = 2
			"2026-04-14",
			new Set(),
			[
				{ id: "proj-a", title: "proj-a" },
				{ id: "proj-b", title: "proj-b" },
				{ id: "proj-c", title: "proj-c" },
			],
		);

		expect(result.events.length).toBeLessThanOrEqual(2);
	});
});

function repoAuditorProvider(
	overrides: Partial<ExternalSignalProviderPlan> = {},
): ExternalSignalProviderPlan {
	return {
		key: overrides.key ?? "repo_auditor",
		displayName: overrides.displayName ?? "Repo Auditor",
		enabled: overrides.enabled ?? true,
		authEnvVar: overrides.authEnvVar ?? "GITHUB_AUDITOR_OUTPUT_DIR",
		baseUrl: overrides.baseUrl ?? "",
		syncStrategy: overrides.syncStrategy ?? "incremental",
		sourceTypes: overrides.sourceTypes ?? ["Event Log"],
		notes: overrides.notes ?? [],
	};
}

function repoAuditorSource(
	overrides: Partial<ExternalSignalSourceRecord> = {},
): ExternalSignalSourceRecord {
	return {
		id: overrides.id ?? "ra-source-1",
		url: overrides.url ?? "https://notion.so/ra-source-1",
		title: overrides.title ?? "repo-auditor",
		localProjectIds: overrides.localProjectIds ?? [],
		provider: overrides.provider ?? "Repo Auditor",
		sourceType: overrides.sourceType ?? "Event Log",
		identifier: overrides.identifier ?? "repo-auditor",
		sourceUrl: overrides.sourceUrl ?? "",
		status: overrides.status ?? "Active",
		environment: overrides.environment ?? "N/A",
		syncStrategy: overrides.syncStrategy ?? "Incremental",
		lastSyncedAt: overrides.lastSyncedAt ?? "",
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
