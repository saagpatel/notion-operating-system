import { appendFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import { syncManagedMarkdownSection } from "./managed-markdown-sync.js";

export const TREND_REPORT_START = "<!-- codex:notion-trend-analysis:start -->";
export const TREND_REPORT_END = "<!-- codex:notion-trend-analysis:end -->";

export const DEFAULT_SNAPSHOT_PATH: string =
	process.env["NOTION_OS_SNAPSHOT_PATH"] ??
	path.join(os.homedir(), ".local", "share", "notion-os", "snapshots.jsonl");

export interface ProjectSnapshot {
	snapshotDate: string;
	projectId: string;
	projectTitle: string;
	operatingQueue: string;
	evidenceFreshness: string;
	recommendationScore: number;
	buildSessionCount: number;
	openPrCount: number;
}

type SnapshotInput = {
	id: string;
	title: string;
	operatingQueue: string;
	evidenceFreshness: string;
	recommendationScore?: number;
	buildSessionCount: number;
	openPrCount?: number;
};

export async function appendSnapshotBatch(
	projects: SnapshotInput[],
	today: string,
): Promise<void> {
	const snapshotPath = DEFAULT_SNAPSHOT_PATH;
	const dir = path.dirname(snapshotPath);
	await mkdir(dir, { recursive: true });

	const lines = projects.map((p): string => {
		const snapshot: ProjectSnapshot = {
			snapshotDate: today,
			projectId: p.id,
			projectTitle: p.title,
			operatingQueue: p.operatingQueue,
			evidenceFreshness: p.evidenceFreshness,
			recommendationScore: p.recommendationScore ?? 0,
			buildSessionCount: p.buildSessionCount,
			openPrCount: p.openPrCount ?? 0,
		};
		return JSON.stringify(snapshot);
	});

	const content = lines.join("\n") + "\n";
	await appendFile(snapshotPath, content, "utf8");
}

export async function readAllSnapshots(): Promise<ProjectSnapshot[]> {
	const snapshotPath = DEFAULT_SNAPSHOT_PATH;
	let raw: string;
	try {
		raw = await readFile(snapshotPath, "utf8");
	} catch (err: unknown) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return [];
		}
		throw err;
	}

	const snapshots: ProjectSnapshot[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			snapshots.push(parseSnapshot(parsed));
		} catch {
			console.warn(
				`[snapshot-history] Skipping malformed snapshot line: ${trimmed.slice(0, 80)}`,
			);
		}
	}
	return snapshots;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

function parseSnapshot(raw: unknown): ProjectSnapshot {
	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid snapshot: not an object");
	}
	const obj = raw as Record<string, unknown>;
	return {
		snapshotDate: requireString(obj, "snapshotDate"),
		projectId: requireString(obj, "projectId"),
		projectTitle: requireString(obj, "projectTitle"),
		operatingQueue: requireString(obj, "operatingQueue"),
		evidenceFreshness: requireString(obj, "evidenceFreshness"),
		recommendationScore: requireNumber(obj, "recommendationScore"),
		buildSessionCount: requireNumber(obj, "buildSessionCount"),
		openPrCount: requireNumber(obj, "openPrCount"),
	};
}

function requireString(obj: Record<string, unknown>, key: string): string {
	const val = obj[key];
	if (typeof val !== "string") {
		throw new Error(`Snapshot field "${key}" must be a string`);
	}
	return val;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
	const val = obj[key];
	if (typeof val !== "number") {
		throw new Error(`Snapshot field "${key}" must be a number`);
	}
	return val;
}

