import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ProjectSnapshot } from "../src/notion/snapshot-history.js";

// runTrendAnalysisCommand reads the local snapshot file and, with --live,
// patches this week's review page. Notion is stubbed; the snapshot file is
// real, in a temp folder. renderTrendReport itself is covered in
// snapshot-history.test.ts.

const mocks = vi.hoisted(() => ({
	retrieveDataSource: vi.fn(),
	readPageMarkdown: vi.fn(),
	syncSection: vi.fn(),
	fetchAllPages: vi.fn(),
	resolveToken: vi.fn(() => "test-notion-token"),
}));

vi.mock("../src/cli/context.js", () => ({
	resolveRequiredNotionToken: mocks.resolveToken,
}));

vi.mock("../src/notion/direct-notion-client.js", () => ({
	DirectNotionClient: class {
		retrieveDataSource = mocks.retrieveDataSource;
		readPageMarkdown = mocks.readPageMarkdown;
	},
}));

vi.mock("../src/notion/local-portfolio-control-tower.js", () => ({
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH: "test-control-tower.json",
	loadLocalPortfolioControlTowerConfig: vi.fn(async () => ({
		relatedDataSources: { weeklyReviewsId: "weekly-ds" },
	})),
}));

vi.mock("../src/notion/local-portfolio-control-tower-live.js", () => ({
	fetchAllPages: mocks.fetchAllPages,
}));

vi.mock("../src/notion/managed-markdown-sync.js", () => ({
	syncManagedMarkdownSectionWithReadBack: mocks.syncSection,
}));

// Thursday; its week starts Monday 2026-04-13.
const TODAY = "2026-04-16";

function snap(overrides: Partial<ProjectSnapshot>): ProjectSnapshot {
	return {
		snapshotDate: "2026-04-10",
		projectId: "proj-1",
		projectTitle: "Alpha",
		operatingQueue: "Worth Finishing",
		evidenceFreshness: "Fresh",
		recommendationScore: 0,
		buildSessionCount: 2,
		openPrCount: 0,
		...overrides,
	};
}

let tmpDir: string;
let snapshotPath: string;
let logSpy: ReturnType<typeof vi.spyOn>;

// The snapshot path is read when the module loads, so each test loads it fresh.
async function loadCommand() {
	vi.stubEnv("NOTION_OS_SNAPSHOT_PATH", snapshotPath);
	vi.resetModules();
	return import("../src/notion/snapshot-history.js");
}

async function writeSnapshots(snapshots: ProjectSnapshot[]) {
	await writeFile(
		snapshotPath,
		snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n",
		"utf8",
	);
}

function output(): Record<string, unknown> {
	return JSON.parse(String(logSpy.mock.calls[0]![0])) as Record<
		string,
		unknown
	>;
}

function printedReport(): string {
	return String(logSpy.mock.calls[1]![0]).replace(/^\n/, "");
}

beforeEach(async () => {
	vi.clearAllMocks();
	tmpDir = await mkdtemp(path.join(os.tmpdir(), "trend-command-test-"));
	snapshotPath = path.join(tmpDir, "snapshots.jsonl");
	mocks.retrieveDataSource.mockImplementation(async (id: string) => ({
		id,
		titlePropertyName: "Name",
	}));
	mocks.fetchAllPages.mockResolvedValue([
		{ id: "week-old", title: "Week of 2026-04-06" },
		{ id: "week-now", title: "Week of 2026-04-13" },
	]);
	mocks.readPageMarkdown.mockResolvedValue({ markdown: "# Week" });
	mocks.syncSection.mockResolvedValue(undefined);
	logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
	logSpy.mockRestore();
	vi.unstubAllEnvs();
	await rm(tmpDir, { recursive: true, force: true });
});

