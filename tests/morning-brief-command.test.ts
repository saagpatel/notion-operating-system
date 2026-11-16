import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ExternalSignalEventRecord } from "../src/notion/local-portfolio-external-signals.js";

// runMorningBriefCommand and synthesizeRiskProject reach Notion and the
// Anthropic API; every boundary is stubbed so the whole command runs
// credential-free. The pure renderers are covered in morning-brief.test.ts.

const mocks = vi.hoisted(() => ({
	retrieveDataSource: vi.fn(),
	readPageMarkdown: vi.fn(),
	syncSection: vi.fn(),
	config: {} as Record<string, unknown>,
	pages: {} as Record<string, unknown[]>,
}));

vi.mock("../src/cli/context.js", () => ({
	resolveRequiredNotionToken: vi.fn(() => "test-notion-token"),
}));

vi.mock("../src/notion/notion-sdk.js", () => ({
	createNotionSdkClient: vi.fn(() => ({ request: vi.fn() })),
}));

vi.mock("../src/notion/direct-notion-client.js", () => ({
	DirectNotionClient: class {
		retrieveDataSource = mocks.retrieveDataSource;
		readPageMarkdown = mocks.readPageMarkdown;
	},
}));

vi.mock("../src/notion/local-portfolio-control-tower.js", () => ({
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH: "test-control-tower.json",
	loadLocalPortfolioControlTowerConfig: vi.fn(async () => mocks.config),
}));

vi.mock("../src/notion/local-portfolio-control-tower-live.js", () => ({
	fetchAllPages: vi.fn(
		async (_sdk: unknown, dataSourceId: string) =>
			mocks.pages[dataSourceId] ?? [],
	),
}));

// The fixtures below are already records, so each page-to-record mapper passes them through.
vi.mock("../src/notion/local-portfolio-intelligence-live.js", () => ({
	toIntelligenceProjectRecord: vi.fn((page: unknown) => page),
}));
vi.mock("../src/notion/local-portfolio-external-signals-live.js", () => ({
	toExternalSignalEventRecord: vi.fn((page: unknown) => page),
}));
vi.mock("../src/notion/local-portfolio-execution-live.js", () => ({
	toWorkPacketRecord: vi.fn((page: unknown) => page),
	toExecutionTaskRecord: vi.fn((page: unknown) => page),
}));

vi.mock("../src/notion/managed-markdown-sync.js", () => ({
	syncManagedMarkdownSectionWithReadBack: mocks.syncSection,
}));

import {
	MORNING_BRIEF_END,
	MORNING_BRIEF_START,
	runMorningBriefCommand,
	synthesizeRiskProject,
} from "../src/notion/morning-brief.js";

// Thursday; its week starts Monday 2026-04-13.
const TODAY = "2026-04-16";
const WEEK_TITLE = "Week of 2026-04-13";

let eventId = 0;
function event(
	overrides: Partial<ExternalSignalEventRecord>,
): ExternalSignalEventRecord {
	return {
		id: `event-${++eventId}`,
		url: "",
		title: "CI workflow failed",
		localProjectIds: ["proj-a"],
		sourceIds: [],
		provider: "GitHub",
		signalType: "Workflow Run",
		occurredAt: TODAY,
		status: "failed",
		environment: "N/A",
		severity: "Risk",
		sourceIdValue: "",
		sourceUrl: "",
		syncRunIds: [],
		eventKey: "",
		summary: "",
		rawExcerpt: "",
		...overrides,
	};
}

function packet(overrides: Record<string, unknown>) {
	return {
		id: "packet",
		url: "",
		title: "Packet",
		status: "In Progress",
		packetType: "",
		priority: "Now",
		ownerIds: [],
		localProjectIds: ["proj-a"],
		drivingDecisionIds: [],
		goal: "",
		definitionOfDone: "",
		whyNow: "",
		targetStart: "",
		targetFinish: "",
		estimatedSize: "",
		rolloverCount: 0,
		executionTaskIds: [],
		buildLogSessionIds: [],
		weeklyReviewIds: [],
		blockerSummary: "",
		...overrides,
	};
}

