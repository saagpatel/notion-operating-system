import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";

// runOrphanClassificationCommand reads projects from Notion, publishes a Build
// Log page, and can upsert approval requests and kickoff packets. Every
// boundary is stubbed; the classification rules themselves run for real and
// are covered case by case in orphan-classification.test.ts.

const mocks = vi.hoisted(() => ({
	token: "test-notion-token" as string | undefined,
	config: {} as Record<string, unknown>,
	pages: {} as Record<string, unknown[]>,
	retrieveDataSource: vi.fn(),
	createPageWithMarkdown: vi.fn(),
	updatePageProperties: vi.fn(),
	patchPageMarkdown: vi.fn(),
	upsertPageByTitle: vi.fn(),
	publish: vi.fn(),
	published: [] as Array<{
		alias: string;
		file: string;
		markdown: string;
		options: Record<string, unknown>;
	}>,
}));

vi.mock("../src/config/runtime-config.js", () => ({
	loadRuntimeConfig: vi.fn(() => ({
		notion: { token: mocks.token },
		paths: { destinationsPath: "test-destinations.json" },
	})),
}));

vi.mock("../src/logging/run-logger.js", () => ({
	RunLogger: {
		fromRuntimeConfig: vi.fn(() => ({ init: vi.fn(async () => undefined) })),
	},
}));

vi.mock("../src/config/destination-registry.js", () => ({
	DestinationRegistry: {
		load: vi.fn(async () => ({
			getDestination: (alias: string) => ({ alias }),
		})),
	},
}));

vi.mock("../src/publishing/publisher.js", () => ({
	Publisher: class {
		publish = mocks.publish;
	},
}));

vi.mock("../src/notion/direct-notion-client.js", () => ({
	DirectNotionClient: class {
		retrieveDataSource = mocks.retrieveDataSource;
		createPageWithMarkdown = mocks.createPageWithMarkdown;
		updatePageProperties = mocks.updatePageProperties;
		patchPageMarkdown = mocks.patchPageMarkdown;
	},
}));

vi.mock(
	"../src/notion/local-portfolio-control-tower.js",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../src/notion/local-portfolio-control-tower.js")
		>()),
		loadLocalPortfolioControlTowerConfig: vi.fn(async () => mocks.config),
		// Derived signals are another module's job; the fixtures already carry final values.
		applyDerivedSignals: vi.fn((project: unknown) => project),
	}),
);

vi.mock(
	"../src/notion/local-portfolio-control-tower-live.js",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../src/notion/local-portfolio-control-tower-live.js")
		>()),
		fetchAllPages: vi.fn(
			async (_api: unknown, dataSourceId: string) =>
				mocks.pages[dataSourceId] ?? [],
		),
		toControlTowerProjectRecord: vi.fn((page: unknown) => page),
		upsertPageByTitle: mocks.upsertPageByTitle,
	}),
);

vi.mock("../src/notion/local-portfolio-governance-live.js", () => ({
	toActionRequestRecord: vi.fn((page: unknown) => page),
}));

vi.mock("../src/notion/local-portfolio-execution-live.js", () => ({
	toWorkPacketRecord: vi.fn((page: unknown) => page),
}));

import { runOrphanClassificationCommand } from "../src/notion/orphan-classification.js";

const TODAY = "2026-04-16";

function project(
	overrides: Partial<ControlTowerProjectRecord>,
): ControlTowerProjectRecord {
	return {
		id: "proj",
		url: "",
		title: "Project",
		currentState: "Active",
		portfolioCall: "Worth Finishing",
		needsReview: false,
		nextMove: "",
		biggestBlocker: "",
		lastActive: "",
		lastBuildSessionDate: "",
		buildSessionCount: 0,
		relatedResearchCount: 0,
		supportingSkillsCount: 0,
		linkedToolCount: 0,
		setupFriction: "",
		runsLocally: "",
		buildMaturity: "",
		shipReadiness: "",
		effortToDemo: "",
		effortToShip: "",
		oneLinePitch: "",
		valueOutcome: "",
		monetizationValue: "",
		evidenceConfidence: "",
		docsQuality: "",
		testPosture: "",
		category: "Feature",
		...overrides,
	};
}

function request(overrides: Record<string, unknown>) {
	return {
		id: "req",
		title: "",
		status: "Pending Approval",
		localProjectIds: [],
		providerRequestKey: "",
		...overrides,
	};
}

