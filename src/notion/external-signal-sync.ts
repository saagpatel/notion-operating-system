import { createReadStream } from "node:fs";
import { access, constants, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { createNotionSdkClient } from "./notion-sdk.js";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
	assertSafeReplacement,
	buildReplaceCommand,
	normalizeMarkdown,
} from "../utils/markdown.js";
import { postNotificationHubEvent } from "../utils/notification-hub.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	diffDays,
	loadLocalPortfolioControlTowerConfig,
	saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	relationIds,
	relationValue,
	richTextValue,
	selectPropertyValue,
	titleValue,
	toBuildSessionRecord,
} from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import {
	toExecutionTaskRecord,
	toProjectDecisionRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
	buildEventKey,
	buildExternalSignalSummary,
	calculateExternalSignalMetrics,
	defaultSyncRunScope,
	type ExternalProviderKey,
	type ExternalSignalEventRecord,
	type ExternalSignalProviderPlan,
	type ExternalSignalSourceRecord,
	type ExternalSignalSyncRunRecord,
	getPrimarySourceProjectId,
	loadLocalPortfolioExternalSignalProviderConfig,
	providerCredentialPresent,
	renderExternalSignalBriefSection,
	renderExternalSignalCommandCenterSection,
	renderWeeklyExternalSignalsSection,
	requirePhase5ExternalSignals,
} from "./local-portfolio-external-signals.js";
import {
	ensurePhase5ExternalSignalSchema,
	toExternalSignalEventRecord,
	toExternalSignalSourceRecord,
	toExternalSignalSyncRunRecord,
} from "./local-portfolio-external-signals-live.js";
import {
	buildProjectIntelligenceContext,
	buildRecommendation,
	renderIntelligenceCommandCenterSection,
	renderRecommendationBriefSection,
} from "./local-portfolio-intelligence.js";
import {
	toIntelligenceProjectRecord,
	toLinkSuggestionRecord,
	toRecommendationRunRecord,
	toResearchLibraryRecord,
	toSkillLibraryRecord,
	toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";
import { syncManagedMarkdownSection } from "./managed-markdown-sync.js";
import {
	buildWeeklyStepContract,
	mapWeeklyStepStatusToCommandStatus,
} from "./weekly-refresh-contract.js";

const RECOMMENDATION_BRIEF_START =
	"<!-- codex:notion-recommendation-brief:start -->";
const RECOMMENDATION_BRIEF_END =
	"<!-- codex:notion-recommendation-brief:end -->";
const EXTERNAL_SIGNAL_BRIEF_START =
	"<!-- codex:notion-external-signal-brief:start -->";
const EXTERNAL_SIGNAL_BRIEF_END =
	"<!-- codex:notion-external-signal-brief:end -->";
const INTELLIGENCE_COMMAND_CENTER_START =
	"<!-- codex:notion-intelligence-command-center:start -->";
const INTELLIGENCE_COMMAND_CENTER_END =
	"<!-- codex:notion-intelligence-command-center:end -->";
const EXTERNAL_SIGNAL_COMMAND_CENTER_START =
	"<!-- codex:notion-external-signal-command-center:start -->";
const EXTERNAL_SIGNAL_COMMAND_CENTER_END =
	"<!-- codex:notion-external-signal-command-center:end -->";
const WEEKLY_EXTERNAL_SIGNALS_START =
	"<!-- codex:notion-weekly-external-signals:start -->";
const WEEKLY_EXTERNAL_SIGNALS_END =
	"<!-- codex:notion-weekly-external-signals:end -->";
const PROVIDER_SOURCE_CONCURRENCY = 6;
const PROVIDER_FETCH_TIMEOUT_MS = 15_000;

interface NormalizedSignalEvent {
	title: string;
	localProjectId: string;
	sourceId: string;
	provider: ExternalSignalEventRecord["provider"];
	signalType: ExternalSignalEventRecord["signalType"];
	occurredAt: string;
	status: string;
	environment: ExternalSignalEventRecord["environment"];
	severity: ExternalSignalEventRecord["severity"];
	sourceIdValue: string;
	sourceUrl: string;
	eventKey: string;
	summary: string;
	rawExcerpt: string;
}

interface ProviderSourceSyncResult {
	events: NormalizedSignalEvent[];
	itemsSeen: number;
	itemsDeduped: number;
	providerExercised: boolean;
	failureNote?: string;
	syncedSourceId?: string;
}

export interface ProviderSyncResult {
	provider: ExternalSignalSyncRunRecord["provider"];
	status: ExternalSignalSyncRunRecord["status"];
	itemsSeen: number;
	itemsWritten: number;
	itemsDeduped: number;
	failures: number;
	notes: string[];
	cursor: string;
	events: NormalizedSignalEvent[];
	syncedSourceIds: string[];
	providerExercised: boolean;
}

export interface ExternalSignalSyncCommandOptions {
	live?: boolean;
	provider?: "github" | "vercel" | "notification_hub" | "repo_auditor" | "all";
	today?: string;
	config?: string;
	sourceLimit?: number;
	maxEventsPerSource?: number;
}

export async function runExternalSignalSyncCommand(
	options: ExternalSignalSyncCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for external signal sync",
	);
	const live = options.live ?? false;
	const provider = options.provider ?? "all";
	const today = options.today ?? losAngelesToday();
	const weekStart = startOfWeekMonday(today);
	const configPath =
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
	let config = await loadLocalPortfolioControlTowerConfig(configPath);

	const sdk = createNotionSdkClient(token);
	const api = new DirectNotionClient(token);

	if (live) {
		logLiveStage(live, "Ensuring Phase 5 schema");
		config = await ensurePhase5ExternalSignalSchema(sdk, config);
	}

	const phase5 = requirePhase5ExternalSignals(config);
	const providerConfig = await loadLocalPortfolioExternalSignalProviderConfig();

	logLiveStage(live, "Loading external signal schemas");
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
		syncRunSchema,
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
		api.retrieveDataSource(
			config.phase3Intelligence!.recommendationRuns.dataSourceId,
		),
		api.retrieveDataSource(
			config.phase3Intelligence!.linkSuggestions.dataSourceId,
		),
		api.retrieveDataSource(phase5.sources.dataSourceId),
		api.retrieveDataSource(phase5.events.dataSourceId),
		api.retrieveDataSource(phase5.syncRuns.dataSourceId),
	]);

	logLiveStage(live, "Fetching external signal datasets");
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
		syncRunPages,
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
			config.phase3Intelligence!.recommendationRuns.dataSourceId,
			runSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.phase3Intelligence!.linkSuggestions.dataSourceId,
			suggestionSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase5.sources.dataSourceId,
			sourceSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase5.events.dataSourceId,
			eventSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase5.syncRuns.dataSourceId,
			syncRunSchema.titlePropertyName,
		),
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
	const runs = runPages.map((page) => toRecommendationRunRecord(page));
	const suggestions = suggestionPages.map((page) =>
		toLinkSuggestionRecord(page),
	);
	const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
	const existingEvents = eventPages.map((page) =>
		toExternalSignalEventRecord(page),
	);
	const existingSyncRuns = syncRunPages.map((page) =>
		toExternalSignalSyncRunRecord(page),
	);
	const scopedSources = selectScopedSources({
		provider,
		providers: providerConfig.providers,
		sources,
		sourceLimit: options.sourceLimit,
	});

	let createdEventCount = 0;
	let createdSyncRunCount = 0;
	const eventKeySet = new Set(existingEvents.map((event) => event.eventKey));
	const sourceMap = new Map(sources.map((source) => [source.id, source]));
	const providerResults = await syncProviders({
		flags: { live, provider, today: options.today },
		today,
		phase5,
		providers: providerConfig.providers,
		sources,
		eventKeySet: new Set(eventKeySet),
		projects: projects.map((p) => ({ id: p.id, title: p.title })),
		sourceLimit: options.sourceLimit,
		maxEventsPerSource: options.maxEventsPerSource,
	});

	if (live) {
		logLiveStage(live, "Syncing providers", { provider });
		logLiveStage(live, "Writing sync runs", {
			providerRunCount: providerResults.length,
		});
		for (const result of providerResults) {
			const syncRun = await createSyncRunPage({
				api,
				dataSourceId: phase5.syncRuns.dataSourceId,
				titlePropertyName: syncRunSchema.titlePropertyName,
				today,
				result,
			});
			createdSyncRunCount += 1;
			existingSyncRuns.push(syncRun);

			for (const event of result.events) {
				const created = await createSignalEventPage({
					api,
					dataSourceId: phase5.events.dataSourceId,
					titlePropertyName: eventSchema.titlePropertyName,
					event,
					syncRunId: syncRun.id,
				});
				createdEventCount += 1;
				existingEvents.push(created);
			}

			for (const sourceId of result.syncedSourceIds) {
				const source = sourceMap.get(sourceId);
				if (!source) {
					continue;
				}
				await api.updatePageProperties({
					pageId: source.id,
					properties: {
						"Last Synced At": { date: { start: today } },
					},
				});
				source.lastSyncedAt = today;
			}
		}
	}

	const summaryEvents = existingEvents;
	const summarySyncRuns = existingSyncRuns;

	const summaryMap = new Map(
		projects.map((project) => [
			project.id,
			buildExternalSignalSummary({
				project,
				sources,
				events: summaryEvents,
				today,
			}),
		]),
	);

	const recommendations = projects.map((project) => {
		const context = buildProjectIntelligenceContext({
			project,
			researchRecords: research,
			skillRecords: skills,
			toolRecords: tools,
			decisions,
			packets,
			tasks,
			buildSessions,
			today,
		});
		return buildRecommendation(context, summaryMap.get(project.id));
	});

	const latestWeeklyRun = runs
		.filter((run) => run.runType === "Weekly Portfolio")
		.sort((left, right) => right.runDate.localeCompare(left.runDate))[0];
	const latestDailyRun = runs
		.filter((run) => run.runType === "Daily Focus")
		.sort((left, right) => right.runDate.localeCompare(left.runDate))[0];
	const targetProjectIds = options.sourceLimit
		? deriveTargetProjectIdsFromSources(scopedSources)
		: new Set(projects.map((project) => project.id));
	const targetProjects = projects.filter((project) =>
		targetProjectIds.has(project.id),
	);

	const projectBriefs = await Promise.all(
		targetProjects.map(async (project) => {
			const recommendation = recommendations.find(
				(entry) => entry.projectId === project.id,
			);
			const summary = summaryMap.get(project.id);
			const previous = await api.readPageMarkdown(project.id);
			if (!recommendation || !summary) {
				return {
					projectId: project.id,
					previousMarkdown: previous.markdown,
					nextMarkdown: previous.markdown,
					changed: false,
				};
			}

			const context = buildProjectIntelligenceContext({
				project: {
					...project,
					recommendationLane: recommendation.lane,
					recommendationScore: recommendation.score,
					recommendationConfidence: recommendation.confidence,
					recommendationUpdated: today,
					externalSignalCoverage: summary.coverage,
					latestExternalActivity: summary.latestExternalActivity,
					latestDeploymentStatus: summary.latestDeploymentStatus,
					openPrCount: summary.openPrCount,
					recentFailedWorkflowRuns: summary.recentFailedWorkflowRuns,
					externalSignalUpdated: summary.externalSignalUpdated,
				},
				researchRecords: research,
				skillRecords: skills,
				toolRecords: tools,
				decisions,
				packets,
				tasks,
				buildSessions,
				today,
			});

			const withRecommendation = mergeManagedSection(
				previous.markdown,
				renderRecommendationBriefSection({ context, recommendation }),
				RECOMMENDATION_BRIEF_START,
				RECOMMENDATION_BRIEF_END,
			);
			const nextMarkdown = mergeManagedSection(
				withRecommendation,
				renderExternalSignalBriefSection({ summary }),
				EXTERNAL_SIGNAL_BRIEF_START,
				EXTERNAL_SIGNAL_BRIEF_END,
			);

			return {
				projectId: project.id,
				previousMarkdown: previous.markdown,
				nextMarkdown,
				changed:
					normalizeMarkdown(nextMarkdown) !==
					normalizeMarkdown(previous.markdown),
			};
		}),
	);
	const projectExternalSignalBriefsWouldChange = projectBriefs.filter(
		(entry) => entry.changed,
	).length;

	const previousCommandCenter = await api.readPageMarkdown(
		config.commandCenter.pageId!,
	);
	const withIntelligence = mergeManagedSection(
		previousCommandCenter.markdown,
		renderIntelligenceCommandCenterSection({
			recommendations,
			projects: projects.map((project) => ({
				...project,
				recommendationLane: recommendations.find(
					(entry) => entry.projectId === project.id,
				)?.lane,
			})),
			latestWeeklyRun,
			latestDailyRun,
			linkSuggestionQueue: suggestions,
		}),
		INTELLIGENCE_COMMAND_CENTER_START,
		INTELLIGENCE_COMMAND_CENTER_END,
	);
	const intelligenceCommandCenterSectionWouldChange =
		normalizeMarkdown(withIntelligence) !==
		normalizeMarkdown(previousCommandCenter.markdown);
	const withExternalSignals = mergeManagedSection(
		withIntelligence,
		renderExternalSignalCommandCenterSection({
			summaries: [...summaryMap.values()],
			syncRuns: summarySyncRuns,
			projects,
		}),
		EXTERNAL_SIGNAL_COMMAND_CENTER_START,
		EXTERNAL_SIGNAL_COMMAND_CENTER_END,
	);
	const externalSignalsCommandCenterSectionWouldChange =
		normalizeMarkdown(withExternalSignals) !==
		normalizeMarkdown(withIntelligence);
	const weeklyReview = weeklyPages.find(
		(page) => page.title === `Week of ${weekStart}`,
	);
	const previousWeeklyReview = weeklyReview
		? await api.readPageMarkdown(weeklyReview.id)
		: undefined;
	const nextWeeklyReview = previousWeeklyReview
		? mergeManagedSection(
				previousWeeklyReview.markdown,
				renderWeeklyExternalSignalsSection({
					summaries: [...summaryMap.values()],
					syncRuns: summarySyncRuns,
				}),
				WEEKLY_EXTERNAL_SIGNALS_START,
				WEEKLY_EXTERNAL_SIGNALS_END,
			)
		: undefined;
	const weeklyExternalSignalsSectionWouldChange =
		previousWeeklyReview && nextWeeklyReview
			? normalizeMarkdown(nextWeeklyReview) !==
				normalizeMarkdown(previousWeeklyReview.markdown)
			: false;

	let changedProjectPages = 0;
	if (live) {
		logLiveStage(live, "Refreshing project signal briefs", {
			projectCount: targetProjects.length,
		});
		for (const [index, project] of targetProjects.entries()) {
			logLoopProgress(
				live,
				"external-signal-sync",
				"Project brief",
				index + 1,
				targetProjects.length,
			);
			const recommendation = recommendations.find(
				(entry) => entry.projectId === project.id,
			);
			const summary = summaryMap.get(project.id);
			if (!recommendation || !summary) {
				continue;
			}

			const propertyUpdates = buildExternalSignalProjectPropertyUpdates({
				project,
				recommendation,
				summary,
				today,
			});
			if (Object.keys(propertyUpdates).length > 0) {
				await api.updatePageProperties({
					pageId: project.id,
					properties: propertyUpdates,
				});
			}
			const projectBrief = projectBriefs[index];
			if (projectBrief?.changed) {
				await syncExternalSignalProjectBrief({
					api,
					pageId: project.id,
					previousMarkdown: projectBrief.previousMarkdown,
					nextMarkdown: projectBrief.nextMarkdown,
				});
				changedProjectPages += 1;
			}
		}

		logLiveStage(live, "Refreshing command center and weekly review");
		if (
			intelligenceCommandCenterSectionWouldChange ||
			externalSignalsCommandCenterSectionWouldChange
		) {
			assertSafeReplacement(
				previousCommandCenter.markdown,
				withExternalSignals,
			);
			await api.patchPageMarkdown({
				pageId: config.commandCenter.pageId!,
				command: "replace_content",
				newMarkdown: buildReplaceCommand(withExternalSignals),
			});
		}

		if (
			weeklyReview &&
			previousWeeklyReview &&
			nextWeeklyReview &&
			weeklyExternalSignalsSectionWouldChange
		) {
			assertSafeReplacement(previousWeeklyReview.markdown, nextWeeklyReview);
			await api.patchPageMarkdown({
				pageId: weeklyReview.id,
				command: "replace_content",
				newMarkdown: buildReplaceCommand(nextWeeklyReview),
			});
		}

		const externalMetrics = calculateExternalSignalMetrics({
			summaries: [...summaryMap.values()],
		});
		logLiveStage(live, "Persisting external signal metrics");
		const nextConfig = {
			...config,
			phaseState: {
				...config.phaseState,
			},
			phase3Intelligence: config.phase3Intelligence
				? {
						...config.phase3Intelligence,
						scoringModelVersion: phase5.scoringModelVersion,
					}
				: undefined,
			phase5ExternalSignals: {
				...phase5,
				baselineCapturedAt: phase5.baselineCapturedAt ?? today,
				baselineMetrics:
					phase5.baselineMetrics ?? serializeMetrics(externalMetrics),
				lastSyncAt: today,
				lastSyncMetrics: serializeMetrics(externalMetrics),
			},
		};
		await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);
		config = nextConfig;
	}

	const output = {
		ok: true,
		live,
		status: "clean" as string,
		wouldChange: false,
		summaryCounts: {},
		warnings: [] as string[],
		provider,
		createdEventCount,
		createdSyncRunCount,
		changedProjectPages,
		projectExternalSignalBriefsWouldChange,
		intelligenceCommandCenterSectionWouldChange,
		externalSignalsCommandCenterSectionWouldChange,
		weeklyExternalSignalsSectionWouldChange:
			weeklyExternalSignalsSectionWouldChange ? 1 : 0,
		metrics: calculateExternalSignalMetrics({
			summaries: [...summaryMap.values()],
		}),
	};
	const providerWarnings = providerResults.flatMap((result) => result.notes);
	const providerFailed = providerResults.some(
		(result) => result.status === "Failed",
	);
	const providerPartial = providerResults.some(
		(result) => result.status === "Partial",
	);
	const contract = buildWeeklyStepContract({
		live,
		status: providerFailed ? "failed" : providerPartial ? "partial" : undefined,
		wouldChange:
			createdEventCount > 0 ||
			createdSyncRunCount > 0 ||
			projectExternalSignalBriefsWouldChange > 0 ||
			intelligenceCommandCenterSectionWouldChange ||
			externalSignalsCommandCenterSectionWouldChange ||
			weeklyExternalSignalsSectionWouldChange,
		summaryCounts: {
			createdEventCount,
			createdSyncRunCount,
			targetProjectCount: targetProjects.length,
			syncedSourceCount: providerResults.reduce(
				(sum, result) => sum + result.syncedSourceIds.length,
				0,
			),
			projectExternalSignalBriefsWouldChange,
			intelligenceCommandCenterSectionWouldChange:
				intelligenceCommandCenterSectionWouldChange ? 1 : 0,
			externalSignalsCommandCenterSectionWouldChange:
				externalSignalsCommandCenterSectionWouldChange ? 1 : 0,
			weeklyExternalSignalsSectionWouldChange:
				weeklyExternalSignalsSectionWouldChange ? 1 : 0,
			mappedProjects: output.metrics.mappedProjects,
			projectsNeedingMapping: output.metrics.projectsNeedingMapping,
		},
		warnings: providerWarnings,
	});
	output.status = contract.status;
	output.wouldChange = contract.wouldChange;
	output.summaryCounts = contract.summaryCounts;
	output.warnings = contract.warnings;
	recordCommandOutputSummary(output, {
		status: mapWeeklyStepStatusToCommandStatus(contract.status),
		warningCategories:
			deriveExternalSignalSyncWarningCategories(providerResults),
		failureCategories:
			deriveExternalSignalSyncFailureCategories(providerResults),
		metadata: {
			provider,
			providerRunCount: providerResults.length,
		},
	});
	postNotificationHubEvent({
		source: "notion-os",
		level: contract.status === "failed" ? "warn" : "info",
		title: "external-signal-sync complete",
		body: `${live ? "Live" : "Dry-run"} [${provider}]: ${contract.summaryCounts.createdEventCount ?? 0} events, ${contract.summaryCounts.syncedSourceCount ?? 0} sources synced, ${contract.summaryCounts.targetProjectCount ?? 0} projects`,
	});
	console.log(JSON.stringify(output, null, 2));
}

