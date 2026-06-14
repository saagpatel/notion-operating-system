import { describe, expect, test } from "vitest";

import {
	buildPacketFollowThroughReport,
	type PacketFollowThroughItem,
} from "../src/notion/packet-follow-through.js";
import type { ControlTowerProjectRecord } from "../src/notion/local-portfolio-control-tower.js";
import type {
	ExecutionTaskRecord,
	WorkPacketRecord,
} from "../src/notion/local-portfolio-execution.js";

const TODAY = "2026-05-10";

describe("packet follow-through", () => {
	test("surfaces existing orphan kickoff packets before creating more", () => {
		const report = buildPacketFollowThroughReport({
			today: TODAY,
			projects: [
				project({
					id: "project-orphan",
					title: "bridge-db",
					operatingQueue: "Resume Now",
				}),
			],
			packets: [
				packet({
					id: "packet-kickoff",
					title: "Kickoff: bridge-db",
					localProjectIds: ["project-orphan"],
					status: "Ready",
					priority: "Later",
				}),
			],
			tasks: [],
		});

		expect(report.orphanKickoffPackets).toBe(1);
		expect(report.items[0]).toMatchObject<Partial<PacketFollowThroughItem>>({
			packetTitle: "Kickoff: bridge-db",
			projectTitle: "bridge-db",
			lane: "orphan-kickoff",
			state: "Needs first task",
		});
		expect(report.items[0]?.nextAction).toContain(
			"Work this existing kickoff packet",
		);
		expect(report.markdown).toContain("Work existing kickoff packets");
	});

	test("ranks signal-risk repair packets above generic open packets", () => {
		const report = buildPacketFollowThroughReport({
			today: TODAY,
			projects: [
				project({ id: "project-applykit", title: "ApplyKit" }),
				project({
					id: "project-generic",
					title: "Generic",
					buildSessionCount: 1,
				}),
			],
			packets: [
				packet({
					id: "packet-generic",
					title: "Refine docs",
					localProjectIds: ["project-generic"],
					status: "Ready",
					priority: "Later",
				}),
				packet({
					id: "packet-signal",
					title: "Signal risk repair - ApplyKit workflow failures",
					localProjectIds: ["project-applykit"],
					status: "Review",
					priority: "Now",
				}),
			],
			tasks: [
				task({
					id: "task-verify",
					title: "Verify GitHub Actions result",
					workPacketIds: ["packet-signal"],
					localProjectIds: ["project-applykit"],
				}),
			],
		});

		expect(report.signalRiskPackets).toBe(1);
		expect(report.items[0]?.packetTitle).toBe(
			"Signal risk repair - ApplyKit workflow failures",
		);
		expect(report.items[0]?.nextAction).toContain("Verify the external repair");
	});

	test("does not count reviewed kickoff proof packets as unworked", () => {
		const report = buildPacketFollowThroughReport({
			today: TODAY,
			projects: [
				project({
					id: "project-cost-tracker",
					title: "cost-tracker",
					operatingQueue: "Resume Now",
				}),
			],
			packets: [
				packet({
					id: "packet-kickoff",
					title: "Kickoff: cost-tracker",
					localProjectIds: ["project-cost-tracker"],
					status: "Review",
					priority: "Later",
					executionTaskIds: ["task-proof"],
					buildLogSessionIds: ["build-log-proof"],
				}),
			],
			tasks: [
				task({
					id: "task-proof",
					title: "Kickoff proof: cost-tracker local checks",
					status: "Done",
					workPacketIds: ["packet-kickoff"],
					localProjectIds: ["project-cost-tracker"],
					completedOn: TODAY,
				}),
			],
		});

		expect(report.orphanKickoffPackets).toBe(1);
		expect(report.unworkedPackets).toBe(0);
		expect(report.items[0]).toMatchObject<Partial<PacketFollowThroughItem>>({
			packetTitle: "Kickoff: cost-tracker",
			projectTitle: "cost-tracker",
			lane: "orphan-kickoff",
			state: "Needs review",
			openTaskCount: 0,
			completedTaskCount: 1,
			buildLogSessionCount: 1,
			nextAction:
				"Accept the linked kickoff proof and close or narrow the packet.",
		});
		expect(report.items[0]?.evidence).toContain("1 completed tasks");
		expect(report.items[0]?.evidence).toContain("1 build log sessions");
	});

	test("can include every open packet when requested", () => {
		const report = buildPacketFollowThroughReport({
			today: TODAY,
			includeAllOpen: true,
			projects: [project({ id: "project-generic", title: "Generic" })],
			packets: [
				packet({
					id: "packet-open",
					title: "Small cleanup",
					localProjectIds: ["project-generic"],
					status: "Ready",
					priority: "Later",
				}),
			],
			tasks: [
				task({
					id: "task-open",
					title: "Do the small cleanup",
					workPacketIds: ["packet-open"],
					localProjectIds: ["project-generic"],
				}),
			],
		});

		expect(report.totalOpenPackets).toBe(1);
		expect(report.reportedPackets).toBe(1);
		expect(report.items[0]?.packetTitle).toBe("Small cleanup");
	});
});

function project(
	overrides: Partial<ControlTowerProjectRecord>,
): ControlTowerProjectRecord {
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
		category: "Dev Tool",
		operatingQueue: "Resume Now",
		nextReviewDate: TODAY,
		evidenceFreshness: "Fresh",
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
