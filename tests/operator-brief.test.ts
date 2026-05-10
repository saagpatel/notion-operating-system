import { describe, expect, test } from "vitest";

import type { ControlTowerMetrics, ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import { renderOperatorBrief } from "../src/notion/operator-brief.js";

describe("renderOperatorBrief", () => {
	test("summarizes top risks, review backlog, and orphan follow-through", () => {
		const markdown = renderOperatorBrief({
			today: "2026-05-09",
			metrics: baseMetrics({ overdueReviews: 2 }),
			priorityProjects: [
				{
					projectName: "ApplyKit",
					score: 84,
					nextAction: "Investigate the top risk signal.",
				},
			],
			staleActiveCount: 0,
			actionableOrphans: 1,
			orphansWithKickoff: 5,
			overdueProjects: [
				baseProject({
					title: "SpecCompanion",
					nextReviewDate: "2026-05-01",
					nextMove: "Run a fresh QA pass.",
				}),
			],
		});

		expect(markdown).toContain("## Operator Brief — 2026-05-09");
		expect(markdown).toContain("ApplyKit — score 84");
		expect(markdown).toContain("Orphans already routed to kickoff packets: 5");
		expect(markdown).toContain("SpecCompanion — review due 2026-05-01");
		expect(markdown).toContain("npm run control-tower:operator-brief");
	});
});

function baseMetrics(overrides: Partial<ControlTowerMetrics> = {}): ControlTowerMetrics {
	return {
		totalProjects: 1,
		queueCounts: {
			Shipped: 0,
			"Needs Review": 1,
			"Needs Decision": 0,
			"Worth Finishing": 0,
			"Resume Now": 0,
			"Cold Storage": 0,
			Watch: 0,
		},
		overdueReviews: 0,
		missingNextMove: 0,
		missingLastActive: 0,
		staleActiveProjects: 0,
		orphanedProjects: 0,
		recentBuildSessions: 0,
		...overrides,
	};
}

function baseProject(
	overrides: Partial<ControlTowerProjectRecord> = {},
): ControlTowerProjectRecord {
	return {
		id: "project-1",
		url: "",
		title: "Project",
		currentState: "Active",
		portfolioCall: "Worth Finishing",
		needsReview: true,
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
		category: "",
		operatingQueue: "Needs Review",
		nextReviewDate: "",
		evidenceFreshness: "Fresh",
		...overrides,
	};
}
