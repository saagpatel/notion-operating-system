import { loadRuntimeConfig } from "../config/runtime-config.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import {
	extractNotionIdFromUrl,
	normalizeNotionId,
} from "../utils/notion-id.js";
import type {
	ControlTowerBuildSessionRecord,
	ControlTowerProjectRecord,
	LocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import type {
	ExecutionTaskRecord,
	ProjectDecisionRecord,
	WorkPacketRecord,
} from "./local-portfolio-execution.js";
import {
	type ExecutionDataSourceRef,
	parseExecutionDataSource,
} from "./local-portfolio-execution.js";
import {
	buildExternalRecommendationAdjustments,
	type ExternalSignalCoverage,
	type ExternalSignalSummary,
	type LatestDeploymentStatus,
} from "./local-portfolio-external-signals.js";

export const DEFAULT_LOCAL_PORTFOLIO_INTELLIGENCE_VIEWS_PATH =
	"./config/local-portfolio-intelligence-views.json";

export type RecommendationLane =
	| "Resume"
	| "Finish"
	| "Investigate"
	| "Defer"
	| "Monitor";
export type RecommendationConfidence = "High" | "Medium" | "Low";

export interface IntelligenceProjectRecord extends ControlTowerProjectRecord {
	relatedResearchIds: string[];
	supportingSkillIds: string[];
	toolStackIds: string[];
	recommendationRunIds: string[];
	projectShape: string[];
	deploymentSurface: string[];
	primaryTool: string;
	externalSignalCoverage?: ExternalSignalCoverage;
	latestExternalActivity?: string;
	latestDeploymentStatus?: LatestDeploymentStatus;
	openPrCount?: number;
	recentFailedWorkflowRuns?: number;
	externalSignalUpdated?: string;
	recommendationLane?: RecommendationLane;
	recommendationScore?: number;
	recommendationConfidence?: RecommendationConfidence;
	recommendationUpdated?: string;
}

export interface ResearchLibraryRecord {
	id: string;
	url: string;
	title: string;
	category: string;
	tags: string[];
	actionable: boolean;
	confidence: string;
	decisionImpact: string;
	lastVerified: string;
	dateResearched: string;
	relatedProjectIds: string[];
}

export interface SkillLibraryRecord {
	id: string;
	url: string;
	title: string;
	category: string;
	proficiency: string;
	status: string;
	projectRelevance: string;
	lastPracticed: string;
	relatedProjectIds: string[];
}

export interface ToolMatrixRecord {
	id: string;
	url: string;
	title: string;
	category: string;
	status: string;
	myRole: string;
	stackIntegration: string;
	utilityScore: number;
	delightScore: number;
	lastReviewed: string;
	tags: string[];
	linkedProjectIds: string[];
}

export interface RecommendationRunRecord {
	id: string;
	url: string;
	title: string;
	runDate: string;
	runType: string;
	status: string;
	modelVersion: string;
	topResumeProjectIds: string[];
	topFinishProjectIds: string[];
	topInvestigateProjectIds: string[];
	topDeferProjectIds: string[];
	weeklyReviewIds: string[];
	supersedesIds: string[];
	reviewerIds: string[];
	reviewedOn: string;
	summary: string;
	referencedProjectIds: string[];
}

export interface LinkSuggestionRecord {
	id: string;
	url: string;
	title: string;
	status: string;
	suggestionType: "Project->Research" | "Project->Skill" | "Project->Tool";
	localProjectIds: string[];
	suggestedResearchIds: string[];
	suggestedSkillIds: string[];
	suggestedToolIds: string[];
	confidenceScore: number;
	matchReasons: string;
	suggestedInRunIds: string[];
	reviewNotes: string;
	supersedesIds: string[];
}

export interface IntelligenceFactorSet {
	executionReadiness: number;
	finishProximity: number;
	evidenceStrength: number;
	supportFit: number;
	executionHealth: number;
	attentionCost: number;
	coldnessDrift: number;
	decisionStateFit: number;
	ambiguityPenalty: number;
	blockerPenalty: number;
	lowEvidencePenalty: number;
	highFrictionPenalty: number;
	weakSupportPenalty: number;
	repeatedExecutionPain: number;
}

export interface ProjectIntelligenceContext {
	project: IntelligenceProjectRecord;
	linkedResearch: ResearchLibraryRecord[];
	linkedSkills: SkillLibraryRecord[];
	linkedTools: ToolMatrixRecord[];
	openDecisions: ProjectDecisionRecord[];
	projectPackets: WorkPacketRecord[];
	projectTasks: ExecutionTaskRecord[];
	recentBuildSessions: ControlTowerBuildSessionRecord[];
	activePacket?: WorkPacketRecord;
	supportRich: boolean;
	factors: IntelligenceFactorSet;
}

export interface ProjectRecommendation {
	projectId: string;
	projectTitle: string;
	lane: RecommendationLane;
	score: number;
	confidence: RecommendationConfidence;
	scores: Record<Exclude<RecommendationLane, "Monitor">, number>;
	topPositiveFactors: string[];
	limitingFactors: string[];
	whyNow: string;
	whyNotNow: string;
	recommendedNextAction: string;
	supportSummary: string;
	supportRich: boolean;
}

export interface IntelligenceMetrics {
	totalProjects: number;
	resumeCandidates: number;
	finishCandidates: number;
	investigateCandidates: number;
	deferCandidates: number;
	monitorProjects: number;
	orphanedProjects: number;
	supportGapProjects: number;
	proposedLinkSuggestions: number;
	acceptedLinkSuggestions: number;
}

export interface CandidateLinkSuggestion {
	projectId: string;
	projectTitle: string;
	suggestionType: LinkSuggestionRecord["suggestionType"];
	targetId: string;
	targetTitle: string;
	confidenceScore: number;
	matchReasons: string[];
}

export interface LocalPortfolioIntelligenceViewSpec {
	name: string;
	viewId?: string;
	type: "table" | "board" | "gallery";
	purpose: string;
	configure: string;
}

export interface LocalPortfolioIntelligenceViewCollection {
	key: "projects" | "recommendationRuns" | "linkSuggestions";
	database: ExecutionDataSourceRef;
	views: LocalPortfolioIntelligenceViewSpec[];
}

export interface LocalPortfolioIntelligenceViewPlan {
	version: 1;
	strategy: {
		primary: "notion_mcp";
		fallback: "playwright";
		notes: string[];
	};
	collections: LocalPortfolioIntelligenceViewCollection[];
}

export function requirePhase3Intelligence(
	config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase3Intelligence"]> {
	if (!config.phase3Intelligence) {
		throw new AppError("Control tower config is missing phase3Intelligence");
	}

	return config.phase3Intelligence;
}

export async function loadLocalPortfolioIntelligenceViewPlan(
	filePath = loadRuntimeConfig().paths.intelligenceViewsPath,
): Promise<LocalPortfolioIntelligenceViewPlan> {
	const raw = await readJsonFile<unknown>(filePath);
	return parseLocalPortfolioIntelligenceViewPlan(raw);
}

export function parseLocalPortfolioIntelligenceViewPlan(
	raw: unknown,
): LocalPortfolioIntelligenceViewPlan {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio intelligence views config must be an object",
		);
	}

	const plan = raw as Record<string, unknown>;
	if (plan.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio intelligence views config version "${String(plan.version)}"`,
		);
	}

	return {
		version: 1,
		strategy: parseStrategy(plan.strategy),
		collections: parseCollections(plan.collections),
	};
}

export function buildProjectIntelligenceContext(input: {
	project: IntelligenceProjectRecord;
	researchRecords: ResearchLibraryRecord[];
	skillRecords: SkillLibraryRecord[];
	toolRecords: ToolMatrixRecord[];
	decisions: ProjectDecisionRecord[];
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	buildSessions: ControlTowerBuildSessionRecord[];
	today: string;
}): ProjectIntelligenceContext {
	const linkedResearch = input.researchRecords.filter((record) =>
		input.project.relatedResearchIds.includes(record.id),
	);
	const linkedSkills = input.skillRecords.filter((record) =>
		input.project.supportingSkillIds.includes(record.id),
	);
	const linkedTools = input.toolRecords.filter((record) =>
		input.project.toolStackIds.includes(record.id),
	);
	const openDecisions = input.decisions.filter(
		(decision) =>
			decision.localProjectIds.includes(input.project.id) &&
			decision.status === "Proposed",
	);
	const projectPackets = input.packets.filter((packet) =>
		packet.localProjectIds.includes(input.project.id),
	);
	const projectTasks = input.tasks.filter((task) =>
		task.localProjectIds.includes(input.project.id),
	);
	const recentBuildSessions = input.buildSessions
		.filter((session) => session.localProjectIds.includes(input.project.id))
		.sort((left, right) => compareIsoDate(right.sessionDate, left.sessionDate))
		.slice(0, 5);
	const activePacket = projectPackets.find(
		(packet) => packet.priority === "Now" && !isClosedPacket(packet.status),
	);
	const supportRich =
		linkedResearch.length + linkedSkills.length + linkedTools.length >= 3;

	return {
		project: input.project,
		linkedResearch,
		linkedSkills,
		linkedTools,
		openDecisions,
		projectPackets,
		projectTasks,
		recentBuildSessions,
		activePacket,
		supportRich,
		factors: calculateFactors({
			project: input.project,
			linkedResearch,
			linkedSkills,
			linkedTools,
			openDecisions,
			projectPackets,
			projectTasks,
			today: input.today,
		}),
	};
}

export function buildRecommendation(
	context: ProjectIntelligenceContext,
	externalSignalSummary?: ExternalSignalSummary,
): ProjectRecommendation {
	const external = buildExternalRecommendationAdjustments(
		context.project,
		externalSignalSummary,
	);
	const scores = {
		Resume: roundScore(
			context.factors.executionReadiness * 0.3 +
				context.factors.supportFit * 0.2 +
				context.factors.evidenceStrength * 0.15 +
				context.factors.executionHealth * 0.15 +
				context.factors.attentionCost * 0.1 +
				freshnessScore(context.project) * 0.1 +
				external.resumeBoost,
		),
		Finish: roundScore(
			context.factors.finishProximity * 0.35 +
				context.factors.executionHealth * 0.2 +
				context.factors.evidenceStrength * 0.15 +
				context.factors.supportFit * 0.1 +
				context.factors.attentionCost * 0.1 +
				(100 - context.factors.blockerPenalty) * 0.1 +
				external.finishBoost,
		),
		Investigate: roundScore(
			context.factors.decisionStateFit * 0.3 +
				context.factors.evidenceStrength * 0.25 +
				context.factors.supportFit * 0.2 +
				freshnessScore(context.project) * 0.15 +
				(100 - context.factors.ambiguityPenalty) * 0.1 +
				external.investigateBoost,
		),
		Defer: roundScore(
			context.factors.coldnessDrift * 0.3 +
				context.factors.lowEvidencePenalty * 0.25 +
				context.factors.highFrictionPenalty * 0.2 +
				context.factors.weakSupportPenalty * 0.15 +
				context.factors.repeatedExecutionPain * 0.1 +
				external.deferBoost,
		),
	} satisfies Record<Exclude<RecommendationLane, "Monitor">, number>;

	const sorted = Object.entries(scores).sort(
		(left, right) => right[1] - left[1],
	);
	const [topLane, topScore] = sorted[0] as [
		Exclude<RecommendationLane, "Monitor">,
		number,
	];
	const lane = chooseRecommendationLane(context, scores, topLane, topScore);
	const confidence = determineConfidence(context, externalSignalSummary);
	const topPositiveFactors = describePositiveFactors(lane, context).slice(0, 3);
	const limitingFactors = describeLimitingFactors(lane, context).slice(0, 2);

	return {
		projectId: context.project.id,
		projectTitle: context.project.title,
		lane,
		score: lane === "Monitor" ? 40 : topScore,
		confidence,
		scores,
		topPositiveFactors,
		limitingFactors,
		whyNow:
			topPositiveFactors.join("; ") ||
			"The structured signals point to a clear next lane.",
		whyNotNow:
			limitingFactors.join("; ") ||
			"No major structural constraint is standing out.",
		recommendedNextAction: buildNextAction(lane, context),
		supportSummary: context.supportRich
			? "Support-rich: the project already has enough linked research, skills, and tools to steer execution."
			: "Support-poor: the project still needs stronger linked research, skill, or tool support.",
		supportRich: context.supportRich,
	};
}

function chooseRecommendationLane(
	context: ProjectIntelligenceContext,
	scores: Record<Exclude<RecommendationLane, "Monitor">, number>,
	topLane: Exclude<RecommendationLane, "Monitor">,
	topScore: number,
): RecommendationLane {
	const state = context.project.currentState;
	const queue = context.project.operatingQueue;
	const call = context.project.portfolioCall;
	const buildMaturity = context.project.buildMaturity;
	const shipReadiness = context.project.shipReadiness;
	const finishTrack =
		state === "Ready for Review" ||
		state === "Ready to Demo" ||
		call === "Finish" ||
		queue === "Worth Finishing";
	const closeToDone =
		buildMaturity === "Feature Complete" ||
		buildMaturity === "Demoable" ||
		buildMaturity === "Shippable" ||
		shipReadiness === "Near Ship" ||
		shipReadiness === "Ship-Ready" ||
		shipReadiness === "Needs Hardening";

	if (state === "Shipped" || queue === "Shipped") {
		return "Monitor";
	}

	if (state === "Archived" || queue === "Cold Storage" || call === "Archive") {
		return "Defer";
	}

	if (state === "Needs Decision") {
		return scores.Investigate >= 35 ? "Investigate" : "Monitor";
	}

	if (finishTrack && closeToDone) {
		return scores.Finish >= 35 ? "Finish" : "Monitor";
	}

	return topScore >= 45 ? topLane : "Monitor";
}

export function calculateIntelligenceMetrics(input: {
	projects: IntelligenceProjectRecord[];
	recommendations: ProjectRecommendation[];
	linkSuggestions: Array<LinkSuggestionRecord | CandidateLinkSuggestion>;
}): IntelligenceMetrics {
	const laneCounts = new Map<RecommendationLane, number>();
	for (const recommendation of input.recommendations) {
		laneCounts.set(
			recommendation.lane,
			(laneCounts.get(recommendation.lane) ?? 0) + 1,
		);
	}

	return {
		totalProjects: input.projects.length,
		resumeCandidates: laneCounts.get("Resume") ?? 0,
		finishCandidates: laneCounts.get("Finish") ?? 0,
		investigateCandidates: laneCounts.get("Investigate") ?? 0,
		deferCandidates: laneCounts.get("Defer") ?? 0,
		monitorProjects: laneCounts.get("Monitor") ?? 0,
		orphanedProjects: input.projects.filter(
			(project) => totalSupportLinks(project) === 0,
		).length,
		supportGapProjects: input.projects.filter(
			(project) => totalSupportLinks(project) < 2,
		).length,
		proposedLinkSuggestions: input.linkSuggestions.filter((suggestion) =>
			"status" in suggestion ? suggestion.status === "Proposed" : true,
		).length,
		acceptedLinkSuggestions: input.linkSuggestions.filter((suggestion) =>
			"status" in suggestion ? suggestion.status === "Accepted" : false,
		).length,
	};
}

export function generateCandidateLinkSuggestions(input: {
	projects: IntelligenceProjectRecord[];
	researchRecords: ResearchLibraryRecord[];
	skillRecords: SkillLibraryRecord[];
	toolRecords: ToolMatrixRecord[];
	existingSuggestions: LinkSuggestionRecord[];
	config: LocalPortfolioControlTowerConfig;
}): CandidateLinkSuggestion[] {
	const phase3 = requirePhase3Intelligence(input.config);
	const minimum = phase3.confidenceThresholds.suggestionMinimum;
	const candidates: CandidateLinkSuggestion[] = [];

	for (const project of input.projects) {
		const rejectedKeys = new Set(
			input.existingSuggestions
				.filter(
					(suggestion) =>
						suggestion.status === "Rejected" &&
						suggestion.localProjectIds.includes(project.id),
				)
				.map((suggestion) => buildSuppressionKey(suggestion)),
		);

		candidates.push(
			...buildSupportCandidates({
				project,
				existingIds: new Set(project.relatedResearchIds),
				records: input.researchRecords,
				suggestionType: "Project->Research",
				minimum,
				rejectedKeys,
				tokenBuilder: (record) => [
					record.title,
					record.category,
					...record.tags,
				],
			}),
			...buildSupportCandidates({
				project,
				existingIds: new Set(project.supportingSkillIds),
				records: input.skillRecords,
				suggestionType: "Project->Skill",
				minimum,
				rejectedKeys,
				tokenBuilder: (record) => [
					record.title,
					record.category,
					record.projectRelevance,
					record.status,
				],
			}),
			...buildSupportCandidates({
				project,
				existingIds: new Set(project.toolStackIds),
				records: input.toolRecords,
				suggestionType: "Project->Tool",
				minimum,
				rejectedKeys,
				tokenBuilder: (record) => [
					record.title,
					record.category,
					record.stackIntegration,
					record.status,
					...record.tags,
				],
			}),
		);
	}

	return candidates.sort(
		(left, right) => right.confidenceScore - left.confidenceScore,
	);
}

export function renderRecommendationBriefSection(input: {
	context: ProjectIntelligenceContext;
	recommendation: ProjectRecommendation;
}): string {
	const strongestResearch = input.context.linkedResearch
		.slice(0, 3)
		.map((record) => `[${record.title}](${record.url})`);
	const strongestSkills = input.context.linkedSkills
		.slice(0, 3)
		.map((record) => `[${record.title}](${record.url})`);
	const strongestTools = input.context.linkedTools
		.slice(0, 3)
		.map((record) => `[${record.title}](${record.url})`);

	return [
		"<!-- codex:notion-recommendation-brief:start -->",
		"## Recommendation Brief",
		"",
		`Updated: ${input.context.project.recommendationUpdated || input.context.project.lastActive || "Unknown"}`,
		`- Lane: ${input.recommendation.lane}`,
		`- Score: ${input.recommendation.score}`,
		`- Confidence: ${input.recommendation.confidence}`,
		`- Support posture: ${input.recommendation.supportRich ? "Support-rich" : "Support-poor"}`,
		"",
		"### Why Now",
		`- ${input.recommendation.whyNow}`,
		"",
		"### Why Not Now",
		`- ${input.recommendation.whyNotNow}`,
		"",
		"### Strongest Research Support",
		...(strongestResearch.length > 0
			? strongestResearch.map((item) => `- ${item}`)
			: ["- No linked research support yet."]),
		"",
		"### Strongest Skill Support",
		...(strongestSkills.length > 0
			? strongestSkills.map((item) => `- ${item}`)
			: ["- No linked skill support yet."]),
		"",
		"### Strongest Tool Support",
		...(strongestTools.length > 0
			? strongestTools.map((item) => `- ${item}`)
			: ["- No linked tool support yet."]),
		"",
		"### Missing Support",
		`- ${input.recommendation.supportSummary}`,
		"",
		"### Recommended Next Weekly Action",
		`- ${input.recommendation.recommendedNextAction}`,
		"<!-- codex:notion-recommendation-brief:end -->",
	].join("\n");
}

export function renderIntelligenceCommandCenterSection(input: {
	recommendations: ProjectRecommendation[];
	projects: IntelligenceProjectRecord[];
	latestWeeklyRun?: RecommendationRunRecord;
	latestDailyRun?: RecommendationRunRecord;
	linkSuggestionQueue: LinkSuggestionRecord[];
}): string {
	const resume = topRecommendations(input.recommendations, "Resume", 5);
	const finish = topRecommendations(input.recommendations, "Finish", 5);
	const investigate = topRecommendations(
		input.recommendations,
		"Investigate",
		5,
	);
	const defer = topRecommendations(input.recommendations, "Defer", 5);

	return [
		"<!-- codex:notion-intelligence-command-center:start -->",
		"## Phase 3 Cross-Database Intelligence",
		"",
		`- Resume candidates: ${resume.length}`,
		`- Finish candidates: ${finish.length}`,
		`- Investigate candidates: ${investigate.length}`,
		`- Defer candidates: ${defer.length}`,
		`- Orphaned projects: ${input.projects.filter((project) => totalSupportLinks(project) === 0).length}`,
		`- Link review queue: ${input.linkSuggestionQueue.filter((suggestion) => suggestion.status === "Proposed").length}`,
		`- Latest weekly run: ${input.latestWeeklyRun ? `[${input.latestWeeklyRun.title}](${input.latestWeeklyRun.url})` : "None yet"}`,
		`- Daily focus: ${input.latestDailyRun ? `[${input.latestDailyRun.title}](${input.latestDailyRun.url})` : "None yet"}`,
		"",
		"### Top Resume",
		...formatRecommendationBullets(resume, "- No resume candidates yet."),
		"",
		"### Top Finish",
		...formatRecommendationBullets(finish, "- No finish candidates yet."),
		"",
		"### Top Investigate",
		...formatRecommendationBullets(
			investigate,
			"- No investigate candidates yet.",
		),
		"",
		"### Top Defer",
		...formatRecommendationBullets(defer, "- No defer candidates yet."),
		"<!-- codex:notion-intelligence-command-center:end -->",
	].join("\n");
}

export function renderWeeklyIntelligenceSection(input: {
	weekTitle: string;
	latestRun?: RecommendationRunRecord;
	recommendations: ProjectRecommendation[];
	acceptedSuggestions: LinkSuggestionRecord[];
	rejectedSuggestions: LinkSuggestionRecord[];
	followedRecommendations: string[];
}): string {
	return [
		"<!-- codex:notion-weekly-intelligence:start -->",
		"## Phase 3 Recommendation Summary",
		"",
		`Weekly recommendation run: ${input.latestRun ? `[${input.latestRun.title}](${input.latestRun.url})` : input.weekTitle}`,
		"",
		"### Recommendation Changes",
		...formatRecommendationBullets(
			input.recommendations.slice(0, 4),
			"- No recommendation changes captured yet.",
		),
		"",
		"### Accepted Link Suggestions",
		...(input.acceptedSuggestions.length > 0
			? input.acceptedSuggestions.map(
					(suggestion) => `- [${suggestion.title}](${suggestion.url})`,
				)
			: ["- No accepted link suggestions this week."]),
		"",
		"### Rejected Link Suggestions",
		...(input.rejectedSuggestions.length > 0
			? input.rejectedSuggestions.map(
					(suggestion) => `- [${suggestion.title}](${suggestion.url})`,
				)
			: ["- No rejected link suggestions this week."]),
		"",
		"### Recommendation Follow-Through",
		...(input.followedRecommendations.length > 0
			? input.followedRecommendations.map((item) => `- ${item}`)
			: [
					"- Weekly execution has not yet confirmed follow-through against the latest recommendation run.",
				]),
		"<!-- codex:notion-weekly-intelligence:end -->",
	].join("\n");
}

export function renderRecommendationRunMarkdown(input: {
	runTitle: string;
	runType: string;
	status: string;
	modelVersion: string;
	generatedAt: string;
	recommendations: ProjectRecommendation[];
	topResume?: ProjectRecommendation;
	topFinish?: ProjectRecommendation;
	topInvestigate?: ProjectRecommendation;
	topDefer?: ProjectRecommendation;
	dailyFocus?: string[];
}): string {
	return [
		`# ${input.runTitle}`,
		"",
		`- Run type: ${input.runType}`,
		`- Status: ${input.status}`,
		`- Model version: ${input.modelVersion}`,
		`- Generated: ${input.generatedAt}`,
		"",
		"## Portfolio Calls",
		...(input.topResume
			? [
					`- Resume: ${input.topResume.projectTitle} (${input.topResume.score}, ${input.topResume.confidence})`,
				]
			: ["- Resume: none"]),
		...(input.topFinish
			? [
					`- Finish: ${input.topFinish.projectTitle} (${input.topFinish.score}, ${input.topFinish.confidence})`,
				]
			: ["- Finish: none"]),
		...(input.topInvestigate
			? [
					`- Investigate: ${input.topInvestigate.projectTitle} (${input.topInvestigate.score}, ${input.topInvestigate.confidence})`,
				]
			: ["- Investigate: none"]),
		...(input.topDefer
			? [
					`- Defer: ${input.topDefer.projectTitle} (${input.topDefer.score}, ${input.topDefer.confidence})`,
				]
			: ["- Defer: none"]),
		"",
		"## Ranked Recommendations",
		...input.recommendations
			.slice(0, 10)
			.map(
				(recommendation, index) =>
					`${index + 1}. ${recommendation.projectTitle} - ${recommendation.lane} (${recommendation.score}, ${recommendation.confidence})`,
			),
		"",
		"## Why These Calls",
		...input.recommendations
			.slice(0, 5)
			.flatMap((recommendation) => [
				`### ${recommendation.projectTitle}`,
				`- Why now: ${recommendation.whyNow}`,
				`- Why not now: ${recommendation.whyNotNow}`,
				`- Next action: ${recommendation.recommendedNextAction}`,
				"",
			]),
		"## Daily Focus",
		...((input.dailyFocus ?? []).length > 0
			? (input.dailyFocus ?? []).map((item) => `- ${item}`)
			: [
					"- Use the active Now packet first, otherwise follow the top weekly recommendation.",
				]),
	].join("\n");
}

