import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { loadRuntimeConfig } from "../config/runtime-config.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";
import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import {
	extractNotionIdFromUrl,
	normalizeNotionId,
} from "../utils/notion-id.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type { ExternalSignalEventRecord } from "./local-portfolio-external-signals.js";

export const DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_POLICIES_PATH =
	"./config/local-portfolio-governance-policies.json";
export const DEFAULT_LOCAL_PORTFOLIO_WEBHOOK_PROVIDERS_PATH =
	"./config/local-portfolio-webhook-providers.json";
export const DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_VIEWS_PATH =
	"./config/local-portfolio-governance-views.json";

export type GovernanceProviderName = "GitHub" | "Vercel" | "Google Calendar";
export type GovernanceProviderKey = "github" | "vercel" | "google_calendar";
export type MutationClass = "Read" | "Comment" | "Issue" | "Deployment Control";
export type ExecutionMode = "Disabled" | "Shadow" | "Approved Live";
export type IdentityType = "GitHub App" | "Team Token" | "Break Glass Token";
export type ApprovalRule =
	| "No Write"
	| "Single Approval"
	| "Dual Approval"
	| "Emergency";
export type ActionSourceType = "Recommendation" | "Weekly Review" | "Manual";
export type ActionRequestStatus =
	| "Draft"
	| "Pending Approval"
	| "Approved"
	| "Rejected"
	| "Expired"
	| "Canceled"
	| "Shadow Logged"
	| "Executed";
export type EndpointMode = "Disabled" | "Shadow" | "Live";
export type DeliveryStatus =
	| "Received"
	| "Verified"
	| "Rejected"
	| "Duplicate"
	| "Processed"
	| "Failed";
export type VerificationResult =
	| "Valid"
	| "Invalid Signature"
	| "Unknown Endpoint"
	| "Expired"
	| "Duplicate";
export type ReceiptDrainStatus = "Pending" | "Written" | "Skipped" | "Failed";

export interface GovernanceDatabaseRef {
	name: string;
	databaseUrl: string;
	databaseId: string;
	dataSourceId: string;
	destinationAlias: string;
}

export interface GovernancePolicyPlan {
	actionKey: string;
	provider: GovernanceProviderName;
	mutationClass: MutationClass;
	executionMode: ExecutionMode;
	identityType: IdentityType;
	approvalRule: ApprovalRule;
	dryRunRequired: boolean;
	rollbackRequired: boolean;
	defaultExpiryHours: number;
	allowedSources: ActionSourceType[];
	notes: string;
}

export interface LocalPortfolioGovernancePolicyConfig {
	version: 1;
	strategy: {
		primary: "direct_rest";
		fallback: "manual_review";
		notes: string[];
	};
	policies: GovernancePolicyPlan[];
}

export interface GovernanceWebhookProviderPlan {
	key: GovernanceProviderKey;
	displayName: GovernanceProviderName;
	mode: "shadow";
	endpointPath: string;
	subscribedEvents: string[];
	secretEnvVar: string;
	/** When false, a missing secretEnvVar is not surfaced as a health warning (e.g. pro-only features). Defaults to true. */
	secretRequired?: boolean;
	deliveryIdLocation: "header" | "payload";
	deliveryIdField: string;
	eventTypeLocation: "header" | "payload";
	eventTypeField: string;
	signatureHeader: string;
	signatureAlgorithm: "github_sha256" | "vercel_sha1";
	replayWindowMinutes: number;
	notes: string[];
}

export interface LocalPortfolioWebhookProviderConfig {
	version: 1;
	spoolDirectory: string;
	providers: GovernanceWebhookProviderPlan[];
}

export interface GovernanceViewSpec {
	name: string;
	viewId?: string;
	type: "table" | "board" | "gallery";
	purpose: string;
	configure: string;
}

export interface GovernanceViewCollection {
	key: "policies" | "actionRequests" | "endpoints" | "deliveries" | "receipts";
	database: GovernanceDatabaseRef;
	views: GovernanceViewSpec[];
}

export interface LocalPortfolioGovernanceViewPlan {
	version: 1;
	strategy: {
		primary: "notion_mcp";
		fallback: "playwright";
		notes: string[];
	};
	collections: GovernanceViewCollection[];
}

export interface ActionPolicyRecord {
	id: string;
	url: string;
	title: string;
	provider: GovernanceProviderName;
	mutationClass: MutationClass;
	executionMode: ExecutionMode;
	identityType: IdentityType;
	approvalRule: ApprovalRule;
	dryRunRequired: boolean;
	rollbackRequired: boolean;
	defaultExpiryHours: number;
	allowedSources: ActionSourceType[];
	notes: string;
}

export interface ActionRequestRecord {
	id: string;
	url: string;
	title: string;
	localProjectIds: string[];
	policyIds: string[];
	targetSourceIds: string[];
	status: ActionRequestStatus;
	sourceType: ActionSourceType;
	recommendationRunIds: string[];
	weeklyReviewIds: string[];
	requestedByIds: string[];
	approverIds: string[];
	requestedAt: string;
	decidedAt: string;
	expiresAt: string;
	plannedPayloadSummary: string;
	payloadTitle: string;
	payloadBody: string;
	targetNumber: number;
	targetLabels: string[];
	targetAssignees: string[];
	executionIntent: "Dry Run" | "Ready for Live";
	latestExecutionIds: string[];
	latestExecutionStatus: "None" | "Dry Run Passed" | "Problem" | "Executed";
	providerRequestKey: string;
	approvalReason: string;
	executionNotes: string;
}

export interface WebhookEndpointRecord {
	id: string;
	url: string;
	title: string;
	provider: GovernanceProviderName;
	mode: EndpointMode;
	receiverPath: string;
	subscribedEvents: string;
	secretEnvVar: string;
	identityType: IdentityType;
	replayWindowMinutes: number;
	lastDeliveryAt: string;
	notes: string;
}

export interface WebhookDeliveryRecord {
	id: string;
	url: string;
	title: string;
	provider: GovernanceProviderName;
	endpointIds: string[];
	localProjectIds: string[];
	externalSignalEventIds: string[];
	status: DeliveryStatus;
	eventType: string;
	deliveryId: string;
	receivedAt: string;
	verificationResult: VerificationResult;
	eventKey: string;
	bodyDigest: string;
	headersExcerpt: string;
	rawExcerpt: string;
	failureNotes: string;
	firstSeenAt: string;
	lastSeenAt: string;
	receiptCount: number;
}