function seed() {
	mocks.token = "test-notion-token";
	mocks.config = {
		database: { dataSourceId: "projects-ds" },
		destinations: { buildLogAlias: "build_log" },
		phase2Execution: {
			packets: { dataSourceId: "packets-ds" },
			defaultOwnerUserId: "owner-1",
		},
		phase6Governance: { actionRequests: { dataSourceId: "requests-ds" } },
	};
	mocks.pages = {
		"projects-ds": [
			project({ id: "p-viable", title: "Viable App" }),
			// Viable too, but a kickoff packet already exists for it.
			project({ id: "p-packet", title: "Packeted App" }),
			project({
				id: "p-archive",
				title: "Old Script",
				category: "Script",
				lastActive: "2025-01-01",
			}),
			project({
				id: "p-parked",
				title: "Parked Thing",
				portfolioCall: "Defer",
			}),
			// Linked to a build session: not an orphan at all.
			project({ id: "p-linked", title: "Linked App", buildSessionCount: 1 }),
		],
		"packets-ds": [
			{
				id: "packet-1",
				title: "Kickoff: Packeted App",
				status: "In Progress",
				localProjectIds: ["p-packet"],
			},
		],
		"requests-ds": [],
	};
}

let logSpy: ReturnType<typeof vi.spyOn>;

function summary(): Record<string, unknown> {
	return JSON.parse(String(logSpy.mock.calls[0]![0])) as Record<
		string,
		unknown
	>;
}

// The table is printed after a blank line.
function printedMarkdown(): string {
	return String(logSpy.mock.calls[1]![0]).replace(/^\n/, "");
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.published = [];
	seed();
	mocks.retrieveDataSource.mockImplementation(async (id: string) => ({
		id,
		titlePropertyName: "Name",
	}));
	mocks.createPageWithMarkdown.mockResolvedValue({ id: "created-request" });
	mocks.updatePageProperties.mockResolvedValue({});
	mocks.patchPageMarkdown.mockResolvedValue({});
	mocks.upsertPageByTitle.mockResolvedValue({
		id: "packet-new",
		url: "",
		existed: false,
	});
	mocks.publish.mockImplementation(
		async (destination: { alias: string }, options: { inputFile: string }) => {
			mocks.published.push({
				alias: destination.alias,
				file: options.inputFile,
				markdown: await readFile(options.inputFile, "utf8"),
				options,
			});
		},
	);
	logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
	logSpy.mockRestore();
});