function calculateFactors(input: {
	project: IntelligenceProjectRecord;
	linkedResearch: ResearchLibraryRecord[];
	linkedSkills: SkillLibraryRecord[];
	linkedTools: ToolMatrixRecord[];
	openDecisions: ProjectDecisionRecord[];
	projectPackets: WorkPacketRecord[];
	projectTasks: ExecutionTaskRecord[];
	today: string;
}): IntelligenceFactorSet {
	const linkedSupport =
		input.linkedResearch.length +
		input.linkedSkills.length +
		input.linkedTools.length;
	const blockedPackets = input.projectPackets.filter(
		(packet) => packet.status === "Blocked",
	).length;
	const blockedTasks = input.projectTasks.filter(
		(task) => task.status === "Blocked",
	).length;
	const activePacket = input.projectPackets.find(
		(packet) => packet.priority === "Now" && !isClosedPacket(packet.status),
	);
	const recentDonePackets = input.projectPackets.filter(
		(packet) =>
			packet.status === "Done" &&
			diffDays(packet.targetFinish, input.today) <= 21,
	).length;
	const rolloutPain =
		input.projectPackets.reduce(
			(total, packet) => total + packet.rolloverCount,
			0,
		) + blockedTasks;

	const executionReadiness = clamp(
		queueReadiness(input.project.operatingQueue) +
			boolScore(Boolean(input.project.nextMove), 15) +
			yesNoScore(input.project.runsLocally, 15) +
			inverseOptionScore(input.project.setupFriction, {
				Low: 20,
				Medium: 12,
				High: 4,
			}) +
			boolScore(Boolean(activePacket), 10) +
			boolScore(input.openDecisions.length === 0, 10),
	);
	const finishProximity = clamp(
		optionScore(input.project.shipReadiness, {
			"Near Ship": 35,
			"Ready to Demo": 28,
			"Needs Proof": 18,
			Unknown: 8,
		}) +
			inverseOptionScore(input.project.effortToShip, {
				"<30m": 20,
				"1h": 18,
				"Half day": 16,
				"1 day": 14,
				"2-3 days": 10,
				"1 week": 6,
				"1-2 weeks": 4,
			}) +
			optionScore(input.project.buildMaturity, {
				"Feature Complete": 25,
				"Working Core": 20,
				Prototype: 12,
				"Needs Setup": 5,
			}) +
			Math.min(recentDonePackets, 2) * 10,
	);
	const evidenceStrength = clamp(
		optionScore(input.project.evidenceFreshness, {
			Fresh: 35,
			Aging: 20,
			Stale: 8,
		}) +
			optionScore(input.project.evidenceConfidence, {
				High: 20,
				Medium: 12,
				Low: 5,
			}) +
			optionScore(input.project.docsQuality, {
				Strong: 15,
				Usable: 10,
				Thin: 5,
				Missing: 0,
			}) +
			optionScore(input.project.testPosture, {
				Strong: 15,
				Some: 10,
				Sparse: 5,
				Unknown: 3,
			}) +
			Math.min(input.linkedResearch.length, 3) * 5,
	);
	const supportFit = clamp(
		Math.min(input.linkedResearch.length, 3) * 12 +
			Math.min(input.linkedSkills.length, 3) * 10 +
			Math.min(input.linkedTools.length, 3) * 10 +
			optionScore(
				mostCommon(input.linkedSkills.map((skill) => skill.projectRelevance)),
				{
					Core: 20,
					Useful: 12,
					Peripheral: 6,
				},
			) +
			boolScore(linkedSupport >= 3, 12),
	);
	const executionHealth = clamp(
		100 -
			blockedPackets * 20 -
			blockedTasks * 10 -
			rolloutPain * 8 -
			input.openDecisions.length * 8 +
			boolScore(Boolean(activePacket), 8),
	);
	const attentionCost = clamp(
		inverseOptionScore(input.project.setupFriction, {
			Low: 40,
			Medium: 24,
			High: 8,
		}) +
			inverseOptionScore(input.project.effortToDemo, {
				"<30m": 35,
				"1h": 30,
				"Half day": 25,
				"1 day": 20,
				"2-3 days": 12,
				"1 week": 8,
			}) +
			yesNoScore(input.project.runsLocally, 20),
	);
	const coldnessDrift = clamp(
		optionScore(input.project.evidenceFreshness, {
			Stale: 30,
			Aging: 18,
			Fresh: 5,
		}) +
			optionScore(input.project.currentState, {
				Parked: 25,
				Archived: 30,
				"Needs Decision": 15,
				"Active Build": 5,
			}) +
			boolScore(
				!input.project.lastActive ||
					diffDays(input.project.lastActive, input.today) > 30,
				25,
			),
	);
	const decisionStateFit = clamp(
		optionScore(input.project.currentState, {
			"Needs Decision": 45,
			"Ready for Review": 18,
			"Active Build": 10,
		}) +
			Math.min(input.openDecisions.length, 3) * 15 +
			Math.min(input.linkedResearch.length, 2) * 10,
	);
	const ambiguityPenalty = clamp(
		100 -
			optionScore(input.project.evidenceConfidence, {
				High: 70,
				Medium: 45,
				Low: 10,
			}) -
			Math.min(input.linkedResearch.length, 2) * 10,
	);
	const blockerPenalty = clamp(
		blockedPackets * 40 + blockedTasks * 20 + input.openDecisions.length * 15,
	);
	const lowEvidencePenalty = clamp(100 - evidenceStrength);
	const highFrictionPenalty = clamp(100 - attentionCost);
	const weakSupportPenalty = clamp(100 - supportFit);
	const repeatedExecutionPain = clamp(Math.min(rolloutPain, 10) * 10);

	return {
		executionReadiness,
		finishProximity,
		evidenceStrength,
		supportFit,
		executionHealth,
		attentionCost,
		coldnessDrift,
		decisionStateFit,
		ambiguityPenalty,
		blockerPenalty,
		lowEvidencePenalty,
		highFrictionPenalty,
		weakSupportPenalty,
		repeatedExecutionPain,
	};
}

