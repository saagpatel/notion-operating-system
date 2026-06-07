import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
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
	richTextValue,
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
	projectRegistryPath?: string;
	limit?: number;
	includeAllGaps?: boolean;
	liveNormalizeLocalPaths?: boolean;
}

export interface RepoMappingProjectionPolicy {
	schemaVersion?: typeof REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION;
	notionTitleAliases: Record<string, string>;
	notionProjectionOnlyRows: Record<string, string>;
}

export type LocalRepoMappingStatus =
	| "mapped"
	| "inferred"
	| "needs-normalization"
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
	recommendedLocalPath: string;
	repoCandidates: string[];
	githubSourceStatus: GithubSourceMappingStatus;
	githubSources: Array<{
		title: string;
		status: string;
		identifier: string;
		sourceUrl: string;
	}>;
	projectionPolicyStatus: "none" | "alias" | "projection-only";
	projectionPolicyTarget: string;
	projectionPolicyReason: string;
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

const DEFAULT_PROJECT_REGISTRY_PATH = join(
	homedir(),
	"Projects/GithubRepoAuditor/output/project-registry.json",
);

const DEFAULT_PROJECT_REGISTRY_CONFIG_PATH = join(
	homedir(),
	"Projects/GithubRepoAuditor/config/project-registry-overrides.json",
);

export const REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION =
	"notion_projection_policy.v1";

const DEFAULT_REPO_MAPPING_PROJECTION_POLICY: RepoMappingProjectionPolicy = {
	schemaVersion: REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION,
	notionTitleAliases: {
		"DesktopPEt-ready": "DesktopPEt",
		"EarthPulse-readiness": "EarthPulse",
		"GithubRepoAuditor-public": "GithubRepoAuditor",
		"Notion Operating System": "Notion",
		"OrbitForge (staging)": "OrbitForge",
		"Personal Ops": "operator-os-docs",
		"PomGambler-prod": "PomGambler",
	},
	notionProjectionOnlyRows: {
		app: "local runtime/app shell placeholder; not a portfolio-truth repo",
		"claude-code-harness": "local agent harness projection; outside repo-root truth",
		"Sandbox Local Portfolio Project": "actuation sandbox fixture row",
		SecondBrain: "knowledge vault under /Users/d/Documents; not a /Users/d/Projects repo",
	},
};

export function loadRepoMappingProjectionPolicy(
	projectRegistryPath = process.env.NOTION_REPO_MAPPING_PROJECT_REGISTRY_PATH ??
		DEFAULT_PROJECT_REGISTRY_PATH,
): RepoMappingProjectionPolicy {
	const registryPolicy = readProjectionPolicyFromJson(projectRegistryPath, "projection_policy");
	if (registryPolicy) {
		return registryPolicy;
	}
	const configPolicy = readProjectionPolicyFromJson(
		DEFAULT_PROJECT_REGISTRY_CONFIG_PATH,
		undefined,
	);
	return configPolicy ?? DEFAULT_REPO_MAPPING_PROJECTION_POLICY;
}