describe("runTrendAnalysisCommand dry run", () => {
	test("summarises the snapshot file and touches no Notion page", async () => {
		await writeSnapshots([
			snap({ snapshotDate: "2026-04-03", projectId: "proj-1" }),
			snap({ snapshotDate: "2026-04-10", projectId: "proj-1" }),
			snap({
				snapshotDate: "2026-04-10",
				projectId: "proj-2",
				projectTitle: "Beta",
			}),
		]);
		const { runTrendAnalysisCommand, renderTrendReport, readAllSnapshots } =
			await loadCommand();

		await runTrendAnalysisCommand({ today: TODAY });

		expect(output()).toEqual({
			ok: true,
			today: TODAY,
			totalSnapshots: 3,
			trackedProjects: 2,
			firstSnapshot: "2026-04-03",
			lastSnapshot: "2026-04-10",
		});
		expect(printedReport()).toBe(
			renderTrendReport(await readAllSnapshots(), TODAY),
		);
		expect(mocks.resolveToken).not.toHaveBeenCalled();
		expect(mocks.syncSection).not.toHaveBeenCalled();
	});

	test("with no snapshot file yet, reports zero and no dates", async () => {
		const { runTrendAnalysisCommand } = await loadCommand();

		await runTrendAnalysisCommand({ today: TODAY });

		expect(output()).toEqual({
			ok: true,
			today: TODAY,
			totalSnapshots: 0,
			trackedProjects: 0,
		});
	});
});

describe("runTrendAnalysisCommand live", () => {
	test("appends the trend section to this week's page when it has none", async () => {
		await writeSnapshots([snap({})]);
		const { runTrendAnalysisCommand, TREND_REPORT_START, TREND_REPORT_END } =
			await loadCommand();

		await runTrendAnalysisCommand({ today: TODAY, live: true });

		const report = printedReport();
		expect(mocks.resolveToken).toHaveBeenCalledTimes(1);
		expect(mocks.fetchAllPages).toHaveBeenCalledWith(
			expect.anything(),
			"weekly-ds",
			"Name",
		);
		expect(mocks.readPageMarkdown).toHaveBeenCalledWith("week-now");
		expect(mocks.syncSection).toHaveBeenCalledWith(
			expect.objectContaining({
				pageId: "week-now",
				previousMarkdown: "# Week",
				nextMarkdown: `# Week\n\n${TREND_REPORT_START}\n${report}\n${TREND_REPORT_END}`,
				startMarker: TREND_REPORT_START,
				endMarker: TREND_REPORT_END,
				maxAttempts: 2,
			}),
		);
		expect(output()).toMatchObject({
			weeklyPagePatched: true,
			weeklyPageId: "week-now",
		});
	});

	test("replaces an existing trend section and keeps the text around it", async () => {
		await writeSnapshots([snap({})]);
		const { runTrendAnalysisCommand, TREND_REPORT_START, TREND_REPORT_END } =
			await loadCommand();
		mocks.readPageMarkdown.mockResolvedValue({
			markdown: `# Week\n\n${TREND_REPORT_START}\nlast week's trends\n${TREND_REPORT_END}\n\n## Notes`,
		});

		await runTrendAnalysisCommand({ today: TODAY, live: true });

		const { nextMarkdown } = mocks.syncSection.mock.calls[0]![0] as {
			nextMarkdown: string;
		};
		expect(nextMarkdown).toBe(
			`# Week\n\n${TREND_REPORT_START}\n${printedReport()}\n${TREND_REPORT_END}\n\n## Notes`,
		);
		expect(nextMarkdown).not.toContain("last week's trends");
	});

	test("an end marker before the start marker is treated as no section, and a fresh one is appended", async () => {
		await writeSnapshots([snap({})]);
		const { runTrendAnalysisCommand, TREND_REPORT_START, TREND_REPORT_END } =
			await loadCommand();
		const broken = `# Week\n${TREND_REPORT_END}\nstray\n${TREND_REPORT_START}`;
		mocks.readPageMarkdown.mockResolvedValue({ markdown: broken });

		await runTrendAnalysisCommand({ today: TODAY, live: true });

		const { nextMarkdown } = mocks.syncSection.mock.calls[0]![0] as {
			nextMarkdown: string;
		};
		expect(nextMarkdown).toBe(
			`${broken}\n\n${TREND_REPORT_START}\n${printedReport()}\n${TREND_REPORT_END}`,
		);
	});

	test("notes and skips the patch when this week's page does not exist yet", async () => {
		await writeSnapshots([snap({})]);
		mocks.fetchAllPages.mockResolvedValue([
			{ id: "week-old", title: "Week of 2026-04-06" },
		]);
		const { runTrendAnalysisCommand } = await loadCommand();

		await runTrendAnalysisCommand({ today: TODAY, live: true });

		expect(mocks.readPageMarkdown).not.toHaveBeenCalled();
		expect(mocks.syncSection).not.toHaveBeenCalled();
		expect(output()).toMatchObject({
			notes: [
				"No weekly review page found for Week of 2026-04-13 — skipping patch",
			],
		});
		expect(output()).not.toHaveProperty("weeklyPagePatched");
	});
});