describe("runOrphanClassificationCommand dry run", () => {
	test("sorts orphans into parked, archive and kickoff, and writes nothing", async () => {
		await runOrphanClassificationCommand({ today: TODAY });

		expect(summary()).toEqual({
			ok: true,
			live: false,
			today: TODAY,
			totalProjects: 5,
			orphanCount: 4,
			alreadyParked: 1,
			archiveCandidates: 1,
			viableNeedsKickoff: 2,
			viableNeedsKickoffWithoutPacket: 1,
			viableWithExistingKickoffPacket: 1,
			approvalRequestsUpserted: 0,
			approvedRequestsMatched: 0,
			packetsCreated: 0,
		});
		expect(mocks.publish).not.toHaveBeenCalled();
		expect(mocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(mocks.upsertPageByTitle).not.toHaveBeenCalled();
	});

	test("the printed table leaves parked projects out and names an existing kickoff packet", async () => {
		await runOrphanClassificationCommand({ today: TODAY });

		const markdown = printedMarkdown();
		expect(markdown).toContain(`## Orphan Classification — ${TODAY}`);
		expect(markdown).toContain(
			"| Viable App | Feature | Worth Finishing | N/A | Viable — Needs Kickoff | No linked records | Request approval for a kickoff packet |",
		);
		expect(markdown).toContain(
			"| Packeted App | Feature | Worth Finishing | N/A | Viable — Needs Kickoff | No linked records; existing packet: Kickoff: Packeted App | Work existing kickoff packet before creating another |",
		);
		expect(markdown).toMatch(
			/\| Old Script \| Script \| .* \| Archive Candidate \| Script inactive \d+ days \|/,
		);
		expect(markdown).not.toContain("Parked Thing");
		expect(markdown).not.toContain("Linked App");
	});

	test("an empty result says so in the table", async () => {
		mocks.pages["projects-ds"] = [
			project({ id: "p-linked", title: "Linked App", buildSessionCount: 2 }),
		];

		await runOrphanClassificationCommand({ today: TODAY });

		expect(summary()).toMatchObject({ totalProjects: 1, orphanCount: 0 });
		expect(printedMarkdown()).toContain(
			"| — | — | — | — | — | No orphan projects requiring action. | — |",
		);
	});

	test("a project-title filter narrows the run and carries into the next commands", async () => {
		mocks.pages["projects-ds"]!.push(
			project({ id: "p-quoted", title: 'Say "Hi"' }),
		);
		await runOrphanClassificationCommand({
			today: TODAY,
			projectTitles: [" Old Script ", "Old Script", 'Say "Hi"'],
		});

		expect(summary()).toMatchObject({
			orphanCount: 2,
			allOrphanCount: 5,
			projectTitleFilters: ["Old Script", 'Say "Hi"'],
			archiveCandidates: 1,
			viableNeedsKickoff: 1,
		});
		const markdown = printedMarkdown();
		expect(markdown).toContain('Scope: "Old Script", "Say "Hi""');
		expect(markdown).toContain(
			'npm run governance:orphan-classify -- --live --request-approval --project-title "Old Script" --project-title "Say \\"Hi\\""',
		);
		expect(markdown).not.toContain("Viable App");
	});

	test("a project-title filter that matches no orphan is an error, not an empty report", async () => {
		await expect(
			runOrphanClassificationCommand({
				today: TODAY,
				projectTitles: ["Linked App"],
			}),
		).rejects.toThrow(
			"No orphan classification result matched --project-title: Linked App",
		);
	});

	test("without phase-two execution config, kickoff packets are not looked up", async () => {
		delete mocks.config.phase2Execution;

		await runOrphanClassificationCommand({ today: TODAY });

		expect(mocks.retrieveDataSource.mock.calls.map((c) => c[0])).toEqual([
			"projects-ds",
		]);
		expect(summary()).toMatchObject({
			viableNeedsKickoffWithoutPacket: 2,
			viableWithExistingKickoffPacket: 0,
		});
	});
});

describe("runOrphanClassificationCommand guards", () => {
	test("needs a Notion token", async () => {
		mocks.token = undefined;
		await expect(
			runOrphanClassificationCommand({ today: TODAY }),
		).rejects.toThrow("NOTION_TOKEN is required for orphan classification");
	});

	test.each([
		[{ requestApproval: true }],
		[{ approve: true }],
		[{ createApprovedPackets: true }],
	])("refuses %o without --live", async (options) => {
		await expect(
			runOrphanClassificationCommand({ today: TODAY, ...options }),
		).rejects.toThrow(
			"--request-approval, --approve, and --create-approved-packets require --live",
		);
		expect(mocks.retrieveDataSource).not.toHaveBeenCalled();
	});

	test("refuses approval requests and direct packets in the same run", async () => {
		await expect(
			runOrphanClassificationCommand({
				today: TODAY,
				live: true,
				requestApproval: true,
				createPackets: true,
			}),
		).rejects.toThrow("Choose either --request-approval or --create-packets");
	});

	test("refuses approval requests when governance config is missing, after publishing the report", async () => {
		delete mocks.config.phase6Governance;

		await expect(
			runOrphanClassificationCommand({
				today: TODAY,
				live: true,
				requestApproval: true,
			}),
		).rejects.toThrow("missing phase6Governance for approval requests");
		expect(mocks.publish).toHaveBeenCalledTimes(1);
	});
});

describe("runOrphanClassificationCommand live", () => {
	test("publishes the report to the Build Log from a temp file it then removes", async () => {
		await runOrphanClassificationCommand({ today: TODAY, live: true });

		expect(mocks.published).toHaveLength(1);
		const [published] = mocks.published;
		expect(published!.alias).toBe("build_log");
		expect(published!.options).toMatchObject({
			destinationAlias: "build_log",
			dryRun: false,
			live: true,
		});
		expect(published!.markdown).toBe(
			`---\ntitle: Orphan Classification — ${TODAY}\n---\n\n${printedMarkdown()}`,
		);
		expect(existsSync(path.dirname(published!.file))).toBe(false);
		expect(summary()).toMatchObject({
			live: true,
			approvalRequestsUpserted: 0,
			packetsCreated: 0,
		});
	});

	test("removes the temp file even when publishing fails", async () => {
		mocks.publish.mockImplementationOnce(
			async (_d: unknown, options: { inputFile: string }) => {
				mocks.published.push({
					alias: "",
					file: options.inputFile,
					markdown: "",
					options,
				});
				throw new Error("Notion is down");
			},
		);

		await expect(
			runOrphanClassificationCommand({ today: TODAY, live: true }),
		).rejects.toThrow("Notion is down");
		expect(existsSync(path.dirname(mocks.published[0]!.file))).toBe(false);
	});

	test("creates an approval request only for the viable project with no packet", async () => {
		await runOrphanClassificationCommand({
			today: TODAY,
			live: true,
			requestApproval: true,
		});

		expect(mocks.createPageWithMarkdown).toHaveBeenCalledTimes(1);
		expect(mocks.createPageWithMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				parent: { data_source_id: "requests-ds" },
				properties: {
					Name: {
						title: [
							expect.objectContaining({
								text: { content: "Approve kickoff packet: Viable App" },
							}),
						],
					},
				},
				markdown: expect.stringContaining(
					"# Approve kickoff packet: Viable App",
				),
			}),
		);
		expect(mocks.updatePageProperties).toHaveBeenCalledWith(
			expect.objectContaining({
				pageId: "created-request",
				properties: expect.objectContaining({ Name: expect.anything() }),
			}),
		);
		expect(mocks.patchPageMarkdown).not.toHaveBeenCalled();
		expect(summary()).toMatchObject({ approvalRequestsUpserted: 1 });
	});

	test("updates a matching approval request in place instead of creating another", async () => {
		mocks.pages["requests-ds"] = [
			request({
				id: "req-existing",
				localProjectIds: ["p-viable"],
				providerRequestKey: "orphan-kickoff:p-viable",
			}),
		];

		await runOrphanClassificationCommand({
			today: TODAY,
			live: true,
			requestApproval: true,
		});

		expect(mocks.createPageWithMarkdown).not.toHaveBeenCalled();
		expect(mocks.updatePageProperties).toHaveBeenCalledWith(
			expect.objectContaining({ pageId: "req-existing" }),
		);
		expect(mocks.patchPageMarkdown).toHaveBeenCalledWith(
			expect.objectContaining({
				pageId: "req-existing",
				command: "replace_content",
			}),
		);
		expect(summary()).toMatchObject({ approvalRequestsUpserted: 1 });
	});

	test("creates kickoff packets directly with --create-packets", async () => {
		await runOrphanClassificationCommand({
			today: TODAY,
			live: true,
			createPackets: true,
		});

		expect(mocks.upsertPageByTitle).toHaveBeenCalledTimes(1);
		expect(mocks.upsertPageByTitle).toHaveBeenCalledWith(
			expect.objectContaining({
				dataSourceId: "packets-ds",
				titlePropertyName: "Name",
				title: "Kickoff: Viable App",
				properties: expect.objectContaining({ Name: expect.anything() }),
				markdown: expect.stringContaining("# Kickoff: Viable App"),
			}),
		);
		expect(summary()).toMatchObject({ packetsCreated: 1 });
	});

	test("with --create-approved-packets, only projects with an approved request get a packet", async () => {
		mocks.pages["projects-ds"] = [
			project({ id: "p-viable", title: "Viable App" }),
			project({ id: "p-waiting", title: "Waiting App" }),
		];
		mocks.pages["packets-ds"] = [];
		mocks.pages["requests-ds"] = [
			request({
				id: "req-ok",
				status: "Approved",
				localProjectIds: ["p-viable"],
				providerRequestKey: "orphan-kickoff:p-viable",
			}),
			// Still pending: no packet yet.
			request({
				id: "req-wait",
				localProjectIds: ["p-waiting"],
				providerRequestKey: "orphan-kickoff:p-waiting",
			}),
		];

		await runOrphanClassificationCommand({
			today: TODAY,
			live: true,
			createApprovedPackets: true,
		});

		expect(mocks.upsertPageByTitle).toHaveBeenCalledTimes(1);
		expect(mocks.upsertPageByTitle).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Kickoff: Viable App" }),
		);
		expect(summary()).toMatchObject({
			approvedRequestsMatched: 1,
			packetsCreated: 1,
		});
	});

	test("refuses packet creation when execution config is missing", async () => {
		delete mocks.config.phase2Execution;

		await expect(
			runOrphanClassificationCommand({
				today: TODAY,
				live: true,
				createPackets: true,
			}),
		).rejects.toThrow("missing phase2Execution for work packet creation");
		expect(mocks.upsertPageByTitle).not.toHaveBeenCalled();
	});
});
