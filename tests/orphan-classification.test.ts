import { describe, expect, test } from "vitest";
import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import { classifyOrphan } from "../src/notion/orphan-classification.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

function baseProject(
	overrides: Partial<ControlTowerProjectRecord> = {},
): ControlTowerProjectRecord {
	return {
		id: "proj-test",
		url: "",
		title: "Test Project",
		currentState: "Active",
		portfolioCall: "Worth Finishing",
		momentum: "",
		needsReview: false,
		nextMove: "",
		biggestBlocker: "",
		lastActive: "",
		dateUpdated: "",
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

// ---------------------------------------------------------------------------
// classifyOrphan
// ---------------------------------------------------------------------------

describe("classifyOrphan — already_parked", () => {
	test("portfolioCall === Defer → already_parked with Defer in reason", () => {
		const result = classifyOrphan(
			baseProject({ portfolioCall: "Defer" }),
			TODAY,
		);
		expect(result.disposition).toBe("already_parked");
		expect(result.reason).toContain("Defer");
	});

	test("currentState === Parked (portfolioCall not Defer) → already_parked with Parked in reason", () => {
		const result = classifyOrphan(
			baseProject({ currentState: "Parked", portfolioCall: "Worth Finishing" }),
			TODAY,
		);
		expect(result.disposition).toBe("already_parked");
		expect(result.reason).toContain("Parked");
	});
});

describe("classifyOrphan — archive_candidate", () => {
	test("Experiment category, no activity dates → archive_candidate, reason contains 'no recorded activity'", () => {
		const result = classifyOrphan(
			baseProject({
				category: "Experiment",
				lastActive: "",
				lastBuildSessionDate: "",
				dateUpdated: "",
			}),
			TODAY,
		);
		expect(result.disposition).toBe("archive_candidate");
		expect(result.reason).toContain("no recorded activity");
	});

	test("Experiment category, lastActive 200 days ago → archive_candidate, reason contains '200 days'", () => {
		const result = classifyOrphan(
			baseProject({
				category: "Experiment",
				lastActive: daysAgo(200),
			}),
			TODAY,
		);
		expect(result.disposition).toBe("archive_candidate");
		expect(result.reason).toContain("200 days");
	});

	test("Experiment category, lastActive exactly 180 days ago → viable_needs_kickoff (boundary: condition is > 180)", () => {
		const result = classifyOrphan(
			baseProject({
				category: "Experiment",
				lastActive: daysAgo(180),
			}),
			TODAY,
		);
		expect(result.disposition).toBe("viable_needs_kickoff");
	});
});

describe("classifyOrphan — viable_needs_kickoff", () => {
	test("Feature category (not archive-prone) → viable_needs_kickoff, reason = 'No linked records'", () => {
		const result = classifyOrphan(baseProject({ category: "Feature" }), TODAY);
		expect(result.disposition).toBe("viable_needs_kickoff");
		expect(result.reason).toBe("No linked records");
	});
});

describe("classifyOrphan — result fields", () => {
	test("result always includes projectId, projectTitle, category, portfolioCall, currentState, lastActive", () => {
		const project = baseProject({
			id: "proj-xyz",
			title: "My Project",
			category: "Tool",
			portfolioCall: "Worth Finishing",
			currentState: "Active",
			lastActive: "",
		});
		const result = classifyOrphan(project, TODAY);
		expect(result.projectId).toBe("proj-xyz");
		expect(result.projectTitle).toBe("My Project");
		expect(result.category).toBe("Tool");
		expect(result.portfolioCall).toBe("Worth Finishing");
		expect(result.currentState).toBe("Active");
	});
});
