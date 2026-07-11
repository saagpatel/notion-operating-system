import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, constants, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import {
	assertSafeReplacement,
	buildReplaceCommand,
	extractManagedSection,
	normalizeMarkdown,
	normalizePageBodyMarkdown,
} from "../utils/markdown.js";
import { postNotificationHubEvent } from "../utils/notification-hub.js";
import { normalizeNotionId } from "../utils/notion-id.js";
import {
	isMarkdownPatchTransportError,
	replaceCommandCenterPageAfterPatchFailure,
} from "./command-center-replacement.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	diffDays,
	loadLocalPortfolioControlTowerConfig,
	saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	datePropertyValue,
	fetchAllPages,
	relationIds,
	relationValue,
	richTextValue,
	selectPropertyValue,
	textValue,
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
	fetchExistingExternalSignalEventKeys,
	fetchExistingExternalSignalEventsByKey,
	fetchRecentExternalSignalEventPagesByProject,
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
import {
	isNotionPolicyBlockedError,
	isReadBackRecoverableMarkdownError,
	syncManagedMarkdownSectionWithReadBack,
} from "./managed-markdown-sync.js";
import { createNotionSdkClient } from "./notion-sdk.js";
import {
	isKnownBlockedProjectMarkdown,
	loadProjectMarkdownBlocklist,
} from "./project-markdown-blocklist.js";
import { buildProjectMarkdownRefreshContract } from "./project-markdown-refresh-contract.js";
import {
	getSignalWatermark,
	loadSignalWatermarks,
	persistSignalWatermarks,
	type SignalWatermark,
} from "./signal-watermarks.js";
import { mapWeeklyStepStatusToCommandStatus } from "./weekly-refresh-contract.js";

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
const EXTERNAL_SIGNAL_BRIEF_STORAGE_VERSION = "external-signal-brief-db-v1";
const PROGRESS_HEARTBEAT_MS = 15_000;
const STORED_BRIEF_WRITE_MAX_ATTEMPTS = 2;
const STORED_BRIEF_WRITE_RETRY_BASE_DELAY_MS = 250;

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
	/**
	 * P4: `"identity"` means `eventKey` identifies the underlying thing
	 * (e.g. one Vercel deployment) independent of its status, so a key match
	 * with a changed `status` is an upsert candidate, not a duplicate.
	 * Default (`undefined`/`"identity+status"`) keeps the original
	 * append-only contract, where a key match is always a true duplicate.
	 */
	dedupMode?: "identity" | "identity+status";
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
	/** P4: identity-mode key matches whose status changed — patch, don't create. */
	updates?: Array<{ event: NormalizedSignalEvent; pageId: string }>;
	/** P3: local-file cursor to persist once this result's writes have landed. */
	nextWatermark?: SignalWatermark;
}

export interface ExternalSignalSyncCommandOptions {
	live?: boolean;
	provider?: "github" | "vercel" | "notification_hub" | "repo_auditor" | "all";
	today?: string;
	config?: string;
	sourceLimit?: number;
	maxEventsPerSource?: number;
	writeScope?: ExternalSignalSyncWriteScope;
	projectLimit?: number;
	projectOffset?: number;
	projectConcurrency?: number;
	skipKnownBlockedMarkdown?: boolean;
	blockedMarkdownConfig?: string;
}

export type ExternalSignalSyncWriteScope =
	| "full"
	| "providers"
	| "project-pages"
	| "portfolio-sections";

interface ProjectBriefRefresh {
	projectId: string;
	projectTitle: string;
	previousMarkdown: string;
	nextMarkdown: string;
	summary?: ReturnType<typeof buildExternalSignalSummary>;
	changed: boolean;
	storageTitle?: string;
	storagePageId?: string;
	storagePageUrl?: string;
	contentHash?: string;
}

export interface ExternalSignalSyncWritePlan {
	writeScope: ExternalSignalSyncWriteScope;
	shouldRunProviders: boolean;
	shouldEvaluateProjectPages: boolean;
	shouldEvaluatePortfolioSections: boolean;
	shouldPersistMetrics: boolean;
}

