import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	type DataSourcePageRef,
	datePropertyValue,
	fetchAllPages,
	multiSelectValue,
	relationValue,
	richTextValue,
	selectPropertyValue,
	textValue,
	titleValue,
	upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH,
	type LocalPortfolioExternalSignalSourceConfig,
	type ManualExternalSignalSeedPlan,
} from "./local-portfolio-external-signals.js";

const execFileAsync = promisify(execFile);
const TODAY = losAngelesToday();
const DEFAULT_OWNER = "saagpatel";

interface Flags {
	live: boolean;
	owner: string;
	limit?: number;
	today: string;
	config: string;
	sourceConfig: string;
}

interface GitHubRepo {
	name: string;
	description?: string | null;
	primaryLanguage?: { name?: string | null } | null;
	repositoryTopics?: Array<
		string | { topic?: { name?: string | null } | null }
	> | null;
	isArchived: boolean;
	isFork: boolean;
	isPrivate: boolean;
	url: string;
	createdAt: string;
	updatedAt: string;
}

interface ProjectMetadata {
	displayName: string;
	oneLinePitch: string;
	nextMove: string;
	biggestBlocker: string;
	valueOutcome: string;
	monetizationValue: string;
	currentState: string;
	portfolioCall: string;
	buildMaturity: string;
	shipReadiness: string;
	effortToDemo: string;
	effortToShip: string;
	testPosture: string;
	docsQuality: string;
	evidenceConfidence: string;
	category: string;
	projectShape: string[];
	deploymentSurface: string[];
	primaryTool: string;
	contextQuality: string;
	stack: string;
	keyIntegrations: string;
	integrationTags: string[];
	startHere: string;
}

interface RepoPlan {
	repo: GitHubRepo;
	metadata: ProjectMetadata;
	localProject?: DataSourcePageRef;
	intakeProject?: DataSourcePageRef;
	sourceRow?: DataSourcePageRef;
	needsLocalProject: boolean;
	needsSourceRow: boolean;
}

interface ManualSeedSummary {
	identifier: string;
	title: string;
	localProjectId: string;
}

const DISPLAY_NAME_OVERRIDES = new Map<string, string>([
	["APIReverse", "API Reverse"],
	["BrowserHistoryVisualizer", "Browser History Visualizer"],
	["devils-advocate", "Devils Advocate"],
	["GithubRepoAuditor", "GitHub Repo Auditor"],
	["HowMoneyMoves", "How Money Moves"],
	["JSMTicketAnalyticsExport", "JSM Ticket Analytics Export"],
	["JobMarketHeatmap", "Job Market Heatmap"],
	["LifeCadenceLedger", "Life Cadence Ledger"],
	["MCPAudit", "MCP Audit"],
	["mcpforge", "MCP Forge"],
	["NetworkDecoder", "Network Decoder"],
	["NetworkMapper", "Network Mapper"],
	["NeuralNetwork", "Neural Network"],
	["notion-operating-system", "Notion Operating System"],
	["PageDiffBookmark", "Page Diff Bookmark"],
	["personal-ops", "Personal Ops"],
	["Pulse-Orbit", "Pulse Orbit"],
	["RedditSentimentAnalyzer", "Reddit Sentiment Analyzer"],
	["ScreenshottoDataSelect", "Screenshot to Data Select"],
]);

const EXISTING_PROJECT_ALIASES = new Map<string, string[]>([
	["FreelanceInvoice", ["FreeLanceInvoice"]],
	["GhostRoutes", ["Ghost Routes"]],
	["HowMoneyMoves", ["How Money Moves"]],
	["IncidentManagement", ["IncidentMgmt"]],
	["InterruptionResumeStudio", ["Interruption Resume Studio"]],
	["JSMTicketAnalyticsExport", ["JSM Ticket Analytics Export"]],
	["KBFreshness", ["KBFreshnessDetector"]],
	["LifeCadenceLedger", ["Life Cadence Ledger"]],
	["OrbitMechanics", ["OrbitMechanic"]],
	["PhantomFrequencies", ["Phantom Frequencies"]],
	["portfolio-actuation-sandbox", ["Sandbox Local Portfolio Project"]],
	["Pulse-Orbit", ["Pulse Orbit"]],
	["seismoscope", ["Seismoscope"]],
	["signal-noise", ["Signal & Noise"]],
	["sovereign", ["Sovereign"]],
]);