export interface WebhookReceiptRecord {
	id: string;
	url: string;
	title: string;
	provider: GovernanceProviderName;
	endpointIds: string[];
	deliveryIds: string[];
	receivedAt: string;
	verificationResult: VerificationResult;
	duplicate: boolean;
	drainStatus: ReceiptDrainStatus;
	deliveryIdValue: string;
	eventType: string;
	eventKey: string;
	bodyDigest: string;
	headersExcerpt: string;
	rawExcerpt: string;
	failureNotes: string;
}

export interface GovernanceAuditSummary {
	missingAuthRefs: string[];
	missingSecretRefs: string[];
	liveMutationPolicies: string[];
	policiesMissingApprovalRule: string[];
	endpointModeWarnings: string[];
	identityWarnings: string[];
}

export interface WebhookReceiptEnvelope {
	provider: GovernanceProviderKey;
	endpointPath: string;
	mode: "shadow";
	receivedAt: string;
	requestId: string;
	headers: Record<string, string>;
	body: string;
	bodyDigest: string;
	verificationResult: VerificationResult;
	deliveryId: string;
	logicalDeliveryKey: string;
	eventType: string;
	eventKey: string;
	status: DeliveryStatus;
	failureNotes: string;
}

export interface NormalizedWebhookEvent {
	provider: ExternalSignalEventRecord["provider"];
	signalType: ExternalSignalEventRecord["signalType"];
	status: string;
	severity: ExternalSignalEventRecord["severity"];
	occurredAt: string;
	title: string;
	sourceIdValue: string;
	sourceUrl: string;
	environment: ExternalSignalEventRecord["environment"];
	eventKey: string;
	summary: string;
	rawExcerpt: string;
}

export function requirePhase6Governance(
	config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase6Governance"]> {
	if (!config.phase6Governance) {
		throw new AppError("Control tower config is missing phase6Governance");
	}
	return config.phase6Governance;
}

export async function loadLocalPortfolioGovernancePolicyConfig(
	filePath = loadRuntimeConfig().paths.governancePoliciesPath,
): Promise<LocalPortfolioGovernancePolicyConfig> {
	return parseLocalPortfolioGovernancePolicyConfig(
		await readJsonFile<unknown>(filePath),
	);
}

export async function loadLocalPortfolioWebhookProviderConfig(
	filePath = loadRuntimeConfig().paths.webhookProvidersPath,
): Promise<LocalPortfolioWebhookProviderConfig> {
	return parseLocalPortfolioWebhookProviderConfig(
		await readJsonFile<unknown>(filePath),
	);
}

export async function loadLocalPortfolioGovernanceViewPlan(
	filePath = loadRuntimeConfig().paths.governanceViewsPath,
): Promise<LocalPortfolioGovernanceViewPlan> {
	return parseLocalPortfolioGovernanceViewPlan(
		await readJsonFile<unknown>(filePath),
	);
}

export function ensurePhase6GovernanceState(
	config: LocalPortfolioControlTowerConfig,
	input: { today: string },
): NonNullable<LocalPortfolioControlTowerConfig["phase6Governance"]> {
	return {
		policies:
			config.phase6Governance?.policies ??
			blankDatabaseRef("External Action Policies", "external_action_policies"),
		actionRequests:
			config.phase6Governance?.actionRequests ??
			blankDatabaseRef("External Action Requests", "external_action_requests"),
		webhookEndpoints:
			config.phase6Governance?.webhookEndpoints ??
			blankDatabaseRef("Webhook Endpoints", "webhook_endpoints"),
		webhookDeliveries:
			config.phase6Governance?.webhookDeliveries ??
			blankDatabaseRef("Webhook Deliveries", "webhook_deliveries"),
		webhookReceipts:
			config.phase6Governance?.webhookReceipts ??
			blankDatabaseRef("Webhook Receipts", "webhook_receipts"),
		receiver: config.phase6Governance?.receiver ?? {
			mode: "shadow",
			spoolDirectory: "./var/notion-webhook-shadow",
			host: "http://127.0.0.1:8788",
			pathRegistry: {
				github: "/webhooks/github/shadow",
				vercel: "/webhooks/vercel/shadow",
				googleCalendar: "/webhooks/google-calendar/shadow",
			},
		},
		identityPosture: "app_first_least_privilege",
		providerStatus: config.phase6Governance?.providerStatus ?? {
			github: "shadow",
			vercel: "disabled",
			googleCalendar: "disabled",
		},
		replayAndDedupe: config.phase6Governance?.replayAndDedupe ?? {
			github: { replayWindowMinutes: 60, dedupeKey: "provider+delivery_id" },
			vercel: { replayWindowMinutes: 60, dedupeKey: "provider+delivery_id" },
			googleCalendar: {
				replayWindowMinutes: 240,
				dedupeKey: "provider+delivery_id",
			},
		},
		approvalDefaults: config.phase6Governance?.approvalDefaults ?? {
			read: "No Write",
			comment: "Single Approval",
			issue: "Single Approval",
			deploymentControl: "Single Approval",
		},
		envRefs: config.phase6Governance?.envRefs ?? {
			githubAppId: "GITHUB_APP_ID",
			githubAppPrivateKeyPem: "GITHUB_APP_PRIVATE_KEY_PEM",
			githubAppWebhookSecret: "GITHUB_APP_WEBHOOK_SECRET",
			vercelWebhookSecret: "VERCEL_WEBHOOK_SECRET",
			breakGlassEnvVars: [
				"GITHUB_BREAK_GLASS_TOKEN",
				"VERCEL_BREAK_GLASS_TOKEN",
			],
		},
		viewIds: config.phase6Governance?.viewIds ?? {
			policies: {},
			actionRequests: {},
			endpoints: {},
			deliveries: {},
			receipts: {},
		},
		phaseMemory: config.phase6Governance?.phaseMemory ?? {
			phase1GaveUs:
				"Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
			phase2Added:
				"Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
			phase3Added:
				"Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
			phase4Added:
				"Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.",
			phase5Added:
				"Phase 5 gave us structured external telemetry, project-to-source mappings, sync-run history, and recommendation enrichment from repo and deployment evidence.",
			phase6Added:
				"Phase 6 gave us cross-system governance: policy-backed approvals, shadow-mode webhook verification, receipt and delivery audit trails, and provider-safe trust boundaries.",
			phase7Brief:
				"Phase 7 will allow tightly approved GitHub issue/comment actions first, then expand only after the same approval and audit path is proven for additional providers.",
		},
		baselineCapturedAt:
			config.phase6Governance?.baselineCapturedAt ?? input.today,
		baselineMetrics: config.phase6Governance?.baselineMetrics,
		lastAuditAt: config.phase6Governance?.lastAuditAt,
		lastAuditSummary: config.phase6Governance?.lastAuditSummary,
	};
}

