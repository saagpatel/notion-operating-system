import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	addDays,
	applyDerivedSignals,
	calculateControlTowerMetrics,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
	type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import {
	datePropertyValue,
	fetchAllPages,
	richTextValue,
	toBuildSessionRecord,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";

export interface ReviewRecoveryCommandOptions {
	live?: boolean;
	today?: string;
	config?: string;
	limit?: number;
	includeMetadataGaps?: boolean;
	projectTitles?: string[];
}

export interface ReviewRecoveryPlan {
	projectId: string;
	title: string;
	url: string;
	reasons: string[];
	currentReviewDate: string;
	properties: Record<string, unknown>;
	summary: {
		lastActive: string;
		nextMove: string;
		nextReviewDate: string;
	};
}

const DEFAULT_LIMIT = 15;
const DEFAULT_NEXT_MOVE =
	"Review project evidence and decide whether to resume, park, or archive before the next portfolio pass.";

export async function runReviewRecoveryCommand(
	options: ReviewRecoveryCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for review recovery",
	);
	const live = options.live ?? false;
	const today = options.today ?? losAngelesToday();
	const limit = options.limit ?? DEFAULT_LIMIT;
	const includeMetadataGaps = options.includeMetadataGaps ?? false;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const api = new DirectNotionClient(token);
	const [schema, buildSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.relatedDataSources.buildLogId),
	]);
	const [projectPages, buildPages] = await Promise.all([
		fetchAllPages(
			api,
			config.database.dataSourceId,
			schema.titlePropertyName,
		),
		fetchAllPages(
			api,
			config.relatedDataSources.buildLogId,
			buildSchema.titlePropertyName,
		),
	]);
	const projects = projectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);
	const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
	const beforeMetrics = calculateControlTowerMetrics(
		projects,
		buildSessions.filter((session) => session.sessionDate >= addDays(today, -7)),
		today,
	);
	const allPlans = buildReviewRecoveryPlans({
		projects,
		today,
		reviewCadenceDays: config.reviewCadenceDays,
		includeMetadataGaps,
	});
	const scopedPlans = filterReviewRecoveryPlansByProjectTitles(
		allPlans,
		options.projectTitles,
		projects.map((project) => project.title),
	);
	const plans = scopedPlans.slice(0, Math.max(0, limit));

	if (live) {
		for (const plan of plans) {
			await api.updatePageProperties({
				pageId: plan.projectId,
				properties: plan.properties,
			});
		}
	}

	const afterProjectPages = live
		? await fetchAllPages(
				api,
				config.database.dataSourceId,
				schema.titlePropertyName,
			)
		: projectPages;
	const afterProjects = afterProjectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);
	const afterMetrics = calculateControlTowerMetrics(
		afterProjects,
		buildSessions.filter((session) => session.sessionDate >= addDays(today, -7)),
		today,
	);
	const output = {
		ok: true,
		live,
		today,
		limit,
		includeMetadataGaps,
		projectTitles: normalizeProjectTitleFilters(options.projectTitles),
		totalEligibleProjects: allPlans.length,
		plannedUpdates: plans.length,
		appliedUpdates: live ? plans.length : 0,
		before: {
			overdueReviews: beforeMetrics.overdueReviews,
			missingNextMove: beforeMetrics.missingNextMove,
			missingLastActive: beforeMetrics.missingLastActive,
		},
		after: {
			overdueReviews: afterMetrics.overdueReviews,
			missingNextMove: afterMetrics.missingNextMove,
			missingLastActive: afterMetrics.missingLastActive,
		},
		projects: plans.map((plan) => ({
			projectId: plan.projectId,
			title: plan.title,
			url: plan.url,
			reasons: plan.reasons,
			currentReviewDate: plan.currentReviewDate,
			summary: plan.summary,
		})),
	};

	recordCommandOutputSummary(output, {
		status:
			afterMetrics.overdueReviews > 0 ||
			afterMetrics.missingNextMove > 0 ||
			afterMetrics.missingLastActive > 0
				? "warning"
				: "completed",
		warningCategories:
			afterMetrics.overdueReviews > 0 ||
			afterMetrics.missingNextMove > 0 ||
			afterMetrics.missingLastActive > 0
				? ["stale_data"]
				: undefined,
		metadata: {
			plannedUpdates: plans.length,
			appliedUpdates: live ? plans.length : 0,
			overdueReviewsBefore: beforeMetrics.overdueReviews,
			overdueReviewsAfter: afterMetrics.overdueReviews,
			missingNextMoveAfter: afterMetrics.missingNextMove,
			missingLastActiveAfter: afterMetrics.missingLastActive,
		},
	});
	console.log(JSON.stringify(output, null, 2));
}