function determineConfidence(
	context: ProjectIntelligenceContext,
	externalSignalSummary?: ExternalSignalSummary,
): RecommendationConfidence {
	const density =
		context.linkedResearch.length +
		context.linkedSkills.length +
		context.linkedTools.length +
		context.projectPackets.length +
		context.projectTasks.length +
		context.recentBuildSessions.length +
		(externalSignalSummary?.activeSources.length ?? 0) +
		Math.min(externalSignalSummary?.recentEvents.length ?? 0, 4);
	if (density >= 8 && context.project.evidenceFreshness === "Fresh") {
		return "High";
	}
	if (density >= 4) {
		return "Medium";
	}
	return "Low";
}

function describePositiveFactors(
	lane: RecommendationLane,
	context: ProjectIntelligenceContext,
): string[] {
	const factorPairs = factorDescriptions(lane, context, false)
		.sort((left, right) => right.score - left.score)
		.filter((entry) => entry.score > 45);
	return factorPairs.map((entry) => entry.description);
}

function describeLimitingFactors(
	lane: RecommendationLane,
	context: ProjectIntelligenceContext,
): string[] {
	const factorPairs = factorDescriptions(lane, context, true).sort(
		(left, right) => right.score - left.score,
	);
	return factorPairs.map((entry) => entry.description);
}

