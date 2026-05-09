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
	fetchAllPages,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";

export interface StaleActiveRescueCommandOptions {
	today?: string;
	config?: string;
	limit?: number;
}

export async function runStaleActiveRescueCommand(
	options: StaleActiveRescueCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken("NOTION_TOKEN is required for stale active rescue");
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const today = options.today ?? losAngelesToday();
	const api = new DirectNotionClient(token);
	const schema = await api.retrieveDataSource(config.database.dataSourceId);
	const projectPages = await fetchAllPages(api, config.database.dataSourceId, schema.titlePropertyName);
	const projects = projectPages
		.map((page) => toControlTowerProjectRecord(page))
		.map((project) => applyDerivedSignals(project, config, today));
	const allItems = buildStaleActiveRescueItems(projects, today);
	const limit = options.limit ?? 25;
	const items = allItems.slice(0, limit);
	const output = {
		ok: true,
		live: false,
		status: allItems.length > 0 ? "attention_needed" : "clean",
		today,
		totalStaleActiveProjects: allItems.length,
		returnedProjects: items.length,
		reasonCounts: summarizeStaleActiveRescue(allItems),
		nextOperatorMove: buildNextOperatorMove(allItems),
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
			returnedProjects: items.length,
		},
	});
	console.log(JSON.stringify(output, null, 2));
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

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["control-tower", "stale-active-rescue"]);
}