function normalizeProjectTitleFilters(projectTitles?: string[]): string[] {
	const uniqueTitles: string[] = [];
	const seen = new Set<string>();
	for (const title of projectTitles ?? []) {
		const trimmed = title.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) continue;
		seen.add(trimmed);
		uniqueTitles.push(trimmed);
	}
	return uniqueTitles;
}

export function filterReviewRecoveryPlansByProjectTitles(
	plans: ReviewRecoveryPlan[],
	projectTitles?: string[],
	knownProjectTitles: string[] = plans.map((plan) => plan.title),
): ReviewRecoveryPlan[] {
	const requestedTitles = normalizeProjectTitleFilters(projectTitles);
	if (requestedTitles.length === 0) return plans;

	const knownProjectTitleSet = new Set(knownProjectTitles);
	const missingTitles = requestedTitles.filter(
		(title) => !knownProjectTitleSet.has(title),
	);
	if (missingTitles.length > 0) {
		throw new Error(
			`No review recovery plan matched --project-title: ${missingTitles.join(", ")}`,
		);
	}

	const requestedTitleSet = new Set(requestedTitles);
	return plans.filter((plan) => requestedTitleSet.has(plan.title));
}

export function buildReviewRecoveryPlans(input: {
	projects: ControlTowerProjectRecord[];
	today: string;
	reviewCadenceDays: Record<string, number>;
	includeMetadataGaps?: boolean;
}): ReviewRecoveryPlan[] {
	return input.projects
		.map((project) =>
			buildReviewRecoveryPlan({
				project,
				today: input.today,
				reviewCadenceDays: input.reviewCadenceDays,
				includeMetadataGaps: input.includeMetadataGaps,
			}),
		)
		.filter((plan): plan is ReviewRecoveryPlan => Boolean(plan))
		.sort(compareReviewRecoveryPlans);
}

function buildReviewRecoveryPlan(input: {
	project: ControlTowerProjectRecord;
	today: string;
	reviewCadenceDays: Record<string, number>;
	includeMetadataGaps?: boolean;
}): ReviewRecoveryPlan | undefined {
	const reasons = getReviewRecoveryReasons(input.project, input.today);
	if (!input.includeMetadataGaps) {
		const overdueOnly = reasons.filter((reason) => reason === "overdue-review");
		if (overdueOnly.length === 0) return undefined;
		reasons.splice(0, reasons.length, ...overdueOnly);
	}
	if (reasons.length === 0) return undefined;

	const nextMove = input.project.nextMove.trim() || DEFAULT_NEXT_MOVE;
	const nextReviewDate = addDays(
		input.today,
		input.reviewCadenceDays[input.project.currentState] ?? 14,
	);
	const properties: Record<string, unknown> = {
		"Last Active": datePropertyValue(input.today),
		"Needs Review": { checkbox: false },
	};
	if (!input.project.nextMove.trim()) {
		properties["Next Move"] = richTextValue(nextMove);
	}

	return {
		projectId: input.project.id,
		title: input.project.title,
		url: input.project.url,
		reasons,
		currentReviewDate: input.project.nextReviewDate ?? "",
		properties,
		summary: {
			lastActive: input.today,
			nextMove,
			nextReviewDate,
		},
	};
}

function getReviewRecoveryReasons(
	project: ControlTowerProjectRecord,
	today: string,
): string[] {
	const reasons: string[] = [];
	if (project.nextReviewDate && project.nextReviewDate <= today) {
		reasons.push("overdue-review");
	}
	if (!project.nextMove.trim()) {
		reasons.push("missing-next-move");
	}
	if (!project.lastActive.trim()) {
		reasons.push("missing-last-active");
	}
	return reasons;
}

function compareReviewRecoveryPlans(
	left: ReviewRecoveryPlan,
	right: ReviewRecoveryPlan,
): number {
	const leftDue = left.currentReviewDate || "9999-99-99";
	const rightDue = right.currentReviewDate || "9999-99-99";
	const dueCompare = leftDue.localeCompare(rightDue);
	if (dueCompare !== 0) return dueCompare;
	return left.title.localeCompare(right.title);
}
