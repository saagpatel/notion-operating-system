import {
	COMMAND_CENTER_MANAGED_SECTIONS,
	FRESHNESS_COMMAND_CENTER_SECTION,
	renderManagedSectionPlaceholder,
	WEEKLY_EXTERNAL_SIGNALS_SECTION,
} from "./managed-markdown-sections.js";

export const DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH =
	"./config/local-portfolio-control-tower.json";

// Type declarations now live in ./control-tower/types.ts — re-exported so existing
// importers are unaffected, and re-imported below for this module's internal use.
export * from "./control-tower/types.js";

import {
	addDays,
	compareIsoDate,
	diffDays,
	newestIsoDate,
} from "./control-tower/dates.js";
import type {
	ControlTowerBuildSessionRecord,
	ControlTowerMetrics,
	ControlTowerProjectRecord,
	EvidenceFreshness,
	LocalPortfolioControlTowerConfig,
	OperatingQueue,
	ReviewPacketContext,
	StaleActiveRescueItem,
	StaleActiveRescueReason,
} from "./control-tower/types.js";

export * from "./control-tower/config.js";
export { addDays, compareIsoDate, diffDays } from "./control-tower/dates.js";
export function deriveOperatingQueue(
	project: Pick<
		ControlTowerProjectRecord,
		| "currentState"
		| "needsReview"
		| "portfolioCall"
		| "runsLocally"
		| "setupFriction"
	>,
): OperatingQueue {
	if (project.currentState === "Shipped") {
		return "Shipped";
	}
	if (project.needsReview) {
		return "Needs Review";
	}
	if (project.currentState === "Needs Decision") {
		return "Needs Decision";
	}
	if (project.portfolioCall === "Finish") {
		return "Worth Finishing";
	}
	if (
		project.currentState === "Active Build" &&
		project.runsLocally !== "No" &&
		project.setupFriction !== "High"
	) {
		return "Resume Now";
	}
	if (
		project.currentState === "Parked" ||
		project.currentState === "Archived"
	) {
		return "Cold Storage";
	}
	return "Watch";
}

export function deriveEvidenceFreshness(
	project: Pick<
		ControlTowerProjectRecord,
		"lastActive" | "lastBuildSessionDate"
	>,
	freshnessWindows: LocalPortfolioControlTowerConfig["freshnessWindows"],
	today: string,
): EvidenceFreshness {
	const referenceDate = newestIsoDate([
		project.lastActive,
		project.lastBuildSessionDate,
	]);
	if (!referenceDate) {
		return "Stale";
	}

	const ageDays = diffDays(referenceDate, today);
	if (ageDays <= freshnessWindows.freshMaxDays) {
		return "Fresh";
	}
	if (ageDays <= freshnessWindows.agingMaxDays) {
		return "Aging";
	}
	return "Stale";
}

export function deriveNextReviewDate(
	project: Pick<
		ControlTowerProjectRecord,
		"currentState" | "lastActive" | "lastBuildSessionDate"
	>,
	reviewCadenceDays: Record<string, number>,
): string {
	const referenceDate = newestIsoDate([
		project.lastActive,
		project.lastBuildSessionDate,
	]);
	if (!referenceDate) {
		return "";
	}

	const cadenceDays = reviewCadenceDays[project.currentState] ?? 14;
	return addDays(referenceDate, cadenceDays);
}

export function applyDerivedSignals(
	project: ControlTowerProjectRecord,
	config: LocalPortfolioControlTowerConfig,
	today: string,
): ControlTowerProjectRecord {
	const operatingQueue = deriveOperatingQueue(project);
	const evidenceFreshness = deriveEvidenceFreshness(
		project,
		config.freshnessWindows,
		today,
	);
	const nextReviewDate = deriveNextReviewDate(
		project,
		config.reviewCadenceDays,
	);

	return {
		...project,
		operatingQueue,
		evidenceFreshness,
		nextReviewDate,
	};
}

