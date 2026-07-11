import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
	deriveExternalSignalSyncFailureCategories,
	deriveExternalSignalSyncStatus,
	deriveExternalSignalSyncWarningCategories,
	deriveExternalSignalSyncWritePlan,
	filterProviderResultsAgainstExistingEventKeys,
	isRetryableStoredBriefWriteError,
	normalizeProviderName,
	type ProviderSyncResult,
	selectProjectRefreshBatch,
	syncExternalSignalProjectBrief,
	syncGithubSources,
	syncNotificationHubSources,
	syncProviders,
	syncRepoAuditorSources,
	upsertExternalSignalBriefPage,
	validateExternalSignalSyncOptions,
} from "../src/notion/external-signal-sync.js";
import type {
	ExternalSignalProviderPlan,
	ExternalSignalSourceRecord,
} from "../src/notion/local-portfolio-external-signals.js";
import {
	fetchExistingExternalSignalEventKeys,
	fetchExistingExternalSignalEventsByKey,
	fetchRecentExternalSignalEventPagesByProject,
} from "../src/notion/local-portfolio-external-signals-live.js";
import type { SignalWatermark } from "../src/notion/signal-watermarks.js";
import { AppError } from "../src/utils/errors.js";

describe("external signal sync hardening", () => {
	const previousEnv = process.env;

	afterEach(() => {
		process.env = previousEnv;
	});

	test("does not silently coerce unknown source providers into github", () => {
		expect(normalizeProviderName("Render" as never)).toBeUndefined();
	});

	test("validates scoped project page batch flags", () => {
		expect(() =>
			validateExternalSignalSyncOptions({
				writeScope: "project-pages",
				projectLimit: 10,
				projectOffset: 0,
			}),
		).not.toThrow();
		expect(() =>
			validateExternalSignalSyncOptions({
				writeScope: "full",
				projectLimit: 10,
			}),
		).toThrow(
			"--project-limit and --project-offset require --write-scope project-pages",
		);
		expect(() =>
			validateExternalSignalSyncOptions({
				writeScope: "project-pages",
				projectLimit: 0,
			}),
		).toThrow("--project-limit must be a positive integer");
		expect(() =>
			validateExternalSignalSyncOptions({
				writeScope: "project-pages",
				projectOffset: -1,
			}),
		).toThrow("--project-offset must be a non-negative integer");
	});

	test("selects deterministic project refresh batches by normalized title then id", () => {
		const projects = [
			{ id: "p-3", title: "zeta" },
			{ id: "p-2", title: " Alpha" },
			{ id: "p-1", title: "alpha" },
			{ id: "p-4", title: "Beta" },
		];

		expect(
			selectProjectRefreshBatch({
				projects,
				limit: 2,
				offset: 1,
			}).map((project) => project.id),
		).toEqual(["p-2", "p-4"]);
		expect(
			selectProjectRefreshBatch({ projects }).map((project) => project.id),
		).toEqual(["p-1", "p-2", "p-4", "p-3"]);
	});

	test("does not update a stored external signal brief found outside the target data source", async () => {
		const calls: string[] = [];
		const briefsDataSourceId = "11111111-1111-4111-8111-111111111111";
		const wrongDataSourceId = "22222222-2222-4222-8222-222222222222";
		const api = {
			searchPage: async () => ({
				id: "wrong-parent",
				url: "https://www.notion.so/wrong-parent",
				title: "Project - External Signal Brief - 2026-06-06",
			}),
			retrievePage: async () => ({
				id: "wrong-parent",
				url: "https://www.notion.so/wrong-parent",
				title: "Project - External Signal Brief - 2026-06-06",
				parent: { data_source_id: wrongDataSourceId },
			}),
			updatePageProperties: async (input: { pageId: string }) => {
				calls.push(`update:${input.pageId}`);
			},
			createPageWithMarkdown: async () => {
				calls.push("create");
				return {
					id: "created-brief",
					url: "https://www.notion.so/created-brief",
					title: "Project - External Signal Brief - 2026-06-06",
				};
			},
			patchPageMarkdown: async (input: { pageId: string }) => {
				calls.push(`patch:${input.pageId}`);
			},
		};

		await upsertExternalSignalBriefPage({
			api: api as never,
			dataSourceId: briefsDataSourceId,
			titlePropertyName: "Name",
			title: "Project - External Signal Brief - 2026-06-06",
			properties: {
				Name: {
					title: [
						{
							type: "text",
							text: { content: "Project - External Signal Brief - 2026-06-06" },
						},
					],
				},
			},
			markdown: "External brief",
		});

		expect(calls).toEqual(["create"]);
	});

	test("retries transient stored external signal brief property patches", async () => {
		const calls: string[] = [];
		const briefsDataSourceId = "11111111-1111-4111-8111-111111111111";
		let updateAttempts = 0;
		const api = {
			searchPage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
			}),
			retrievePage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
				parent: { data_source_id: briefsDataSourceId },
			}),
			updatePageProperties: async (input: { pageId: string }) => {
				updateAttempts += 1;
				calls.push(`update:${input.pageId}:${updateAttempts}`);
				if (updateAttempts === 1) {
					throw new AppError(
						"Notion request timed out after 1 attempt(s) for PATCH /pages/existing-brief",
						{
							classification: "timeout_exhausted",
						},
					);
				}
			},
			createPageWithMarkdown: async () => {
				calls.push("create");
				return {
					id: "created-brief",
					url: "https://www.notion.so/created-brief",
					title: "Project - External Signal Brief - 2026-06-06",
				};
			},
			patchPageMarkdown: async (input: { pageId: string }) => {
				calls.push(`patch:${input.pageId}`);
			},
		};

		await upsertExternalSignalBriefPage({
			api: api as never,
			dataSourceId: briefsDataSourceId,
			titlePropertyName: "Name",
			title: "Project - External Signal Brief - 2026-06-06",
			properties: {
				Name: {
					title: [
						{
							type: "text",
							text: { content: "Project - External Signal Brief - 2026-06-06" },
						},
					],
				},
				"Brief Hash": {
					rich_text: [{ type: "text", text: { content: "hash" } }],
				},
			},
			markdown: "External brief",
		});

		expect(calls).toEqual([
			"update:existing-brief:1",
			"update:existing-brief:2",
			"patch:existing-brief",
		]);
	});

	test("falls back to hash properties when stored external signal brief metadata patch is rejected", async () => {
		const calls: string[] = [];
		const briefsDataSourceId = "11111111-1111-4111-8111-111111111111";
		let updateAttempts = 0;
		const api = {
			searchPage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
			}),
			retrievePage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
				parent: { data_source_id: briefsDataSourceId },
			}),
			updatePageProperties: async (input: {
				pageId: string;
				properties: Record<string, unknown>;
			}) => {
				updateAttempts += 1;
				calls.push(
					`update:${input.pageId}:${Object.keys(input.properties).sort().join(",")}`,
				);
				if (updateAttempts === 1) {
					throw new AppError("Notion rejected full metadata patch", {
						status: 400,
					});
				}
			},
			createPageWithMarkdown: async () => {
				calls.push("create");
				return {
					id: "created-brief",
					url: "https://www.notion.so/created-brief",
					title: "Project - External Signal Brief - 2026-06-06",
				};
			},
			patchPageMarkdown: async (input: { pageId: string }) => {
				calls.push(`patch:${input.pageId}`);
			},
		};

		await upsertExternalSignalBriefPage({
			api: api as never,
			dataSourceId: briefsDataSourceId,
			titlePropertyName: "Name",
			title: "Project - External Signal Brief - 2026-06-06",
			properties: {
				Name: {
					title: [
						{
							type: "text",
							text: { content: "Project - External Signal Brief - 2026-06-06" },
						},
					],
				},
				"Brief Date": { date: { start: "2026-06-06" } },
				"Brief Hash": {
					rich_text: [{ type: "text", text: { content: "hash" } }],
				},
				"Storage Version": {
					rich_text: [{ type: "text", text: { content: "v1" } }],
				},
			},
			markdown: "External brief",
		});

		expect(calls).toEqual([
			"update:existing-brief:Brief Date,Brief Hash,Name,Storage Version",
			"update:existing-brief:Brief Hash,Storage Version",
			"patch:existing-brief",
		]);
	});

	test("retries transient stored external signal brief markdown patches", async () => {
		const calls: string[] = [];
		const briefsDataSourceId = "11111111-1111-4111-8111-111111111111";
		let markdownAttempts = 0;
		const api = {
			searchPage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
			}),
			retrievePage: async () => ({
				id: "existing-brief",
				url: "https://www.notion.so/existing-brief",
				title: "Project - External Signal Brief - 2026-06-06",
				parent: { data_source_id: briefsDataSourceId },
			}),
			updatePageProperties: async (input: { pageId: string }) => {
				calls.push(`update:${input.pageId}`);
			},
			createPageWithMarkdown: async () => {
				calls.push("create");
				return {
					id: "created-brief",
					url: "https://www.notion.so/created-brief",
					title: "Project - External Signal Brief - 2026-06-06",
				};
			},
			patchPageMarkdown: async (input: { pageId: string }) => {
				markdownAttempts += 1;
				calls.push(`patch:${input.pageId}:${markdownAttempts}`);
				if (markdownAttempts === 1) {
					throw new AppError(
						"Notion request transport error after 1 attempt(s) for PATCH /pages/existing-brief/markdown",
						{
							classification: "transport_error",
						},
					);
				}
			},
		};

		await upsertExternalSignalBriefPage({
			api: api as never,
			dataSourceId: briefsDataSourceId,
			titlePropertyName: "Name",
			title: "Project - External Signal Brief - 2026-06-06",
			properties: {
				Name: {
					title: [
						{
							type: "text",
							text: { content: "Project - External Signal Brief - 2026-06-06" },
						},
					],
				},
				"Brief Hash": {
					rich_text: [{ type: "text", text: { content: "hash" } }],
				},
			},
			markdown: "External brief",
		});

		expect(calls).toEqual([
			"update:existing-brief",
			"patch:existing-brief:1",
			"patch:existing-brief:2",
		]);
	});

	test("classifies stored brief retryability narrowly", () => {
		expect(
			isRetryableStoredBriefWriteError(
				new AppError(
					"Notion request returned retryable error responses after 1 attempt(s) for PATCH /pages/example",
					{
						classification: "unexpected_response",
					},
				),
			),
		).toBe(true);
		expect(
			isRetryableStoredBriefWriteError(
				new AppError("Notion request failed for PATCH /pages/example", {
					status: 400,
				}),
			),
		).toBe(false);
	});

	test("fetches recent external signal events by project relation with bounded sorted queries", async () => {
		const projectOne = "11111111-1111-4111-8111-111111111111";
		const projectTwo = "22222222-2222-4222-8222-222222222222";
		const eventOne = eventPage(
			"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
			"Event One",
		);
		const eventTwo = eventPage(
			"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
			"Event Two",
		);
		const calls: Array<Record<string, unknown>> = [];
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				calls.push(body);
				const filter = body.filter as
					| { relation?: { contains?: string } }
					| undefined;
				const projectId = filter?.relation?.contains;
				return {
					results: projectId === projectOne ? [eventOne, eventTwo] : [eventTwo],
					has_more: false,
					next_cursor: null,
				};
			},
		};

		const result = await fetchRecentExternalSignalEventPagesByProject({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			projectIds: [projectOne, projectTwo],
			perProjectLimit: 7,
			concurrency: 1,
		});

		expect(result.mode).toBe("project_relation");
		expect(result.pages.map((page) => page.id)).toEqual([
			eventOne.id,
			eventTwo.id,
		]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			page_size: 7,
			filter: { property: "Local Project", relation: { contains: projectOne } },
			sorts: [
				{ property: "Occurred At", direction: "descending" },
				{ property: "Signal Type", direction: "descending" },
				{ property: "Status", direction: "descending" },
				{ property: "Name", direction: "descending" },
			],
		});
	});

	test("falls back to a full event scan when project relation queries fail", async () => {
		const projectOne = "11111111-1111-4111-8111-111111111111";
		const fallbackEvent = eventPage(
			"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
			"Fallback Event",
		);
		const calls: Array<Record<string, unknown>> = [];
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				calls.push(body);
				if (body.filter) {
					throw new Error("relation filter rejected");
				}
				return { results: [fallbackEvent], has_more: false, next_cursor: null };
			},
		};

		const result = await fetchRecentExternalSignalEventPagesByProject({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			projectIds: [projectOne],
		});

		expect(result.mode).toBe("full_scan_fallback");
		expect(result.fallbackError).toContain("relation filter rejected");
		expect(result.pages.map((page) => page.id)).toEqual([fallbackEvent.id]);
		expect(calls).toHaveLength(2);
		expect(calls[1]?.filter).toBeUndefined();
	});

	test("fetches existing external signal event keys with bounded key filters", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				calls.push(body);
				return {
					results: [
						eventPage(
							"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
							"Existing Event",
							"github::workflow::1",
						),
					],
					has_more: false,
					next_cursor: null,
				};
			},
		};

		const result = await fetchExistingExternalSignalEventKeys({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			eventKeys: ["github::workflow::1", "github::workflow::2"],
			batchSize: 50,
			concurrency: 1,
		});

		expect(result.mode).toBe("event_key_filter");
		expect([...result.eventKeys]).toEqual(["github::workflow::1"]);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			page_size: 100,
			filter: {
				or: [
					{
						property: "Event Key",
						rich_text: { equals: "github::workflow::1" },
					},
					{
						property: "Event Key",
						rich_text: { equals: "github::workflow::2" },
					},
				],
			},
		});
	});

	test("falls back to full event scan when event-key filter queries fail", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				calls.push(body);
				if (body.filter) {
					throw new Error("event key filter rejected");
				}
				return {
					results: [
						eventPage(
							"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
							"Existing Event",
							"github::workflow::1",
						),
						eventPage(
							"ffffffff-ffff-4fff-8fff-ffffffffffff",
							"Other Event",
							"github::workflow::old",
						),
					],
					has_more: false,
					next_cursor: null,
				};
			},
		};

		const result = await fetchExistingExternalSignalEventKeys({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			eventKeys: ["github::workflow::1"],
		});

		expect(result.mode).toBe("full_scan_fallback");
		expect(result.fallbackError).toContain("event key filter rejected");
		expect([...result.eventKeys]).toEqual(["github::workflow::1"]);
		// P3 fallback hardening: the batched filter query is retried once
		// before conceding to a full scan, so a persistent failure means two
		// filtered attempts followed by the unfiltered full-scan call.
		expect(calls).toHaveLength(3);
		expect(calls[0]?.filter).toBeDefined();
		expect(calls[1]?.filter).toBeDefined();
		expect(calls[2]?.filter).toBeUndefined();
	});

	test("recovers on the retried attempt without ever reaching the full scan (P3)", async () => {
		const calls: Array<Record<string, unknown>> = [];
		let attempt = 0;
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				calls.push(body);
				attempt += 1;
				if (attempt === 1) {
					throw new Error("transient error");
				}
				return {
					results: [
						eventPage(
							"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
							"Existing Event",
							"github::workflow::1",
						),
					],
					has_more: false,
					next_cursor: null,
				};
			},
		};

		const result = await fetchExistingExternalSignalEventKeys({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			eventKeys: ["github::workflow::1"],
		});

		expect(result.mode).toBe("event_key_filter");
		expect(result.fallbackError).toBeUndefined();
		expect([...result.eventKeys]).toEqual(["github::workflow::1"]);
		expect(calls).toHaveLength(2);
		expect(calls.every((call) => call.filter !== undefined)).toBe(true);
	});

	test("fetchExistingExternalSignalEventsByKey returns page id + status per matched key (P4)", async () => {
		const client = {
			request: async () => ({
				results: [
					eventPage(
						"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
						"Deployment",
						"vercel::deployment::source-1::abc123",
						"BUILDING",
					),
				],
				has_more: false,
				next_cursor: null,
			}),
		};

		const result = await fetchExistingExternalSignalEventsByKey({
			client: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			eventKeys: ["vercel::deployment::source-1::abc123"],
		});

		expect(result.mode).toBe("event_key_filter");
		expect(result.events.get("vercel::deployment::source-1::abc123")).toEqual({
			pageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
			status: "BUILDING",
		});
	});

	test("watermark-covered events skip the Notion dedup query entirely (P3)", async () => {
		let calls = 0;
		const client = {
			request: async () => {
				calls += 1;
				return { results: [], has_more: false, next_cursor: null };
			},
		};
		const watermarks: SignalWatermark[] = [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-10",
			},
		];

		const result = await filterProviderResultsAgainstExistingEventKeys({
			api: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			today: "2026-06-06",
			watermarks,
			providerResults: [
				{
					provider: "GitHub",
					status: "Succeeded",
					itemsSeen: 1,
					itemsWritten: 1,
					itemsDeduped: 0,
					failures: 0,
					notes: [],
					cursor: "2026-06-06",
					events: [
						{
							...normalizedEvent("github::workflow::stale"),
							occurredAt: "2026-06-01", // before the watermark
						},
					],
					syncedSourceIds: ["source-1"],
					providerExercised: true,
				},
			],
		});

		expect(calls).toBe(0);
		expect(result[0]?.events).toHaveLength(0);
		expect(result[0]?.itemsDeduped).toBe(1);
	});

	test("filters provider results against existing Notion event keys before writes", async () => {
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				expect(body.filter).toBeDefined();
				return {
					results: [
						eventPage(
							"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
							"Existing Event",
							"github::workflow::existing",
						),
					],
					has_more: false,
					next_cursor: null,
				};
			},
		};
		const result = await filterProviderResultsAgainstExistingEventKeys({
			api: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			today: "2026-06-06",
			providerResults: [
				{
					provider: "GitHub",
					status: "Succeeded",
					itemsSeen: 2,
					itemsWritten: 2,
					itemsDeduped: 0,
					failures: 0,
					notes: [],
					cursor: "2026-06-06",
					events: [
						normalizedEvent("github::workflow::existing"),
						normalizedEvent("github::workflow::new"),
					],
					syncedSourceIds: ["source-1"],
					providerExercised: true,
				},
			],
		});

		expect(result[0]?.events.map((event) => event.eventKey)).toEqual([
			"github::workflow::new",
		]);
		expect(result[0]?.itemsWritten).toBe(1);
		expect(result[0]?.itemsDeduped).toBe(1);
		expect(result[0]?.notes[0]).toContain("already exists in Notion");
	});

	// -------------------------------------------------------------------------
	// P4 — Vercel dedup-contract fix: identity key (no status) + upsert
	// semantics instead of one row per status transition.
	// -------------------------------------------------------------------------

	test("Vercel identity dedup: an existing deployment with a changed status becomes an update, not a new row (P4)", async () => {
		const client = {
			request: async ({ body }: { body: Record<string, unknown> }) => {
				expect(body.filter).toBeDefined();
				return {
					results: [
						eventPage(
							"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
							"Deployment",
							"vercel::deployment::source-1::abc123",
							"BUILDING",
						),
					],
					has_more: false,
					next_cursor: null,
				};
			},
		};

		const result = await filterProviderResultsAgainstExistingEventKeys({
			api: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			today: "2026-06-06",
			providerResults: [
				{
					provider: "Vercel",
					status: "Succeeded",
					itemsSeen: 1,
					itemsWritten: 1,
					itemsDeduped: 0,
					failures: 0,
					notes: [],
					cursor: "2026-06-06",
					events: [
						vercelIdentityEvent(
							"vercel::deployment::source-1::abc123",
							"READY",
						),
					],
					syncedSourceIds: ["source-1"],
					providerExercised: true,
				},
			],
		});

		expect(result[0]?.events).toHaveLength(0);
		expect(result[0]?.itemsWritten).toBe(0);
		expect(result[0]?.itemsDeduped).toBe(0);
		expect(result[0]?.updates).toHaveLength(1);
		expect(result[0]?.updates?.[0]).toMatchObject({
			pageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
			event: expect.objectContaining({ status: "READY" }),
		});
		expect(result[0]?.notes.at(-1)).toContain("updated: status changed");
	});

	test("Vercel identity dedup: an existing deployment with the same status is a true duplicate, not re-created (P4)", async () => {
		const client = {
			request: async () => ({
				results: [
					eventPage(
						"ffffffff-ffff-4fff-8fff-ffffffffffff",
						"Deployment",
						"vercel::deployment::source-1::abc123",
						"READY",
					),
				],
				has_more: false,
				next_cursor: null,
			}),
		};

		const result = await filterProviderResultsAgainstExistingEventKeys({
			api: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			today: "2026-06-06",
			providerResults: [
				{
					provider: "Vercel",
					status: "Succeeded",
					itemsSeen: 1,
					itemsWritten: 1,
					itemsDeduped: 0,
					failures: 0,
					notes: [],
					cursor: "2026-06-06",
					events: [
						vercelIdentityEvent(
							"vercel::deployment::source-1::abc123",
							"READY",
						),
					],
					syncedSourceIds: ["source-1"],
					providerExercised: true,
				},
			],
		});

		expect(result[0]?.events).toHaveLength(0);
		expect(result[0]?.updates ?? []).toHaveLength(0);
		expect(result[0]?.itemsDeduped).toBe(1);
	});

	test("Vercel identity dedup: distinct deployment uids are kept as distinct rows (P4)", async () => {
		const client = {
			request: async () => ({
				results: [],
				has_more: false,
				next_cursor: null,
			}),
		};

		const result = await filterProviderResultsAgainstExistingEventKeys({
			api: client as never,
			dataSourceId: "33333333-3333-4333-8333-333333333333",
			titlePropertyName: "Name",
			today: "2026-06-06",
			providerResults: [
				{
					provider: "Vercel",
					status: "Succeeded",
					itemsSeen: 2,
					itemsWritten: 2,
					itemsDeduped: 0,
					failures: 0,
					notes: [],
					cursor: "2026-06-06",
					events: [
						vercelIdentityEvent("vercel::deployment::source-1::uid-a", "READY"),
						vercelIdentityEvent("vercel::deployment::source-1::uid-b", "READY"),
					],
					syncedSourceIds: ["source-1"],
					providerExercised: true,
				},
			],
		});

		expect(result[0]?.events.map((event) => event.eventKey)).toEqual([
			"vercel::deployment::source-1::uid-a",
			"vercel::deployment::source-1::uid-b",
		]);
		expect(result[0]?.updates ?? []).toHaveLength(0);
	});

	test("derives scoped write plans without crossing provider/page boundaries", () => {
		expect(
			deriveExternalSignalSyncWritePlan({ writeScope: "project-pages" }),
		).toEqual({
			writeScope: "project-pages",
			shouldRunProviders: false,
			shouldEvaluateProjectPages: true,
			shouldEvaluatePortfolioSections: false,
			shouldPersistMetrics: false,
		});
		expect(
			deriveExternalSignalSyncWritePlan({ writeScope: "portfolio-sections" }),
		).toEqual({
			writeScope: "portfolio-sections",
			shouldRunProviders: false,
			shouldEvaluateProjectPages: false,
			shouldEvaluatePortfolioSections: true,
			shouldPersistMetrics: true,
		});
		expect(
			deriveExternalSignalSyncWritePlan({ writeScope: "providers" }),
		).toEqual({
			writeScope: "providers",
			shouldRunProviders: true,
			shouldEvaluateProjectPages: false,
			shouldEvaluatePortfolioSections: false,
			shouldPersistMetrics: false,
		});
	});

	test("throws when project brief markdown does not converge after write", async () => {
		const markdown =
			"# Project\n\n<!-- codex:notion-recommendation-brief:start -->\nold\n<!-- codex:notion-recommendation-brief:end -->\n\n<!-- codex:notion-external-signal-brief:start -->\nold\n<!-- codex:notion-external-signal-brief:end -->";
		const nextMarkdown = markdown.replaceAll("old", "new");
		const api = {
			patchPageMarkdown: async () => undefined,
			readPageMarkdown: async () => ({
				markdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		await expect(
			syncExternalSignalProjectBrief({
				api: api as never,
				pageId: "page-1",
				projectTitle: "Project One",
				previousMarkdown: markdown,
				nextMarkdown,
			}),
		).rejects.toThrow(
			"External signal project brief did not converge after write",
		);
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
		expect(result.notes[0]).toContain("no project value");
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];
	});

	test("skips notification-hub events whose project cannot be resolved", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		await writeFile(
			logPath,
			JSON.stringify({
				source: "cc",
				level: "normal",
				title: "Unknown project event",
				body: "body",
				project: "unknown-project",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "unknown-001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "normal",
			}),
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
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(0);
		expect(result.notes[0]).toContain("could not be matched");
		expect(result.notes[0]).toContain("unknown-project");
	});

	test("resolves notification-hub events after status-prefix project tags", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		await writeFile(
			logPath,
			JSON.stringify({
				source: "cc",
				level: "normal",
				title: "Merged project",
				body: "body",
				project: "[MERGED] bridge-db",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "prefixed-001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "normal",
			}),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-bridge", title: "bridge-db" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.localProjectId).toBe("project-bridge");
		expect(result.notes).toEqual([]);
	});

	test("ignores operational notification-hub project tags", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const events = [
			{
				source: "cc",
				level: "normal",
				title: "Bridge sync state",
				body: "body",
				project: "[CODEX-STATE][TRUTH-RECONCILED] bridge-baseline-seed",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "operational-001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "normal",
			},
			{
				source: "codex",
				level: "normal",
				title: "Codex finished a turn",
				body: "A Codex turn completed.",
				project: "memories",
				timestamp: "2026-04-14T10:01:00Z",
				event_id: "operational-002",
				received_at: "2026-04-14T10:01:01Z",
				classified_level: "normal",
			},
			{
				source: "codex",
				level: "normal",
				title: "Codex finished a turn",
				body: "A Codex turn completed.",
				project: "d",
				timestamp: "2026-04-14T10:02:00Z",
				event_id: "operational-003",
				received_at: "2026-04-14T10:02:01Z",
				classified_level: "normal",
			},
		];
		await writeFile(
			logPath,
			events.map((event) => JSON.stringify(event)).join("\n"),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(0);
		expect(result.notes[0]).toContain("3 event(s) ignored");
		expect(result.notes[0]).toContain("bridge-baseline-seed");
		expect(result.notes[0]).toContain("memories");
		expect(result.notes[0]).toContain("d");
	});

	test("resolves notification-hub events through existing GitHub source identifiers", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		await writeFile(
			logPath,
			JSON.stringify({
				source: "cc",
				level: "info",
				title: "Repo activity",
				body: "body",
				project: "owner/repo-mapped",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "mapped-001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "info",
			}),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "Different Title" }],
			false,
			[
				baseSource({
					id: "gh-source-1",
					localProjectIds: ["project-abc"],
					identifier: "owner/repo-mapped",
				}),
			],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.localProjectId).toBe("project-abc");
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

	test("resolves known project aliases from local signal producers", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");

		const events = [
			{
				source: "cc",
				level: "info",
				title: "Notion repo activity",
				body: "body",
				project: "Notion",
				timestamp: "2026-04-14T10:00:00Z",
				event_id: "alias-001",
				received_at: "2026-04-14T10:00:01Z",
				classified_level: "info",
			},
			{
				source: "personal-ops",
				level: "info",
				title: "Draft Ready",
				body: "reply needed",
				project: "mail",
				timestamp: "2026-04-14T10:01:00Z",
				event_id: "alias-002",
				received_at: "2026-04-14T10:01:01Z",
				classified_level: "info",
			},
		];
		await writeFile(
			logPath,
			events.map((event) => JSON.stringify(event)).join("\n"),
			"utf8",
		);

		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;
		const result = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[
				{ id: "project-notion", title: "Notion Operating System" },
				{ id: "project-personal-ops", title: "Personal Ops" },
			],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events).toHaveLength(2);
		expect(result.events[0]?.localProjectId).toBe("project-notion");
		expect(result.events[1]?.localProjectId).toBe("project-personal-ops");
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

	// -------------------------------------------------------------------------
	// P3 — durable watermarks: a burst bigger than maxEventsPerSource queues
	// for the next run instead of the old tail-window silently dropping it.
	// -------------------------------------------------------------------------

	function notificationHubEventLine(index: number) {
		return {
			source: "cc",
			level: "info",
			title: `Event ${index}`,
			body: `body ${index}`,
			project: "my-project",
			timestamp: `2026-04-14T10:0${index}:00Z`,
			event_id: `wm${String(index).padStart(3, "0")}`,
			received_at: `2026-04-14T10:0${index}:01Z`,
			classified_level: "info",
		};
	}

	test("a burst of 2x window-size events is fully written across two runs, none dropped (P3)", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");
		const allEvents = [1, 2, 3, 4, 5, 6].map(notificationHubEventLine);
		await writeFile(
			logPath,
			allEvents.map((e) => JSON.stringify(e)).join("\n"),
			"utf8",
		);
		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;

		const maxEventsPerSource = 3;
		const projects = [{ id: "project-abc", title: "my-project" }];

		// Run 1: no watermark yet — behaves like a fresh sync.
		const run1 = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			maxEventsPerSource,
			"2026-04-14",
			new Set(),
			projects,
			false,
			[],
			[],
		);
		expect(run1.events.map((e) => e.sourceIdValue)).toEqual([
			"wm001",
			"wm002",
			"wm003",
		]);
		expect(run1.nextWatermark).toMatchObject({
			provider: "Notification Hub",
			sourceId: "nh-source-1",
			lastEventId: "wm003",
		});

		// Run 2: carries the persisted watermark forward — must pick up
		// exactly the events run 1 didn't reach, not re-deliver run 1's or
		// silently drop the tail.
		const run2 = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			maxEventsPerSource,
			"2026-04-14",
			new Set(),
			projects,
			false,
			[],
			[run1.nextWatermark!],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(run2.events.map((e) => e.sourceIdValue)).toEqual([
			"wm004",
			"wm005",
			"wm006",
		]);

		const allWrittenIds = [...run1.events, ...run2.events].map(
			(e) => e.sourceIdValue,
		);
		expect(allWrittenIds).toEqual([
			"wm001",
			"wm002",
			"wm003",
			"wm004",
			"wm005",
			"wm006",
		]);
	});

	test("an absent watermark behaves identically to pre-P3 sync (backward compatible)", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");
		await writeFile(
			logPath,
			[1, 2]
				.map(notificationHubEventLine)
				.map((e) => JSON.stringify(e))
				.join("\n"),
			"utf8",
		);
		process.env["NOTIFICATION_HUB_LOG_PATH"] = logPath;

		const withoutWatermarksArg = await syncNotificationHubSources(
			notificationHubProvider(),
			[notificationHubSource()],
			10,
			"2026-04-14",
			new Set(),
			[{ id: "project-abc", title: "my-project" }],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(withoutWatermarksArg.events.map((e) => e.sourceIdValue)).toEqual([
			"wm001",
			"wm002",
		]);
	});

	test("a watermark pointing at a rotated-away event id fails open instead of returning nothing forever (P3)", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "nh-test-"));
		const logPath = join(tmpDir, "events.jsonl");
		// Simulates external log rotation: the log no longer contains the
		// event id the watermark points at.
		await writeFile(
			logPath,
			[4, 5]
				.map(notificationHubEventLine)
				.map((e) => JSON.stringify(e))
				.join("\n"),
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
			false,
			[],
			[
				{
					provider: "Notification Hub",
					sourceId: "nh-source-1",
					lastEventId: "wm003",
					lastOccurredAt: "2026-04-14",
				},
			],
		);
		delete process.env["NOTIFICATION_HUB_LOG_PATH"];

		expect(result.events.map((e) => e.sourceIdValue)).toEqual([
			"wm004",
			"wm005",
		]);
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
		expect(result.notes[1]).toContain("owner/orphan-repo");
	});

	test("resolves repo auditor events through existing GitHub source identifiers", async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ra-test-"));
		const report = {
			generated_at: "2026-04-10T00:00:00Z",
			audits: [
				{
					metadata: {
						name: "repo-mapped",
						full_name: "owner/repo-mapped",
					},
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
			[{ id: "project-abc", title: "Different Title" }],
			false,
			[
				baseSource({
					id: "gh-source-1",
					localProjectIds: ["project-abc"],
					identifier: "owner/repo-mapped",
				}),
			],
		);

		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.localProjectId).toBe("project-abc");
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

function eventPage(id: string, title: string, eventKey = "", status?: string) {
	return {
		id,
		url: `https://notion.so/${id.replaceAll("-", "")}`,
		properties: {
			Name: {
				type: "title",
				title: [{ plain_text: title }],
			},
			"Event Key": {
				type: "rich_text",
				rich_text: eventKey ? [{ plain_text: eventKey }] : [],
			},
			...(status !== undefined
				? { Status: { type: "rich_text", rich_text: [{ plain_text: status }] } }
				: {}),
		},
	};
}

function normalizedEvent(eventKey: string) {
	return {
		title: "Workflow run",
		localProjectId: "project-1",
		sourceId: "source-1",
		provider: "GitHub" as const,
		signalType: "Workflow Run" as const,
		occurredAt: "2026-06-06",
		status: "success",
		environment: "N/A" as const,
		severity: "Info" as const,
		sourceIdValue: eventKey,
		sourceUrl: "https://github.com/owner/repo/actions/runs/1",
		eventKey,
		summary: "Workflow run succeeded.",
		rawExcerpt: "status=success",
	};
}

function vercelIdentityEvent(
	eventKey: string,
	status: string,
	overrides: Partial<ReturnType<typeof normalizedEvent>> = {},
) {
	return {
		...normalizedEvent(eventKey),
		provider: "Vercel" as const,
		signalType: "Deployment" as const,
		status,
		summary: `Deployment status is ${status.toLowerCase()} for source-1.`,
		dedupMode: "identity" as const,
		...overrides,
	};
}

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