function logLiveStage(
	live: boolean,
	stage: string,
	details?: Record<string, unknown>,
): void {
	if (!live) {
		return;
	}

	const suffix = details ? ` ${JSON.stringify(details)}` : "";
	console.error(`[external-signal-sync] ${stage}${suffix}`);
}

function logLoopProgress(
	live: boolean,
	scope: string,
	label: string,
	index: number,
	total: number,
): void {
	if (!live) {
		return;
	}
	if (index === 1 || index === total || index % 10 === 0) {
		console.error(`[${scope}] ${label} ${index}/${total}`);
	}
}

function buildExternalSignalProjectPropertyUpdates(input: {
	project: ReturnType<typeof toIntelligenceProjectRecord>;
	recommendation: ReturnType<typeof buildRecommendation>;
	summary: ReturnType<typeof buildExternalSignalSummary>;
	today: string;
}): Record<string, unknown> {
	const updates: Record<string, unknown> = {};

	if (input.project.recommendationLane !== input.recommendation.lane) {
		updates["Recommendation Lane"] = {
			select: { name: input.recommendation.lane },
		};
	}
	if ((input.project.recommendationScore ?? 0) !== input.recommendation.score) {
		updates["Recommendation Score"] = { number: input.recommendation.score };
	}
	if (
		input.project.recommendationConfidence !== input.recommendation.confidence
	) {
		updates["Recommendation Confidence"] = {
			select: { name: input.recommendation.confidence },
		};
	}
	if (input.project.recommendationUpdated !== input.today) {
		updates["Recommendation Updated"] = { date: { start: input.today } };
	}
	if (input.project.externalSignalCoverage !== input.summary.coverage) {
		updates["External Signal Coverage"] = {
			select: { name: input.summary.coverage },
		};
	}
	if (
		(input.project.latestExternalActivity ?? "") !==
		(input.summary.latestExternalActivity ?? "")
	) {
		updates["Latest External Activity"] = input.summary.latestExternalActivity
			? { date: { start: input.summary.latestExternalActivity } }
			: { date: null };
	}
	if (
		input.project.latestDeploymentStatus !==
		input.summary.latestDeploymentStatus
	) {
		updates["Latest Deployment Status"] = {
			select: { name: input.summary.latestDeploymentStatus },
		};
	}
	if ((input.project.openPrCount ?? 0) !== input.summary.openPrCount) {
		updates["Open PR Count"] = { number: input.summary.openPrCount };
	}
	if (
		(input.project.recentFailedWorkflowRuns ?? 0) !==
		input.summary.recentFailedWorkflowRuns
	) {
		updates["Recent Failed Workflow Runs"] = {
			number: input.summary.recentFailedWorkflowRuns,
		};
	}
	if (
		(input.project.externalSignalUpdated ?? "") !==
		(input.summary.externalSignalUpdated ?? "")
	) {
		updates["External Signal Updated"] = input.summary.externalSignalUpdated
			? { date: { start: input.summary.externalSignalUpdated } }
			: { date: null };
	}

	return updates;
}