function task(overrides: Record<string, unknown>) {
	return {
		id: "task",
		url: "",
		title: "Task",
		status: "Not Started",
		assigneeIds: [],
		dueDate: "",
		priority: "",
		taskType: "",
		workPacketIds: ["packet-now"],
		localProjectIds: [],
		estimate: "",
		completedOn: "",
		taskNotes: "",
		...overrides,
	};
}

function withPhase2(on: boolean) {
	mocks.config = {
		database: { dataSourceId: "projects-ds" },
		relatedDataSources: { weeklyReviewsId: "weekly-ds" },
		phase5ExternalSignals: { events: { dataSourceId: "events-ds" } },
		...(on
			? {
					phase2Execution: {
						packets: { dataSourceId: "packets-ds" },
						tasks: { dataSourceId: "tasks-ds" },
					},
				}
			: {}),
	};
}

function seed() {
	withPhase2(true);
	mocks.pages = {
		"projects-ds": [
			{ id: "proj-a", title: "Alpha", currentState: "Active" },
			{ id: "proj-b", title: "Beta", currentState: "Active" },
			// No signal in a week: a coverage gap.
			{ id: "proj-c", title: "Gamma", currentState: "Active" },
			// Parked projects never count as gaps.
			{ id: "proj-d", title: "Delta", currentState: "Parked" },
		],
		"weekly-ds": [
			{ id: "week-old", title: "Week of 2026-04-06" },
			{ id: "week-now", title: WEEK_TITLE },
		],
		"events-ds": [
			event({ severity: "Risk", localProjectIds: ["proj-a"] }),
			event({
				severity: "Watch",
				localProjectIds: ["proj-b"],
				occurredAt: "2026-04-15",
			}),
			// Outside the one-day lookback, but inside the seven-day coverage window.
			event({
				severity: "Info",
				localProjectIds: ["proj-a"],
				occurredAt: "2026-04-12",
			}),
		],
		"packets-ds": [
			// A closed Now packet is passed over for the open one.
			packet({ id: "packet-done", title: "Old packet", status: "Done" }),
			packet({
				id: "packet-now",
				title: "Ship the brief",
				targetFinish: "2026-04-20",
			}),
		],
		"tasks-ds": [
			task({ id: "t-late", title: "Write docs", dueDate: "2026-04-20" }),
			task({ id: "t-early", title: "Fix CI", dueDate: "2026-04-17" }),
			// Closed tasks never become the next step, however early.
			task({
				id: "t-closed",
				title: "Already done",
				dueDate: "2026-04-10",
				status: "Done",
			}),
		],
	};
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function printedOutput(): Record<string, unknown> {
	const call = logSpy.mock.calls.at(-1);
	expect(call).toBeDefined();
	return JSON.parse(String(call![0])) as Record<string, unknown>;
}

beforeEach(() => {
	vi.clearAllMocks();
	eventId = 0;
	seed();
	mocks.retrieveDataSource.mockImplementation(async (id: string) => ({
		id,
		titlePropertyName: "Name",
	}));
	mocks.readPageMarkdown.mockResolvedValue({ markdown: "# Week" });
	mocks.syncSection.mockResolvedValue(undefined);
	logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	logSpy.mockRestore();
	errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// synthesizeRiskProject
// ---------------------------------------------------------------------------

describe("synthesizeRiskProject", () => {
	test("returns the first text block and sends a short Haiku request", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				content: [
					{ type: "tool_use", id: "x" },
					{ type: "text", text: "CI is red; rerun the workflow." },
				],
			}),
		}));
		vi.stubGlobal("fetch", fetchMock);

		const result = await synthesizeRiskProject(
			"Alpha",
			"CI workflow failed",
			"test-key",
		);

		expect(result).toEqual({
			projectName: "Alpha",
			synthesis: "CI is red; rerun the workflow.",
		});
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{ headers: Record<string, string>; body: string },
		];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		expect(init.headers["x-api-key"]).toBe("test-key");
		const body = JSON.parse(init.body) as {
			max_tokens: number;
			messages: Array<{ content: string }>;
		};
		expect(body.max_tokens).toBe(150);
		expect(body.messages[0]?.content).toContain("Project: Alpha");
		expect(body.messages[0]?.content).toContain("Signals: CI workflow failed");
	});

	test("reports an HTTP error with its status and a capped body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: false,
				status: 529,
				text: async () => `overloaded ${"x".repeat(500)}`,
			})),
		);

		const result = await synthesizeRiskProject("Alpha", "s", "k");

		expect(result.synthesis).toBeUndefined();
		expect(result.error).toMatch(/^API error 529: overloaded x+$/);
		expect(result.error!.length).toBe("API error 529: ".length + 200);
	});

	test("reports a response with no text block as an unexpected shape", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ content: [{ type: "tool_use" }] }),
			})),
		);

		const result = await synthesizeRiskProject("Alpha", "s", "k");

		expect(result).toEqual({
			projectName: "Alpha",
			synthesis: undefined,
			error: "Unexpected API response shape",
		});
	});

	test("turns a network failure into an error result instead of throwing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("socket hang up");
			}),
		);

		const result = await synthesizeRiskProject("Alpha", "s", "k");

		expect(result).toEqual({
			projectName: "Alpha",
			synthesis: undefined,
			error: "socket hang up",
		});
	});
});