function factorDescriptions(
	lane: RecommendationLane,
	context: ProjectIntelligenceContext,
	limiting: boolean,
): Array<{ score: number; description: string }> {
	const shared = {
		readiness: context.factors.executionReadiness,
		finish: context.factors.finishProximity,
		evidence: context.factors.evidenceStrength,
		support: context.factors.supportFit,
		health: context.factors.executionHealth,
		cost: context.factors.attentionCost,
		drift: context.factors.coldnessDrift,
		decisions: context.factors.decisionStateFit,
	};

	if (lane === "Finish") {
		return limiting
			? [
					{
						score: context.factors.blockerPenalty,
						description: "Blockers still reduce finish confidence.",
					},
					{
						score: 100 - shared.evidence,
						description:
							"Evidence is not yet as strong as a finish push would like.",
					},
					{
						score: 100 - shared.support,
						description:
							"Support coverage is still thinner than ideal for a finish push.",
					},
				]
			: [
					{
						score: shared.finish,
						description:
							"The project is already close to a demo or ship point.",
					},
					{
						score: shared.health,
						description:
							"Execution history is healthy enough to support a finish push.",
					},
					{
						score: shared.evidence,
						description: "Evidence is fresh enough to justify finishing now.",
					},
				];
	}

	if (lane === "Investigate") {
		return limiting
			? [
					{
						score: context.factors.ambiguityPenalty,
						description:
							"Ambiguity is still high enough that the decision needs more structure.",
					},
					{
						score: 100 - shared.support,
						description:
							"Support coverage is still too thin in at least one domain.",
					},
					{
						score: 100 - shared.evidence,
						description:
							"Evidence freshness or confidence still needs strengthening.",
					},
				]
			: [
					{
						score: shared.decisions,
						description:
							"The project is already near a meaningful portfolio or delivery decision.",
					},
					{
						score: shared.evidence,
						description:
							"There is enough evidence to investigate the decision cleanly.",
					},
					{
						score: shared.support,
						description:
							"Linked support gives the investigation something concrete to work from.",
					},
				];
	}

	if (lane === "Defer") {
		return limiting
			? [
					{
						score: 100 - shared.drift,
						description: "The coldness signal is not overwhelming yet.",
					},
					{
						score: 100 - context.factors.highFrictionPenalty,
						description: "Execution friction is not the main problem yet.",
					},
					{
						score: 100 - context.factors.lowEvidencePenalty,
						description:
							"Evidence quality may still justify keeping this alive.",
					},
				]
			: [
					{
						score: shared.drift,
						description:
							"The project is drifting cold or stale relative to the rest of the portfolio.",
					},
					{
						score: context.factors.lowEvidencePenalty,
						description:
							"Evidence quality is too weak to justify active attention.",
					},
					{
						score: context.factors.highFrictionPenalty,
						description:
							"Attention cost is high compared with the current portfolio upside.",
					},
				];
	}

	if (lane === "Monitor") {
		return limiting
			? [
					{
						score: 60,
						description:
							"The signals do not yet support a stronger lane than Monitor.",
					},
				]
			: [
					{
						score: 55,
						description:
							"The project should stay visible while stronger evidence accumulates.",
					},
				];
	}

	return limiting
		? [
				{
					score: 100 - shared.readiness,
					description: "Execution readiness still has a few weak spots.",
				},
				{
					score: 100 - shared.support,
					description:
						"Support coverage is not yet as deep as the strongest candidates.",
				},
				{
					score: 100 - shared.health,
					description:
						"Execution history still carries some friction or blocker drag.",
				},
			]
		: [
				{
					score: shared.readiness,
					description:
						"The project is ready to restart with low setup friction.",
				},
				{
					score: shared.support,
					description:
						"Support coverage is already good enough to move with confidence.",
				},
				{
					score: shared.health,
					description:
						"Execution history is healthy enough to make progress stick.",
				},
			];
}