async function syncExternalSignalProjectBrief(input: {
	api: DirectNotionClient;
	pageId: string;
	previousMarkdown: string;
	nextMarkdown: string;
}): Promise<void> {
	let currentMarkdown = input.previousMarkdown;

	currentMarkdown = await syncProjectBriefSection({
		...input,
		currentMarkdown,
		startMarker: RECOMMENDATION_BRIEF_START,
		endMarker: RECOMMENDATION_BRIEF_END,
	});
	currentMarkdown = await syncProjectBriefSection({
		...input,
		currentMarkdown,
		startMarker: EXTERNAL_SIGNAL_BRIEF_START,
		endMarker: EXTERNAL_SIGNAL_BRIEF_END,
	});

	if (
		normalizeMarkdown(currentMarkdown) !== normalizeMarkdown(input.nextMarkdown)
	) {
		assertSafeReplacement(currentMarkdown, input.nextMarkdown);
		await input.api.patchPageMarkdown({
			pageId: input.pageId,
			command: "replace_content",
			newMarkdown: buildReplaceCommand(input.nextMarkdown),
			recordClientErrorAsFailure: false,
		});
		currentMarkdown = (await input.api.readPageMarkdown(input.pageId)).markdown;
	}

	if (
		normalizeMarkdown(currentMarkdown) !== normalizeMarkdown(input.nextMarkdown)
	) {
		console.warn(
			"External signal project brief did not converge after write",
			JSON.stringify({ pageId: input.pageId }),
		);
	}
}

async function syncProjectBriefSection(input: {
	api: DirectNotionClient;
	pageId: string;
	currentMarkdown: string;
	nextMarkdown: string;
	startMarker: string;
	endMarker: string;
}): Promise<string> {
	await syncManagedMarkdownSection({
		api: input.api,
		pageId: input.pageId,
		previousMarkdown: input.currentMarkdown,
		nextMarkdown: input.nextMarkdown,
		startMarker: input.startMarker,
		endMarker: input.endMarker,
	});
	return (await input.api.readPageMarkdown(input.pageId)).markdown;
}

function normalizedSignalEventToRecord(
	event: NormalizedSignalEvent,
	resultIndex: number,
	eventIndex: number,
): ExternalSignalEventRecord {
	return {
		id: `preview-event-${resultIndex}-${eventIndex}`,
		url:
			event.sourceUrl ||
			`https://preview.local/events/${resultIndex}-${eventIndex}`,
		title: event.title,
		localProjectIds: [event.localProjectId],
		sourceIds: [event.sourceId],
		provider: event.provider,
		signalType: event.signalType,
		occurredAt: event.occurredAt,
		status: event.status,
		environment: event.environment,
		severity: event.severity,
		sourceIdValue: event.sourceIdValue,
		sourceUrl: event.sourceUrl,
		syncRunIds: [],
		eventKey: event.eventKey,
		summary: event.summary,
		rawExcerpt: event.rawExcerpt,
	};
}