// ---------------------------------------------------------------------------
// runMorningBriefCommand
// ---------------------------------------------------------------------------

describe("runMorningBriefCommand dry run", () => {
	test("counts the lookback window and coverage gaps, and writes nothing", async () => {
		await runMorningBriefCommand({ today: TODAY });

		const output = printedOutput();
		expect(output).toMatchObject({
			ok: true,
			live: false,
			today: TODAY,
			lookbackDays: 1,
			totalEvents: 2,
			riskCount: 1,
			watchCount: 1,
			infoCount: 0,
			coverageGaps: 1,
			weeklyPageFound: true,
			synthesized: false,
		});
		expect(mocks.readPageMarkdown).not.toHaveBeenCalled();
		expect(mocks.syncSection).not.toHaveBeenCalled();
	});

	test("a wider lookback takes in older events", async () => {
		await runMorningBriefCommand({ today: TODAY, lookbackDays: 7 });

		expect(printedOutput()).toMatchObject({ totalEvents: 3, infoCount: 1 });
	});

	test("operator focus names the open Now packet and its earliest open task", async () => {
		await runMorningBriefCommand({ today: TODAY });

		const section = String(printedOutput().section);
		expect(section).toContain(
			"- **Now** — Ship the brief (Alpha; status In Progress; target finish 2026-04-20). Next: Fix CI",
		);
		expect(section).not.toContain("Old packet");
		expect(section).not.toContain("Already done");
	});

	test("without phase-two execution config, packets and tasks are never read", async () => {
		withPhase2(false);

		await runMorningBriefCommand({ today: TODAY });

		expect(mocks.retrieveDataSource.mock.calls.map((c) => c[0])).toEqual([
			"projects-ds",
			"weekly-ds",
			"events-ds",
		]);
		expect(String(printedOutput().section)).not.toContain("Ship the brief");
	});

	test("fails clearly when the config has no external-signal settings", async () => {
		delete mocks.config.phase5ExternalSignals;

		await expect(runMorningBriefCommand({ today: TODAY })).rejects.toThrow(
			"Control tower config is missing phase5ExternalSignals",
		);
	});
});