function buildNextAction(
	lane: RecommendationLane,
	context: ProjectIntelligenceContext,
): string {
	switch (lane) {
		case "Resume":
			return context.activePacket
				? `Keep the active packet moving on ${context.project.title} and clear the next due task.`
				: `Create or promote a tight work packet for ${context.project.title} and execute the next move: ${context.project.nextMove || "define the next move"}.`;
		case "Finish":
			return `Narrow ${context.project.title} to the minimum demo-or-ship slice and drive a finish packet this week.`;
		case "Investigate":
			return `Use linked research and open decisions to resolve the next material question on ${context.project.title}.`;
		case "Defer":
			return `Review whether ${context.project.title} should be parked, archived, merged, or held until support improves.`;
		default:
			return `Keep ${context.project.title} visible, but wait for a stronger signal before committing more attention.`;
	}
}

function buildSupportCandidates<
	T extends { id: string; title: string },
>(input: {
	project: IntelligenceProjectRecord;
	existingIds: Set<string>;
	records: T[];
	suggestionType: CandidateLinkSuggestion["suggestionType"];
	minimum: number;
	rejectedKeys: Set<string>;
	tokenBuilder: (record: T) => string[];
}): CandidateLinkSuggestion[] {
	const projectTokens = buildProjectTokens(input.project);
	return input.records
		.filter((record) => !input.existingIds.has(record.id))
		.map((record) => {
			const recordTokens = tokenize(input.tokenBuilder(record));
			const lexical = tokenOverlap(projectTokens, recordTokens);
			const category = categoryOverlap(input.project.category, recordTokens);
			const context = contextualBoost(input.project, recordTokens);
			const recency = recencyBoost(
				record as Partial<
					ResearchLibraryRecord & SkillLibraryRecord & ToolMatrixRecord
				>,
			);
			const needBoost = suggestionNeedBoost(
				input.project,
				lexical,
				category,
				context,
			);
			const score = roundConfidence(
				lexical * 0.25 +
					category * 0.25 +
					recency * 0.15 +
					context * 0.1 +
					needBoost,
			);
			const reasons = buildMatchReasons(lexical, category, recency, context);
			const suggestion: CandidateLinkSuggestion = {
				projectId: input.project.id,
				projectTitle: input.project.title,
				suggestionType: input.suggestionType,
				targetId: record.id,
				targetTitle: record.title,
				confidenceScore: score,
				matchReasons: reasons,
			};
			return suggestion;
		})
		.filter((suggestion) => suggestion.confidenceScore >= input.minimum)
		.filter(
			(suggestion) =>
				!input.rejectedKeys.has(buildCandidateSuppressionKey(suggestion)),
		)
		.sort((left, right) => right.confidenceScore - left.confidenceScore)
		.slice(0, 1);
}