export function calculateControlTowerMetrics(
	projects: ControlTowerProjectRecord[],
	recentBuildSessions: ControlTowerBuildSessionRecord[],
	today: string,
): ControlTowerMetrics {
	const queueCounts: Record<OperatingQueue, number> = {
		Shipped: 0,
		"Needs Review": 0,
		"Needs Decision": 0,
		"Worth Finishing": 0,
		"Resume Now": 0,
		"Cold Storage": 0,
		Watch: 0,
	};

	let overdueReviews = 0;
	let missingNextMove = 0;
	let missingLastActive = 0;
	let staleActiveProjects = 0;
	let orphanedProjects = 0;

	for (const project of projects) {
		const queue = project.operatingQueue ?? deriveOperatingQueue(project);
		queueCounts[queue] += 1;

		if (!project.nextMove.trim()) {
			missingNextMove += 1;
		}
		if (!project.lastActive.trim()) {
			missingLastActive += 1;
		}
		if (
			project.nextReviewDate &&
			compareIsoDate(project.nextReviewDate, today) <= 0
		) {
			overdueReviews += 1;
		}
		if (
			project.currentState === "Active Build" &&
			(project.evidenceFreshness ?? "Stale") === "Stale"
		) {
			staleActiveProjects += 1;
		}
		if (
			project.buildSessionCount === 0 &&
			project.relatedResearchCount === 0 &&
			project.supportingSkillsCount === 0 &&
			project.linkedToolCount === 0
		) {
			orphanedProjects += 1;
		}
	}

	return {
		totalProjects: projects.length,
		queueCounts,
		overdueReviews,
		missingNextMove,
		missingLastActive,
		staleActiveProjects,
		orphanedProjects,
		recentBuildSessions: recentBuildSessions.length,
	};
}

export function sortProjectsForResumeNow(
	projects: ControlTowerProjectRecord[],
): ControlTowerProjectRecord[] {
	return [...projects].sort((left, right) => {
		const frictionDiff =
			rankSetupFriction(left.setupFriction) -
			rankSetupFriction(right.setupFriction);
		if (frictionDiff !== 0) {
			return frictionDiff;
		}
		return compareIsoDate(right.lastActive, left.lastActive);
	});
}

export function isStaleActiveProject(
	project: ControlTowerProjectRecord,
): boolean {
	return (
		project.currentState === "Active Build" &&
		(project.evidenceFreshness ?? "Stale") === "Stale"
	);
}

export function buildStaleActiveRescueItems(
	projects: ControlTowerProjectRecord[],
	today: string,
): StaleActiveRescueItem[] {
	return sortProjectsByRecent(projects.filter(isStaleActiveProject)).map(
		(project) => buildStaleActiveRescueItem(project, today),
	);
}

export function buildStaleActiveRescueItem(
	project: ControlTowerProjectRecord,
	today: string,
): StaleActiveRescueItem {
	const reason = classifyStaleActiveReason(project, today);
	const priority = rankStaleActivePriority(reason);
	return {
		project,
		reason,
		priority,
		nextAction: recommendStaleActiveAction(reason, project),
		evidence: buildStaleActiveEvidence(project, today),
	};
}

export function summarizeStaleActiveRescue(
	items: StaleActiveRescueItem[],
): Record<StaleActiveRescueReason, number> {
	const counts: Record<StaleActiveRescueReason, number> = {
		"missing-next-move": 0,
		"missing-last-active": 0,
		"overdue-review": 0,
		"no-build-evidence": 0,
		"thin-support": 0,
		"low-confidence": 0,
		"stale-evidence": 0,
	};
	for (const item of items) {
		counts[item.reason] += 1;
	}
	return counts;
}