export async function runExternalSignalSyncCommand(
	options: ExternalSignalSyncCommandOptions = {},
): Promise<void> {
	const writePlan = deriveExternalSignalSyncWritePlan(options);
	const {
		writeScope,
		shouldRunProviders,
		shouldEvaluateProjectPages,
		shouldEvaluatePortfolioSections,
		shouldPersistMetrics,
	} = writePlan;
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
		await saveLocalPortfolioControlTowerConfig(config, configPath);
	}

	const phase5 = requirePhase5ExternalSignals(config);
	const providerConfig = await loadLocalPortfolioExternalSignalProviderConfig();
	logLiveStage(live, "Starting external signal sync", {
		provider,
		writeScope,
		projectLimit: options.projectLimit,
		projectOffset: options.projectOffset ?? 0,
		projectConcurrency: options.projectConcurrency ?? 1,
	});

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
	const {
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
		syncRunPages,
	} = await withProgressHeartbeat(
		live,
		"Fetching external signal datasets",
		async () => {
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
				syncRunPages,
			] = await Promise.all([
				fetchPagesWithProgress(
					live,
					"projects",
					sdk,
					config.database.dataSourceId,
					projectSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"build log",
					sdk,
					config.relatedDataSources.buildLogId,
					buildSchema.titlePropertyName,
				),
				shouldEvaluatePortfolioSections
					? fetchPagesWithProgress(
							live,
							"weekly reviews",
							sdk,
							config.relatedDataSources.weeklyReviewsId,
							weeklySchema.titlePropertyName,
						)
					: Promise.resolve([]),
				fetchPagesWithProgress(
					live,
					"research",
					sdk,
					config.relatedDataSources.researchId,
					researchSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"skills",
					sdk,
					config.relatedDataSources.skillsId,
					skillSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"tools",
					sdk,
					config.relatedDataSources.toolsId,
					toolSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"decisions",
					sdk,
					config.phase2Execution!.decisions.dataSourceId,
					decisionSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"packets",
					sdk,
					config.phase2Execution!.packets.dataSourceId,
					packetSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"tasks",
					sdk,
					config.phase2Execution!.tasks.dataSourceId,
					taskSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"recommendation runs",
					sdk,
					config.phase3Intelligence!.recommendationRuns.dataSourceId,
					runSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"link suggestions",
					sdk,
					config.phase3Intelligence!.linkSuggestions.dataSourceId,
					suggestionSchema.titlePropertyName,
				),
				fetchPagesWithProgress(
					live,
					"external sources",
					sdk,
					phase5.sources.dataSourceId,
					sourceSchema.titlePropertyName,
				),
				shouldEvaluatePortfolioSections
					? fetchPagesWithProgress(
							live,
							"sync runs",
							sdk,
							phase5.syncRuns.dataSourceId,
							syncRunSchema.titlePropertyName,
						)
					: Promise.resolve([]),
			]);
			return {
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
				syncRunPages,
			};
		},
	);

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
	const existingSyncRuns = syncRunPages.map((page) =>
		toExternalSignalSyncRunRecord(page),
	);
	const scopedSources = selectScopedSources({
		provider,
		providers: providerConfig.providers,
		sources,
		sourceLimit: options.sourceLimit,
	});
	const targetProjectIds =
		writeScope === "full" && options.sourceLimit
			? deriveTargetProjectIdsFromSources(scopedSources)
			: new Set(projects.map((project) => project.id));
	const allTargetProjects = projects.filter((project) =>
		targetProjectIds.has(project.id),
	);
	const projectRefreshTotalCount = allTargetProjects.length;
	const targetProjects =
		writeScope === "project-pages"
			? selectProjectRefreshBatch({
					projects: allTargetProjects,
					limit: options.projectLimit,
					offset: options.projectOffset,
				})
			: allTargetProjects;
	const projectRefreshOffset =
		writeScope === "project-pages" ? (options.projectOffset ?? 0) : undefined;
	const projectRefreshLimit =
		writeScope === "project-pages" ? options.projectLimit : undefined;
	const projectRefreshBatchCount =
		writeScope === "project-pages"
			? targetProjects.length
			: projectRefreshTotalCount;
	const evaluatedProjectCount = shouldEvaluateProjectPages
		? targetProjects.length
		: 0;
	const summaryProjectIds = shouldEvaluatePortfolioSections
		? projects.map((project) => project.id)
		: shouldEvaluateProjectPages
			? targetProjects.map((project) => project.id)
			: [];
	let createdEventCount = 0;
	let createdSyncRunCount = 0;
	const sourceMap = new Map(sources.map((source) => [source.id, source]));
	// P3: durable per-(provider, source) cursors — notification_hub reads its
	// JSONL log forward from here instead of a tail window, and the dedup
	// query below skips Notion lookups for events the watermark already
	// covers. Absent file → empty list, identical to pre-watermark behavior.
	const signalWatermarks = shouldRunProviders
		? await loadSignalWatermarks()
		: [];
	let providerResults = shouldRunProviders
		? await syncProviders({
				flags: { live, provider, today: options.today },
				today,
				phase5,
				providers: providerConfig.providers,
				sources,
				eventKeySet: new Set(),
				projects: projects.map((p) => ({ id: p.id, title: p.title })),
				sourceLimit: options.sourceLimit,
				maxEventsPerSource: options.maxEventsPerSource,
				watermarks: signalWatermarks,
			})
		: [];
	if (shouldRunProviders) {
		providerResults = await filterProviderResultsAgainstExistingEventKeys({
			api: sdk,
			dataSourceId: phase5.events.dataSourceId,
			titlePropertyName: eventSchema.titlePropertyName,
			providerResults,
			today,
			live,
			watermarks: signalWatermarks,
		});
	}
	const eventPages =
		summaryProjectIds.length > 0
			? await fetchRecentExternalSignalEventPagesWithProgress(
					live,
					sdk,
					phase5.events.dataSourceId,
					eventSchema.titlePropertyName,
					summaryProjectIds,
				)
			: [];
	const existingEvents = eventPages.map((page) =>
		toExternalSignalEventRecord(page),
	);

	if (live && shouldRunProviders) {
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
			existingSyncRuns.unshift(syncRun);

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

			// P4: identity-mode matches whose status changed — patch the
			// existing row instead of appending a duplicate.
			for (const update of result.updates ?? []) {
				await updateSignalEventPage({
					api,
					pageId: update.pageId,
					event: update.event,
					syncRunId: syncRun.id,
				});
				const existingIndex = existingEvents.findIndex(
					(existingEvent) => existingEvent.id === update.pageId,
				);
				if (existingIndex !== -1) {
					existingEvents[existingIndex] = {
						...existingEvents[existingIndex]!,
						status: update.event.status,
						occurredAt: update.event.occurredAt,
						severity: update.event.severity,
						summary: update.event.summary,
						rawExcerpt: update.event.rawExcerpt,
						sourceUrl: update.event.sourceUrl,
						syncRunIds: [syncRun.id],
					};
				}
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

			// P3: only advance the durable cursor once this result's writes
			// (creates + updates + source stamping above) have all landed
			// without throwing — advancing on a partial/failed batch would
			// skip re-processing events that never actually made it to Notion.
			if (result.nextWatermark) {
				await persistSignalWatermarks([result.nextWatermark]);
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
	const usesExternalSignalBriefStorage = Boolean(phase5.externalSignalBriefs);
	logLiveStage(live, "Evaluating external signal project briefs", {
		projectCount: targetProjects.length,
		storageMode: usesExternalSignalBriefStorage,
	});
	const projectBriefs: ProjectBriefRefresh[] = await withProgressHeartbeat(
		live,
		"Evaluating external signal project briefs",
		() =>
			shouldEvaluateProjectPages
				? usesExternalSignalBriefStorage && phase5.externalSignalBriefs
					? buildStoredExternalSignalBriefRefreshes({
							api,
							projects: targetProjects,
							recommendations,
							summaryMap,
							dataSourceId: phase5.externalSignalBriefs.dataSourceId,
							today,
						})
					: Promise.all(
							targetProjects.map(async (project) => {
								const recommendation = recommendations.find(
									(entry) => entry.projectId === project.id,
								);
								const summary = summaryMap.get(project.id);
								const previous = await api.readPageMarkdown(project.id);
								if (!recommendation || !summary) {
									return {
										projectId: project.id,
										projectTitle: project.title,
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
									projectTitle: project.title,
									previousMarkdown: previous.markdown,
									nextMarkdown,
									summary,
									changed:
										normalizeMarkdown(nextMarkdown) !==
										normalizeMarkdown(previous.markdown),
								};
							}),
						)
				: Promise.resolve([]),
	);
	const projectExternalSignalBriefsWouldChange = projectBriefs.filter(
		(entry) => entry.changed,
	).length;
	logLiveStage(live, "External signal project brief evaluation complete", {
		changedCount: projectExternalSignalBriefsWouldChange,
		projectCount: projectBriefs.length,
	});
	const changedProjectPageSamples = projectBriefs
		.filter((entry) => entry.changed)
		.slice(0, 15)
		.map((entry) => ({
			projectId: entry.projectId,
			projectTitle: entry.projectTitle,
		}));

	const previousCommandCenter = shouldEvaluatePortfolioSections
		? await api.readPageMarkdown(config.commandCenter.pageId!)
		: undefined;
	const withIntelligence =
		previousCommandCenter && shouldEvaluatePortfolioSections
			? mergeManagedSection(
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
				)
			: undefined;
	const intelligenceCommandCenterSectionWouldChange =
		previousCommandCenter && withIntelligence
			? normalizeMarkdown(withIntelligence) !==
				normalizeMarkdown(previousCommandCenter.markdown)
			: false;
	const withExternalSignals =
		withIntelligence && shouldEvaluatePortfolioSections
			? mergeManagedSection(
					withIntelligence,
					renderExternalSignalCommandCenterSection({
						summaries: [...summaryMap.values()],
						syncRuns: summarySyncRuns,
						projects,
					}),
					EXTERNAL_SIGNAL_COMMAND_CENTER_START,
					EXTERNAL_SIGNAL_COMMAND_CENTER_END,
				)
			: undefined;
	const externalSignalsCommandCenterSectionWouldChange =
		withExternalSignals && withIntelligence
			? normalizeMarkdown(withExternalSignals) !==
				normalizeMarkdown(withIntelligence)
			: false;
	const weeklyReview = weeklyPages.find(
		(page) => page.title === `Week of ${weekStart}`,
	);
	const previousWeeklyReview =
		weeklyReview && shouldEvaluatePortfolioSections
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
	const knownBlockedMarkdownBlocklist =
		options.skipKnownBlockedMarkdown && !usesExternalSignalBriefStorage
			? await loadProjectMarkdownBlocklist(options.blockedMarkdownConfig)
			: undefined;
	const knownBlockedProjectBriefs = knownBlockedMarkdownBlocklist
		? projectBriefs.filter(
				(projectBrief) =>
					projectBrief.changed &&
					isKnownBlockedProjectMarkdown(
						knownBlockedMarkdownBlocklist,
						projectBrief,
						"external-signals",
					),
			)
		: [];
	const writableProjectExternalSignalBriefsWouldChange =
		projectExternalSignalBriefsWouldChange - knownBlockedProjectBriefs.length;

	let changedProjectPages = 0;
	const blockedMarkdownProjects: string[] = [];
	const skippedProjectPropertyUpdates: string[] = [];
	const knownBlockedMarkdownProjects = knownBlockedProjectBriefs.map(
		(projectBrief) => projectBrief.projectTitle,
	);
	if (live && shouldEvaluateProjectPages) {
		const projectConcurrency = options.projectConcurrency ?? 1;
		logLiveStage(live, "Refreshing project signal briefs", {
			writeScope,
			projectCount: targetProjects.length,
			projectRefreshTotalCount,
			projectRefreshOffset,
			projectRefreshLimit,
			projectConcurrency,
		});
		await mapWithConcurrency(
			targetProjects,
			projectConcurrency,
			async (project, index) => {
				logProjectRefreshProgress(live, {
					index: index + 1,
					total: targetProjects.length,
					projectTitle: project.title,
					pageId: project.id,
					writeScope,
					projectRefreshOffset,
					projectRefreshLimit,
				});
				const recommendation = recommendations.find(
					(entry) => entry.projectId === project.id,
				);
				const summary = summaryMap.get(project.id);
				if (!recommendation || !summary) {
					return;
				}

				const propertyUpdates = buildExternalSignalProjectPropertyUpdates({
					project,
					recommendation,
					summary,
					today,
				});
				if (Object.keys(propertyUpdates).length > 0) {
					try {
						await api.updatePageProperties({
							pageId: project.id,
							properties: propertyUpdates,
						});
					} catch (error) {
						if (!usesExternalSignalBriefStorage) {
							throw error;
						}
						skippedProjectPropertyUpdates.push(project.title);
						logLiveStage(live, "Skipping blocked project property patch", {
							projectId: project.id,
							projectTitle: project.title,
							error: toErrorMessage(error),
						});
					}
				}
				const projectBrief = projectBriefs[index];
				if (projectBrief?.changed) {
					if (phase5.externalSignalBriefs && projectBrief.storageTitle) {
						await upsertExternalSignalBriefPage({
							api,
							dataSourceId: phase5.externalSignalBriefs.dataSourceId,
							titlePropertyName: "Name",
							title: projectBrief.storageTitle,
							properties: buildExternalSignalBriefStorageProperties({
								entry: projectBrief,
								today,
							}),
							markdown: projectBrief.nextMarkdown,
						});
						changedProjectPages += 1;
						return;
					}
					if (
						knownBlockedMarkdownBlocklist &&
						isKnownBlockedProjectMarkdown(
							knownBlockedMarkdownBlocklist,
							projectBrief,
							"external-signals",
						)
					) {
						logLiveStage(
							live,
							"Skipping known blocked project markdown patch",
							{
								projectId: project.id,
								projectTitle: project.title,
							},
						);
						return;
					}
					try {
						await syncExternalSignalProjectBrief({
							api,
							pageId: project.id,
							projectTitle: project.title,
							previousMarkdown: projectBrief.previousMarkdown,
							nextMarkdown: projectBrief.nextMarkdown,
						});
						changedProjectPages += 1;
					} catch (error) {
						if (
							!isNotionPolicyBlockedError(error) &&
							!isReadBackRecoverableMarkdownError(error)
						) {
							throw error;
						}
						blockedMarkdownProjects.push(project.title);
						logLiveStage(live, "Skipping blocked project markdown patch", {
							projectId: project.id,
							projectTitle: project.title,
						});
					}
				}
			},
		);
	}

	if (live && shouldEvaluatePortfolioSections) {
		logLiveStage(live, "Refreshing command center and weekly review");
		if (
			previousCommandCenter &&
			withExternalSignals &&
			(intelligenceCommandCenterSectionWouldChange ||
				externalSignalsCommandCenterSectionWouldChange)
		) {
			try {
				await syncExternalSignalCommandCenterMarkdown({
					api,
					pageId: config.commandCenter.pageId!,
					previousMarkdown: previousCommandCenter.markdown,
					nextMarkdown: withExternalSignals,
				});
			} catch (error) {
				if (
					!isMarkdownPatchTransportError(error) &&
					!isReadBackRecoverableMarkdownError(error) &&
					!isNotionPolicyBlockedError(error)
				) {
					throw error;
				}
				config = await replaceCommandCenterPageAfterPatchFailure({
					api,
					config,
					configPath,
					markdown: withExternalSignals,
				});
			}
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

		if (shouldPersistMetrics) {
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
	}

	const output = {
		ok: true,
		live,
		status: "clean" as string,
		wouldChange: false,
		summaryCounts: {},
		warnings: [] as string[],
		provider,
		writeScope,
		createdEventCount,
		createdSyncRunCount,
		changedProjectPages,
		projectExternalSignalBriefsWouldChange,
		blockedMarkdownProjectPages: blockedMarkdownProjects.length,
		knownBlockedMarkdownProjectPages: knownBlockedMarkdownProjects.length,
		skippedProjectPropertyUpdatePages: skippedProjectPropertyUpdates.length,
		blockedMarkdownProjects,
		knownBlockedMarkdownProjects,
		projectRefreshTotalCount,
		projectRefreshBatchCount,
		projectRefreshOffset,
		projectRefreshLimit,
		evaluatedProjectCount,
		changedProjectPageSamples,
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
	const markdownPartial = blockedMarkdownProjects.length > 0;
	const contract = buildProjectMarkdownRefreshContract({
		live,
		status: providerFailed
			? "failed"
			: providerPartial || markdownPartial
				? "partial"
				: undefined,
		blockedMarkdownProjectPages: blockedMarkdownProjects.length,
		writableMarkdownProjectPagesWouldChange:
			createdEventCount +
			createdSyncRunCount +
			writableProjectExternalSignalBriefsWouldChange,
		portfolioSectionWouldChange:
			intelligenceCommandCenterSectionWouldChange ||
			externalSignalsCommandCenterSectionWouldChange ||
			weeklyExternalSignalsSectionWouldChange,
		summaryCounts: {
			createdEventCount,
			createdSyncRunCount,
			targetProjectCount: evaluatedProjectCount,
			syncedSourceCount: providerResults.reduce(
				(sum, result) => sum + result.syncedSourceIds.length,
				0,
			),
			projectExternalSignalBriefsWouldChange,
			blockedMarkdownProjectPages: blockedMarkdownProjects.length,
			knownBlockedMarkdownProjectPages: knownBlockedMarkdownProjects.length,
			skippedProjectPropertyUpdatePages: skippedProjectPropertyUpdates.length,
			projectRefreshTotalCount,
			projectRefreshBatchCount,
			projectRefreshOffset: projectRefreshOffset ?? 0,
			projectRefreshLimit: projectRefreshLimit ?? 0,
			evaluatedProjectCount,
			intelligenceCommandCenterSectionWouldChange:
				intelligenceCommandCenterSectionWouldChange ? 1 : 0,
			externalSignalsCommandCenterSectionWouldChange:
				externalSignalsCommandCenterSectionWouldChange ? 1 : 0,
			weeklyExternalSignalsSectionWouldChange:
				weeklyExternalSignalsSectionWouldChange ? 1 : 0,
			mappedProjects: output.metrics.mappedProjects,
			projectsNeedingMapping: output.metrics.projectsNeedingMapping,
		},
		warnings: [
			...providerWarnings,
			...skippedProjectPropertyUpdates.map(
				(projectTitle) =>
					`Skipped blocked project property patch: ${projectTitle}`,
			),
			...blockedMarkdownProjects.map(
				(projectTitle) =>
					`Skipped blocked project markdown patch: ${projectTitle}`,
			),
			...knownBlockedMarkdownProjects.map(
				(projectTitle) =>
					`Skipped known blocked project markdown patch: ${projectTitle}`,
			),
		],
	});
	output.status = contract.status;
	output.wouldChange = contract.wouldChange;
	output.summaryCounts = contract.summaryCounts;
	output.warnings = contract.warnings;
	recordCommandOutputSummary(output, {
		status: mapWeeklyStepStatusToCommandStatus(contract.status),
		warningCategories: mergeExternalSignalWarningCategories(
			deriveExternalSignalSyncWarningCategories(providerResults),
			markdownPartial ? ["partial_success"] : undefined,
		),
		failureCategories:
			deriveExternalSignalSyncFailureCategories(providerResults),
		metadata: {
			provider,
			writeScope,
			providerRunCount: providerResults.length,
			evaluatedProjectCount,
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

async function buildStoredExternalSignalBriefRefreshes(input: {
	api: DirectNotionClient;
	projects: ReturnType<typeof toIntelligenceProjectRecord>[];
	recommendations: Array<ReturnType<typeof buildRecommendation>>;
	summaryMap: Map<string, ReturnType<typeof buildExternalSignalSummary>>;
	dataSourceId: string;
	today: string;
}): Promise<ProjectBriefRefresh[]> {
	const existingPages = await fetchAllPages(
		input.api,
		input.dataSourceId,
		"Name",
	);
	const existingByTitle = new Map(
		existingPages.map((page) => [page.title, page]),
	);

	return Promise.all(
		input.projects.map(async (project) => {
			const recommendation = input.recommendations.find(
				(entry) => entry.projectId === project.id,
			);
			const summary = input.summaryMap.get(project.id);
			if (!recommendation || !summary) {
				return {
					projectId: project.id,
					projectTitle: project.title,
					previousMarkdown: "",
					nextMarkdown: "",
					summary,
					changed: false,
				};
			}

			const storageTitle = buildExternalSignalBriefStorageTitle({
				projectTitle: project.title,
				today: input.today,
			});
			const existing = existingByTitle.get(storageTitle);
			const nextMarkdown = renderExternalSignalBriefStorageMarkdown({
				projectTitle: project.title,
				summary,
				today: input.today,
			});
			const contentHash = hashMarkdown(nextMarkdown, storageTitle);
			const existingHash = existing
				? textValue(existing.properties["Brief Hash"])
				: "";
			const previousMarkdown =
				existing && existingHash !== contentHash
					? (await input.api.readPageMarkdown(existing.id)).markdown
					: "";
			const changed =
				!existing ||
				(existingHash === contentHash
					? false
					: normalizePageBodyMarkdown(nextMarkdown, storageTitle) !==
						normalizePageBodyMarkdown(previousMarkdown, storageTitle));

			return {
				projectId: project.id,
				projectTitle: project.title,
				previousMarkdown,
				nextMarkdown,
				summary,
				changed,
				storageTitle,
				storagePageId: existing?.id,
				storagePageUrl: existing?.url,
				contentHash,
			};
		}),
	);
}

export function buildExternalSignalBriefStorageTitle(input: {
	projectTitle: string;
	today: string;
}): string {
	return `${input.projectTitle} - External Signal Brief - ${input.today}`;
}

function renderExternalSignalBriefStorageMarkdown(input: {
	projectTitle: string;
	summary: ReturnType<typeof buildExternalSignalSummary>;
	today: string;
}): string {
	return [
		`# ${buildExternalSignalBriefStorageTitle({
			projectTitle: input.projectTitle,
			today: input.today,
		})}`,
		"",
		renderExternalSignalBriefSection({ summary: input.summary }),
	].join("\n");
}

function buildExternalSignalBriefStorageProperties(input: {
	entry: ProjectBriefRefresh;
	today: string;
}): Record<string, unknown> {
	const summary = input.entry.summary;
	return {
		Name: titleValue(input.entry.storageTitle ?? input.entry.projectTitle),
		"Local Project": relationValue([input.entry.projectId]),
		"Brief Date": datePropertyValue(input.today),
		"External Signal Coverage": selectPropertyValue(summary?.coverage),
		"Latest External Activity": datePropertyValue(
			summary?.latestExternalActivity,
		),
		"Latest Deployment Status": selectPropertyValue(
			summary?.latestDeploymentStatus,
		),
		"Open PR Count": { number: summary?.openPrCount ?? 0 },
		"Recent Failed Workflow Runs": {
			number: summary?.recentFailedWorkflowRuns ?? 0,
		},
		"Mapped Sources": relationValue(
			(summary?.mappedSources ?? []).map((source) => source.id),
		),
		"Recent Events": relationValue(
			(summary?.recentEvents ?? []).slice(0, 25).map((event) => event.id),
		),
		Source: selectPropertyValue("external-signal-sync"),
		"Storage Version": richTextValue(EXTERNAL_SIGNAL_BRIEF_STORAGE_VERSION),
		"Brief Hash": richTextValue(input.entry.contentHash ?? ""),
	};
}

function hashMarkdown(markdown: string, title: string): string {
	return createHash("sha256")
		.update(normalizePageBodyMarkdown(markdown, title))
		.digest("hex");
}

export async function upsertExternalSignalBriefPage(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	titlePropertyName: string;
	title: string;
	properties: Record<string, unknown>;
	markdown: string;
}): Promise<void> {
	let existing = await input.api.searchPage({
		dataSourceId: input.dataSourceId,
		exactTitle: input.title,
		titleProperty: input.titlePropertyName,
	});
	if (existing) {
		const existingPage = await input.api.retrievePage(existing.id);
		const expectedDataSourceId = normalizeNotionId(input.dataSourceId);
		const actualDataSourceId = existingPage.parent?.data_source_id
			? normalizeNotionId(existingPage.parent.data_source_id)
			: undefined;
		if (actualDataSourceId !== expectedDataSourceId) {
			logLiveStage(
				true,
				"Ignoring stored external signal brief outside expected data source",
				{
					pageId: existing.id,
					title: input.title,
					expectedDataSourceId,
					actualDataSourceId,
				},
			);
			existing = null;
		}
	}

	if (!existing) {
		await createExternalSignalBriefPage(input);
		return;
	}

	try {
		await retryStoredExternalSignalBriefWrite({
			operation: "property patch",
			pageId: existing.id,
			title: input.title,
			run: () =>
				input.api.updatePageProperties({
					pageId: existing.id,
					properties: input.properties,
				}),
		});
	} catch (error) {
		const hashFallbackUpdated = await updateExternalSignalBriefHashProperties({
			api: input.api,
			pageId: existing.id,
			title: input.title,
			properties: input.properties,
		});
		logLiveStage(
			true,
			"Stored external signal brief property patch used hash fallback",
			{
				pageId: existing.id,
				title: input.title,
				hashFallbackUpdated,
				error: toErrorMessage(error),
			},
		);
	}

	try {
		await retryStoredExternalSignalBriefWrite({
			operation: "markdown patch",
			pageId: existing.id,
			title: input.title,
			run: () =>
				input.api.patchPageMarkdown({
					pageId: existing.id,
					command: "replace_content",
					newMarkdown: input.markdown,
				}),
		});
	} catch (error) {
		logLiveStage(true, "Stored external signal brief markdown patch failed", {
			pageId: existing.id,
			title: input.title,
			error: toErrorMessage(error),
		});
	}
}

async function createExternalSignalBriefPage(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	titlePropertyName: string;
	title: string;
	properties: Record<string, unknown>;
	markdown: string;
}): Promise<void> {
	const titleProperty =
		input.properties[input.titlePropertyName] ?? titleValue(input.title);
	const created = await input.api.createPageWithMarkdown({
		parent: {
			data_source_id: input.dataSourceId,
		},
		properties: {
			[input.titlePropertyName]: titleProperty,
		},
		markdown: input.markdown,
	});
	const nonTitleProperties = Object.fromEntries(
		Object.entries(input.properties).filter(
			([name]) => name !== input.titlePropertyName,
		),
	);
	if (Object.keys(nonTitleProperties).length > 0) {
		try {
			await retryStoredExternalSignalBriefWrite({
				operation: "property patch",
				pageId: created.id,
				title: input.title,
				run: () =>
					input.api.updatePageProperties({
						pageId: created.id,
						properties: nonTitleProperties,
					}),
			});
		} catch (error) {
			const hashFallbackUpdated = await updateExternalSignalBriefHashProperties(
				{
					api: input.api,
					pageId: created.id,
					title: input.title,
					properties: input.properties,
				},
			);
			logLiveStage(
				true,
				"Stored external signal brief property patch used hash fallback",
				{
					pageId: created.id,
					title: input.title,
					hashFallbackUpdated,
					error: toErrorMessage(error),
				},
			);
		}
	}
}

async function updateExternalSignalBriefHashProperties(input: {
	api: DirectNotionClient;
	pageId: string;
	title: string;
	properties: Record<string, unknown>;
}): Promise<boolean> {
	const minimalProperties = Object.fromEntries(
		["Storage Version", "Brief Hash"]
			.map((name) => [name, input.properties[name]])
			.filter((entry): entry is [string, unknown] => entry[1] !== undefined),
	);
	if (Object.keys(minimalProperties).length === 0) {
		return false;
	}
	try {
		await retryStoredExternalSignalBriefWrite({
			operation: "hash patch",
			pageId: input.pageId,
			title: input.title,
			run: () =>
				input.api.updatePageProperties({
					pageId: input.pageId,
					properties: minimalProperties,
				}),
		});
		return true;
	} catch (error) {
		logLiveStage(true, "Stored external signal brief hash patch failed", {
			pageId: input.pageId,
			title: input.title,
			error: toErrorMessage(error),
		});
		return false;
	}
}

async function retryStoredExternalSignalBriefWrite<T>(input: {
	operation: "property patch" | "hash patch" | "markdown patch";
	pageId: string;
	title: string;
	run: () => Promise<T>;
	maxAttempts?: number;
	baseDelayMs?: number;
}): Promise<T> {
	const maxAttempts = input.maxAttempts ?? STORED_BRIEF_WRITE_MAX_ATTEMPTS;
	const baseDelayMs =
		input.baseDelayMs ?? STORED_BRIEF_WRITE_RETRY_BASE_DELAY_MS;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await input.run();
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !isRetryableStoredBriefWriteError(error)) {
				throw error;
			}
			const delayMs = baseDelayMs * attempt;
			logLiveStage(true, "Retrying stored external signal brief write", {
				pageId: input.pageId,
				title: input.title,
				operation: input.operation,
				attempt,
				nextAttempt: attempt + 1,
				delayMs,
				error: toErrorMessage(error),
			});
			await waitMs(delayMs);
		}
	}

	throw lastError;
}

export function isRetryableStoredBriefWriteError(error: unknown): boolean {
	if (error instanceof AppError) {
		const status = Number(error.details?.status ?? 0);
		const classification =
			typeof error.details?.classification === "string"
				? error.details.classification
				: "";
		if (status === 429 || status >= 500) {
			return true;
		}
		if (
			classification === "timeout_exhausted" ||
			classification === "transport_error" ||
			classification === "unexpected_response"
		) {
			return true;
		}
	}

	const message = toErrorMessage(error);
	return /Notion request (transport error|timed out|returned retryable error responses)/i.test(
		message,
	);
}

function waitMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLiveStage(
	live: boolean,
	stage: string,
	details?: Record<string, unknown>,
): void {
	if (!shouldLogProgress(live)) {
		return;
	}

	const suffix = details ? ` ${JSON.stringify(details)}` : "";
	console.error(`[external-signal-sync] ${stage}${suffix}`);
}

function logProjectRefreshProgress(
	live: boolean,
	input: {
		index: number;
		total: number;
		projectTitle: string;
		pageId: string;
		writeScope: ExternalSignalSyncWriteScope;
		projectRefreshOffset?: number;
		projectRefreshLimit?: number;
	},
): void {
	if (!shouldLogProgress(live)) {
		return;
	}
	if (
		input.index === 1 ||
		input.index === input.total ||
		input.index % 10 === 0
	) {
		console.error(
			`[external-signal-sync] Project brief ${input.index}/${input.total} ${JSON.stringify(
				{
					writeScope: input.writeScope,
					projectRefreshOffset: input.projectRefreshOffset,
					projectRefreshLimit: input.projectRefreshLimit,
					projectTitle: input.projectTitle,
					pageId: input.pageId,
				},
			)}`,
		);
	}
}

async function withProgressHeartbeat<T>(
	live: boolean,
	stage: string,
	work: () => Promise<T>,
): Promise<T> {
	if (!shouldLogProgress(live)) {
		return work();
	}
	const startedAt = Date.now();
	const heartbeat = setInterval(() => {
		console.error(
			`[external-signal-sync] ${stage} still running (${Math.round(
				(Date.now() - startedAt) / 1000,
			)}s)`,
		);
	}, PROGRESS_HEARTBEAT_MS);
	try {
		return await work();
	} finally {
		clearInterval(heartbeat);
	}
}

async function fetchPagesWithProgress(
	live: boolean,
	label: string,
	client: Parameters<typeof fetchAllPages>[0],
	dataSourceId: string,
	titlePropertyName: string,
): Promise<Awaited<ReturnType<typeof fetchAllPages>>> {
	const startedAt = Date.now();
	const pages = await fetchAllPages(client, dataSourceId, titlePropertyName);
	logLiveStage(live, `Fetched ${label}`, {
		pageCount: pages.length,
		durationSeconds: Math.round((Date.now() - startedAt) / 1000),
	});
	return pages;
}

async function fetchRecentExternalSignalEventPagesWithProgress(
	live: boolean,
	client: Parameters<typeof fetchAllPages>[0],
	dataSourceId: string,
	titlePropertyName: string,
	projectIds: string[],
): Promise<Awaited<ReturnType<typeof fetchAllPages>>> {
	const startedAt = Date.now();
	const result = await fetchRecentExternalSignalEventPagesByProject({
		client,
		dataSourceId,
		titlePropertyName,
		projectIds,
	});
	logLiveStage(live, "Fetched recent external events", {
		pageCount: result.pages.length,
		projectCount: projectIds.length,
		mode: result.mode,
		durationSeconds: Math.round((Date.now() - startedAt) / 1000),
		...(result.fallbackError ? { fallbackError: result.fallbackError } : {}),
	});
	return result.pages;
}

/**
 * P3: an event is assumed already-synced (no Notion query needed) when its
 * provider+source watermark has already advanced past its `occurredAt`.
 * Strict `<` only — `occurredAt` is day-granularity, so same-day events
 * still go through the real query rather than risk a false "already synced".
 */
function isCoveredByWatermark(
	event: NormalizedSignalEvent,
	watermarks: SignalWatermark[],
): boolean {
	const watermark = getSignalWatermark(
		watermarks,
		event.provider,
		event.sourceId,
	);
	return Boolean(watermark) && event.occurredAt < watermark!.lastOccurredAt;
}

export async function filterProviderResultsAgainstExistingEventKeys(input: {
	api: Parameters<typeof fetchAllPages>[0];
	dataSourceId: string;
	titlePropertyName: string;
	providerResults: ProviderSyncResult[];
	today: string;
	live?: boolean;
	watermarks?: SignalWatermark[];
}): Promise<ProviderSyncResult[]> {
	const watermarks = input.watermarks ?? [];
	const allEvents = input.providerResults.flatMap((result) => result.events);
	// P4: identity-mode events (Vercel) need a richer existing-row lookup
	// (page id + current status) so a status change can become an upsert
	// instead of either a silent duplicate-append or a silent drop.
	const standardEvents = allEvents.filter(
		(event) => event.dedupMode !== "identity",
	);
	const identityEvents = allEvents.filter(
		(event) => event.dedupMode === "identity",
	);

	const watermarkCoveredKeys = new Set(
		standardEvents
			.filter((event) => isCoveredByWatermark(event, watermarks))
			.map((event) => event.eventKey),
	);
	const standardKeysToQuery = [
		...new Set(
			standardEvents
				.filter((event) => !watermarkCoveredKeys.has(event.eventKey))
				.map((event) => event.eventKey)
				.filter(Boolean),
		),
	];
	const identityKeysToQuery = [
		...new Set(identityEvents.map((event) => event.eventKey).filter(Boolean)),
	];

	if (standardKeysToQuery.length === 0 && identityKeysToQuery.length === 0) {
		logLiveStage(input.live ?? false, "Provider event-key dedupe skipped", {
			candidateEventKeys: 0,
			watermarkCoveredKeys: watermarkCoveredKeys.size,
		});
		if (watermarkCoveredKeys.size === 0) {
			return input.providerResults;
		}
	}

	const [existingStandard, existingIdentity] = await Promise.all([
		standardKeysToQuery.length > 0
			? fetchExistingExternalSignalEventKeys({
					client: input.api,
					dataSourceId: input.dataSourceId,
					titlePropertyName: input.titlePropertyName,
					eventKeys: standardKeysToQuery,
				})
			: Promise.resolve({
					eventKeys: new Set<string>(),
					mode: "event_key_filter" as const,
				}),
		identityKeysToQuery.length > 0
			? fetchExistingExternalSignalEventsByKey({
					client: input.api,
					dataSourceId: input.dataSourceId,
					titlePropertyName: input.titlePropertyName,
					eventKeys: identityKeysToQuery,
				})
			: Promise.resolve({
					events: new Map<string, { pageId: string; status: string }>(),
					mode: "event_key_filter" as const,
				}),
	]);

	let duplicateCount = 0;
	let updateCount = 0;
	const providerResults = input.providerResults.map((result) => {
		const events: NormalizedSignalEvent[] = [];
		const updates: Array<{ event: NormalizedSignalEvent; pageId: string }> = [];
		let duplicatesInResult = 0;
		let updatesInResult = 0;

		for (const event of result.events) {
			if (event.dedupMode === "identity") {
				const existing = existingIdentity.events.get(event.eventKey);
				if (!existing) {
					events.push(event);
				} else if (existing.status !== event.status) {
					updates.push({ event, pageId: existing.pageId });
					updatesInResult += 1;
				} else {
					duplicatesInResult += 1;
				}
				continue;
			}
			const alreadySynced =
				watermarkCoveredKeys.has(event.eventKey) ||
				existingStandard.eventKeys.has(event.eventKey);
			if (alreadySynced) {
				duplicatesInResult += 1;
				continue;
			}
			events.push(event);
		}

		duplicateCount += duplicatesInResult;
		updateCount += updatesInResult;

		const notes = [...result.notes];
		if (duplicatesInResult > 0) {
			notes.push(
				`${duplicatesInResult} event(s) skipped: event key already exists in Notion.`,
			);
		}
		if (updatesInResult > 0) {
			notes.push(
				`${updatesInResult} event(s) updated: status changed on existing row.`,
			);
		}

		return {
			...result,
			status: deriveProviderResultStatus(result.failures, events.length),
			itemsWritten: events.length,
			itemsDeduped: result.itemsDeduped + duplicatesInResult,
			updates: updates.length > 0 ? updates : undefined,
			cursor: events.length > 0 ? newestOccurredAt(events) : input.today,
			events,
			notes,
		};
	});
	logLiveStage(input.live ?? false, "Provider event-key dedupe complete", {
		candidateEventKeys: standardKeysToQuery.length + identityKeysToQuery.length,
		existingEventKeys:
			existingStandard.eventKeys.size + existingIdentity.events.size,
		duplicateEvents: duplicateCount,
		updatedEvents: updateCount,
		watermarkCoveredKeys: watermarkCoveredKeys.size,
		mode: existingStandard.mode,
		...("fallbackError" in existingStandard && existingStandard.fallbackError
			? { fallbackError: existingStandard.fallbackError }
			: {}),
	});
	return providerResults;
}

function deriveProviderResultStatus(
	failures: number,
	eventCount: number,
): ProviderSyncResult["status"] {
	if (failures > 0 && eventCount > 0) {
		return "Partial";
	}
	if (failures > 0) {
		return "Failed";
	}
	return "Succeeded";
}

function shouldLogProgress(live: boolean): boolean {
	return live || process.env.NOTION_WEEKLY_PROGRESS === "1";
}

export function validateExternalSignalSyncOptions(
	options: ExternalSignalSyncCommandOptions & {
		writeScope: ExternalSignalSyncWriteScope;
	},
): void {
	if (options.projectLimit !== undefined) {
		assertPositiveInteger(options.projectLimit, "--project-limit");
	}
	if (options.projectOffset !== undefined) {
		assertNonNegativeInteger(options.projectOffset, "--project-offset");
	}
	if (options.projectConcurrency !== undefined) {
		assertPositiveInteger(options.projectConcurrency, "--project-concurrency");
	}
	if (
		options.writeScope !== "project-pages" &&
		(options.projectLimit !== undefined || options.projectOffset !== undefined)
	) {
		throw new AppError(
			"--project-limit and --project-offset require --write-scope project-pages",
		);
	}
}

export function deriveExternalSignalSyncWritePlan(
	options: ExternalSignalSyncCommandOptions = {},
): ExternalSignalSyncWritePlan {
	const writeScope = options.writeScope ?? "full";
	validateExternalSignalSyncOptions({ ...options, writeScope });
	return {
		writeScope,
		shouldRunProviders: writeScope === "full" || writeScope === "providers",
		shouldEvaluateProjectPages:
			writeScope === "full" || writeScope === "project-pages",
		shouldEvaluatePortfolioSections:
			writeScope === "full" || writeScope === "portfolio-sections",
		shouldPersistMetrics:
			writeScope === "full" || writeScope === "portfolio-sections",
	};
}

function assertPositiveInteger(value: number, flag: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new AppError(`${flag} must be a positive integer`);
	}
}

function assertNonNegativeInteger(value: number, flag: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new AppError(`${flag} must be a non-negative integer`);
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

export async function syncExternalSignalProjectBrief(input: {
	api: DirectNotionClient;
	pageId: string;
	projectTitle?: string;
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
		throw new AppError(
			"External signal project brief did not converge after write",
			{
				pageId: input.pageId,
				projectTitle: input.projectTitle,
			},
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
	await syncManagedMarkdownSectionWithReadBack({
		api: input.api,
		pageId: input.pageId,
		previousMarkdown: input.currentMarkdown,
		nextMarkdown: input.nextMarkdown,
		startMarker: input.startMarker,
		endMarker: input.endMarker,
	});
	return (await input.api.readPageMarkdown(input.pageId)).markdown;
}

export async function syncExternalSignalCommandCenterMarkdown(input: {
	api: DirectNotionClient;
	pageId: string;
	previousMarkdown: string;
	nextMarkdown: string;
}): Promise<string> {
	let currentMarkdown = input.previousMarkdown;
	for (const section of [
		{
			startMarker: INTELLIGENCE_COMMAND_CENTER_START,
			endMarker: INTELLIGENCE_COMMAND_CENTER_END,
		},
		{
			startMarker: EXTERNAL_SIGNAL_COMMAND_CENTER_START,
			endMarker: EXTERNAL_SIGNAL_COMMAND_CENTER_END,
		},
	]) {
		const nextSection = extractManagedSection(
			input.nextMarkdown,
			section.startMarker,
			section.endMarker,
		);
		if (!nextSection) {
			continue;
		}
		const nextMarkdownForSection = mergeManagedSection(
			currentMarkdown,
			nextSection,
			section.startMarker,
			section.endMarker,
		);
		if (
			normalizeMarkdown(currentMarkdown) ===
			normalizeMarkdown(nextMarkdownForSection)
		) {
			continue;
		}
		await syncManagedMarkdownSectionWithReadBack({
			api: input.api,
			pageId: input.pageId,
			previousMarkdown: currentMarkdown,
			nextMarkdown: nextMarkdownForSection,
			startMarker: section.startMarker,
			endMarker: section.endMarker,
			maxAttempts: 1,
			patchMaxAttempts: 1,
		});
		currentMarkdown = (await input.api.readPageMarkdown(input.pageId)).markdown;
	}
	return currentMarkdown;
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

function mergeExternalSignalWarningCategories(
	left:
		| Array<
				| "partial_success"
				| "missing_credentials"
				| "unsupported_provider"
				| "validation_gap"
		  >
		| undefined,
	right:
		| Array<
				| "partial_success"
				| "missing_credentials"
				| "unsupported_provider"
				| "validation_gap"
		  >
		| undefined,
):
	| Array<
			| "partial_success"
			| "missing_credentials"
			| "unsupported_provider"
			| "validation_gap"
	  >
	| undefined {
	const merged = new Set([...(left ?? []), ...(right ?? [])]);
	return merged.size > 0 ? [...merged] : undefined;
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
	watermarks?: SignalWatermark[];
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
					input.watermarks ?? [],
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
	"d",
	"memories",
]);
const PROJECT_RESOLVER_ALIASES = new Map([
	["mail", "personal ops"],
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
	watermarks: SignalWatermark[] = [],
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
	const watermark = getSignalWatermark(
		watermarks,
		"Notification Hub",
		source.id,
	);
	const events: NormalizedSignalEvent[] = [];
	let itemsSeen = 0;
	let itemsDeduped = 0;
	let missingProject = 0;
	let unmatchedProject = 0;
	let ignoredOperationalProject = 0;
	const unmatchedProjectNames = new Set<string>();
	const ignoredProjectNames = new Set<string>();
	// P3: advances past every raw line this run actually looked at (written,
	// deduped, or skipped for a data reason) — not just the ones that became
	// events. Otherwise a source stuck at "unmatched project" forever would
	// pin the watermark and get re-scanned from the same point every run.
	let newestConsideredEventId: string | undefined = watermark?.lastEventId;
	let newestConsideredOccurredAt: string | undefined =
		watermark?.lastOccurredAt;

	try {
		// Reads forward from the watermark instead of a fixed tail window — a
		// burst larger than maxEventsPerSource now queues for the next run
		// instead of silently falling off the back of a truncated window (P3).
		const candidates = await readNotificationHubJsonl(
			logPath,
			watermark?.lastEventId,
		);

		for (const raw of candidates) {
			itemsSeen += 1;
			newestConsideredEventId = raw.event_id;
			newestConsideredOccurredAt = formatExternalDate(
				raw.received_at || raw.timestamp,
			);
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
		nextWatermark:
			itemsSeen > 0 && newestConsideredEventId && newestConsideredOccurredAt
				? {
						provider: "Notification Hub",
						sourceId: source.id,
						lastEventId: newestConsideredEventId,
						lastOccurredAt: newestConsideredOccurredAt,
					}
				: undefined,
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

/**
 * P3: reads the JSONL log forward from `sinceEventId` (exclusive) instead of
 * returning only a fixed-size tail window. Local-file scans are cheap, so
 * the read itself is unbounded; the caller (`syncNotificationHubSources`)
 * is what caps how many of the returned events become writes this run —
 * a burst larger than that cap now queues for the next run via the
 * persisted watermark instead of falling off the back of a truncated
 * window and vanishing.
 */
async function readNotificationHubJsonl(
	logPath: string,
	sinceEventId?: string,
): Promise<NotificationHubEvent[]> {
	const allEvents: NotificationHubEvent[] = [];
	const eventsSinceWatermark: NotificationHubEvent[] = [];
	const stream = createReadStream(logPath, { encoding: "utf8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });
	let watermarkFound = !sinceEventId;

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (!isNotificationHubEvent(parsed)) {
				continue;
			}
			allEvents.push(parsed);
			if (!watermarkFound) {
				if (parsed.event_id === sinceEventId) {
					watermarkFound = true;
				}
				continue;
			}
			eventsSinceWatermark.push(parsed);
		} catch {
			// Skip malformed lines silently
		}
	}

	// Fail open: if the watermark's event id is no longer in the log (e.g.
	// the log was rotated externally), re-scan from the start instead of
	// silently returning nothing on every future run.
	return sinceEventId && !watermarkFound ? allEvents : eventsSinceWatermark;
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
		const localProjectId =
			resolveProjectId(fullName) ?? resolveProjectId(repoName);
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
			// P4: identity key deliberately excludes `status` — one deployment
			// keeps one row across its BUILDING -> READY -> ... lifecycle instead
			// of a new row per status transition. Status changes are handled as
			// updates in filterProviderResultsAgainstExistingEventKeys, not as new
			// events.
			const eventKey = buildEventKey([
				"vercel",
				"deployment",
				source.identifier,
				String(deployment.uid ?? deployment.id ?? ""),
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
				dedupMode: "identity",
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

/**
 * P4: patches an existing identity-keyed event row (e.g. a Vercel
 * deployment) in place after a status change, instead of appending a new
 * row for the same underlying deployment. Patches every status-derived
 * property the create path writes — Status, Occurred At, Severity, Summary,
 * Raw Excerpt (encodes readyState and would otherwise contradict Status
 * forever), Source URL, and the Sync Run relation (audit trail must point
 * at the run that landed the latest status, not the creating run).
 */
export async function updateSignalEventPage(input: {
	api: Pick<DirectNotionClient, "updatePageProperties">;
	pageId: string;
	event: NormalizedSignalEvent;
	syncRunId: string;
}): Promise<void> {
	await input.api.updatePageProperties({
		pageId: input.pageId,
		properties: {
			Status: richTextValue(input.event.status),
			"Occurred At": { date: { start: input.event.occurredAt } },
			Severity: selectPropertyValue(input.event.severity),
			Summary: richTextValue(input.event.summary),
			"Raw Excerpt": richTextValue(input.event.rawExcerpt),
			"Source URL": input.event.sourceUrl
				? { url: input.event.sourceUrl }
				: { url: null },
			"Sync Run": relationValue([input.syncRunId]),
		},
	});
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

export function selectProjectRefreshBatch<
	T extends { id: string; title: string },
>(input: { projects: T[]; limit?: number; offset?: number }): T[] {
	const offset = input.offset ?? 0;
	const sorted = [...input.projects].sort(
		(left, right) =>
			normalizeProjectSortKey(left.title).localeCompare(
				normalizeProjectSortKey(right.title),
			) || left.id.localeCompare(right.id),
	);
	return input.limit === undefined
		? sorted.slice(offset)
		: sorted.slice(offset, offset + input.limit);
}

function normalizeProjectSortKey(value: string): string {
	return value.trim().toLowerCase();
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
		case "Personal Ops":
			return "personal_ops";
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