function topRecommendations(
	recommendations: ProjectRecommendation[],
	lane: RecommendationLane,
	limit: number,
): ProjectRecommendation[] {
	return recommendations
		.filter((recommendation) => recommendation.lane === lane)
		.sort((left, right) => right.score - left.score)
		.slice(0, limit);
}

function formatRecommendationBullets(
	recommendations: ProjectRecommendation[],
	emptyLine: string,
): string[] {
	if (recommendations.length === 0) {
		return [emptyLine];
	}

	return recommendations.map(
		(recommendation) =>
			`- ${recommendation.projectTitle} - ${recommendation.score} (${recommendation.confidence}) - ${recommendation.recommendedNextAction}`,
	);
}

function freshnessScore(project: IntelligenceProjectRecord): number {
	return clamp(
		optionScore(project.evidenceFreshness, {
			Fresh: 70,
			Aging: 40,
			Stale: 10,
		}) + boolScore(Boolean(project.lastActive), 30),
	);
}

function totalSupportLinks(project: IntelligenceProjectRecord): number {
	return (
		project.relatedResearchIds.length +
		project.supportingSkillIds.length +
		project.toolStackIds.length
	);
}

function buildProjectTokens(project: IntelligenceProjectRecord): string[] {
	return tokenize([
		project.title,
		project.oneLinePitch,
		project.category,
		...project.projectShape,
		...project.deploymentSurface,
		project.primaryTool,
	]);
}

