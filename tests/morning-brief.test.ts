import { describe, expect, test } from "vitest";
import type { ExternalSignalEventRecord } from "../src/notion/local-portfolio-external-signals.js";
import { renderMorningBriefSection } from "../src/notion/morning-brief.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _eventIdCounter = 0;

function makeEvent(
	overrides: Partial<ExternalSignalEventRecord> = {},
): ExternalSignalEventRecord {
	return {
		id: `event-${++_eventIdCounter}`,
		url: "",
		title: "CI workflow failed",
		localProjectIds: ["proj-1"],
		sourceIds: [],
		provider: "GitHub",
		signalType: "Workflow Run",
		occurredAt: "2026-04-14",
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

function baseInput(
	overrides: Partial<Parameters<typeof renderMorningBriefSection>[0]> = {},
): Parameters<typeof renderMorningBriefSection>[0] {
	return {
		events: [],
		projectIndex: new Map([
			["proj-1", "Alpha"],
			["proj-2", "Beta"],
		]),
		today: "2026-04-14",
		lookbackDays: 1,
		activeProjectIds: new Set(["proj-1", "proj-2"]),
		coveredProjectIds: new Set(["proj-1", "proj-2"]),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// renderMorningBriefSection
// ---------------------------------------------------------------------------

describe("renderMorningBriefSection — zero events", () => {
	test("Risk section shows 'No risk events' message when there are no events", () => {
		const section = renderMorningBriefSection(baseInput({ events: [] }));
		expect(section).toMatch(/no risk events/i);
	});

	test("Coverage Gaps section shows all-covered message when coveredProjectIds includes all active projects", () => {
		const section = renderMorningBriefSection(
			baseInput({
				events: [],
				activeProjectIds: new Set(["proj-1", "proj-2"]),
				coveredProjectIds: new Set(["proj-1", "proj-2"]),
			}),
		);
		expect(section).toContain("All active projects have signal activity");
	});
});

describe("renderMorningBriefSection — Risk events", () => {
	test("3 Risk events → Risk section has 3 bullet items, no 'and N more'", () => {
		const events = [
			makeEvent({ localProjectIds: ["proj-1"], severity: "Risk" }),
			makeEvent({ localProjectIds: ["proj-1"], severity: "Risk" }),
			makeEvent({ localProjectIds: ["proj-1"], severity: "Risk" }),
		];
		const section = renderMorningBriefSection(baseInput({ events }));
		const riskLines = section
			.split("\n")
			.filter((l) => l.startsWith("- ") && l.includes("Alpha"));
		expect(riskLines.length).toBeGreaterThanOrEqual(3);
		expect(section).not.toContain("…and");
	});

	test("12 Risk events → exactly 10 bullets + '…and 2 more' line", () => {
		const events = Array.from({ length: 12 }, () =>
			makeEvent({
				localProjectIds: ["proj-1"],
				severity: "Risk",
				title: "Failure",
			}),
		);
		const section = renderMorningBriefSection(baseInput({ events }));
		expect(section).toContain("…and 2 more");
		// Count bullet lines under Risk (- **Alpha** — ...) limited to 10
		const riskBullets = section
			.split("\n")
			.filter((l) => l.startsWith("- **Alpha**"));
		expect(riskBullets).toHaveLength(10);
	});
});

describe("renderMorningBriefSection — Watch events", () => {
	test("2 Watch events → Watch section has 2 bullet items", () => {
		const events = [
			makeEvent({
				localProjectIds: ["proj-1"],
				severity: "Watch",
				title: "Slow deploy",
			}),
			makeEvent({
				localProjectIds: ["proj-2"],
				severity: "Watch",
				title: "PR idle",
			}),
		];
		const section = renderMorningBriefSection(baseInput({ events }));
		const watchSection = section.slice(section.indexOf("### Watch"));
		const watchBullets = watchSection
			.split("\n")
			.filter((l) => l.startsWith("- **"));
		expect(watchBullets).toHaveLength(2);
	});

	test("zero Watch events → Watch section shows 'no watch events'", () => {
		const section = renderMorningBriefSection(baseInput({ events: [] }));
		expect(section).toMatch(/no watch events/i);
	});
});

describe("renderMorningBriefSection — Coverage Gaps", () => {
	test("proj-2 not in coveredProjectIds → Coverage Gaps section mentions Beta", () => {
		const section = renderMorningBriefSection(
			baseInput({
				events: [],
				activeProjectIds: new Set(["proj-1", "proj-2"]),
				coveredProjectIds: new Set(["proj-1"]), // proj-2 missing
			}),
		);
		expect(section).toContain("Coverage Gaps");
		expect(section).toContain("Beta");
	});

	test("all projects covered → no project names in Coverage Gaps", () => {
		const section = renderMorningBriefSection(
			baseInput({
				events: [],
				activeProjectIds: new Set(["proj-1", "proj-2"]),
				coveredProjectIds: new Set(["proj-1", "proj-2"]),
			}),
		);
		expect(section).toContain("All active projects have signal activity");
		// Neither project name should appear as a gap
		const gapSection = section.slice(section.indexOf("### Coverage Gaps"));
		expect(gapSection).not.toContain("Beta");
		expect(gapSection).not.toContain("Alpha");
	});
});

describe("renderMorningBriefSection — synthesisMap", () => {
	test("synthesis blockquote appears under Risk event bullet when synthesisMap is populated for that project", () => {
		const events = [
			makeEvent({
				localProjectIds: ["proj-1"],
				severity: "Risk",
				title: "Build broke",
			}),
		];
		const synthesisMap = new Map([
			["proj-1", "The main branch is failing. Hotfix required immediately."],
		]);
		const section = renderMorningBriefSection(
			baseInput({ events }),
			synthesisMap,
		);
		expect(section).toContain("> _Synthesis:");
		expect(section).toContain("Hotfix required immediately.");
	});

	test("synthesis blockquote does NOT appear when synthesisMap is empty", () => {
		const events = [
			makeEvent({ localProjectIds: ["proj-1"], severity: "Risk" }),
		];
		const section = renderMorningBriefSection(
			baseInput({ events }),
			new Map(), // empty
		);
		expect(section).not.toContain("> _Synthesis:");
	});

	test("synthesis does NOT appear for Watch events even if synthesisMap has the project", () => {
		const events = [
			makeEvent({
				localProjectIds: ["proj-1"],
				severity: "Watch",
				title: "Slow PR",
			}),
		];
		const synthesisMap = new Map([["proj-1", "Something to do."]]);
		const section = renderMorningBriefSection(
			baseInput({ events }),
			synthesisMap,
		);
		expect(section).not.toContain("> _Synthesis:");
	});
});
