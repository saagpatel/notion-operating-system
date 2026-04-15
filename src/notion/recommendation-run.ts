import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { AppError } from "../utils/errors.js";
import {
	assertSafeReplacement,
	buildReplaceCommand,
} from "../utils/markdown.js";
import { postNotificationHubEvent } from "../utils/notification-hub.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	relationIds,
	relationValue,
	toBuildSessionRecord,
} from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import {
	toExecutionTaskRecord,
	toProjectDecisionRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import { buildExternalSignalSummary } from "./local-portfolio-external-signals.js";
import {
	toExternalSignalEventRecord,
	toExternalSignalSourceRecord,
} from "./local-portfolio-external-signals-live.js";
import {
	buildProjectIntelligenceContext,
	buildRecommendation,
	renderRecommendationRunMarkdown,
	renderWeeklyIntelligenceSection,
	requirePhase3Intelligence,
} from "./local-portfolio-intelligence.js";
import {
	ensurePhase3IntelligenceSchema,
	toIntelligenceProjectRecord,
	toLinkSuggestionRecord,
	toRecommendationRunRecord,
	toResearchLibraryRecord,
	toSkillLibraryRecord,
	toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";

const WEEKLY_INTELLIGENCE_START =
	"<!-- codex:notion-weekly-intelligence:start -->";
const WEEKLY_INTELLIGENCE_END = "<!-- codex:notion-weekly-intelligence:end -->";

export interface RecommendationRunCommandOptions {
	live?: boolean;
	today?: string;
	type?: "weekly" | "daily" | "adhoc";
	config?: string;
}

export async function runRecommendationRunCommand(
	options: RecommendationRunCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for recommendation runs",
	);
	const live = options.live ?? false;
	const today = options.today ?? losAngelesToday();
	const type = options.type ?? "weekly";
	const weekStart = startOfWeekMonday(today);
	const configPath =
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
	let config = await loadLocalPortfolioControlTowerConfig(configPath);

	const sdk = new Client({
		auth: token,
		notionVersion: "2026-03-11",
	});
	const api = new DirectNotionClient(token);

	if (live) {
		config = await ensurePhase3IntelligenceSchema(sdk, config);
	}

	const phase3 = requirePhase3Intelligence(config);
	const [
		projectSchema,
		buildSchema,
		weeklySchema,
		researchSchema,
		skillSchema,
		toolSchema,
		decisionSchema,
		packetSchema,
		taskSchema,
		runSchema,
		suggestionSchema,
		sourceSchema,
		eventSchema,
	] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.relatedDataSources.buildLogId),
		api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
		api.retrieveDataSource(config.relatedDataSources.researchId),
		api.retrieveDataSource(config.relatedDataSources.skillsId),
		api.retrieveDataSource(config.relatedDataSources.toolsId),
		api.retrieveDataSource(config.phase2Execution!.decisions.dataSourceId),
		api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
		api.retrieveDataSource(config.phase2Execution!.tasks.dataSourceId),
		api.retrieveDataSource(phase3.recommendationRuns.dataSourceId),
		api.retrieveDataSource(phase3.linkSuggestions.dataSourceId),
		config.phase5ExternalSignals
			? api.retrieveDataSource(
					config.phase5ExternalSignals.sources.dataSourceId,
				)
			: Promise.resolve(undefined),
		config.phase5ExternalSignals
			? api.retrieveDataSource(config.phase5ExternalSignals.events.dataSourceId)
			: Promise.resolve(undefined),
	]);

	const [
		projectPages,
		buildPages,
		weeklyPages,
		researchPages,
		skillPages,
		toolPages,
		decisionPages,
		packetPages,
		taskPages,
		runPages,
		suggestionPages,
		sourcePages,
		eventPages,
	] = await Promise.all([
		fetchAllPages(
			sdk,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.buildLogId,
			buildSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.weeklyReviewsId,
			weeklySchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.researchId,
			researchSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.skillsId,
			skillSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.toolsId,
			toolSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.phase2Execution!.decisions.dataSourceId,
			decisionSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.phase2Execution!.packets.dataSourceId,
			packetSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.phase2Execution!.tasks.dataSourceId,
			taskSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase3.recommendationRuns.dataSourceId,
			runSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase3.linkSuggestions.dataSourceId,
			suggestionSchema.titlePropertyName,
		),
		config.phase5ExternalSignals && sourceSchema
			? fetchAllPages(
					sdk,
					config.phase5ExternalSignals.sources.dataSourceId,
					sourceSchema.titlePropertyName,
				)
			: Promise.resolve([]),
		config.phase5ExternalSignals && eventSchema
			? fetchAllPages(
					sdk,
					config.phase5ExternalSignals.events.dataSourceId,
					eventSchema.titlePropertyName,
				)
			: Promise.resolve([]),
	]);

	const projects = projectPages.map((page) =>
		toIntelligenceProjectRecord(page),
	);
	const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
	const research = researchPages.map((page) => toResearchLibraryRecord(page));
	const skills = skillPages.map((page) => toSkillLibraryRecord(page));
	const tools = toolPages.map((page) => toToolMatrixRecord(page));
	const decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	const existingRuns = runPages.map((page) => toRecommendationRunRecord(page));
	const suggestions = suggestionPages.map((page) =>
		toLinkSuggestionRecord(page),
	);
	const externalSources = sourcePages.map((page) =>
		toExternalSignalSourceRecord(page),
	);
	const externalEvents = eventPages.map((page) =>
		toExternalSignalEventRecord(page),
	);
	const externalSummaryMap = new Map(
		projects.map((project) => [
			project.id,
			buildExternalSignalSummary({
				project,
				sources: externalSources,
				events: externalEvents,
				today,
			}),
		]),
	);

	const recommendations = projects
		.map((project) =>
			buildRecommendation(
				buildProjectIntelligenceContext({
					project,
					researchRecords: research,
					skillRecords: skills,
					toolRecords: tools,
					decisions,
					packets,
					tasks,
					buildSessions,
					today,
				}),
				externalSummaryMap.get(project.id),
			),
		)
		.sort((left, right) => right.score - left.score);

	const topResume = recommendations.filter(
		(entry) => entry.lane === "Resume",
	)[0];
	const topFinish = recommendations.filter(
		(entry) => entry.lane === "Finish",
	)[0];
	const topInvestigate = recommendations.filter(
		(entry) => entry.lane === "Investigate",
	)[0];
	const topDefer = recommendations.filter((entry) => entry.lane === "Defer")[0];
	const dailyFocus = buildDailyFocus({ topResume, tasks, packets, projects });
	const previousRun = existingRuns
		.filter((run) => run.runType === normalizeRunType(type))
		.sort((left, right) => right.runDate.localeCompare(left.runDate))[0];

	const runTitle =
		type === "weekly"
			? `Weekly recommendation run - ${weekStart}`
			: type === "daily"
				? `Daily focus run - ${today}`
				: `Ad hoc recommendation run - ${today}`;
	const status = type === "weekly" ? "Draft" : "Published";
	const markdown = renderRecommendationRunMarkdown({
		runTitle,
		runType: normalizeRunType(type),
		status,
		modelVersion:
			config.phase5ExternalSignals?.scoringModelVersion ??
			phase3.scoringModelVersion,
		generatedAt: today,
		recommendations,
		topResume,
		topFinish,
		topInvestigate,
		topDefer,
		dailyFocus,
	});

	let createdRun: { id: string; url: string } | undefined;
	if (live) {
		const weeklyReview = weeklyPages.find(
			(page) => page.title === `Week of ${weekStart}`,
		);
		const created = await api.createPageWithMarkdown({
			parent: {
				data_source_id: phase3.recommendationRuns.dataSourceId,
			},
			properties: {
				[runSchema.titlePropertyName]: {
					title: [{ type: "text", text: { content: runTitle } }],
				},
			},
			markdown,
		});
		createdRun = created;
		await api.updatePageProperties({
			pageId: created.id,
			properties: {
				"Run Date": { date: { start: today } },
				"Run Type": { select: { name: normalizeRunType(type) } },
				Status: { select: { name: status } },
				"Model Version": {
					rich_text: [
						{
							type: "text",
							text: {
								content:
									config.phase5ExternalSignals?.scoringModelVersion ??
									phase3.scoringModelVersion,
							},
						},
					],
				},
				"Top Resume Project": relationValue(
					topResume ? [topResume.projectId] : [],
				),
				"Top Finish Project": relationValue(
					topFinish ? [topFinish.projectId] : [],
				),
				"Top Investigate Project": relationValue(
					topInvestigate ? [topInvestigate.projectId] : [],
				),
				"Top Defer Project": relationValue(
					topDefer ? [topDefer.projectId] : [],
				),
				"Projects Mentioned": relationValue(
					recommendations
						.slice(0, 8)
						.map((recommendation) => recommendation.projectId),
				),
				"Weekly Review": relationValue(weeklyReview ? [weeklyReview.id] : []),
				Supersedes: relationValue(previousRun ? [previousRun.id] : []),
				Summary: {
					rich_text: [
						{
							type: "text",
							text: {
								content: `Top calls: ${topResume?.projectTitle ?? "none"} resume, ${topFinish?.projectTitle ?? "none"} finish, ${topInvestigate?.projectTitle ?? "none"} investigate, ${topDefer?.projectTitle ?? "none"} defer.`,
							},
						},
					],
				},
			},
		});

		if (weeklyReview) {
			const previous = await api.readPageMarkdown(weeklyReview.id);
			const followedRecommendations = packets
				.filter((packet) => packet.priority === "Now")
				.map(
					(packet) =>
						`Execution is currently focused on ${resolveProjectTitle(projects, packet.localProjectIds[0] ?? "")}.`,
				);
			const nextMarkdown = mergeManagedSection(
				previous.markdown,
				renderWeeklyIntelligenceSection({
					weekTitle: `Week of ${weekStart}`,
					latestRun: {
						id: created.id,
						url: created.url,
						title: runTitle,
						runDate: today,
						runType: normalizeRunType(type),
						status,
						modelVersion:
							config.phase5ExternalSignals?.scoringModelVersion ??
							phase3.scoringModelVersion,
						topResumeProjectIds: topResume ? [topResume.projectId] : [],
						topFinishProjectIds: topFinish ? [topFinish.projectId] : [],
						topInvestigateProjectIds: topInvestigate
							? [topInvestigate.projectId]
							: [],
						topDeferProjectIds: topDefer ? [topDefer.projectId] : [],
						weeklyReviewIds: [weeklyReview.id],
						supersedesIds: previousRun ? [previousRun.id] : [],
						reviewerIds: [],
						reviewedOn: "",
						summary: "",
						referencedProjectIds: recommendations
							.slice(0, 8)
							.map((recommendation) => recommendation.projectId),
					},
					recommendations: recommendations.slice(0, 5),
					acceptedSuggestions: suggestions
						.filter((suggestion) => suggestion.status === "Accepted")
						.slice(0, 5),
					rejectedSuggestions: suggestions
						.filter((suggestion) => suggestion.status === "Rejected")
						.slice(0, 5),
					followedRecommendations,
				}),
				WEEKLY_INTELLIGENCE_START,
				WEEKLY_INTELLIGENCE_END,
			);
			if (nextMarkdown !== previous.markdown.trim()) {
				assertSafeReplacement(previous.markdown, nextMarkdown);
				await api.patchPageMarkdown({
					pageId: weeklyReview.id,
					command: "replace_content",
					newMarkdown: buildReplaceCommand(nextMarkdown),
				});
			}

			await api.updatePageProperties({
				pageId: weeklyReview.id,
				properties: {
					"Recommendation Runs": relationValue([
						...new Set([
							...relationIds(weeklyReview.properties["Recommendation Runs"]),
							created.id,
						]),
					]),
				},
			});
		}
	}

	const output = {
		ok: true,
		live,
		runType: type,
		runTitle,
		runId: createdRun?.id,
		runUrl: createdRun?.url,
		status,
		topResume: topResume?.projectTitle,
		topFinish: topFinish?.projectTitle,
		topInvestigate: topInvestigate?.projectTitle,
		topDefer: topDefer?.projectTitle,
	};
	recordCommandOutputSummary(output, {
		metadata: {
			runType: type,
			status,
		},
	});
	postNotificationHubEvent({
		source: "notion-os",
		level: "info",
		title: "recommendation-run complete",
		body: `${live ? "Live" : "Dry-run"} [${type}]: status=${status}${topResume ? `, resume=${topResume.projectTitle}` : ""}${topFinish ? `, finish=${topFinish.projectTitle}` : ""}`,
	});
	console.log(JSON.stringify(output, null, 2));
}

