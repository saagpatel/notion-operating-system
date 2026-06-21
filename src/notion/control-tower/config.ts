// Configuration loading + parsing for the local-portfolio control tower.
// Extracted from local-portfolio-control-tower.ts (T3-4): the load/save/parse
// entry points, the ~60 parse* helpers, and the shared validation primitives.
// Re-exported from the parent module so its public API is unchanged.

import { loadRuntimeConfig } from "../../config/runtime-config.js";
import { AppError } from "../../utils/errors.js";
import { readJsonFile, writeJsonFile } from "../../utils/files.js";
import {
	extractNotionIdFromUrl,
	normalizeNotionId,
} from "../../utils/notion-id.js";
import type {
	ControlTowerMetrics,
	LocalPortfolioControlTowerConfig,
	OperatingQueue,
} from "./types.js";

const OPERATING_QUEUE_LIST: OperatingQueue[] = [
	"Shipped",
	"Needs Review",
	"Needs Decision",
	"Worth Finishing",
	"Resume Now",
	"Cold Storage",
	"Watch",
];

const OPERATING_QUEUES = new Set<OperatingQueue>(OPERATING_QUEUE_LIST);

export async function loadLocalPortfolioControlTowerConfig(
	filePath = loadRuntimeConfig().paths.controlTowerConfigPath,
): Promise<LocalPortfolioControlTowerConfig> {
	const raw = await readJsonFile<unknown>(filePath);
	return parseLocalPortfolioControlTowerConfig(raw);
}

export async function saveLocalPortfolioControlTowerConfig(
	config: LocalPortfolioControlTowerConfig,
	filePath = loadRuntimeConfig().paths.controlTowerConfigPath,
): Promise<void> {
	await writeJsonFile(filePath, config);
}