function classifyStaleActiveReason(
	project: ControlTowerProjectRecord,
	today: string,
): StaleActiveRescueReason {
	if (!project.nextMove.trim()) {
		return "missing-next-move";
	}
	if (!project.lastActive.trim()) {
		return "missing-last-active";
	}
	if (
		project.nextReviewDate &&
		compareIsoDate(project.nextReviewDate, today) <= 0
	) {
		return "overdue-review";
	}
	if (project.buildSessionCount === 0) {
		return "no-build-evidence";
	}
	if (
		project.relatedResearchCount === 0 &&
		project.supportingSkillsCount === 0 &&
		project.linkedToolCount === 0
	) {
		return "thin-support";
	}
	if (project.evidenceConfidence && project.evidenceConfidence !== "High") {
		return "low-confidence";
	}
	return "stale-evidence";
}

function rankStaleActivePriority(
	reason: StaleActiveRescueReason,
): StaleActiveRescueItem["priority"] {
	switch (reason) {
		case "missing-next-move":
		case "missing-last-active":
		case "overdue-review":
			return "high";
		case "no-build-evidence":
		case "thin-support":
		case "low-confidence":
			return "medium";
		case "stale-evidence":
			return "low";
	}
}

function recommendStaleActiveAction(
	reason: StaleActiveRescueReason,
	project: ControlTowerProjectRecord,
): string {
	switch (reason) {
		case "missing-next-move":
			return "Add one concrete Next Move before changing status.";
		case "missing-last-active":
			return "Verify recent evidence and set Last Active or downgrade the active status.";
		case "overdue-review":
			return "Run an operator review and decide resume, defer, or archive.";
		case "no-build-evidence":
			return "Add a build-log entry or move this to planning/cold storage.";
		case "thin-support":
			return "Link supporting research, skill, or tool evidence before keeping it active.";
		case "low-confidence":
			return `Refresh evidence confidence${project.evidenceConfidence ? ` from ${project.evidenceConfidence}` : ""}.`;
		case "stale-evidence":
			return "Refresh activity evidence or move it out of Active Build.";
	}
}

function buildStaleActiveEvidence(
	project: ControlTowerProjectRecord,
	today: string,
): string[] {
	const evidence: string[] = [];
	evidence.push(`freshness=${project.evidenceFreshness ?? "Stale"}`);
	evidence.push(
		project.lastActive
			? `lastActive=${project.lastActive}`
			: "lastActive=missing",
	);
	evidence.push(
		project.nextReviewDate
			? `nextReviewDate=${project.nextReviewDate}`
			: "nextReviewDate=missing",
	);
	if (
		project.nextReviewDate &&
		compareIsoDate(project.nextReviewDate, today) <= 0
	) {
		evidence.push("review=overdue");
	}
	evidence.push(`buildSessions=${project.buildSessionCount}`);
	evidence.push(
		`supportLinks=${project.relatedResearchCount + project.supportingSkillsCount + project.linkedToolCount}`,
	);
	if (project.evidenceConfidence) {
		evidence.push(`confidence=${project.evidenceConfidence}`);
	}
	return evidence;
}

function formatStaleReason(reason: StaleActiveRescueReason): string {
	switch (reason) {
		case "missing-next-move":
			return "missing next move";
		case "missing-last-active":
			return "missing last active";
		case "overdue-review":
			return "overdue review";
		case "no-build-evidence":
			return "no build evidence";
		case "thin-support":
			return "thin support";
		case "low-confidence":
			return "low confidence";
		case "stale-evidence":
			return "stale evidence";
	}
}

