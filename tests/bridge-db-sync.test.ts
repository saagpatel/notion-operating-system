import { beforeEach, describe, expect, test, vi } from "vitest";

const bridgeSyncMocks = vi.hoisted(() => {
	const session = {
		getShippedEvents: vi.fn(),
		getPersonalOpsEvents: vi.fn(),
		confirmShippedSync: vi.fn(),
		logActivity: vi.fn(),
		assertSchemaCompatible: vi.fn(),
		close: vi.fn(),
	};
	return {
		session,
		openSession: vi.fn(),
		retrieveDataSource: vi.fn(),
		createPageWithMarkdown: vi.fn(),
		updatePageProperties: vi.fn(),
		queryDataSourcePages: vi.fn(),
		projectPages: [] as Array<{ id: string; title: string }>,
		projectPortfolioPages: [] as Array<{ id: string; title: string }>,
	};
});

vi.mock("../src/cli/context.js", () => ({
	resolveRequiredNotionToken: vi.fn(() => "test-notion-token"),
}));

vi.mock("../src/notion/notion-sdk.js", () => ({
	createNotionSdkClient: vi.fn(() => ({ request: vi.fn() })),
}));

vi.mock("../src/notion/direct-notion-client.js", () => ({
	DirectNotionClient: class {
		retrieveDataSource = bridgeSyncMocks.retrieveDataSource;
		createPageWithMarkdown = bridgeSyncMocks.createPageWithMarkdown;
		updatePageProperties = bridgeSyncMocks.updatePageProperties;
		queryDataSourcePages = bridgeSyncMocks.queryDataSourcePages;
	},
}));

vi.mock("../src/notion/local-portfolio-control-tower.js", () => ({
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH: "test-control-tower.json",
	loadLocalPortfolioControlTowerConfig: vi.fn(async () => ({
		database: { dataSourceId: "projects-ds" },
		relatedDataSources: { buildLogId: "build-log-ds" },
	})),
}));

vi.mock("../src/notion/local-portfolio-control-tower-live.js", () => ({
	fetchAllPages: vi.fn(async (_sdk, dataSourceId: string) => {
		if (dataSourceId === "35e04e4d-bcd8-45c0-b783-238edef210f7") {
			return bridgeSyncMocks.projectPortfolioPages;
		}
		return bridgeSyncMocks.projectPages;
	}),
	relationValue: vi.fn((ids: string[]) => ({
		relation: ids.map((id) => ({ id })),
	})),
}));

vi.mock("../src/notion/local-portfolio-intelligence-live.js", () => ({
	toIntelligenceProjectRecord: vi.fn((page: { id: string; title: string }) => ({
		id: page.id,
		title: page.title,
	})),
}));

vi.mock("../src/notion/bridge-db-mcp-client.js", () => ({
	BridgeDbMcpSession: {
		open: bridgeSyncMocks.openSession,
	},
}));

vi.mock("../src/utils/notification-hub.js", () => ({
	postNotificationHubEvent: vi.fn(),
}));

import {
	assertDataSourceSchemaProperties,
	type BridgeDbRow,
	buildBuildLogSyncKey,
	buildBuildLogTitle,
	buildProjectNameIndex,
	buildTagProperty,
	runBridgeDbSyncCommand,
} from "../src/notion/bridge-db-sync.js";
import { postNotificationHubEvent } from "../src/utils/notification-hub.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRow(overrides: Partial<BridgeDbRow> = {}): BridgeDbRow {
	return {
		id: overrides.id ?? 1,
		source: overrides.source ?? "cc",
		timestamp: overrides.timestamp ?? "2026-04-14T10:00:00Z",
		project_name: overrides.project_name ?? "my-project",
		summary: overrides.summary ?? "Completed the feature.",
		branch: overrides.branch ?? null,
		tags: overrides.tags ?? '["SHIPPED"]',
		canonical_key: overrides.canonical_key,
		notion_sync: overrides.notion_sync,
		policy_disposition: overrides.policy_disposition,
	};
}