function readProjectionPolicyFromJson(
	filePath: string,
	containerKey: "projection_policy" | undefined,
): RepoMappingProjectionPolicy | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		const policySource =
			containerKey && isRecord(raw) && isRecord(raw[containerKey])
				? raw[containerKey]
				: raw;
		if (!isRecord(policySource)) {
			return undefined;
		}
		const schemaVersion =
			policySource.schema_version ?? policySource.notion_projection_policy_schema_version;
		if (schemaVersion !== REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION) {
			return undefined;
		}
		const titleAliases = policySource.notion_title_aliases;
		const projectionOnlyRows = policySource.notion_projection_only_rows;
		if (!isStringRecord(titleAliases) || !isStringRecord(projectionOnlyRows)) {
			return undefined;
		}
		return {
			schemaVersion: REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION,
			notionTitleAliases: titleAliases,
			notionProjectionOnlyRows: projectionOnlyRows,
		};
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) &&
		Object.values(value).every((entry) => typeof entry === "string");
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
	const projectionPolicy = loadRepoMappingProjectionPolicy(options.projectRegistryPath);
	const initialResult = buildRepoMappingAudit({
		today,
		projectPages,
		sources,
		projectsRoot: options.projectsRoot ?? "/Users/d/Projects",
		projectionPolicy,
		limit: options.limit ?? 50,
		includeAllGaps: options.includeAllGaps ?? false,
		externalSignalsConfigured: Boolean(config.phase5ExternalSignals?.sources),
	});
	const normalizationPlans = initialResult.projects.filter(
		(project) =>
			project.localMappingStatus === "needs-normalization" &&
			project.recommendedLocalPath.trim(),
	);
	if (options.liveNormalizeLocalPaths) {
		for (const project of normalizationPlans) {
			await api.updatePageProperties({
				pageId: project.projectId,
				properties: {
					"Local Path": richTextValue(project.recommendedLocalPath),
				},
			});
		}
	}
	const result = options.liveNormalizeLocalPaths
		? buildRepoMappingAudit({
				today,
				projectPages: await fetchAllPages(
					api,
					config.database.dataSourceId,
					projectSchema.titlePropertyName,
				),
				sources,
				projectsRoot: options.projectsRoot ?? "/Users/d/Projects",
				projectionPolicy,
				limit: options.limit ?? 50,
				includeAllGaps: options.includeAllGaps ?? false,
				externalSignalsConfigured: Boolean(config.phase5ExternalSignals?.sources),
			})
		: initialResult;
	recordCommandOutputSummary({ ...result }, {
		status: result.attentionCount > 0 ? "warning" : "completed",
		warningCategories: result.attentionCount > 0 ? ["stale_data"] : undefined,
		metadata: {
			decisionQueueCount: result.decisionQueueCount,
			localMappingGapCount: result.localMappingGapCount,
			githubMappingGapCount: result.githubMappingGapCount,
			attentionCount: result.attentionCount,
			plannedNormalizations: normalizationPlans.length,
			appliedNormalizations: options.liveNormalizeLocalPaths ? normalizationPlans.length : 0,
		},
	});
	console.log(JSON.stringify({
		ok: true,
		status: result.attentionCount > 0 ? "attention_needed" : "clean",
		liveNormalizeLocalPaths: options.liveNormalizeLocalPaths ?? false,
		plannedNormalizations: normalizationPlans.map((project) => ({
			projectId: project.projectId,
			title: project.title,
			from: project.localPath,
			to: project.recommendedLocalPath,
		})),
		appliedNormalizations: options.liveNormalizeLocalPaths ? normalizationPlans.length : 0,
		...result,
	}, null, 2));
}