export function renderCommandCenterMarkdown(input: {
	generatedAt: string;
	metrics: ControlTowerMetrics;
	baselineMetrics?: ControlTowerMetrics;
	projects: ControlTowerProjectRecord[];
	recentBuildSessions: ControlTowerBuildSessionRecord[];
	config: LocalPortfolioControlTowerConfig;
	today: string;
}): string {
	const resumeNow = sortProjectsForResumeNow(
		input.projects.filter((project) => project.operatingQueue === "Resume Now"),
	).slice(0, 8);
	const worthFinishing = sortProjectsByRecent(
		input.projects.filter(
			(project) => project.operatingQueue === "Worth Finishing",
		),
	).slice(0, 8);
	const needsDecision = sortProjectsByRecent(
		input.projects.filter(
			(project) => project.operatingQueue === "Needs Decision",
		),
	).slice(0, 8);
	const needsReview = sortProjectsByRecent(
		input.projects.filter(
			(project) => project.operatingQueue === "Needs Review",
		),
	).slice(0, 8);
	const staleActive = sortProjectsByRecent(
		input.projects.filter((project) => isStaleActiveProject(project)),
	).slice(0, 8);
	const staleRescueItems = buildStaleActiveRescueItems(
		input.projects,
		input.today,
	);
	const orphaned = sortProjectsByRecent(
		input.projects.filter(
			(project) =>
				project.buildSessionCount === 0 &&
				project.relatedResearchCount === 0 &&
				project.supportingSkillsCount === 0 &&
				project.linkedToolCount === 0,
		),
	).slice(0, 8);

	const lines = [
		"# Local Portfolio Command Center",
		"",
		`Updated: ${input.generatedAt}`,
		"",
		renderFreshnessByLayerSection(input.config),
		"",
		"## Today's Attention",
		...renderCommandCenterAttention(input.metrics),
		"",
		"## Baseline Health Snapshot",
		`- Total projects: ${input.metrics.totalProjects}`,
		`- Overdue reviews: ${input.metrics.overdueReviews}`,
		`- Missing next moves: ${input.metrics.missingNextMove}`,
		`- Missing last active: ${input.metrics.missingLastActive}`,
		`- Stale active projects: ${input.metrics.staleActiveProjects}`,
		`- Orphaned projects: ${input.metrics.orphanedProjects}`,
		`- Recent build sessions (last 7 days): ${input.metrics.recentBuildSessions}`,
		baselineDeltaLine(
			"Overdue reviews",
			input.baselineMetrics?.overdueReviews,
			input.metrics.overdueReviews,
		),
		baselineDeltaLine(
			"Missing next moves",
			input.baselineMetrics?.missingNextMove,
			input.metrics.missingNextMove,
		),
		baselineDeltaLine(
			"Stale active projects",
			input.baselineMetrics?.staleActiveProjects,
			input.metrics.staleActiveProjects,
		),
		"",
		"## Leading Indicators",
		`- Needs Review: ${input.metrics.queueCounts["Needs Review"]}`,
		`- Needs Decision: ${input.metrics.queueCounts["Needs Decision"]}`,
		`- Resume Now: ${input.metrics.queueCounts["Resume Now"]}`,
		`- Worth Finishing: ${input.metrics.queueCounts["Worth Finishing"]}`,
		"",
		"## Lagging Indicators",
		`- Shipped: ${input.metrics.queueCounts.Shipped}`,
		`- Cold Storage: ${input.metrics.queueCounts["Cold Storage"]}`,
		`- Watch: ${input.metrics.queueCounts.Watch}`,
		"",
		"## Top Resume Now",
		...formatProjectBullets(resumeNow, (project) => [
			project.nextMove || "Next move missing",
			project.lastActive
				? `last active ${project.lastActive}`
				: "last active missing",
			project.setupFriction
				? `setup ${project.setupFriction.toLowerCase()}`
				: "",
		]),
		"",
		"## Top Worth Finishing",
		...formatProjectBullets(worthFinishing, (project) => [
			project.effortToDemo ? `demo ${project.effortToDemo}` : "",
			project.effortToShip ? `ship ${project.effortToShip}` : "",
			project.nextMove || "Next move missing",
		]),
		"",
		"## Needs Decision",
		...formatProjectBullets(needsDecision, (project) => [
			project.valueOutcome ||
				project.oneLinePitch ||
				"Decision context missing",
			project.biggestBlocker || "",
		]),
		"",
		"## Needs Review",
		...formatProjectBullets(needsReview, (project) => [
			project.evidenceConfidence
				? `confidence ${project.evidenceConfidence.toLowerCase()}`
				: "",
			project.docsQuality ? `docs ${project.docsQuality.toLowerCase()}` : "",
			project.testPosture ? `tests ${project.testPosture.toLowerCase()}` : "",
		]),
		"",
		"## Stale Active Projects",
		...renderStaleActiveRescueSummary(staleRescueItems),
		...formatStaleActiveRescueBullets(staleActive, input.today),
		"",
		"## Orphaned Projects",
		...formatProjectBullets(orphaned, () => [
			"No linked build, research, skill, or tool records",
		]),
		"",
		"## Saved Views",
		...Object.entries(input.config.viewIds).map(
			([name, viewId]) =>
				`- [${name}](${buildViewUrl(input.config.database.databaseUrl, viewId)})`,
		),
		"",
		"## Recent Build Activity",
		...formatBuildSessionBullets(input.recentBuildSessions.slice(0, 8)),
		"",
		...COMMAND_CENTER_MANAGED_SECTIONS.flatMap((section, index) =>
			index === COMMAND_CENTER_MANAGED_SECTIONS.length - 1
				? [renderManagedSectionPlaceholder(section)]
				: [renderManagedSectionPlaceholder(section), ""],
		),
	];

	return lines.filter(Boolean).join("\n");
}

