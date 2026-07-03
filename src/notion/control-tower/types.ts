// Type and interface declarations for the local-portfolio control-tower module.
// Extracted from local-portfolio-control-tower.ts (T3-4) to split the 3,941-line
// god-file along its seams. Pure type declarations — no runtime code.

export type OperatingQueue =
	| "Shipped"
	| "Needs Review"
	| "Needs Decision"
	| "Worth Finishing"
	| "Resume Now"
	| "Cold Storage"
	| "Watch";

export type EvidenceFreshness = "Fresh" | "Aging" | "Stale";

export interface ControlTowerMetrics {
	totalProjects: number;
	queueCounts: Record<OperatingQueue, number>;
	overdueReviews: number;
	missingNextMove: number;
	missingLastActive: number;
	staleActiveProjects: number;
	orphanedProjects: number;
	recentBuildSessions: number;
}

export interface LocalPortfolioControlTowerConfig {
	version: 1;
	database: {
		name: string;
		databaseUrl: string;
		databaseId: string;
		dataSourceId: string;
		destinationAlias: string;
	};
	relatedDataSources: {
		buildLogId: string;
		weeklyReviewsId: string;
		researchId: string;
		skillsId: string;
		toolsId: string;
	};
	destinations: {
		commandCenterAlias: string;
		weeklyReviewAlias: string;
		buildLogAlias: string;
	};
	commandCenter: {
		title: string;
		parentPageUrl: string;
		pageUrl?: string;
		pageId?: string;
	};
	fieldOwnership: {
		manual: string[];
		derived: string[];
		legacyHidden: string[];
		hideLegacyInPrimaryViews: boolean;
	};
	reviewCadenceDays: Record<string, number>;
	freshnessWindows: {
		freshMaxDays: number;
		agingMaxDays: number;
	};
	queuePrecedence: OperatingQueue[];
	viewIds: Record<string, string>;
	phase2Execution?: {
		defaultOwnerUserId?: string;
		decisions: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		packets: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		tasks: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		executionBriefs?: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		wipRules: {
			maxNowPackets: number;
			maxStandbyPackets: number;
		};
		packetSizing: {
			targetMinWorkingDays: number;
			targetMaxWorkingDays: number;
			allowedSizeOptions: string[];
		};
		decisionMateriality: {
			trackOnlyMaterialDecisions: boolean;
			allowedTypes: string[];
		};
		viewIds: {
			decisions: Record<string, string>;
			packets: Record<string, string>;
			tasks: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3WillUse: string;
			phase3Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastSyncAt?: string;
		lastSyncMetrics?: Record<string, number | string | string[]>;
	};
	phase3Intelligence?: {
		recommendationRuns: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		linkSuggestions: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		recommendationBriefs?: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		scoringModelVersion: string;
		cadence: {
			weeklyCanonical: boolean;
			dailyDrillDown: boolean;
		};
		confidenceThresholds: {
			highSupportDensity: number;
			suggestionMinimum: number;
		};
		reviewRequirements: {
			weeklyRequiresHumanReview: boolean;
		};
		viewIds: {
			projects: Record<string, string>;
			recommendationRuns: Record<string, string>;
			linkSuggestions: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Brief: string;
			phase5Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastSyncAt?: string;
		lastSyncMetrics?: Record<string, number | string | string[]>;
	};
	phase4Native?: {
		entitlements: {
			businessPlanRequired: boolean;
			businessWorkspaceVerified: boolean;
			customAgentsVisible: boolean;
			syncedDatabasesVisible: boolean;
			verifiedAt?: string;
		};
		dashboardRegistry: {
			portfolio: {
				name: string;
				databaseKey: "projects";
				viewId?: string;
				url?: string;
				widgetCount: number;
				status: "active" | "deferred" | "missing";
				notes?: string;
			};
			execution: {
				name: string;
				databaseKey: "tasks";
				viewId?: string;
				url?: string;
				widgetCount: number;
				status: "active" | "deferred" | "missing";
				notes?: string;
			};
		};
		automationRegistry: {
			projectReviewReminder: {
				name: string;
				databaseKey: "projects";
				nonCanonical: boolean;
				status: "active" | "deferred" | "missing";
				liveMethod: "playwright" | "manual" | "deferred";
				notes?: string;
				deferReason?: string;
			};
			decisionRevisitReminder: {
				name: string;
				databaseKey: "decisions";
				nonCanonical: boolean;
				status: "active" | "deferred" | "missing";
				liveMethod: "playwright" | "manual" | "deferred";
				notes?: string;
				deferReason?: string;
			};
			weeklyRunReviewReminder: {
				name: string;
				databaseKey: "recommendationRuns";
				nonCanonical: boolean;
				status: "active" | "deferred" | "missing";
				liveMethod: "playwright" | "manual" | "deferred";
				notes?: string;
				deferReason?: string;
			};
		};
		pilotRegistry: {
			githubDeliverySignals: {
				name: string;
				status: "active" | "deferred" | "missing";
				liveMethod: "playwright" | "manual" | "deferred";
				notes?: string;
				deferReason?: string;
			};
			weeklyNativeSummaryDraft: {
				name: string;
				status: "active" | "deferred" | "missing";
				liveMethod: "playwright" | "manual" | "deferred";
				destinationAlias: string;
				pageId?: string;
				pageUrl?: string;
				notes?: string;
				deferReason?: string;
			};
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Added: string;
			phase5Brief: string;
			phase6Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastAuditAt?: string;
		lastAuditSummary?: Record<string, number | string | string[]>;
	};
	phase5ExternalSignals?: {
		sources: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		events: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		syncRuns: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		externalSignalBriefs?: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		providerEnablement: {
			github: boolean;
			vercel: boolean;
			googleCalendar: boolean;
		};
		pollingCadenceMinutes: {
			github: number;
			vercel: number;
			googleCalendar: number;
		};
		syncLimits: {
			maxProjectsInFirstWave: number;
			maxEventsPerSource: number;
		};
		scoringModelVersion: string;
		viewIds: {
			sources: Record<string, string>;
			events: Record<string, string>;
			syncRuns: Record<string, string>;
			projects: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Added: string;
			phase5Added: string;
			phase6Brief: string;
			phase7Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastSyncAt?: string;
		lastSyncMetrics?: Record<string, number | string | string[]>;
	};
	phase6Governance?: {
		policies: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		actionRequests: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		webhookEndpoints: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		webhookDeliveries: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		webhookReceipts: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		receiver: {
			mode: "shadow";
			spoolDirectory: string;
			host?: string;
			pathRegistry: {
				github: string;
				vercel: string;
				googleCalendar: string;
			};
		};
		identityPosture: "app_first_least_privilege";
		providerStatus: {
			github: "disabled" | "shadow" | "live";
			vercel: "disabled" | "shadow" | "live";
			googleCalendar: "disabled" | "shadow" | "live";
		};
		replayAndDedupe: {
			github: {
				replayWindowMinutes: number;
				dedupeKey: string;
			};
			vercel: {
				replayWindowMinutes: number;
				dedupeKey: string;
			};
			googleCalendar: {
				replayWindowMinutes: number;
				dedupeKey: string;
			};
		};
		approvalDefaults: {
			read: "No Write" | "Single Approval" | "Dual Approval" | "Emergency";
			comment: "No Write" | "Single Approval" | "Dual Approval" | "Emergency";
			issue: "No Write" | "Single Approval" | "Dual Approval" | "Emergency";
			deploymentControl:
				| "No Write"
				| "Single Approval"
				| "Dual Approval"
				| "Emergency";
		};
		envRefs: {
			githubAppId: string;
			githubAppPrivateKeyPem: string;
			githubAppWebhookSecret: string;
			vercelWebhookSecret: string;
			breakGlassEnvVars: string[];
		};
		viewIds: {
			policies: Record<string, string>;
			actionRequests: Record<string, string>;
			endpoints: Record<string, string>;
			deliveries: Record<string, string>;
			receipts: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Added: string;
			phase5Added: string;
			phase6Added: string;
			phase7Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastAuditAt?: string;
		lastAuditSummary?: Record<string, number | string | string[]>;
	};
	phase7Actuation?: {
		executions: {
			name: string;
			databaseUrl: string;
			databaseId: string;
			dataSourceId: string;
			destinationAlias: string;
		};
		rolloutProfile: "github_first_issues_then_comments";
		runnerLimits: {
			mode: "serial";
			maxLivePerRun: number;
			maxDryRunsPerRun: number;
			minSecondsBetweenWrites: number;
		};
		liveGating: {
			requireApproval: boolean;
			requireNonExpiredRequest: boolean;
			requireActiveGitHubTarget: boolean;
			requireFreshDryRunBeforeLive: boolean;
			freshDryRunMaxAgeHours: number;
		};
		githubAuth: {
			provider: "GitHub App";
			tokenLifetimeMinutes: number;
			mintPerRun: boolean;
		};
		metricsRegistry: {
			dryRunSuccessRate: string;
			liveSuccessRate: string;
			actuationFailureRate: string;
			compensationNeededCount: string;
			approvalToExecutionHours: string;
		};
		viewIds: {
			actionRequests: Record<string, string>;
			executions: Record<string, string>;
			sources: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Added: string;
			phase5Added: string;
			phase6Added: string;
			phase7Added: string;
			phase8Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastAuditAt?: string;
		lastAuditSummary?: Record<string, number | string | string[]>;
	};
	phase8GithubDeepening?: {
		rolloutProfile: "github_issue_lifecycle_then_pr_comments";
		actionFamilies: {
			createIssue: boolean;
			updateIssue: boolean;
			setLabels: boolean;
			setAssignees: boolean;
			addIssueComment: boolean;
			commentPullRequest: boolean;
		};
		writeSafety: {
			mode: "serial";
			maxLivePerRun: number;
			maxDryRunsPerRun: number;
			minSecondsBetweenWrites: number;
		};
		permissionPosture: {
			issues: "read_write";
			metadata: "read_only";
			broaderRepositoryPermissions: "disabled";
		};
		webhookFeedback: {
			githubStatus: "shadow" | "trusted_feedback";
			subscribedEvents: string[];
			reconcileMode: "execution_first";
		};
		metricsRegistry: {
			dryRunSuccessRate: string;
			liveSuccessRate: string;
			actuationFailureRate: string;
			compensationNeededCount: string;
			approvalToExecutionHours: string;
			reconcileConfirmationRate: string;
		};
		viewIds: {
			actionRequests: Record<string, string>;
			executions: Record<string, string>;
			sources: Record<string, string>;
		};
		phaseMemory: {
			phase1GaveUs: string;
			phase2Added: string;
			phase3Added: string;
			phase4Added: string;
			phase5Added: string;
			phase6Added: string;
			phase7Added: string;
			phase8Added: string;
			phase9Brief: string;
		};
		baselineCapturedAt?: string;
		baselineMetrics?: Record<string, number | string | string[]>;
		lastAuditAt?: string;
		lastAuditSummary?: Record<string, number | string | string[]>;
	};
	phaseState: {
		currentPhase: number;
		currentPhaseStatus: string;
		baselineCapturedAt?: string;
		baselineMetrics?: ControlTowerMetrics;
		lastSyncAt?: string;
		lastSyncMetrics?: ControlTowerMetrics;
		lastClosedPhase?: number;
	};
	weeklyMaintenance?: {
		supportMaintenanceLastSyncAt?: string;
		weeklyRefreshLastRunAt?: string;
		weeklyRefreshLastStatus?: "clean" | "completed" | "partial" | "failed";
		weeklyRefreshLastSummary?: Record<string, number | string | boolean>;
		weeklyReviewLastPublishedAt?: string;
	};
}

export interface ControlTowerProjectRecord {
	id: string;
	url: string;
	title: string;
	currentState: string;
	portfolioCall: string;
	needsReview: boolean;
	nextMove: string;
	biggestBlocker: string;
	lastActive: string;
	lastBuildSessionDate: string;
	buildSessionCount: number;
	relatedResearchCount: number;
	supportingSkillsCount: number;
	linkedToolCount: number;
	setupFriction: string;
	runsLocally: string;
	buildMaturity: string;
	shipReadiness: string;
	effortToDemo: string;
	effortToShip: string;
	oneLinePitch: string;
	valueOutcome: string;
	monetizationValue: string;
	evidenceConfidence: string;
	docsQuality: string;
	testPosture: string;
	category: string;
	operatingQueue?: OperatingQueue;
	nextReviewDate?: string;
	evidenceFreshness?: EvidenceFreshness;
}

export interface ControlTowerBuildSessionRecord {
	id: string;
	url: string;
	title: string;
	sessionDate: string;
	outcome: string;
	localProjectIds: string[];
}

export type StaleActiveRescueReason =
	| "missing-next-move"
	| "missing-last-active"
	| "overdue-review"
	| "no-build-evidence"
	| "thin-support"
	| "low-confidence"
	| "stale-evidence";

export interface StaleActiveRescueItem {
	project: ControlTowerProjectRecord;
	reason: StaleActiveRescueReason;
	priority: "high" | "medium" | "low";
	nextAction: string;
	evidence: string[];
}

export interface ReviewPacketContext {
	weekTitle: string;
	compareStartDate: string;
	compareLabel: string;
	projectsChanged: ControlTowerProjectRecord[];
	projectsNeedDecision: ControlTowerProjectRecord[];
	projectsWorthFinishing: ControlTowerProjectRecord[];
	overdueProjects: ControlTowerProjectRecord[];
	staleActiveProjects: ControlTowerProjectRecord[];
	recentBuildSessions: ControlTowerBuildSessionRecord[];
	topPrioritiesNextWeek: string[];
	nextPhaseBrief?: string;
}
