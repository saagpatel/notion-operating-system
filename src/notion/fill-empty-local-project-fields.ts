import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import {
	buildProjectIntelligenceDataset,
	type ProjectIntelligenceRow,
} from "../portfolio-audit/project-intelligence.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	type ControlTowerBuildSessionRecord,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	type DataSourcePageRef,
	datePropertyValue,
	fetchAllPages,
	multiSelectValue,
	richTextValue,
	selectPropertyValue,
	selectValue,
	textValue,
	toBuildSessionRecord,
} from "./local-portfolio-control-tower-live.js";
import {
	toExecutionTaskRecord,
	toProjectDecisionRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
	buildExternalSignalSummary,
	type ExternalSignalEventRecord,
	type ExternalSignalSourceRecord,
	type ExternalSignalSummary,
} from "./local-portfolio-external-signals.js";
import {
	toExternalSignalEventRecord,
	toExternalSignalSourceRecord,
} from "./local-portfolio-external-signals-live.js";
import {
	buildProjectIntelligenceContext,
	buildRecommendation,
	type ProjectRecommendation,
} from "./local-portfolio-intelligence.js";
import {
	toIntelligenceProjectRecord,
	toResearchLibraryRecord,
	toSkillLibraryRecord,
	toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";

const LOCAL_PROJECTS_DATA_SOURCE_ID = "7858b551-4ce9-4bc3-ad1d-07b187d7117b";
const TODAY = losAngelesToday();

interface Flags {
	live: boolean;
	today: string;
}

interface FieldPlan {
	title: string;
	pageId: string;
	properties: Record<string, unknown>;
	updatedFields: string[];
}

interface LatestBuildEvidence {
	date: string;
	label: string;
	source: "build_session" | "workflow_run" | "fallback";
}

interface LiveProjectSnapshot {
	title: string;
	status: string;
	pipelineStage: string;
	currentState: string;
	portfolioCall: string;
	category: string;
	summary: string;
	sourceGroup: string;
	localPath: string;
	auditNotes: string;
	verdict: string;
	oneLinePitch: string;
	nextMove: string;
	biggestBlocker: string;
	lastActive: string;
	stack: string;
	projectShape: string[];
	deploymentSurface: string[];
	docsQuality: string;
	testPosture: string;
	evidenceConfidence: string;
	startHere: string;
	primaryRunCommand: string;
	primaryContextDoc: string;
	setupFriction: string;
	runsLocally: string;
	lastMeaningfulWork: string;
	primaryUser: string;
	problemSolved: string;
	valueOutcome: string;
	buildMaturity: string;
	shipReadiness: string;
	effortToDemo: string;
	effortToShip: string;
	monetizationValue: string;
	keyIntegrations: string;
	projectHealthNotes: string;
	knownRisks: string;
	whatWorks: string;
	missingCorePieces: string;
	primaryTool: string;
	contextQuality: string;
	completion: string;
	readiness: string;
	mergedInto: string;
	integrationTags: string[];
	lastBuildSessionDate: string;
	externalSignalCoverage: string;
	latestExternalActivity: string;
	latestDeploymentStatus: string;
	openPrCount: number | null;
	recentFailedWorkflowRuns: number | null;
	externalSignalUpdated: string;
	recommendationLane: string;
	recommendationScore: number | null;
	recommendationConfidence: string;
	recommendationUpdated: string;
}

function parseFlags(argv: string[]): Flags {
	let live = false;
	let today = TODAY;

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === "--live") {
			live = true;
			continue;
		}
		if (current === "--today") {
			today = argv[index + 1] ?? today;
			index += 1;
		}
	}

	return { live, today };
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required to fill empty local project fields",
	);
	const api = new DirectNotionClient(token);
	const sdk = new Client({
		auth: token,
		notionVersion: "2026-03-11",
	});
	const config = await loadLocalPortfolioControlTowerConfig();

	const [
		{ projects: intelligenceProjects },
		pages,
		buildPages,
		researchPages,
		skillPages,
		toolPages,
		decisionPages,
		packetPages,
		taskPages,
		sourcePages,
		eventPages,
	] = await Promise.all([
		buildProjectIntelligenceDataset(),
		fetchAllPages(sdk, LOCAL_PROJECTS_DATA_SOURCE_ID, "Name"),
		fetchAllPages(sdk, config.relatedDataSources.buildLogId, "Title"),
		fetchAllPages(sdk, config.relatedDataSources.researchId, "Title"),
		fetchAllPages(sdk, config.relatedDataSources.skillsId, "Title"),
		fetchAllPages(sdk, config.relatedDataSources.toolsId, "Title"),
		fetchAllPages(sdk, config.phase2Execution!.decisions.dataSourceId, "Title"),
		fetchAllPages(sdk, config.phase2Execution!.packets.dataSourceId, "Title"),
		fetchAllPages(sdk, config.phase2Execution!.tasks.dataSourceId, "Title"),
		config.phase5ExternalSignals
			? fetchAllPages(
					sdk,
					config.phase5ExternalSignals.sources.dataSourceId,
					"Title",
				)
			: Promise.resolve([]),
		config.phase5ExternalSignals
			? fetchAllPages(
					sdk,
					config.phase5ExternalSignals.events.dataSourceId,
					"Title",
				)
			: Promise.resolve([]),
	]);

	const intelligenceByKey = new Map(
		intelligenceProjects.map(
			(project) => [normalizeKey(project.projectName), project] as const,
		),
	);
	const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
	const research = researchPages.map((page) => toResearchLibraryRecord(page));
	const skills = skillPages.map((page) => toSkillLibraryRecord(page));
	const tools = toolPages.map((page) => toToolMatrixRecord(page));
	const decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
	const events = eventPages.map((page) => toExternalSignalEventRecord(page));
	const buildSessionsByProjectId = groupBuildSessionsByProjectId(buildSessions);
	const workflowRunsByProjectId = groupWorkflowRunsByProjectId(events);

	const plans: FieldPlan[] = [];
	const failures: Array<{ title: string; error: string }> = [];

	for (const page of pages) {
		const live = readLiveProjectSnapshot(page);
		const intelligence = intelligenceByKey.get(normalizeKey(page.title));
		const project = toIntelligenceProjectRecord(page);
		const summary = buildExternalSignalSummary({
			project,
			sources,
			events,
			today: flags.today,
		});
		const recommendation = buildRecommendation(
			buildProjectIntelligenceContext({
				project: {
					...project,
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
				today: flags.today,
			}),
			summary,
		);
		const latestBuild = deriveLatestBuildEvidence({
			buildSessions: buildSessionsByProjectId.get(page.id) ?? [],
			workflowRuns: workflowRunsByProjectId.get(page.id) ?? [],
			live,
			intelligence,
			summary,
			today: flags.today,
		});
		const plan = buildFieldPlan(
			page,
			live,
			intelligence,
			flags.today,
			recommendation,
			summary,
			latestBuild,
		);
		if (!plan) {
			continue;
		}

		plans.push(plan);

		if (flags.live) {
			try {
				await api.updatePageProperties({
					pageId: page.id,
					properties: plan.properties,
				});
			} catch (error) {
				failures.push({
					title: page.title,
					error: toErrorMessage(error),
				});
			}
		}
	}

	const fieldCounts = new Map<string, number>();
	for (const plan of plans) {
		for (const field of plan.updatedFields) {
			fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
		}
	}

	const output = {
		ok: true,
		live: flags.live,
		scannedProjects: pages.length,
		projectsNeedingUpdates: plans.length,
		fieldCounts: Object.fromEntries(
			[...fieldCounts.entries()].sort((left, right) => right[1] - left[1]),
		),
		failures,
		sample: plans.slice(0, 20).map((plan) => ({
			title: plan.title,
			updatedFields: plan.updatedFields,
		})),
	};

	recordCommandOutputSummary(output);
	console.log(JSON.stringify(output, null, 2));
}

