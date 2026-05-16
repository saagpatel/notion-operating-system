import { describe, expect, test } from "vitest";

import {
	buildPacketPrioritizerReport,
	type PacketPriorityItem,
} from "../src/notion/packet-prioritizer.js";
import type { ExternalSignalEventRecord } from "../src/notion/local-portfolio-external-signals.js";
import type { IntelligenceProjectRecord } from "../src/notion/local-portfolio-intelligence.js";
import type {
	ExecutionTaskRecord,
	WorkPacketRecord,
} from "../src/notion/local-portfolio-execution.js";

const TODAY = "2026-05-16";

describe("packet prioritizer", () => {
	test("prioritizes current risk, stale evidence, and stale task activity", () => {
		const report = buildPacketPrioritizerReport({
			today: TODAY,
			projects: [
				project({
					id: "project-risk",
					title: "ApplyKit",
					evidenceFreshness: "Stale",
					recommendationScore: 82,
				}),
				project({
					id: "project-steady",
					title: "Steady",
					evidenceFreshness: "Fresh",
					recommendationScore: 70,
				}),
			],
			packets: [
				packet({
					id: "packet-steady",
					title: "Polish steady path",
					localProjectIds: ["project-steady"],
				}),
				packet({
					id: "packet-risk",
					title: "Signal risk repair - ApplyKit workflow failures",
					localProjectIds: ["project-risk"],
					priority: "Now",
				}),
			],
			tasks: [
				task({
					id: "task-risk",
					workPacketIds: ["packet-risk"],
					localProjectIds: ["project-risk"],
				}),
				task({
					id: "task-steady",
					workPacketIds: ["packet-steady"],
					localProjectIds: ["project-steady"],
				}),
			],
			taskCreatedAtById: new Map([
				["task-risk", "2026-04-01T00:00:00.000Z"],
				["task-steady", TODAY],
			]),
			events: [
				event({
					id: "event-risk",
					localProjectIds: ["project-risk"],
					severity: "Risk",
					occurredAt: TODAY,
				}),
			],
		});

		expect(report.reportedPackets).toBe(2);
		expect(report.items[0]).toMatchObject<Partial<PacketPriorityItem>>({
			packetTitle: "Signal risk repair - ApplyKit workflow failures",
			projectTitle: "ApplyKit",
		});
		expect(report.items[0]?.factors.signalSeverity).toBe("Risk");
		expect(report.items[0]?.factors.evidenceFreshness).toBe("Stale");
		expect(report.items[0]?.rationale.join(" ")).toContain(
			"recommendation score 82",
		);
	});

	test("uses queue estimates and no-task staleness when stored recommendation data is missing", () => {
		const report = buildPacketPrioritizerReport({
			today: TODAY,
			projects: [
				project({
					id: "project-orphan",
					title: "Fresh Start",
					operatingQueue: "Resume Now",
					recommendationScore: undefined,
				}),
			],
			packets: [
				packet({
					id: "packet-start",
					title: "Kickoff: Fresh Start",
					localProjectIds: ["project-orphan"],
				}),
			],
			tasks: [],
		});

		expect(report.items[0]?.factors.recommendationSource).toBe("estimated");
		expect(report.items[0]?.factors.taskStalenessDays).toBeNull();
		expect(report.items[0]?.nextAction).toContain("Create the first concrete task");
		expect(report.markdown).toContain("Do not add new Notion fields");
	});
});

function project(
	overrides: Partial<IntelligenceProjectRecord>,
): IntelligenceProjectRecord {
	return {
		id: "project",
		url: "https://notion.example/project",
		title: "Project",
		currentState: "Active Build",
		portfolioCall: "Build Now",
		needsReview: false,
		nextMove: "Make the next move.",
		biggestBlocker: "",
		lastActive: TODAY,
		lastBuildSessionDate: TODAY,
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
		category: "Dev Tool",
		operatingQueue: "Resume Now",
		nextReviewDate: TODAY,
		evidenceFreshness: "Fresh",
		relatedResearchIds: [],
		supportingSkillIds: [],
		toolStackIds: [],
		recommendationRunIds: [],
		projectShape: [],
		deploymentSurface: [],
		primaryTool: "",
		recommendationScore: 70,
		recommendationConfidence: "Medium",
		recommendationLane: "Resume",
		recommendationUpdated: TODAY,
		...overrides,
	};
}

function packet(overrides: Partial<WorkPacketRecord>): WorkPacketRecord {
	return {
		id: "packet",
		url: "https://notion.example/packet",
		title: "Packet",
		status: "Ready",
		packetType: "Resume",
		priority: "Later",
		ownerIds: [],
		localProjectIds: [],
		drivingDecisionIds: [],
		goal: "",
		definitionOfDone: "",
		whyNow: "",
		targetStart: "",
		targetFinish: "",
		estimatedSize: "1 day",
		rolloverCount: 0,
		executionTaskIds: [],
		buildLogSessionIds: [],
		weeklyReviewIds: [],
		blockerSummary: "",
		...overrides,
	};
}

function task(overrides: Partial<ExecutionTaskRecord>): ExecutionTaskRecord {
	return {
		id: "task",
		url: "https://notion.example/task",
		title: "Task",
		status: "Ready",
		assigneeIds: [],
		dueDate: "",
		priority: "Medium",
		taskType: "Build",
		workPacketIds: [],
		localProjectIds: [],
		estimate: "1h",
		completedOn: "",
		taskNotes: "",
		...overrides,
	};
}

function event(
	overrides: Partial<ExternalSignalEventRecord>,
): ExternalSignalEventRecord {
	return {
		id: "event",
		url: "https://notion.example/event",
		title: "Event",
		localProjectIds: [],
		sourceIds: [],
		provider: "GitHub",
		signalType: "Workflow Run",
		occurredAt: TODAY,
		status: "failed",
		environment: "N/A",
		severity: "Watch",
		sourceIdValue: "",
		sourceUrl: "",
		syncRunIds: [],
		eventKey: "event",
		summary: "",
		rawExcerpt: "",
		...overrides,
	};
}
