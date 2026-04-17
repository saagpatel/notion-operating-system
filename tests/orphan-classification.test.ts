import { describe, expect, test } from "vitest";
import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import {
	buildKickoffApprovalRequestDraft,
	buildKickoffPacketDraft,
	classifyOrphan,
} from "../src/notion/orphan-classification.js";

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

describe("buildKickoffPacketDraft", () => {
	test("creates a structured kickoff packet draft tied to the local project", () => {
		const result = classifyOrphan(
			baseProject({
				id: "proj-kickoff",
				title: "Kickoff Project",
				category: "Feature",
			}),
			TODAY,
		);
		expect(result.disposition).toBe("viable_needs_kickoff");

		const draft = buildKickoffPacketDraft(result, TODAY, "user-123");
		expect(draft.title).toBe("Kickoff: Kickoff Project");
		expect(draft.markdown).toContain("Viable — Needs Kickoff");
		expect(draft.markdown).toContain("Add one build log entry");
		expect(draft.properties["Local Project"]).toEqual({
			relation: [{ id: "proj-kickoff" }],
		});
		expect(draft.properties.Status).toEqual({ status: { name: "Ready" } });
		expect(draft.properties.Priority).toEqual({
			select: { name: "Later" },
		});
		expect(draft.properties.Owner).toEqual({
			people: [{ id: "user-123" }],
		});
	});
});

describe("buildKickoffApprovalRequestDraft", () => {
	test("creates a pending approval request for a kickoff packet by default", () => {
		const result = classifyOrphan(
			baseProject({
				id: "proj-approval",
				title: "Approval Project",
				category: "Feature",
			}),
			TODAY,
		);
		const draft = buildKickoffApprovalRequestDraft(result, TODAY, {
			requestedByUserId: "user-123",
		});

		expect(draft.title).toBe("Approve kickoff packet: Approval Project");
		expect(draft.providerRequestKey).toBe("orphan-kickoff:proj-approval");
		expect(draft.markdown).toContain("Pending Approval");
		expect(draft.properties.Status).toEqual({
			select: { name: "Pending Approval" },
		});
		expect(draft.properties["Local Project"]).toEqual({
			relation: [{ id: "proj-approval" }],
		});
		expect(draft.properties["Requested By"]).toEqual({
			people: [{ id: "user-123" }],
		});
	});

	test("marks the approval request approved when approve=true", () => {
		const result = classifyOrphan(
			baseProject({
				id: "proj-approved",
				title: "Approved Project",
				category: "Feature",
			}),
			TODAY,
		);
		const draft = buildKickoffApprovalRequestDraft(result, TODAY, {
			approve: true,
			requestedByUserId: "user-123",
		});

		expect(draft.markdown).toContain("Approved");
		expect(draft.properties.Status).toEqual({
			select: { name: "Approved" },
		});
		expect(draft.properties.Approver).toEqual({
			people: [{ id: "user-123" }],
		});
		expect(draft.properties["Decided At"]).toEqual({
			date: { start: TODAY },
		});
	});
});