export function renderTrendReport(
	snapshots: ProjectSnapshot[],
	today: string,
): string {
	if (snapshots.length === 0) {
		return `## Trend Analysis — ${today}\n\n*No snapshot history yet.*`;
	}

	// Group by projectId, sorted by snapshotDate within each group
	const byProject = new Map<string, ProjectSnapshot[]>();
	for (const snap of snapshots) {
		const existing = byProject.get(snap.projectId);
		if (existing) {
			existing.push(snap);
		} else {
			byProject.set(snap.projectId, [snap]);
		}
	}
	for (const [, group] of byProject) {
		group.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
	}

	const allDates = snapshots.map((s) => s.snapshotDate).sort();
	const firstSnapshot = allDates[0] ?? today;
	const totalProjects = byProject.size;
	const totalSnapshots = snapshots.length;

	// Find queue changes in last 2 snapshots
	const queueChanges: Array<{
		project: string;
		previous: string;
		current: string;
		changedAt: string;
	}> = [];

	for (const [, group] of byProject) {
		if (group.length < 2) continue;
		const last = group[group.length - 1];
		const prev = group[group.length - 2];
		if (!last || !prev) continue;
		if (last.operatingQueue !== prev.operatingQueue) {
			queueChanges.push({
				project: last.projectTitle,
				previous: prev.operatingQueue,
				current: last.operatingQueue,
				changedAt: last.snapshotDate,
			});
		}
	}

	// Find sustained stale evidence (3+ consecutive)
	const sustainedStale: Array<{
		project: string;
		staleSince: string;
		count: number;
	}> = [];

	for (const [, group] of byProject) {
		if (group.length < 3) continue;
		// Check trailing consecutive stale streak
		let streak = 0;
		for (let i = group.length - 1; i >= 0; i--) {
			const snap = group[i];
			if (!snap) break;
			if (snap.evidenceFreshness === "Stale") {
				streak += 1;
			} else {
				break;
			}
		}
		if (streak >= 3) {
			const staleSinceIndex = group.length - streak;
			const staleSinceSnap = group[staleSinceIndex];
			if (staleSinceSnap) {
				sustainedStale.push({
					project: staleSinceSnap.projectTitle,
					staleSince: staleSinceSnap.snapshotDate,
					count: streak,
				});
			}
		}
	}

	const lines: string[] = [
		`## Trend Analysis — ${today}`,
		"",
		`**${totalProjects} projects tracked, ${totalSnapshots} snapshots, first snapshot: ${firstSnapshot}**`,
		"",
	];

	if (queueChanges.length > 0) {
		lines.push("### Queue Changes (last 2 snapshots)");
		lines.push("| Project | Previous Queue | Current Queue | Changed At |");
		lines.push("|---|---|---|---|");
		for (const change of queueChanges) {
			lines.push(
				`| ${change.project} | ${change.previous} | ${change.current} | ${change.changedAt} |`,
			);
		}
		lines.push("");
	}

	if (sustainedStale.length > 0) {
		lines.push("### Sustained Stale Evidence (3+ consecutive snapshots)");
		lines.push("| Project | Stale Since | Snapshot Count |");
		lines.push("|---|---|---|");
		for (const entry of sustainedStale) {
			lines.push(`| ${entry.project} | ${entry.staleSince} | ${entry.count} |`);
		}
		lines.push("");
	}

	if (queueChanges.length === 0 && sustainedStale.length === 0) {
		lines.push("*No anomalies detected.*");
		lines.push("");
	}

	return lines.join("\n");
}

export interface TrendAnalysisCommandOptions {
	today?: string;
	live?: boolean;
	config?: string;
}

export async function runTrendAnalysisCommand(
	options: TrendAnalysisCommandOptions = {},
): Promise<void> {
	const today = options.today ?? losAngelesToday();
	const live = options.live ?? false;
	const snapshots = await readAllSnapshots();

	const markdown = renderTrendReport(snapshots, today);

	const allDates = snapshots.map((s) => s.snapshotDate).sort();

	const output: {
		ok: boolean;
		today: string;
		totalSnapshots: number;
		trackedProjects: number;
		firstSnapshot: string | undefined;
		lastSnapshot: string | undefined;
		weeklyPagePatched?: boolean;
		weeklyPageId?: string;
		notes?: string[];
	} = {
		ok: true,
		today,
		totalSnapshots: snapshots.length,
		trackedProjects: new Set(snapshots.map((s) => s.projectId)).size,
		firstSnapshot: allDates[0],
		lastSnapshot: allDates[allDates.length - 1],
	};

	if (live) {
		const notes: string[] = [];
		const token = resolveRequiredNotionToken(
			"NOTION_TOKEN is required for trend-analysis --live",
		);
		const weekStart = startOfWeekMonday(today);
		const configPath =
			options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
		const config = await loadLocalPortfolioControlTowerConfig(configPath);
		const api = new DirectNotionClient(token);

		const weeklySchema = await api.retrieveDataSource(
			config.relatedDataSources.weeklyReviewsId,
		);
		const weeklyPages = await fetchAllPages(
			api,
			config.relatedDataSources.weeklyReviewsId,
			weeklySchema.titlePropertyName,
		);

		const weeklyPage = weeklyPages.find(
			(p) => p.title === `Week of ${weekStart}`,
		);

		if (!weeklyPage) {
			notes.push(
				`No weekly review page found for Week of ${weekStart} — skipping patch`,
			);
			output.notes = notes;
		} else {
			const previousPage = await api.readPageMarkdown(weeklyPage.id);
			const section = `${TREND_REPORT_START}\n${markdown}\n${TREND_REPORT_END}`;
			const nextMarkdown = previousPage.markdown.includes(TREND_REPORT_START)
				? mergeTrendSectionInto(previousPage.markdown, markdown)
				: `${previousPage.markdown}\n\n${section}`;

			await syncManagedMarkdownSection({
				api,
				pageId: weeklyPage.id,
				previousMarkdown: previousPage.markdown,
				nextMarkdown,
				startMarker: TREND_REPORT_START,
				endMarker: TREND_REPORT_END,
			});

			output.weeklyPagePatched = true;
			output.weeklyPageId = weeklyPage.id;
		}
	}

	console.log(JSON.stringify(output, null, 2));
	console.log("\n" + markdown);
}

function mergeTrendSectionInto(
	markdown: string,
	nextSectionBody: string,
): string {
	const startIdx = markdown.indexOf(TREND_REPORT_START);
	const endIdx = markdown.indexOf(TREND_REPORT_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return `${markdown}\n\n${TREND_REPORT_START}\n${nextSectionBody}\n${TREND_REPORT_END}`;
	}
	const before = markdown.slice(0, startIdx);
	const after = markdown.slice(endIdx + TREND_REPORT_END.length);
	return `${before}${TREND_REPORT_START}\n${nextSectionBody}\n${TREND_REPORT_END}${after}`;
}
