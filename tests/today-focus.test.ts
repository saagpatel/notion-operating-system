import { describe, expect, test } from "vitest";

import {
	TODAY_FOCUS_END,
	TODAY_FOCUS_START,
	buildTodayFocusReport,
} from "../src/notion/today-focus.js";
import type { PacketFollowThroughReport } from "../src/notion/packet-follow-through.js";
import type {
	PacketPrioritizerReport,
	PacketPriorityItem,
} from "../src/notion/packet-prioritizer.js";

describe("today focus", () => {
	test("renders a daily focus section from packet priority and follow-through pressure", () => {
		const report = buildTodayFocusReport({
			today: "2026-05-18",
			priorityReport: priorityReport([
				packetItem({
					packetTitle: "AIWorkFlow - Notion-only production packet",
					projectTitle: "AIWorkFlow",
					compositeScore: 137,
					nextAction: "Advance next task: Test production experience.",
				}),
				packetItem({
					packetTitle: "DevToolsTranslator - release blocker packet",
					projectTitle: "DevToolsTranslator",
					compositeScore: 136,
					nextAction: "Advance next task: Resolve updater signature blocker.",
				}),
			]),
			followThroughReport: followThroughReport({
				blockedPackets: 5,
				overduePackets: 17,
				unworkedPackets: 0,
			}),
		});

		expect(report.markdown).toContain(TODAY_FOCUS_START);
		expect(report.markdown).toContain("## Daily Focus - 2026-05-18");
		expect(report.markdown).toContain("AIWorkFlow - AIWorkFlow - Notion-only production packet - score 137");
		expect(report.markdown).toContain("Blocked packet pressure: 5");
		expect(report.markdown).toContain("Work existing packets before creating new ones");
		expect(report.markdown).toContain(TODAY_FOCUS_END);
	});
});

function priorityReport(items: PacketPriorityItem[]): PacketPrioritizerReport {
	return {
		today: "2026-05-18",
		totalOpenPackets: 21,
		reportedPackets: items.length,
		items,
		markdown: "",
	};
}

function followThroughReport(
	overrides: Partial<PacketFollowThroughReport>,
): PacketFollowThroughReport {
	return {
		today: "2026-05-18",
		totalOpenPackets: 21,
		reportedPackets: 12,
		orphanKickoffPackets: 0,
		signalRiskPackets: 0,
		blockedPackets: 0,
		overduePackets: 0,
		unworkedPackets: 0,
		items: [],
		markdown: "",
		...overrides,
	};
}

function packetItem(overrides: Partial<PacketPriorityItem>): PacketPriorityItem {
	return {
		packetId: "packet",
		packetTitle: "Packet",
		packetUrl: "https://notion.example/packet",
		projectId: "project",
		projectTitle: "Project",
		projectUrl: "https://notion.example/project",
		status: "Ready",
		priority: "Now",
		openTaskCount: 1,
		compositeScore: 100,
		factors: {
			recommendationScore: 90,
			recommendationSource: "stored",
			signalSeverity: "None",
			signalScore: 1,
			evidenceFreshness: "Fresh",
			evidenceScore: 1,
			taskStalenessDays: 7,
			taskStalenessScore: 1,
		},
		rationale: [],
		nextAction: "Advance the next task.",
		...overrides,
	};
}
