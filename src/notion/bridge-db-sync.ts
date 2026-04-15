import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { Client } from "@notionhq/client";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { losAngelesToday } from "../utils/date.js";
import { toErrorMessage } from "../utils/errors.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	relationValue,
} from "./local-portfolio-control-tower-live.js";
import { toIntelligenceProjectRecord } from "./local-portfolio-intelligence-live.js";

export interface BridgeDbSyncOptions {
	live?: boolean;
	today?: string;
	config?: string;
	/** Override path to bridge.db */
	dbPath?: string;
	/** Maximum rows to process in one run */
	limit?: number;
}

export interface BridgeDbSyncResult {
	rowsFound: number;
	rowsWritten: number;
	rowsSkipped: number;
	failures: number;
	notes: string[];
}

const BRIDGE_DB_DEFAULT_PATH = `${homedir()}/.local/share/bridge-db/bridge.db`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runBridgeDbSyncCommand(
	options: BridgeDbSyncOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for bridge-db sync",
	);
	const live = options.live ?? false;
	const today = options.today ?? losAngelesToday();
	const configPath =
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
	const config = await loadLocalPortfolioControlTowerConfig(configPath);
	const dbPath =
		options.dbPath ?? process.env["BRIDGE_DB_PATH"] ?? BRIDGE_DB_DEFAULT_PATH;
	const limit = options.limit ?? 50;

	const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
	const api = new DirectNotionClient(token);

	// Fetch project list and build log schema
	const [projectSchema, buildSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.relatedDataSources.buildLogId),
	]);

	const [projectPages] = await Promise.all([
		fetchAllPages(
			sdk,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
	]);

	const projects = projectPages.map((page) =>
		toIntelligenceProjectRecord(page),
	);
	const projectIndex = buildProjectNameIndex(
		projects.map((p) => ({ id: p.id, title: p.title })),
	);

	// Read unprocessed SHIPPED rows from bridge-db
	const rows = readShippedRows(dbPath, limit);
	if (rows.error) {
		console.error(
			`[bridge-db-sync] Failed to read bridge.db at ${dbPath}: ${rows.error}`,
		);
		return;
	}

	const result: BridgeDbSyncResult = {
		rowsFound: rows.entries.length,
		rowsWritten: 0,
		rowsSkipped: 0,
		failures: 0,
		notes: [],
	};

	console.log(
		`[bridge-db-sync] Found ${result.rowsFound} unprocessed SHIPPED rows. live=${live}`,
	);

	for (const row of rows.entries) {
		const localProjectId = resolveProjectId(row.project_name, projectIndex);
		if (!localProjectId) {
			result.rowsSkipped += 1;
			result.notes.push(
				`Skipped row ${row.id}: project "${row.project_name}" not matched to a Local Portfolio project.`,
			);
			continue;
		}

		const sessionDate = row.timestamp?.slice(0, 10) ?? today;
		const title = buildBuildLogTitle(row);

		if (!live) {
			console.log(
				`[bridge-db-sync] [dry-run] Would write: "${title}" → project ${localProjectId}`,
			);
			result.rowsWritten += 1;
			continue;
		}

		try {
			const created = await api.createPageWithMarkdown({
				parent: { data_source_id: config.relatedDataSources.buildLogId },
				properties: {
					[buildSchema.titlePropertyName]: {
						title: [{ text: { content: title } }],
					},
				},
				markdown: buildMarkdownBody(row),
			});
			// Set Session Date and Local Project relation after creation
			await api.updatePageProperties({
				pageId: created.id,
				properties: {
					"Session Date": { date: { start: sessionDate } },
					"Local Project": relationValue([localProjectId]),
					Tags: buildTagProperty(row),
				},
			});
			const marked = markRowProcessed(dbPath, row.id);
			if (marked) {
				result.rowsWritten += 1;
				console.log(`[bridge-db-sync] Written: "${title}" (${created.id})`);
			} else {
				result.failures += 1;
				result.notes.push(
					`Failed to mark row ${row.id} as PROCESSED in bridge-db — it will be re-processed on next run.`,
				);
			}
		} catch (error) {
			result.failures += 1;
			result.notes.push(
				`Failed to write row ${row.id} ("${row.project_name}"): ${toErrorMessage(error)}`,
			);
		}
	}

	const summary = [
		`Bridge-db sync complete (live=${live}):`,
		`  Found:   ${result.rowsFound}`,
		`  Written: ${result.rowsWritten}`,
		`  Skipped: ${result.rowsSkipped}`,
		`  Failed:  ${result.failures}`,
	];
	if (result.notes.length > 0) {
		summary.push("  Notes:");
		for (const note of result.notes) {
			summary.push(`    - ${note}`);
		}
	}
	console.log(summary.join("\n"));
}