function previewSyncRunRecord(
	result: ProviderSyncResult,
	today: string,
	index: number,
): ExternalSignalSyncRunRecord {
	return {
		id: `preview-sync-run-${index}`,
		url: `https://preview.local/sync-runs/${index}`,
		title: `${result.provider} sync preview`,
		provider: result.provider,
		status: result.status,
		startedAt: today,
		completedAt: today,
		scope: defaultSyncRunScope(result.provider, 0),
		itemsSeen: result.itemsSeen,
		itemsWritten: result.itemsWritten,
		itemsDeduped: result.itemsDeduped,
		failures: result.failures,
		cursor: result.cursor,
		notes: result.notes.join(" | "),
	};
}

export function deriveExternalSignalSyncStatus(
	providerResults: ProviderSyncResult[],
): "completed" | "warning" | "partial" | undefined {
	if (providerResults.some((result) => result.status === "Partial")) {
		return "partial";
	}
	if (
		providerResults.some((result) =>
			result.notes.some(
				(note) =>
					note.includes("Missing ") ||
					note.includes("intentionally deferred") ||
					note.includes("Provider not exercised"),
			),
		)
	) {
		return "warning";
	}
	return undefined;
}

export function deriveExternalSignalSyncWarningCategories(
	providerResults: ProviderSyncResult[],
):
	| Array<
			| "partial_success"
			| "missing_credentials"
			| "unsupported_provider"
			| "validation_gap"
	  >
	| undefined {
	const categories = new Set<
		| "partial_success"
		| "missing_credentials"
		| "unsupported_provider"
		| "validation_gap"
	>();
	for (const result of providerResults) {
		if (result.status === "Partial") {
			categories.add("partial_success");
		}
		for (const note of result.notes) {
			if (note.includes("Missing ")) {
				categories.add("missing_credentials");
			}
			if (note.includes("intentionally deferred")) {
				categories.add("unsupported_provider");
			}
			if (note.includes("Provider not exercised")) {
				categories.add("validation_gap");
			}
		}
	}
	return categories.size > 0 ? [...categories] : undefined;
}

export function deriveExternalSignalSyncFailureCategories(
	providerResults: ProviderSyncResult[],
): Array<"validation_error" | "provider_error"> | undefined {
	const categories = new Set<"validation_error" | "provider_error">();
	for (const result of providerResults) {
		if (result.status !== "Failed") {
			continue;
		}
		const notes = result.notes.join(" ");
		if (notes.includes("Missing ")) {
			continue;
		}
		if (
			/missing a linked Local Project|missing linked Local Project/i.test(notes)
		) {
			categories.add("validation_error");
			continue;
		}
		categories.add("provider_error");
	}
	return categories.size > 0 ? [...categories] : undefined;
}

export async function syncProviders(input: {
	flags: {
		provider: "github" | "vercel" | "notification_hub" | "repo_auditor" | "all";
		live: boolean;
		today?: string;
	};
	today: string;
	phase5: NonNullable<
		Awaited<
			ReturnType<typeof loadLocalPortfolioControlTowerConfig>
		>["phase5ExternalSignals"]
	>;
	providers: ExternalSignalProviderPlan[];
	sources: ExternalSignalSourceRecord[];
	eventKeySet: Set<string>;
	projects?: Array<{ id: string; title: string }>;
	sourceLimit?: number;
	maxEventsPerSource?: number;
}): Promise<ProviderSyncResult[]> {
	const selectedProviders =
		input.flags.provider === "all"
			? input.providers.filter((provider) => provider.enabled)
			: input.providers.filter(
					(provider) => provider.key === input.flags.provider,
				);

	const results: ProviderSyncResult[] = [];
	for (const provider of selectedProviders) {
		const sources = limitProviderSources(
			input.sources.filter(
				(source) =>
					source.status === "Active" &&
					Boolean(source.identifier.trim()) &&
					normalizeProviderName(source.provider) === provider.key,
			),
			input.sourceLimit,
		);
		logLiveStage(input.flags.live, "Provider source set prepared", {
			provider: provider.key,
			sourceCount: sources.length,
		});
		if (provider.key === "github") {
			results.push(
				await syncGithubSources(
					provider,
					sources,
					input.maxEventsPerSource ??
						input.phase5.syncLimits.maxEventsPerSource,
					input.today,
					input.eventKeySet,
					input.flags.live,
				),
			);
			continue;
		}
		if (provider.key === "vercel") {
			results.push(
				await syncVercelSources(
					provider,
					sources,
					input.maxEventsPerSource ??
						input.phase5.syncLimits.maxEventsPerSource,
					input.today,
					input.eventKeySet,
					input.flags.live,
				),
			);
			continue;
		}
		if (provider.key === "notification_hub") {
			results.push(
				await syncNotificationHubSources(
					provider,
					sources,
					input.maxEventsPerSource ??
						input.phase5.syncLimits.maxEventsPerSource,
					input.today,
					input.eventKeySet,
					input.projects ?? [],
					input.flags.live,
					input.sources,
				),
			);
			continue;
		}
		if (provider.key === "repo_auditor") {
			results.push(
				await syncRepoAuditorSources(
					provider,
					sources,
					input.maxEventsPerSource ??
						input.phase5.syncLimits.maxEventsPerSource,
					input.today,
					input.eventKeySet,
					input.projects ?? [],
					input.flags.live,
					input.sources,
				),
			);
			continue;
		}
		results.push({
			provider: provider.displayName as ProviderSyncResult["provider"],
			status: "Partial",
			itemsSeen: 0,
			itemsWritten: 0,
			itemsDeduped: 0,
			failures: 0,
			notes: [
				"Provider scaffold exists, but live sync is intentionally deferred in the first Phase 5 slice.",
			],
			cursor: "",
			events: [],
			syncedSourceIds: [],
			providerExercised: false,
		});
	}

	return results;
}

export async function syncGithubSources(
	provider: ExternalSignalProviderPlan,
	sources: ExternalSignalSourceRecord[],
	maxEventsPerSource: number,
	today: string,
	eventKeySet: Set<string>,
	live = false,
): Promise<ProviderSyncResult> {
	if (sources.length === 0) {
		return emptyProviderResult(
			provider.displayName as ProviderSyncResult["provider"],
			"Provider not exercised: no active GitHub sources are ready for sync.",
		);
	}
	if (!providerCredentialPresent(provider)) {
		return {
			...emptyProviderResult(
				provider.displayName as ProviderSyncResult["provider"],
				`Missing ${provider.authEnvVar} for GitHub sync.`,
			),
			status: "Failed",
			failures: sources.length,
		};
	}

	const token = process.env[provider.authEnvVar]!.trim();
	const events: NormalizedSignalEvent[] = [];
	const notes: string[] = [];
	let itemsSeen = 0;
	let itemsDeduped = 0;
	let failures = 0;
	let providerExercised = false;
	const syncedSourceIds: string[] = [];
	const results = await mapWithConcurrency(
		sources,
		PROVIDER_SOURCE_CONCURRENCY,
		async (source) =>
			syncGithubSource(
				source,
				provider,
				live,
				token,
				maxEventsPerSource,
				eventKeySet,
				today,
			),
	);

	for (const result of results) {
		itemsSeen += result.itemsSeen;
		itemsDeduped += result.itemsDeduped;
		providerExercised ||= result.providerExercised;
		events.push(...result.events);
		if (result.syncedSourceId) {
			syncedSourceIds.push(result.syncedSourceId);
		}
		if (result.failureNote) {
			failures += 1;
			notes.push(result.failureNote);
		}
	}

	return {
		provider: "GitHub",
		status:
			failures > 0 && events.length > 0
				? "Partial"
				: failures > 0
					? "Failed"
					: "Succeeded",
		itemsSeen,
		itemsWritten: events.length,
		itemsDeduped,
		failures,
		notes,
		cursor: newestOccurredAt(events) || today,
		events,
		syncedSourceIds,
		providerExercised,
	};
}