export function renderWeeklyReviewMarkdown(input: ReviewPacketContext): string {
	const lines = [
		`# ${input.weekTitle}`,
		"",
		`Review window: ${input.compareLabel}`,
		"",
		"## What Changed",
		...formatProjectBullets(
			sortProjectsByRecent(input.projectsChanged).slice(0, 12),
			(project) => [
				project.nextMove || "Next move missing",
				project.lastActive ? `last active ${project.lastActive}` : "",
			],
		),
		"",
		"## Needs Decision",
		...formatProjectBullets(
			sortProjectsByRecent(input.projectsNeedDecision).slice(0, 10),
			(project) => [
				project.valueOutcome ||
					project.oneLinePitch ||
					"Decision context missing",
				project.biggestBlocker || "",
			],
		),
		"",
		"## Worth Finishing",
		...formatProjectBullets(
			sortProjectsByRecent(input.projectsWorthFinishing).slice(0, 10),
			(project) => [
				project.effortToDemo ? `demo ${project.effortToDemo}` : "",
				project.effortToShip ? `ship ${project.effortToShip}` : "",
				project.nextMove || "",
			],
		),
		"",
		"## Overdue For Review",
		...formatProjectBullets(
			sortProjectsByRecent(input.overdueProjects).slice(0, 10),
			(project) => [
				project.nextReviewDate ? `review due ${project.nextReviewDate}` : "",
				project.evidenceFreshness
					? `freshness ${project.evidenceFreshness.toLowerCase()}`
					: "",
			],
		),
		"",
		"## Stale Active Projects",
		...formatProjectBullets(
			sortProjectsByRecent(input.staleActiveProjects).slice(0, 10),
			(project) => [
				project.nextMove || "Next move missing",
				project.lastActive ? `last active ${project.lastActive}` : "",
			],
		),
		"",
		"## Recent Build Sessions",
		...formatBuildSessionBullets(input.recentBuildSessions.slice(0, 12)),
		"",
		"## Top Priorities Next Week",
		...(input.topPrioritiesNextWeek.length > 0
			? input.topPrioritiesNextWeek.map((item) => `- ${item}`)
			: [
					"- Keep the operating rhythm alive and clear the top decision/review bottlenecks.",
				]),
	];

	if (input.nextPhaseBrief) {
		lines.push("", "## Next Phase", input.nextPhaseBrief);
	}

	lines.push(
		"",
		renderManagedSectionPlaceholder(WEEKLY_EXTERNAL_SIGNALS_SECTION),
	);

	return lines.filter(Boolean).join("\n");
}