export function buildGovernanceAuditSummary(input: {
	controlConfig: LocalPortfolioControlTowerConfig;
	policyConfig: LocalPortfolioGovernancePolicyConfig;
	providerConfig: LocalPortfolioWebhookProviderConfig;
}): GovernanceAuditSummary {
	const phase6 = requirePhase6Governance(input.controlConfig);
	const missingAuthRefs = [
		...new Set(
			input.policyConfig.policies.flatMap((policy) => {
				if (policy.provider === "Vercel" && !process.env.VERCEL_TOKEN?.trim()) {
					return ["VERCEL_TOKEN"];
				}
				if (
					policy.provider === "GitHub" &&
					policy.identityType === "Break Glass Token" &&
					!process.env.GITHUB_BREAK_GLASS_TOKEN?.trim()
				) {
					return ["GITHUB_BREAK_GLASS_TOKEN"];
				}
				return [];
			}),
		),
	];
	const missingSecretRefs = input.providerConfig.providers
		.filter(
			(provider) =>
				(provider.secretRequired ?? true) &&
				!process.env[provider.secretEnvVar]?.trim(),
		)
		.map((provider) => provider.secretEnvVar);

	const liveMutationPolicies = input.policyConfig.policies
		.filter((policy) => policy.executionMode === "Approved Live")
		.map((policy) => policy.actionKey);

	const policiesMissingApprovalRule = input.policyConfig.policies
		.filter((policy) => !policy.approvalRule)
		.map((policy) => policy.actionKey);

	const endpointModeWarnings = input.providerConfig.providers.flatMap(
		(provider) => {
			const configuredStatus =
				provider.displayName === "GitHub"
					? phase6.providerStatus.github
					: provider.displayName === "Vercel"
						? phase6.providerStatus.vercel
						: phase6.providerStatus.googleCalendar;
			if (provider.mode === "shadow" && configuredStatus === "live") {
				return [
					`${provider.displayName} is marked live in config while the provider plan is still shadow-only.`,
				];
			}
			return [];
		},
	);

	const identityWarnings = input.policyConfig.policies.flatMap((policy) => {
		if (policy.provider === "GitHub" && policy.identityType !== "GitHub App") {
			return [
				`${policy.actionKey} is not using the app-first GitHub identity posture.`,
			];
		}
		return [];
	});

	return {
		missingAuthRefs,
		missingSecretRefs,
		liveMutationPolicies,
		policiesMissingApprovalRule,
		endpointModeWarnings,
		identityWarnings,
	};
}

export function renderGovernanceBriefSection(input: {
	projectTitle: string;
	actionRequests: ActionRequestRecord[];
	deliveries: WebhookDeliveryRecord[];
	policies: ActionPolicyRecord[];
	actuationExecutions?: Array<{
		url: string;
		title: string;
		status: string;
		mode: string;
		executedAt: string;
	}>;
}): string {
	const openRequests = input.actionRequests.filter((request) =>
		["Pending Approval", "Approved"].includes(request.status),
	);
	const latestDeliveries = [...input.deliveries]
		.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
		.slice(0, 5);
	const githubPolicies = input.policies.filter(
		(policy) => policy.provider === "GitHub",
	);
	const recentExecutions = [...(input.actuationExecutions ?? [])]
		.sort((left, right) => right.executedAt.localeCompare(left.executedAt))
		.slice(0, 5);

	return [
		"<!-- codex:notion-governance-brief:start -->",
		"## Governance Brief",
		"",
		`- Pending or approved action requests: ${openRequests.length}`,
		`- Latest verified deliveries: ${input.deliveries.filter((delivery) => delivery.verificationResult === "Valid").length}`,
		`- Recent actuation runs: ${recentExecutions.length}`,
		`- Policy readiness for GitHub actions: ${githubPolicies.length > 0 ? "Defined" : "Not defined"}`,
		"",
		"### Open Requests",
		...(openRequests.length > 0
			? openRequests.map(
					(request) =>
						`- [${request.title}](${request.url}) - ${request.status}${request.expiresAt ? ` / expires ${request.expiresAt}` : ""}`,
				)
			: ["- No pending governance requests for this project right now."]),
		"",
		"### Latest Deliveries",
		...(latestDeliveries.length > 0
			? latestDeliveries.map(
					(delivery) =>
						`- [${delivery.title}](${delivery.url}) - ${delivery.status} / ${delivery.verificationResult} / ${delivery.lastSeenAt}`,
				)
			: ["- No webhook deliveries linked to this project yet."]),
		"",
		"### Recent Actuation",
		...(recentExecutions.length > 0
			? recentExecutions.map(
					(execution) =>
						`- [${execution.title}](${execution.url}) - ${execution.mode} / ${execution.status} / ${execution.executedAt}`,
				)
			: ["- No actuation executions linked to this project yet."]),
		"",
		"### Governance Blockers",
		...(githubPolicies.length === 0
			? [
					"- This project does not yet have the baseline GitHub action policies that Phase 7 will rely on.",
				]
			: [
					"- Governance is present; the remaining gate is approval flow maturity, not missing policy shape.",
				]),
		"<!-- codex:notion-governance-brief:end -->",
	].join("\n");
}