export function parseLocalPortfolioControlTowerConfig(
	raw: unknown,
): LocalPortfolioControlTowerConfig {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio control tower config must be an object",
		);
	}

	const config = raw as Record<string, unknown>;
	if (config.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio control tower config version "${String(config.version)}"`,
		);
	}

	const database = parseDatabase(config.database);
	const relatedDataSources = parseRelatedDataSources(config.relatedDataSources);
	const destinations = parseDestinations(config.destinations);
	const commandCenter = parseCommandCenter(config.commandCenter);
	const fieldOwnership = parseFieldOwnership(config.fieldOwnership);
	const reviewCadenceDays = parsePositiveNumberMap(
		config.reviewCadenceDays,
		"reviewCadenceDays",
	);
	const freshnessWindows = parseFreshnessWindows(config.freshnessWindows);
	const queuePrecedence = parseQueuePrecedence(config.queuePrecedence);
	const viewIds = parseViewIds(config.viewIds);
	const phase2Execution = config.phase2Execution
		? parsePhase2Execution(config.phase2Execution)
		: undefined;
	const phase3Intelligence = config.phase3Intelligence
		? parsePhase3Intelligence(config.phase3Intelligence)
		: undefined;
	const phase4Native = config.phase4Native
		? parsePhase4Native(config.phase4Native)
		: undefined;
	const phase5ExternalSignals = config.phase5ExternalSignals
		? parsePhase5ExternalSignals(config.phase5ExternalSignals)
		: undefined;
	const phase6Governance = config.phase6Governance
		? parsePhase6Governance(config.phase6Governance)
		: undefined;
	const phase7Actuation = config.phase7Actuation
		? parsePhase7Actuation(config.phase7Actuation)
		: undefined;
	const phase8GithubDeepening = config.phase8GithubDeepening
		? parsePhase8GithubDeepening(config.phase8GithubDeepening)
		: undefined;
	const phaseState = parsePhaseState(config.phaseState);
	const weeklyMaintenance = config.weeklyMaintenance
		? parseWeeklyMaintenance(config.weeklyMaintenance)
		: undefined;

	return {
		version: 1,
		database,
		relatedDataSources,
		destinations,
		commandCenter,
		fieldOwnership,
		reviewCadenceDays,
		freshnessWindows,
		queuePrecedence,
		viewIds,
		phase2Execution,
		phase3Intelligence,
		phase4Native,
		phase5ExternalSignals,
		phase6Governance,
		phase7Actuation,
		phase8GithubDeepening,
		phaseState,
		weeklyMaintenance,
	};
}

function parseDatabase(
	raw: unknown,
): LocalPortfolioControlTowerConfig["database"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing database");
	}
	const value = raw as Record<string, unknown>;
	const databaseUrl = requiredString(value.databaseUrl, "database.databaseUrl");
	const databaseId = normalizeRequiredNotionId(
		requiredString(value.databaseId, "database.databaseId"),
		"database.databaseId",
	);
	const extractedId = extractNotionIdFromUrl(databaseUrl);
	if (!extractedId || normalizeNotionId(extractedId) !== databaseId) {
		throw new AppError(
			"database.databaseId does not match database.databaseUrl",
		);
	}

	return {
		name: requiredString(value.name, "database.name"),
		databaseUrl,
		databaseId,
		dataSourceId: normalizeRequiredNotionId(
			requiredString(value.dataSourceId, "database.dataSourceId"),
			"database.dataSourceId",
		),
		destinationAlias: requiredString(
			value.destinationAlias,
			"database.destinationAlias",
		),
	};
}

function parseRelatedDataSources(
	raw: unknown,
): LocalPortfolioControlTowerConfig["relatedDataSources"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing relatedDataSources");
	}
	const value = raw as Record<string, unknown>;
	return {
		buildLogId: normalizeRequiredNotionId(
			requiredString(value.buildLogId, "relatedDataSources.buildLogId"),
			"relatedDataSources.buildLogId",
		),
		weeklyReviewsId: normalizeRequiredNotionId(
			requiredString(
				value.weeklyReviewsId,
				"relatedDataSources.weeklyReviewsId",
			),
			"relatedDataSources.weeklyReviewsId",
		),
		researchId: normalizeRequiredNotionId(
			requiredString(value.researchId, "relatedDataSources.researchId"),
			"relatedDataSources.researchId",
		),
		skillsId: normalizeRequiredNotionId(
			requiredString(value.skillsId, "relatedDataSources.skillsId"),
			"relatedDataSources.skillsId",
		),
		toolsId: normalizeRequiredNotionId(
			requiredString(value.toolsId, "relatedDataSources.toolsId"),
			"relatedDataSources.toolsId",
		),
	};
}

function parseDestinations(
	raw: unknown,
): LocalPortfolioControlTowerConfig["destinations"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing destinations");
	}
	const value = raw as Record<string, unknown>;
	return {
		commandCenterAlias: requiredString(
			value.commandCenterAlias,
			"destinations.commandCenterAlias",
		),
		weeklyReviewAlias: requiredString(
			value.weeklyReviewAlias,
			"destinations.weeklyReviewAlias",
		),
		buildLogAlias: requiredString(
			value.buildLogAlias,
			"destinations.buildLogAlias",
		),
	};
}

function parseCommandCenter(
	raw: unknown,
): LocalPortfolioControlTowerConfig["commandCenter"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing commandCenter");
	}
	const value = raw as Record<string, unknown>;
	const pageUrl = optionalString(value.pageUrl, "commandCenter.pageUrl");
	const pageId = optionalNotionId(value.pageId, "commandCenter.pageId");
	if (pageUrl && pageId) {
		const extractedId = extractNotionIdFromUrl(pageUrl);
		if (!extractedId || normalizeNotionId(extractedId) !== pageId) {
			throw new AppError(
				"commandCenter.pageId does not match commandCenter.pageUrl",
			);
		}
	}

	return {
		title: requiredString(value.title, "commandCenter.title"),
		parentPageUrl: requiredString(
			value.parentPageUrl,
			"commandCenter.parentPageUrl",
		),
		pageUrl,
		pageId,
	};
}

function parseFieldOwnership(
	raw: unknown,
): LocalPortfolioControlTowerConfig["fieldOwnership"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing fieldOwnership");
	}
	const value = raw as Record<string, unknown>;
	return {
		manual: requiredStringArray(value.manual, "fieldOwnership.manual"),
		derived: requiredStringArray(value.derived, "fieldOwnership.derived"),
		legacyHidden: requiredStringArray(
			value.legacyHidden,
			"fieldOwnership.legacyHidden",
		),
		hideLegacyInPrimaryViews: requiredBoolean(
			value.hideLegacyInPrimaryViews,
			"fieldOwnership.hideLegacyInPrimaryViews",
		),
	};
}

function parseFreshnessWindows(
	raw: unknown,
): LocalPortfolioControlTowerConfig["freshnessWindows"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing freshnessWindows");
	}
	const value = raw as Record<string, unknown>;
	return {
		freshMaxDays: requiredPositiveNumber(
			value.freshMaxDays,
			"freshnessWindows.freshMaxDays",
		),
		agingMaxDays: requiredPositiveNumber(
			value.agingMaxDays,
			"freshnessWindows.agingMaxDays",
		),
	};
}

function parseQueuePrecedence(raw: unknown): OperatingQueue[] {
	const values = requiredStringArray(raw, "queuePrecedence");
	const unique = new Set<OperatingQueue>();
	const normalized = values.map((value) => {
		if (!OPERATING_QUEUES.has(value as OperatingQueue)) {
			throw new AppError(`Unsupported queuePrecedence value "${value}"`);
		}
		const queue = value as OperatingQueue;
		unique.add(queue);
		return queue;
	});
	if (unique.size !== OPERATING_QUEUE_LIST.length) {
		throw new AppError(
			"queuePrecedence must list each operating queue exactly once",
		);
	}
	return normalized;
}

function parseViewIds(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing viewIds");
	}
	const value = raw as Record<string, unknown>;
	return Object.fromEntries(
		Object.entries(value).map(([name, viewId]) => [
			name,
			normalizeRequiredNotionId(
				requiredString(viewId, `viewIds.${name}`),
				`viewIds.${name}`,
			),
		]),
	);
}

function parsePhase2Execution(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase2Execution"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	return {
		defaultOwnerUserId: optionalNotionId(
			value.defaultOwnerUserId,
			"phase2Execution.defaultOwnerUserId",
		),
		decisions: parseExecutionDatabaseRef(
			value.decisions,
			"phase2Execution.decisions",
		),
		packets: parseExecutionDatabaseRef(
			value.packets,
			"phase2Execution.packets",
		),
		tasks: parseExecutionDatabaseRef(value.tasks, "phase2Execution.tasks"),
		executionBriefs: value.executionBriefs
			? parseExecutionDatabaseRef(
					value.executionBriefs,
					"phase2Execution.executionBriefs",
				)
			: undefined,
		wipRules: parseWipRules(value.wipRules),
		packetSizing: parsePacketSizing(value.packetSizing),
		decisionMateriality: parseDecisionMateriality(value.decisionMateriality),
		viewIds: parsePhase2ViewIds(value.viewIds),
		phaseMemory: parsePhaseMemory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase2Execution.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase2Execution.baselineMetrics",
		),
		lastSyncAt: optionalString(value.lastSyncAt, "phase2Execution.lastSyncAt"),
		lastSyncMetrics: optionalLooseMetrics(
			value.lastSyncMetrics,
			"phase2Execution.lastSyncMetrics",
		),
	};
}

function parseExecutionDatabaseRef(
	raw: unknown,
	fieldName: string,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase2Execution"]
>["decisions"] {
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
	const extractedId = extractNotionIdFromUrl(databaseUrl);
	if (!extractedId || normalizeNotionId(extractedId) !== databaseId) {
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

function parseWipRules(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase2Execution"]
>["wipRules"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution.wipRules must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		maxNowPackets: requiredPositiveNumber(
			value.maxNowPackets,
			"phase2Execution.wipRules.maxNowPackets",
		),
		maxStandbyPackets: requiredPositiveNumber(
			value.maxStandbyPackets,
			"phase2Execution.wipRules.maxStandbyPackets",
		),
	};
}

function parsePacketSizing(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase2Execution"]
>["packetSizing"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution.packetSizing must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		targetMinWorkingDays: requiredPositiveNumber(
			value.targetMinWorkingDays,
			"phase2Execution.packetSizing.targetMinWorkingDays",
		),
		targetMaxWorkingDays: requiredPositiveNumber(
			value.targetMaxWorkingDays,
			"phase2Execution.packetSizing.targetMaxWorkingDays",
		),
		allowedSizeOptions: requiredStringArray(
			value.allowedSizeOptions,
			"phase2Execution.packetSizing.allowedSizeOptions",
		),
	};
}

function parseDecisionMateriality(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase2Execution"]
>["decisionMateriality"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution.decisionMateriality must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		trackOnlyMaterialDecisions: requiredBoolean(
			value.trackOnlyMaterialDecisions,
			"phase2Execution.decisionMateriality.trackOnlyMaterialDecisions",
		),
		allowedTypes: requiredStringArray(
			value.allowedTypes,
			"phase2Execution.decisionMateriality.allowedTypes",
		),
	};
}

function parsePhase2ViewIds(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase2Execution"]>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		decisions: parseOptionalViewIdRecord(
			value.decisions,
			"phase2Execution.viewIds.decisions",
		),
		packets: parseOptionalViewIdRecord(
			value.packets,
			"phase2Execution.viewIds.packets",
		),
		tasks: parseOptionalViewIdRecord(
			value.tasks,
			"phase2Execution.viewIds.tasks",
		),
	};
}

function parseOptionalViewIdRecord(
	raw: unknown,
	fieldName: string,
): Record<string, string> {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	return Object.fromEntries(
		Object.entries(value).map(([name, viewId]) => [
			name,
			normalizeRequiredNotionId(
				requiredString(viewId, `${fieldName}.${name}`),
				`${fieldName}.${name}`,
			),
		]),
	);
}

function parsePhaseMemory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase2Execution"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase2Execution.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase2Execution.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase2Execution.phaseMemory.phase2Added",
		),
		phase3WillUse: requiredString(
			value.phase3WillUse,
			"phase2Execution.phaseMemory.phase3WillUse",
		),
		phase3Brief: requiredString(
			value.phase3Brief,
			"phase2Execution.phaseMemory.phase3Brief",
		),
	};
}

function parsePhaseState(
	raw: unknown,
): LocalPortfolioControlTowerConfig["phaseState"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("Control tower config is missing phaseState");
	}
	const value = raw as Record<string, unknown>;
	return {
		currentPhase: requiredPositiveNumber(
			value.currentPhase,
			"phaseState.currentPhase",
		),
		currentPhaseStatus: requiredString(
			value.currentPhaseStatus,
			"phaseState.currentPhaseStatus",
		),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phaseState.baselineCapturedAt",
		),
		baselineMetrics: optionalMetrics(
			value.baselineMetrics,
			"phaseState.baselineMetrics",
		),
		lastSyncAt: optionalString(value.lastSyncAt, "phaseState.lastSyncAt"),
		lastSyncMetrics: optionalMetrics(
			value.lastSyncMetrics,
			"phaseState.lastSyncMetrics",
		),
		lastClosedPhase:
			value.lastClosedPhase === undefined
				? undefined
				: requiredPositiveNumber(
						value.lastClosedPhase,
						"phaseState.lastClosedPhase",
					),
	};
}

function parseWeeklyMaintenance(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["weeklyMaintenance"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("weeklyMaintenance must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	const weeklyRefreshLastStatus = optionalString(
		value.weeklyRefreshLastStatus,
		"weeklyMaintenance.weeklyRefreshLastStatus",
	);
	if (
		weeklyRefreshLastStatus &&
		weeklyRefreshLastStatus !== "clean" &&
		weeklyRefreshLastStatus !== "completed" &&
		weeklyRefreshLastStatus !== "partial" &&
		weeklyRefreshLastStatus !== "failed"
	) {
		throw new AppError(
			"weeklyMaintenance.weeklyRefreshLastStatus must be clean, completed, partial, or failed",
		);
	}

	return {
		supportMaintenanceLastSyncAt: optionalString(
			value.supportMaintenanceLastSyncAt,
			"weeklyMaintenance.supportMaintenanceLastSyncAt",
		),
		weeklyRefreshLastRunAt: optionalString(
			value.weeklyRefreshLastRunAt,
			"weeklyMaintenance.weeklyRefreshLastRunAt",
		),
		weeklyRefreshLastStatus: weeklyRefreshLastStatus as
			| "clean"
			| "completed"
			| "partial"
			| "failed"
			| undefined,
		weeklyRefreshLastSummary: optionalLooseMetrics(
			value.weeklyRefreshLastSummary,
			"weeklyMaintenance.weeklyRefreshLastSummary",
		) as Record<string, number | string | boolean> | undefined,
		weeklyReviewLastPublishedAt: optionalString(
			value.weeklyReviewLastPublishedAt,
			"weeklyMaintenance.weeklyReviewLastPublishedAt",
		),
	};
}

function parsePhase5ExternalSignals(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase5ExternalSignals"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase5ExternalSignals must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	return {
		sources: parseExecutionDatabaseRef(
			value.sources,
			"phase5ExternalSignals.sources",
		),
		events: parseExecutionDatabaseRef(
			value.events,
			"phase5ExternalSignals.events",
		),
		syncRuns: parseExecutionDatabaseRef(
			value.syncRuns,
			"phase5ExternalSignals.syncRuns",
		),
		externalSignalBriefs: value.externalSignalBriefs
			? parseExecutionDatabaseRef(
					value.externalSignalBriefs,
					"phase5ExternalSignals.externalSignalBriefs",
				)
			: undefined,
		providerEnablement: parsePhase5ProviderEnablement(value.providerEnablement),
		pollingCadenceMinutes: parsePhase5PollingCadence(
			value.pollingCadenceMinutes,
		),
		syncLimits: parsePhase5SyncLimits(value.syncLimits),
		scoringModelVersion: requiredString(
			value.scoringModelVersion,
			"phase5ExternalSignals.scoringModelVersion",
		),
		viewIds: parsePhase5ViewIds(value.viewIds),
		phaseMemory: parsePhase5Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase5ExternalSignals.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase5ExternalSignals.baselineMetrics",
		),
		lastSyncAt: optionalString(
			value.lastSyncAt,
			"phase5ExternalSignals.lastSyncAt",
		),
		lastSyncMetrics: optionalLooseMetrics(
			value.lastSyncMetrics,
			"phase5ExternalSignals.lastSyncMetrics",
		),
	};
}

function parsePhase6Governance(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase6Governance"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	return {
		policies: parseExecutionDatabaseRef(
			value.policies,
			"phase6Governance.policies",
		),
		actionRequests: parseExecutionDatabaseRef(
			value.actionRequests,
			"phase6Governance.actionRequests",
		),
		webhookEndpoints: parseExecutionDatabaseRef(
			value.webhookEndpoints,
			"phase6Governance.webhookEndpoints",
		),
		webhookDeliveries: parseExecutionDatabaseRef(
			value.webhookDeliveries,
			"phase6Governance.webhookDeliveries",
		),
		webhookReceipts: parseExecutionDatabaseRef(
			value.webhookReceipts,
			"phase6Governance.webhookReceipts",
		),
		receiver: parsePhase6Receiver(value.receiver),
		identityPosture: parsePhase6IdentityPosture(
			value.identityPosture,
			"phase6Governance.identityPosture",
		),
		providerStatus: parsePhase6ProviderStatus(value.providerStatus),
		replayAndDedupe: parsePhase6ReplayAndDedupe(value.replayAndDedupe),
		approvalDefaults: parsePhase6ApprovalDefaults(value.approvalDefaults),
		envRefs: parsePhase6EnvRefs(value.envRefs),
		viewIds: parsePhase6ViewIds(value.viewIds),
		phaseMemory: parsePhase6Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase6Governance.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase6Governance.baselineMetrics",
		),
		lastAuditAt: optionalString(
			value.lastAuditAt,
			"phase6Governance.lastAuditAt",
		),
		lastAuditSummary: optionalLooseMetrics(
			value.lastAuditSummary,
			"phase6Governance.lastAuditSummary",
		),
	};
}

function parsePhase7Actuation(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase7Actuation"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation must be an object when provided");
	}
	const value = raw as Record<string, unknown>;
	return {
		executions: parseExecutionDatabaseRef(
			value.executions,
			"phase7Actuation.executions",
		),
		rolloutProfile: parsePhase7RolloutProfile(
			value.rolloutProfile,
			"phase7Actuation.rolloutProfile",
		),
		runnerLimits: parsePhase7RunnerLimits(value.runnerLimits),
		liveGating: parsePhase7LiveGating(value.liveGating),
		githubAuth: parsePhase7GitHubAuth(value.githubAuth),
		metricsRegistry: parsePhase7MetricsRegistry(value.metricsRegistry),
		viewIds: parsePhase7ViewIds(value.viewIds),
		phaseMemory: parsePhase7Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase7Actuation.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase7Actuation.baselineMetrics",
		),
		lastAuditAt: optionalString(
			value.lastAuditAt,
			"phase7Actuation.lastAuditAt",
		),
		lastAuditSummary: optionalLooseMetrics(
			value.lastAuditSummary,
			"phase7Actuation.lastAuditSummary",
		),
	};
}

function parsePhase8GithubDeepening(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase8GithubDeepening"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase8GithubDeepening must be an object when provided");
	}
	const value = raw as Record<string, unknown>;
	return {
		rolloutProfile: parsePhase8RolloutProfile(
			value.rolloutProfile,
			"phase8GithubDeepening.rolloutProfile",
		),
		actionFamilies: parsePhase8ActionFamilies(value.actionFamilies),
		writeSafety: parsePhase8WriteSafety(value.writeSafety),
		permissionPosture: parsePhase8PermissionPosture(value.permissionPosture),
		webhookFeedback: parsePhase8WebhookFeedback(value.webhookFeedback),
		metricsRegistry: parsePhase8MetricsRegistry(value.metricsRegistry),
		viewIds: parsePhase8ViewIds(value.viewIds),
		phaseMemory: parsePhase8Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase8GithubDeepening.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase8GithubDeepening.baselineMetrics",
		),
		lastAuditAt: optionalString(
			value.lastAuditAt,
			"phase8GithubDeepening.lastAuditAt",
		),
		lastAuditSummary: optionalLooseMetrics(
			value.lastAuditSummary,
			"phase8GithubDeepening.lastAuditSummary",
		),
	};
}

function parsePhase4Native(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase4Native"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	return {
		entitlements: parsePhase4Entitlements(value.entitlements),
		dashboardRegistry: parsePhase4DashboardRegistry(value.dashboardRegistry),
		automationRegistry: parsePhase4AutomationRegistry(value.automationRegistry),
		pilotRegistry: parsePhase4PilotRegistry(value.pilotRegistry),
		phaseMemory: parsePhase4Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase4Native.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase4Native.baselineMetrics",
		),
		lastAuditAt: optionalString(value.lastAuditAt, "phase4Native.lastAuditAt"),
		lastAuditSummary: optionalLooseMetrics(
			value.lastAuditSummary,
			"phase4Native.lastAuditSummary",
		),
	};
}

function parsePhase6Receiver(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["receiver"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.receiver must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		mode: parsePhase6ReceiverMode(value.mode, "phase6Governance.receiver.mode"),
		spoolDirectory: requiredString(
			value.spoolDirectory,
			"phase6Governance.receiver.spoolDirectory",
		),
		host: optionalString(value.host, "phase6Governance.receiver.host"),
		pathRegistry: parsePhase6PathRegistry(value.pathRegistry),
	};
}

function parsePhase6ReceiverMode(value: unknown, fieldName: string): "shadow" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "shadow") {
		throw new AppError(`${fieldName} must be "shadow"`);
	}
	return "shadow";
}

function parsePhase6PathRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["receiver"]["pathRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase6Governance.receiver.pathRegistry must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		github: requiredString(
			value.github,
			"phase6Governance.receiver.pathRegistry.github",
		),
		vercel: requiredString(
			value.vercel,
			"phase6Governance.receiver.pathRegistry.vercel",
		),
		googleCalendar: requiredString(
			value.googleCalendar,
			"phase6Governance.receiver.pathRegistry.googleCalendar",
		),
	};
}

function parsePhase6IdentityPosture(
	value: unknown,
	fieldName: string,
): "app_first_least_privilege" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "app_first_least_privilege") {
		throw new AppError(`${fieldName} must be "app_first_least_privilege"`);
	}
	return parsed;
}

function parsePhase6ProviderStatus(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["providerStatus"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.providerStatus must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		github: parsePhase6ProviderMode(
			value.github,
			"phase6Governance.providerStatus.github",
		),
		vercel: parsePhase6ProviderMode(
			value.vercel,
			"phase6Governance.providerStatus.vercel",
		),
		googleCalendar: parsePhase6ProviderMode(
			value.googleCalendar,
			"phase6Governance.providerStatus.googleCalendar",
		),
	};
}

function parsePhase6ReplayAndDedupe(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["replayAndDedupe"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.replayAndDedupe must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		github: parsePhase6ReplayRule(
			value.github,
			"phase6Governance.replayAndDedupe.github",
		),
		vercel: parsePhase6ReplayRule(
			value.vercel,
			"phase6Governance.replayAndDedupe.vercel",
		),
		googleCalendar: parsePhase6ReplayRule(
			value.googleCalendar,
			"phase6Governance.replayAndDedupe.googleCalendar",
		),
	};
}

function parsePhase6ReplayRule(
	raw: unknown,
	fieldName: string,
): { replayWindowMinutes: number; dedupeKey: string } {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	return {
		replayWindowMinutes: requiredPositiveNumber(
			value.replayWindowMinutes,
			`${fieldName}.replayWindowMinutes`,
		),
		dedupeKey: requiredString(value.dedupeKey, `${fieldName}.dedupeKey`),
	};
}

function parsePhase6ApprovalDefaults(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["approvalDefaults"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.approvalDefaults must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		read: parsePhase6ApprovalRule(
			value.read,
			"phase6Governance.approvalDefaults.read",
		),
		comment: parsePhase6ApprovalRule(
			value.comment,
			"phase6Governance.approvalDefaults.comment",
		),
		issue: parsePhase6ApprovalRule(
			value.issue,
			"phase6Governance.approvalDefaults.issue",
		),
		deploymentControl: parsePhase6ApprovalRule(
			value.deploymentControl,
			"phase6Governance.approvalDefaults.deploymentControl",
		),
	};
}

function parsePhase6EnvRefs(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["envRefs"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.envRefs must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		githubAppId: requiredString(
			value.githubAppId,
			"phase6Governance.envRefs.githubAppId",
		),
		githubAppPrivateKeyPem: requiredString(
			value.githubAppPrivateKeyPem,
			"phase6Governance.envRefs.githubAppPrivateKeyPem",
		),
		githubAppWebhookSecret: requiredString(
			value.githubAppWebhookSecret,
			"phase6Governance.envRefs.githubAppWebhookSecret",
		),
		vercelWebhookSecret: requiredString(
			value.vercelWebhookSecret,
			"phase6Governance.envRefs.vercelWebhookSecret",
		),
		breakGlassEnvVars: requiredStringArray(
			value.breakGlassEnvVars,
			"phase6Governance.envRefs.breakGlassEnvVars",
		),
	};
}

function parsePhase6ViewIds(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		policies: parseOptionalViewIdRecord(
			value.policies,
			"phase6Governance.viewIds.policies",
		),
		actionRequests: parseOptionalViewIdRecord(
			value.actionRequests,
			"phase6Governance.viewIds.actionRequests",
		),
		endpoints: parseOptionalViewIdRecord(
			value.endpoints,
			"phase6Governance.viewIds.endpoints",
		),
		deliveries: parseOptionalViewIdRecord(
			value.deliveries,
			"phase6Governance.viewIds.deliveries",
		),
		receipts: parseOptionalViewIdRecord(
			value.receipts,
			"phase6Governance.viewIds.receipts",
		),
	};
}

function parsePhase6Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase6Governance"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase6Governance.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase6Governance.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase6Governance.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase6Governance.phaseMemory.phase3Added",
		),
		phase4Added: requiredString(
			value.phase4Added,
			"phase6Governance.phaseMemory.phase4Added",
		),
		phase5Added: requiredString(
			value.phase5Added,
			"phase6Governance.phaseMemory.phase5Added",
		),
		phase6Added: requiredString(
			value.phase6Added,
			"phase6Governance.phaseMemory.phase6Added",
		),
		phase7Brief: requiredString(
			value.phase7Brief,
			"phase6Governance.phaseMemory.phase7Brief",
		),
	};
}

function parsePhase6ProviderMode(
	value: unknown,
	fieldName: string,
): "disabled" | "shadow" | "live" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "disabled" && parsed !== "shadow" && parsed !== "live") {
		throw new AppError(`${fieldName} must be disabled, shadow, or live`);
	}
	return parsed;
}

function parsePhase7RolloutProfile(
	value: unknown,
	fieldName: string,
): "github_first_issues_then_comments" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "github_first_issues_then_comments") {
		throw new AppError(
			`${fieldName} must be "github_first_issues_then_comments"`,
		);
	}
	return parsed;
}

function parsePhase7RunnerLimits(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase7Actuation"]
>["runnerLimits"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.runnerLimits must be an object");
	}
	const value = raw as Record<string, unknown>;
	const mode = requiredString(value.mode, "phase7Actuation.runnerLimits.mode");
	if (mode !== "serial") {
		throw new AppError('phase7Actuation.runnerLimits.mode must be "serial"');
	}
	return {
		mode,
		maxLivePerRun: requiredPositiveNumber(
			value.maxLivePerRun,
			"phase7Actuation.runnerLimits.maxLivePerRun",
		),
		maxDryRunsPerRun: requiredPositiveNumber(
			value.maxDryRunsPerRun,
			"phase7Actuation.runnerLimits.maxDryRunsPerRun",
		),
		minSecondsBetweenWrites: requiredPositiveNumber(
			value.minSecondsBetweenWrites,
			"phase7Actuation.runnerLimits.minSecondsBetweenWrites",
		),
	};
}

function parsePhase7LiveGating(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase7Actuation"]
>["liveGating"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.liveGating must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		requireApproval: requiredBoolean(
			value.requireApproval,
			"phase7Actuation.liveGating.requireApproval",
		),
		requireNonExpiredRequest: requiredBoolean(
			value.requireNonExpiredRequest,
			"phase7Actuation.liveGating.requireNonExpiredRequest",
		),
		requireActiveGitHubTarget: requiredBoolean(
			value.requireActiveGitHubTarget,
			"phase7Actuation.liveGating.requireActiveGitHubTarget",
		),
		requireFreshDryRunBeforeLive: requiredBoolean(
			value.requireFreshDryRunBeforeLive,
			"phase7Actuation.liveGating.requireFreshDryRunBeforeLive",
		),
		freshDryRunMaxAgeHours: requiredPositiveNumber(
			value.freshDryRunMaxAgeHours,
			"phase7Actuation.liveGating.freshDryRunMaxAgeHours",
		),
	};
}

function parsePhase7GitHubAuth(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase7Actuation"]
>["githubAuth"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.githubAuth must be an object");
	}
	const value = raw as Record<string, unknown>;
	const provider = requiredString(
		value.provider,
		"phase7Actuation.githubAuth.provider",
	);
	if (provider !== "GitHub App") {
		throw new AppError(
			'phase7Actuation.githubAuth.provider must be "GitHub App"',
		);
	}
	return {
		provider,
		tokenLifetimeMinutes: requiredPositiveNumber(
			value.tokenLifetimeMinutes,
			"phase7Actuation.githubAuth.tokenLifetimeMinutes",
		),
		mintPerRun: requiredBoolean(
			value.mintPerRun,
			"phase7Actuation.githubAuth.mintPerRun",
		),
	};
}

function parsePhase7MetricsRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase7Actuation"]
>["metricsRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.metricsRegistry must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		dryRunSuccessRate: requiredString(
			value.dryRunSuccessRate,
			"phase7Actuation.metricsRegistry.dryRunSuccessRate",
		),
		liveSuccessRate: requiredString(
			value.liveSuccessRate,
			"phase7Actuation.metricsRegistry.liveSuccessRate",
		),
		actuationFailureRate: requiredString(
			value.actuationFailureRate,
			"phase7Actuation.metricsRegistry.actuationFailureRate",
		),
		compensationNeededCount: requiredString(
			value.compensationNeededCount,
			"phase7Actuation.metricsRegistry.compensationNeededCount",
		),
		approvalToExecutionHours: requiredString(
			value.approvalToExecutionHours,
			"phase7Actuation.metricsRegistry.approvalToExecutionHours",
		),
	};
}

function parsePhase7ViewIds(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase7Actuation"]>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		actionRequests: parseOptionalViewIdRecord(
			value.actionRequests,
			"phase7Actuation.viewIds.actionRequests",
		),
		executions: parseOptionalViewIdRecord(
			value.executions,
			"phase7Actuation.viewIds.executions",
		),
		sources: parseOptionalViewIdRecord(
			value.sources,
			"phase7Actuation.viewIds.sources",
		),
	};
}

function parsePhase7Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase7Actuation"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase7Actuation.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase7Actuation.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase7Actuation.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase7Actuation.phaseMemory.phase3Added",
		),
		phase4Added: requiredString(
			value.phase4Added,
			"phase7Actuation.phaseMemory.phase4Added",
		),
		phase5Added: requiredString(
			value.phase5Added,
			"phase7Actuation.phaseMemory.phase5Added",
		),
		phase6Added: requiredString(
			value.phase6Added,
			"phase7Actuation.phaseMemory.phase6Added",
		),
		phase7Added: requiredString(
			value.phase7Added,
			"phase7Actuation.phaseMemory.phase7Added",
		),
		phase8Brief: requiredString(
			value.phase8Brief,
			"phase7Actuation.phaseMemory.phase8Brief",
		),
	};
}

function parsePhase8RolloutProfile(
	value: unknown,
	fieldName: string,
): "github_issue_lifecycle_then_pr_comments" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "github_issue_lifecycle_then_pr_comments") {
		throw new AppError(
			`${fieldName} must be "github_issue_lifecycle_then_pr_comments"`,
		);
	}
	return parsed;
}

function parsePhase8ActionFamilies(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["actionFamilies"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase8GithubDeepening.actionFamilies must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		createIssue: requiredBoolean(
			value.createIssue,
			"phase8GithubDeepening.actionFamilies.createIssue",
		),
		updateIssue: requiredBoolean(
			value.updateIssue,
			"phase8GithubDeepening.actionFamilies.updateIssue",
		),
		setLabels: requiredBoolean(
			value.setLabels,
			"phase8GithubDeepening.actionFamilies.setLabels",
		),
		setAssignees: requiredBoolean(
			value.setAssignees,
			"phase8GithubDeepening.actionFamilies.setAssignees",
		),
		addIssueComment: requiredBoolean(
			value.addIssueComment,
			"phase8GithubDeepening.actionFamilies.addIssueComment",
		),
		commentPullRequest: requiredBoolean(
			value.commentPullRequest,
			"phase8GithubDeepening.actionFamilies.commentPullRequest",
		),
	};
}

function parsePhase8WriteSafety(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["writeSafety"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase8GithubDeepening.writeSafety must be an object");
	}
	const value = raw as Record<string, unknown>;
	const mode = requiredString(
		value.mode,
		"phase8GithubDeepening.writeSafety.mode",
	);
	if (mode !== "serial") {
		throw new AppError(
			'phase8GithubDeepening.writeSafety.mode must be "serial"',
		);
	}
	return {
		mode,
		maxLivePerRun: requiredPositiveNumber(
			value.maxLivePerRun,
			"phase8GithubDeepening.writeSafety.maxLivePerRun",
		),
		maxDryRunsPerRun: requiredPositiveNumber(
			value.maxDryRunsPerRun,
			"phase8GithubDeepening.writeSafety.maxDryRunsPerRun",
		),
		minSecondsBetweenWrites: requiredPositiveNumber(
			value.minSecondsBetweenWrites,
			"phase8GithubDeepening.writeSafety.minSecondsBetweenWrites",
		),
	};
}

function parsePhase8PermissionPosture(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["permissionPosture"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase8GithubDeepening.permissionPosture must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	const issues = requiredString(
		value.issues,
		"phase8GithubDeepening.permissionPosture.issues",
	);
	const metadata = requiredString(
		value.metadata,
		"phase8GithubDeepening.permissionPosture.metadata",
	);
	const broaderRepositoryPermissions = requiredString(
		value.broaderRepositoryPermissions,
		"phase8GithubDeepening.permissionPosture.broaderRepositoryPermissions",
	);
	if (issues !== "read_write") {
		throw new AppError(
			'phase8GithubDeepening.permissionPosture.issues must be "read_write"',
		);
	}
	if (metadata !== "read_only") {
		throw new AppError(
			'phase8GithubDeepening.permissionPosture.metadata must be "read_only"',
		);
	}
	if (broaderRepositoryPermissions !== "disabled") {
		throw new AppError(
			'phase8GithubDeepening.permissionPosture.broaderRepositoryPermissions must be "disabled"',
		);
	}
	return {
		issues,
		metadata,
		broaderRepositoryPermissions,
	};
}

function parsePhase8WebhookFeedback(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["webhookFeedback"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase8GithubDeepening.webhookFeedback must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	const githubStatus = requiredString(
		value.githubStatus,
		"phase8GithubDeepening.webhookFeedback.githubStatus",
	);
	const reconcileMode = requiredString(
		value.reconcileMode,
		"phase8GithubDeepening.webhookFeedback.reconcileMode",
	);
	if (githubStatus !== "shadow" && githubStatus !== "trusted_feedback") {
		throw new AppError(
			'phase8GithubDeepening.webhookFeedback.githubStatus must be "shadow" or "trusted_feedback"',
		);
	}
	if (reconcileMode !== "execution_first") {
		throw new AppError(
			'phase8GithubDeepening.webhookFeedback.reconcileMode must be "execution_first"',
		);
	}
	return {
		githubStatus,
		subscribedEvents: requiredStringArray(
			value.subscribedEvents,
			"phase8GithubDeepening.webhookFeedback.subscribedEvents",
		),
		reconcileMode,
	};
}

function parsePhase8MetricsRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["metricsRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase8GithubDeepening.metricsRegistry must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		dryRunSuccessRate: requiredString(
			value.dryRunSuccessRate,
			"phase8GithubDeepening.metricsRegistry.dryRunSuccessRate",
		),
		liveSuccessRate: requiredString(
			value.liveSuccessRate,
			"phase8GithubDeepening.metricsRegistry.liveSuccessRate",
		),
		actuationFailureRate: requiredString(
			value.actuationFailureRate,
			"phase8GithubDeepening.metricsRegistry.actuationFailureRate",
		),
		compensationNeededCount: requiredString(
			value.compensationNeededCount,
			"phase8GithubDeepening.metricsRegistry.compensationNeededCount",
		),
		approvalToExecutionHours: requiredString(
			value.approvalToExecutionHours,
			"phase8GithubDeepening.metricsRegistry.approvalToExecutionHours",
		),
		reconcileConfirmationRate: requiredString(
			value.reconcileConfirmationRate,
			"phase8GithubDeepening.metricsRegistry.reconcileConfirmationRate",
		),
	};
}

function parsePhase8ViewIds(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase8GithubDeepening.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		actionRequests: parseOptionalViewIdRecord(
			value.actionRequests,
			"phase8GithubDeepening.viewIds.actionRequests",
		),
		executions: parseOptionalViewIdRecord(
			value.executions,
			"phase8GithubDeepening.viewIds.executions",
		),
		sources: parseOptionalViewIdRecord(
			value.sources,
			"phase8GithubDeepening.viewIds.sources",
		),
	};
}

function parsePhase8Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase8GithubDeepening"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase8GithubDeepening.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase8GithubDeepening.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase8GithubDeepening.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase8GithubDeepening.phaseMemory.phase3Added",
		),
		phase4Added: requiredString(
			value.phase4Added,
			"phase8GithubDeepening.phaseMemory.phase4Added",
		),
		phase5Added: requiredString(
			value.phase5Added,
			"phase8GithubDeepening.phaseMemory.phase5Added",
		),
		phase6Added: requiredString(
			value.phase6Added,
			"phase8GithubDeepening.phaseMemory.phase6Added",
		),
		phase7Added: requiredString(
			value.phase7Added,
			"phase8GithubDeepening.phaseMemory.phase7Added",
		),
		phase8Added: requiredString(
			value.phase8Added,
			"phase8GithubDeepening.phaseMemory.phase8Added",
		),
		phase9Brief: requiredString(
			value.phase9Brief,
			"phase8GithubDeepening.phaseMemory.phase9Brief",
		),
	};
}

function parsePhase6ApprovalRule(
	value: unknown,
	fieldName: string,
): "No Write" | "Single Approval" | "Dual Approval" | "Emergency" {
	const parsed = requiredString(value, fieldName);
	if (
		parsed !== "No Write" &&
		parsed !== "Single Approval" &&
		parsed !== "Dual Approval" &&
		parsed !== "Emergency"
	) {
		throw new AppError(
			`${fieldName} must be No Write, Single Approval, Dual Approval, or Emergency`,
		);
	}
	return parsed;
}

function parsePhase3Intelligence(
	raw: unknown,
): NonNullable<LocalPortfolioControlTowerConfig["phase3Intelligence"]> {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase3Intelligence must be an object when provided");
	}

	const value = raw as Record<string, unknown>;
	return {
		recommendationRuns: parseExecutionDatabaseRef(
			value.recommendationRuns,
			"phase3Intelligence.recommendationRuns",
		),
		linkSuggestions: parseExecutionDatabaseRef(
			value.linkSuggestions,
			"phase3Intelligence.linkSuggestions",
		),
		recommendationBriefs: value.recommendationBriefs
			? parseExecutionDatabaseRef(
					value.recommendationBriefs,
					"phase3Intelligence.recommendationBriefs",
				)
			: undefined,
		scoringModelVersion: requiredString(
			value.scoringModelVersion,
			"phase3Intelligence.scoringModelVersion",
		),
		cadence: parsePhase3Cadence(value.cadence),
		confidenceThresholds: parsePhase3ConfidenceThresholds(
			value.confidenceThresholds,
		),
		reviewRequirements: parsePhase3ReviewRequirements(value.reviewRequirements),
		viewIds: parsePhase3ViewIds(value.viewIds),
		phaseMemory: parsePhase3Memory(value.phaseMemory),
		baselineCapturedAt: optionalString(
			value.baselineCapturedAt,
			"phase3Intelligence.baselineCapturedAt",
		),
		baselineMetrics: optionalLooseMetrics(
			value.baselineMetrics,
			"phase3Intelligence.baselineMetrics",
		),
		lastSyncAt: optionalString(
			value.lastSyncAt,
			"phase3Intelligence.lastSyncAt",
		),
		lastSyncMetrics: optionalLooseMetrics(
			value.lastSyncMetrics,
			"phase3Intelligence.lastSyncMetrics",
		),
	};
}

function parsePhase3Cadence(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase3Intelligence"]
>["cadence"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase3Intelligence.cadence must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		weeklyCanonical: requiredBoolean(
			value.weeklyCanonical,
			"phase3Intelligence.cadence.weeklyCanonical",
		),
		dailyDrillDown: requiredBoolean(
			value.dailyDrillDown,
			"phase3Intelligence.cadence.dailyDrillDown",
		),
	};
}

function parsePhase3ConfidenceThresholds(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase3Intelligence"]
>["confidenceThresholds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase3Intelligence.confidenceThresholds must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		highSupportDensity: requiredNonNegativeNumber(
			value.highSupportDensity,
			"phase3Intelligence.confidenceThresholds.highSupportDensity",
		),
		suggestionMinimum: requiredNonNegativeNumber(
			value.suggestionMinimum,
			"phase3Intelligence.confidenceThresholds.suggestionMinimum",
		),
	};
}

function parsePhase3ReviewRequirements(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase3Intelligence"]
>["reviewRequirements"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase3Intelligence.reviewRequirements must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		weeklyRequiresHumanReview: requiredBoolean(
			value.weeklyRequiresHumanReview,
			"phase3Intelligence.reviewRequirements.weeklyRequiresHumanReview",
		),
	};
}

function parsePhase3ViewIds(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase3Intelligence"]
>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase3Intelligence.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		projects: parseOptionalViewIdRecord(
			value.projects,
			"phase3Intelligence.viewIds.projects",
		),
		recommendationRuns: parseOptionalViewIdRecord(
			value.recommendationRuns,
			"phase3Intelligence.viewIds.recommendationRuns",
		),
		linkSuggestions: parseOptionalViewIdRecord(
			value.linkSuggestions,
			"phase3Intelligence.viewIds.linkSuggestions",
		),
	};
}

function parsePhase3Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase3Intelligence"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase3Intelligence.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase3Intelligence.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase3Intelligence.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase3Intelligence.phaseMemory.phase3Added",
		),
		phase4Brief: requiredString(
			value.phase4Brief,
			"phase3Intelligence.phaseMemory.phase4Brief",
		),
		phase5Brief: requiredString(
			value.phase5Brief,
			"phase3Intelligence.phaseMemory.phase5Brief",
		),
	};
}

function parsePhase4Entitlements(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase4Native"]
>["entitlements"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native.entitlements must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		businessPlanRequired: requiredBoolean(
			value.businessPlanRequired,
			"phase4Native.entitlements.businessPlanRequired",
		),
		businessWorkspaceVerified: requiredBoolean(
			value.businessWorkspaceVerified,
			"phase4Native.entitlements.businessWorkspaceVerified",
		),
		customAgentsVisible: requiredBoolean(
			value.customAgentsVisible,
			"phase4Native.entitlements.customAgentsVisible",
		),
		syncedDatabasesVisible: requiredBoolean(
			value.syncedDatabasesVisible,
			"phase4Native.entitlements.syncedDatabasesVisible",
		),
		verifiedAt: optionalString(
			value.verifiedAt,
			"phase4Native.entitlements.verifiedAt",
		),
	};
}

function parsePhase5ProviderEnablement(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase5ExternalSignals"]
>["providerEnablement"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase5ExternalSignals.providerEnablement must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		github: requiredBoolean(
			value.github,
			"phase5ExternalSignals.providerEnablement.github",
		),
		vercel: requiredBoolean(
			value.vercel,
			"phase5ExternalSignals.providerEnablement.vercel",
		),
		googleCalendar: requiredBoolean(
			value.googleCalendar,
			"phase5ExternalSignals.providerEnablement.googleCalendar",
		),
	};
}

function parsePhase5PollingCadence(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase5ExternalSignals"]
>["pollingCadenceMinutes"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"phase5ExternalSignals.pollingCadenceMinutes must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	return {
		github: requiredPositiveNumber(
			value.github,
			"phase5ExternalSignals.pollingCadenceMinutes.github",
		),
		vercel: requiredPositiveNumber(
			value.vercel,
			"phase5ExternalSignals.pollingCadenceMinutes.vercel",
		),
		googleCalendar: requiredPositiveNumber(
			value.googleCalendar,
			"phase5ExternalSignals.pollingCadenceMinutes.googleCalendar",
		),
	};
}

function parsePhase5SyncLimits(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase5ExternalSignals"]
>["syncLimits"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase5ExternalSignals.syncLimits must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		maxProjectsInFirstWave: requiredPositiveNumber(
			value.maxProjectsInFirstWave,
			"phase5ExternalSignals.syncLimits.maxProjectsInFirstWave",
		),
		maxEventsPerSource: requiredPositiveNumber(
			value.maxEventsPerSource,
			"phase5ExternalSignals.syncLimits.maxEventsPerSource",
		),
	};
}

function parsePhase5ViewIds(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase5ExternalSignals"]
>["viewIds"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase5ExternalSignals.viewIds must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		sources: parseOptionalViewIdRecord(
			value.sources,
			"phase5ExternalSignals.viewIds.sources",
		),
		events: parseOptionalViewIdRecord(
			value.events,
			"phase5ExternalSignals.viewIds.events",
		),
		syncRuns: parseOptionalViewIdRecord(
			value.syncRuns,
			"phase5ExternalSignals.viewIds.syncRuns",
		),
		projects: parseOptionalViewIdRecord(
			value.projects,
			"phase5ExternalSignals.viewIds.projects",
		),
	};
}

function parsePhase5Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase5ExternalSignals"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase5ExternalSignals.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase5ExternalSignals.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase5ExternalSignals.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase5ExternalSignals.phaseMemory.phase3Added",
		),
		phase4Added: requiredString(
			value.phase4Added,
			"phase5ExternalSignals.phaseMemory.phase4Added",
		),
		phase5Added: requiredString(
			value.phase5Added,
			"phase5ExternalSignals.phaseMemory.phase5Added",
		),
		phase6Brief: requiredString(
			value.phase6Brief,
			"phase5ExternalSignals.phaseMemory.phase6Brief",
		),
		phase7Brief: requiredString(
			value.phase7Brief,
			"phase5ExternalSignals.phaseMemory.phase7Brief",
		),
	};
}

function parsePhase4DashboardRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase4Native"]
>["dashboardRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native.dashboardRegistry must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		portfolio: parsePhase4DashboardEntry(
			value.portfolio,
			"phase4Native.dashboardRegistry.portfolio",
			"projects",
		),
		execution: parsePhase4DashboardEntry(
			value.execution,
			"phase4Native.dashboardRegistry.execution",
			"tasks",
		),
	};
}

function parsePhase4DashboardEntry<K extends "projects" | "tasks">(
	raw: unknown,
	fieldName: string,
	databaseKey: K,
): K extends "projects"
	? NonNullable<
			LocalPortfolioControlTowerConfig["phase4Native"]
		>["dashboardRegistry"]["portfolio"]
	: NonNullable<
			LocalPortfolioControlTowerConfig["phase4Native"]
		>["dashboardRegistry"]["execution"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	const url = optionalString(value.url, `${fieldName}.url`);
	const viewId = optionalNotionId(value.viewId, `${fieldName}.viewId`);
	if (url && viewId) {
		const extractedId = extractDashboardViewIdFromUrl(url);
		if (!extractedId || normalizeNotionId(extractedId) !== viewId) {
			throw new AppError(`${fieldName}.viewId does not match ${fieldName}.url`);
		}
	}
	const parsedKey = requiredString(
		value.databaseKey,
		`${fieldName}.databaseKey`,
	);
	if (parsedKey !== databaseKey) {
		throw new AppError(`${fieldName}.databaseKey must be "${databaseKey}"`);
	}
	return {
		name: requiredString(value.name, `${fieldName}.name`),
		databaseKey,
		viewId,
		url,
		widgetCount: requiredNonNegativeNumber(
			value.widgetCount,
			`${fieldName}.widgetCount`,
		),
		status: parseNativeStatus(value.status, `${fieldName}.status`),
		notes: optionalString(value.notes, `${fieldName}.notes`),
	} as K extends "projects"
		? NonNullable<
				LocalPortfolioControlTowerConfig["phase4Native"]
			>["dashboardRegistry"]["portfolio"]
		: NonNullable<
				LocalPortfolioControlTowerConfig["phase4Native"]
			>["dashboardRegistry"]["execution"];
}

function parsePhase4AutomationRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase4Native"]
>["automationRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native.automationRegistry must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		projectReviewReminder: parsePhase4AutomationEntry(
			value.projectReviewReminder,
			"phase4Native.automationRegistry.projectReviewReminder",
			"projects",
		),
		decisionRevisitReminder: parsePhase4AutomationEntry(
			value.decisionRevisitReminder,
			"phase4Native.automationRegistry.decisionRevisitReminder",
			"decisions",
		),
		weeklyRunReviewReminder: parsePhase4AutomationEntry(
			value.weeklyRunReviewReminder,
			"phase4Native.automationRegistry.weeklyRunReviewReminder",
			"recommendationRuns",
		),
	};
}

function parsePhase4AutomationEntry<
	K extends "projects" | "decisions" | "recommendationRuns",
>(
	raw: unknown,
	fieldName: string,
	databaseKey: K,
): K extends "projects"
	? NonNullable<
			LocalPortfolioControlTowerConfig["phase4Native"]
		>["automationRegistry"]["projectReviewReminder"]
	: K extends "decisions"
		? NonNullable<
				LocalPortfolioControlTowerConfig["phase4Native"]
			>["automationRegistry"]["decisionRevisitReminder"]
		: NonNullable<
				LocalPortfolioControlTowerConfig["phase4Native"]
			>["automationRegistry"]["weeklyRunReviewReminder"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	const parsedKey = requiredString(
		value.databaseKey,
		`${fieldName}.databaseKey`,
	);
	if (parsedKey !== databaseKey) {
		throw new AppError(`${fieldName}.databaseKey must be "${databaseKey}"`);
	}
	return {
		name: requiredString(value.name, `${fieldName}.name`),
		databaseKey,
		nonCanonical: requiredBoolean(
			value.nonCanonical,
			`${fieldName}.nonCanonical`,
		),
		status: parseNativeStatus(value.status, `${fieldName}.status`),
		liveMethod: parseNativeLiveMethod(
			value.liveMethod,
			`${fieldName}.liveMethod`,
		),
		notes: optionalString(value.notes, `${fieldName}.notes`),
		deferReason: optionalString(value.deferReason, `${fieldName}.deferReason`),
	} as K extends "projects"
		? NonNullable<
				LocalPortfolioControlTowerConfig["phase4Native"]
			>["automationRegistry"]["projectReviewReminder"]
		: K extends "decisions"
			? NonNullable<
					LocalPortfolioControlTowerConfig["phase4Native"]
				>["automationRegistry"]["decisionRevisitReminder"]
			: NonNullable<
					LocalPortfolioControlTowerConfig["phase4Native"]
				>["automationRegistry"]["weeklyRunReviewReminder"];
}

function parsePhase4PilotRegistry(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase4Native"]
>["pilotRegistry"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native.pilotRegistry must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		githubDeliverySignals: parsePhase4PilotEntry(
			value.githubDeliverySignals,
			"phase4Native.pilotRegistry.githubDeliverySignals",
			false,
		) as NonNullable<
			LocalPortfolioControlTowerConfig["phase4Native"]
		>["pilotRegistry"]["githubDeliverySignals"],
		weeklyNativeSummaryDraft: parsePhase4PilotEntry(
			value.weeklyNativeSummaryDraft,
			"phase4Native.pilotRegistry.weeklyNativeSummaryDraft",
			true,
		) as NonNullable<
			LocalPortfolioControlTowerConfig["phase4Native"]
		>["pilotRegistry"]["weeklyNativeSummaryDraft"],
	};
}

function parsePhase4PilotEntry(
	raw: unknown,
	fieldName: string,
	requireDestinationAlias: boolean,
): Record<string, unknown> {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	const pageUrl = optionalString(value.pageUrl, `${fieldName}.pageUrl`);
	const pageId = optionalNotionId(value.pageId, `${fieldName}.pageId`);
	if (pageUrl && pageId) {
		const extractedId = extractNotionIdFromUrl(pageUrl);
		if (!extractedId || normalizeNotionId(extractedId) !== pageId) {
			throw new AppError(
				`${fieldName}.pageId does not match ${fieldName}.pageUrl`,
			);
		}
	}
	const result: Record<string, unknown> = {
		name: requiredString(value.name, `${fieldName}.name`),
		status: parseNativeStatus(value.status, `${fieldName}.status`),
		liveMethod: parseNativeLiveMethod(
			value.liveMethod,
			`${fieldName}.liveMethod`,
		),
		notes: optionalString(value.notes, `${fieldName}.notes`),
		deferReason: optionalString(value.deferReason, `${fieldName}.deferReason`),
	};
	if (requireDestinationAlias) {
		result.destinationAlias = requiredString(
			value.destinationAlias,
			`${fieldName}.destinationAlias`,
		);
		result.pageId = pageId;
		result.pageUrl = pageUrl;
	}
	return result;
}

function parsePhase4Memory(
	raw: unknown,
): NonNullable<
	LocalPortfolioControlTowerConfig["phase4Native"]
>["phaseMemory"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError("phase4Native.phaseMemory must be an object");
	}
	const value = raw as Record<string, unknown>;
	return {
		phase1GaveUs: requiredString(
			value.phase1GaveUs,
			"phase4Native.phaseMemory.phase1GaveUs",
		),
		phase2Added: requiredString(
			value.phase2Added,
			"phase4Native.phaseMemory.phase2Added",
		),
		phase3Added: requiredString(
			value.phase3Added,
			"phase4Native.phaseMemory.phase3Added",
		),
		phase4Added: requiredString(
			value.phase4Added,
			"phase4Native.phaseMemory.phase4Added",
		),
		phase5Brief: requiredString(
			value.phase5Brief,
			"phase4Native.phaseMemory.phase5Brief",
		),
		phase6Brief: requiredString(
			value.phase6Brief,
			"phase4Native.phaseMemory.phase6Brief",
		),
	};
}

function parseNativeStatus(
	value: unknown,
	fieldName: string,
): "active" | "deferred" | "missing" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "active" && parsed !== "deferred" && parsed !== "missing") {
		throw new AppError(`${fieldName} must be active, deferred, or missing`);
	}
	return parsed;
}

function parseNativeLiveMethod(
	value: unknown,
	fieldName: string,
): "playwright" | "manual" | "deferred" {
	const parsed = requiredString(value, fieldName);
	if (parsed !== "playwright" && parsed !== "manual" && parsed !== "deferred") {
		throw new AppError(`${fieldName} must be playwright, manual, or deferred`);
	}
	return parsed;
}

function extractDashboardViewIdFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		const viewId = parsed.searchParams.get("v");
		if (viewId) {
			return viewId;
		}
	} catch {
		return extractNotionIdFromUrl(url) ?? null;
	}

	return extractNotionIdFromUrl(url) ?? null;
}

function optionalLooseMetrics(
	value: unknown,
	fieldName: string,
): Record<string, number | string | string[]> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new AppError(`${fieldName} must be an object when provided`);
	}
	const raw = value as Record<string, unknown>;
	const entries = Object.entries(raw).map(([key, entry]) => {
		if (typeof entry === "number" || typeof entry === "string") {
			return [key, entry];
		}
		if (
			Array.isArray(entry) &&
			entry.every((item) => typeof item === "string")
		) {
			return [key, entry.map((item) => item.trim())];
		}
		throw new AppError(
			`${fieldName}.${key} must be a number, string, or string array`,
		);
	});
	return Object.fromEntries(entries);
}

function optionalMetrics(
	value: unknown,
	fieldName: string,
): ControlTowerMetrics | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value || typeof value !== "object") {
		throw new AppError(`${fieldName} must be an object when provided`);
	}
	const raw = value as Record<string, unknown>;
	return {
		totalProjects: requiredPositiveNumber(
			raw.totalProjects,
			`${fieldName}.totalProjects`,
		),
		queueCounts: parseQueueCounts(raw.queueCounts, `${fieldName}.queueCounts`),
		overdueReviews: requiredNonNegativeNumber(
			raw.overdueReviews,
			`${fieldName}.overdueReviews`,
		),
		missingNextMove: requiredNonNegativeNumber(
			raw.missingNextMove,
			`${fieldName}.missingNextMove`,
		),
		missingLastActive: requiredNonNegativeNumber(
			raw.missingLastActive,
			`${fieldName}.missingLastActive`,
		),
		staleActiveProjects: requiredNonNegativeNumber(
			raw.staleActiveProjects,
			`${fieldName}.staleActiveProjects`,
		),
		orphanedProjects: requiredNonNegativeNumber(
			raw.orphanedProjects,
			`${fieldName}.orphanedProjects`,
		),
		recentBuildSessions: requiredNonNegativeNumber(
			raw.recentBuildSessions,
			`${fieldName}.recentBuildSessions`,
		),
	};
}

function parseQueueCounts(
	value: unknown,
	fieldName: string,
): Record<OperatingQueue, number> {
	if (!value || typeof value !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const raw = value as Record<string, unknown>;
	const result = {} as Record<OperatingQueue, number>;
	for (const queue of OPERATING_QUEUE_LIST) {
		result[queue] = requiredNonNegativeNumber(
			raw[queue],
			`${fieldName}.${queue}`,
		);
	}
	return result;
}

function parsePositiveNumberMap(
	raw: unknown,
	fieldName: string,
): Record<string, number> {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	return Object.fromEntries(
		Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
			key,
			requiredPositiveNumber(value, `${fieldName}.${key}`),
		]),
	);
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new AppError(`${fieldName} must be a non-empty string`);
	}
	return value.trim();
}

function optionalString(value: unknown, fieldName: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return requiredString(value, fieldName);
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || item.trim().length === 0)
	) {
		throw new AppError(`${fieldName} must be an array of non-empty strings`);
	}
	return value.map((item) => item.trim());
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new AppError(`${fieldName} must be a positive number`);
	}
	return value;
}

function requiredNonNegativeNumber(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new AppError(`${fieldName} must be a non-negative number`);
	}
	return value;
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
	if (typeof value !== "boolean") {
		throw new AppError(`${fieldName} must be a boolean`);
	}
	return value;
}

function optionalNotionId(
	value: unknown,
	fieldName: string,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return normalizeRequiredNotionId(requiredString(value, fieldName), fieldName);
}

function normalizeRequiredNotionId(value: string, fieldName: string): string {
	const extracted = extractNotionIdFromUrl(value) ?? value;
	if (!extracted || normalizeNotionId(extracted).length === 0) {
		throw new AppError(`${fieldName} must be a valid Notion ID or URL`);
	}
	return normalizeNotionId(extracted);
}