function parseFlags(argv: string[]): Flags {
	let live = false;
	let owner = DEFAULT_OWNER;
	let limit: number | undefined;
	let today = TODAY;
	let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
	let sourceConfig = DEFAULT_LOCAL_PORTFOLIO_EXTERNAL_SIGNAL_SOURCES_PATH;

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === "--live") {
			live = true;
			continue;
		}
		if (current === "--owner") {
			owner = argv[index + 1] ?? owner;
			index += 1;
			continue;
		}
		if (current === "--limit") {
			const raw = argv[index + 1];
			if (!raw) {
				throw new AppError("Expected a numeric value after --limit");
			}
			limit = Number(raw);
			index += 1;
			continue;
		}
		if (current === "--today") {
			today = argv[index + 1] ?? today;
			index += 1;
			continue;
		}
		if (current === "--config") {
			config = argv[index + 1] ?? config;
			index += 1;
			continue;
		}
		if (current === "--source-config") {
			sourceConfig = argv[index + 1] ?? sourceConfig;
			index += 1;
		}
	}

	return {
		live,
		owner,
		limit,
		today,
		config,
		sourceConfig,
	};
}

async function main(): Promise<void> {
	const flags = parseFlags(process.argv.slice(2));
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for GitHub versus Notion catch-up",
	);
	const config = await loadLocalPortfolioControlTowerConfig(flags.config);
	const sourceConfig =
		await readJsonFile<LocalPortfolioExternalSignalSourceConfig>(
			flags.sourceConfig,
		);
	const sdk = new Client({
		auth: token,
		notionVersion: "2026-03-11",
	});
	const api = new DirectNotionClient(token);

	const [repos, localProjects, intakeProjects, sourceRows] = await Promise.all([
		listGitHubRepos(flags.owner, flags.limit),
		fetchAllPages(sdk, config.database.dataSourceId, "Name"),
		fetchAllPages(sdk, "35e04e4d-bcd8-45c0-b783-238edef210f7", "Project Name"),
		fetchAllPages(
			sdk,
			config.phase5ExternalSignals!.sources.dataSourceId,
			"Name",
		),
	]);

	const plans = buildRepoPlans({
		repos,
		localProjects,
		intakeProjects,
		sourceRows,
		owner: flags.owner,
		today: flags.today,
	});

	const plansToTouch = plans.filter(
		(plan) => plan.needsLocalProject || plan.needsSourceRow,
	);
	const createdProjects: Array<{
		repo: string;
		title: string;
		id: string;
		url: string;
	}> = [];
	const createdSources: Array<{
		repo: string;
		title: string;
		id: string;
		url: string;
		existed: boolean;
	}> = [];
	const manualSeedSummaries: ManualSeedSummary[] = [];

	if (flags.live) {
		for (const plan of plansToTouch) {
			const projectPage = plan.needsLocalProject
				? await createLocalProject({
						api,
						dataSourceId: config.database.dataSourceId,
						metadata: plan.metadata,
						owner: flags.owner,
						repo: plan.repo,
						today: flags.today,
					})
				: plan.localProject;

			if (!projectPage) {
				throw new AppError(
					`Could not resolve local project page for ${plan.repo.name}`,
				);
			}

			if (plan.needsLocalProject) {
				createdProjects.push({
					repo: plan.repo.name,
					title: projectPage.title,
					id: projectPage.id,
					url: projectPage.url,
				});
			}

			if (plan.needsSourceRow || plan.sourceRow) {
				const sourceResult = await upsertOrRepairSource({
					api,
					dataSourceId: config.phase5ExternalSignals!.sources.dataSourceId,
					existingRow: plan.sourceRow,
					owner: flags.owner,
					projectId: projectPage.id,
					repo: plan.repo,
					sourceTitle: sourceTitle(plan.metadata.displayName),
					today: flags.today,
				});
				if (plan.needsSourceRow) {
					createdSources.push({
						repo: plan.repo.name,
						title: sourceResult.title,
						id: sourceResult.id,
						url: sourceResult.url,
						existed: sourceResult.existed,
					});
				}

				manualSeedSummaries.push({
					identifier: `${flags.owner}/${plan.repo.name}`,
					title: sourceTitle(plan.metadata.displayName),
					localProjectId: projectPage.id,
				});
			}
		}

		if (manualSeedSummaries.length > 0) {
			await syncManualSeeds(
				sourceConfig,
				flags.sourceConfig,
				flags.owner,
				repos,
				manualSeedSummaries,
			);
		}
	}

	const output = {
		ok: true,
		live: flags.live,
		owner: flags.owner,
		repoCount: repos.length,
		missingLocalProjectCount: plans.filter((plan) => plan.needsLocalProject)
			.length,
		missingSourceRowCount: plans.filter((plan) => plan.needsSourceRow).length,
		plansToTouch: plansToTouch.map((plan) => ({
			repo: plan.repo.name,
			displayName: plan.metadata.displayName,
			needsLocalProject: plan.needsLocalProject,
			needsSourceRow: plan.needsSourceRow,
			existingLocalProject: plan.localProject?.title ?? null,
			existingIntakeProject: plan.intakeProject?.title ?? null,
			existingSourceRow: plan.sourceRow?.title ?? null,
		})),
		createdProjects,
		createdSources,
		syncedManualSeeds: manualSeedSummaries.map((entry) => entry.identifier),
	};

	recordCommandOutputSummary(output);
	console.log(JSON.stringify(output, null, 2));
}