function resetBridgeSyncMocks(): void {
	vi.clearAllMocks();
	bridgeSyncMocks.projectPages = [
		{ id: "project-ghost", title: "Ghost Routes" },
		{ id: "project-mcp-audit", title: "MCP Audit" },
		{ id: "project-github-auditor", title: "GitHub Repo Auditor" },
	];
	bridgeSyncMocks.projectPortfolioPages = [
		{ id: "project-machine-audits", title: "Machine Audits" },
		{ id: "project-skill-forge", title: "skill-forge" },
	];
	bridgeSyncMocks.openSession.mockResolvedValue(bridgeSyncMocks.session);
	bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
		baseRow({
			id: 123,
			project_name: "Ghost Routes",
			summary: "Shipped receipt-backed bridge sync.",
			timestamp: "2026-04-14T10:00:00Z",
			source: "cc",
			branch: "main",
			tags: '["SHIPPED"]',
		}),
	]);
	bridgeSyncMocks.session.getPersonalOpsEvents.mockResolvedValue([]);
	bridgeSyncMocks.session.confirmShippedSync.mockResolvedValue(undefined);
	bridgeSyncMocks.session.logActivity.mockResolvedValue(undefined);
	bridgeSyncMocks.session.assertSchemaCompatible.mockResolvedValue(5);
	bridgeSyncMocks.session.close.mockResolvedValue(undefined);
	bridgeSyncMocks.retrieveDataSource.mockImplementation(
		async (dataSourceId: string) => ({
			id: dataSourceId,
			titlePropertyName:
				dataSourceId === "projects-ds" ? "Project Name" : "Name",
			properties:
				dataSourceId === "projects-ds"
					? {
							"Project Name": {
								name: "Project Name",
								type: "title",
								writable: true,
							},
						}
					: dataSourceId === "35e04e4d-bcd8-45c0-b783-238edef210f7"
						? {
								"Project Name": {
									name: "Project Name",
									type: "title",
									writable: true,
								},
							}
						: {
								Name: { name: "Name", type: "title", writable: true },
								"Session Date": {
									name: "Session Date",
									type: "date",
									writable: true,
								},
								"Local Project": {
									name: "Local Project",
									type: "relation",
									writable: true,
								},
								Project: { name: "Project", type: "relation", writable: true },
								Tags: { name: "Tags", type: "multi_select", writable: true },
								"Sync Key": {
									name: "Sync Key",
									type: "rich_text",
									writable: true,
								},
							},
		}),
	);
	bridgeSyncMocks.createPageWithMarkdown.mockResolvedValue({
		id: "build-log-page-123",
	});
	bridgeSyncMocks.updatePageProperties.mockResolvedValue({
		id: "build-log-page-123",
	});
	// No pre-existing Sync Key match by default — every row looks new (P1).
	bridgeSyncMocks.queryDataSourcePages.mockResolvedValue({ results: [] });
}

beforeEach(() => {
	resetBridgeSyncMocks();
});

// Note: readShippedRows is an async MCP-backed function, tested in the
// bridge-db-mcp-client integration tests rather than here.
// Formatting helpers below remain synchronous and are unit-tested here.

// ---------------------------------------------------------------------------
// runBridgeDbSyncCommand — SHIPPED row confirmation ordering
// ---------------------------------------------------------------------------