function renderFreshnessByLayer(
	config: LocalPortfolioControlTowerConfig,
): string[] {
	const weekly = config.weeklyMaintenance;

	return [
		freshnessLine("Support maintenance", weekly?.supportMaintenanceLastSyncAt),
		freshnessLine("Control tower", config.phaseState.lastSyncAt),
		freshnessLine("Execution", config.phase2Execution?.lastSyncAt),
		freshnessLine("Intelligence", config.phase3Intelligence?.lastSyncAt),
		freshnessLine("External signals", config.phase5ExternalSignals?.lastSyncAt),
		freshnessLine("Weekly review", weekly?.weeklyReviewLastPublishedAt),
		freshnessLine(
			"Weekly refresh",
			weekly?.weeklyRefreshLastRunAt,
			weeklyRefreshFreshnessSuffix(weekly),
		),
	];
}

export function renderFreshnessByLayerSection(
	config: LocalPortfolioControlTowerConfig,
): string {
	return [
		FRESHNESS_COMMAND_CENTER_SECTION.startMarker,
		"## Freshness By Layer",
		...renderFreshnessByLayer(config),
		FRESHNESS_COMMAND_CENTER_SECTION.endMarker,
	].join("\n");
}

function freshnessLine(label: string, date?: string, suffix?: string): string {
	const state = date ? date : "Never";
	const statusSuffix = suffix ? ` (${suffix})` : "";
	return `- ${label}: ${state}${statusSuffix}`;
}

function weeklyRefreshFreshnessSuffix(
	weekly?: LocalPortfolioControlTowerConfig["weeklyMaintenance"],
): string | undefined {
	if (!weekly?.weeklyRefreshLastStatus) {
		return undefined;
	}
	const summary = weekly.weeklyRefreshLastSummary;
	const missedWeekdays = numericSummaryValue(summary, "missedWeekdays");
	const catchUpRecovered = summary?.catchUpRecovered === "yes";
	if (catchUpRecovered && missedWeekdays > 0) {
		return `${weekly.weeklyRefreshLastStatus}; caught up after ${missedWeekdays} missed weekday(s)`;
	}
	if (summary?.staleBeforeRun === "yes" && missedWeekdays > 0) {
		return `${weekly.weeklyRefreshLastStatus}; ${missedWeekdays} missed weekday(s) pending recovery`;
	}
	return weekly.weeklyRefreshLastStatus;
}