export function renderGovernanceCommandCenterSection(input: {
	requests: ActionRequestRecord[];
	deliveries: WebhookDeliveryRecord[];
	endpoints: WebhookEndpointRecord[];
	policies: ActionPolicyRecord[];
	actuationExecutions?: Array<{
		url: string;
		title: string;
		status: string;
		mode: string;
		executedAt: string;
	}>;
	healthSnapshot?: {
		status: "healthy" | "warning";
		warningCount: number;
		governanceWarningCount: number;
		actuationWarningCount: number;
		highlightedWarnings: string[];
		nextActions: string[];
	};
}): string {
	const pendingRequests = input.requests.filter(
		(request) => request.status === "Pending Approval",
	);
	const expiredRequests = input.requests.filter(
		(request) => request.status === "Expired",
	);
	const duplicateDeliveries = input.deliveries.filter(
		(delivery) => delivery.status === "Duplicate",
	);
	const rejectedDeliveries = input.deliveries.filter(
		(delivery) => delivery.verificationResult !== "Valid",
	);
	const shadowReadyEndpoints = input.endpoints.filter(
		(endpoint) => endpoint.mode === "Shadow",
	);
	const disabledPolicies = input.policies.filter(
		(policy) => policy.executionMode === "Disabled",
	);
	const recentActuationFailures = [...(input.actuationExecutions ?? [])]
		.filter(
			(execution) =>
				execution.status === "Failed" ||
				execution.status === "Compensation Needed",
		)
		.sort((left, right) => right.executedAt.localeCompare(left.executedAt))
		.slice(0, 8);

	return [
		"<!-- codex:notion-governance-command-center:start -->",
		"## Phase 6 Governance",
		"",
		`- Pending approvals: ${pendingRequests.length}`,
		`- Expired approvals: ${expiredRequests.length}`,
		`- Duplicate or rejected deliveries: ${duplicateDeliveries.length + rejectedDeliveries.length}`,
		`- Shadow-ready endpoints: ${shadowReadyEndpoints.length}`,
		`- Disabled policies: ${disabledPolicies.length}`,
		`- Recent actuation failures: ${recentActuationFailures.length}`,
		"",
		"### Governance Health",
		...(input.healthSnapshot
			? [
					`- Overall status: ${input.healthSnapshot.status}`,
					`- Open warnings: ${input.healthSnapshot.warningCount}`,
					`- Governance-side warnings: ${input.healthSnapshot.governanceWarningCount}`,
					`- Actuation-side warnings: ${input.healthSnapshot.actuationWarningCount}`,
				]
			: ["- Health snapshot unavailable in this sync run."]),
		"",
		"### Health Alerts",
		...(input.healthSnapshot
			? input.healthSnapshot.highlightedWarnings.length > 0
				? input.healthSnapshot.highlightedWarnings.map(
						(warning) => `- ${warning}`,
					)
				: ["- No health alerts right now."]
			: ["- No health snapshot available right now."]),
		"",
		"### Next Operator Moves",
		...(input.healthSnapshot
			? input.healthSnapshot.nextActions.map((action) => `- ${action}`)
			: [
					"- Run `npm run governance:health-report` to rebuild the operator snapshot.",
				]),
		"",
		"### Pending Approvals",
		...(pendingRequests.length > 0
			? pendingRequests
					.slice(0, 8)
					.map((request) => `- [${request.title}](${request.url})`)
			: ["- None right now."]),
		"",
		"### Recent Actuation Failures",
		...(recentActuationFailures.length > 0
			? recentActuationFailures.map(
					(execution) =>
						`- [${execution.title}](${execution.url}) - ${execution.status}`,
				)
			: ["- No recent actuation failures."]),
		"",
		"### Delivery Alerts",
		...(duplicateDeliveries.length + rejectedDeliveries.length > 0
			? [...duplicateDeliveries, ...rejectedDeliveries]
					.slice(0, 8)
					.map(
						(delivery) =>
							`- [${delivery.title}](${delivery.url}) - ${delivery.status} / ${delivery.verificationResult}`,
					)
			: ["- No duplicate or rejected deliveries at the moment."]),
		"<!-- codex:notion-governance-command-center:end -->",
	].join("\n");
}

export function renderWeeklyGovernanceSection(input: {
	requests: ActionRequestRecord[];
	deliveries: WebhookDeliveryRecord[];
	actuationExecutions?: Array<{ status: string; mode: string }>;
	healthSnapshot?: {
		status: "healthy" | "warning";
		warningCount: number;
		nextActions: string[];
	};
}): string {
	const pending = input.requests.filter(
		(request) => request.status === "Pending Approval",
	).length;
	const approved = input.requests.filter(
		(request) => request.status === "Approved",
	).length;
	const verified = input.deliveries.filter(
		(delivery) => delivery.verificationResult === "Valid",
	).length;
	const rejected = input.deliveries.filter(
		(delivery) => delivery.verificationResult !== "Valid",
	).length;
	const liveActions = (input.actuationExecutions ?? []).filter(
		(execution) =>
			execution.mode === "Live" && execution.status === "Succeeded",
	).length;
	const failedActions = (input.actuationExecutions ?? []).filter(
		(execution) => execution.status === "Failed",
	).length;

	return [
		"<!-- codex:notion-weekly-governance:start -->",
		"## Phase 6 Governance Summary",
		"",
		`- Pending approvals: ${pending}`,
		`- Approved but not executed: ${approved}`,
		`- Verified webhook deliveries: ${verified}`,
		`- Rejected or duplicate deliveries: ${rejected}`,
		`- Live actions executed: ${liveActions}`,
		`- Failed actions: ${failedActions}`,
		`- Governance health status: ${input.healthSnapshot?.status ?? "unknown"}`,
		`- Governance health warnings: ${input.healthSnapshot?.warningCount ?? 0}`,
		`- Suggested operator follow-ups: ${input.healthSnapshot?.nextActions.length ?? 0}`,
		"<!-- codex:notion-weekly-governance:end -->",
	].join("\n");
}

export function validateLocalPortfolioGovernanceViewPlanAgainstSchemas(input: {
	plan: LocalPortfolioGovernanceViewPlan;
	schemas: Record<GovernanceViewCollection["key"], DataSourceSchemaSnapshot>;
}): {
	validatedViews: Array<{
		collection: string;
		name: string;
		type: string;
		referencedProperties: string[];
	}>;
} {
	const validatedViews: Array<{
		collection: string;
		name: string;
		type: string;
		referencedProperties: string[];
	}> = [];

	for (const collection of input.plan.collections) {
		const schema = input.schemas[collection.key];
		if (!schema) {
			throw new AppError(
				`Missing schema for governance view collection "${collection.key}"`,
			);
		}
		if (schema.id !== collection.database.dataSourceId) {
			throw new AppError(
				`Governance collection "${collection.key}" points at "${collection.database.dataSourceId}" but schema came from "${schema.id}"`,
			);
		}
		for (const view of collection.views) {
			const referencedProperties = validateViewAgainstSchema(view, schema);
			validatedViews.push({
				collection: collection.key,
				name: view.name,
				type: view.type,
				referencedProperties,
			});
		}
	}

	return { validatedViews };
}

