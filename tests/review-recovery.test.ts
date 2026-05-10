import { describe, expect, test } from "vitest";

import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import { buildReviewRecoveryPlans } from "../src/notion/review-recovery.js";

describe("review recovery", () => {
	test("plans overdue review rows in oldest-first order", () => {
		const plans = buildReviewRecoveryPlans({
			today: "2026-05-10",
			reviewCadenceDays: { "Active Build": 7 },
			projects: [
				baseProject({
					id: "later",
					title: "Later Review",
					nextReviewDate: "2026-04-02",
				}),
				baseProject({
					id: "earlier",
					title: "Earlier Review",
					nextReviewDate: "2026-03-28",
				}),
				baseProject({
					id: "fresh",
					title: "Fresh Review",
					nextReviewDate: "2026-05-20",
				}),
			],
		});

		expect(plans.map((plan) => plan.title)).toEqual([
			"Earlier Review",
			"Later Review",
		]);
		expect(plans[0]?.properties).toMatchObject({
			"Needs Review": { checkbox: false },
		});
		expect(plans[0]?.summary).toMatchObject({
			lastActive: "2026-05-10",
			nextReviewDate: "2026-05-17",
		});
	});

	test("can include metadata gaps outside the overdue queue", () => {
		const plans = buildReviewRecoveryPlans({
			today: "2026-05-10",
			reviewCadenceDays: { "Active Build": 7 },
			includeMetadataGaps: true,
			projects: [
				baseProject({
					id: "missing",
					title: "Missing Metadata",
					nextMove: "",
					lastActive: "",
					nextReviewDate: "2026-05-20",
				}),
			],
		});

		expect(plans).toHaveLength(1);
		expect(plans[0]?.reasons).toEqual([
			"missing-next-move",
			"missing-last-active",
		]);
		expect(plans[0]?.properties).toHaveProperty("Next Move");
	});
});

function baseProject(
	overrides: Partial<ControlTowerProjectRecord> = {},
): ControlTowerProjectRecord {
	return {
		id: "project-1",
		url: "https://notion.so/project-1",
		title: "Project",
		currentState: "Active Build",
		portfolioCall: "Finish",
		needsReview: true,
		nextMove: "Review the current blocker.",
		biggestBlocker: "",
		lastActive: "2026-04-01",
		lastBuildSessionDate: "",
		buildSessionCount: 1,
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
		category: "App",
		operatingQueue: "Needs Review",
		nextReviewDate: "2026-04-01",
		evidenceFreshness: "Stale",
		...overrides,
	};
}