function numericSummaryValue(
	summary: Record<string, number | string | boolean> | undefined,
	key: string,
): number {
	const value = summary?.[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function renderCommandCenterAttention(metrics: ControlTowerMetrics): string[] {
	const attention: string[] = [];
	if (metrics.staleActiveProjects > 0) {
		attention.push(
			`- Stale active rescue is the first portfolio hygiene lane: ${metrics.staleActiveProjects} active projects need evidence, next-move, or status cleanup.`,
		);
	}
	if (metrics.overdueReviews > 0) {
		attention.push(
			`- Review pressure is active: ${metrics.overdueReviews} projects are at or past their next review date.`,
		);
	}
	if (metrics.missingNextMove > 0) {
		attention.push(
			`- Next-move cleanup is needed: ${metrics.missingNextMove} projects have no operator-actionable next move.`,
		);
	}
	if (metrics.missingLastActive > 0) {
		attention.push(
			`- Evidence cleanup is needed: ${metrics.missingLastActive} projects have no Last Active date.`,
		);
	}
	if (attention.length === 0) {
		attention.push(
			"- Portfolio hygiene is quiet; use Resume Now and Worth Finishing for the next execution decision.",
		);
	}
	return attention;
}

function renderStaleActiveRescueSummary(
	items: StaleActiveRescueItem[],
): string[] {
	if (items.length === 0) {
		return ["- None right now."];
	}
	const counts = summarizeStaleActiveRescue(items);
	const activeCounts = Object.entries(counts)
		.filter(([, count]) => count > 0)
		.map(
			([reason, count]) =>
				`${formatStaleReason(reason as StaleActiveRescueReason)} ${count}`,
		);
	return [
		`- Rescue queue: ${items.length} active projects with stale evidence.`,
		`- Main reasons: ${activeCounts.join("; ")}.`,
		"- Default move: verify evidence first, then update Next Move or move the project out of Active Build.",
	];
}

function formatStaleActiveRescueBullets(
	projects: ControlTowerProjectRecord[],
	today: string,
): string[] {
	if (projects.length === 0) {
		return [];
	}
	return formatProjectBullets(projects, (project) => {
		const item = buildStaleActiveRescueItem(project, today);
		return [
			`${item.priority} priority`,
			formatStaleReason(item.reason),
			item.nextAction,
		];
	});
}

export function buildTopPriorities(
	projects: ControlTowerProjectRecord[],
): string[] {
	const priorities: string[] = [];

	for (const project of sortProjectsByRecent(
		projects.filter((project) => project.operatingQueue === "Needs Decision"),
	).slice(0, 2)) {
		priorities.push(`Make a portfolio decision on ${project.title}.`);
	}
	for (const project of sortProjectsForResumeNow(
		projects.filter((project) => project.operatingQueue === "Resume Now"),
	).slice(0, 2)) {
		priorities.push(
			`Resume ${project.title} and execute: ${project.nextMove || "define the next move"}.`,
		);
	}
	for (const project of sortProjectsByRecent(
		projects.filter((project) => project.operatingQueue === "Worth Finishing"),
	).slice(0, 1)) {
		priorities.push(`Push ${project.title} toward a demoable finish.`);
	}

	return priorities.slice(0, 5);
}

function formatProjectBullets(
	projects: ControlTowerProjectRecord[],
	detailBuilder: (project: ControlTowerProjectRecord) => string[],
): string[] {
	if (projects.length === 0) {
		return ["- None right now."];
	}

	return projects.map((project) => {
		const details = detailBuilder(project).filter(Boolean).join(" | ");
		const summary = details ? ` - ${details}` : "";
		return `- [${project.title}](${project.url})${summary}`;
	});
}

function formatBuildSessionBullets(
	sessions: ControlTowerBuildSessionRecord[],
): string[] {
	if (sessions.length === 0) {
		return ["- No build sessions in the current review window."];
	}

	return sessions.map((session) => {
		const dateLabel = session.sessionDate ? `${session.sessionDate} - ` : "";
		return `- [${dateLabel}${session.title}](${session.url})`;
	});
}

function sortProjectsByRecent(
	projects: ControlTowerProjectRecord[],
): ControlTowerProjectRecord[] {
	return [...projects].sort((left, right) => {
		const dateCompare = compareIsoDate(
			newestIsoDate([right.lastActive, right.lastBuildSessionDate]),
			newestIsoDate([left.lastActive, left.lastBuildSessionDate]),
		);
		if (dateCompare !== 0) {
			return dateCompare;
		}
		return left.title.localeCompare(right.title);
	});
}

function rankSetupFriction(value: string): number {
	switch (value) {
		case "Low":
			return 0;
		case "Medium":
			return 1;
		case "High":
			return 2;
		default:
			return 3;
	}
}

function baselineDeltaLine(
	label: string,
	baseline: number | undefined,
	current: number,
): string {
	if (baseline === undefined) {
		return "";
	}
	const delta = current - baseline;
	const direction =
		delta === 0
			? "unchanged"
			: delta > 0
				? `${delta} higher`
				: `${Math.abs(delta)} lower`;
	return `- ${label} vs baseline: ${direction}`;
}

function buildViewUrl(databaseUrl: string, viewId: string): string {
	const separator = databaseUrl.includes("?") ? "&" : "?";
	return `${databaseUrl}${separator}v=${viewId.replace(/-/g, "")}`;
}