function buildRepoPlans(input: {
	repos: GitHubRepo[];
	localProjects: DataSourcePageRef[];
	intakeProjects: DataSourcePageRef[];
	sourceRows: DataSourcePageRef[];
	owner: string;
	today: string;
}): RepoPlan[] {
	return input.repos.map((repo) => {
		const metadata = inferProjectMetadata(repo, input.today);
		const projectCandidates = buildProjectCandidates(
			repo.name,
			metadata.displayName,
		);
		const localProject = findFirstMatch(input.localProjects, projectCandidates);
		const intakeProject = localProject
			? undefined
			: findFirstMatch(input.intakeProjects, projectCandidates);
		const sourceRow = findSourceRow(
			input.sourceRows,
			input.owner,
			repo.name,
			metadata.displayName,
		);

		return {
			repo,
			metadata,
			localProject,
			intakeProject,
			sourceRow,
			needsLocalProject: !localProject,
			needsSourceRow: !sourceRow,
		};
	});
}

function buildProjectCandidates(
	repoName: string,
	displayName: string,
): string[] {
	const aliases = EXISTING_PROJECT_ALIASES.get(repoName) ?? [];
	return uniqueStrings([repoName, displayName, ...aliases]);
}

function findFirstMatch(
	pages: DataSourcePageRef[],
	candidates: string[],
): DataSourcePageRef | undefined {
	const normalizedCandidates = new Set(candidates.map(normalizeKey));
	return pages.find((page) =>
		normalizedCandidates.has(normalizeKey(page.title)),
	);
}

function findSourceRow(
	pages: DataSourcePageRef[],
	owner: string,
	repoName: string,
	displayName: string,
): DataSourcePageRef | undefined {
	const identifier = `${owner}/${repoName}`;
	const candidates = new Set([
		normalizeKey(identifier),
		normalizeKey(sourceTitle(displayName)),
		normalizeKey(`${displayName} GitHub Repo`),
		normalizeKey(`${repoName} - GitHub Repo`),
		normalizeKey(`${repoName} GitHub Repo`),
		normalizeKey(repoName),
	]);

	return pages.find((page) => {
		const titleKey = normalizeKey(page.title);
		const identifierKey = normalizeKey(textValue(page.properties.Identifier));
		return candidates.has(titleKey) || candidates.has(identifierKey);
	});
}

