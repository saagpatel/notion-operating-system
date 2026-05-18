import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	buildStaleActiveRescueItems,
	calculateControlTowerMetrics,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
	type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	toBuildSessionRecord,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";
import {
	requirePhase5ExternalSignals,
	type ExternalSignalEventRecord,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";
import {
	attachExistingKickoffPackets,
	classifyOrphan,
} from "./orphan-classification.js";
import {
	toExecutionTaskRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
	isExecutionTaskClosed,
	isWorkPacketClosed,
	type ExecutionTaskRecord,
	type WorkPacketRecord,
} from "./local-portfolio-execution.js";
import { buildMorningBriefPriorityProjects } from "./morning-brief.js";

export interface OperatorBriefCommandOptions {
	today?: string;
	config?: string;
	lookbackDays?: number;
	packetStaleDays?: number;
}

export interface PacketStalenessItem {
	packetId: string;
	packetTitle: string;
	packetUrl: string;
	projectTitle: string;
	openTaskCount: number;
	taskActivityAgeDays: number | null;
	isOverdue: boolean;
	isAtRisk: boolean;
	nextAction: string;
}

export async function runOperatorBriefCommand(
	options: OperatorBriefCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for operator-brief",
	);
	const today = options.today ?? losAngelesToday();
	const lookbackDays = options.lookbackDays ?? 7;
	const packetStaleDays = options.packetStaleDays ?? 14;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const api = new DirectNotionClient(token);
	const phase5 = requirePhase5ExternalSignals(config);

	const [projectSchema, eventSchema, packetSchema, taskSchema, buildPages] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(phase5.events.dataSourceId),
		config.phase2Execution
			? api.retrieveDataSource(config.phase2Execution.packets.dataSourceId)
			: Promise.resolve(undefined),
		config.phase2Execution
			? api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId)
			: Promise.resolve(undefined),
		fetchAllPages(api, config.relatedDataSources.buildLogId, "Session Title"),
	]);
	const [projectPages, eventPages, packetPages, taskPages] = await Promise.all([
		fetchAllPages(
			api,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			api,
			phase5.events.dataSourceId,
			eventSchema.titlePropertyName,
		),
		config.phase2Execution
			? fetchAllPages(
					api,
					config.phase2Execution.packets.dataSourceId,
					packetSchema?.titlePropertyName ?? "Name",
				)
			: Promise.resolve([]),
		config.phase2Execution
			? fetchAllPages(
					api,
					config.phase2Execution.tasks.dataSourceId,
					taskSchema?.titlePropertyName ?? "Name",
				)
			: Promise.resolve([]),
	]);

	const projects = projectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);
	const recentBuildSessions = buildPages
		.map((page) => toBuildSessionRecord(page))
		.filter(
			(session) =>
				session.sessionDate && diffDays(session.sessionDate, today) <= 7,
		);
	const metrics = calculateControlTowerMetrics(
		projects,
		recentBuildSessions,
		today,
	);
	const events = eventPages
		.map((page) => toExternalSignalEventRecord(page))
		.filter((event) => diffDays(event.occurredAt, today) <= lookbackDays);
	const projectIndex = new Map(projects.map((project) => [project.id, project.title]));
	const activeProjectIds = new Set(
		projects
			.filter((project) => !["Cold Storage", "Parked"].includes(project.currentState))
			.map((project) => project.id),
	);
	const coveredProjectIds = new Set(
		eventPages
			.map((page) => toExternalSignalEventRecord(page))
			.filter((event) => diffDays(event.occurredAt, today) <= 7)
			.flatMap((event) => event.localProjectIds),
	);
	const priorityProjects = buildMorningBriefPriorityProjects({
		events,
		projectIndex,
		activeProjectIds,
		coveredProjectIds,
	});
	const staleActive = buildStaleActiveRescueItems(projects, today);
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	const taskCreatedAtById = new Map(
		taskPages.map((page) => [page.id, page.createdTime ?? ""]),
	);
	const packetStalenessItems = buildPacketStalenessItems({
		today,
		projects,
		packets,
		tasks,
		taskCreatedAtById,
		staleAfterDays: packetStaleDays,
	});
	const orphanResults = attachExistingKickoffPackets(
		projects
			.filter(isOperatingOrphan)
			.map((project) => classifyOrphan(project, today)),
		packets,
	);
	const actionableOrphans = orphanResults.filter(
		(result) =>
			result.disposition === "viable_needs_kickoff" &&
			!result.existingKickoffPacketId,
	);
	const overdueProjects = projects
		.filter((project) => project.nextReviewDate && project.nextReviewDate <= today)
		.sort((left, right) =>
			(left.nextReviewDate || "").localeCompare(right.nextReviewDate || ""),
		)
		.slice(0, 10);
	const markdown = renderOperatorBrief({
		today,
		metrics,
		priorityProjects,
		staleActiveCount: staleActive.length,
		actionableOrphans: actionableOrphans.length,
		orphansWithKickoff: orphanResults.filter((result) => result.existingKickoffPacketId)
			.length,
		packetStaleDays,
		packetStalenessItems,
		overdueProjects,
	});

	console.log(
		JSON.stringify(
			{
				ok: true,
				today,
				totalProjects: metrics.totalProjects,
				overdueReviews: metrics.overdueReviews,
				topRiskProjects: priorityProjects.slice(0, 3).map((project) => project.projectName),
				staleActiveProjects: staleActive.length,
				actionableOrphans: actionableOrphans.length,
				orphansWithKickoff: orphanResults.filter(
					(result) => result.existingKickoffPacketId,
				).length,
				staleTaskPackets: packetStalenessItems.length,
				atRiskPackets: packetStalenessItems.filter((item) => item.isAtRisk)
					.length,
			},
			null,
			2,
		),
	);
	console.log("\n" + markdown);
}