describe("runBridgeDbSyncCommand receipt-backed shipped rows", () => {
	test("confirms shipped sync only after the single-call Notion create succeeds (P2)", async () => {
		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		// Single-call creation (P2): every property rides the create payload, so a
		// crash can never leave a dateless/relationless page behind.
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				parent: { data_source_id: "build-log-ds" },
				properties: expect.objectContaining({
					"Session Date": { date: { start: "2026-04-14" } },
					"Local Project": { relation: [{ id: "project-ghost" }] },
					Tags: { multi_select: [{ name: "cc" }] },
					"Sync Key": {
						rich_text: [{ text: { content: "bridge:cc:123" } }],
					},
				}),
				markdown: expect.stringContaining(
					"Shipped receipt-backed bridge sync.",
				),
			}),
		);
		expect(bridgeSyncMocks.updatePageProperties).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 123,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] Ghost Routes — 2026-04-14" with Session Date 2026-04-14',
		});

		const createOrder =
			bridgeSyncMocks.createPageWithMarkdown.mock.invocationCallOrder[0];
		const confirmOrder =
			bridgeSyncMocks.session.confirmShippedSync.mock.invocationCallOrder[0];
		expect(createOrder).toBeDefined();
		expect(confirmOrder).toBeDefined();
		expect(createOrder!).toBeLessThan(confirmOrder!);
	});

	test("does not confirm shipped sync when the Notion create fails", async () => {
		bridgeSyncMocks.createPageWithMarkdown.mockRejectedValueOnce(
			new Error("Notion create failed"),
		);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
	});

	test("links known operational aliases to Project Portfolio targets", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 789,
				project_name: "claude-md-lint",
				summary: "Closed Claude Markdown lint checks.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Session Date": { date: { start: "2026-04-14" } },
					Project: { relation: [{ id: "project-machine-audits" }] },
					Tags: { multi_select: [{ name: "cc" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": expect.anything(),
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 789,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] claude-md-lint — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("links operator documentation lanes to Machine Audits", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 794,
				project_name: "operator-os-docs",
				summary: "Published operator OS documentation.",
				source: "codex",
			}),
			baseRow({
				id: 795,
				project_name: "portfolio-docs-agent-contract-lane",
				summary: "Completed portfolio docs agent contract lane.",
				source: "codex",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledTimes(2);
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				properties: expect.objectContaining({
					Project: { relation: [{ id: "project-machine-audits" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				properties: expect.objectContaining({
					Project: { relation: [{ id: "project-machine-audits" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 794,
			caller: "codex",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[Codex] operator-os-docs — 2026-04-14" with Session Date 2026-04-14',
		});
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 795,
			caller: "codex",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[Codex] portfolio-docs-agent-contract-lane — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("prefers bridge-db canonical Notion target over title matching (F1)", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 796,
				project_name: "renamed-project-lane",
				summary: "Shipped through canonical registry routing.",
				source: "codex",
				canonical_key: "Canonical/RenamedProject",
				notion_sync: {
					state: "ready",
					reason: "canonical project has explicit notion_local_page_id",
					canonical_key: "Canonical/RenamedProject",
					notion_page_id: "project-registry-target",
					notion_title: "Renamed Project",
				},
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-registry-target" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 796,
			caller: "codex",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[Codex] renamed-project-lane — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("links compact bridge project names to Local Portfolio projects", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 790,
				project_name: "MCPAudit",
				summary: "Published MCPAudit release.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-mcp-audit" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 790,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] MCPAudit — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("links direct Project Portfolio project names when no Local Portfolio row exists", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 791,
				project_name: "skill-forge",
				summary: "Improved compact-prep skill.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					Project: { relation: [{ id: "project-skill-forge" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 791,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] skill-forge — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("links dependency-security operational rows to GitHub Repo Auditor", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 792,
				project_name: "portfolio-dep-security",
				summary: "Completed dependency security sweep.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-github-auditor" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 792,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] portfolio-dep-security — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("links PortfolioCommandCenter operational rows to GitHub Repo Auditor", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 793,
				project_name: "PortfolioCommandCenter",
				summary: "Completed Portfolio Command Center automation hardening.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-github-auditor" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 793,
			caller: "cc",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] PortfolioCommandCenter — 2026-04-14" with Session Date 2026-04-14',
		});
	});

	test("skips known operational aliases when the target Project Portfolio row is missing", async () => {
		bridgeSyncMocks.projectPortfolioPages = [];
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 789,
				project_name: "claude-md-lint",
				summary: "Closed Claude Markdown lint checks.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
	});

	test("shippedOnly processes shipped rows without reading personal-ops events", async () => {
		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
			shippedOnly: true,
		});

		expect(bridgeSyncMocks.session.getShippedEvents).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.session.getPersonalOpsEvents).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith(
			expect.objectContaining({ activityId: 123 }),
		);
	});

	test("opsOnly processes personal-ops events without reading shipped rows", async () => {
		bridgeSyncMocks.session.getPersonalOpsEvents.mockResolvedValue([
			baseRow({
				id: 456,
				project_name: "Ghost Routes",
				summary: "Personal ops task completed.",
				source: "personal_ops",
				tags: '["TASK_DONE"]',
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
			opsOnly: true,
		});

		expect(bridgeSyncMocks.session.getShippedEvents).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.getPersonalOpsEvents).toHaveBeenCalledOnce();
		// The ops lane writes the Build Log page and stops. Nothing is confirmed
		// back to bridge-db, so the Sync Key on that page is the durable record.
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
	});

	test("rejects conflicting queue filters", async () => {
		await expect(
			runBridgeDbSyncCommand({
				dbPath: "/tmp/test-bridge.db",
				shippedOnly: true,
				opsOnly: true,
			}),
		).rejects.toThrow("--shipped-only and --ops-only cannot be used together.");
	});

	test("aborts before any Notion write when the bridge-db schema is incompatible (F4)", async () => {
		bridgeSyncMocks.session.assertSchemaCompatible.mockRejectedValue(
			new Error(
				"bridge-db schema_version 3 is incompatible: Notion OS requires >= 4.",
			),
		);

		await expect(runBridgeDbSyncCommand({ live: true })).rejects.toThrow(
			/incompatible/,
		);

		// Preflight short-circuits: no rows read, no Notion pages created.
		expect(bridgeSyncMocks.session.getShippedEvents).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
	});

	test("aborts before any Notion write when the Build Log schema drifts", async () => {
		bridgeSyncMocks.retrieveDataSource.mockImplementation(
			async (dataSourceId: string) => ({
				id: dataSourceId,
				titlePropertyName:
					dataSourceId === "projects-ds" ? "Project Name" : "Name",
				properties:
					dataSourceId === "projects-ds" ||
					dataSourceId === "35e04e4d-bcd8-45c0-b783-238edef210f7"
						? {
								"Project Name": {
									name: "Project Name",
									type: "title",
									writable: true,
								},
							}
						: {
								Name: { name: "Name", type: "title", writable: true },
								"Session Date": {
									name: "Session Date",
									type: "rich_text",
									writable: true,
								},
								"Local Project": {
									name: "Local Project",
									type: "relation",
									writable: true,
								},
								Project: { name: "Project", type: "relation", writable: true },
								Tags: { name: "Tags", type: "multi_select", writable: true },
							},
			}),
		);

		await expect(runBridgeDbSyncCommand({ live: true })).rejects.toThrow(
			/Build Log schema drift/,
		);

		expect(bridgeSyncMocks.session.getShippedEvents).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
	});

	test("escalates to warn and reports the unrouted count when a row matches no project (F9)", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 99,
				project_name: "totally-unmatched-xyz",
				tags: '["SHIPPED"]',
			}),
		]);

		await runBridgeDbSyncCommand({ live: false });

		expect(vi.mocked(postNotificationHubEvent)).toHaveBeenCalledWith(
			expect.objectContaining({
				source: "notion-os",
				level: "warn",
				body: expect.stringContaining("1 unrouted"),
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// F1 — canonical-key routing via bridge-db notion_sync
// ---------------------------------------------------------------------------

describe("runBridgeDbSyncCommand canonical notion_sync routing", () => {
	test("routes a SHIPPED row by canonical notion_page_id when notion_sync is ready", async () => {
		// project_name matches NOTHING in the fuzzy indexes — it only resolves via
		// the canonical registry's explicit page id, proving canonical routing.
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 800,
				project_name: "Renamed Local Title That Fuzzy Match Misses",
				summary: "Shipped via canonical key.",
				source: "cc",
				notion_sync: {
					state: "ready",
					reason: "canonical project has explicit notion_local_page_id",
					canonical_key: "incidentmgmt",
					notion_page_id: "canonical-local-page-99",
					notion_title: "IncidentMgmt",
				},
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "canonical-local-page-99" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith(
			expect.objectContaining({ activityId: 800 }),
		);
	});

	test("falls back to fuzzy matching when notion_sync is absent", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 801,
				project_name: "Ghost Routes",
				summary: "Shipped without a canonical block.",
				source: "cc",
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-ghost" }] },
				}),
			}),
		);
	});

	test("falls back to fuzzy matching when notion_sync state is not ready", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 802,
				project_name: "Ghost Routes",
				summary: "Registry present but no page target.",
				source: "cc",
				notion_sync: {
					state: "no_notion_target",
					reason: "canonical project has no notion_local_page_id",
					canonical_key: "ghost-routes",
					notion_page_id: null,
					notion_title: "Ghost Routes",
				},
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-ghost" }] },
				}),
			}),
		);
	});

	test("skips rows with an explicit bridge-db policy disposition before fuzzy matching", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 803,
				project_name: "Ghost Routes",
				summary: "Already classified as no durable target.",
				source: "cc",
				notion_sync: {
					state: "no_notion_target",
					reason: "canonical project has no notion_local_page_id",
					canonical_key: "ghost-routes",
					notion_page_id: null,
					notion_title: "Ghost Routes",
				},
				policy_disposition: {
					disposition_type: "no_durable_target",
					reason: "No safe Notion Build Log target.",
					policy_ref: "bridge-sync Step 4.5",
				},
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.updatePageProperties).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
	});

	test("syncs no-target disposition rows once canonical routing becomes ready", async () => {
		bridgeSyncMocks.session.getShippedEvents.mockResolvedValue([
			baseRow({
				id: 804,
				project_name: "cost-tracker",
				summary: "Registry mapping was repaired after disposition.",
				source: "codex",
				notion_sync: {
					state: "ready",
					reason: "canonical project has explicit notion_local_page_id",
					canonical_key: "saagpatel/cost-tracker",
					notion_page_id: "project-cost-tracker",
					notion_title: "cost-tracker",
				},
				policy_disposition: {
					disposition_type: "no_durable_target",
					reason: "No safe Notion Build Log target before registry repair.",
					policy_ref: "bridge-sync Step 4.5",
				},
			}),
		]);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				properties: expect.objectContaining({
					"Local Project": { relation: [{ id: "project-cost-tracker" }] },
				}),
			}),
		);
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 804,
			caller: "codex",
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[Codex] cost-tracker — 2026-04-14" with Session Date 2026-04-14',
		});
	});
});

