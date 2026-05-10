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
import { toWorkPacketRecord } from "./local-portfolio-execution-live.js";
import { buildMorningBriefPriorityProjects } from "./morning-brief.js";

export interface OperatorBriefCommandOptions {
	today?: string;
	config?: string;
	lookbackDays?: number;
}

export async function runOperatorBriefCommand(
	options: OperatorBriefCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for operator-brief",
	);
	const today = options.today ?? losAngelesToday();
	const lookbackDays = options.lookbackDays ?? 7;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const api = new DirectNotionClient(token);
	const phase5 = requirePhase5ExternalSignals(config);

	const [projectSchema, eventSchema, packetSchema, buildPages] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(phase5.events.dataSourceId),
		config.phase2Execution
			? api.retrieveDataSource(config.phase2Execution.packets.dataSourceId)
			: Promise.resolve(undefined),
		fetchAllPages(api, config.relatedDataSources.buildLogId, "Session Title"),
	]);
	const [projectPages, eventPages, packetPages] = await Promise.all([
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
	const orphanResults = attachExistingKickoffPackets(
		projects
			.filter(isOperatingOrphan)
			.map((project) => classifyOrphan(project, today)),
		packetPages.map((page) => toWorkPacketRecord(page)),
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
	overdueProjects: ControlTowerProjectRecord[];
}): string {
	const lines = [
		`## Operator Brief — ${input.today}`,
		"",
		"### Now",
		`- Review backlog: ${input.metrics.overdueReviews} overdue projects.`,
		`- Stale active projects: ${input.staleActiveCount}.`,
		`- Orphans needing first kickoff: ${input.actionableOrphans}.`,
		`- Orphans already routed to kickoff packets: ${input.orphansWithKickoff}.`,
		"",
		"### Top Signal Risks",
		...formatPriorityProjects(input.priorityProjects.slice(0, 5)),
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