export function verifyGitHubSignature(
	secret: string,
	payload: string | Buffer,
	header: string,
): boolean {
	if (!secret.trim() || !header.trim().startsWith("sha256=")) {
		return false;
	}
	const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
	return safeCompare(expected, header.trim());
}

export function verifyVercelSignature(
	secret: string,
	payload: string | Buffer,
	header: string,
): boolean {
	if (!secret.trim() || !header.trim()) {
		return false;
	}
	const expected = createHmac("sha1", secret).update(payload).digest("hex");
	return safeCompare(expected, header.trim());
}

export function computeBodyDigest(body: string | Buffer): string {
	return createHash("sha256").update(body).digest("hex");
}

export function createWebhookReceiptEnvelope(input: {
	providerPlan: GovernanceWebhookProviderPlan;
	headers: Record<string, string | undefined>;
	body: string;
	receivedAt: string;
	requestId: string;
}): WebhookReceiptEnvelope {
	const headers = lowercaseHeaders(input.headers);
	const parsedPayload = parseJsonObject(input.body);
	const deliveryId = extractDeliveryId(
		input.providerPlan,
		headers,
		parsedPayload,
	);
	const eventType = extractEventType(
		input.providerPlan,
		headers,
		parsedPayload,
	);
	const signatureHeader =
		headers[input.providerPlan.signatureHeader.toLowerCase()] ?? "";
	const secret = process.env[input.providerPlan.secretEnvVar]?.trim() ?? "";
	const valid =
		input.providerPlan.signatureAlgorithm === "github_sha256"
			? verifyGitHubSignature(secret, input.body, signatureHeader)
			: verifyVercelSignature(secret, input.body, signatureHeader);
	const verificationResult: VerificationResult = valid
		? "Valid"
		: "Invalid Signature";
	const logicalDeliveryKey = buildLogicalDeliveryKey(
		normalizeProviderKey(input.providerPlan.displayName),
		deliveryId,
	);
	const normalized = buildNormalizedWebhookEvent({
		provider: normalizeProviderKey(input.providerPlan.displayName),
		eventType,
		payload: parsedPayload,
		body: input.body,
	});

	return {
		provider: normalizeProviderKey(input.providerPlan.displayName),
		endpointPath: input.providerPlan.endpointPath,
		mode: "shadow",
		receivedAt: input.receivedAt,
		requestId: input.requestId,
		headers: Object.fromEntries(
			Object.entries(headers).filter(([key]) =>
				ALLOWED_HEADER_EXCERPT.has(key),
			),
		),
		body: input.body,
		bodyDigest: computeBodyDigest(input.body),
		verificationResult,
		deliveryId,
		logicalDeliveryKey,
		eventType,
		eventKey:
			normalized?.eventKey ??
			buildLogicalDeliveryKey(
				normalizeProviderKey(input.providerPlan.displayName),
				deliveryId,
			),
		status: verificationResult === "Valid" ? "Verified" : "Rejected",
		failureNotes:
			verificationResult === "Valid"
				? ""
				: `Signature validation failed for ${input.providerPlan.displayName}.`,
	};
}

export function buildNormalizedWebhookEvent(input: {
	provider: GovernanceProviderKey;
	eventType: string;
	payload: Record<string, unknown>;
	body: string;
}): NormalizedWebhookEvent | undefined {
	if (input.provider === "github") {
		const repository = asRecord(input.payload.repository);
		const repoFullName =
			typeof repository?.full_name === "string"
				? repository.full_name.trim()
				: "";
		const repoUrl =
			typeof repository?.html_url === "string"
				? repository.html_url.trim()
				: typeof repository?.url === "string"
					? repository.url.trim()
					: "";
		const occurredAt = firstNonEmptyDate([
			readNestedString(input.payload, ["pull_request", "updated_at"]),
			readNestedString(input.payload, ["workflow_run", "updated_at"]),
			readNestedString(input.payload, ["repository", "updated_at"]),
		]);
		if (input.eventType === "pull_request") {
			const number =
				readNestedNumber(input.payload, ["pull_request", "number"]) ??
				readNestedNumber(input.payload, ["number"]);
			const title =
				readNestedString(input.payload, ["pull_request", "title"]) ||
				`Pull Request ${number ?? ""}`.trim();
			const action =
				readNestedString(input.payload, ["action"]) ||
				readNestedString(input.payload, ["pull_request", "state"]) ||
				"open";
			return {
				provider: "GitHub",
				signalType: "Pull Request",
				status: action,
				severity: ["closed", "merged"].includes(action.toLowerCase())
					? "Info"
					: "Watch",
				occurredAt,
				title: number ? `PR #${number} - ${title}` : title,
				sourceIdValue: repoFullName,
				sourceUrl:
					readNestedString(input.payload, ["pull_request", "html_url"]) ||
					repoUrl,
				environment: "N/A",
				eventKey: buildLogicalDeliveryKey(
					"github",
					`${repoFullName}::pull_request::${number ?? title}`,
				),
				summary: `${repoFullName || "GitHub repo"} pull request is ${action}.`,
				rawExcerpt: compactRawExcerpt(input.body),
			};
		}
		if (input.eventType === "workflow_run") {
			const name =
				readNestedString(input.payload, ["workflow_run", "name"]) ||
				"Workflow Run";
			const status =
				readNestedString(input.payload, ["workflow_run", "conclusion"]) ||
				readNestedString(input.payload, ["workflow_run", "status"]) ||
				"unknown";
			return {
				provider: "GitHub",
				signalType: "Workflow Run",
				status,
				severity: isFailureLike(status) ? "Risk" : "Info",
				occurredAt,
				title: `${name} - ${repoFullName || "GitHub"}`,
				sourceIdValue: repoFullName,
				sourceUrl:
					readNestedString(input.payload, ["workflow_run", "html_url"]) ||
					repoUrl,
				environment: "N/A",
				eventKey: buildLogicalDeliveryKey(
					"github",
					`${repoFullName}::workflow_run::${readNestedString(input.payload, ["workflow_run", "id"]) || name}`,
				),
				summary: `${repoFullName || "GitHub repo"} workflow run is ${status}.`,
				rawExcerpt: compactRawExcerpt(input.body),
			};
		}
		return undefined;
	}

	if (input.provider === "vercel") {
		const projectId =
			readNestedString(input.payload, ["project", "id"]) ||
			readNestedString(input.payload, ["projectId"]) ||
			readNestedString(input.payload, ["payload", "project", "id"]);
		const projectName =
			readNestedString(input.payload, ["project", "name"]) ||
			readNestedString(input.payload, ["projectName"]) ||
			readNestedString(input.payload, ["payload", "project", "name"]) ||
			projectId;
		const deploymentUrl =
			readNestedString(input.payload, ["deployment", "url"]) ||
			readNestedString(input.payload, ["url"]) ||
			readNestedString(input.payload, ["target", "url"]);
		const deploymentState =
			readNestedString(input.payload, ["deployment", "state"]) ||
			readNestedString(input.payload, ["state"]) ||
			readNestedString(input.payload, ["type"]) ||
			"unknown";
		const environment =
			readNestedString(input.payload, ["deployment", "target"]) === "production"
				? "Production"
				: "Preview";
		const occurredAt = firstNonEmptyDate([
			readNestedString(input.payload, ["createdAt"]),
			readNestedString(input.payload, ["payload", "createdAt"]),
			readNestedString(input.payload, ["deployment", "createdAt"]),
		]);

		return {
			provider: "Vercel",
			signalType: "Deployment",
			status: deploymentState,
			severity: isFailureLike(deploymentState) ? "Risk" : "Info",
			occurredAt,
			title: `${projectName || "Vercel project"} deployment`,
			sourceIdValue: projectId || projectName || "",
			sourceUrl: deploymentUrl,
			environment,
			eventKey: buildLogicalDeliveryKey(
				"vercel",
				`${projectId || projectName}::deployment::${deploymentState}`,
			),
			summary: `${projectName || "Vercel project"} deployment is ${deploymentState}.`,
			rawExcerpt: compactRawExcerpt(input.body),
		};
	}

	return undefined;
}

