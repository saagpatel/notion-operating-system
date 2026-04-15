import { loadRuntimeConfig } from "../config/runtime-config.js";
import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import { mergeManagedSection as mergeManagedSectionValue } from "../utils/markdown.js";
import {
	extractNotionIdFromUrl,
	normalizeNotionId,
} from "../utils/notion-id.js";
import type {
	ControlTowerBuildSessionRecord,
	ControlTowerProjectRecord,
	LocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";

export const DEFAULT_LOCAL_PORTFOLIO_EXECUTION_VIEWS_PATH =
	"./config/local-portfolio-execution-views.json";

export interface ExecutionDataSourceRef {
	name: string;
	databaseUrl: string;
	databaseId: string;
	dataSourceId: string;
	destinationAlias: string;
}

export interface ExecutionMetrics {
	openDecisions: number;
	nowPackets: number;
	standbyPackets: number;
	blockedPackets: number;
	blockedTasks: number;
	overdueTasks: number;
	tasksCompletedThisWeek: number;
	packetsCompletedThisWeek: number;
	rolloverPackets: number;
	projectsWithExecutionDrift: number;
	wipViolations: string[];
}

export interface ProjectDecisionRecord {
	id: string;
	url: string;
	title: string;
	status: string;
	decisionType: string;
	localProjectIds: string[];
	decisionOwnerIds: string[];
	proposedOn: string;
	decidedOn: string;
	revisitBy: string;
	optionsConsidered: string;
	chosenOption: string;
	rationale: string;
	expectedImpact: string;
	buildLogSessionIds: string[];
}

export interface WorkPacketRecord {
	id: string;
	url: string;
	title: string;
	status: string;
	packetType: string;
	priority: string;
	ownerIds: string[];
	localProjectIds: string[];
	drivingDecisionIds: string[];
	goal: string;
	definitionOfDone: string;
	whyNow: string;
	targetStart: string;
	targetFinish: string;
	estimatedSize: string;
	rolloverCount: number;
	executionTaskIds: string[];
	buildLogSessionIds: string[];
	weeklyReviewIds: string[];
	blockerSummary: string;
}

export interface ExecutionTaskRecord {
	id: string;
	url: string;
	title: string;
	status: string;
	assigneeIds: string[];
	dueDate: string;
	priority: string;
	taskType: string;
	workPacketIds: string[];
	localProjectIds: string[];
	estimate: string;
	completedOn: string;
	taskNotes: string;
}

export interface LocalPortfolioExecutionViewSpec {
	name: string;
	viewId?: string;
	type: "table" | "board" | "gallery";
	purpose: string;
	configure: string;
}

export interface LocalPortfolioExecutionViewCollection {
	key: "decisions" | "packets" | "tasks";
	database: ExecutionDataSourceRef;
	views: LocalPortfolioExecutionViewSpec[];
}

export interface LocalPortfolioExecutionViewPlan {
	version: 1;
	strategy: {
		primary: "notion_mcp";
		fallback: "playwright";
		notes: string[];
	};
	collections: LocalPortfolioExecutionViewCollection[];
}

export interface ProjectExecutionContext {
	project: ControlTowerProjectRecord;
	activePacket?: WorkPacketRecord;
	standbyPacket?: WorkPacketRecord;
	openDecisions: ProjectDecisionRecord[];
	blockedTasks: ExecutionTaskRecord[];
	dueTasks: ExecutionTaskRecord[];
	recentBuildSessions: ControlTowerBuildSessionRecord[];
	packetHistory: WorkPacketRecord[];
}

export function requirePhase2Execution(
	config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase2Execution"]> {
	if (!config.phase2Execution) {
		throw new AppError("Control tower config is missing phase2Execution");
	}

	return config.phase2Execution;
}

export async function loadLocalPortfolioExecutionViewPlan(
	filePath = loadRuntimeConfig().paths.executionViewsPath,
): Promise<LocalPortfolioExecutionViewPlan> {
	const raw = await readJsonFile<unknown>(filePath);
	return parseLocalPortfolioExecutionViewPlan(raw);
}

export function parseLocalPortfolioExecutionViewPlan(
	raw: unknown,
): LocalPortfolioExecutionViewPlan {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio execution views config must be an object",
		);
	}

	const plan = raw as Record<string, unknown>;
	if (plan.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio execution views config version "${String(plan.version)}"`,
		);
	}

	const strategy = parseStrategy(plan.strategy);
	const collections = parseCollections(plan.collections);
	return {
		version: 1,
		strategy,
		collections,
	};
}

export function calculateExecutionMetrics(input: {
	decisions: ProjectDecisionRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	today: string;
	config: LocalPortfolioControlTowerConfig;
}): ExecutionMetrics {
	const execution = requirePhase2Execution(input.config);
	const nowPackets = input.packets.filter(
		(packet) => packet.priority === "Now" && !isWorkPacketClosed(packet.status),
	);
	const standbyPackets = input.packets.filter(
		(packet) =>
			packet.priority === "Standby" && !isWorkPacketClosed(packet.status),
	);
	const blockedPackets = input.packets.filter(
		(packet) => packet.status === "Blocked",
	);
	const blockedTasks = input.tasks.filter((task) => task.status === "Blocked");
	const overdueTasks = input.tasks.filter(
		(task) =>
			task.dueDate &&
			task.dueDate < input.today &&
			!isExecutionTaskClosed(task.status),
	);
	const tasksCompletedThisWeek = input.tasks.filter(
		(task) => task.completedOn && diffDays(task.completedOn, input.today) <= 7,
	).length;
	const packetsCompletedThisWeek = input.packets.filter(
		(packet) =>
			packet.status === "Done" &&
			packet.targetFinish &&
			diffDays(packet.targetFinish, input.today) <= 7,
	).length;
	const rolloverPackets = input.packets.filter(
		(packet) => packet.rolloverCount > 0,
	).length;

	const driftProjectIds = new Set<string>();
	for (const packet of input.packets) {
		if (packet.localProjectIds.length !== 1) {
			for (const projectId of packet.localProjectIds) {
				driftProjectIds.add(projectId);
			}
		}
	}
	for (const task of input.tasks) {
		if (task.workPacketIds.length !== 1 || task.localProjectIds.length !== 1) {
			for (const projectId of task.localProjectIds) {
				driftProjectIds.add(projectId);
			}
		}
	}

	return {
		openDecisions: input.decisions.filter(
			(decision) => decision.status === "Proposed",
		).length,
		nowPackets: nowPackets.length,
		standbyPackets: standbyPackets.length,
		blockedPackets: blockedPackets.length,
		blockedTasks: blockedTasks.length,
		overdueTasks: overdueTasks.length,
		tasksCompletedThisWeek,
		packetsCompletedThisWeek,
		rolloverPackets,
		projectsWithExecutionDrift: driftProjectIds.size,
		wipViolations: validateExecutionWip({
			packets: input.packets,
			tasks: input.tasks,
			maxNowPackets: execution.wipRules.maxNowPackets,
			maxStandbyPackets: execution.wipRules.maxStandbyPackets,
		}),
	};
}

export function validateExecutionWip(input: {
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	maxNowPackets: number;
	maxStandbyPackets: number;
}): string[] {
	const violations: string[] = [];
	const nowPackets = input.packets.filter(
		(packet) => packet.priority === "Now" && !isWorkPacketClosed(packet.status),
	);
	const standbyPackets = input.packets.filter(
		(packet) =>
			packet.priority === "Standby" && !isWorkPacketClosed(packet.status),
	);

	if (nowPackets.length > input.maxNowPackets) {
		violations.push(
			`WIP violation: ${nowPackets.length} Now packets are active, but the limit is ${input.maxNowPackets}.`,
		);
	}
	if (standbyPackets.length > input.maxStandbyPackets) {
		violations.push(
			`WIP violation: ${standbyPackets.length} Standby packets are active, but the limit is ${input.maxStandbyPackets}.`,
		);
	}

	for (const packet of input.packets) {
		if (
			!isWorkPacketClosed(packet.status) &&
			packet.localProjectIds.length !== 1
		) {
			violations.push(
				`Packet "${packet.title}" must belong to exactly one project.`,
			);
		}
	}

	for (const task of input.tasks) {
		if (
			!isExecutionTaskClosed(task.status) &&
			task.workPacketIds.length !== 1
		) {
			violations.push(
				`Task "${task.title}" must belong to exactly one work packet.`,
			);
		}
	}

	return violations;
}

export function buildProjectExecutionContext(input: {
	project: ControlTowerProjectRecord;
	decisions: ProjectDecisionRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	buildSessions: ControlTowerBuildSessionRecord[];
	today: string;
}): ProjectExecutionContext {
	const projectId = input.project.id;
	const projectDecisions = input.decisions
		.filter((decision) => decision.localProjectIds.includes(projectId))
		.sort((left, right) =>
			compareIsoDate(
				right.proposedOn || right.decidedOn,
				left.proposedOn || left.decidedOn,
			),
		);
	const projectPackets = input.packets
		.filter((packet) => packet.localProjectIds.includes(projectId))
		.sort((left, right) =>
			compareIsoDate(
				right.targetStart || right.targetFinish,
				left.targetStart || left.targetFinish,
			),
		);
	const projectTasks = input.tasks.filter((task) =>
		task.localProjectIds.includes(projectId),
	);

	return {
		project: input.project,
		activePacket: projectPackets.find(
			(packet) =>
				packet.priority === "Now" && !isWorkPacketClosed(packet.status),
		),
		standbyPacket: projectPackets.find(
			(packet) =>
				packet.priority === "Standby" && !isWorkPacketClosed(packet.status),
		),
		openDecisions: projectDecisions
			.filter((decision) => decision.status === "Proposed")
			.slice(0, 5),
		blockedTasks: projectTasks
			.filter((task) => task.status === "Blocked")
			.slice(0, 5),
		dueTasks: projectTasks
			.filter((task) => task.dueDate && !isExecutionTaskClosed(task.status))
			.sort((left, right) => compareIsoDate(left.dueDate, right.dueDate))
			.slice(0, 5),
		recentBuildSessions: input.buildSessions
			.filter((session) => session.localProjectIds.includes(projectId))
			.sort((left, right) =>
				compareIsoDate(right.sessionDate, left.sessionDate),
			)
			.slice(0, 5),
		packetHistory: projectPackets.slice(0, 5),
	};
}

export function renderExecutionBriefSection(
	context: ProjectExecutionContext,
): string {
	const lines = [
		"<!-- codex:notion-execution-brief:start -->",
		"## Execution Brief",
		"",
		`Updated: ${context.project.nextReviewDate || context.project.lastActive || "No review date yet"}`,
		"",
		"### Current Packet",
		...formatPacketBullets(
			context.activePacket ? [context.activePacket] : [],
			(packet) => [
				packet.goal || "Goal not set yet",
				packet.definitionOfDone ? `done means ${packet.definitionOfDone}` : "",
				packet.targetFinish ? `target finish ${packet.targetFinish}` : "",
			],
			"- No active packet yet.",
		),
		"",
		"### Standby Packet",
		...formatPacketBullets(
			context.standbyPacket ? [context.standbyPacket] : [],
			(packet) => [
				packet.whyNow || "Why-now note missing",
				packet.targetStart ? `target start ${packet.targetStart}` : "",
				packet.estimatedSize
					? `size ${packet.estimatedSize.toLowerCase()}`
					: "",
			],
			"- No standby packet yet.",
		),
		"",
		"### Open Decisions",
		...formatDecisionBullets(
			context.openDecisions,
			(decision) => [
				decision.decisionType
					? `type ${decision.decisionType.toLowerCase()}`
					: "",
				decision.revisitBy ? `revisit ${decision.revisitBy}` : "",
				decision.rationale || decision.expectedImpact || "",
			],
			"- No open project-level decisions.",
		),
		"",
		"### Blocked Tasks",
		...formatTaskBullets(
			context.blockedTasks,
			(task) => [
				task.priority ? `priority ${task.priority}` : "",
				task.dueDate ? `due ${task.dueDate}` : "",
				task.taskNotes || "",
			],
			"- No blocked tasks.",
		),
		"",
		"### Next Due Tasks",
		...formatTaskBullets(
			context.dueTasks,
			(task) => [
				task.status ? `status ${task.status.toLowerCase()}` : "",
				task.dueDate ? `due ${task.dueDate}` : "",
				task.estimate ? `estimate ${task.estimate.toLowerCase()}` : "",
			],
			"- No due tasks yet.",
		),
		"",
		"### Recent Build Sessions",
		...formatBuildSessionBullets(
			context.recentBuildSessions,
			"- No recent build sessions linked yet.",
		),
		"",
		"### Packet History",
		...formatPacketBullets(
			context.packetHistory,
			(packet) => [
				packet.status ? `status ${packet.status.toLowerCase()}` : "",
				packet.priority ? `priority ${packet.priority.toLowerCase()}` : "",
				packet.targetFinish ? `finish ${packet.targetFinish}` : "",
			],
			"- No packet history yet.",
		),
		"<!-- codex:notion-execution-brief:end -->",
	];

	return lines.filter(Boolean).join("\n");
}

export function renderExecutionCommandCenterSection(input: {
	metrics: ExecutionMetrics;
	decisions: ProjectDecisionRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	projects: ControlTowerProjectRecord[];
	today: string;
}): string {
	const nowPackets = input.packets
		.filter(
			(packet) =>
				packet.priority === "Now" && !isWorkPacketClosed(packet.status),
		)
		.slice(0, 5);
	const standbyPackets = input.packets
		.filter(
			(packet) =>
				packet.priority === "Standby" && !isWorkPacketClosed(packet.status),
		)
		.slice(0, 5);
	const openDecisions = input.decisions
		.filter((decision) => decision.status === "Proposed")
		.slice(0, 8);
	const blockedTasks = input.tasks
		.filter((task) => task.status === "Blocked")
		.slice(0, 8);
	const overdueTasks = input.tasks
		.filter(
			(task) =>
				task.dueDate &&
				task.dueDate < input.today &&
				!isExecutionTaskClosed(task.status),
		)
		.sort((left, right) => compareIsoDate(left.dueDate, right.dueDate))
		.slice(0, 8);
	const rolloverRisk = input.packets
		.filter(
			(packet) =>
				!isWorkPacketClosed(packet.status) && packet.rolloverCount > 0,
		)
		.sort((left, right) => right.rolloverCount - left.rolloverCount)
		.slice(0, 8);

	const lines = [
		"<!-- codex:notion-execution-command-center:start -->",
		"## Phase 2 Execution System",
		"",
		`- Open decisions: ${input.metrics.openDecisions}`,
		`- Now packets: ${input.metrics.nowPackets}`,
		`- Standby packets: ${input.metrics.standbyPackets}`,
		`- Blocked packets: ${input.metrics.blockedPackets}`,
		`- Blocked tasks: ${input.metrics.blockedTasks}`,
		`- Overdue tasks: ${input.metrics.overdueTasks}`,
		`- Tasks completed this week: ${input.metrics.tasksCompletedThisWeek}`,
		`- Packets completed this week: ${input.metrics.packetsCompletedThisWeek}`,
		`- Rollover packets: ${input.metrics.rolloverPackets}`,
		`- Projects with execution drift: ${input.metrics.projectsWithExecutionDrift}`,
		"",
		"### Current Packet",
		...formatPacketBullets(
			nowPackets,
			(packet) => [
				packet.goal || "Goal not set yet",
				packet.targetFinish ? `target finish ${packet.targetFinish}` : "",
				packet.localProjectIds.length === 1
					? resolveProjectTitle(input.projects, packet.localProjectIds[0] ?? "")
					: `${packet.localProjectIds.length} linked projects`,
			],
			"- No Now packet yet.",
		),
		"",
		"### Standby Packet",
		...formatPacketBullets(
			standbyPackets,
			(packet) => [
				packet.whyNow || "Why-now note missing",
				packet.targetStart ? `target start ${packet.targetStart}` : "",
				packet.localProjectIds.length === 1
					? resolveProjectTitle(input.projects, packet.localProjectIds[0] ?? "")
					: `${packet.localProjectIds.length} linked projects`,
			],
			"- No Standby packet yet.",
		),
		"",
		"### Open Decisions",
		...formatDecisionBullets(
			openDecisions,
			(decision) => [
				decision.decisionType
					? `type ${decision.decisionType.toLowerCase()}`
					: "",
				decision.revisitBy ? `revisit ${decision.revisitBy}` : "",
				decision.localProjectIds.length === 1
					? resolveProjectTitle(
							input.projects,
							decision.localProjectIds[0] ?? "",
						)
					: `${decision.localProjectIds.length} linked projects`,
			],
			"- No open decisions.",
		),
		"",
		"### Blocked Tasks",
		...formatTaskBullets(
			blockedTasks,
			(task) => [
				task.dueDate ? `due ${task.dueDate}` : "",
				task.priority ? `priority ${task.priority}` : "",
				task.workPacketIds.length === 1
					? `packet linked`
					: "packet link missing",
			],
			"- No blocked tasks.",
		),
		"",
		"### Overdue Tasks",
		...formatTaskBullets(
			overdueTasks,
			(task) => [
				task.dueDate ? `due ${task.dueDate}` : "",
				task.status ? `status ${task.status.toLowerCase()}` : "",
				task.priority ? `priority ${task.priority}` : "",
			],
			"- No overdue tasks.",
		),
		"",
		"### Rollover Risk",
		...formatPacketBullets(
			rolloverRisk,
			(packet) => [
				`rollovers ${packet.rolloverCount}`,
				packet.targetFinish ? `target finish ${packet.targetFinish}` : "",
				packet.status ? `status ${packet.status.toLowerCase()}` : "",
			],
			"- No rollover risk right now.",
		),
		"",
		"### WIP Guardrail Status",
		...(input.metrics.wipViolations.length > 0
			? input.metrics.wipViolations.map((violation) => `- ${violation}`)
			: ["- WIP guardrails are currently healthy."]),
		"<!-- codex:notion-execution-command-center:end -->",
	];

	return lines.filter(Boolean).join("\n");
}

export function renderWeeklyExecutionSection(input: {
	weekTitle: string;
	nowPackets: WorkPacketRecord[];
	standbyPackets: WorkPacketRecord[];
	decisionsCommitted: ProjectDecisionRecord[];
	blockedTasks: ExecutionTaskRecord[];
	completedTasks: ExecutionTaskRecord[];
	rolloverPackets: WorkPacketRecord[];
	nextFocus: string[];
	includeNextPhase: boolean;
	phase3Brief?: string;
}): string {
	const lines = [
		"<!-- codex:notion-weekly-execution:start -->",
		"## Phase 2 Execution Summary",
		"",
		`Weekly execution packet: ${input.weekTitle}`,
		"",
		"### Current Packet",
		...formatPacketBullets(
			input.nowPackets,
			(packet) => [
				packet.goal || "Goal not set yet",
				packet.targetFinish ? `target finish ${packet.targetFinish}` : "",
				packet.status ? `status ${packet.status.toLowerCase()}` : "",
			],
			"- No Now packet selected.",
		),
		"",
		"### Standby Packet",
		...formatPacketBullets(
			input.standbyPackets,
			(packet) => [
				packet.whyNow || "Why-now note missing",
				packet.targetStart ? `target start ${packet.targetStart}` : "",
				packet.status ? `status ${packet.status.toLowerCase()}` : "",
			],
			"- No Standby packet selected.",
		),
		"",
		"### Decisions Made",
		...formatDecisionBullets(
			input.decisionsCommitted,
			(decision) => [
				decision.decisionType
					? `type ${decision.decisionType.toLowerCase()}`
					: "",
				decision.decidedOn ? `decided ${decision.decidedOn}` : "",
				decision.chosenOption || decision.rationale || "",
			],
			"- No committed decisions yet this week.",
		),
		"",
		"### Blocked Work",
		...formatTaskBullets(
			input.blockedTasks,
			(task) => [
				task.priority ? `priority ${task.priority}` : "",
				task.dueDate ? `due ${task.dueDate}` : "",
				task.taskNotes || "",
			],
			"- No blocked tasks right now.",
		),
		"",
		"### Completed Task Flow",
		...formatTaskBullets(
			input.completedTasks,
			(task) => [
				task.completedOn ? `completed ${task.completedOn}` : "",
				task.priority ? `priority ${task.priority}` : "",
				task.taskType ? `type ${task.taskType.toLowerCase()}` : "",
			],
			"- No completed tasks recorded yet.",
		),
		"",
		"### Rollover Packets",
		...formatPacketBullets(
			input.rolloverPackets,
			(packet) => [
				`rollovers ${packet.rolloverCount}`,
				packet.targetFinish ? `target finish ${packet.targetFinish}` : "",
				packet.whyNow || "",
			],
			"- No rollover packets yet.",
		),
		"",
		"### Next Focus",
		...(input.nextFocus.length > 0
			? input.nextFocus.map((item) => `- ${item}`)
			: ["- Keep one clear Now packet and one clear Standby packet."]),
	];

	if (input.includeNextPhase && input.phase3Brief) {
		lines.push("", "### Next Phase", input.phase3Brief);
	}

	lines.push("<!-- codex:notion-weekly-execution:end -->");
	return lines.filter(Boolean).join("\n");
}

export function mergeManagedSection(
	existingMarkdown: string,
	sectionMarkdown: string,
	startMarker: string,
	endMarker: string,
): string {
	return mergeManagedSectionValue(
		existingMarkdown,
		sectionMarkdown,
		startMarker,
		endMarker,
	);
}

export function isWorkPacketClosed(status: string): boolean {
	return status === "Done" || status === "Dropped";
}

export function isExecutionTaskClosed(status: string): boolean {
	return status === "Done" || status === "Canceled";
}

function parseStrategy(
	raw: unknown,
): LocalPortfolioExecutionViewPlan["strategy"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio execution views config is missing strategy",
		);
	}

	const strategy = raw as Record<string, unknown>;
	if (strategy.primary !== "notion_mcp") {
		throw new AppError(
			'Local portfolio execution views strategy.primary must be "notion_mcp"',
		);
	}
	if (strategy.fallback !== "playwright") {
		throw new AppError(
			'Local portfolio execution views strategy.fallback must be "playwright"',
		);
	}
	if (
		!Array.isArray(strategy.notes) ||
		strategy.notes.some((entry) => typeof entry !== "string")
	) {
		throw new AppError(
			"Local portfolio execution views strategy.notes must be a string array",
		);
	}

	return {
		primary: "notion_mcp",
		fallback: "playwright",
		notes: strategy.notes as string[],
	};
}

function parseCollections(
	raw: unknown,
): LocalPortfolioExecutionViewCollection[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(
			"Local portfolio execution views config must include collections",
		);
	}

	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(`collections[${index}] must be an object`);
		}
		const value = entry as Record<string, unknown>;
		const key = requiredString(value.key, `collections[${index}].key`);
		if (key !== "decisions" && key !== "packets" && key !== "tasks") {
			throw new AppError(
				`collections[${index}].key must be decisions, packets, or tasks`,
			);
		}
		const database = parseExecutionDataSource(
			value.database,
			`collections[${index}].database`,
		);
		const views = parseExecutionViews(
			value.views,
			`collections[${index}].views`,
		);
		return {
			key,
			database,
			views,
		};
	});
}

function parseExecutionViews(
	raw: unknown,
	fieldName: string,
): LocalPortfolioExecutionViewSpec[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(`${fieldName} must include at least one view`);
	}

	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(`${fieldName}[${index}] must be an object`);
		}
		const value = entry as Record<string, unknown>;
		const type = requiredString(value.type, `${fieldName}[${index}].type`);
		if (type !== "table" && type !== "board" && type !== "gallery") {
			throw new AppError(
				`${fieldName}[${index}].type must be table, board, or gallery`,
			);
		}

		return {
			name: requiredString(value.name, `${fieldName}[${index}].name`),
			viewId: optionalNotionId(value.viewId, `${fieldName}[${index}].viewId`),
			type,
			purpose: requiredString(value.purpose, `${fieldName}[${index}].purpose`),
			configure: requiredString(
				value.configure,
				`${fieldName}[${index}].configure`,
			),
		};
	});
}

export function parseExecutionDataSource(
	raw: unknown,
	fieldName: string,
): ExecutionDataSourceRef {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}

	const value = raw as Record<string, unknown>;
	const databaseUrl = requiredString(
		value.databaseUrl,
		`${fieldName}.databaseUrl`,
	);
	const databaseId = normalizeRequiredNotionId(
		requiredString(value.databaseId, `${fieldName}.databaseId`),
		`${fieldName}.databaseId`,
	);
	const extracted = extractNotionIdFromUrl(databaseUrl);
	if (!extracted || normalizeNotionId(extracted) !== databaseId) {
		throw new AppError(
			`${fieldName}.databaseId does not match ${fieldName}.databaseUrl`,
		);
	}

	return {
		name: requiredString(value.name, `${fieldName}.name`),
		databaseUrl,
		databaseId,
		dataSourceId: normalizeRequiredNotionId(
			requiredString(value.dataSourceId, `${fieldName}.dataSourceId`),
			`${fieldName}.dataSourceId`,
		),
		destinationAlias: requiredString(
			value.destinationAlias,
			`${fieldName}.destinationAlias`,
		),
	};
}

function resolveProjectTitle(
	projects: ControlTowerProjectRecord[],
	projectId: string,
): string {
	return (
		projects.find((project) => project.id === projectId)?.title ??
		"Unknown project"
	);
}

function formatPacketBullets(
	packets: WorkPacketRecord[],
	detailBuilder: (packet: WorkPacketRecord) => string[],
	emptyLine: string,
): string[] {
	if (packets.length === 0) {
		return [emptyLine];
	}

	return packets.map((packet) => {
		const details = detailBuilder(packet).filter(Boolean).join(" | ");
		return `- [${packet.title}](${packet.url})${details ? ` - ${details}` : ""}`;
	});
}

function formatDecisionBullets(
	decisions: ProjectDecisionRecord[],
	detailBuilder: (decision: ProjectDecisionRecord) => string[],
	emptyLine: string,
): string[] {
	if (decisions.length === 0) {
		return [emptyLine];
	}

	return decisions.map((decision) => {
		const details = detailBuilder(decision).filter(Boolean).join(" | ");
		return `- [${decision.title}](${decision.url})${details ? ` - ${details}` : ""}`;
	});
}

function formatTaskBullets(
	tasks: ExecutionTaskRecord[],
	detailBuilder: (task: ExecutionTaskRecord) => string[],
	emptyLine: string,
): string[] {
	if (tasks.length === 0) {
		return [emptyLine];
	}

	return tasks.map((task) => {
		const details = detailBuilder(task).filter(Boolean).join(" | ");
		return `- [${task.title}](${task.url})${details ? ` - ${details}` : ""}`;
	});
}

function formatBuildSessionBullets(
	sessions: ControlTowerBuildSessionRecord[],
	emptyLine: string,
): string[] {
	if (sessions.length === 0) {
		return [emptyLine];
	}

	return sessions.map((session) => {
		const details = [
			session.sessionDate ? `date ${session.sessionDate}` : "",
			session.outcome || "",
		]
			.filter(Boolean)
			.join(" | ");
		return `- [${session.title}](${session.url})${details ? ` - ${details}` : ""}`;
	});
}

function compareIsoDate(left: string, right: string): number {
	if (!left && !right) {
		return 0;
	}
	if (!left) {
		return -1;
	}
	if (!right) {
		return 1;
	}
	return left.localeCompare(right);
}

function diffDays(fromDate: string, toDate: string): number {
	if (!fromDate || !toDate) {
		return Number.POSITIVE_INFINITY;
	}
	const from = new Date(`${fromDate}T00:00:00Z`);
	const to = new Date(`${toDate}T00:00:00Z`);
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new AppError(`${fieldName} must be a non-empty string`);
	}
	return value.trim();
}

function optionalNotionId(
	value: unknown,
	fieldName: string,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new AppError(`${fieldName} must be a non-empty string when provided`);
	}

	const extracted = extractNotionIdFromUrl(value.trim());
	if (!extracted) {
		throw new AppError(`${fieldName} must be a valid Notion ID or view:// URL`);
	}
	return extracted;
}

function normalizeRequiredNotionId(value: string, fieldName: string): string {
	const normalized = normalizeNotionId(value);
	if (!normalized) {
		throw new AppError(`${fieldName} must be a valid Notion ID`);
	}
	return normalized;
}