export async function syncVercelSources(
	provider: ExternalSignalProviderPlan,
	sources: ExternalSignalSourceRecord[],
	maxEventsPerSource: number,
	today: string,
	eventKeySet: Set<string>,
	live = false,
): Promise<ProviderSyncResult> {
	if (sources.length === 0) {
		return emptyProviderResult(
			provider.displayName as ProviderSyncResult["provider"],
			"Provider not exercised: no active Vercel sources are ready for sync.",
		);
	}
	if (!providerCredentialPresent(provider)) {
		return {
			...emptyProviderResult(
				provider.displayName as ProviderSyncResult["provider"],
				`Missing ${provider.authEnvVar} for Vercel sync.`,
			),
			status: "Failed",
			failures: sources.length,
		};
	}

	const token = process.env[provider.authEnvVar]!.trim();
	const events: NormalizedSignalEvent[] = [];
	const notes: string[] = [];
	let itemsSeen = 0;
	let itemsDeduped = 0;
	let failures = 0;
	let providerExercised = false;
	const syncedSourceIds: string[] = [];
	const results = await mapWithConcurrency(
		sources,
		PROVIDER_SOURCE_CONCURRENCY,
		async (source) =>
			syncVercelSource(
				source,
				provider,
				live,
				token,
				maxEventsPerSource,
				eventKeySet,
			),
	);

	for (const result of results) {
		itemsSeen += result.itemsSeen;
		itemsDeduped += result.itemsDeduped;
		providerExercised ||= result.providerExercised;
		events.push(...result.events);
		if (result.syncedSourceId) {
			syncedSourceIds.push(result.syncedSourceId);
		}
		if (result.failureNote) {
			failures += 1;
			notes.push(result.failureNote);
		}
	}

	return {
		provider: "Vercel",
		status:
			failures > 0 && events.length > 0
				? "Partial"
				: failures > 0
					? "Failed"
					: "Succeeded",
		itemsSeen,
		itemsWritten: events.length,
		itemsDeduped,
		failures,
		notes,
		cursor: newestOccurredAt(events) || today,
		events,
		syncedSourceIds,
		providerExercised,
	};
}

/** Shape of a single line from the notification-hub events.jsonl log. */
interface NotificationHubEvent {
	source: string;
	level: string;
	title: string;
	body: string;
	project: string | null;
	timestamp: string;
	event_id: string;
	received_at: string;
	classified_level?: string;
}

type ProjectResolver = (value: string) => string | undefined;

const NOTIFICATION_HUB_DEFAULT_LOG_PATH = `${homedir()}/.local/share/notification-hub/events.jsonl`;
const MAX_UNMATCHED_SAMPLE_NAMES = 5;
const IGNORED_NOTIFICATION_PROJECT_KEYS = new Set([
	"bridge sync",
	"bridge scaffolding",
	"bridge baseline seed",
]);
const PROJECT_RESOLVER_ALIASES = new Map([
	["notion", "notion operating system"],
]);

export async function syncNotificationHubSources(
	provider: ExternalSignalProviderPlan,
	sources: ExternalSignalSourceRecord[],
	maxEventsPerSource: number,
	today: string,
	eventKeySet: Set<string>,
	projects: Array<{ id: string; title: string }>,
	live = false,
	allSources: ExternalSignalSourceRecord[] = [],
): Promise<ProviderSyncResult> {
	if (sources.length === 0) {
		return emptyProviderResult(
			"Notification Hub",
			"Provider not exercised: no active Notification Hub source row found. Create a source row in Notion with Provider = 'Notification Hub'.",
		);
	}

	const logPath =
		process.env[provider.authEnvVar]?.trim() ||
		NOTIFICATION_HUB_DEFAULT_LOG_PATH;

	// Verify the log file is readable before attempting to stream it
	try {
		await access(logPath, constants.R_OK);
	} catch {
		return {
			...emptyProviderResult(
				"Notification Hub",
				`Notification Hub log not found at ${logPath}. Set NOTIFICATION_HUB_LOG_PATH or start the notification-hub server.`,
			),
			status: "Failed",
			failures: 1,
		};
	}

	const resolveProjectId = buildProjectResolver({
		projects,
		sources: allSources,
	});
	const source = sources[0]!;
	const events: NormalizedSignalEvent[] = [];
	let itemsSeen = 0;
	let itemsDeduped = 0;
	let missingProject = 0;
	let unmatchedProject = 0;
	let ignoredOperationalProject = 0;
	const unmatchedProjectNames = new Set<string>();
	const ignoredProjectNames = new Set<string>();

	try {
		const capped = await readNotificationHubJsonl(logPath, maxEventsPerSource);

		for (const raw of capped) {
			itemsSeen += 1;
			const eventKey = buildEventKey(["notification_hub", raw.event_id]);
			if (eventKeySet.has(eventKey)) {
				itemsDeduped += 1;
				continue;
			}

			if (!raw.project?.trim()) {
				missingProject += 1;
				continue;
			}

			const candidateProject = normalizeNotificationProjectValue(raw.project);
			if (isIgnoredNotificationProject(candidateProject)) {
				ignoredOperationalProject += 1;
				ignoredProjectNames.add(raw.project);
				continue;
			}

			const localProjectId =
				resolveProjectId(raw.project) || resolveProjectId(candidateProject);
			if (!localProjectId) {
				unmatchedProject += 1;
				unmatchedProjectNames.add(raw.project);
				continue;
			}

			eventKeySet.add(eventKey);
			events.push({
				title: raw.title.slice(0, 200),
				localProjectId,
				sourceId: source.id,
				provider: "Notification Hub",
				signalType: "Notification",
				occurredAt: formatExternalDate(raw.received_at || raw.timestamp),
				status: raw.classified_level || raw.level,
				environment: "N/A",
				severity: classifyNotificationSeverity(raw.classified_level),
				sourceIdValue: raw.event_id,
				sourceUrl: "",
				eventKey,
				summary: raw.body.slice(0, 2000),
				rawExcerpt: `source=${raw.source}, level=${raw.level}, classified=${raw.classified_level}`,
			});

			if (events.length >= maxEventsPerSource) {
				break;
			}
		}
	} catch (error) {
		return {
			...emptyProviderResult(
				"Notification Hub",
				`Notification Hub sync failed: ${toErrorMessage(error)}`,
			),
			status: "Failed",
			failures: 1,
		};
	}

	logLiveStage(live, "Notification Hub sync complete", {
		itemsSeen,
		newEvents: events.length,
		itemsDeduped,
		missingProject,
		unmatchedProject,
		ignoredOperationalProject,
	});

	const notes: string[] = [];
	if (missingProject > 0) {
		notes.push(
			`${missingProject} event(s) skipped: notification-hub event had no project value.`,
		);
	}
	if (unmatchedProject > 0) {
		notes.push(
			`${unmatchedProject} event(s) skipped: project name could not be matched to a local portfolio project${formatSampleNames(unmatchedProjectNames)}.`,
		);
	}
	if (ignoredOperationalProject > 0) {
		notes.push(
			`${ignoredOperationalProject} event(s) ignored: notification-hub project value is an operational tag, not a Local Portfolio Project${formatSampleNames(ignoredProjectNames)}.`,
		);
	}

	return {
		provider: "Notification Hub",
		status: "Succeeded",
		itemsSeen,
		itemsWritten: events.length,
		itemsDeduped,
		failures: 0,
		notes,
		cursor:
			events.length > 0
				? (events[events.length - 1]?.sourceIdValue ?? today)
				: today,
		events,
		syncedSourceIds: [source.id],
		providerExercised: true,
	};
}

function normalizeNotificationProjectValue(project: string): string {
	return project
		.trim()
		.replace(/^(?:\[[^\]]+\]\s*)+/, "")
		.trim();
}

function isIgnoredNotificationProject(project: string): boolean {
	return IGNORED_NOTIFICATION_PROJECT_KEYS.has(normalizeResolverKey(project));
}

function buildProjectResolver(input: {
	projects: Array<{ id: string; title: string }>;
	sources: ExternalSignalSourceRecord[];
}): ProjectResolver {
	const exactTitleIndex = new Map<string, string>();
	const variantTitleIndex = new Map<string, string>();
	const githubIdentifierIndex = new Map<string, string>();

	for (const project of input.projects) {
		const normalized = normalizeResolverKey(project.title);
		exactTitleIndex.set(normalized, project.id);
		variantTitleIndex.set(normalized.replace(/\s+/g, "-"), project.id);
		variantTitleIndex.set(normalized.replace(/-/g, " "), project.id);
	}

	for (const source of input.sources) {
		if (normalizeProviderName(source.provider) !== "github") {
			continue;
		}
		const localProjectId = getPrimarySourceProjectId(source);
		if (!localProjectId) {
			continue;
		}
		const identifier = normalizeResolverKey(source.identifier);
		if (!identifier) {
			continue;
		}
		if (!githubIdentifierIndex.has(identifier)) {
			githubIdentifierIndex.set(identifier, localProjectId);
		}
		const repoName = identifier.split("/").pop() ?? "";
		if (repoName && !githubIdentifierIndex.has(repoName)) {
			githubIdentifierIndex.set(repoName, localProjectId);
		}
	}

	return (value: string): string | undefined => {
		const normalized = normalizeResolverKey(value);
		if (!normalized) {
			return undefined;
		}
		const aliasTarget = PROJECT_RESOLVER_ALIASES.get(normalized);
		return (
			exactTitleIndex.get(normalized) ||
			githubIdentifierIndex.get(normalized) ||
			variantTitleIndex.get(normalized) ||
			(aliasTarget
				? exactTitleIndex.get(aliasTarget) ||
					githubIdentifierIndex.get(aliasTarget) ||
					variantTitleIndex.get(aliasTarget)
				: undefined)
		);
	};
}

