import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	buildStaleActiveRescueItems,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
	summarizeStaleActiveRescue,
	type StaleActiveRescueItem,
} from "./local-portfolio-control-tower.js";
import {
	datePropertyValue,
	fetchAllPages,
	selectPropertyValue,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";

export interface StaleActiveRescueCommandOptions {
	today?: string;
	config?: string;
	limit?: number;
	live?: boolean;
	missingReposOnly?: boolean;
}

export interface LocalRepoEvidence {
	path: string;
	branch: string;
	upstream: string;
	dirtyCount: number;
	lastCommitDate: string;
	lastCommitSubject: string;
}

export interface StaleActiveRescueUpdatePlan {
	projectId: string;
	title: string;
	url: string;
	repo?: LocalRepoEvidence;
	action: "refresh-active-evidence" | "repair-mapping-decision";
	properties: Record<string, unknown>;
	summary: {
		currentState?: string;
		lastActive?: string;
		evidenceFreshness?: string;
		nextReviewDate: string;
		nextMove: string;
	};
}

export async function runStaleActiveRescueCommand(
	options: StaleActiveRescueCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken("NOTION_TOKEN is required for stale active rescue");
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const today = options.today ?? losAngelesToday();
	const live = options.live ?? false;
	const api = new DirectNotionClient(token);
	const schema = await api.retrieveDataSource(config.database.dataSourceId);
	const projectPages = await fetchAllPages(api, config.database.dataSourceId, schema.titlePropertyName);
	const projects = projectPages
		.map((page) => toControlTowerProjectRecord(page))
		.map((project) => applyDerivedSignals(project, config, today));
	const allItems = buildStaleActiveRescueItems(projects, today);
	const limit = options.limit ?? 25;
	const items = allItems.slice(0, limit);
	const allUpdatePlans = buildStaleActiveRescueUpdatePlans({
		items: allItems,
		today,
		reviewCadenceDays: config.reviewCadenceDays,
	});
	const eligibleUpdatePlans = options.missingReposOnly
		? allUpdatePlans.filter((plan) => !plan.repo)
		: allUpdatePlans;
	const updatePlans = eligibleUpdatePlans.slice(0, limit);
	if (live) {
		for (const plan of updatePlans) {
			await api.updatePageProperties({
				pageId: plan.projectId,
				properties: plan.properties,
			});
		}
	}
	const afterProjectPages = live
		? await fetchAllPages(api, config.database.dataSourceId, schema.titlePropertyName)
		: projectPages;
	const afterProjects = afterProjectPages
		.map((page) => toControlTowerProjectRecord(page))
		.map((project) => applyDerivedSignals(project, config, today));
	const afterItems = buildStaleActiveRescueItems(afterProjects, today);
	const output = {
		ok: true,
		live,
		status: afterItems.length > 0 ? "attention_needed" : "clean",
		today,
		totalStaleActiveProjects: allItems.length,
		remainingStaleActiveProjects: afterItems.length,
		returnedProjects: items.length,
		reasonCounts: summarizeStaleActiveRescue(allItems),
		nextOperatorMove: buildNextOperatorMove(allItems),
		updateMode: options.missingReposOnly ? "missing-repos-only" : "top-stale-active",
		plannedUpdates: updatePlans.map(serializeStaleActiveUpdatePlan),
		appliedUpdates: live ? updatePlans.length : 0,
		projects: items.map(serializeStaleActiveItem),
		markdown: renderStaleActiveRescueMarkdown({
			today,
			totalCount: allItems.length,
			highPriorityCount: allItems.filter((item) => item.priority === "high").length,
			items,
		}),
	};
	recordCommandOutputSummary(output, {
		status: allItems.length > 0 ? "warning" : "completed",
		warningCategories: allItems.length > 0 ? ["stale_data"] : undefined,
		metadata: {
			totalStaleActiveProjects: allItems.length,
			remainingStaleActiveProjects: afterItems.length,
			returnedProjects: items.length,
			plannedUpdates: updatePlans.length,
			appliedUpdates: live ? updatePlans.length : 0,
		},
	});
	console.log(JSON.stringify(output, null, 2));
}

export function buildStaleActiveRescueUpdatePlans(input: {
	items: StaleActiveRescueItem[];
	today: string;
	reviewCadenceDays: Record<string, number>;
	projectsRoot?: string;
}): StaleActiveRescueUpdatePlan[] {
	const projectsRoot = input.projectsRoot ?? "/Users/d/Projects";
	return input.items.map((item) =>
		buildStaleActiveRescueUpdatePlan({
			item,
			today: input.today,
			reviewCadenceDays: input.reviewCadenceDays,
			projectsRoot,
		}),
	);
}

export function buildStaleActiveRescueUpdatePlan(input: {
	item: StaleActiveRescueItem;
	today: string;
	reviewCadenceDays: Record<string, number>;
	projectsRoot?: string;
}): StaleActiveRescueUpdatePlan {
	const project = input.item.project;
	const repo = findLocalRepoEvidence(project.title, input.projectsRoot ?? "/Users/d/Projects");
	const nextReviewDate = addDays(
		input.today,
		input.reviewCadenceDays[repo ? project.currentState : "Needs Decision"] ?? 7,
	);

	if (!repo) {
		const nextMove = `Repair project mapping: confirm whether the local repo was renamed, archived, or never created before keeping ${project.title} active.`;
		return {
			projectId: project.id,
			title: project.title,
			url: project.url,
			action: "repair-mapping-decision",
			properties: {
				"Current State": selectPropertyValue("Needs Decision"),
				"Next Move": richTextPropertyValue(nextMove),
				"Next Review Date": datePropertyValue(nextReviewDate),
			},
			summary: {
				currentState: "Needs Decision",
				nextReviewDate,
				nextMove,
			},
		};
	}

	const lastActive = newestIsoDate([project.lastActive, repo.lastCommitDate]) || project.lastActive;
	const evidenceFreshness = classifyFreshness(lastActive, input.today);
	const nextMove = buildRepoBackedNextMove(repo);
	return {
		projectId: project.id,
		title: project.title,
		url: project.url,
		repo,
		action: "refresh-active-evidence",
		properties: {
			"Last Active": datePropertyValue(lastActive),
			"Evidence Freshness": selectPropertyValue(evidenceFreshness),
			"Next Move": richTextPropertyValue(nextMove),
			"Next Review Date": datePropertyValue(nextReviewDate),
		},
		summary: {
			lastActive,
			evidenceFreshness,
			nextReviewDate,
			nextMove,
		},
	};
}

export function renderStaleActiveRescueMarkdown(input: {
	today: string;
	totalCount: number;
	highPriorityCount?: number;
	items: StaleActiveRescueItem[];
}): string {
	const lines = [
		`# Stale Active Project Rescue - ${input.today}`,
		"",
		`Total stale active projects: ${input.totalCount}`,
		"",
		"## Next Operator Move",
		`- ${buildNextOperatorMove(input.items, input.totalCount, input.highPriorityCount)}`,
		"",
		"## Projects",
		...(input.items.length > 0
			? input.items.map(
					(item) =>
						`- [${item.project.title}](${item.project.url}) - ${item.priority} - ${item.reason} - ${item.nextAction}`,
				)
			: ["- None right now."]),
	];
	return lines.join("\n");
}

function serializeStaleActiveItem(item: StaleActiveRescueItem): Record<string, unknown> {
	return {
		projectId: item.project.id,
		title: item.project.title,
		url: item.project.url,
		reason: item.reason,
		priority: item.priority,
		nextAction: item.nextAction,
		evidence: item.evidence,
	};
}

function serializeStaleActiveUpdatePlan(plan: StaleActiveRescueUpdatePlan): Record<string, unknown> {
	return {
		projectId: plan.projectId,
		title: plan.title,
		url: plan.url,
		action: plan.action,
		repo: plan.repo
			? {
					path: plan.repo.path,
					branch: plan.repo.branch,
					upstream: plan.repo.upstream,
					dirtyCount: plan.repo.dirtyCount,
					lastCommitDate: plan.repo.lastCommitDate,
					lastCommitSubject: plan.repo.lastCommitSubject,
				}
			: undefined,
		summary: plan.summary,
	};
}

function buildNextOperatorMove(
	items: StaleActiveRescueItem[],
	totalCount = items.length,
	highPriorityCount = items.filter((item) => item.priority === "high").length,
): string {
	if (items.length === 0) {
		return "No stale active rescue work is waiting.";
	}
	if (highPriorityCount > 0) {
		return `Review ${highPriorityCount} high-priority stale active project(s) first; update Next Move, Last Active, or project status before running another broad refresh.`;
	}
	return `Review ${totalCount} stale active project(s) in order and refresh evidence before changing portfolio calls.`;
}

function findLocalRepoEvidence(title: string, projectsRoot: string): LocalRepoEvidence | undefined {
	if (!existsSync(projectsRoot)) {
		return undefined;
	}
	const targetKey = normalizeProjectKey(title);
	const dirName = readdirSync(projectsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.find((name) => normalizeProjectKey(name) === targetKey);
	if (!dirName) {
		return undefined;
	}
	const repoPath = join(projectsRoot, dirName);
	if (!existsSync(join(repoPath, ".git"))) {
		return undefined;
	}
	const branch = git(repoPath, ["branch", "--show-current"]) || "(detached)";
	const upstream = git(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) || "(no-upstream)";
	const dirtyCount = git(repoPath, ["status", "--short"])
		.split("\n")
		.filter((line) => line.trim().length > 0).length;
	const [lastCommitDate = "", lastCommitSubject = ""] = git(repoPath, [
		"log",
		"-1",
		"--format=%cs%x00%s",
	]).split("\0");
	return {
		path: repoPath,
		branch,
		upstream,
		dirtyCount,
		lastCommitDate,
		lastCommitSubject,
	};
}

function git(cwd: string, args: string[]): string {
	try {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
}

function buildRepoBackedNextMove(repo: LocalRepoEvidence): string {
	const branchNeedsDecision = repo.upstream === "(no-upstream)" || repo.branch === "(detached)";
	const worktreeNeedsReview = repo.dirtyCount > 0;
	if (branchNeedsDecision && worktreeNeedsReview) {
		return `Review local branch/worktree: ${repo.branch} has no upstream and ${repo.dirtyCount} dirty file(s); decide publish, park, merge, or clean up.`;
	}
	if (branchNeedsDecision) {
		return `Review local branch posture: ${repo.branch} has no upstream; decide publish, park, or merge/rebase.`;
	}
	if (worktreeNeedsReview) {
		return `Review local worktree changes from ${repo.lastCommitDate}; decide keep active, split cleanup, or park.`;
	}
	return `Refresh project evidence from the ${repo.lastCommitDate} repo activity, then decide the next build or review step.`;
}

function richTextPropertyValue(content: string): {
	rich_text: Array<{ type: "text"; text: { content: string } }>;
} {
	return {
		rich_text: [
			{
				type: "text",
				text: { content },
			},
		],
	};
}

function normalizeProjectKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function newestIsoDate(values: string[]): string {
	return values.filter(Boolean).sort().at(-1) ?? "";
}

function classifyFreshness(date: string, today: string): "Fresh" | "Aging" | "Stale" {
	if (!date) {
		return "Stale";
	}
	const ageDays = diffDays(date, today);
	if (ageDays <= 14) {
		return "Fresh";
	}
	if (ageDays <= 45) {
		return "Aging";
	}
	return "Stale";
}

function addDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}

function diffDays(fromDate: string, toDate: string): number {
	const from = new Date(`${fromDate}T00:00:00Z`);
	const to = new Date(`${toDate}T00:00:00Z`);
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["control-tower", "stale-active-rescue"]);
}
