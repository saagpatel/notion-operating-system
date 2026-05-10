import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { Publisher } from "../publishing/publisher.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	addDays,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	diffDays,
	loadLocalPortfolioControlTowerConfig,
	type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	relationValue,
	richTextValue,
	selectPropertyValue,
	titleValue,
	toControlTowerProjectRecord,
	upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import {
	isExecutionTaskClosed,
	isWorkPacketClosed,
	type ExecutionTaskRecord,
	type WorkPacketRecord,
} from "./local-portfolio-execution.js";
import {
	toExecutionTaskRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";

export interface PacketFollowThroughCommandOptions {
	live?: boolean;
	today?: string;
	config?: string;
	limit?: number;
	includeAllOpen?: boolean;
	createSignalTasks?: boolean;
}

export type PacketFollowThroughLane =
	| "orphan-kickoff"
	| "signal-risk-repair"
	| "active-packet"
	| "blocked-packet"
	| "overdue-packet"
	| "unworked-packet";

export interface PacketFollowThroughItem {
	packetId: string;
	packetTitle: string;
	packetUrl: string;
	projectId: string;
	projectTitle: string;
	projectUrl: string;
	lane: PacketFollowThroughLane;
	state: string;
	score: number;
	status: string;
	priority: string;
	targetFinish: string;
	openTaskCount: number;
	blockedTaskCount: number;
	overdueTaskCount: number;
	nextAction: string;
	evidence: string[];
}

export interface PacketFollowThroughReport {
	today: string;
	totalOpenPackets: number;
	reportedPackets: number;
	orphanKickoffPackets: number;
	signalRiskPackets: number;
	blockedPackets: number;
	overduePackets: number;
	unworkedPackets: number;
	items: PacketFollowThroughItem[];
	markdown: string;
}

export async function runPacketFollowThroughCommand(
	options: PacketFollowThroughCommandOptions = {},
): Promise<void> {
	const runtimeConfig = loadRuntimeConfig();
	const logger = RunLogger.fromRuntimeConfig(runtimeConfig);
	await logger.init();

	const token = runtimeConfig.notion.token;
	if (!token) {
		throw new Error("NOTION_TOKEN is required for packet follow-through");
	}

	const live = options.live ?? false;
	const createSignalTasks = options.createSignalTasks ?? false;
	if (createSignalTasks && !live) {
		throw new Error("--create-signal-tasks requires --live");
	}
	const today = options.today ?? losAngelesToday();
	const limit = options.limit ?? 12;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	if (!config.phase2Execution) {
		throw new Error("Control tower config is missing phase2Execution");
	}

	const api = new DirectNotionClient(token, logger);
	const [projectSchema, packetSchema, taskSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
		api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
	]);
	const [projectPages, packetPages, taskPages] = await Promise.all([
		fetchAllPages(
			api,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			api,
			config.phase2Execution.packets.dataSourceId,
			packetSchema.titlePropertyName,
		),
		fetchAllPages(
			api,
			config.phase2Execution.tasks.dataSourceId,
			taskSchema.titlePropertyName,
		),
	]);

	const projects = projectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	let tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	let report = buildPacketFollowThroughReport({
		today,
		projects,
		packets,
		tasks,
		limit,
		includeAllOpen: options.includeAllOpen ?? false,
	});
	let signalTasksCreated = 0;

	if (live && createSignalTasks) {
		signalTasksCreated = await createSignalRiskFollowThroughTasks({
			api,
			dataSourceId: config.phase2Execution.tasks.dataSourceId,
			titlePropertyName: taskSchema.titlePropertyName,
			today,
			defaultOwnerUserId: config.phase2Execution.defaultOwnerUserId,
			items: report.items.filter(
				(item) =>
					item.lane === "signal-risk-repair" && item.openTaskCount === 0,
			),
		});
		if (signalTasksCreated > 0) {
			const nextTaskPages = await fetchAllPages(
				api,
				config.phase2Execution.tasks.dataSourceId,
				taskSchema.titlePropertyName,
			);
			tasks = nextTaskPages.map((page) => toExecutionTaskRecord(page));
			report = buildPacketFollowThroughReport({
				today,
				projects,
				packets,
				tasks,
				limit,
				includeAllOpen: options.includeAllOpen ?? false,
			});
		}
	}

	if (live) {
		const registry = await DestinationRegistry.load(
			runtimeConfig.paths.destinationsPath,
		);
		const publisher = new Publisher(api, logger);
		const title = `Packet Follow-Through — ${today}`;
		const fullMarkdown = `---\ntitle: ${title}\n---\n\n${report.markdown}`;
		const tempDir = await mkdtemp(
			path.join(os.tmpdir(), "packet-follow-through-"),
		);
		const filePath = path.join(tempDir, "packet-follow-through.md");
		await writeFile(filePath, fullMarkdown, "utf8");
		try {
			const destination = registry.getDestination(
				config.destinations.buildLogAlias,
			);
			await publisher.publish(destination, {
				destinationAlias: destination.alias,
				inputFile: filePath,
				dryRun: false,
				live: true,
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				live,
				today,
				totalOpenPackets: report.totalOpenPackets,
				reportedPackets: report.reportedPackets,
				orphanKickoffPackets: report.orphanKickoffPackets,
				signalRiskPackets: report.signalRiskPackets,
				blockedPackets: report.blockedPackets,
				overduePackets: report.overduePackets,
				unworkedPackets: report.unworkedPackets,
				signalTasksCreated,
				topPackets: report.items.slice(0, 5).map((item) => ({
					packet: item.packetTitle,
					project: item.projectTitle,
					lane: item.lane,
					state: item.state,
					nextAction: item.nextAction,
				})),
			},
			null,
			2,
		),
	);
	console.log("\n" + report.markdown);
}

export function buildPacketFollowThroughReport(input: {
	today: string;
	projects: ControlTowerProjectRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	limit?: number;
	includeAllOpen?: boolean;
}): PacketFollowThroughReport {
	const projectById = new Map(input.projects.map((project) => [project.id, project]));
	const tasksByPacketId = groupTasksByPacketId(input.tasks);
	const openPackets = input.packets.filter(
		(packet) => !isWorkPacketClosed(packet.status),
	);
	const allItems = openPackets
		.map((packet) =>
			buildFollowThroughItem({
				packet,
				project: resolvePrimaryProject(packet, projectById),
				tasks: tasksByPacketId.get(packet.id) ?? [],
				today: input.today,
			}),
		)
		.filter((item) => input.includeAllOpen || item.score >= 20)
		.sort(comparePacketFollowThroughItems);
	const items = allItems.slice(0, input.limit ?? 12);
	const markdown = renderPacketFollowThroughMarkdown({
		today: input.today,
		totalOpenPackets: openPackets.length,
		items,
		allItems,
	});

	return {
		today: input.today,
		totalOpenPackets: openPackets.length,
		reportedPackets: items.length,
		orphanKickoffPackets: allItems.filter((item) => item.lane === "orphan-kickoff")
			.length,
		signalRiskPackets: allItems.filter(
			(item) => item.lane === "signal-risk-repair",
		).length,
		blockedPackets: allItems.filter((item) => item.blockedTaskCount > 0).length,
		overduePackets: allItems.filter((item) => item.overdueTaskCount > 0).length,
		unworkedPackets: allItems.filter((item) => item.openTaskCount === 0).length,
		items,
		markdown,
	};
}

function buildFollowThroughItem(input: {
	packet: WorkPacketRecord;
	project?: ControlTowerProjectRecord;
	tasks: ExecutionTaskRecord[];
	today: string;
}): PacketFollowThroughItem {
	const openTasks = input.tasks.filter(
		(task) => !isExecutionTaskClosed(task.status),
	);
	const blockedTasks = openTasks.filter((task) => task.status === "Blocked");
	const overdueTasks = openTasks.filter(
		(task) => task.dueDate && task.dueDate < input.today,
	);
	const lane = classifyPacketLane({
		packet: input.packet,
		project: input.project,
		blockedTaskCount: blockedTasks.length,
		overdueTaskCount: overdueTasks.length,
		openTaskCount: openTasks.length,
		today: input.today,
	});
	const state = classifyPacketState({
		packet: input.packet,
		blockedTaskCount: blockedTasks.length,
		overdueTaskCount: overdueTasks.length,
		openTaskCount: openTasks.length,
		today: input.today,
	});
	const score = scorePacketFollowThrough({
		packet: input.packet,
		lane,
		state,
		project: input.project,
		blockedTaskCount: blockedTasks.length,
		overdueTaskCount: overdueTasks.length,
		openTaskCount: openTasks.length,
		today: input.today,
	});

	return {
		packetId: input.packet.id,
		packetTitle: input.packet.title,
		packetUrl: input.packet.url,
		projectId: input.project?.id ?? "",
		projectTitle: input.project?.title ?? "Unlinked project",
		projectUrl: input.project?.url ?? "",
		lane,
		state,
		score,
		status: input.packet.status,
		priority: input.packet.priority,
		targetFinish: input.packet.targetFinish,
		openTaskCount: openTasks.length,
		blockedTaskCount: blockedTasks.length,
		overdueTaskCount: overdueTasks.length,
		nextAction: buildPacketNextAction({
			packet: input.packet,
			project: input.project,
			state,
			lane,
			openTasks,
			blockedTasks,
			overdueTasks,
		}),
		evidence: buildPacketEvidence({
			packet: input.packet,
			project: input.project,
			openTaskCount: openTasks.length,
			blockedTaskCount: blockedTasks.length,
			overdueTaskCount: overdueTasks.length,
			today: input.today,
		}),
	};
}

function classifyPacketLane(input: {
	packet: WorkPacketRecord;
	project?: ControlTowerProjectRecord;
	blockedTaskCount: number;
	overdueTaskCount: number;
	openTaskCount: number;
	today: string;
}): PacketFollowThroughLane {
	const title = input.packet.title.toLowerCase();
	if (title.startsWith("kickoff:") && input.project && isOperatingOrphan(input.project)) {
		return "orphan-kickoff";
	}
	if (title.includes("signal risk repair")) {
		return "signal-risk-repair";
	}
	if (input.blockedTaskCount > 0 || input.packet.status === "Blocked") {
		return "blocked-packet";
	}
	if (
		input.overdueTaskCount > 0 ||
		(input.packet.targetFinish && input.packet.targetFinish < input.today)
	) {
		return "overdue-packet";
	}
	if (input.packet.priority === "Now" || input.packet.status === "In Progress") {
		return "active-packet";
	}
	if (input.openTaskCount === 0) {
		return "unworked-packet";
	}
	return "active-packet";
}

function classifyPacketState(input: {
	packet: WorkPacketRecord;
	blockedTaskCount: number;
	overdueTaskCount: number;
	openTaskCount: number;
	today: string;
}): string {
	if (input.packet.status === "Blocked" || input.blockedTaskCount > 0) {
		return "Blocked";
	}
	if (
		input.overdueTaskCount > 0 ||
		(input.packet.targetFinish && input.packet.targetFinish < input.today)
	) {
		return "Overdue";
	}
	if (input.packet.status === "Review") {
		return "Needs review";
	}
	if (input.packet.status === "In Progress") {
		return "In progress";
	}
	if (input.openTaskCount === 0) {
		return "Needs first task";
	}
	if (input.packet.status === "Ready") {
		return "Ready to start";
	}
	return input.packet.status || "Open";
}

function scorePacketFollowThrough(input: {
	packet: WorkPacketRecord;
	lane: PacketFollowThroughLane;
	state: string;
	project?: ControlTowerProjectRecord;
	blockedTaskCount: number;
	overdueTaskCount: number;
	openTaskCount: number;
	today: string;
}): number {
	let score = 0;
	if (input.lane === "signal-risk-repair") score += 80;
	if (input.lane === "orphan-kickoff") score += 70;
	if (input.lane === "blocked-packet") score += 60;
	if (input.lane === "overdue-packet") score += 50;
	if (input.packet.priority === "Now") score += 30;
	if (input.packet.priority === "Standby") score += 20;
	if (input.packet.status === "In Progress") score += 15;
	if (input.packet.status === "Review") score += 12;
	if (input.blockedTaskCount > 0) score += input.blockedTaskCount * 8;
	if (input.overdueTaskCount > 0) score += input.overdueTaskCount * 6;
	if (input.openTaskCount === 0) score += 10;
	if (input.project?.operatingQueue === "Resume Now") score += 8;
	if (input.project?.operatingQueue === "Worth Finishing") score += 6;
	if (input.packet.targetFinish && input.packet.targetFinish < input.today) {
		score += Math.min(diffDays(input.packet.targetFinish, input.today), 14);
	}
	return score;
}

function buildPacketNextAction(input: {
	packet: WorkPacketRecord;
	project?: ControlTowerProjectRecord;
	state: string;
	lane: PacketFollowThroughLane;
	openTasks: ExecutionTaskRecord[];
	blockedTasks: ExecutionTaskRecord[];
	overdueTasks: ExecutionTaskRecord[];
}): string {
	if (input.lane === "signal-risk-repair") {
		if (input.state === "Needs review") {
			return "Verify the external repair outcome and close or narrow the packet.";
		}
		return "Check the external repair proof, then update the packet with the verified outcome.";
	}
	if (input.lane === "orphan-kickoff") {
		return "Work this existing kickoff packet: add first operating evidence or explicitly defer the project.";
	}
	if (input.blockedTasks[0]) {
		return `Clear blocked task: ${input.blockedTasks[0].title}.`;
	}
	if (input.overdueTasks[0]) {
		return `Recover overdue task: ${input.overdueTasks[0].title}.`;
	}
	if (input.openTasks[0]) {
		return `Advance next task: ${input.openTasks[0].title}.`;
	}
	if (input.project?.nextMove) {
		return `Create one task from project next move: ${input.project.nextMove}.`;
	}
	return "Add one concrete next task or close the packet if it is no longer useful.";
}

function buildPacketEvidence(input: {
	packet: WorkPacketRecord;
	project?: ControlTowerProjectRecord;
	openTaskCount: number;
	blockedTaskCount: number;
	overdueTaskCount: number;
	today: string;
}): string[] {
	const evidence = [
		`Status ${input.packet.status || "unset"}`,
		`priority ${input.packet.priority || "unset"}`,
		`${input.openTaskCount} open tasks`,
	];
	if (input.blockedTaskCount > 0) {
		evidence.push(`${input.blockedTaskCount} blocked tasks`);
	}
	if (input.overdueTaskCount > 0) {
		evidence.push(`${input.overdueTaskCount} overdue tasks`);
	}
	if (input.packet.targetFinish) {
		const suffix =
			input.packet.targetFinish < input.today
				? ` (${diffDays(input.packet.targetFinish, input.today)} days overdue)`
				: "";
		evidence.push(`target finish ${input.packet.targetFinish}${suffix}`);
	}
	if (input.project?.operatingQueue) {
		evidence.push(`queue ${input.project.operatingQueue}`);
	}
	return evidence;
}

function renderPacketFollowThroughMarkdown(input: {
	today: string;
	totalOpenPackets: number;
	items: PacketFollowThroughItem[];
	allItems: PacketFollowThroughItem[];
}): string {
	const lines = [
		`## Packet Follow-Through — ${input.today}`,
		"",
		"### Summary",
		`- Open packets scanned: ${input.totalOpenPackets}`,
		`- Follow-through packets surfaced: ${input.items.length}`,
		`- Orphan kickoff packets: ${
			input.allItems.filter((item) => item.lane === "orphan-kickoff").length
		}`,
		`- Signal-risk repair packets: ${
			input.allItems.filter((item) => item.lane === "signal-risk-repair")
				.length
		}`,
		`- Blocked packets or packets with blocked tasks: ${
			input.allItems.filter((item) => item.blockedTaskCount > 0).length
		}`,
		`- Overdue packets or packets with overdue tasks: ${
			input.allItems.filter((item) => item.overdueTaskCount > 0).length
		}`,
		"",
		"### Ranked Queue",
		...formatPacketFollowThroughRows(input.items),
		"",
		"### Operator Rule",
		"- Work existing kickoff packets before creating new ones.",
		"- Treat signal-risk repair packets as external-proof follow-through: verify the repo or provider result, then close or narrow the packet.",
		"- Convert packets with no open task into one concrete task or close them.",
		"",
		"### Next Commands",
		"- `npm run control-tower:packet-follow-through -- --today " +
			input.today +
			"`",
		"- `npm run governance:orphan-classify -- --today " + input.today + "`",
		"- `npm run control-tower:sync -- --today " + input.today + "`",
	];
	return lines.join("\n");
}

async function createSignalRiskFollowThroughTasks(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	titlePropertyName: string;
	today: string;
	defaultOwnerUserId?: string;
	items: PacketFollowThroughItem[];
}): Promise<number> {
	let created = 0;
	for (const item of input.items) {
		if (!item.projectId) continue;
		const title = `Follow up: ${item.packetTitle}`;
		const markdown = [
			`# ${title}`,
			"",
			`Created by packet-follow-through on ${input.today}.`,
			"",
			"## Immediate next move",
			"",
			`- ${item.nextAction}`,
			"- Record the verified result on the packet, then move the packet to Review or Done.",
			"",
			"## Current evidence",
			"",
			...item.evidence.map((evidence) => `- ${evidence}`),
		].join("\n");
		const result = await upsertPageByTitle({
			api: input.api,
			dataSourceId: input.dataSourceId,
			titlePropertyName: input.titlePropertyName,
			title,
			properties: {
				[input.titlePropertyName]: titleValue(title),
				Status: statusValue("Ready"),
				"Execution State": selectPropertyValue("Ready"),
				Assignee: peopleValue(input.defaultOwnerUserId),
				"Due Date": { date: { start: addDays(input.today, 1) } },
				Priority: selectPropertyValue("P0"),
				"Task Type": selectPropertyValue("Review"),
				"Work Packet": relationValue([item.packetId]),
				"Local Project": relationValue([item.projectId]),
				Estimate: selectPropertyValue("1h"),
				"Task Notes": richTextValue(item.nextAction),
			},
			markdown,
		});
		if (!result.existed) {
			created += 1;
		}
	}
	return created;
}