export function buildLogicalDeliveryKey(
	provider: GovernanceProviderKey,
	deliveryId: string,
): string {
	return `${provider}::${deliveryId.trim().toLowerCase()}`;
}

export function buildRequestExpiryDate(
	startDate: string,
	hours: number,
): string {
	const date = new Date(`${startDate}T00:00:00Z`);
	date.setUTCHours(date.getUTCHours() + hours);
	return date.toISOString().slice(0, 10);
}

export function shouldExpireActionRequest(
	request: ActionRequestRecord,
	today: string,
): boolean {
	return (
		request.status === "Approved" &&
		Boolean(request.expiresAt) &&
		request.expiresAt < today
	);
}

export function resolveGovernanceSpoolDirectory(
	config: LocalPortfolioControlTowerConfig,
): string {
	return path.resolve(requirePhase6Governance(config).receiver.spoolDirectory);
}

export function parseLocalPortfolioGovernancePolicyConfig(
	raw: unknown,
): LocalPortfolioGovernancePolicyConfig {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio governance policy config must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	if (value.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio governance policy config version "${String(value.version)}"`,
		);
	}
	return {
		version: 1,
		strategy: parseDirectRestStrategy(
			value.strategy,
			"localPortfolioGovernancePolicies.strategy",
		),
		policies: parseGovernancePolicies(value.policies),
	};
}

export function parseLocalPortfolioWebhookProviderConfig(
	raw: unknown,
): LocalPortfolioWebhookProviderConfig {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio webhook provider config must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	if (value.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio webhook provider config version "${String(value.version)}"`,
		);
	}
	return {
		version: 1,
		spoolDirectory: requiredString(
			value.spoolDirectory,
			"localPortfolioWebhookProviders.spoolDirectory",
		),
		providers: parseWebhookProviders(value.providers),
	};
}

export function parseLocalPortfolioGovernanceViewPlan(
	raw: unknown,
): LocalPortfolioGovernanceViewPlan {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"Local portfolio governance views config must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	if (value.version !== 1) {
		throw new AppError(
			`Unsupported local portfolio governance views config version "${String(value.version)}"`,
		);
	}
	return {
		version: 1,
		strategy: parseViewStrategy(value.strategy),
		collections: parseGovernanceViewCollections(value.collections),
	};
}

function parseGovernancePolicies(raw: unknown): GovernancePolicyPlan[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(
			"localPortfolioGovernancePolicies.policies must include at least one policy",
		);
	}
	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(
				`localPortfolioGovernancePolicies.policies[${index}] must be an object`,
			);
		}
		const value = entry as Record<string, unknown>;
		return {
			actionKey: requiredString(
				value.actionKey,
				`policies[${index}].actionKey`,
			),
			provider: parseProviderName(
				requiredString(value.provider, `policies[${index}].provider`),
			),
			mutationClass: parseMutationClass(
				requiredString(value.mutationClass, `policies[${index}].mutationClass`),
			),
			executionMode: parseExecutionMode(
				requiredString(value.executionMode, `policies[${index}].executionMode`),
			),
			identityType: parseIdentityType(
				requiredString(value.identityType, `policies[${index}].identityType`),
			),
			approvalRule: parseApprovalRule(
				requiredString(value.approvalRule, `policies[${index}].approvalRule`),
			),
			dryRunRequired: requiredBoolean(
				value.dryRunRequired,
				`policies[${index}].dryRunRequired`,
			),
			rollbackRequired: requiredBoolean(
				value.rollbackRequired,
				`policies[${index}].rollbackRequired`,
			),
			defaultExpiryHours: requiredPositiveNumber(
				value.defaultExpiryHours,
				`policies[${index}].defaultExpiryHours`,
			),
			allowedSources: parseActionSourceTypes(
				value.allowedSources,
				`policies[${index}].allowedSources`,
			),
			notes: requiredString(value.notes, `policies[${index}].notes`),
		};
	});
}