export function buildRepoMappingAudit(input: {
	today: string;
	projectPages: DataSourcePageRef[];
	sources?: ExternalSignalSourceRecord[];
	projectsRoot?: string;
	projectionPolicy?: RepoMappingProjectionPolicy;
	limit?: number;
	includeAllGaps?: boolean;
	externalSignalsConfigured?: boolean;
}): RepoMappingAuditResult {
	const projectsRoot = resolve(input.projectsRoot ?? "/Users/d/Projects");
	const repoIndex = buildLocalRepoIndex(projectsRoot);
	const sources = input.sources ?? [];
	const projectionPolicy = input.projectionPolicy ?? DEFAULT_REPO_MAPPING_PROJECTION_POLICY;
	const allProjects = input.projectPages.map((page) =>
		buildRepoMappingAuditProject({
			page,
			repoIndex,
			projectsRoot,
			sources,
			projectionPolicy,
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
		localMappingGapCount: allProjects.filter(hasActionableLocalMappingGap).length,
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
	projectionPolicy: RepoMappingProjectionPolicy;
	externalSignalsConfigured: boolean;
}): RepoMappingAuditProject {
	const localPath = textValue(input.page.properties["Local Path"]);
	const githubSources = input.sources.filter(
		(source) =>
			source.provider === "GitHub" &&
			source.sourceType === "Repo" &&
			source.localProjectIds.includes(input.page.id),
	);
	const localMapping = resolveLocalRepoMapping({
		title: input.page.title,
		localPath,
		projectsRoot: input.projectsRoot,
		repoIndex: input.repoIndex,
		githubSources,
		projectionPolicy: input.projectionPolicy,
	});
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
		recommendedLocalPath: localMapping.recommendedLocalPath,
		repoCandidates: localMapping.candidates,
		githubSourceStatus,
		githubSources: githubSources.map((source) => ({
			title: source.title,
			status: source.status,
			identifier: source.identifier,
			sourceUrl: source.sourceUrl,
		})),
		...classifyProjectionPolicy(input.page.title, input.projectionPolicy),
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
	const repoPaths = [
		...repoDirsUnder(projectsRoot),
		...["/Users/d/Notion", "/Users/d/.local/share/personal-ops"].filter(
			(repoPath) => existsSync(join(repoPath, ".git")),
		),
	];
	const byKey = new Map<string, string[]>();
	for (const repoPath of repoPaths) {
		for (const key of repoKeys(repoPath)) {
			const values = byKey.get(key) ?? [];
			values.push(repoPath);
			byKey.set(key, [...new Set(values)]);
		}
	}
	return { byKey, repoPaths };
}

function repoDirsUnder(projectsRoot: string): string[] {
	return readdirSync(projectsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const firstLevel = join(projectsRoot, entry.name);
			const firstLevelRepo = existsSync(join(firstLevel, ".git")) ? [firstLevel] : [];
			const secondLevelRepos = readdirSync(firstLevel, { withFileTypes: true })
				.filter((child) => child.isDirectory())
				.map((child) => join(firstLevel, child.name))
				.filter((repoPath) => existsSync(join(repoPath, ".git")));
			return [...firstLevelRepo, ...secondLevelRepos];
		});
}

function resolveLocalRepoMapping(input: {
	title: string;
	localPath: string;
	projectsRoot: string;
	repoIndex: LocalRepoIndex;
	githubSources?: ExternalSignalSourceRecord[];
	projectionPolicy: RepoMappingProjectionPolicy;
}): {
	status: LocalRepoMappingStatus;
	resolvedRepoPath: string;
	recommendedLocalPath: string;
	candidates: string[];
} {
	if (input.localPath.trim()) {
		const repoPath = resolveLocalPath(input.localPath, input.projectsRoot, {
			normalize: false,
		});
		if (existsSync(join(repoPath, ".git"))) {
			return {
				status: "mapped",
				resolvedRepoPath: repoPath,
				recommendedLocalPath: input.localPath,
				candidates: [],
			};
		}
		const normalizedPath = resolveLocalPath(
			normalizeLocalPathText(input.localPath),
			input.projectsRoot,
		);
		if (normalizedPath !== repoPath && existsSync(join(normalizedPath, ".git"))) {
			return {
				status: "needs-normalization",
				resolvedRepoPath: normalizedPath,
				recommendedLocalPath: toRecommendedLocalPath(normalizedPath, input.projectsRoot),
				candidates: [],
			};
		}
		const sourceMatch = findSourceRepoMatch(input.githubSources ?? [], input.repoIndex);
		if (sourceMatch) {
			return {
				status: "needs-normalization",
				resolvedRepoPath: sourceMatch,
				recommendedLocalPath: toRecommendedLocalPath(sourceMatch, input.projectsRoot),
				candidates: [],
			};
		}
		const aliasMatch = findProjectionAliasRepoMatch(
			input.title,
			input.projectionPolicy,
			input.repoIndex,
		);
		if (aliasMatch) {
			return {
				status: "needs-normalization",
				resolvedRepoPath: aliasMatch,
				recommendedLocalPath: toRecommendedLocalPath(aliasMatch, input.projectsRoot),
				candidates: [],
			};
		}
		const candidates = findRepoCandidates(input.title, input.repoIndex.repoPaths).slice(0, 5);
		return {
			status: "path-missing",
			resolvedRepoPath: repoPath,
			recommendedLocalPath: "",
			candidates,
		};
	}
	const exactMatches = input.repoIndex.byKey.get(normalizeProjectKey(input.title)) ?? [];
	if (exactMatches.length === 1) {
		return {
			status: "inferred",
			resolvedRepoPath: exactMatches[0] ?? "",
			recommendedLocalPath: toRecommendedLocalPath(exactMatches[0] ?? "", input.projectsRoot),
			candidates: [],
		};
	}
	if (exactMatches.length > 1) {
		return {
			status: "ambiguous",
			resolvedRepoPath: "",
			recommendedLocalPath: "",
			candidates: exactMatches,
		};
	}
	const aliasMatch = findProjectionAliasRepoMatch(
		input.title,
		input.projectionPolicy,
		input.repoIndex,
	);
	if (aliasMatch) {
		return {
			status: "inferred",
			resolvedRepoPath: aliasMatch,
			recommendedLocalPath: toRecommendedLocalPath(aliasMatch, input.projectsRoot),
			candidates: [],
		};
	}
	const sourceMatch = findSourceRepoMatch(input.githubSources ?? [], input.repoIndex);
	if (sourceMatch) {
		return {
			status: "inferred",
			resolvedRepoPath: sourceMatch,
			recommendedLocalPath: toRecommendedLocalPath(sourceMatch, input.projectsRoot),
			candidates: [],
		};
	}
	const candidates = findRepoCandidates(input.title, input.repoIndex.repoPaths).slice(0, 5);
	return candidates.length > 0
		? { status: "ambiguous", resolvedRepoPath: "", recommendedLocalPath: "", candidates }
		: { status: "missing", resolvedRepoPath: "", recommendedLocalPath: "", candidates: [] };
}

function findProjectionAliasRepoMatch(
	title: string,
	projectionPolicy: RepoMappingProjectionPolicy,
	repoIndex: LocalRepoIndex,
): string | undefined {
	const aliases = normalizedStringRecord(projectionPolicy.notionTitleAliases);
	const canonicalTitle = aliases.get(normalizeProjectKey(title));
	if (!canonicalTitle) {
		return undefined;
	}
	const matches = repoIndex.byKey.get(normalizeProjectKey(canonicalTitle)) ?? [];
	return matches.length === 1 ? matches[0] : undefined;
}

function classifyProjectionPolicy(
	title: string,
	projectionPolicy: RepoMappingProjectionPolicy,
): Pick<
	RepoMappingAuditProject,
	"projectionPolicyStatus" | "projectionPolicyTarget" | "projectionPolicyReason"
> {
	const normalizedTitle = normalizeProjectKey(title);
	const aliases = normalizedStringRecord(projectionPolicy.notionTitleAliases);
	const projectionOnlyRows = normalizedStringRecord(projectionPolicy.notionProjectionOnlyRows);
	const aliasTarget = aliases.get(normalizedTitle);
	if (aliasTarget) {
		return {
			projectionPolicyStatus: "alias",
			projectionPolicyTarget: aliasTarget,
			projectionPolicyReason: "",
		};
	}
	const projectionReason = projectionOnlyRows.get(normalizedTitle);
	if (projectionReason) {
		return {
			projectionPolicyStatus: "projection-only",
			projectionPolicyTarget: "",
			projectionPolicyReason: projectionReason,
		};
	}
	return {
		projectionPolicyStatus: "none",
		projectionPolicyTarget: "",
		projectionPolicyReason: "",
	};
}

function normalizedStringRecord(values: Record<string, string>): Map<string, string> {
	return new Map(
		Object.entries(values).map(([key, value]) => [normalizeProjectKey(key), value]),
	);
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
	if (sources.every((source) => source.status === "Paused")) {
		return "paused";
	}
	if (sources.some((source) => source.status === "Needs Mapping" || !source.identifier.trim())) {
		return "needs-mapping";
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
		return hasActionableLocalMappingGap(project) || hasGithubMappingGap(project);
	}
	return (
		isActivePortfolioProject(project) &&
		(hasActionableLocalMappingGap(project) || hasGithubMappingGap(project))
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

function hasActionableLocalMappingGap(project: RepoMappingAuditProject): boolean {
	return hasLocalMappingGap(project) &&
		project.projectionPolicyStatus !== "projection-only" &&
		!isDocumentedNonRepoPosture(project);
}

function isDocumentedNonRepoPosture(project: RepoMappingAuditProject): boolean {
	return (
		["Parked", "Archived"].includes(project.currentState) &&
		project.githubSourceStatus === "paused"
	);
}

function hasGithubMappingGap(project: RepoMappingAuditProject): boolean {
	if (project.projectionPolicyStatus === "projection-only") {
		return false;
	}
	return ["missing", "needs-mapping", "needs-review"].includes(project.githubSourceStatus);
}

function buildRepoMappingNextMove(project: RepoMappingAuditProject): string {
	if (project.projectionPolicyStatus === "projection-only") {
		return `No repo mapping needed: ${project.projectionPolicyReason}`;
	}
	if (project.localMappingStatus === "needs-normalization") {
		return `Update Local Path to ${project.recommendedLocalPath || project.resolvedRepoPath}.`;
	}
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
	if (project.projectionPolicyStatus === "alias" && project.projectionPolicyTarget) {
		return `Treat as projection alias for ${project.projectionPolicyTarget}; verify mappings stay attached to the canonical row.`;
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
	if (project.localMappingStatus === "needs-normalization") score += 30;
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

function normalizeLocalPathText(value: string): string {
	return value.trim().replace(/[.\s]+$/g, "");
}

function resolveLocalPath(
	value: string,
	projectsRoot: string,
	options: { normalize?: boolean } = {},
): string {
	const normalized =
		options.normalize === false ? value.trim() : normalizeLocalPathText(value);
	if (normalized.startsWith("~/")) {
		return join(homedir(), normalized.slice(2));
	}
	if (normalized.startsWith("/")) {
		return normalized;
	}
	return join(projectsRoot, normalized);
}

function toRecommendedLocalPath(repoPath: string, projectsRoot: string): string {
	if (!repoPath) {
		return "";
	}
	if (repoPath.startsWith(`${projectsRoot}/`)) {
		return repoPath.slice(projectsRoot.length + 1);
	}
	return repoPath;
}

function findSourceRepoMatch(
	sources: ExternalSignalSourceRecord[],
	repoIndex: LocalRepoIndex,
): string | undefined {
	const sourceRepoKeys = sources
		.map((source) => repoNameFromIdentifier(source.identifier) || repoNameFromUrl(source.sourceUrl))
		.filter((value): value is string => Boolean(value))
		.map(normalizeProjectKey);
	for (const key of sourceRepoKeys) {
		const matches = repoIndex.byKey.get(key) ?? [];
		if (matches.length === 1) {
			return matches[0];
		}
	}
	return undefined;
}

function repoNameFromIdentifier(value: string): string {
	return value.split("/").at(-1)?.trim() ?? "";
}

function repoNameFromUrl(value: string): string {
	const clean = value.replace(/\.git$/i, "").replace(/\/$/g, "");
	return clean.split("/").at(-1)?.trim() ?? "";
}

function repoKeys(repoPath: string): string[] {
	const repoName = repoPath.split("/").at(-1) ?? repoPath;
	return [
		...new Set(
			[normalizeProjectKey(repoName), normalizeProjectKey(remoteRepoName(repoPath))].filter(Boolean),
		),
	];
}

function remoteRepoName(repoPath: string): string {
	try {
		const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
			cwd: repoPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return repoNameFromUrl(remoteUrl);
	} catch {
		return "";
	}
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
