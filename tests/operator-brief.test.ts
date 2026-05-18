import { describe, expect, test } from "vitest";

import type { ControlTowerMetrics, ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import type {
	ExecutionTaskRecord,
	WorkPacketRecord,
} from "../src/notion/local-portfolio-execution.js";
import {
	buildPacketStalenessItems,
	renderOperatorBrief,
} from "../src/notion/operator-brief.js";

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
			packetStaleDays: 14,
			packetStalenessItems: [
				{
					packetId: "packet-stale",
					packetTitle: "ApplyKit - repair workflow evidence",
					packetUrl: "https://notion.example/packet",
					projectTitle: "ApplyKit",
					openTaskCount: 1,
					taskActivityAgeDays: 20,
					isOverdue: true,
					isAtRisk: true,
					nextAction: "Recover overdue task: ApplyKit - verify CI.",
				},
			],
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
		expect(markdown).toContain("Packet staleness: 1 packet(s) stale by task activity; 1 at risk");
		expect(markdown).toContain("At risk: ApplyKit — ApplyKit - repair workflow evidence");
		expect(markdown).toContain("SpecCompanion — review due 2026-05-01");
		expect(markdown).toContain("npm run control-tower:operator-brief");
	});

	test("ranks overdue packets with stale task activity as at risk", () => {
		const items = buildPacketStalenessItems({
			today: "2026-05-18",
			projects: [baseProject({ id: "project-risk", title: "Codec" })],
			packets: [
				basePacket({
					id: "packet-fresh",
					title: "Fresh packet",
					localProjectIds: ["project-risk"],
				}),
				basePacket({
					id: "packet-risk",
					title: "Codec - package verified local baseline",
					localProjectIds: ["project-risk"],
					targetFinish: "2026-05-01",
				}),
			],
			tasks: [
				baseTask({
					id: "task-fresh",
					workPacketIds: ["packet-fresh"],
				}),
				baseTask({
					id: "task-risk",
					title: "Turn Codec build proof into a demo checklist",
					workPacketIds: ["packet-risk"],
					dueDate: "2026-05-01",
				}),
			],
			taskCreatedAtById: new Map([
				["task-fresh", "2026-05-18T00:00:00.000Z"],
				["task-risk", "2026-04-01T00:00:00.000Z"],
			]),
			staleAfterDays: 14,
		});

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			packetTitle: "Codec - package verified local baseline",
			projectTitle: "Codec",
			taskActivityAgeDays: 47,
			isAtRisk: true,
			nextAction: "Recover overdue task: Turn Codec build proof into a demo checklist.",
		});
	});

	test("counts task note edits as recent packet activity", () => {
		const items = buildPacketStalenessItems({
			today: "2026-05-18",
			projects: [baseProject({ id: "project-devtools", title: "DevToolsTranslator" })],
			packets: [
				basePacket({
					id: "packet-release",
					title: "DevToolsTranslator - release blocker packet",
					localProjectIds: ["project-devtools"],
					targetFinish: "2026-03-28",
				}),
			],
			tasks: [
				baseTask({
					id: "task-release",
					title: "Resolve updater signature blocker",
					status: "Blocked",
					workPacketIds: ["packet-release"],
					dueDate: "2026-03-26",
					lastEditedTime: "2026-05-18T15:17:54.000Z",
				}),
			],
			taskCreatedAtById: new Map([
				["task-release", "2026-03-21T00:00:00.000Z"],
			]),
			staleAfterDays: 14,
		});

		expect(items).toHaveLength(0);
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

function basePacket(overrides: Partial<WorkPacketRecord> = {}): WorkPacketRecord {
	return {
		id: "packet",
		url: "https://notion.example/packet",
		title: "Packet",
		status: "Ready",
		packetType: "Build",
		priority: "Now",
		ownerIds: [],
		localProjectIds: [],
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

function baseTask(overrides: Partial<ExecutionTaskRecord> = {}): ExecutionTaskRecord {
	return {
		id: "task",
		url: "https://notion.example/task",
		title: "Task",
		status: "Todo",
		assigneeIds: [],
		dueDate: "",
		priority: "Now",
		taskType: "Build",
		workPacketIds: [],
		localProjectIds: [],
		estimate: "",
		completedOn: "",
		taskNotes: "",
		...overrides,
	};
}