function normalizeResolverKey(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[_-]+/g, " ")
		.replace(/[^\p{L}\p{N}/ ]+/gu, " ")
		.replace(/\s+/g, " ");
}

async function readNotificationHubJsonl(
	logPath: string,
	windowSize: number,
): Promise<NotificationHubEvent[]> {
	let window: NotificationHubEvent[] = [];
	const stream = createReadStream(logPath, { encoding: "utf8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (isNotificationHubEvent(parsed)) {
				window.push(parsed);
				if (window.length > windowSize) {
					window = window.slice(-windowSize);
				}
			}
		} catch {
			// Skip malformed lines silently
		}
	}

	return window;
}

function isNotificationHubEvent(value: unknown): value is NotificationHubEvent {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const obj = value as Record<string, unknown>;
	return (
		typeof obj["event_id"] === "string" &&
		typeof obj["title"] === "string" &&
		typeof obj["body"] === "string" &&
		typeof obj["source"] === "string" &&
		typeof obj["received_at"] === "string"
	);
}

function classifyNotificationSeverity(
	classifiedLevel: string | undefined,
): ExternalSignalEventRecord["severity"] {
	if (!classifiedLevel) {
		return "Info";
	}
	switch (classifiedLevel.toLowerCase()) {
		case "urgent":
			return "Risk";
		case "normal":
			return "Watch";
		default:
			return "Info";
	}
}

const REPO_AUDITOR_DEFAULT_OUTPUT_DIR = `${homedir()}/Projects/GithubRepoAuditor/output`;

interface RepoAuditEntry {
	metadata: { name: string; full_name: string };
	grade: string;
	overall_score: number;
	completeness_tier?: string;
	interest_tier?: string;
	flags?: string[];
}

interface RepoAuditReport {
	generated_at: string;
	audits?: RepoAuditEntry[];
	results?: RepoAuditEntry[];
}

export async function syncRepoAuditorSources(
	provider: ExternalSignalProviderPlan,
	sources: ExternalSignalSourceRecord[],
	maxEventsPerSource: number,
	today: string,
	eventKeySet: Set<string>,
	projects: Array<{ id: string; title: string }>,
	live = false,
	allSources: ExternalSignalSourceRecord[] = [],
): Promise<ProviderSyncResult> {
	if (sources.length === 0) {
		return emptyProviderResult(
			"Repo Auditor",
			"Provider not exercised: no active Repo Auditor source row found. Create a source row in Notion with Provider = 'Repo Auditor'.",
		);
	}

	const outputDir =
		process.env[provider.authEnvVar]?.trim() || REPO_AUDITOR_DEFAULT_OUTPUT_DIR;

	// Locate the most recent audit-report-*.json file
	let reportPath: string;
	try {
		const files = await readdir(outputDir);
		const reportFiles = files
			.filter((f) => f.startsWith("audit-report-") && f.endsWith(".json"))
			.sort()
			.reverse();
		if (reportFiles.length === 0) {
			return {
				...emptyProviderResult(
					"Repo Auditor",
					`No audit-report-*.json files found in ${outputDir}. Run GithubRepoAuditor to generate a report.`,
				),
				status: "Failed",
				failures: 1,
			};
		}
		reportPath = join(outputDir, reportFiles[0]!);
	} catch (error) {
		return {
			...emptyProviderResult(
				"Repo Auditor",
				`Repo Auditor output directory not accessible at ${outputDir}: ${toErrorMessage(error)}`,
			),
			status: "Failed",
			failures: 1,
		};
	}

	let report: RepoAuditReport;
	try {
		const raw = await readFile(reportPath, "utf8");
		report = JSON.parse(raw) as RepoAuditReport;
	} catch (error) {
		return {
			...emptyProviderResult(
				"Repo Auditor",
				`Failed to parse audit report at ${reportPath}: ${toErrorMessage(error)}`,
			),
			status: "Failed",
			failures: 1,
		};
	}

	const reportDate = report.generated_at
		? report.generated_at.slice(0, 10)
		: today;
	const audits = report.audits ?? report.results ?? [];
	const resolveProjectId = buildProjectResolver({
		projects,
		sources: allSources,
	});
	const source = sources[0]!;
	const events: NormalizedSignalEvent[] = [];
	let itemsSeen = 0;
	let itemsDeduped = 0;
	let unmatchedProject = 0;
	let malformed = 0;
	const unmatchedProjectNames = new Set<string>();

	for (const audit of audits) {
		if (events.length >= maxEventsPerSource) {
			break;
		}
		itemsSeen += 1;
		const fullName = audit.metadata?.full_name ?? audit.metadata?.name ?? "";
		if (!fullName) {
			malformed += 1;
			continue;
		}
		const eventKey = buildEventKey(["repo_auditor", fullName, reportDate]);
		if (eventKeySet.has(eventKey)) {
			itemsDeduped += 1;
			continue;
		}

		const repoName = audit.metadata?.name ?? fullName;
		const localProjectId = resolveProjectId(fullName) ?? resolveProjectId(repoName);
		if (!localProjectId) {
			unmatchedProject += 1;
			unmatchedProjectNames.add(fullName);
			continue;
		}

		eventKeySet.add(eventKey);
		const grade = (audit.grade ?? "?").toUpperCase();
		const scorePercent = Math.round((audit.overall_score ?? 0) * 100);
		const flags = audit.flags ?? [];
		const summaryParts = [
			`Grade: ${grade} (${scorePercent}%)`,
			audit.completeness_tier ? `Completeness: ${audit.completeness_tier}` : "",
			audit.interest_tier ? `Interest: ${audit.interest_tier}` : "",
			flags.length > 0 ? `Flags: ${flags.join(", ")}` : "",
		].filter(Boolean);

		events.push({
			title: `[${grade}] ${repoName} — ${scorePercent}%`,
			localProjectId,
			sourceId: source.id,
			provider: "Repo Auditor",
			signalType: "Audit",
			occurredAt: reportDate,
			status: grade,
			environment: "N/A",
			severity: classifyRepoAuditGrade(grade),
			sourceIdValue: `${fullName}::${reportDate}`,
			sourceUrl: `https://github.com/${fullName}`,
			eventKey,
			summary: summaryParts.join(" | "),
			rawExcerpt: `report=${reportPath}`,
		});
	}

	logLiveStage(live, "Repo Auditor sync complete", {
		itemsSeen,
		newEvents: events.length,
		itemsDeduped,
		unmatchedProject,
		reportDate,
	});

	const notes: string[] = [
		`Report date: ${reportDate}, audits in file: ${itemsSeen}`,
	];
	if (malformed > 0) {
		notes.push(
			`Skipped ${malformed} audits with missing full_name/name metadata.`,
		);
	}
	if (unmatchedProject > 0) {
		notes.push(
			`${unmatchedProject} audit(s) skipped: repo name could not be matched to a local portfolio project${formatSampleNames(unmatchedProjectNames)}.`,
		);
	}

	return {
		provider: "Repo Auditor",
		status: "Succeeded",
		itemsSeen,
		itemsWritten: events.length,
		itemsDeduped,
		failures: 0,
		notes,
		cursor: reportDate,
		events,
		syncedSourceIds: [source.id],
		providerExercised: true,
	};
}

function formatSampleNames(names: Set<string>): string {
	const sample = [...names].slice(0, MAX_UNMATCHED_SAMPLE_NAMES);
	if (sample.length === 0) {
		return "";
	}
	const suffix = names.size > sample.length ? ", ..." : "";
	return ` (sample: ${sample.join(", ")}${suffix})`;
}

function classifyRepoAuditGrade(
	grade: string,
): ExternalSignalEventRecord["severity"] {
	switch (grade.toUpperCase()) {
		case "A":
		case "B":
			return "Info";
		case "C":
			return "Watch";
		default:
			return "Risk";
	}
}