function inferProjectMetadata(
	repo: GitHubRepo,
	today: string,
): ProjectMetadata {
	const displayName = displayNameForRepo(repo.name);
	const description = repo.description?.trim() || `${displayName} repository`;
	const primaryLanguage = repo.primaryLanguage?.name?.trim() || "Unknown";
	const topics = normalizeTopics(repo.repositoryTopics);
	const haystack =
		`${repo.name} ${displayName} ${description} ${topics.join(" ")}`.toLowerCase();
	const ageDays = daysBetween(repo.createdAt, today);
	const category = inferCategory(haystack);
	const deploymentSurface = inferDeploymentSurface(haystack, primaryLanguage);
	const projectShape = inferProjectShape(category, haystack);
	const docsQuality = repo.description?.trim() ? "Usable" : "Missing";
	const buildMaturity =
		ageDays <= 2 && !repo.description?.trim()
			? "Scaffolded"
			: ageDays <= 2
				? "Scaffolded"
				: "Functional Core";
	const shipReadiness =
		buildMaturity === "Scaffolded" ? "Not Ready" : "Needs Hardening";
	const cleanedDescription = stripTrailingPeriod(description);
	const oneLinePitch =
		cleanedDescription.charAt(0).toUpperCase() + cleanedDescription.slice(1);
	const valueOutcome =
		category === "Reasoning Tool"
			? `${displayName} packages a real thinking or analysis workflow into a product that can be demoed, evaluated, and prioritized.`
			: category === "IT Tool"
				? `${displayName} turns an operational workflow into a reusable internal tool instead of leaving the work trapped in one-off manual steps.`
				: `${displayName} gives the portfolio a concrete build surface with a clear user problem, a live repo, and a next delivery lane.`;
	const monetizationValue =
		category === "Commercial SaaS" || category === "Desktop App"
			? `Strong product and portfolio upside if ${displayName} keeps moving from active build to a demo-ready slice.`
			: `${displayName} has immediate portfolio value and can also deepen the internal tooling surface if the next proof points land cleanly.`;
	const keyIntegrations = inferKeyIntegrations(
		description,
		primaryLanguage,
		topics,
		deploymentSurface,
	);
	const integrationTags = inferIntegrationTags(
		`${description} ${topics.join(" ")} ${primaryLanguage}`,
	);

	return {
		displayName,
		oneLinePitch,
		nextMove:
			"Review the repo, confirm the best run path, and capture the first evidence-backed next slice so the new project has a trustworthy operating posture.",
		biggestBlocker:
			"This repo was missing its operating Notion row and GitHub source mapping, so it still needs first-pass triage and proof capture.",
		valueOutcome,
		monetizationValue,
		currentState: "Active Build",
		portfolioCall: "Build Now",
		buildMaturity,
		shipReadiness,
		effortToDemo: "Unknown",
		effortToShip: "Unknown",
		testPosture: "Unknown",
		docsQuality,
		evidenceConfidence: "Medium",
		category,
		projectShape,
		deploymentSurface,
		primaryTool: "codex",
		contextQuality: "standard",
		stack: primaryLanguage === "Unknown" ? "" : primaryLanguage,
		keyIntegrations,
		integrationTags,
		startHere: `Review ${repo.url} and capture the first reliable run path, proof point, or blocker.`,
	};
}

function inferCategory(haystack: string): string {
	if (
		/\bincident\b|\bticket\b|\bworkflow\b|\bsupport\b|\bnetwork\b|\bops\b|\bnotion\b|\bcontrol plane\b/.test(
			haystack,
		)
	) {
		return "IT Tool";
	}
	if (
		/\bdebate\b|\bcritique\b|\bsentiment\b|\bheatmap\b|\bconviction\b|\bneural\b/.test(
			haystack,
		)
	) {
		return "Reasoning Tool";
	}
	if (/\bdesktop\b|\bmacos\b|\bmenu bar\b/.test(haystack)) {
		return "Desktop App";
	}
	return "Dev Tool";
}