function tokenize(parts: string[]): string[] {
	return [
		...new Set(
			parts.flatMap((part) =>
				part
					.toLowerCase()
					.split(/[^a-z0-9]+/g)
					.map((token) => token.trim())
					.filter((token) => token.length > 2),
			),
		),
	];
}

function tokenOverlap(left: string[], right: string[]): number {
	if (left.length === 0 || right.length === 0) {
		return 0;
	}
	const rightSet = new Set(right);
	const matches = left.filter((token) => rightSet.has(token)).length;
	return matches / Math.max(1, Math.min(left.length, right.length));
}

function categoryOverlap(category: string, tokens: string[]): number {
	if (!category) {
		return 0;
	}
	const categoryTokens = tokenize([category]);
	return tokenOverlap(categoryTokens, tokens);
}

function contextualBoost(
	project: IntelligenceProjectRecord,
	tokens: string[],
): number {
	const cues = tokenize([
		...project.projectShape,
		...project.deploymentSurface,
		project.primaryTool,
	]);
	return tokenOverlap(cues, tokens);
}

function recencyBoost(
	record: Partial<
		ResearchLibraryRecord & SkillLibraryRecord & ToolMatrixRecord
	>,
): number {
	const dates = [
		record.lastVerified,
		record.lastPracticed,
		record.lastReviewed,
		record.dateResearched,
	].filter(Boolean);
	if (dates.length === 0) {
		return 0.2;
	}
	const newest = dates.sort().slice(-1)[0] ?? "";
	const daysOld = diffDays(newest, losAngelesToday());
	if (daysOld <= 14) {
		return 1;
	}
	if (daysOld <= 45) {
		return 0.7;
	}
	return 0.3;
}