async function syncGithubSource(
	source: ExternalSignalSourceRecord,
	provider: ExternalSignalProviderPlan,
	live: boolean,
	token: string,
	maxEventsPerSource: number,
	eventKeySet: Set<string>,
	today: string,
): Promise<ProviderSourceSyncResult> {
	try {
		logLiveStage(live, "Syncing GitHub source", {
			sourceTitle: source.title,
			identifier: source.identifier,
		});
		const localProjectId = getPrimarySourceProjectId(source);
		if (!localProjectId) {
			return {
				events: [],
				itemsSeen: 0,
				itemsDeduped: 0,
				providerExercised: false,
				failureNote: `GitHub sync skipped for ${source.title}: active source is missing a linked Local Project.`,
			};
		}
		const repo = source.identifier.trim();
		const [pullsResponse, workflowResponse] = await Promise.all([
			fetchProviderJson(
				`${provider.baseUrl}/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${maxEventsPerSource}`,
				{
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": "2026-03-10",
				},
			),
			fetchProviderJson(
				`${provider.baseUrl}/repos/${repo}/actions/runs?per_page=${maxEventsPerSource}`,
				{
					Accept: "application/vnd.github+json",
					Authorization: `Bearer ${token}`,
					"X-GitHub-Api-Version": "2026-03-10",
				},
			),
		]);

		const pulls = Array.isArray(pullsResponse) ? pullsResponse : [];
		const runs = Array.isArray(workflowResponse?.workflow_runs)
			? workflowResponse.workflow_runs
			: [];
		let itemsDeduped = 0;
		const events: NormalizedSignalEvent[] = [];

		for (const pull of pulls) {
			const eventKey = buildEventKey([
				"github",
				"pull_request",
				repo,
				String(pull.id ?? pull.number ?? ""),
				String(pull.state ?? "open"),
			]);
			if (eventKeySet.has(eventKey)) {
				itemsDeduped += 1;
				continue;
			}
			eventKeySet.add(eventKey);
			events.push({
				title: `PR #${pull.number} - ${String(pull.title ?? "Untitled pull request")}`,
				localProjectId,
				sourceId: source.id,
				provider: "GitHub",
				signalType: "Pull Request",
				occurredAt: formatExternalDate(pull.updated_at),
				status: pull.draft ? "draft" : String(pull.state ?? "open"),
				environment: "N/A",
				severity: "Info",
				sourceIdValue: String(pull.id ?? pull.number ?? ""),
				sourceUrl: String(pull.html_url ?? source.sourceUrl ?? ""),
				eventKey,
				summary: `Open pull request #${pull.number} in ${repo}.`,
				rawExcerpt: `state=${String(pull.state ?? "open")}, draft=${String(Boolean(pull.draft))}`,
			});
		}

		for (const run of runs) {
			const derivedStatus = String(run.conclusion ?? run.status ?? "unknown");
			const eventKey = buildEventKey([
				"github",
				"workflow_run",
				repo,
				String(run.id ?? ""),
				derivedStatus,
			]);
			if (eventKeySet.has(eventKey)) {
				itemsDeduped += 1;
				continue;
			}
			eventKeySet.add(eventKey);
			events.push({
				title: String(
					run.display_title ?? run.name ?? `Workflow run ${run.id}`,
				),
				localProjectId,
				sourceId: source.id,
				provider: "GitHub",
				signalType: "Workflow Run",
				occurredAt: formatExternalDate(run.updated_at ?? run.created_at),
				status: derivedStatus,
				environment: "N/A",
				severity: isFailureStatus(derivedStatus)
					? diffDays(
							formatExternalDate(run.updated_at ?? run.created_at),
							today,
						) <= 3
						? "Risk"
						: "Watch"
					: "Info",
				sourceIdValue: String(run.id ?? ""),
				sourceUrl: String(run.html_url ?? source.sourceUrl ?? ""),
				eventKey,
				summary: `Workflow run ${String(run.name ?? run.id)} finished with ${derivedStatus}.`,
				rawExcerpt: `status=${String(run.status ?? "")}, conclusion=${String(run.conclusion ?? "")}`,
			});
		}

		return {
			events,
			itemsSeen: pulls.length + runs.length,
			itemsDeduped,
			providerExercised: true,
			syncedSourceId: source.id,
		};
	} catch (error) {
		return {
			events: [],
			itemsSeen: 0,
			itemsDeduped: 0,
			providerExercised: true,
			failureNote: `GitHub sync failed for ${source.title}: ${toErrorMessage(error)}`,
		};
	}
}

async function syncVercelSource(
	source: ExternalSignalSourceRecord,
	provider: ExternalSignalProviderPlan,
	live: boolean,
	token: string,
	maxEventsPerSource: number,
	eventKeySet: Set<string>,
): Promise<ProviderSourceSyncResult> {
	try {
		logLiveStage(live, "Syncing Vercel source", {
			sourceTitle: source.title,
			identifier: source.identifier,
		});
		const localProjectId = getPrimarySourceProjectId(source);
		if (!localProjectId) {
			return {
				events: [],
				itemsSeen: 0,
				itemsDeduped: 0,
				providerExercised: false,
				failureNote: `Vercel sync skipped for ${source.title}: active source is missing a linked Local Project.`,
			};
		}
		const response = await fetchProviderJson(
			`${provider.baseUrl}/v6/deployments?${buildVercelScopeQuery({
				projectId: source.identifier.trim(),
				limit: maxEventsPerSource,
				source,
			})}`,
			{
				Authorization: `Bearer ${token}`,
			},
		);
		const deployments = Array.isArray(response?.deployments)
			? response.deployments
			: Array.isArray(response)
				? response
				: [];
		let itemsDeduped = 0;
		const events: NormalizedSignalEvent[] = [];

		for (const deployment of deployments) {
			const status = String(
				deployment.readyState ??
					deployment.state ??
					deployment.status ??
					deployment.ready ??
					"unknown",
			);
			const eventKey = buildEventKey([
				"vercel",
				"deployment",
				source.identifier,
				String(deployment.uid ?? deployment.id ?? ""),
				status,
			]);
			if (eventKeySet.has(eventKey)) {
				itemsDeduped += 1;
				continue;
			}
			eventKeySet.add(eventKey);
			const environment = String(
				deployment.target ?? deployment.meta?.target ?? "production",
			)
				.toLowerCase()
				.includes("preview")
				? "Preview"
				: "Production";
			events.push({
				title: `Deployment - ${String(deployment.name ?? deployment.uid ?? deployment.id ?? source.identifier)}`,
				localProjectId,
				sourceId: source.id,
				provider: "Vercel",
				signalType: "Deployment",
				occurredAt: formatExternalDate(
					deployment.createdAt ?? deployment.created,
				),
				status,
				environment,
				severity: isFailureStatus(status)
					? "Risk"
					: status.toLowerCase().includes("build")
						? "Watch"
						: "Info",
				sourceIdValue: String(deployment.uid ?? deployment.id ?? ""),
				sourceUrl: normalizeVercelUrl(deployment.url) || source.sourceUrl || "",
				eventKey,
				summary: `Deployment status is ${status.toLowerCase()} for ${source.identifier}.`,
				rawExcerpt: `readyState=${String(deployment.readyState ?? "")}, target=${String(deployment.target ?? "")}`,
			});
		}

		return {
			events,
			itemsSeen: deployments.length,
			itemsDeduped,
			providerExercised: true,
			syncedSourceId: source.id,
		};
	} catch (error) {
		return {
			events: [],
			itemsSeen: 0,
			itemsDeduped: 0,
			providerExercised: true,
			failureNote: `Vercel sync failed for ${source.title}: ${toErrorMessage(error)}`,
		};
	}
}

async function createSyncRunPage(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	titlePropertyName: string;
	today: string;
	result: ProviderSyncResult;
}): Promise<ExternalSignalSyncRunRecord> {
	const title = `${input.result.provider} sync - ${input.today}`;
	const markdown = [
		`# ${title}`,
		"",
		`- Provider: ${input.result.provider}`,
		`- Status: ${input.result.status}`,
		`- Items seen: ${input.result.itemsSeen}`,
		`- Items written: ${input.result.itemsWritten}`,
		`- Items deduped: ${input.result.itemsDeduped}`,
		`- Failures: ${input.result.failures}`,
		"",
		"## Notes",
		...(input.result.notes.length > 0
			? input.result.notes.map((note) => `- ${note}`)
			: ["- No provider-specific notes."]),
	].join("\n");
	const created = await input.api.createPageWithMarkdown({
		parent: {
			data_source_id: input.dataSourceId,
		},
		properties: {
			[input.titlePropertyName]: titleValue(title),
		},
		markdown,
	});
	await input.api.updatePageProperties({
		pageId: created.id,
		properties: {
			Provider: selectPropertyValue(input.result.provider),
			Status: selectPropertyValue(input.result.status),
			"Started At": { date: { start: input.today } },
			"Completed At": { date: { start: input.today } },
			Scope: richTextValue(
				defaultSyncRunScope(
					input.result.provider,
					input.result.syncedSourceIds.length,
				),
			),
			"Items Seen": { number: input.result.itemsSeen },
			"Items Written": { number: input.result.itemsWritten },
			"Items Deduped": { number: input.result.itemsDeduped },
			Failures: { number: input.result.failures },
			"Cursor / Sync Token": richTextValue(input.result.cursor),
			Notes: richTextValue(input.result.notes.join(" | ")),
		},
	});

	return {
		id: created.id,
		url: created.url,
		title,
		provider: input.result.provider,
		status: input.result.status,
		startedAt: input.today,
		completedAt: input.today,
		scope: defaultSyncRunScope(
			input.result.provider,
			input.result.syncedSourceIds.length,
		),
		itemsSeen: input.result.itemsSeen,
		itemsWritten: input.result.itemsWritten,
		itemsDeduped: input.result.itemsDeduped,
		failures: input.result.failures,
		cursor: input.result.cursor,
		notes: input.result.notes.join(" | "),
	};
}