function inferProjectShape(category: string, haystack: string): string[] {
	if (category === "Reasoning Tool") {
		return ["Product", "Tool"];
	}
	if (/\bcontrol plane\b|\boperating system\b|\bsystem\b/.test(haystack)) {
		return ["System", "Tool"];
	}
	return ["Tool"];
}

function inferDeploymentSurface(
	haystack: string,
	primaryLanguage: string,
): string[] {
	const values = new Set<string>();
	if (/\bdesktop\b|\bmacos\b|\bmenu bar\b/.test(haystack)) {
		values.add("Desktop");
	}
	if (
		/\bweb\b|\bdashboard\b|\bin browser\b|\bnextjs\b|\breact\b/.test(haystack)
	) {
		values.add("Web");
	}
	if (/\bcli\b/.test(haystack)) {
		values.add("CLI");
	}
	if (/\bapi\b|\bfastapi\b/.test(haystack)) {
		values.add("API");
	}
	if (/\bbot\b/.test(haystack)) {
		values.add("Bot");
	}
	if (/\bmobile\b|\bios\b|\bipad\b/.test(haystack)) {
		values.add("Mobile");
	}
	if (/\binternal\b|\bprivate local control plane\b/.test(haystack)) {
		values.add("Internal Tool");
	}
	if (values.size === 0 && primaryLanguage === "Python") {
		values.add("CLI");
	}
	if (values.size === 0) {
		values.add("Web");
	}
	return [...values];
}

function inferKeyIntegrations(
	description: string,
	primaryLanguage: string,
	topics: string[],
	deploymentSurface: string[],
): string {
	const pieces = uniqueStrings([
		primaryLanguage === "Unknown" ? "" : primaryLanguage,
		...deploymentSurface,
		...topics.slice(0, 4),
	]);
	return pieces.join(", ");
}

function inferIntegrationTags(haystack: string): string[] {
	const tags = new Set<string>(["GitHub"]);
	const lower = haystack.toLowerCase();
	if (/\bclaude\b/.test(lower)) {
		tags.add("Claude API");
	}
	if (/\bnotion\b/.test(lower)) {
		tags.add("Notion");
	}
	if (/\bsqlite\b/.test(lower)) {
		tags.add("SQLite");
	}
	if (/\bvision\b|\bocr\b|\bscreenshot\b/.test(lower)) {
		tags.add("Vision");
	}
	return [...tags].filter((value) => value !== "Notion");
}