function buildMatchReasons(
	lexical: number,
	category: number,
	recency: number,
	context: number,
): string[] {
	const reasons: string[] = [];
	if (lexical >= 0.3) {
		reasons.push("strong lexical overlap");
	}
	if (category >= 0.3) {
		reasons.push("category or tag overlap");
	}
	if (context >= 0.25) {
		reasons.push("stack or deployment fit");
	}
	if (recency >= 0.7) {
		reasons.push("recently reviewed support");
	}
	return reasons.length > 0 ? reasons : ["general portfolio support fit"];
}

function suggestionNeedBoost(
	project: IntelligenceProjectRecord,
	lexical: number,
	category: number,
	context: number,
): number {
	const signalStrength = Math.max(lexical, category, context);
	if (signalStrength < 0.15) {
		return 0;
	}

	const totalLinks = totalSupportLinks(project);
	const laneBoost =
		project.recommendationLane === "Resume" ||
		project.recommendationLane === "Finish" ||
		project.recommendationLane === "Investigate"
			? 0.2
			: 0.08;

	if (totalLinks === 0) {
		return laneBoost + 0.25;
	}
	if (totalLinks === 1) {
		return laneBoost + 0.12;
	}
	return laneBoost;
}

function buildSuppressionKey(suggestion: LinkSuggestionRecord): string {
	const targetId =
		suggestion.suggestedResearchIds[0] ??
		suggestion.suggestedSkillIds[0] ??
		suggestion.suggestedToolIds[0] ??
		"unknown";
	return `${suggestion.suggestionType}:${suggestion.localProjectIds[0] ?? "unknown"}:${targetId}`;
}

function buildCandidateSuppressionKey(
	suggestion: CandidateLinkSuggestion,
): string {
	return `${suggestion.suggestionType}:${suggestion.projectId}:${suggestion.targetId}`;
}

function parseStrategy(
	raw: unknown,
): LocalPortfolioIntelligenceViewPlan["strategy"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio intelligence views config is missing strategy",
		);
	}
	const strategy = raw as Record<string, unknown>;
	if (strategy.primary !== "notion_mcp") {
		throw new AppError(
			'Local portfolio intelligence views strategy.primary must be "notion_mcp"',
		);
	}
	if (strategy.fallback !== "playwright") {
		throw new AppError(
			'Local portfolio intelligence views strategy.fallback must be "playwright"',
		);
	}
	if (
		!Array.isArray(strategy.notes) ||
		strategy.notes.some((entry) => typeof entry !== "string")
	) {
		throw new AppError(
			"Local portfolio intelligence views strategy.notes must be a string array",
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
): LocalPortfolioIntelligenceViewCollection[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(
			"Local portfolio intelligence views config must include collections",
		);
	}

	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(`collections[${index}] must be an object`);
		}
		const value = entry as Record<string, unknown>;
		const key = requiredString(value.key, `collections[${index}].key`);
		if (
			key !== "projects" &&
			key !== "recommendationRuns" &&
			key !== "linkSuggestions"
		) {
			throw new AppError(
				`collections[${index}].key must be projects, recommendationRuns, or linkSuggestions`,
			);
		}

		return {
			key,
			database: parseExecutionDataSource(
				value.database,
				`collections[${index}].database`,
			),
			views: parseViews(value.views, `collections[${index}].views`),
		};
	});
}

function parseViews(
	raw: unknown,
	fieldName: string,
): LocalPortfolioIntelligenceViewSpec[] {
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

function queueReadiness(queue?: string): number {
	switch (queue) {
		case "Resume Now":
			return 35;
		case "Worth Finishing":
			return 30;
		case "Needs Review":
			return 18;
		case "Needs Decision":
			return 12;
		case "Cold Storage":
			return 4;
		case "Shipped":
			return 0;
		default:
			return 10;
	}
}

function optionScore(
	value: string | undefined,
	map: Record<string, number>,
): number {
	return map[value ?? ""] ?? 0;
}

function inverseOptionScore(
	value: string | undefined,
	map: Record<string, number>,
): number {
	return map[value ?? ""] ?? 0;
}

function yesNoScore(value: string | undefined, yesScore: number): number {
	if (value === "Yes") {
		return yesScore;
	}
	if (value === "No") {
		return 0;
	}
	return Math.round(yesScore * 0.5);
}

function boolScore(value: boolean, score: number): number {
	return value ? score : 0;
}

function mostCommon(values: string[]): string {
	const counts = new Map<string, number>();
	for (const value of values.filter(Boolean)) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return (
		[...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
		""
	);
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

function isClosedPacket(status: string): boolean {
	return status === "Done" || status === "Dropped";
}

function roundScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function roundConfidence(value: number): number {
	return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function clamp(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
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
	return normalizeNotionId(extracted);
}
