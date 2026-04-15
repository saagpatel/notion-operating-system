import { describe, expect, test } from "vitest";
import type { ControlTowerBuildSessionRecord } from "../src/notion/local-portfolio-control-tower.js";
import type {
	ExecutionTaskRecord,
	ProjectDecisionRecord,
	WorkPacketRecord,
} from "../src/notion/local-portfolio-execution.js";
import {
	buildProjectIntelligenceContext,
	buildRecommendation,
	generateCandidateLinkSuggestions,
	type IntelligenceProjectRecord,
	type LinkSuggestionRecord,
	parseLocalPortfolioIntelligenceViewPlan,
	type ResearchLibraryRecord,
	renderRecommendationBriefSection,
	type SkillLibraryRecord,
	type ToolMatrixRecord,
} from "../src/notion/local-portfolio-intelligence.js";
import { renderNotionPhaseMemoryMarkdown } from "../src/notion/local-portfolio-roadmap.js";

const TODAY = "2026-03-17";

describe("local portfolio intelligence", () => {
	test("parses the intelligence view plan", () => {
		const plan = parseLocalPortfolioIntelligenceViewPlan({
			version: 1,
			strategy: {
				primary: "notion_mcp",
				fallback: "playwright",
				notes: ["Use MCP first."],
			},
			collections: [
				{
					key: "projects",
					database: {
						name: "Local Portfolio Projects",
						databaseUrl:
							"https://www.notion.so/1258652152454b6a81325eb988ec04d4",
						databaseId: "12586521-5245-4b6a-8132-5eb988ec04d4",
						dataSourceId: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
						destinationAlias: "local_portfolio_projects",
					},
					views: [
						{
							name: "Recommended Resume",
							type: "table",
							purpose: "Resume candidates",
							configure:
								'FILTER "Recommendation Lane" = "Resume"; SHOW "Name", "Recommendation Score"',
						},
					],
				},
			],
		});

		expect(plan.collections).toHaveLength(1);
		expect(plan.collections[0]?.views[0]?.name).toBe("Recommended Resume");
	});

	test("builds a strong resume recommendation from structured support and execution context", () => {
		const project = baseProject({
			portfolioCall: "Build Now",
			buildMaturity: "Functional Core",
			shipReadiness: "Needs Hardening",
			operatingQueue: "Resume Now",
		});
		const context = buildProjectIntelligenceContext({
			project,
			researchRecords: [baseResearch()],
			skillRecords: [baseSkill()],
			toolRecords: [baseTool()],
			decisions: [],
			packets: [basePacket()],
			tasks: [baseTask()],
			buildSessions: [baseBuildSession()],
			today: TODAY,
		});

		const recommendation = buildRecommendation(context);

		expect(recommendation.lane).toBe("Resume");
		expect(recommendation.score).toBeGreaterThan(60);
		expect(recommendation.confidence).toMatch(/High|Medium/);
		expect(
			renderRecommendationBriefSection({ context, recommendation }),
		).toContain("## Recommendation Brief");
	});

	test("surfaces defer when a project is cold, stale, and poorly supported", () => {
		const project = baseProject({
			title: "Cold Project",
			currentState: "Parked",
			evidenceFreshness: "Stale",
			relatedResearchIds: [],
			supportingSkillIds: [],
			toolStackIds: [],
			operatingQueue: "Cold Storage",
			setupFriction: "High",
			runsLocally: "No",
		});
		const context = buildProjectIntelligenceContext({
			project,
			researchRecords: [],
			skillRecords: [],
			toolRecords: [],
			decisions: [],
			packets: [basePacket({ status: "Blocked", rolloverCount: 2 })],
			tasks: [baseTask({ status: "Blocked" })],
			buildSessions: [],
			today: TODAY,
		});

		const recommendation = buildRecommendation(context);

		expect(recommendation.lane).toBe("Defer");
	});

	test("keeps shipped projects in monitor instead of resume", () => {
		const project = baseProject({
			title: "Shipped Project",
			currentState: "Shipped",
			portfolioCall: "Polish",
			operatingQueue: "Shipped",
			buildMaturity: "Shippable",
			shipReadiness: "Ship-Ready",
		});
		const context = buildProjectIntelligenceContext({
			project,
			researchRecords: [baseResearch()],
			skillRecords: [baseSkill()],
			toolRecords: [baseTool()],
			decisions: [],
			packets: [],
			tasks: [],
			buildSessions: [baseBuildSession()],
			today: TODAY,
		});

		const recommendation = buildRecommendation(context);

		expect(recommendation.lane).toBe("Monitor");
	});

	test("biases finish-track projects toward finish", () => {
		const project = baseProject({
			title: "Finish Project",
			currentState: "Ready for Review",
			portfolioCall: "Finish",
			operatingQueue: "Worth Finishing",
			buildMaturity: "Feature Complete",
			shipReadiness: "Near Ship",
		});
		const context = buildProjectIntelligenceContext({
			project,
			researchRecords: [baseResearch()],
			skillRecords: [baseSkill()],
			toolRecords: [baseTool()],
			decisions: [],
			packets: [basePacket()],
			tasks: [baseTask()],
			buildSessions: [baseBuildSession()],
			today: TODAY,
		});

		const recommendation = buildRecommendation(context);

		expect(recommendation.lane).toBe("Finish");
	});

	test("suppresses previously rejected exact suggestions", () => {
		const candidates = generateCandidateLinkSuggestions({
			projects: [baseProject({ relatedResearchIds: [] })],
			researchRecords: [baseResearch()],
			skillRecords: [],
			toolRecords: [],
			existingSuggestions: [
				baseSuggestion({
					suggestionType: "Project->Research",
					localProjectIds: ["project-1"],
					suggestedResearchIds: ["research-1"],
					status: "Rejected",
				}),
			],
			config: {
				version: 1,
				database: {
					name: "Local Portfolio Projects",
					databaseUrl: "https://www.notion.so/1258652152454b6a81325eb988ec04d4",
					databaseId: "12586521-5245-4b6a-8132-5eb988ec04d4",
					dataSourceId: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
					destinationAlias: "local_portfolio_projects",
				},
				relatedDataSources: {
					buildLogId: "0927e24f-1c0a-4be2-9753-feae194afe91",
					weeklyReviewsId: "f7cff9c6-eda4-47a8-b0ef-187c607684ca",
					researchId: "fd70f600-1a76-40b7-9946-e77a208b3e1b",
					skillsId: "89be2dd1-960d-4d0e-89bc-452eacd9215e",
					toolsId: "62bba59c-6004-4b8e-9161-3f336a99bc50",
				},
				destinations: {
					commandCenterAlias: "local_portfolio_command_center",
					weeklyReviewAlias: "weekly_reviews",
					buildLogAlias: "build_log",
				},
				commandCenter: {
					title: "Local Portfolio Command Center",
					parentPageUrl:
						"https://www.notion.so/326c21f1caf0801484efce5bd9323449",
				},
				fieldOwnership: {
					manual: [],
					derived: [],
					legacyHidden: [],
					hideLegacyInPrimaryViews: true,
				},
				reviewCadenceDays: { "Active Build": 7 },
				freshnessWindows: { freshMaxDays: 14, agingMaxDays: 45 },
				queuePrecedence: [
					"Shipped",
					"Needs Review",
					"Needs Decision",
					"Worth Finishing",
					"Resume Now",
					"Cold Storage",
					"Watch",
				],
				viewIds: {},
				phase3Intelligence: {
					recommendationRuns: {
						name: "Recommendation Runs",
						databaseUrl:
							"https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						databaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						dataSourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						destinationAlias: "recommendation_runs",
					},
					linkSuggestions: {
						name: "Link Suggestions",
						databaseUrl:
							"https://www.notion.so/cccccccccccccccccccccccccccccccc",
						databaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
						dataSourceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
						destinationAlias: "link_suggestions",
					},
					scoringModelVersion: "balanced-hybrid-v1",
					cadence: { weeklyCanonical: true, dailyDrillDown: true },
					confidenceThresholds: {
						highSupportDensity: 8,
						suggestionMinimum: 0.7,
					},
					reviewRequirements: { weeklyRequiresHumanReview: true },
					viewIds: {
						projects: {},
						recommendationRuns: {},
						linkSuggestions: {},
					},
					phaseMemory: {
						phase1GaveUs: "Phase 1",
						phase2Added: "Phase 2",
						phase3Added: "Phase 3",
						phase4Brief: "Phase 4",
						phase5Brief: "Phase 5",
					},
				},
				phaseState: {
					currentPhase: 3,
					currentPhaseStatus: "In Progress",
				},
			},
		});

		expect(candidates).toHaveLength(0);
	});

	test("renders phase memory through phase five", () => {
		const markdown = renderNotionPhaseMemoryMarkdown({
			generatedAt: TODAY,
			currentPhase: 3,
		});

		expect(markdown).toContain("## Phase 5");
		expect(markdown).toContain(
			"Phase 3 gave us structured recommendation memory",
		);
	});
});

