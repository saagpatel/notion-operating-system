import { beforeEach, describe, expect, test, vi } from "vitest";

const bridgeSyncMocks = vi.hoisted(() => {
	const session = {
		getShippedEvents: vi.fn(),
		getPersonalOpsEvents: vi.fn(),
		confirmShippedSync: vi.fn(),
		markProcessed: vi.fn(),
		logActivity: vi.fn(),
		close: vi.fn(),
	};
	return {
		session,
		openSession: vi.fn(),
		retrieveDataSource: vi.fn(),
		createPageWithMarkdown: vi.fn(),
		updatePageProperties: vi.fn(),
		projectPages: [] as Array<{ id: string; title: string }>,
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
	fetchAllPages: vi.fn(async () => bridgeSyncMocks.projectPages),
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
	type BridgeDbRow,
	buildBuildLogTitle,
	buildProjectNameIndex,
	buildTagProperty,
	runBridgeDbSyncCommand,
} from "../src/notion/bridge-db-sync.js";

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
	};
}

function resetBridgeSyncMocks(): void {
	vi.clearAllMocks();
	bridgeSyncMocks.projectPages = [{ id: "project-ghost", title: "Ghost Routes" }];
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
	bridgeSyncMocks.session.markProcessed.mockResolvedValue(undefined);
	bridgeSyncMocks.session.logActivity.mockResolvedValue(undefined);
	bridgeSyncMocks.session.close.mockResolvedValue(undefined);
	bridgeSyncMocks.retrieveDataSource.mockImplementation(async (dataSourceId: string) => ({
		id: dataSourceId,
		titlePropertyName: dataSourceId === "projects-ds" ? "Project Name" : "Name",
	}));
	bridgeSyncMocks.createPageWithMarkdown.mockResolvedValue({
		id: "build-log-page-123",
	});
	bridgeSyncMocks.updatePageProperties.mockResolvedValue({
		id: "build-log-page-123",
	});
}

beforeEach(() => {
	resetBridgeSyncMocks();
});

// Note: readShippedRows and markRowProcessed are now async MCP-backed functions.
// They are tested in bridge-db-mcp-client integration tests, not here.
// Formatting helpers below remain synchronous and are unit-tested here.

// ---------------------------------------------------------------------------
// runBridgeDbSyncCommand — SHIPPED row confirmation ordering
// ---------------------------------------------------------------------------

describe("runBridgeDbSyncCommand receipt-backed shipped rows", () => {
	test("confirms shipped sync only after Notion create and property update succeed", async () => {
		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				parent: { data_source_id: "build-log-ds" },
				markdown: expect.stringContaining("Shipped receipt-backed bridge sync."),
			}),
		);
		expect(bridgeSyncMocks.updatePageProperties).toHaveBeenCalledWith({
			pageId: "build-log-page-123",
			properties: expect.objectContaining({
				"Session Date": { date: { start: "2026-04-14" } },
				"Local Project": { relation: [{ id: "project-ghost" }] },
				Tags: { multi_select: [{ name: "cc" }] },
			}),
		});
		expect(bridgeSyncMocks.session.confirmShippedSync).toHaveBeenCalledWith({
			activityId: 123,
			downstreamRef: "build-log-page-123",
			notes:
				'Created Build Log page "[CC] Ghost Routes — 2026-04-14" with Session Date 2026-04-14',
		});

		const updateOrder =
			bridgeSyncMocks.updatePageProperties.mock.invocationCallOrder[0];
		const confirmOrder =
			bridgeSyncMocks.session.confirmShippedSync.mock.invocationCallOrder[0];
		expect(updateOrder).toBeDefined();
		expect(confirmOrder).toBeDefined();
		expect(updateOrder!).toBeLessThan(confirmOrder!);
	});

	test("does not confirm shipped sync when the Notion update fails", async () => {
		bridgeSyncMocks.updatePageProperties.mockRejectedValueOnce(
			new Error("Notion update failed"),
		);

		await runBridgeDbSyncCommand({
			live: true,
			dbPath: "/tmp/test-bridge.db",
			limit: 5,
			today: "2026-04-14",
		});

		expect(bridgeSyncMocks.createPageWithMarkdown).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.updatePageProperties).toHaveBeenCalledOnce();
		expect(bridgeSyncMocks.session.confirmShippedSync).not.toHaveBeenCalled();
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
});
