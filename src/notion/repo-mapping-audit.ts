import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
	type LocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	dateValue,
	fetchAllPages,
	selectValue,
	textValue,
	type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import {
	toExternalSignalSourceRecord,
} from "./local-portfolio-external-signals-live.js";
import type {
	ExternalSignalSourceRecord,
} from "./local-portfolio-external-signals.js";

export interface RepoMappingAuditCommandOptions {
	today?: string;
	config?: string;
	projectsRoot?: string;
	limit?: number;
	includeAllGaps?: boolean;
}

export type LocalRepoMappingStatus =
	| "mapped"
	| "inferred"
	| "path-missing"
	| "ambiguous"
	| "missing";

export type GithubSourceMappingStatus =
	| "active"
	| "needs-mapping"
	| "needs-review"
	| "paused"
	| "missing"
	| "not-configured";

export interface RepoMappingAuditProject {
	projectId: string;
	title: string;
	url: string;
	currentState: string;
	operatingQueue: string;
	portfolioCall: string;
	nextMove: string;
	lastActive: string;
	evidenceFreshness: string;
	localPath: string;
	localMappingStatus: LocalRepoMappingStatus;
	resolvedRepoPath: string;
	repoCandidates: string[];
	githubSourceStatus: GithubSourceMappingStatus;
	githubSources: Array<{
		title: string;
		status: string;
		identifier: string;
		sourceUrl: string;
	}>;
	nextOperatorMove: string;
}

export interface RepoMappingAuditResult {
	today: string;
	projectsRoot: string;
	totalProjects: number;
	decisionQueueCount: number;
	localMappingGapCount: number;
	githubMappingGapCount: number;
	attentionCount: number;
	projects: RepoMappingAuditProject[];
	markdown: string;
}

export async function runRepoMappingAuditCommand(
	options: RepoMappingAuditCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken("NOTION_TOKEN is required for repo mapping audit");
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const today = options.today ?? losAngelesToday();
	const api = new DirectNotionClient(token);
	const projectSchema = await api.retrieveDataSource(config.database.dataSourceId);
	const projectPages = await fetchAllPages(
		api,
		config.database.dataSourceId,
		projectSchema.titlePropertyName,
	);
	const sourcePages = config.phase5ExternalSignals?.sources
		? await fetchExternalSignalSourcePages(api, config)
		: [];
	const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
	const result = buildRepoMappingAudit({
		today,
		projectPages,
		sources,
		projectsRoot: options.projectsRoot ?? "/Users/d/Projects",
		limit: options.limit ?? 50,
		includeAllGaps: options.includeAllGaps ?? false,
		externalSignalsConfigured: Boolean(config.phase5ExternalSignals?.sources),
	});
	recordCommandOutputSummary({ ...result }, {
		status: result.attentionCount > 0 ? "warning" : "completed",
		warningCategories: result.attentionCount > 0 ? ["stale_data"] : undefined,
		metadata: {
			decisionQueueCount: result.decisionQueueCount,
			localMappingGapCount: result.localMappingGapCount,
			githubMappingGapCount: result.githubMappingGapCount,
			attentionCount: result.attentionCount,
		},
	});
	console.log(JSON.stringify({ ok: true, status: result.attentionCount > 0 ? "attention_needed" : "clean", ...result }, null, 2));
}