function baseProject(
	overrides: Partial<IntelligenceProjectRecord> = {},
): IntelligenceProjectRecord {
	return {
		id: overrides.id ?? "project-1",
		url: overrides.url ?? "https://notion.so/project-1",
		title: overrides.title ?? "GPT_RAG",
		currentState: overrides.currentState ?? "Active Build",
		portfolioCall: overrides.portfolioCall ?? "Finish",
		needsReview: overrides.needsReview ?? false,
		nextMove: overrides.nextMove ?? "Boot the local environment",
		biggestBlocker:
			overrides.biggestBlocker ?? "Need one clear implementation push",
		lastActive: overrides.lastActive ?? "2026-03-15",
		lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-15",
		buildSessionCount: overrides.buildSessionCount ?? 3,
		relatedResearchCount: overrides.relatedResearchCount ?? 1,
		supportingSkillsCount: overrides.supportingSkillsCount ?? 1,
		linkedToolCount: overrides.linkedToolCount ?? 1,
		setupFriction: overrides.setupFriction ?? "Low",
		runsLocally: overrides.runsLocally ?? "Yes",
		buildMaturity: overrides.buildMaturity ?? "Feature Complete",
		shipReadiness: overrides.shipReadiness ?? "Near Ship",
		effortToDemo: overrides.effortToDemo ?? "1 day",
		effortToShip: overrides.effortToShip ?? "2-3 days",
		oneLinePitch:
			overrides.oneLinePitch ?? "A retrieval-augmented generation tool.",
		valueOutcome: overrides.valueOutcome ?? "Create a strong demoable artifact",
		monetizationValue: overrides.monetizationValue ?? "Strategic leverage",
		evidenceConfidence: overrides.evidenceConfidence ?? "High",
		docsQuality: overrides.docsQuality ?? "Strong",
		testPosture: overrides.testPosture ?? "Some",
		category: overrides.category ?? "Dev Tool",
		operatingQueue: overrides.operatingQueue ?? "Resume Now",
		nextReviewDate: overrides.nextReviewDate ?? "2026-03-24",
		evidenceFreshness: overrides.evidenceFreshness ?? "Fresh",
		relatedResearchIds: overrides.relatedResearchIds ?? ["research-1"],
		supportingSkillIds: overrides.supportingSkillIds ?? ["skill-1"],
		toolStackIds: overrides.toolStackIds ?? ["tool-1"],
		recommendationRunIds: overrides.recommendationRunIds ?? [],
		projectShape: overrides.projectShape ?? ["Tool"],
		deploymentSurface: overrides.deploymentSurface ?? ["CLI"],
		primaryTool: overrides.primaryTool ?? "OpenAI",
		recommendationLane: overrides.recommendationLane,
		recommendationScore: overrides.recommendationScore,
		recommendationConfidence: overrides.recommendationConfidence,
		recommendationUpdated: overrides.recommendationUpdated,
	};
}