async function createLocalProject(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	repo: GitHubRepo;
	owner: string;
	metadata: ProjectMetadata;
	today: string;
}): Promise<DataSourcePageRef> {
	const title = input.metadata.displayName;
	const markdown = renderProjectMarkdown(
		input.repo,
		input.owner,
		input.metadata,
	);
	const result = await upsertPageByTitle({
		api: input.api,
		dataSourceId: input.dataSourceId,
		titlePropertyName: "Name",
		title,
		properties: {
			Name: titleValue(title),
			"Current State": selectPropertyValue(input.metadata.currentState),
			"Portfolio Call": selectPropertyValue(input.metadata.portfolioCall),
			"Needs Review": { checkbox: true },
			"One-Line Pitch": richTextValue(input.metadata.oneLinePitch),
			"Next Move": richTextValue(input.metadata.nextMove),
			"Biggest Blocker": richTextValue(input.metadata.biggestBlocker),
			"Last Active": datePropertyValue(isoDate(input.repo.updatedAt)),
			"Start Here": richTextValue(input.metadata.startHere),
			"Build Maturity": selectPropertyValue(input.metadata.buildMaturity),
			"Ship Readiness": selectPropertyValue(input.metadata.shipReadiness),
			"Effort to Demo": selectPropertyValue(input.metadata.effortToDemo),
			"Effort to Ship": selectPropertyValue(input.metadata.effortToShip),
			"Test Posture": selectPropertyValue(input.metadata.testPosture),
			"Docs Quality": selectPropertyValue(input.metadata.docsQuality),
			"Evidence Confidence": selectPropertyValue(
				input.metadata.evidenceConfidence,
			),
			Category: selectPropertyValue(input.metadata.category),
			"Project Shape": multiSelectValue(input.metadata.projectShape),
			"Deployment Surface": multiSelectValue(input.metadata.deploymentSurface),
			"Primary Tool": selectPropertyValue(input.metadata.primaryTool),
			"Context Quality": selectPropertyValue(input.metadata.contextQuality),
			Stack: richTextValue(input.metadata.stack),
			"Key Integrations": richTextValue(input.metadata.keyIntegrations),
			"Value / Outcome": richTextValue(input.metadata.valueOutcome),
			"Monetization / Strategic Value": richTextValue(
				input.metadata.monetizationValue,
			),
			"Integration Tags": multiSelectValue(input.metadata.integrationTags),
			Summary: richTextValue(
				`GitHub catch-up row created for ${input.owner}/${input.repo.name}.`,
			),
		},
		markdown,
	});

	return {
		id: result.id,
		url: result.url,
		title,
		properties: {},
	};
}

async function upsertOrRepairSource(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	existingRow?: DataSourcePageRef;
	owner: string;
	projectId: string;
	repo: GitHubRepo;
	sourceTitle: string;
	today: string;
}): Promise<{ id: string; url: string; title: string; existed: boolean }> {
	const identifier = `${input.owner}/${input.repo.name}`;
	const markdown = renderSourceMarkdown(
		input.sourceTitle,
		input.repo.url,
		identifier,
	);
	const properties = {
		Name: titleValue(input.sourceTitle),
		"Local Project": relationValue([input.projectId]),
		Provider: selectPropertyValue("GitHub"),
		"Source Type": selectPropertyValue("Repo"),
		Status: selectPropertyValue("Active"),
		Environment: selectPropertyValue("N/A"),
		"Sync Strategy": selectPropertyValue("Poll"),
		Identifier: richTextValue(identifier),
		"Source URL": { url: input.repo.url },
		"Last Synced At": datePropertyValue(input.today),
	};

	if (input.existingRow) {
		await input.api.updatePageProperties({
			pageId: input.existingRow.id,
			properties,
		});
		await input.api.patchPageMarkdown({
			pageId: input.existingRow.id,
			command: "replace_content",
			newMarkdown: markdown,
		});
		return {
			id: input.existingRow.id,
			url: input.existingRow.url,
			title: input.sourceTitle,
			existed: true,
		};
	}

	const result = await upsertPageByTitle({
		api: input.api,
		dataSourceId: input.dataSourceId,
		titlePropertyName: "Name",
		title: input.sourceTitle,
		properties,
		markdown,
	});

	return {
		id: result.id,
		url: result.url,
		title: input.sourceTitle,
		existed: result.existed,
	};
}

async function syncManualSeeds(
	config: LocalPortfolioExternalSignalSourceConfig,
	filePath: string,
	owner: string,
	repos: GitHubRepo[],
	summaries: ManualSeedSummary[],
): Promise<void> {
	const repoMap = new Map(repos.map((repo) => [repo.name, repo]));
	const nextSeeds = [...config.manualSeeds];

	for (const summary of summaries) {
		const repoName = summary.identifier.replace(`${owner}/`, "");
		const repo = repoMap.get(repoName);
		if (!repo) {
			continue;
		}
		const existingIndex = nextSeeds.findIndex(
			(seed) => seed.identifier === summary.identifier,
		);
		const nextSeed: ManualExternalSignalSeedPlan = {
			title: summary.title,
			localProjectId: summary.localProjectId,
			provider: "GitHub",
			sourceType: "Repo",
			status: "Active",
			environment: "N/A",
			syncStrategy: "Poll",
			identifier: summary.identifier,
			sourceUrl: repo.url,
		};
		if (existingIndex >= 0) {
			nextSeeds[existingIndex] = nextSeed;
			continue;
		}
		nextSeeds.push(nextSeed);
	}

	await writeJsonFile(filePath, {
		...config,
		manualSeeds: nextSeeds,
	});
}