export function buildRepoMappingAudit(input: {
	today: string;
	projectPages: DataSourcePageRef[];
	sources?: ExternalSignalSourceRecord[];
	projectsRoot?: string;
	limit?: number;
	includeAllGaps?: boolean;
	externalSignalsConfigured?: boolean;
}): RepoMappingAuditResult {
	const projectsRoot = resolve(input.projectsRoot ?? "/Users/d/Projects");
	const repoIndex = buildLocalRepoIndex(projectsRoot);
	const sources = input.sources ?? [];
	const allProjects = input.projectPages.map((page) =>
		buildRepoMappingAuditProject({
			page,
			repoIndex,
			projectsRoot,
			sources,
			externalSignalsConfigured: input.externalSignalsConfigured ?? true,
		}),
	);
	const attentionProjects = allProjects.filter((project) =>
		needsRepoMappingAttention(project, input.includeAllGaps ?? false),
	);
	const limit = input.limit ?? 50;
	const projects = attentionProjects
		.sort(compareRepoMappingAuditProjects)
		.slice(0, limit);
	const result = {
		today: input.today,
		projectsRoot,
		totalProjects: allProjects.length,
		decisionQueueCount: allProjects.filter(isDecisionQueueProject).length,
		localMappingGapCount: allProjects.filter(hasLocalMappingGap).length,
		githubMappingGapCount: allProjects.filter(hasGithubMappingGap).length,
		attentionCount: attentionProjects.length,
		projects,
		markdown: "",
	};
	return {
		...result,
		markdown: renderRepoMappingAuditMarkdown(result),
	};
}

function buildRepoMappingAuditProject(input: {
	page: DataSourcePageRef;
	repoIndex: LocalRepoIndex;
	projectsRoot: string;
	sources: ExternalSignalSourceRecord[];
	externalSignalsConfigured: boolean;
}): RepoMappingAuditProject {
	const localPath = textValue(input.page.properties["Local Path"]);
	const localMapping = resolveLocalRepoMapping({
		title: input.page.title,
		localPath,
		projectsRoot: input.projectsRoot,
		repoIndex: input.repoIndex,
	});
	const githubSources = input.sources.filter(
		(source) =>
			source.provider === "GitHub" &&
			source.sourceType === "Repo" &&
			source.localProjectIds.includes(input.page.id),
	);
	const githubSourceStatus = classifyGithubSourceStatus(
		githubSources,
		input.externalSignalsConfigured,
	);
	const project: RepoMappingAuditProject = {
		projectId: input.page.id,
		title: input.page.title,
		url: input.page.url,
		currentState: selectValue(input.page.properties["Current State"]),
		operatingQueue: selectValue(input.page.properties["Operating Queue"]),
		portfolioCall: selectValue(input.page.properties["Portfolio Call"]),
		nextMove: textValue(input.page.properties["Next Move"]),
		lastActive: dateValue(input.page.properties["Last Active"]),
		evidenceFreshness: selectValue(input.page.properties["Evidence Freshness"]),
		localPath,
		localMappingStatus: localMapping.status,
		resolvedRepoPath: localMapping.resolvedRepoPath,
		repoCandidates: localMapping.candidates,
		githubSourceStatus,
		githubSources: githubSources.map((source) => ({
			title: source.title,
			status: source.status,
			identifier: source.identifier,
			sourceUrl: source.sourceUrl,
		})),
		nextOperatorMove: "",
	};
	return {
		...project,
		nextOperatorMove: buildRepoMappingNextMove(project),
	};
}

interface LocalRepoIndex {
	byKey: Map<string, string[]>;
	repoPaths: string[];
}

function buildLocalRepoIndex(projectsRoot: string): LocalRepoIndex {
	if (!existsSync(projectsRoot)) {
		return { byKey: new Map(), repoPaths: [] };
	}
	const repoPaths = readdirSync(projectsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(projectsRoot, entry.name))
		.filter((repoPath) => existsSync(join(repoPath, ".git")));
	const byKey = new Map<string, string[]>();
	for (const repoPath of repoPaths) {
		const key = normalizeProjectKey(repoPath.split("/").at(-1) ?? repoPath);
		const values = byKey.get(key) ?? [];
		values.push(repoPath);
		byKey.set(key, values);
	}
	return { byKey, repoPaths };
}