function buildDailyFocus(input: {
	topResume?: { projectId: string; projectTitle: string };
	tasks: ReturnType<typeof toExecutionTaskRecord>[];
	packets: ReturnType<typeof toWorkPacketRecord>[];
	projects: ReturnType<typeof toIntelligenceProjectRecord>[];
}): string[] {
	const nowPacket = input.packets.find(
		(packet) => packet.priority === "Now" && packet.status === "In Progress",
	);
	if (nowPacket) {
		const packetTasks = input.tasks
			.filter(
				(task) =>
					task.workPacketIds.includes(nowPacket.id) &&
					task.status !== "Done" &&
					task.status !== "Canceled",
			)
			.slice(0, 3)
			.map((task) => `Focus on ${task.title}.`);
		if (packetTasks.length > 0) {
			return packetTasks;
		}
	}

	if (input.topResume) {
		return [
			`Resume ${input.topResume.projectTitle} as the default daily focus.`,
		];
	}

	const fallbackProject = input.projects.find(
		(project) => project.operatingQueue === "Resume Now",
	);
	return fallbackProject
		? [`Resume ${fallbackProject.title} as the fallback daily focus.`]
		: [];
}

function resolveProjectTitle(
	projects: ReturnType<typeof toIntelligenceProjectRecord>[],
	projectId: string,
): string {
	return (
		projects.find((project) => project.id === projectId)?.title ??
		"Unknown project"
	);
}

function normalizeRunType(value: "weekly" | "daily" | "adhoc"): string {
	switch (value) {
		case "weekly":
			return "Weekly Portfolio";
		case "daily":
			return "Daily Focus";
		default:
			return "Ad Hoc";
	}
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["intelligence", "recommendation-run"]);
}