export function renderOperatorBrief(input: {
	today: string;
	metrics: ReturnType<typeof calculateControlTowerMetrics>;
	priorityProjects: Array<{
		projectName: string;
		score: number;
		nextAction: string;
	}>;
	staleActiveCount: number;
	actionableOrphans: number;
	orphansWithKickoff: number;
	packetStaleDays: number;
	packetStalenessItems: PacketStalenessItem[];
	overdueProjects: ControlTowerProjectRecord[];
}): string {
	const atRiskPackets = input.packetStalenessItems.filter((item) => item.isAtRisk);
	const lines = [
		`## Operator Brief — ${input.today}`,
		"",
		"### Now",
		`- Review backlog: ${input.metrics.overdueReviews} overdue projects.`,
		`- Stale active projects: ${input.staleActiveCount}.`,
		`- Orphans needing first kickoff: ${input.actionableOrphans}.`,
		`- Orphans already routed to kickoff packets: ${input.orphansWithKickoff}.`,
		`- Packet staleness: ${input.packetStalenessItems.length} packet(s) stale by task activity; ${atRiskPackets.length} at risk.`,
		"",
		"### Top Signal Risks",
		...formatPriorityProjects(input.priorityProjects.slice(0, 5)),
		"",
		"### Packet Staleness",
		...formatPacketStalenessItems(input.packetStalenessItems, input.packetStaleDays),
		"",
		"### Review Recovery",
		...formatReviewProjects(input.overdueProjects),
		"",
		"### Next Commands",
		"- `npm run control-tower:operator-brief`",
		"- `npm run control-tower:packet-follow-through`",
		"- `npm run signals:morning-brief -- --lookback-days 7 --live`",
		"- `npm run control-tower:review-packet -- --live`",
	];
	return lines.join("\n");
}

export function buildPacketStalenessItems(input: {
	today: string;
	projects: ControlTowerProjectRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById?: Map<string, string>;
	staleAfterDays?: number;
	limit?: number;
}): PacketStalenessItem[] {
	const staleAfterDays = input.staleAfterDays ?? 14;
	const projectById = new Map(input.projects.map((project) => [project.id, project]));
	const tasksByPacketId = groupTasksByPacketId(input.tasks);
	return input.packets
		.filter((packet) => !isWorkPacketClosed(packet.status))
		.map((packet) => {
			const tasks = tasksByPacketId.get(packet.id) ?? [];
			const openTasks = tasks.filter((task) => !isExecutionTaskClosed(task.status));
			const latestTaskActivity = latestTaskActivityDate({
				tasks,
				taskCreatedAtById: input.taskCreatedAtById ?? new Map(),
			});
			const taskActivityAgeDays = latestTaskActivity
				? diffDays(latestTaskActivity, input.today)
				: null;
			const isTaskStale =
				taskActivityAgeDays === null || taskActivityAgeDays >= staleAfterDays;
			const isOverdue =
				Boolean(packet.targetFinish && packet.targetFinish < input.today) ||
				openTasks.some((task) => task.dueDate && task.dueDate < input.today);
			const project = projectById.get(packet.localProjectIds[0] ?? "");
			return {
				packetId: packet.id,
				packetTitle: packet.title,
				packetUrl: packet.url,
				projectTitle: project?.title ?? "Unlinked project",
				openTaskCount: openTasks.length,
				taskActivityAgeDays,
				isOverdue,
				isAtRisk: isTaskStale && isOverdue,
				nextAction: buildPacketStalenessNextAction({
					packet,
					openTasks,
					isOverdue,
					taskActivityAgeDays,
				}),
			};
		})
		.filter(
			(item) =>
				item.taskActivityAgeDays === null ||
				item.taskActivityAgeDays >= staleAfterDays ||
				item.isAtRisk,
		)
		.sort(comparePacketStalenessItems)
		.slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);
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