function buildFieldPlan(
	page: DataSourcePageRef,
	live: LiveProjectSnapshot,
	intelligence: ProjectIntelligenceRow | undefined,
	today: string,
	recommendation: ProjectRecommendation,
	summary: ExternalSignalSummary,
	latestBuild: LatestBuildEvidence,
): FieldPlan | null {
	const properties: Record<string, unknown> = {};
	const updatedFields: string[] = [];

	fillRichText(
		properties,
		updatedFields,
		"Primary Run Command",
		live.primaryRunCommand,
		firstNonEmpty(intelligence?.primaryRunCommand, deriveRunCommand(live)),
	);
	fillRichText(
		properties,
		updatedFields,
		"Primary Context Doc",
		live.primaryContextDoc,
		firstNonEmpty(
			intelligence?.primaryContextDoc,
			derivePrimaryContextDoc(live, intelligence),
		),
	);
	fillRichText(
		properties,
		updatedFields,
		"Summary",
		live.summary,
		firstNonEmpty(
			intelligence?.canonicalSummary,
			deriveOneLinePitch(live, intelligence),
		),
	);
	fillRichText(
		properties,
		updatedFields,
		"One-Line Pitch",
		live.oneLinePitch,
		deriveOneLinePitch(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Problem Solved",
		live.problemSolved,
		firstNonEmpty(
			intelligence?.problemSolved,
			live.oneLinePitch,
			deriveOneLinePitch(live, intelligence),
		),
	);
	fillRichText(
		properties,
		updatedFields,
		"Primary User",
		live.primaryUser,
		derivePrimaryUser(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Last Meaningful Work",
		live.lastMeaningfulWork,
		deriveLastMeaningfulWork(live, intelligence, today),
	);
	fillRichText(
		properties,
		updatedFields,
		"Known Risks",
		live.knownRisks,
		deriveKnownRisks(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Audit Notes",
		live.auditNotes,
		deriveAuditNotes(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Local Path",
		live.localPath,
		intelligence?.relativePath || live.title,
	);
	fillRichText(
		properties,
		updatedFields,
		"Start Here",
		live.startHere,
		deriveStartHere(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Stack",
		live.stack,
		firstNonEmpty(intelligence?.stack, deriveStack(live)),
	);
	fillRichText(
		properties,
		updatedFields,
		"Next Move",
		live.nextMove,
		firstNonEmpty(intelligence?.nextMove, deriveNextMove(live)),
	);
	fillRichText(
		properties,
		updatedFields,
		"Biggest Blocker",
		live.biggestBlocker,
		intelligence?.biggestBlocker || deriveBlocker(live),
	);
	fillRichText(
		properties,
		updatedFields,
		"Project Health Notes",
		live.projectHealthNotes,
		deriveProjectHealthNotes(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Key Integrations",
		live.keyIntegrations,
		deriveKeyIntegrations(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Missing Core Pieces",
		live.missingCorePieces,
		deriveMissingCorePieces(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Monetization / Strategic Value",
		live.monetizationValue,
		deriveMonetizationValue(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Value / Outcome",
		live.valueOutcome,
		deriveValueOutcome(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Completion",
		live.completion,
		deriveCompletion(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Readiness",
		live.readiness,
		deriveReadiness(live, intelligence),
	);
	fillRichText(
		properties,
		updatedFields,
		"Merged Into",
		live.mergedInto,
		deriveMergedInto(live, intelligence),
	);

	fillSelect(
		properties,
		updatedFields,
		"Status",
		live.status,
		intelligence?.canonicalStatus || "In Progress",
	);
	fillSelect(
		properties,
		updatedFields,
		"Pipeline Stage",
		live.pipelineStage,
		intelligence?.canonicalPipelineStage || "Building in Claude Code",
	);
	fillSelect(
		properties,
		updatedFields,
		"Verdict",
		live.verdict,
		intelligence?.canonicalVerdict || "Worth Building",
	);
	fillSelect(
		properties,
		updatedFields,
		"Source Group",
		live.sourceGroup,
		intelligence?.sourceGroup || "Standalone Projects",
	);
	fillSelect(
		properties,
		updatedFields,
		"Current State",
		live.currentState,
		intelligence?.currentState || "Active Build",
	);
	fillSelect(
		properties,
		updatedFields,
		"Portfolio Call",
		live.portfolioCall,
		intelligence?.portfolioCall || "Build Now",
	);
	fillSelect(
		properties,
		updatedFields,
		"Category",
		live.category,
		intelligence?.canonicalCategory || inferCategory(live, intelligence),
	);
	fillSelect(
		properties,
		updatedFields,
		"Docs Quality",
		live.docsQuality,
		intelligence?.docsQuality || inferDocsQuality(live),
	);
	fillSelect(
		properties,
		updatedFields,
		"Test Posture",
		live.testPosture,
		intelligence?.testPosture || "Unknown",
	);
	fillSelect(
		properties,
		updatedFields,
		"Evidence Confidence",
		live.evidenceConfidence,
		intelligence?.evidenceConfidence || "Low",
	);
	fillSelect(
		properties,
		updatedFields,
		"Setup Friction",
		live.setupFriction,
		intelligence?.setupFriction || "Low",
	);
	fillSelect(
		properties,
		updatedFields,
		"Runs Locally",
		live.runsLocally,
		intelligence?.runsLocally || "Unknown",
	);
	fillSelect(
		properties,
		updatedFields,
		"Build Maturity",
		live.buildMaturity,
		intelligence?.buildMaturity || "Idea",
	);
	fillSelect(
		properties,
		updatedFields,
		"Ship Readiness",
		live.shipReadiness,
		intelligence?.shipReadiness || "Not Ready",
	);
	fillSelect(
		properties,
		updatedFields,
		"Effort to Demo",
		live.effortToDemo,
		intelligence?.effortToDemo || "Unknown",
	);
	fillSelect(
		properties,
		updatedFields,
		"Effort to Ship",
		live.effortToShip,
		intelligence?.effortToShip || "Unknown",
	);
	fillSelect(
		properties,
		updatedFields,
		"Primary Tool",
		live.primaryTool,
		intelligence?.primaryTool || "codex",
	);
	fillSelect(
		properties,
		updatedFields,
		"Context Quality",
		live.contextQuality,
		intelligence?.contextQuality || "standard",
	);
	fillSelect(
		properties,
		updatedFields,
		"Recommendation Lane",
		live.recommendationLane,
		recommendation.lane,
	);
	fillSelect(
		properties,
		updatedFields,
		"Recommendation Confidence",
		live.recommendationConfidence,
		recommendation.confidence,
	);
	fillSelect(
		properties,
		updatedFields,
		"External Signal Coverage",
		live.externalSignalCoverage,
		summary.coverage,
	);
	fillSelect(
		properties,
		updatedFields,
		"Latest Deployment Status",
		live.latestDeploymentStatus,
		summary.latestDeploymentStatus,
	);

	fillMultiSelect(
		properties,
		updatedFields,
		"Project Shape",
		live.projectShape,
		firstNonEmptyArray(
			intelligence?.projectShape,
			deriveProjectShape(live, intelligence),
		),
	);
	fillMultiSelect(
		properties,
		updatedFields,
		"Deployment Surface",
		live.deploymentSurface,
		firstNonEmptyArray(
			intelligence?.deploymentSurface,
			deriveDeploymentSurface(live, intelligence),
		),
	);
	fillMultiSelect(
		properties,
		updatedFields,
		"Integration Tags",
		live.integrationTags,
		deriveIntegrationTags(live, intelligence),
	);

	fillDate(
		properties,
		updatedFields,
		"Last Active",
		live.lastActive,
		intelligence?.lastActive || today,
	);
	fillDate(
		properties,
		updatedFields,
		"Recommendation Updated",
		live.recommendationUpdated,
		today,
	);
	fillDate(
		properties,
		updatedFields,
		"External Signal Updated",
		live.externalSignalUpdated,
		summary.externalSignalUpdated || today,
	);
	fillDate(
		properties,
		updatedFields,
		"Latest External Activity",
		live.latestExternalActivity,
		summary.latestExternalActivity || intelligence?.lastActive || today,
	);
	fillDate(
		properties,
		updatedFields,
		"Last Build Session Date",
		live.lastBuildSessionDate,
		latestBuild.date,
	);

	fillNumber(
		properties,
		updatedFields,
		"Recommendation Score",
		live.recommendationScore,
		recommendation.score,
	);
	fillNumber(
		properties,
		updatedFields,
		"Open PR Count",
		live.openPrCount,
		summary.openPrCount,
	);
	fillNumber(
		properties,
		updatedFields,
		"Recent Failed Workflow Runs",
		live.recentFailedWorkflowRuns,
		summary.recentFailedWorkflowRuns,
	);

	if (updatedFields.length === 0) {
		return null;
	}

	return {
		title: page.title,
		pageId: page.id,
		properties,
		updatedFields,
	};
}

function readLiveProjectSnapshot(page: DataSourcePageRef): LiveProjectSnapshot {
	return {
		title: page.title,
		status: selectValue(page.properties.Status),
		pipelineStage: selectValue(page.properties["Pipeline Stage"]),
		currentState: selectValue(page.properties["Current State"]),
		portfolioCall: selectValue(page.properties["Portfolio Call"]),
		category: selectValue(page.properties.Category),
		summary: textValue(page.properties.Summary),
		sourceGroup: selectValue(page.properties["Source Group"]),
		localPath: textValue(page.properties["Local Path"]),
		auditNotes: textValue(page.properties["Audit Notes"]),
		verdict: selectValue(page.properties.Verdict),
		oneLinePitch:
			textValue(page.properties["One-Line Pitch"]) ||
			textValue(page.properties.Summary),
		nextMove: textValue(page.properties["Next Move"]),
		biggestBlocker: textValue(page.properties["Biggest Blocker"]),
		lastActive: page.properties["Last Active"]?.date?.start?.slice(0, 10) ?? "",
		stack: textValue(page.properties.Stack),
		projectShape: (page.properties["Project Shape"]?.multi_select ?? [])
			.map((entry) => entry.name ?? "")
			.filter(Boolean),
		deploymentSurface: (
			page.properties["Deployment Surface"]?.multi_select ?? []
		)
			.map((entry) => entry.name ?? "")
			.filter(Boolean),
		docsQuality: selectValue(page.properties["Docs Quality"]),
		testPosture: selectValue(page.properties["Test Posture"]),
		evidenceConfidence: selectValue(page.properties["Evidence Confidence"]),
		startHere: textValue(page.properties["Start Here"]),
		primaryRunCommand: textValue(page.properties["Primary Run Command"]),
		primaryContextDoc: textValue(page.properties["Primary Context Doc"]),
		setupFriction: selectValue(page.properties["Setup Friction"]),
		runsLocally: selectValue(page.properties["Runs Locally"]),
		lastMeaningfulWork: textValue(page.properties["Last Meaningful Work"]),
		primaryUser: textValue(page.properties["Primary User"]),
		problemSolved: textValue(page.properties["Problem Solved"]),
		valueOutcome: textValue(page.properties["Value / Outcome"]),
		buildMaturity: selectValue(page.properties["Build Maturity"]),
		shipReadiness: selectValue(page.properties["Ship Readiness"]),
		effortToDemo: selectValue(page.properties["Effort to Demo"]),
		effortToShip: selectValue(page.properties["Effort to Ship"]),
		monetizationValue: textValue(
			page.properties["Monetization / Strategic Value"],
		),
		keyIntegrations: textValue(page.properties["Key Integrations"]),
		projectHealthNotes: textValue(page.properties["Project Health Notes"]),
		knownRisks: textValue(page.properties["Known Risks"]),
		whatWorks: textValue(page.properties["What Works"]),
		missingCorePieces: textValue(page.properties["Missing Core Pieces"]),
		primaryTool: selectValue(page.properties["Primary Tool"]),
		contextQuality: selectValue(page.properties["Context Quality"]),
		completion: textValue(page.properties.Completion),
		readiness: textValue(page.properties.Readiness),
		mergedInto: textValue(page.properties["Merged Into"]),
		integrationTags: (page.properties["Integration Tags"]?.multi_select ?? [])
			.map((entry) => entry.name ?? "")
			.filter(Boolean),
		lastBuildSessionDate:
			page.properties["Last Build Session Date"]?.date?.start?.slice(0, 10) ??
			"",
		externalSignalCoverage: selectValue(
			page.properties["External Signal Coverage"],
		),
		latestExternalActivity:
			page.properties["Latest External Activity"]?.date?.start?.slice(0, 10) ??
			"",
		latestDeploymentStatus: selectValue(
			page.properties["Latest Deployment Status"],
		),
		openPrCount: page.properties["Open PR Count"]?.number ?? null,
		recentFailedWorkflowRuns:
			page.properties["Recent Failed Workflow Runs"]?.number ?? null,
		externalSignalUpdated:
			page.properties["External Signal Updated"]?.date?.start?.slice(0, 10) ??
			"",
		recommendationLane: selectValue(page.properties["Recommendation Lane"]),
		recommendationScore:
			page.properties["Recommendation Score"]?.number ?? null,
		recommendationConfidence: selectValue(
			page.properties["Recommendation Confidence"],
		),
		recommendationUpdated:
			page.properties["Recommendation Updated"]?.date?.start?.slice(0, 10) ??
			"",
	};
}

function fillRichText(
	properties: Record<string, unknown>,
	updatedFields: string[],
	name: string,
	current: string,
	fallback: string,
): void {
	if (current.trim() || !fallback.trim()) {
		return;
	}
	properties[name] = richTextValue(ensureSentence(fallback));
	updatedFields.push(name);
}

function fillSelect(
	properties: Record<string, unknown>,
	updatedFields: string[],
	name: string,
	current: string,
	fallback: string,
): void {
	if (current.trim() || !fallback.trim()) {
		return;
	}
	properties[name] = selectPropertyValue(fallback);
	updatedFields.push(name);
}

function fillMultiSelect(
	properties: Record<string, unknown>,
	updatedFields: string[],
	name: string,
	current: string[],
	fallback: string[],
): void {
	if (current.length > 0 || fallback.length === 0) {
		return;
	}
	properties[name] = multiSelectValue(fallback);
	updatedFields.push(name);
}

function fillDate(
	properties: Record<string, unknown>,
	updatedFields: string[],
	name: string,
	current: string,
	fallback: string,
): void {
	if (current.trim() || !fallback.trim()) {
		return;
	}
	properties[name] = datePropertyValue(fallback);
	updatedFields.push(name);
}

function fillNumber(
	properties: Record<string, unknown>,
	updatedFields: string[],
	name: string,
	current: number | null,
	fallback: number,
): void {
	if (typeof current === "number") {
		return;
	}
	properties[name] = { number: fallback };
	updatedFields.push(name);
}

function deriveRunCommand(live: LiveProjectSnapshot): string {
	if (live.startHere.trim()) {
		return (
			live.startHere.replace(/^Open\s+/i, "").trim() ||
			"Open the local files directly"
		);
	}
	return "Open the local files directly";
}

function derivePrimaryContextDoc(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.primaryContextDoc?.trim()) {
		return intelligence.primaryContextDoc;
	}
	return "README.md";
}

function deriveOneLinePitch(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.oneLinePitch?.trim()) {
		return intelligence.oneLinePitch;
	}
	const override = SPECIAL_SUMMARY_OVERRIDES.get(live.title);
	if (override) {
		return override;
	}
	return `${humanizeTitle(live.title)} is the current operating project row for this workflow and its next build slice.`;
}

function derivePrimaryUser(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const text =
		`${live.category} ${live.oneLinePitch} ${intelligence?.canonicalSummary ?? ""}`.toLowerCase();
	if (/incident|ticket|support|kb|notion|internal|ops/.test(text)) {
		return "Internal operators and support-facing power users.";
	}
	if (/job|resume|application/.test(text)) {
		return "The solo operator managing the job-search workflow and its outputs.";
	}
	if (/game|creative|studio|album|visual/.test(text)) {
		return "End users exploring the interactive experience plus the solo builder shaping it.";
	}
	if (/developer|repo|audit|cli|tool|translator|mcp/.test(text)) {
		return "The solo builder and other technical power users running the workflow directly.";
	}
	return "The solo builder and internal power users who need this workflow to work reliably.";
}

function deriveLastMeaningfulWork(
	live: LiveProjectSnapshot,
	intelligence: ProjectIntelligenceRow | undefined,
	today: string,
): string {
	const anchor = live.lastActive || intelligence?.lastActive || today;
	const state = (
		live.currentState ||
		intelligence?.currentState ||
		"Active Build"
	).toLowerCase();
	return `The latest meaningful work was captured around ${anchor}, and the project is currently in a ${state} posture.`;
}

function deriveKnownRisks(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const blocker = firstNonEmpty(
		live.biggestBlocker,
		intelligence?.biggestBlocker,
	);
	if (blocker) {
		return blocker;
	}
	if ((live.runsLocally || "").toLowerCase() === "unknown") {
		return "The main risk is that the current local run path has not been revalidated recently.";
	}
	return "The main risk is that the core workflow still needs a fresh end-to-end validation pass.";
}

function deriveProjectHealthNotes(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const state =
		live.currentState || intelligence?.currentState || "Active Build";
	const build =
		live.buildMaturity || intelligence?.buildMaturity || "Functional Core";
	const readiness =
		live.shipReadiness || intelligence?.shipReadiness || "Needs Hardening";
	return `${state} — build maturity is ${build.toLowerCase()} and ship readiness is ${readiness.toLowerCase()}.`;
}

function deriveAuditNotes(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const summary = firstNonEmpty(
		live.oneLinePitch,
		intelligence?.canonicalSummary,
		deriveOneLinePitch(live, intelligence),
	);
	return `Audit refresh captured this project as ${summary.toLowerCase()}`;
}

function deriveKeyIntegrations(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.keyIntegrations?.trim()) {
		return intelligence.keyIntegrations;
	}
	const parts = uniqueStrings([
		...live.deploymentSurface,
		live.stack,
		live.primaryTool,
		...live.integrationTags,
		live.primaryContextDoc,
	]);
	if (parts.length > 0) {
		return parts.join(", ");
	}
	return "Local repo workflow, Notion project tracking, and the primary run path documented on the page.";
}

function deriveMissingCorePieces(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.missingCorePieces?.trim()) {
		return intelligence.missingCorePieces;
	}
	const blocker = firstNonEmpty(
		live.biggestBlocker,
		intelligence?.biggestBlocker,
	);
	if (blocker) {
		return `Still needs the blocker resolved: ${trimTrailingPeriod(blocker)}.`;
	}
	const readiness =
		live.shipReadiness || intelligence?.shipReadiness || "Not Ready";
	if (readiness === "Ship-Ready") {
		return "Still needs final packaging, launch proof, and a tidy release handoff.";
	}
	return "Still needs a verified end-to-end workflow, stronger proof capture, and a tighter next execution slice.";
}

function deriveMonetizationValue(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const text =
		`${live.category} ${live.oneLinePitch} ${intelligence?.canonicalSummary ?? ""}`.toLowerCase();
	if (/commercial|saas|compliance|job|application/.test(text)) {
		return "Commercial upside with strong portfolio proof if the workflow is finished and validated.";
	}
	if (/incident|support|knowledge|notion|ops/.test(text)) {
		return "Strategic internal leverage by turning repeated operational work into a reusable system.";
	}
	if (/game|creative|studio|visual/.test(text)) {
		return "High showcase value if the project is pushed to a polished, demo-ready finish.";
	}
	if (/foundation|library|reusable|mcp|tool/.test(text)) {
		return "Strategic portfolio leverage because the project can compound across multiple future builds.";
	}
	return "Strategic value comes from turning the current workflow into a stronger proof point and reusable portfolio asset.";
}

function deriveValueOutcome(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.valueOutcome?.trim()) {
		return intelligence.valueOutcome;
	}
	const summary = firstNonEmpty(
		live.problemSolved,
		live.oneLinePitch,
		intelligence?.canonicalSummary,
	);
	if (!summary) {
		return "Turns this project into a clearer portfolio proof point once the next slice is validated.";
	}
	return `Turns the current ${summary.toLowerCase()} into a clearer portfolio asset once the next slice is validated.`;
}

function deriveCompletion(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.completion?.trim()) {
		return intelligence.completion;
	}
	const state = (
		live.currentState ||
		intelligence?.currentState ||
		"Active Build"
	).toLowerCase();
	if (state === "shipped") {
		return "Core workflow is already shipped; remaining work is maintenance, polish, and stronger release proof.";
	}
	if (state === "ready for review" || state === "ready to demo") {
		return "Core workflow is largely in place, but the project still needs validation, polish, and a bounded finish slice before it can be treated as complete.";
	}
	if (state === "parked" || state === "archived") {
		return "A partial foundation exists, but completion is intentionally paused unless the project is reopened.";
	}
	return "The project has a real foundation, but completion still depends on executing the next build slice, resolving the main blocker, and proving the core workflow end to end.";
}

function deriveReadiness(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.readiness?.trim()) {
		return intelligence.readiness;
	}
	const build =
		live.buildMaturity || intelligence?.buildMaturity || "Functional Core";
	const readiness =
		live.shipReadiness || intelligence?.shipReadiness || "Not Ready";
	const docs = (
		live.docsQuality ||
		intelligence?.docsQuality ||
		"Usable"
	).toLowerCase();
	const tests = (
		live.testPosture ||
		intelligence?.testPosture ||
		"unknown"
	).toLowerCase();
	const runStatus = (
		live.runsLocally ||
		intelligence?.runsLocally ||
		"Unknown"
	).toLowerCase();
	return `${build} with ${readiness.toLowerCase()} posture. Docs are ${docs}, tests are ${tests}, local run status is ${runStatus}, and the next move is ${trimTrailingPeriod(firstNonEmpty(live.nextMove, intelligence?.nextMove, "to verify the main workflow"))}.`;
}

function deriveMergedInto(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.mergedInto?.trim()) {
		return intelligence.mergedInto;
	}
	if (/\(staging\)/i.test(live.title)) {
		return "Canonical staging surface for this project.";
	}
	return "No merge target; treat this row as the canonical operating surface.";
}

function deriveRegistryStatus(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const state = (
		live.currentState ||
		intelligence?.currentState ||
		""
	).toLowerCase();
	if (state === "archived") {
		return "archived";
	}
	if (state === "parked") {
		return "parked";
	}
	return "active";
}

function deriveStartHere(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	if (intelligence?.startHere?.trim()) {
		return intelligence.startHere;
	}
	const command = deriveRunCommand(live);
	return command === "Open the local files directly"
		? "Open the local files directly and confirm the primary workflow."
		: `Run ${command} and verify the primary workflow.`;
}

function deriveStack(live: LiveProjectSnapshot): string {
	return SPECIAL_STACK_OVERRIDES.get(live.title) ?? "Local project workflow";
}

function deriveNextMove(live: LiveProjectSnapshot): string {
	const command = deriveRunCommand(live);
	return command === "Open the local files directly"
		? "Open the local files directly, confirm the intended workflow, and capture the next real blocker."
		: `Run ${command}, verify the happy path, and capture the first blocker.`;
}

function deriveBlocker(live: LiveProjectSnapshot): string {
	if (SPECIAL_BLOCKER_OVERRIDES.has(live.title)) {
		return SPECIAL_BLOCKER_OVERRIDES.get(live.title) ?? "";
	}
	return "A specific blocker is not documented yet; rerun the primary workflow and capture the first failure.";
}

function inferCategory(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string {
	const text =
		`${live.title} ${live.oneLinePitch} ${intelligence?.canonicalSummary ?? ""}`.toLowerCase();
	if (/incident|ticket|support|ops|notion|audit|github|mcp/.test(text)) {
		return "IT Tool";
	}
	if (/desktop|macos|menu bar|clipboard/.test(text)) {
		return "Desktop App";
	}
	return "Dev Tool";
}

function inferDocsQuality(live: LiveProjectSnapshot): string {
	return live.primaryContextDoc.trim() ? "Usable" : "Missing";
}

function deriveProjectShape(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string[] {
	if (/\bsandbox\b/i.test(live.title)) {
		return ["System", "Tool"];
	}
	const category =
		live.category ||
		intelligence?.canonicalCategory ||
		inferCategory(live, intelligence);
	if (/desktop/i.test(category)) {
		return ["Product", "Tool"];
	}
	if (/it tool|dev tool/i.test(category)) {
		return ["Tool"];
	}
	return ["Tool"];
}

function deriveDeploymentSurface(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string[] {
	if (/\bsandbox\b/i.test(live.title)) {
		return ["Internal Tool"];
	}
	const text =
		`${live.title} ${live.oneLinePitch} ${live.stack} ${intelligence?.canonicalSummary ?? ""}`.toLowerCase();
	const values: string[] = [];
	if (/desktop|macos|menu bar|clipboard/.test(text)) {
		values.push("Desktop");
	}
	if (/web|dashboard|portal|page/.test(text)) {
		values.push("Web");
	}
	if (/cli|audit|scaffold|mcp/.test(text)) {
		values.push("CLI");
	}
	if (/internal|ops|support|sandbox/.test(text)) {
		values.push("Internal Tool");
	}
	if (
		values.length === 0 &&
		(live.localPath.trim() || intelligence?.relativePath?.trim())
	) {
		values.push("CLI");
	}
	return uniqueStrings(values.length > 0 ? values : ["Web"]);
}

function deriveIntegrationTags(
	live: LiveProjectSnapshot,
	intelligence?: ProjectIntelligenceRow,
): string[] {
	const text =
		`${deriveKeyIntegrations(live, intelligence)} ${live.stack} ${live.title} ${live.localPath} ${intelligence?.relativePath ?? ""}`.toLowerCase();
	const values = new Set<string>();
	if (/github/.test(text)) {
		values.add("GitHub");
	}
	if (/notion/.test(text)) {
		values.add("Notion");
	}
	if (/sqlite/.test(text)) {
		values.add("SQLite");
	}
	if (/ollama/.test(text)) {
		values.add("Ollama");
	}
	if (/vercel/.test(text)) {
		values.add("Vercel");
	}
	if (/slack/.test(text)) {
		values.add("Slack");
	}
	if (
		values.size === 0 &&
		(live.localPath.trim() || intelligence?.relativePath?.trim())
	) {
		values.add("GitHub");
	}
	return [...values];
}

function groupBuildSessionsByProjectId(
	buildSessions: ControlTowerBuildSessionRecord[],
): Map<string, ControlTowerBuildSessionRecord[]> {
	return buildSessions.reduce<Map<string, ControlTowerBuildSessionRecord[]>>(
		(map, session) => {
			for (const projectId of session.localProjectIds) {
				const bucket = map.get(projectId) ?? [];
				bucket.push(session);
				map.set(projectId, bucket);
			}
			return map;
		},
		new Map(),
	);
}

function groupWorkflowRunsByProjectId(
	events: ExternalSignalEventRecord[],
): Map<string, ExternalSignalEventRecord[]> {
	return events
		.filter((event) => event.signalType === "Workflow Run" && event.occurredAt)
		.reduce<Map<string, ExternalSignalEventRecord[]>>((map, event) => {
			for (const projectId of event.localProjectIds) {
				const bucket = map.get(projectId) ?? [];
				bucket.push(event);
				map.set(projectId, bucket);
			}
			return map;
		}, new Map());
}

function deriveLatestBuildEvidence(input: {
	buildSessions: ControlTowerBuildSessionRecord[];
	workflowRuns: ExternalSignalEventRecord[];
	live: LiveProjectSnapshot;
	intelligence?: ProjectIntelligenceRow;
	summary: ExternalSignalSummary;
	today: string;
}): LatestBuildEvidence {
	const latestBuildSession = input.buildSessions
		.map((session) => ({
			date: session.sessionDate,
			label: session.title || "Build session",
		}))
		.filter((entry) => entry.date)
		.sort((left, right) => right.date.localeCompare(left.date))[0];
	const latestWorkflowRun = input.workflowRuns
		.map((event) => ({
			date: event.occurredAt,
			label: event.summary || "GitHub workflow run",
		}))
		.filter((entry) => entry.date)
		.sort((left, right) => right.date.localeCompare(left.date))[0];

	if (latestBuildSession && latestWorkflowRun) {
		return latestWorkflowRun.date > latestBuildSession.date
			? { ...latestWorkflowRun, source: "workflow_run" }
			: { ...latestBuildSession, source: "build_session" };
	}
	if (latestBuildSession) {
		return { ...latestBuildSession, source: "build_session" };
	}
	if (latestWorkflowRun) {
		return { ...latestWorkflowRun, source: "workflow_run" };
	}

	return {
		date:
			input.summary.latestExternalActivity ||
			input.live.lastActive ||
			input.intelligence?.lastActive ||
			input.today,
		label: "No recorded build session yet",
		source: "fallback",
	};
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function firstNonEmptyArray(...values: Array<string[] | undefined>): string[] {
	return values.find((value) => Array.isArray(value) && value.length > 0) ?? [];
}

function ensureSentence(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return "";
	}
	return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function trimTrailingPeriod(value: string): string {
	return value.trim().replace(/[.!?]+$/, "");
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/\(.*?\)/g, "")
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9]+/g, "");
}

function humanizeTitle(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim();
}

const SPECIAL_SUMMARY_OVERRIDES = new Map<string, string>([
	[
		"Screenshot to Data Select",
		"Desktop workflow for turning screenshots into structured selections and usable data outputs.",
	],
	[
		"da-scaffold",
		"Starter scaffold for quickly spinning up new local project experiments without rebuilding the operating defaults from scratch.",
	],
	[
		"Sandbox Local Portfolio Project",
		"Safe sandbox for testing local portfolio actuation, Notion wiring, and operating-system workflow changes.",
	],
]);

const SPECIAL_STACK_OVERRIDES = new Map<string, string>([
	[
		"Screenshot to Data Select",
		"Desktop workflow, screenshot processing, local selection tooling",
	],
	[
		"da-scaffold",
		"Project scaffolding, local templates, developer workflow tooling",
	],
	[
		"Sandbox Local Portfolio Project",
		"Notion workflow sandbox, local portfolio automation, internal tooling",
	],
]);

const SPECIAL_BLOCKER_OVERRIDES = new Map<string, string>([
	[
		"Sandbox Local Portfolio Project",
		"The main blocker is deciding which sandbox experiments should be promoted into durable workflow changes versus left isolated.",
	],
]);

void main().catch((error) => {
	console.error(toErrorMessage(error));
	process.exit(1);
});