function baseResearch(
	overrides: Partial<ResearchLibraryRecord> = {},
): ResearchLibraryRecord {
	return {
		id: overrides.id ?? "research-1",
		url: overrides.url ?? "https://notion.so/research-1",
		title: overrides.title ?? "RAG evaluation",
		category: overrides.category ?? "Workflow",
		tags: overrides.tags ?? ["rag", "retrieval", "llm"],
		actionable: overrides.actionable ?? true,
		confidence: overrides.confidence ?? "High",
		decisionImpact: overrides.decisionImpact ?? "High",
		lastVerified: overrides.lastVerified ?? "2026-03-15",
		dateResearched: overrides.dateResearched ?? "2026-03-14",
		relatedProjectIds: overrides.relatedProjectIds ?? ["project-1"],
	};
}

function baseSkill(
	overrides: Partial<SkillLibraryRecord> = {},
): SkillLibraryRecord {
	return {
		id: overrides.id ?? "skill-1",
		url: overrides.url ?? "https://notion.so/skill-1",
		title: overrides.title ?? "TypeScript",
		category: overrides.category ?? "Programming",
		proficiency: overrides.proficiency ?? "Strong",
		status: overrides.status ?? "Active",
		projectRelevance: overrides.projectRelevance ?? "Core",
		lastPracticed: overrides.lastPracticed ?? "2026-03-16",
		relatedProjectIds: overrides.relatedProjectIds ?? ["project-1"],
	};
}