async function listGitHubRepos(
	owner: string,
	limit?: number,
): Promise<GitHubRepo[]> {
	const jsonFields = [
		"name",
		"description",
		"primaryLanguage",
		"repositoryTopics",
		"isArchived",
		"isFork",
		"isPrivate",
		"url",
		"createdAt",
		"updatedAt",
	].join(",");
	const args = [
		"repo",
		"list",
		owner,
		"--limit",
		String(limit ?? 200),
		"--json",
		jsonFields,
	];
	const { stdout } = await execFileAsync("gh", args, {
		maxBuffer: 1024 * 1024 * 10,
	});
	const repos = JSON.parse(stdout) as GitHubRepo[];
	return repos.filter((repo) => !repo.isArchived && !repo.isFork);
}

function renderProjectMarkdown(
	repo: GitHubRepo,
	owner: string,
	metadata: ProjectMetadata,
): string {
	return [
		`# ${metadata.displayName}`,
		"",
		"## Overview",
		metadata.oneLinePitch,
		"",
		"## GitHub",
		`- Repo: ${owner}/${repo.name}`,
		`- URL: ${repo.url}`,
		`- Private: ${repo.isPrivate ? "Yes" : "No"}`,
		`- Primary language: ${repo.primaryLanguage?.name?.trim() || "Unknown"}`,
		`- Last updated: ${isoDate(repo.updatedAt)}`,
		"",
		"## Initial Operating Posture",
		`- Current state: ${metadata.currentState}`,
		`- Portfolio call: ${metadata.portfolioCall}`,
		`- Build maturity: ${metadata.buildMaturity}`,
		`- Ship readiness: ${metadata.shipReadiness}`,
		"",
		"## Next Move",
		metadata.nextMove,
	].join("\n");
}

function renderSourceMarkdown(
	title: string,
	sourceUrl: string,
	identifier: string,
): string {
	return [
		`# ${title}`,
		"",
		"- Provider: GitHub",
		"- Source type: Repo",
		"- Status: Active",
		`- Identifier: ${identifier}`,
		`- Source URL: ${sourceUrl}`,
		"",
		"This row is maintained by the GitHub catch-up workflow so the repo mapping stays durable and reusable.",
	].join("\n");
}

function displayNameForRepo(repoName: string): string {
	const override = DISPLAY_NAME_OVERRIDES.get(repoName);
	if (override) {
		return override;
	}

	const withSpaces = repoName
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.trim();

	return withSpaces
		.split(/\s+/)
		.map((part) =>
			part === part.toUpperCase()
				? part
				: part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join(" ")
		.replace(/\bGithub\b/g, "GitHub");
}

function sourceTitle(displayName: string): string {
	return `${displayName} - GitHub Repo`;
}

function normalizeKey(value: string): string {
	return value
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/\(.*?\)/g, "")
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9]+/g, "");
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalizeTopics(values: GitHubRepo["repositoryTopics"]): string[] {
	return (values ?? [])
		.map((value) => {
			if (typeof value === "string") {
				return value;
			}
			return value?.topic?.name ?? "";
		})
		.filter((value) => value.trim().length > 0);
}

function isoDate(value: string): string {
	return value.slice(0, 10);
}

function daysBetween(start: string, end: string): number {
	const startDate = new Date(isoDate(start));
	const endDate = new Date(end);
	return Math.max(
		0,
		Math.round(
			(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
		),
	);
}

function stripTrailingPeriod(value: string): string {
	return value.replace(/\.$/, "");
}

void main().catch((error) => {
	const message = toErrorMessage(error);
	console.error(message);
	process.exit(1);
});