function resolveLocalRepoMapping(input: {
	title: string;
	localPath: string;
	projectsRoot: string;
	repoIndex: LocalRepoIndex;
}): {
	status: LocalRepoMappingStatus;
	resolvedRepoPath: string;
	candidates: string[];
} {
	if (input.localPath.trim()) {
		const repoPath = input.localPath.startsWith("/")
			? input.localPath
			: join(input.projectsRoot, input.localPath);
		return existsSync(join(repoPath, ".git"))
			? { status: "mapped", resolvedRepoPath: repoPath, candidates: [] }
			: { status: "path-missing", resolvedRepoPath: repoPath, candidates: [] };
	}
	const exactMatches = input.repoIndex.byKey.get(normalizeProjectKey(input.title)) ?? [];
	if (exactMatches.length === 1) {
		return {
			status: "inferred",
			resolvedRepoPath: exactMatches[0] ?? "",
			candidates: [],
		};
	}
	if (exactMatches.length > 1) {
		return {
			status: "ambiguous",
			resolvedRepoPath: "",
			candidates: exactMatches,
		};
	}
	const candidates = findRepoCandidates(input.title, input.repoIndex.repoPaths).slice(0, 5);
	return candidates.length > 0
		? { status: "ambiguous", resolvedRepoPath: "", candidates }
		: { status: "missing", resolvedRepoPath: "", candidates: [] };
}

function findRepoCandidates(title: string, repoPaths: string[]): string[] {
	const titleTokens = tokenizeProjectName(title);
	if (titleTokens.length === 0) {
		return [];
	}
	return repoPaths
		.map((repoPath) => {
			const repoName = repoPath.split("/").at(-1) ?? repoPath;
			const repoTokens = tokenizeProjectName(repoName);
			const score = titleTokens.filter((token) =>
				repoTokens.some((repoToken) => repoToken.includes(token) || token.includes(repoToken)),
			).length;
			return { repoPath, score };
		})
		.filter((entry) => entry.score > 0)
		.sort((left, right) => right.score - left.score || left.repoPath.localeCompare(right.repoPath))
		.map((entry) => entry.repoPath);
}

function classifyGithubSourceStatus(
	sources: ExternalSignalSourceRecord[],
	externalSignalsConfigured: boolean,
): GithubSourceMappingStatus {
	if (!externalSignalsConfigured) {
		return "not-configured";
	}
	if (sources.length === 0) {
		return "missing";
	}
	const activeSource = sources.find(
		(source) => source.status === "Active" && source.identifier.trim() && source.sourceUrl.trim(),
	);
	if (activeSource) {
		return "active";
	}
	if (sources.some((source) => source.status === "Needs Review")) {
		return "needs-review";
	}
	if (sources.some((source) => source.status === "Needs Mapping" || !source.identifier.trim())) {
		return "needs-mapping";
	}
	if (sources.every((source) => source.status === "Paused")) {
		return "paused";
	}
	return "needs-review";
}

function needsRepoMappingAttention(
	project: RepoMappingAuditProject,
	includeAllGaps: boolean,
): boolean {
	if (isDecisionQueueProject(project)) {
		return true;
	}
	if (project.nextMove.toLowerCase().includes("repair project mapping")) {
		return true;
	}
	if (includeAllGaps) {
		return hasLocalMappingGap(project) || hasGithubMappingGap(project);
	}
	return (
		isActivePortfolioProject(project) &&
		(hasLocalMappingGap(project) || hasGithubMappingGap(project))
	);
}

function isDecisionQueueProject(project: RepoMappingAuditProject): boolean {
	return project.currentState === "Needs Decision" || project.operatingQueue === "Needs Decision";
}

function isActivePortfolioProject(project: RepoMappingAuditProject): boolean {
	return ["Active Build", "Ready to Demo", "Needs Decision"].includes(project.currentState) ||
		["Resume Now", "Worth Finishing", "Needs Decision"].includes(project.operatingQueue);
}

function hasLocalMappingGap(project: RepoMappingAuditProject): boolean {
	return !["mapped", "inferred"].includes(project.localMappingStatus);
}

function hasGithubMappingGap(project: RepoMappingAuditProject): boolean {
	return ["missing", "needs-mapping", "needs-review"].includes(project.githubSourceStatus);
}