async function createSignalEventPage(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	titlePropertyName: string;
	event: NormalizedSignalEvent;
	syncRunId: string;
}): Promise<ExternalSignalEventRecord> {
	const markdown = [
		`# ${input.event.title}`,
		"",
		`- Provider: ${input.event.provider}`,
		`- Signal type: ${input.event.signalType}`,
		`- Status: ${input.event.status}`,
		`- Occurred at: ${input.event.occurredAt}`,
		`- Severity: ${input.event.severity}`,
		"",
		"## Summary",
		input.event.summary,
		"",
		"## Raw Excerpt",
		input.event.rawExcerpt || "No raw excerpt captured.",
	].join("\n");
	const created = await input.api.createPageWithMarkdown({
		parent: {
			data_source_id: input.dataSourceId,
		},
		properties: {
			[input.titlePropertyName]: titleValue(input.event.title),
		},
		markdown,
	});
	await input.api.updatePageProperties({
		pageId: created.id,
		properties: {
			"Local Project": relationValue([input.event.localProjectId]),
			Source: relationValue([input.event.sourceId]),
			Provider: selectPropertyValue(input.event.provider),
			"Signal Type": selectPropertyValue(input.event.signalType),
			"Occurred At": { date: { start: input.event.occurredAt } },
			Status: richTextValue(input.event.status),
			Environment: selectPropertyValue(input.event.environment),
			Severity: selectPropertyValue(input.event.severity),
			"Source ID": richTextValue(input.event.sourceIdValue),
			"Source URL": input.event.sourceUrl
				? { url: input.event.sourceUrl }
				: { url: null },
			"Sync Run": relationValue([input.syncRunId]),
			"Event Key": richTextValue(input.event.eventKey),
			Summary: richTextValue(input.event.summary),
			"Raw Excerpt": richTextValue(input.event.rawExcerpt),
		},
	});

	return {
		id: created.id,
		url: created.url,
		title: input.event.title,
		localProjectIds: [input.event.localProjectId],
		sourceIds: [input.event.sourceId],
		provider: input.event.provider,
		signalType: input.event.signalType,
		occurredAt: input.event.occurredAt,
		status: input.event.status,
		environment: input.event.environment,
		severity: input.event.severity,
		sourceIdValue: input.event.sourceIdValue,
		sourceUrl: input.event.sourceUrl,
		syncRunIds: [input.syncRunId],
		eventKey: input.event.eventKey,
		summary: input.event.summary,
		rawExcerpt: input.event.rawExcerpt,
	};
}

async function fetchProviderJson(
	url: string,
	headers: Record<string, string>,
	attempt = 0,
): Promise<any> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(PROVIDER_FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		if (attempt < 2) {
			await wait((attempt + 1) * 1500);
			return fetchProviderJson(url, headers, attempt + 1);
		}
		throw new AppError(
			`Provider request failed for ${url}: ${toErrorMessage(error)}`,
		);
	}
	if (response.ok) {
		return response.json();
	}

	const retryAfter = Number(response.headers.get("retry-after") ?? "0");
	if ((response.status === 429 || response.status === 403) && attempt < 2) {
		const delayMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1500;
		await wait(delayMs);
		return fetchProviderJson(url, headers, attempt + 1);
	}

	const body = await response.text();
	throw new AppError(
		`Provider request failed (${response.status}) for ${url}: ${body.slice(0, 300)}`,
	);
}

async function mapWithConcurrency<T, TResult>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
	const results = new Array<TResult>(items.length);
	let nextIndex = 0;

	async function runWorker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await worker(items[index]!, index);
		}
	}

	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
	return results;
}

function newestOccurredAt(events: NormalizedSignalEvent[]): string {
	return (
		[...events].sort((left, right) =>
			right.occurredAt.localeCompare(left.occurredAt),
		)[0]?.occurredAt ?? ""
	);
}

function limitProviderSources(
	sources: ExternalSignalSourceRecord[],
	limit: number | undefined,
): ExternalSignalSourceRecord[] {
	if (!limit || limit <= 0 || sources.length <= limit) {
		return sources;
	}

	return [...sources]
		.sort((left, right) => {
			const leftDate = left.lastSyncedAt || "0000-00-00";
			const rightDate = right.lastSyncedAt || "0000-00-00";
			if (leftDate !== rightDate) {
				return leftDate.localeCompare(rightDate);
			}
			return left.title.localeCompare(right.title);
		})
		.slice(0, limit);
}

function selectScopedSources(input: {
	provider: "github" | "vercel" | "notification_hub" | "repo_auditor" | "all";
	providers: ExternalSignalProviderPlan[];
	sources: ExternalSignalSourceRecord[];
	sourceLimit?: number;
}): ExternalSignalSourceRecord[] {
	const selectedProviderKeys =
		input.provider === "all"
			? input.providers
					.filter((provider) => provider.enabled)
					.map((provider) => provider.key)
			: [input.provider];

	return selectedProviderKeys.flatMap((providerKey) =>
		limitProviderSources(
			input.sources.filter(
				(source) =>
					source.status === "Active" &&
					Boolean(source.identifier.trim()) &&
					normalizeProviderName(source.provider) === providerKey,
			),
			input.sourceLimit,
		),
	);
}

function deriveTargetProjectIdsFromSources(
	sources: ExternalSignalSourceRecord[],
): Set<string> {
	const targetProjectIds = new Set<string>();
	for (const source of sources) {
		for (const projectId of source.localProjectIds) {
			targetProjectIds.add(projectId);
		}
	}
	return targetProjectIds;
}

function formatExternalDate(value: unknown): string {
	if (typeof value === "number") {
		return new Date(value).toISOString().slice(0, 10);
	}
	if (typeof value === "string" && value.length >= 10) {
		return value.slice(0, 10);
	}
	return losAngelesToday();
}

export function normalizeProviderName(
	value: ExternalSignalSourceRecord["provider"],
): ExternalProviderKey | undefined {
	switch (value) {
		case "GitHub":
			return "github";
		case "Vercel":
			return "vercel";
		case "Google Calendar":
			return "google_calendar";
		case "Notification Hub":
			return "notification_hub";
		case "Repo Auditor":
			return "repo_auditor";
		default:
			return undefined;
	}
}

function normalizeVercelUrl(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		return "";
	}
	return value.startsWith("http") ? value : `https://${value}`;
}

function isFailureStatus(value: string): boolean {
	return [
		"failed",
		"failure",
		"error",
		"timed_out",
		"cancelled",
		"canceled",
	].includes(value.toLowerCase());
}

function emptyProviderResult(
	provider: ProviderSyncResult["provider"],
	note: string,
): ProviderSyncResult {
	return {
		provider,
		status: "Succeeded",
		itemsSeen: 0,
		itemsWritten: 0,
		itemsDeduped: 0,
		failures: 0,
		notes: [note],
		cursor: "",
		events: [],
		syncedSourceIds: [],
		providerExercised: false,
	};
}

function buildVercelScopeQuery(input: {
	projectId: string;
	limit: number;
	source: ExternalSignalSourceRecord;
}): string {
	const params = new URLSearchParams({
		projectId: input.projectId,
		limit: String(input.limit),
	});
	if (input.source.providerScopeId) {
		params.set("teamId", input.source.providerScopeId);
	} else if (input.source.providerScopeSlug) {
		params.set("slug", input.source.providerScopeSlug);
	}
	return params.toString();
}

function serializeMetrics(
	metrics: ReturnType<typeof calculateExternalSignalMetrics>,
): Record<string, number> {
	return {
		mappedProjects: metrics.mappedProjects,
		projectsNeedingMapping: metrics.projectsNeedingMapping,
		activeSources: metrics.activeSources,
		riskEvents: metrics.riskEvents,
		successfulDeployments: metrics.successfulDeployments,
		failedWorkflowRuns: metrics.failedWorkflowRuns,
		contradictionProjects: metrics.contradictionProjects,
	};
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["signals", "sync"]);
}