// ---------------------------------------------------------------------------
// P1 — idempotency keys and crash-window recovery
// ---------------------------------------------------------------------------

describe("runBridgeDbSyncCommand sync-key idempotency (P1)", () => {
	test("heals the create-succeeded-but-confirm-failed crash window without a duplicate page", async () => {
		// Run 1: the Notion create succeeds but the bridge-db confirmation crashes,
		// leaving the row unprocessed with its page already live.
		bridgeSyncMocks.session.confirmShippedSync.mockRejectedValueOnce(
			new Error("bridge-db locked"),
		);
		const firstRun = await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledOnce();
		expect(firstRun.rowsWritten).toBe(0);
		expect(firstRun.failures).toBe(1);

		// Run 2: the sync-key lookup finds the page created in run 1.
		bridgeSyncMocks.queryDataSourcePages.mockResolvedValue({
			results: [{ id: "build-log-page-123", url: "https://notion.so/page" }],
		});
		const secondRun = await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		// Exactly one create across both runs — no duplicate Build Log page.
		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenLastCalledWith(
			expect.objectContaining({
				activityId: 123,
				caller: "cc",
				downstreamRef: "build-log-page-123",
			}),
		);
		expect(secondRun.rowsRecovered).toBe(1);
		expect(secondRun.rowsWritten).toBe(0);
		expect(secondRun.failures).toBe(0);
	});

	test("queries the Build Log by the row's Sync Key rich_text equals filter", async () => {
		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.queryDataSourcePages).toHaveBeenCalledWith(
			expect.objectContaining({
				dataSourceId: "build-log-ds",
				filter: {
					property: "Sync Key",
					rich_text: { equals: "bridge:cc:123" },
				},
			}),
		);
	});

	test("skips an ops row whose Sync Key already exists, writing nothing back to bridge-db", async () => {
		bridgeSyncMocks.session.getPersonalOpsEvents.mockResolvedValue([
			baseRow({
				id: 456,
				project_name: "Ghost Routes",
				summary: "Personal ops task completed.",
				source: "personal_ops",
				tags: '["TASK_DONE"]',
			}),
		]);
		bridgeSyncMocks.queryDataSourcePages.mockResolvedValue({
			results: [{ id: "existing-ops-page", url: "https://notion.so/ops" }],
		});

		const result = await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
			opsOnly: true,
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
		expect(result.opsRowsRecovered).toBe(1);
		expect(result.opsRowsWritten).toBe(0);
		expect(result.failures).toBe(0);
	});

	test("dry-run reports would-recover vs would-write accurately without mutating anything", async () => {
		bridgeSyncMocks.queryDataSourcePages.mockResolvedValue({
			results: [{ id: "build-log-page-123", url: "https://notion.so/page" }],
		});

		const result = await runBridgeDbSyncCommand({
			live: false,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(result.rowsRecovered).toBe(1);
		expect(result.rowsWritten).toBe(0);
		expect(result.rowsWouldWrite).toBe(0);
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
	});

	test("keeps dry-run would-write counts separate from actual writes", async () => {
		bridgeSyncMocks.queryDataSourcePages.mockResolvedValue({ results: [] });
		const result = await runBridgeDbSyncCommand({
			live: false,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(result.rowsWouldWrite).toBe(1);
		expect(result.rowsWritten).toBe(0);
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
	});

	test("aborts before any Notion write when the Build Log lacks the Sync Key property", async () => {
		// Missing "Sync Key" is the intended deploy gate (P1): the live database must
		// gain the rich_text property before sync may run.
		bridgeSyncMocks.retrieveDataSource.mockImplementation(
			async (dataSourceId: string) => ({
				id: dataSourceId,
				titlePropertyName:
					dataSourceId === "projects-ds" ? "Project Name" : "Name",
				properties:
					dataSourceId === "projects-ds" ||
					dataSourceId === "35e04e4d-bcd8-45c0-b783-238edef210f7"
						? {
								"Project Name": {
									name: "Project Name",
									type: "title",
									writable: true,
								},
							}
						: {
								Name: { name: "Name", type: "title", writable: true },
								"Session Date": {
									name: "Session Date",
									type: "date",
									writable: true,
								},
								"Local Project": {
									name: "Local Project",
									type: "relation",
									writable: true,
								},
								Project: { name: "Project", type: "relation", writable: true },
								Tags: { name: "Tags", type: "multi_select", writable: true },
							},
			}),
		);

		await expect(runBridgeDbSyncCommand({ live: true })).rejects.toThrow(
			/Build Log schema drift blocks bridge-db sync: Sync Key expected rich_text, got missing/,
		);

		expect(bridgeSyncMocks.session.getShippedEvents).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(bridgeSyncMocks.queryDataSourcePages).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// P1 — buildBuildLogSyncKey determinism
// ---------------------------------------------------------------------------

describe("buildBuildLogSyncKey", () => {
	test("derives bridge:{source}:{rowId}", () => {
		expect(buildBuildLogSyncKey(baseRow({ id: 1234, source: "cc" }))).toBe(
			"bridge:cc:1234",
		);
	});

	test("is deterministic for the same row across calls", () => {
		const row = baseRow({ id: 42, source: "codex" });
		expect(buildBuildLogSyncKey(row)).toBe(buildBuildLogSyncKey(baseRow(row)));
	});

	test("distinguishes rows and sources", () => {
		const keys = new Set([
			buildBuildLogSyncKey(baseRow({ id: 1, source: "cc" })),
			buildBuildLogSyncKey(baseRow({ id: 2, source: "cc" })),
			buildBuildLogSyncKey(baseRow({ id: 1, source: "codex" })),
		]);
		expect(keys.size).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// MINOR-5 — buildBuildLogTitle: all source values
// ---------------------------------------------------------------------------

describe("buildBuildLogTitle", () => {
	test("cc source produces CC prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "cc" }));
		expect(title).toContain("[CC]");
	});

	test("codex source produces Codex prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "codex" }));
		expect(title).toContain("[Codex]");
	});

	test("manual source produces Manual prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "manual" }));
		expect(title).toContain("[Manual]");
	});

	test("unknown source uses the raw source value as prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "claude.ai" }));
		expect(title).toContain("[claude.ai]");
	});

	test("includes project name and date in title", () => {
		const title = buildBuildLogTitle(
			baseRow({
				project_name: "Ghost Routes",
				timestamp: "2026-04-14T10:00:00Z",
			}),
		);
		expect(title).toContain("Ghost Routes");
		expect(title).toContain("2026-04-14");
	});
});

// ---------------------------------------------------------------------------
// buildTagProperty — malformed tags JSON
// ---------------------------------------------------------------------------

describe("buildTagProperty", () => {
	test("handles valid tags JSON and filters SHIPPED/PROCESSED", () => {
		const result = buildTagProperty(
			baseRow({ source: "cc", tags: '["SHIPPED","feature","PROCESSED"]' }),
		);
		const names = result.multi_select.map((t) => t.name);
		expect(names).toContain("feature");
		expect(names).not.toContain("SHIPPED");
		expect(names).not.toContain("PROCESSED");
		expect(names).toContain("cc"); // source is appended
	});

	test("does not throw on malformed tags JSON", () => {
		expect(() =>
			buildTagProperty(baseRow({ source: "cc", tags: "not-valid-json{{{" })),
		).not.toThrow();
	});

	test("returns empty multi_select tags (plus source) when tags is empty JSON array", () => {
		const result = buildTagProperty(baseRow({ source: "codex", tags: "[]" }));
		const names = result.multi_select.map((t) => t.name);
		expect(names).toEqual(["codex"]);
	});
});

// ---------------------------------------------------------------------------
// buildProjectNameIndex — name resolution
// ---------------------------------------------------------------------------

describe("buildProjectNameIndex", () => {
	const projects = [
		{ id: "proj-1", title: "Ghost Routes" },
		{ id: "proj-2", title: "Calibrate" },
		{ id: "proj-3", title: "My Cool Project" },
	];

	test("exact match (case-insensitive)", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("ghost routes")).toBe("proj-1");
		expect(index.get("calibrate")).toBe("proj-2");
	});

	test("kebab-case variant matches", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("ghost-routes")).toBe("proj-1");
		expect(index.get("my-cool-project")).toBe("proj-3");
	});

	test("spaces-from-kebab variant matches", () => {
		const index = buildProjectNameIndex(projects);
		// "My Cool Project" lowercased and replace - → space
		expect(index.get("my cool project")).toBe("proj-3");
	});

	test("returns undefined for unmatched names", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("nonexistent-project")).toBeUndefined();
	});

	test("compact punctuation-free variant matches", () => {
		const index = buildProjectNameIndex([
			{ id: "proj-4", title: "MCP Audit" },
			{ id: "proj-5", title: "GitHub Repo Auditor" },
		]);
		expect(index.get("mcpaudit")).toBe("proj-4");
		expect(index.get("githubrepoauditor")).toBe("proj-5");
	});
});

describe("assertDataSourceSchemaProperties", () => {
	test("describes every missing or mismatched schema property", () => {
		expect(() =>
			assertDataSourceSchemaProperties(
				"Build Log",
				{
					titlePropertyName: "Name",
					properties: {
						Name: { type: "title" },
						Tags: { type: "rich_text" },
					},
				},
				[
					{ name: "Name", type: "title" },
					{ name: "Tags", type: "multi_select" },
					{ name: "Session Date", type: "date" },
				],
			),
		).toThrow(
			"Build Log schema drift blocks bridge-db sync: Tags expected multi_select, got rich_text; Session Date expected date, got missing",
		);
	});
});