function latestTaskActivityDate(input: {
	tasks: ExecutionTaskRecord[];
	taskCreatedAtById: Map<string, string>;
}): string {
	const dates = input.tasks
		.flatMap((task) => [
			task.completedOn,
			normalizeDate(task.lastEditedTime ?? ""),
			normalizeDate(input.taskCreatedAtById.get(task.id) ?? ""),
		])
		.filter((date) => date.length > 0)
		.sort();
	return dates.at(-1) ?? "";
}

function normalizeDate(value: string): string {
	return value.slice(0, 10);
}

function buildPacketStalenessNextAction(input: {
	packet: WorkPacketRecord;
	openTasks: ExecutionTaskRecord[];
	isOverdue: boolean;
	taskActivityAgeDays: number | null;
}): string {
	if (input.openTasks.length === 0) {
		return "Create one concrete next task or close the packet.";
	}
	const firstTask = input.openTasks[0];
	if (input.isOverdue) {
		return `Recover overdue task: ${firstTask?.title ?? input.packet.title}.`;
	}
	if (input.taskActivityAgeDays === null) {
		return "Add a dated task touchpoint or close the packet.";
	}
	return `Refresh task evidence for ${firstTask?.title ?? input.packet.title}.`;
}

function comparePacketStalenessItems(
	left: PacketStalenessItem,
	right: PacketStalenessItem,
): number {
	return (
		Number(right.isAtRisk) - Number(left.isAtRisk) ||
		Number(right.isOverdue) - Number(left.isOverdue) ||
		stalenessSortValue(right) - stalenessSortValue(left) ||
		left.packetTitle.localeCompare(right.packetTitle)
	);
}

function stalenessSortValue(item: PacketStalenessItem): number {
	return item.taskActivityAgeDays ?? Number.MAX_SAFE_INTEGER;
}

function formatPriorityProjects(
	projects: Array<{ projectName: string; score: number; nextAction: string }>,
): string[] {
	if (projects.length === 0) {
		return ["- No priority signal risks in the lookback window."];
	}
	return projects.map(
		(project) =>
			`- ${project.projectName} — score ${project.score}. Next: ${project.nextAction}`,
	);
}

function formatReviewProjects(projects: ControlTowerProjectRecord[]): string[] {
	if (projects.length === 0) {
		return ["- No overdue review projects."];
	}
	return projects.map((project) => {
		const date = project.nextReviewDate || "unknown date";
		const next = project.nextMove || "define the next concrete move";
		return `- ${project.title} — review due ${date}. Next: ${next}`;
	});
}

function formatPacketStalenessItems(
	items: PacketStalenessItem[],
	staleAfterDays: number,
): string[] {
	if (items.length === 0) {
		return [`- No packets are stale by task activity at ${staleAfterDays}+ days.`];
	}
	return items.slice(0, 5).map((item) => {
		const age =
			item.taskActivityAgeDays === null
				? "no task activity"
				: `${item.taskActivityAgeDays} days since task activity`;
		const risk = item.isAtRisk ? "At risk" : "Watch";
		return `- ${risk}: ${item.projectTitle} — ${item.packetTitle} — ${age}; ${item.openTaskCount} open task(s). Next: ${item.nextAction}`;
	});
}

function isOperatingOrphan(project: ControlTowerProjectRecord): boolean {
	return (
		project.buildSessionCount === 0 &&
		project.relatedResearchCount === 0 &&
		project.supportingSkillsCount === 0 &&
		project.linkedToolCount === 0
	);
}

function diffDays(fromDate: string, toDate: string): number {
	const from = new Date(`${fromDate}T00:00:00Z`);
	const to = new Date(`${toDate}T00:00:00Z`);
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
