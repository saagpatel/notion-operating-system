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
import { syncManagedMarkdownSectionWithReadBack } from "./managed-markdown-sync.js";

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
	/** `null` means unknown/not-yet-captured — must not be confused with a confirmed 0. */
	openPrCount: number | null;
}

type SnapshotInput = {
	id: string;
	title: string;
	operatingQueue: string;
	evidenceFreshness: string;
	recommendationScore?: number;
	buildSessionCount: number;
	openPrCount?: number | null;
};

/** `(projectId, snapshotDate)` composite key used for same-day idempotency. */
function snapshotIdentityKey(snapshot: {
	projectId: string;
	snapshotDate: string;
}): string {
	return `${snapshot.projectId}::${snapshot.snapshotDate}`;
}

/**
 * Appends one snapshot row per project for `today`, skipping any
 * `(projectId, today)` pair that is already present on disk. Running the
 * same batch twice in a day is then a no-op on the second run instead of a
 * double-write — trend analysis and consecutive-staleness detection stay
 * accurate under retries.
 */
export async function appendSnapshotBatch(
	projects: SnapshotInput[],
	today: string,
): Promise<void> {
	const snapshotPath = DEFAULT_SNAPSHOT_PATH;
	const dir = path.dirname(snapshotPath);
	await mkdir(dir, { recursive: true });

	const existingKeysToday = new Set(
		(await readAllSnapshots())
			.filter((snapshot) => snapshot.snapshotDate === today)
			.map((snapshot) => snapshotIdentityKey(snapshot)),
	);

	const lines = projects
		.filter(
			(p) =>
				!existingKeysToday.has(
					snapshotIdentityKey({ projectId: p.id, snapshotDate: today }),
				),
		)
		.map((p): string => {
			const snapshot: ProjectSnapshot = {
				snapshotDate: today,
				projectId: p.id,
				projectTitle: p.title,
				operatingQueue: p.operatingQueue,
				evidenceFreshness: p.evidenceFreshness,
				recommendationScore: p.recommendationScore ?? 0,
				buildSessionCount: p.buildSessionCount,
				openPrCount: p.openPrCount ?? null,
			};
			return JSON.stringify(snapshot);
		});

	if (lines.length === 0) {
		return;
	}

	const content = lines.join("\n") + "\n";
	await appendFile(snapshotPath, content, "utf8");
}

/**
 * Reads every snapshot line and dedupes by `(projectId, snapshotDate)`,
 * keeping the last occurrence (append order = write order, so "last" is
 * "most recently written"). This heals any historical duplicates left by a
 * pre-idempotency double-run in addition to protecting fresh reads.
 */
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

	const byIdentityKey = new Map<string, ProjectSnapshot>();
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			const snapshot = parseSnapshot(parsed);
			byIdentityKey.set(snapshotIdentityKey(snapshot), snapshot);
		} catch {
			console.warn(
				`[snapshot-history] Skipping malformed snapshot line: ${trimmed.slice(0, 80)}`,
			);
		}
	}
	return [...byIdentityKey.values()];
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
		openPrCount: requireNumberOrNull(obj, "openPrCount"),
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