function baseTool(overrides: Partial<ToolMatrixRecord> = {}): ToolMatrixRecord {
	return {
		id: overrides.id ?? "tool-1",
		url: overrides.url ?? "https://notion.so/tool-1",
		title: overrides.title ?? "OpenAI",
		category: overrides.category ?? "Model",
		status: overrides.status ?? "Active",
		myRole: overrides.myRole ?? "Builder",
		stackIntegration: overrides.stackIntegration ?? "Core",
		utilityScore: overrides.utilityScore ?? 9,
		delightScore: overrides.delightScore ?? 8,
		lastReviewed: overrides.lastReviewed ?? "2026-03-14",
		tags: overrides.tags ?? ["llm", "api"],
		linkedProjectIds: overrides.linkedProjectIds ?? ["project-1"],
	};
}

function basePacket(
	overrides: Partial<WorkPacketRecord> = {},
): WorkPacketRecord {
	return {
		id: overrides.id ?? "packet-1",
		url: overrides.url ?? "https://notion.so/packet-1",
		title: overrides.title ?? "Now packet",
		status: overrides.status ?? "In Progress",
		packetType: overrides.packetType ?? "Resume",
		priority: overrides.priority ?? "Now",
		ownerIds: overrides.ownerIds ?? ["user-1"],
		localProjectIds: overrides.localProjectIds ?? ["project-1"],
		drivingDecisionIds: overrides.drivingDecisionIds ?? [],
		goal: overrides.goal ?? "Ship one clear slice",
		definitionOfDone: overrides.definitionOfDone ?? "Proof is logged",
		whyNow: overrides.whyNow ?? "Best low-friction resume candidate",
		targetStart: overrides.targetStart ?? "2026-03-17",
		targetFinish: overrides.targetFinish ?? "2026-03-21",
		estimatedSize: overrides.estimatedSize ?? "2-3 days",
		rolloverCount: overrides.rolloverCount ?? 0,
		executionTaskIds: overrides.executionTaskIds ?? ["task-1"],
		buildLogSessionIds: overrides.buildLogSessionIds ?? [],
		weeklyReviewIds: overrides.weeklyReviewIds ?? [],
		blockerSummary: overrides.blockerSummary ?? "",
	};
}

function baseTask(
	overrides: Partial<ExecutionTaskRecord> = {},
): ExecutionTaskRecord {
	return {
		id: overrides.id ?? "task-1",
		url: overrides.url ?? "https://notion.so/task-1",
		title: overrides.title ?? "Boot the local environment",
		status: overrides.status ?? "Ready",
		assigneeIds: overrides.assigneeIds ?? ["user-1"],
		dueDate: overrides.dueDate ?? "2026-03-18",
		priority: overrides.priority ?? "P0",
		taskType: overrides.taskType ?? "Build",
		workPacketIds: overrides.workPacketIds ?? ["packet-1"],
		localProjectIds: overrides.localProjectIds ?? ["project-1"],
		estimate: overrides.estimate ?? "1h",
		completedOn: overrides.completedOn ?? "",
		taskNotes: overrides.taskNotes ?? "Verify the boot path",
	};
}

function baseBuildSession(
	overrides: Partial<ControlTowerBuildSessionRecord> = {},
): ControlTowerBuildSessionRecord {
	return {
		id: overrides.id ?? "build-1",
		url: overrides.url ?? "https://notion.so/build-1",
		title: overrides.title ?? "Recent build session",
		sessionDate: overrides.sessionDate ?? "2026-03-16",
		outcome: overrides.outcome ?? "Progress",
		localProjectIds: overrides.localProjectIds ?? ["project-1"],
	};
}

function baseSuggestion(
	overrides: Partial<LinkSuggestionRecord> = {},
): LinkSuggestionRecord {
	return {
		id: overrides.id ?? "suggestion-1",
		url: overrides.url ?? "https://notion.so/suggestion-1",
		title: overrides.title ?? "GPT_RAG -> Research -> RAG evaluation",
		status: overrides.status ?? "Proposed",
		suggestionType: overrides.suggestionType ?? "Project->Research",
		localProjectIds: overrides.localProjectIds ?? ["project-1"],
		suggestedResearchIds: overrides.suggestedResearchIds ?? ["research-1"],
		suggestedSkillIds: overrides.suggestedSkillIds ?? [],
		suggestedToolIds: overrides.suggestedToolIds ?? [],
		confidenceScore: overrides.confidenceScore ?? 0.8,
		matchReasons: overrides.matchReasons ?? "strong lexical overlap",
		suggestedInRunIds: overrides.suggestedInRunIds ?? [],
		reviewNotes: overrides.reviewNotes ?? "",
		supersedesIds: overrides.supersedesIds ?? [],
	};
}
