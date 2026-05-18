import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { normalizeMarkdown } from "../utils/markdown.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";
import {
	toExecutionTaskRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";
import { toIntelligenceProjectRecord } from "./local-portfolio-intelligence-live.js";
import {
	buildPacketFollowThroughReport,
	type PacketFollowThroughReport,
} from "./packet-follow-through.js";
import {
	buildPacketPrioritizerReport,
	type PacketPrioritizerReport,
	type PacketPriorityItem,
} from "./packet-prioritizer.js";
import { syncManagedMarkdownSectionWithReadBack } from "./managed-markdown-sync.js";

export const TODAY_FOCUS_START = "<!-- codex:notion-today-focus:start -->";
export const TODAY_FOCUS_END = "<!-- codex:notion-today-focus:end -->";

export interface TodayFocusCommandOptions {
	today?: string;
	config?: string;
	limit?: number;
	lookbackDays?: number;
	live?: boolean;
}

export interface TodayFocusReport {
	today: string;
	totalOpenPackets: number;
	focusItems: PacketPriorityItem[];
	followThrough: {
		blockedPackets: number;
		overduePackets: number;
		unworkedPackets: number;
	};
	markdown: string;
}

export async function runTodayFocusCommand(
	options: TodayFocusCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken("NOTION_TOKEN is required for today");
	const today = options.today ?? losAngelesToday();
	const limit = options.limit ?? 5;
	const lookbackDays = options.lookbackDays ?? 14;
	const live = options.live ?? false;
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	if (!config.phase2Execution) {
		throw new Error("Control tower config is missing phase2Execution");
	}

	const api = new DirectNotionClient(token);
	const [projectSchema, packetSchema, taskSchema, eventSchema] =
		await Promise.all([
			api.retrieveDataSource(config.database.dataSourceId),
			api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
			api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
			config.phase5ExternalSignals
				? api.retrieveDataSource(config.phase5ExternalSignals.events.dataSourceId)
				: Promise.resolve(undefined),
		]);
	const [projectPages, packetPages, taskPages, eventPages] = await Promise.all([
		fetchAllPages(
			api,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			api,
			config.phase2Execution.packets.dataSourceId,
			packetSchema.titlePropertyName,
		),
		fetchAllPages(
			api,
			config.phase2Execution.tasks.dataSourceId,
			taskSchema.titlePropertyName,
		),
		config.phase5ExternalSignals && eventSchema
			? fetchAllPages(
					api,
					config.phase5ExternalSignals.events.dataSourceId,
					eventSchema.titlePropertyName,
				)
			: Promise.resolve([]),
	]);

	const controlProjects = projectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);
	const intelligenceProjects = projectPages.map((page) =>
		applyDerivedSignals(
			toIntelligenceProjectRecord(page),
			config,
			today,
		) as ReturnType<typeof toIntelligenceProjectRecord>,
	);
	const packets = packetPages.map((page) => toWorkPacketRecord(page));
	const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
	const taskCreatedAtById = new Map(
		taskPages.map((page) => [page.id, page.createdTime ?? ""]),
	);
	const events = eventPages.map((page) => toExternalSignalEventRecord(page));
	const priorityReport = buildPacketPrioritizerReport({
		today,
		projects: intelligenceProjects,
		packets,
		tasks,
		taskCreatedAtById,
		events,
		limit: Math.max(limit, 5),
		lookbackDays,
	});
	const followThroughReport = buildPacketFollowThroughReport({
		today,
		projects: controlProjects,
		packets,
		tasks,
		limit: Math.max(limit, 5),
	});
	const report = buildTodayFocusReport({
		today,
		priorityReport,
		followThroughReport,
		limit,
	});
	const liveResult = live
		? await patchTodayFocusIntoWeeklyReview({ api, config, today, report })
		: { weeklyReviewPatched: false, weeklyReviewWouldChange: false };

	console.log(
		JSON.stringify(
			{
				ok: true,
				live,
				today,
				totalOpenPackets: report.totalOpenPackets,
				focusCount: report.focusItems.length,
				weeklyReviewPatched: liveResult.weeklyReviewPatched,
				weeklyReviewWouldChange: liveResult.weeklyReviewWouldChange,
				topFocus: report.focusItems.slice(0, 3).map((item) => ({
					packet: item.packetTitle,
					project: item.projectTitle,
					score: item.compositeScore,
					nextAction: item.nextAction,
				})),
			},
			null,
			2,
		),
	);
	console.log("\n" + report.markdown);
}