describe("runMorningBriefCommand live", () => {
	test("appends the managed section to this week's page when it has none", async () => {
		await runMorningBriefCommand({ today: TODAY, live: true });

		const section = String(printedOutput().section);
		expect(mocks.readPageMarkdown).toHaveBeenCalledWith("week-now");
		expect(mocks.syncSection).toHaveBeenCalledWith(
			expect.objectContaining({
				pageId: "week-now",
				previousMarkdown: "# Week",
				nextMarkdown: `# Week\n\n${MORNING_BRIEF_START}\n${section}\n${MORNING_BRIEF_END}`,
				startMarker: MORNING_BRIEF_START,
				endMarker: MORNING_BRIEF_END,
				maxAttempts: 2,
			}),
		);
	});

	test("replaces an existing managed section and keeps the text around it", async () => {
		mocks.readPageMarkdown.mockResolvedValue({
			markdown: `# Week\n\n${MORNING_BRIEF_START}\nyesterday's brief\n${MORNING_BRIEF_END}\n\n## Notes`,
		});

		await runMorningBriefCommand({ today: TODAY, live: true });

		const section = String(printedOutput().section);
		const { nextMarkdown } = mocks.syncSection.mock.calls[0]![0] as {
			nextMarkdown: string;
		};
		expect(nextMarkdown).toBe(
			`# Week\n\n${MORNING_BRIEF_START}\n${section}\n${MORNING_BRIEF_END}\n\n## Notes`,
		);
		expect(nextMarkdown).not.toContain("yesterday's brief");
	});

	test("skips the write when this week's page does not exist yet", async () => {
		mocks.pages["weekly-ds"] = [
			{ id: "week-old", title: "Week of 2026-04-06" },
		];

		await runMorningBriefCommand({ today: TODAY, live: true });

		expect(printedOutput()).toMatchObject({ weeklyPageFound: false });
		expect(mocks.readPageMarkdown).not.toHaveBeenCalled();
		expect(mocks.syncSection).not.toHaveBeenCalled();
	});
});

describe("runMorningBriefCommand synthesis", () => {
	test("is skipped, with a note, when no API key is set", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await runMorningBriefCommand({ today: TODAY, synthesize: true });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(printedOutput()).toMatchObject({
			synthesized: false,
			synthesisCount: 0,
		});
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("ANTHROPIC_API_KEY is not set"),
		);
	});

	test("asks once per risk project, adds each answer under its events, and counts failures", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
		mocks.pages["events-ds"] = [
			event({ title: "Deploy failed", localProjectIds: ["proj-a"] }),
			event({ title: "Tests failed", localProjectIds: ["proj-a"] }),
			event({ title: "Build broke", localProjectIds: ["proj-b"] }),
		];
		const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
			const prompt = (
				JSON.parse(init.body) as {
					messages: Array<{ content: string }>;
				}
			).messages[0]!.content;
			return prompt.startsWith("Project: Alpha")
				? {
						ok: true,
						json: async () => ({
							content: [{ type: "text", text: "Alpha needs a rollback." }],
						}),
					}
				: { ok: false, status: 500, text: async () => "boom" };
		});
		vi.stubGlobal("fetch", fetchMock);

		await runMorningBriefCommand({ today: TODAY, synthesize: true });

		// Alpha's two risk events share one request, and both signals go in it.
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const alphaPrompt = (
			JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
				messages: Array<{ content: string }>;
			}
		).messages[0]!.content;
		expect(alphaPrompt).toContain("Deploy failed (GitHub/Workflow Run)");
		expect(alphaPrompt).toContain("Tests failed (GitHub/Workflow Run)");

		const output = printedOutput();
		expect(output).toMatchObject({
			synthesized: true,
			synthesisCount: 1,
			synthesisErrors: 1,
		});
		expect(String(output.section)).toContain(
			"  > _Synthesis: Alpha needs a rollback._",
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('synthesis failed for "Beta": API error 500'),
		);
	});

	test("makes no request when there are no risk events", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
		mocks.pages["events-ds"] = [event({ severity: "Watch" })];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await runMorningBriefCommand({ today: TODAY, synthesize: true });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(printedOutput()).toMatchObject({ synthesized: false });
	});
});