/** Like `requireNumber`, but a stored `null` (unknown/not-yet-captured) is valid. */
function requireNumberOrNull(
	obj: Record<string, unknown>,
	key: string,
): number | null {
	const val = obj[key];
	if (val === null || val === undefined) {
		return null;
	}
	if (typeof val !== "number") {
		throw new Error(`Snapshot field "${key}" must be a number or null`);
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
		const latestByDate = new Map<string, ProjectSnapshot>();
		for (const snapshot of group) {
			latestByDate.set(snapshot.snapshotDate, snapshot);
		}
		group.splice(
			0,
			group.length,
			...[...latestByDate.values()].sort((a, b) =>
				a.snapshotDate.localeCompare(b.snapshotDate),
			),
		);
	}

	const allDates = snapshots.map((s) => s.snapshotDate).sort();
	const firstSnapshot = allDates[0] ?? today;
	const totalProjects = byProject.size;
	const totalSnapshots = snapshots.length;
	const movement = buildPortfolioMovement(snapshots);

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

	if (movement) {
		lines.push("### Portfolio Movement");
		lines.push(
			`Comparing ${movement.previous.date} to ${movement.latest.date}.`,
			"",
		);
		lines.push("| Metric | Previous | Latest | Delta |");
		lines.push("|---|---:|---:|---:|");
		lines.push(
			`| Projects tracked | ${movement.previous.projectsTracked} | ${movement.latest.projectsTracked} | ${formatDelta(movement.latest.projectsTracked - movement.previous.projectsTracked)} |`,
		);
		lines.push(
			`| Stale evidence | ${movement.previous.staleEvidence} | ${movement.latest.staleEvidence} | ${formatDelta(movement.latest.staleEvidence - movement.previous.staleEvidence)} |`,
		);
		lines.push(
			`| Open PRs | ${formatOpenPrCell(movement.previous)} | ${formatOpenPrCell(movement.latest)} | ${formatDelta(movement.latest.openPrs - movement.previous.openPrs)} |`,
		);
		lines.push(
			`| Average recommendation score | ${movement.previous.averageRecommendationScore.toFixed(1)} | ${movement.latest.averageRecommendationScore.toFixed(1)} | ${formatDelta(movement.latest.averageRecommendationScore - movement.previous.averageRecommendationScore, 1)} |`,
		);
		lines.push("");
		if (
			movement.previous.openPrUnknownCount > 0 ||
			movement.latest.openPrUnknownCount > 0
		) {
			lines.push(
				"*Open PRs total excludes projects where Open PR Count has not yet been captured — see (unknown) counts above.*",
			);
			lines.push("");
		}
	}

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

interface SnapshotDateSummary {
	date: string;
	projectsTracked: number;
	staleEvidence: number;
	/**
	 * Sum over projects with a known Open PR Count. `null` entries contribute
	 * nothing to this total — see `openPrUnknownCount` for how many were
	 * excluded, so the total is never mistaken for "confirmed zero across
	 * the board".
	 */
	openPrs: number;
	/** Count of projects on this date whose Open PR Count is unknown (`null`). */
	openPrUnknownCount: number;
	averageRecommendationScore: number;
}

interface PortfolioMovementSummary {
	previous: SnapshotDateSummary;
	latest: SnapshotDateSummary;
}

function buildPortfolioMovement(
	snapshots: ProjectSnapshot[],
): PortfolioMovementSummary | undefined {
	const distinctDates = [
		...new Set(snapshots.map((s) => s.snapshotDate)),
	].sort();
	if (distinctDates.length < 2) return undefined;
	const latestDate = distinctDates[distinctDates.length - 1];
	const previousDate = distinctDates[distinctDates.length - 2];
	if (!latestDate || !previousDate) return undefined;
	return {
		previous: summarizeSnapshotDate(snapshots, previousDate),
		latest: summarizeSnapshotDate(snapshots, latestDate),
	};
}

function summarizeSnapshotDate(
	snapshots: ProjectSnapshot[],
	date: string,
): SnapshotDateSummary {
	const latestByProject = new Map<string, ProjectSnapshot>();
	for (const snapshot of snapshots) {
		if (snapshot.snapshotDate !== date) continue;
		latestByProject.set(snapshot.projectId, snapshot);
	}
	const dateSnapshots = [...latestByProject.values()];
	const recommendationTotal = dateSnapshots.reduce(
		(total, snapshot) => total + snapshot.recommendationScore,
		0,
	);
	return {
		date,
		projectsTracked: dateSnapshots.length,
		staleEvidence: dateSnapshots.filter((s) => s.evidenceFreshness === "Stale")
			.length,
		openPrs: dateSnapshots.reduce(
			(total, snapshot) => total + (snapshot.openPrCount ?? 0),
			0,
		),
		openPrUnknownCount: dateSnapshots.filter((s) => s.openPrCount === null)
			.length,
		averageRecommendationScore:
			dateSnapshots.length > 0 ? recommendationTotal / dateSnapshots.length : 0,
	};
}

function formatOpenPrCell(summary: SnapshotDateSummary): string {
	return summary.openPrUnknownCount > 0
		? `${summary.openPrs} (${summary.openPrUnknownCount} unknown)`
		: `${summary.openPrs}`;
}

function formatDelta(value: number, precision = 0): string {
	if (value === 0) return "0";
	const formatted =
		precision > 0 ? value.toFixed(precision) : Math.round(value).toString();
	return value > 0 ? `+${formatted}` : formatted;
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

			await syncManagedMarkdownSectionWithReadBack({
				api,
				pageId: weeklyPage.id,
				previousMarkdown: previousPage.markdown,
				nextMarkdown,
				startMarker: TREND_REPORT_START,
				endMarker: TREND_REPORT_END,
				maxAttempts: 2,
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