// ---------------------------------------------------------------------------
// SQLite helpers (shell-based — no native dependency)
// ---------------------------------------------------------------------------

export interface BridgeDbRow {
	id: number;
	source: string;
	timestamp: string;
	project_name: string;
	summary: string;
	branch: string | null;
	tags: string;
}

interface ReadResult {
	entries: BridgeDbRow[];
	error?: string;
}

export function readShippedRows(dbPath: string, limit: number): ReadResult {
	const query =
		`SELECT id, source, timestamp, project_name, summary, branch, tags ` +
		`FROM activity_log ` +
		`WHERE json_array_length(tags) > 0 ` +
		`AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'SHIPPED') ` +
		`AND NOT EXISTS (SELECT 1 FROM json_each(tags) WHERE value = 'PROCESSED') ` +
		`ORDER BY timestamp DESC ` +
		`LIMIT ${limit}`;

	const result = spawnSync("sqlite3", ["-json", dbPath, query], {
		encoding: "utf8",
		timeout: 10_000,
	});

	if (result.error) {
		return { entries: [], error: toErrorMessage(result.error) };
	}
	if (result.status !== 0) {
		return {
			entries: [],
			error:
				result.stderr?.trim() ||
				`sqlite3 exited with code ${result.status ?? "?"}`,
		};
	}

	const stdout = result.stdout?.trim() || "[]";
	try {
		const rows = JSON.parse(stdout) as BridgeDbRow[];
		return { entries: rows };
	} catch (error) {
		return {
			entries: [],
			error: `JSON parse failed: ${toErrorMessage(error)}`,
		};
	}
}

export function markRowProcessed(dbPath: string, rowId: number): boolean {
	const query =
		`UPDATE activity_log ` +
		`SET tags = json_insert(tags, '$[#]', 'PROCESSED') ` +
		`WHERE id = ${rowId}`;

	const result = spawnSync("sqlite3", [dbPath, query], {
		encoding: "utf8",
		timeout: 5_000,
	});

	if (result.error || result.status !== 0) {
		console.error(
			`[bridge-db-sync] Failed to mark row ${rowId} as PROCESSED: ${result.stderr?.trim() ?? result.error?.message ?? ""}`,
		);
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function buildBuildLogTitle(row: BridgeDbRow): string {
	let prefix: string;
	if (row.source === "cc") {
		prefix = "CC";
	} else if (row.source === "codex") {
		prefix = "Codex";
	} else if (row.source === "manual") {
		prefix = "Manual";
	} else {
		prefix = row.source;
	}
	const date = row.timestamp?.slice(0, 10) ?? "";
	const project = row.project_name;
	return `[${prefix}] ${project} — ${date}`;
}

function buildMarkdownBody(row: BridgeDbRow): string {
	const lines: string[] = [];
	lines.push(`## Session Summary`);
	lines.push("");
	lines.push(row.summary);
	if (row.branch) {
		lines.push("");
		lines.push(`**Branch:** \`${row.branch}\``);
	}
	lines.push("");
	lines.push(
		`**Source:** ${row.source}  |  **Date:** ${row.timestamp?.slice(0, 10) ?? "unknown"}`,
	);
	return lines.join("\n");
}

export function buildTagProperty(row: BridgeDbRow): {
	multi_select: Array<{ name: string }>;
} {
	const tags: string[] = [];
	try {
		const parsed = JSON.parse(row.tags) as unknown;
		if (Array.isArray(parsed)) {
			for (const t of parsed) {
				if (typeof t === "string" && t !== "SHIPPED" && t !== "PROCESSED") {
					tags.push(t);
				}
			}
		}
	} catch {
		// malformed tags — skip
	}
	tags.push(row.source);
	return { multi_select: tags.map((name) => ({ name })) };
}

// ---------------------------------------------------------------------------
// Project name resolution (shared pattern from external-signal-sync)
// ---------------------------------------------------------------------------

export function buildProjectNameIndex(
	projects: Array<{ id: string; title: string }>,
): Map<string, string> {
	const index = new Map<string, string>();
	for (const project of projects) {
		index.set(project.title.toLowerCase().trim(), project.id);
		index.set(
			project.title.toLowerCase().trim().replace(/\s+/g, "-"),
			project.id,
		);
		index.set(
			project.title.toLowerCase().trim().replace(/-/g, " "),
			project.id,
		);
	}
	return index;
}

function resolveProjectId(
	projectName: string,
	index: Map<string, string>,
): string | undefined {
	const normalized = projectName.toLowerCase().trim();
	return (
		index.get(normalized) ||
		index.get(normalized.replace(/\s+/g, "-")) ||
		index.get(normalized.replace(/-/g, " "))
	);
}

// ---------------------------------------------------------------------------
// Legacy entry point
// ---------------------------------------------------------------------------

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["bridge-db", "sync"]);
}
