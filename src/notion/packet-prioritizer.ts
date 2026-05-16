import { loadRuntimeConfig } from "../config/runtime-config.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	diffDays,
	loadLocalPortfolioControlTowerConfig,
	type EvidenceFreshness,
	type OperatingQueue,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
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
import type {
	ExternalSignalEventRecord,
	ExternalSignalSeverity,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";
import type { IntelligenceProjectRecord } from "./local-portfolio-intelligence.js";
import {
	toIntelligenceProjectRecord,
} from "./local-portfolio-intelligence-live.js";

export interface PacketPrioritizerCommandOptions {
	today?: string;
	config?: string;
	limit?: number;
	lookbackDays?: number;
}

export interface PacketPriorityFactors {
	recommendationScore: number;
	recommendationSource: "stored" | "estimated";
	signalSeverity: ExternalSignalSeverity | "None";
	signalScore: number;
	evidenceFreshness: EvidenceFreshness | "Unknown";
	evidenceScore: number;
	taskStalenessDays: number | null;
	taskStalenessScore: number;
}

export interface PacketPriorityItem {
	packetId: string;
	packetTitle: string;
	packetUrl: string;
	projectId: string;
	projectTitle: string;
	projectUrl: string;
	status: string;
	priority: string;
	openTaskCount: number;
	compositeScore: number;
	factors: PacketPriorityFactors;
	rationale: string[];
	nextAction: string;
}

export interface PacketPrioritizerReport {
	today: string;
	totalOpenPackets: number;
	reportedPackets: number;
	items: PacketPriorityItem[];
	markdown: string;
}

export async function runPacketPrioritizerCommand(
	options: PacketPrioritizerCommandOptions = {},
): Promise<void> {
	const runtimeConfig = loadRuntimeConfig();
	const token = runtimeConfig.notion.token;
	if (!token) {
		throw new Error("NOTION_TOKEN is required for packet-prioritizer");
	}

	const today = options.today ?? losAngelesToday();
	const limit = options.limit ?? 12;
	const lookbackDays = options.lookbackDays ?? 14;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	if (!config.phase2Execution) {
		throw new Error("Control tower config is missing phase2Execution");
	}

	const api = new DirectNotionClient(token);
	const [projectSchema, packetSchema, taskSchema, eventSchema] =
		await Promise.all([
			api.retrieveDataSource(config.database.dataSourceId),
			api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
			api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
			config.phase5ExternalSignals
				? api.retrieveDataSource(config.phase5ExternalSignals.events.dataSourceId)
				: Promise.resolve(undefined),
		]);
	const [projectPages, packetPages, taskPages, eventPages] = await Promise.all([
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
		config.phase5ExternalSignals && eventSchema
			? fetchAllPages(
					api,
					config.phase5ExternalSignals.events.dataSourceId,
					eventSchema.titlePropertyName,
				)
			: Promise.resolve([]),
	]);

	const projects = projectPages.map((page) =>
		applyDerivedSignals(
			toIntelligenceProjectRecord(page),
			config,
			today,
		) as IntelligenceProjectRecord,
	);
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	const taskCreatedAtById = new Map(
		taskPages.map((page) => [page.id, page.createdTime ?? ""]),
	);
	const events = eventPages.map((page) => toExternalSignalEventRecord(page));
	const report = buildPacketPrioritizerReport({
		today,
		projects,
		packets,
		tasks,
		taskCreatedAtById,
		events,
		limit,
		lookbackDays,
	});

	console.log(
		JSON.stringify(
			{
				ok: true,
				today,
				lookbackDays,
				totalOpenPackets: report.totalOpenPackets,
				reportedPackets: report.reportedPackets,
				topPackets: report.items.slice(0, 5).map((item) => ({
					packet: item.packetTitle,
					project: item.projectTitle,
					score: item.compositeScore,
					nextAction: item.nextAction,
				})),
			},
			null,
			2,
		),
	);
	console.log("\n" + report.markdown);
}

export function buildPacketPrioritizerReport(input: {
	today: string;
	projects: IntelligenceProjectRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById?: Map<string, string>;
	events?: ExternalSignalEventRecord[];
	limit?: number;
	lookbackDays?: number;
}): PacketPrioritizerReport {
	const projectById = new Map(input.projects.map((project) => [project.id, project]));
	const tasksByPacketId = groupTasksByPacketId(input.tasks);
	const eventsByProjectId = groupEventsByProjectId(input.events ?? []);
	const totalOpenPackets = input.packets.filter(
		(packet) => !isWorkPacketClosed(packet.status),
	).length;
	const items = input.packets
		.filter((packet) => !isWorkPacketClosed(packet.status))
		.map((packet) => {
			const project = resolvePrimaryProject(packet, projectById);
			return buildPacketPriorityItem({
				packet,
				project,
				tasks: tasksByPacketId.get(packet.id) ?? [],
				taskCreatedAtById: input.taskCreatedAtById ?? new Map(),
				events: project ? eventsByProjectId.get(project.id) ?? [] : [],
				today: input.today,
				lookbackDays: input.lookbackDays ?? 14,
			});
		})
		.filter((item) => item.projectId)
		.sort(comparePacketPriorityItems)
		.slice(0, input.limit ?? 12);

	const markdown = renderPacketPrioritizerMarkdown({
		today: input.today,
		totalOpenPackets,
		items,
	});

	return {
		today: input.today,
		totalOpenPackets,
		reportedPackets: items.length,
		items,
		markdown,
	};
}

function buildPacketPriorityItem(input: {
	packet: WorkPacketRecord;
	project?: IntelligenceProjectRecord;
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById: Map<string, string>;
	events: ExternalSignalEventRecord[];
	today: string;
	lookbackDays: number;
}): PacketPriorityItem {
	const openTasks = input.tasks.filter(
		(task) => !isExecutionTaskClosed(task.status),
	);
	const factors = buildPriorityFactors({
		project: input.project,
		tasks: input.tasks,
		taskCreatedAtById: input.taskCreatedAtById,
		events: input.events,
		today: input.today,
		lookbackDays: input.lookbackDays,
	});
	const statusFactor = statusMultiplier(input.packet.status);
	const priorityFactor = priorityMultiplier(input.packet.priority);
	const compositeScore = Math.round(
		factors.recommendationScore *
			factors.signalScore *
			factors.evidenceScore *
			factors.taskStalenessScore *
			statusFactor *
			priorityFactor,
	);

	return {
		packetId: input.packet.id,
		packetTitle: input.packet.title,
		packetUrl: input.packet.url,
		projectId: input.project?.id ?? "",
		projectTitle: input.project?.title ?? "Unlinked project",
		projectUrl: input.project?.url ?? "",
		status: input.packet.status,
		priority: input.packet.priority,
		openTaskCount: openTasks.length,
		compositeScore,
		factors,
		rationale: buildRationale({
			project: input.project,
			openTaskCount: openTasks.length,
			factors,
		}),
		nextAction: buildPriorityNextAction({
			packet: input.packet,
			project: input.project,
			openTasks,
			factors,
		}),
	};
}

function buildPriorityFactors(input: {
	project?: IntelligenceProjectRecord;
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById: Map<string, string>;
	events: ExternalSignalEventRecord[];
	today: string;
	lookbackDays: number;
}): PacketPriorityFactors {
	const recommendation = recommendationFactor(input.project);
	const signalSeverity = highestRecentSeverity({
		events: input.events,
		project: input.project,
		today: input.today,
		lookbackDays: input.lookbackDays,
	});
	const taskStalenessDays = taskCreatedStalenessDays({
		tasks: input.tasks,
		taskCreatedAtById: input.taskCreatedAtById,
		today: input.today,
	});
	const evidenceFreshness = input.project?.evidenceFreshness ?? "Unknown";
	return {
		recommendationScore: recommendation.score,
		recommendationSource: recommendation.source,
		signalSeverity,
		signalScore: signalMultiplier(signalSeverity),
		evidenceFreshness,
		evidenceScore: evidenceMultiplier(evidenceFreshness),
		taskStalenessDays,
		taskStalenessScore: taskStalenessMultiplier(taskStalenessDays),
	};
}

function recommendationFactor(project?: IntelligenceProjectRecord): {
	score: number;
	source: "stored" | "estimated";
} {
	if (typeof project?.recommendationScore === "number") {
		return { score: clamp(project.recommendationScore, 30, 100), source: "stored" };
	}
	const estimates: Record<OperatingQueue, number> = {
		"Resume Now": 76,
		"Worth Finishing": 68,
		"Needs Review": 58,
		"Needs Decision": 54,
		Watch: 46,
		"Cold Storage": 34,
		Shipped: 30,
	};
	const queue = project?.operatingQueue;
	return {
		score: queue && queue in estimates ? estimates[queue] : 45,
		source: "estimated",
	};
}

function highestRecentSeverity(input: {
	events: ExternalSignalEventRecord[];
	project?: IntelligenceProjectRecord;
	today: string;
	lookbackDays: number;
}): ExternalSignalSeverity | "None" {
	let highest: ExternalSignalSeverity | "None" = "None";
	for (const event of input.events) {
		if (
			event.occurredAt &&
			diffDays(event.occurredAt.slice(0, 10), input.today) > input.lookbackDays
		) {
			continue;
		}
		if (severityRank(event.severity) > severityRank(highest)) {
			highest = event.severity;
		}
	}
	if (
		highest === "None" &&
		(input.project?.recentFailedWorkflowRuns ?? 0) > 0
	) {
		return "Risk";
	}
	return highest;
}

function taskCreatedStalenessDays(input: {
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById: Map<string, string>;
	today: string;
}): number | null {
	if (input.tasks.length === 0) return null;
	const createdDates = input.tasks
		.map((task) => input.taskCreatedAtById.get(task.id)?.slice(0, 10) ?? "")
		.filter(Boolean)
		.sort();
	const latest = createdDates.at(-1);
	if (!latest) return 0;
	return Math.max(0, diffDays(latest, input.today));
}

function signalMultiplier(severity: ExternalSignalSeverity | "None"): number {
	switch (severity) {
		case "Risk":
			return 1.4;
		case "Watch":
			return 1.15;
		case "Info":
			return 1;
		case "None":
			return 0.9;
	}
}

function evidenceMultiplier(freshness: EvidenceFreshness | "Unknown"): number {
	switch (freshness) {
		case "Stale":
			return 1.35;
		case "Aging":
			return 1.15;
		case "Fresh":
			return 0.95;
		case "Unknown":
			return 1.05;
	}
}

function taskStalenessMultiplier(days: number | null): number {
	if (days === null) return 1.35;
	if (days >= 30) return 1.3;
	if (days >= 14) return 1.2;
	if (days >= 7) return 1.1;
	return 1;
}

function priorityMultiplier(priority: string): number {
	if (priority === "Now") return 1.25;
	if (priority === "Standby") return 1.1;
	return 1;
}

function statusMultiplier(status: string): number {
	if (status === "Blocked") return 1.25;
	if (status === "In Progress") return 1.15;
	if (status === "Review") return 1.08;
	return 1;
}

function buildRationale(input: {
	project?: IntelligenceProjectRecord;
	openTaskCount: number;
	factors: PacketPriorityFactors;
}): string[] {
	const recLabel =
		input.factors.recommendationSource === "stored"
			? "recommendation score"
			: "estimated queue score";
	const parts = [
		`${recLabel} ${input.factors.recommendationScore}`,
		`signal ${input.factors.signalSeverity}`,
		`evidence ${input.factors.evidenceFreshness}`,
	];
	if (input.factors.taskStalenessDays === null) {
		parts.push("no task created yet");
	} else {
		parts.push(`latest task ${input.factors.taskStalenessDays} days old`);
	}
	if (input.project?.operatingQueue) {
		parts.push(`queue ${input.project.operatingQueue}`);
	}
	if (input.openTaskCount > 0) {
		parts.push(`${input.openTaskCount} open tasks`);
	}
	return parts;
}

function buildPriorityNextAction(input: {
	packet: WorkPacketRecord;
	project?: IntelligenceProjectRecord;
	openTasks: ExecutionTaskRecord[];
	factors: PacketPriorityFactors;
}): string {
	if (input.factors.signalSeverity === "Risk") {
		return "Verify the current risk signal, then advance or narrow this packet.";
	}
	if (input.factors.taskStalenessDays === null) {
		return "Create the first concrete task for this packet or close it if stale.";
	}
	if (input.openTasks[0]) {
		return `Advance next task: ${input.openTasks[0].title}.`;
	}
	if (input.project?.nextMove) {
		return `Create one task from project next move: ${input.project.nextMove}.`;
	}
	return "Pick one concrete next action, assign it, and update the packet.";
}

function renderPacketPrioritizerMarkdown(input: {
	today: string;
	totalOpenPackets: number;
	items: PacketPriorityItem[];
}): string {
	const lines = [
		`## Packet Prioritizer - ${input.today}`,
		"",
		"### Summary",
		`- Open packets scanned: ${input.totalOpenPackets}`,
		`- Ranked packets shown: ${input.items.length}`,
		"- Score uses existing recommendation, signal severity, evidence freshness, and task-staleness signals.",
		"",
		"### Ranked Packets",
		...formatPriorityRows(input.items),
		"",
		"### Operator Rule",
		"- Start at the highest composite score unless a human constraint overrides it.",
		"- Prefer packets with current risk signals and stale execution evidence over broad cleanup work.",
		"- Do not add new Notion fields for this prioritizer pass.",
	];
	return lines.join("\n");
}

function formatPriorityRows(items: PacketPriorityItem[]): string[] {
	if (items.length === 0) {
		return ["- No open packets found."];
	}
	return items.map((item, index) => {
		const packet = item.packetUrl
			? `[${item.packetTitle}](${item.packetUrl})`
			: item.packetTitle;
		const project = item.projectUrl
			? `[${item.projectTitle}](${item.projectUrl})`
			: item.projectTitle;
		return `${index + 1}. ${packet} - ${project} - score ${item.compositeScore} - ${item.nextAction} (${item.rationale.join("; ")})`;
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

function groupEventsByProjectId(
	events: ExternalSignalEventRecord[],
): Map<string, ExternalSignalEventRecord[]> {
	const grouped = new Map<string, ExternalSignalEventRecord[]>();
	for (const event of events) {
		for (const projectId of event.localProjectIds) {
			const existing = grouped.get(projectId) ?? [];
			existing.push(event);
			grouped.set(projectId, existing);
		}
	}
	return grouped;
}

function resolvePrimaryProject(
	packet: WorkPacketRecord,
	projectById: Map<string, IntelligenceProjectRecord>,
): IntelligenceProjectRecord | undefined {
	for (const projectId of packet.localProjectIds) {
		const project = projectById.get(projectId);
		if (project) return project;
	}
	return undefined;
}

function comparePacketPriorityItems(
	left: PacketPriorityItem,
	right: PacketPriorityItem,
): number {
	if (right.compositeScore !== left.compositeScore) {
		return right.compositeScore - left.compositeScore;
	}
	return left.packetTitle.localeCompare(right.packetTitle);
}

function severityRank(severity: ExternalSignalSeverity | "None"): number {
	if (severity === "Risk") return 3;
	if (severity === "Watch") return 2;
	if (severity === "Info") return 1;
	return 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