function formatPacketFollowThroughRows(
	items: PacketFollowThroughItem[],
): string[] {
	if (items.length === 0) {
		return ["- No packet follow-through items need attention."];
	}
	return items.map((item, index) => {
		const packet = item.packetUrl
			? `[${item.packetTitle}](${item.packetUrl})`
			: item.packetTitle;
		const project = item.projectUrl
			? `[${item.projectTitle}](${item.projectUrl})`
			: item.projectTitle;
		const evidence = item.evidence.join("; ");
		return `${index + 1}. ${packet} — ${project} — ${item.state} — ${item.nextAction} (${evidence})`;
	});
}

function groupTasksByPacketId(
	tasks: ExecutionTaskRecord[],
): Map<string, ExecutionTaskRecord[]> {
	const grouped = new Map<string, ExecutionTaskRecord[]>();
	for (const task of tasks) {
		for (const packetId of task.workPacketIds) {
			const existing = grouped.get(packetId) ?? [];
			existing.push(task);
			grouped.set(packetId, existing);
		}
	}
	return grouped;
}

function resolvePrimaryProject(
	packet: WorkPacketRecord,
	projectById: Map<string, ControlTowerProjectRecord>,
): ControlTowerProjectRecord | undefined {
	for (const projectId of packet.localProjectIds) {
		const project = projectById.get(projectId);
		if (project) return project;
	}
	return undefined;
}

function isOperatingOrphan(project: ControlTowerProjectRecord): boolean {
	return (
		project.buildSessionCount === 0 &&
		project.relatedResearchCount === 0 &&
		project.supportingSkillsCount === 0 &&
		project.linkedToolCount === 0
	);
}

function comparePacketFollowThroughItems(
	left: PacketFollowThroughItem,
	right: PacketFollowThroughItem,
): number {
	if (right.score !== left.score) return right.score - left.score;
	if (left.targetFinish !== right.targetFinish) {
		if (!left.targetFinish) return 1;
		if (!right.targetFinish) return -1;
		return left.targetFinish.localeCompare(right.targetFinish);
	}
	return left.packetTitle.localeCompare(right.packetTitle);
}

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
	return {
		people: userId ? [{ id: userId }] : [],
	};
}

function statusValue(value: string): { status: { name: string } } {
	return {
		status: {
			name: value,
		},
	};
}