function parseWebhookProviders(raw: unknown): GovernanceWebhookProviderPlan[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(
			"localPortfolioWebhookProviders.providers must include at least one provider",
		);
	}
	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(
				`localPortfolioWebhookProviders.providers[${index}] must be an object`,
			);
		}
		const value = entry as Record<string, unknown>;
		return {
			key: parseProviderKey(
				requiredString(value.key, `providers[${index}].key`),
			),
			displayName: parseProviderName(
				requiredString(value.displayName, `providers[${index}].displayName`),
			),
			mode: parseShadowMode(
				requiredString(value.mode, `providers[${index}].mode`),
			),
			endpointPath: requiredString(
				value.endpointPath,
				`providers[${index}].endpointPath`,
			),
			subscribedEvents: requiredStringArray(
				value.subscribedEvents,
				`providers[${index}].subscribedEvents`,
			),
			secretEnvVar: requiredString(
				value.secretEnvVar,
				`providers[${index}].secretEnvVar`,
			),
			secretRequired: value.secretRequired === false ? false : true,
			deliveryIdLocation: parseStringEnum(
				value.deliveryIdLocation,
				`providers[${index}].deliveryIdLocation`,
				["header", "payload"],
			),
			deliveryIdField: requiredString(
				value.deliveryIdField,
				`providers[${index}].deliveryIdField`,
			),
			eventTypeLocation: parseStringEnum(
				value.eventTypeLocation,
				`providers[${index}].eventTypeLocation`,
				["header", "payload"],
			),
			eventTypeField: requiredString(
				value.eventTypeField,
				`providers[${index}].eventTypeField`,
			),
			signatureHeader: requiredString(
				value.signatureHeader,
				`providers[${index}].signatureHeader`,
			),
			signatureAlgorithm: parseStringEnum(
				value.signatureAlgorithm,
				`providers[${index}].signatureAlgorithm`,
				["github_sha256", "vercel_sha1"],
			),
			replayWindowMinutes: requiredPositiveNumber(
				value.replayWindowMinutes,
				`providers[${index}].replayWindowMinutes`,
			),
			notes: requiredStringArray(value.notes, `providers[${index}].notes`),
		};
	});
}

function parseGovernanceViewCollections(
	raw: unknown,
): GovernanceViewCollection[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(
			"localPortfolioGovernanceViews.collections must include collections",
		);
	}
	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(
				`localPortfolioGovernanceViews.collections[${index}] must be an object`,
			);
		}
		const value = entry as Record<string, unknown>;
		const key = parseStringEnum(value.key, `collections[${index}].key`, [
			"policies",
			"actionRequests",
			"endpoints",
			"deliveries",
			"receipts",
		]);
		return {
			key,
			database: parseGovernanceDatabaseRef(
				value.database,
				`collections[${index}].database`,
			),
			views: parseGovernanceViews(value.views, `collections[${index}].views`),
		};
	});
}

function parseGovernanceDatabaseRef(
	raw: unknown,
	fieldName: string,
): GovernanceDatabaseRef {
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

function parseGovernanceViews(
	raw: unknown,
	fieldName: string,
): GovernanceViewSpec[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new AppError(`${fieldName} must include at least one view`);
	}
	return raw.map((entry, index) => {
		if (!entry || typeof entry !== "object") {
			throw new AppError(`${fieldName}[${index}] must be an object`);
		}
		const value = entry as Record<string, unknown>;
		const type = parseStringEnum(value.type, `${fieldName}[${index}].type`, [
			"table",
			"board",
			"gallery",
		]);
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

function validateViewAgainstSchema(
	view: GovernanceViewSpec,
	schema: DataSourceSchemaSnapshot,
): string[] {
	const referencedProperties = new Set<string>();
	for (const statement of view.configure
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)) {
		if (statement.startsWith("SHOW ")) {
			for (const propertyName of Array.from(
				statement.matchAll(/"([^"]+)"/g),
				(match) => match[1] ?? "",
			)) {
				const property = assertPropertyExists(schema, view.name, propertyName);
				referencedProperties.add(property.name);
			}
			continue;
		}
		if (statement.startsWith("SORT BY ")) {
			const match = statement.match(/^SORT BY "([^"]+)" (ASC|DESC)$/);
			if (!match?.[1]) {
				throw new AppError(
					`View "${view.name}" has an unsupported SORT BY statement: ${statement}`,
				);
			}
			assertPropertyExists(schema, view.name, match[1]);
			referencedProperties.add(match[1]);
			continue;
		}
		if (statement.startsWith("FILTER ")) {
			const match = statement.match(
				/^FILTER "([^"]+)" = ("[^"]+"|true|false)$/,
			);
			if (!match?.[1]) {
				throw new AppError(
					`View "${view.name}" has an unsupported FILTER statement: ${statement}`,
				);
			}
			const property = assertPropertyExists(schema, view.name, match[1]);
			if (!FILTERABLE_TYPES.has(property.type)) {
				throw new AppError(
					`View "${view.name}" uses property "${property.name}" for filtering, but its type is "${property.type}"`,
				);
			}
			referencedProperties.add(match[1]);
			continue;
		}
		throw new AppError(
			`View "${view.name}" has an unsupported configure statement: ${statement}`,
		);
	}
	return [...referencedProperties];
}

function parseDirectRestStrategy(
	raw: unknown,
	fieldName: string,
): { primary: "direct_rest"; fallback: "manual_review"; notes: string[] } {
	if (!raw || typeof raw !== "object") {
		throw new AppError(`${fieldName} must be an object`);
	}
	const value = raw as Record<string, unknown>;
	if (value.primary !== "direct_rest" || value.fallback !== "manual_review") {
		throw new AppError(`${fieldName} must be direct_rest/manual_review`);
	}
	return {
		primary: "direct_rest",
		fallback: "manual_review",
		notes: requiredStringArray(value.notes, `${fieldName}.notes`),
	};
}

function parseViewStrategy(
	raw: unknown,
): LocalPortfolioGovernanceViewPlan["strategy"] {
	if (!raw || typeof raw !== "object") {
		throw new AppError(
			"localPortfolioGovernanceViews.strategy must be an object",
		);
	}
	const value = raw as Record<string, unknown>;
	if (value.primary !== "notion_mcp" || value.fallback !== "playwright") {
		throw new AppError(
			"localPortfolioGovernanceViews.strategy must be notion_mcp/playwright",
		);
	}
	return {
		primary: "notion_mcp",
		fallback: "playwright",
		notes: requiredStringArray(
			value.notes,
			"localPortfolioGovernanceViews.strategy.notes",
		),
	};
}

function parseProviderName(value: string): GovernanceProviderName {
	if (value !== "GitHub" && value !== "Vercel" && value !== "Google Calendar") {
		throw new AppError(`Unsupported governance provider "${value}"`);
	}
	return value;
}