export function buildTodayFocusReport(input: {
	today: string;
	priorityReport: PacketPrioritizerReport;
	followThroughReport: PacketFollowThroughReport;
	limit?: number;
}): TodayFocusReport {
	const limit = input.limit ?? 5;
	const focusItems = input.priorityReport.items.slice(0, limit);
	const report = {
		today: input.today,
		totalOpenPackets: input.priorityReport.totalOpenPackets,
		focusItems,
		followThrough: {
			blockedPackets: input.followThroughReport.blockedPackets,
			overduePackets: input.followThroughReport.overduePackets,
			unworkedPackets: input.followThroughReport.unworkedPackets,
		},
		markdown: "",
	};
	return {
		...report,
		markdown: renderTodayFocusMarkdown(report),
	};
}

function renderTodayFocusMarkdown(input: Omit<TodayFocusReport, "markdown">): string {
	const lines = [
		TODAY_FOCUS_START,
		`## Daily Focus - ${input.today}`,
		"",
		"### Now",
		...formatFocusItems(input.focusItems.slice(0, 3)),
		"",
		"### Watch",
		...formatFocusItems(input.focusItems.slice(3, 5)),
		"",
		"### Queue Pressure",
		`- Open packets: ${input.totalOpenPackets}.`,
		`- Blocked packet pressure: ${input.followThrough.blockedPackets}.`,
		`- Overdue packet pressure: ${input.followThrough.overduePackets}.`,
		`- Packets without an open task: ${input.followThrough.unworkedPackets}.`,
		"",
		"### Operator Rule",
		"- Start with the highest ranked Now item unless a human constraint overrides it.",
		"- Work existing packets before creating new ones.",
		"- Keep this command read-only unless `--live` is explicit.",
		TODAY_FOCUS_END,
	];
	return lines.join("\n");
}

function formatFocusItems(items: PacketPriorityItem[]): string[] {
	if (items.length === 0) {
		return ["- No ranked packet in this slot."];
	}
	return items.map(
		(item, index) =>
			`${index + 1}. ${item.projectTitle} - ${item.packetTitle} - score ${item.compositeScore}. Next: ${item.nextAction}`,
	);
}

async function patchTodayFocusIntoWeeklyReview(input: {
	api: DirectNotionClient;
	config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
	today: string;
	report: TodayFocusReport;
}): Promise<{
	weeklyReviewPatched: boolean;
	weeklyReviewWouldChange: boolean;
	weeklyReviewPageId?: string;
}> {
	const weekStart = startOfWeekMonday(input.today);
	const weeklySchema = await input.api.retrieveDataSource(
		input.config.relatedDataSources.weeklyReviewsId,
	);
	const weeklyPages = await fetchAllPages(
		input.api,
		input.config.relatedDataSources.weeklyReviewsId,
		weeklySchema.titlePropertyName,
	);
	const weeklyReview = weeklyPages.find(
		(page) => page.title === `Week of ${weekStart}`,
	);
	if (!weeklyReview) {
		return { weeklyReviewPatched: false, weeklyReviewWouldChange: false };
	}

	const previous = await input.api.readPageMarkdown(weeklyReview.id);
	const nextMarkdown = mergeManagedSection(
		previous.markdown,
		input.report.markdown,
		TODAY_FOCUS_START,
		TODAY_FOCUS_END,
	);
	const weeklyReviewWouldChange =
		normalizeMarkdown(nextMarkdown) !== normalizeMarkdown(previous.markdown);
	if (weeklyReviewWouldChange) {
		await syncManagedMarkdownSectionWithReadBack({
			api: input.api,
			pageId: weeklyReview.id,
			previousMarkdown: previous.markdown,
			nextMarkdown,
			startMarker: TODAY_FOCUS_START,
			endMarker: TODAY_FOCUS_END,
			maxAttempts: 2,
		});
	}
	return {
		weeklyReviewPatched: weeklyReviewWouldChange,
		weeklyReviewWouldChange,
		weeklyReviewPageId: weeklyReview.id,
	};
}