function buildRepoMappingNextMove(project: RepoMappingAuditProject): string {
	if (project.localMappingStatus === "path-missing") {
		return "Repair Local Path or mark the project parked/archived before treating it as active.";
	}
	if (project.localMappingStatus === "ambiguous") {
		return "Choose the canonical local repo path, then update the project mapping or external source row.";
	}
	if (project.localMappingStatus === "missing") {
		return "Decide whether the repo was renamed, archived, never created, or belongs outside Local Portfolio Projects.";
	}
	if (project.githubSourceStatus === "missing") {
		return "Create or seed the GitHub repo source mapping after confirming the canonical repo.";
	}
	if (project.githubSourceStatus === "needs-mapping") {
		return "Fill the real GitHub identifier/source URL or pause the placeholder source row.";
	}
	if (project.githubSourceStatus === "needs-review") {
		return "Review the existing GitHub source row before using it for telemetry.";
	}
	if (isDecisionQueueProject(project)) {
		return "Make the project decision: continue, park, archive, merge into another row, or schedule the next build.";
	}
	return "No mapping cleanup needed for this row.";
}

function compareRepoMappingAuditProjects(
	left: RepoMappingAuditProject,
	right: RepoMappingAuditProject,
): number {
	return priorityScore(right) - priorityScore(left) || left.title.localeCompare(right.title);
}

function priorityScore(project: RepoMappingAuditProject): number {
	let score = 0;
	if (isDecisionQueueProject(project)) score += 100;
	if (project.localMappingStatus === "missing") score += 40;
	if (project.localMappingStatus === "path-missing") score += 35;
	if (project.localMappingStatus === "ambiguous") score += 25;
	if (project.githubSourceStatus === "needs-mapping") score += 20;
	if (project.githubSourceStatus === "missing") score += 15;
	if (project.githubSourceStatus === "needs-review") score += 10;
	return score;
}

function renderRepoMappingAuditMarkdown(input: Omit<RepoMappingAuditResult, "markdown">): string {
	const lines = [
		`# Decision Queue and Repo Mapping Audit - ${input.today}`,
		"",
		`- Total Local Portfolio Project rows: ${input.totalProjects}`,
		`- Decision queue rows: ${input.decisionQueueCount}`,
		`- Local repo mapping gaps: ${input.localMappingGapCount}`,
		`- GitHub source mapping gaps: ${input.githubMappingGapCount}`,
		`- Attention rows in this packet: ${input.attentionCount}`,
		"",
		"## Operator Queue",
		...(input.projects.length > 0
			? input.projects.map(
					(project) =>
						`- [${project.title}](${project.url}) - state: ${project.currentState || "Unset"} - local: ${project.localMappingStatus} - github: ${project.githubSourceStatus} - ${project.nextOperatorMove}`,
				)
			: ["- No decision or repo-mapping cleanup rows are waiting."]),
		"",
		"## Repo Candidates",
		...input.projects
			.filter((project) => project.repoCandidates.length > 0)
			.map(
				(project) =>
					`- ${project.title}: ${project.repoCandidates.map((candidate) => `\`${candidate}\``).join(", ")}`,
			),
	];
	if (!lines.at(-1)?.startsWith("- ")) {
		lines.push("- No ambiguous local repo candidates in this packet.");
	}
	return lines.join("\n");
}

function normalizeProjectKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenizeProjectName(value: string): string[] {
	return value
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 5);
}

async function fetchExternalSignalSourcePages(
	api: DirectNotionClient,
	config: LocalPortfolioControlTowerConfig,
): Promise<DataSourcePageRef[]> {
	const sourceDataSourceId = config.phase5ExternalSignals?.sources.dataSourceId;
	if (!sourceDataSourceId) {
		return [];
	}
	const sourceSchema = await api.retrieveDataSource(sourceDataSourceId);
	return fetchAllPages(api, sourceDataSourceId, sourceSchema.titlePropertyName);
}