function parseProviderKey(value: string): GovernanceProviderKey {
	if (value !== "github" && value !== "vercel" && value !== "google_calendar") {
		throw new AppError(`Unsupported governance provider key "${value}"`);
	}
	return value;
}

function parseMutationClass(value: string): MutationClass {
	if (
		value !== "Read" &&
		value !== "Comment" &&
		value !== "Issue" &&
		value !== "Deployment Control"
	) {
		throw new AppError(`Unsupported mutation class "${value}"`);
	}
	return value;
}

function parseExecutionMode(value: string): ExecutionMode {
	if (value !== "Disabled" && value !== "Shadow" && value !== "Approved Live") {
		throw new AppError(`Unsupported execution mode "${value}"`);
	}
	return value;
}

function parseIdentityType(value: string): IdentityType {
	if (
		value !== "GitHub App" &&
		value !== "Team Token" &&
		value !== "Break Glass Token"
	) {
		throw new AppError(`Unsupported identity type "${value}"`);
	}
	return value;
}

function parseApprovalRule(value: string): ApprovalRule {
	if (
		value !== "No Write" &&
		value !== "Single Approval" &&
		value !== "Dual Approval" &&
		value !== "Emergency"
	) {
		throw new AppError(`Unsupported approval rule "${value}"`);
	}
	return value;
}

function parseActionSourceTypes(
	value: unknown,
	fieldName: string,
): ActionSourceType[] {
	return requiredStringArray(value, fieldName).map((entry) =>
		parseStringEnum(entry, `${fieldName}[]`, [
			"Recommendation",
			"Weekly Review",
			"Manual",
		]),
	);
}

function parseShadowMode(value: string): "shadow" {
	if (value !== "shadow") {
		throw new AppError(`Webhook provider mode must be "shadow"`);
	}
	return "shadow";
}

function lowercaseHeaders(
	input: Record<string, string | undefined>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(input)
			.filter(
				([, value]) => typeof value === "string" && value.trim().length > 0,
			)
			.map(([key, value]) => [key.toLowerCase(), value!.trim()]),
	);
}

function extractDeliveryId(
	provider: GovernanceWebhookProviderPlan,
	headers: Record<string, string>,
	payload: Record<string, unknown>,
): string {
	if (provider.deliveryIdLocation === "header") {
		return headers[provider.deliveryIdField.toLowerCase()] ?? "";
	}
	return readNestedString(payload, provider.deliveryIdField.split(".")) ?? "";
}

function extractEventType(
	provider: GovernanceWebhookProviderPlan,
	headers: Record<string, string>,
	payload: Record<string, unknown>,
): string {
	if (provider.eventTypeLocation === "header") {
		return headers[provider.eventTypeField.toLowerCase()] ?? "";
	}
	return readNestedString(payload, provider.eventTypeField.split(".")) ?? "";
}

function firstNonEmptyDate(values: Array<string | undefined>): string {
	const raw =
		values.find(
			(value) => typeof value === "string" && value.trim().length > 0,
		) ?? "";
	return raw.slice(0, 10);
}

function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function readNestedString(
	object: Record<string, unknown>,
	pathParts: string[],
): string {
	let current: unknown = object;
	for (const part of pathParts) {
		if (!current || typeof current !== "object") {
			return "";
		}
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === "string" ? current.trim() : "";
}

function readNestedNumber(
	object: Record<string, unknown>,
	pathParts: string[],
): number | undefined {
	let current: unknown = object;
	for (const part of pathParts) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return typeof current === "number" ? current : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function compactRawExcerpt(body: string): string {
	const trimmed = body.trim().replace(/\s+/g, " ");
	return trimmed.slice(0, 280);
}

function isFailureLike(value: string): boolean {
	const normalized = value.toLowerCase();
	return [
		"failed",
		"failure",
		"error",
		"cancelled",
		"canceled",
		"timed_out",
	].includes(normalized);
}

function safeCompare(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}
	return timingSafeEqual(leftBuffer, rightBuffer);
}

function blankDatabaseRef(
	name: string,
	destinationAlias: string,
): GovernanceDatabaseRef {
	return {
		name,
		databaseUrl: "https://www.notion.so/11111111111141118111111111111111",
		databaseId: "11111111-1111-4111-8111-111111111111",
		dataSourceId: "21111111-1111-4111-8111-111111111111",
		destinationAlias,
	};
}

function normalizeProviderKey(
	value: GovernanceProviderName,
): GovernanceProviderKey {
	switch (value) {
		case "GitHub":
			return "github";
		case "Vercel":
			return "vercel";
		case "Google Calendar":
			return "google_calendar";
	}
}

function assertPropertyExists(
	schema: DataSourceSchemaSnapshot,
	viewName: string,
	propertyName: string,
): PropertySchema {
	const property = schema.properties[propertyName];
	if (!property) {
		throw new AppError(
			`View "${viewName}" references missing property "${propertyName}"`,
		);
	}
	return property;
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
	return normalizeRequiredNotionId(requiredString(value, fieldName), fieldName);
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some(
			(entry) => typeof entry !== "string" || entry.trim().length === 0,
		)
	) {
		throw new AppError(`${fieldName} must be a string array`);
	}
	return value.map((entry) => entry.trim());
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new AppError(`${fieldName} must be a positive number`);
	}
	return value;
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
	if (typeof value !== "boolean") {
		throw new AppError(`${fieldName} must be a boolean`);
	}
	return value;
}

function normalizeRequiredNotionId(value: string, fieldName: string): string {
	const extracted = extractNotionIdFromUrl(value);
	if (!extracted) {
		throw new AppError(`${fieldName} must be a valid Notion ID or URL`);
	}
	return normalizeNotionId(extracted);
}

function parseStringEnum<T extends string>(
	value: unknown,
	fieldName: string,
	allowed: T[],
): T {
	const parsed = requiredString(value, fieldName) as T;
	if (!allowed.includes(parsed)) {
		throw new AppError(`${fieldName} must be one of ${allowed.join(", ")}`);
	}
	return parsed;
}

const FILTERABLE_TYPES = new Set([
	"title",
	"rich_text",
	"select",
	"status",
	"checkbox",
	"date",
	"number",
]);
const ALLOWED_HEADER_EXCERPT = new Set([
	"x-github-delivery",
	"x-github-event",
	"x-hub-signature-256",
	"x-vercel-signature",
	"content-type",
	"user-agent",
]);
