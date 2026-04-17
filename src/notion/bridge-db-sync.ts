import { homedir } from "node:os";

import { createNotionSdkClient } from "./notion-sdk.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { losAngelesToday } from "../utils/date.js";
import { toErrorMessage } from "../utils/errors.js";
import { postNotificationHubEvent } from "../utils/notification-hub.js";
import {
	BridgeDbMcpSession,
	type ShippedEvent,
} from "./bridge-db-mcp-client.js";
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
	opsRowsFound: number;
	opsRowsWritten: number;
	opsRowsSkipped: number;
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

	const sdk = createNotionSdkClient(token);
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

	// Read unprocessed SHIPPED rows from bridge-db via MCP
	let entries: ShippedEvent[];
	try {
		entries = await readShippedRows(dbPath, limit);
	} catch (error) {
		console.error(
			`[bridge-db-sync] Failed to read bridge.db at ${dbPath}: ${toErrorMessage(error)}`,
		);
		return;
	}

	const result: BridgeDbSyncResult = {
		rowsFound: entries.length,
		rowsWritten: 0,
		rowsSkipped: 0,
		failures: 0,
		opsRowsFound: 0,
		opsRowsWritten: 0,
		opsRowsSkipped: 0,
		notes: [],
	};

	console.log(
		`[bridge-db-sync] Found ${result.rowsFound} unprocessed SHIPPED rows. live=${live}`,
	);

	for (const row of entries) {
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
			try {
				await markRowProcessed(dbPath, row.id);
				result.rowsWritten += 1;
				console.log(`[bridge-db-sync] Written: "${title}" (${created.id})`);
			} catch (markError) {
				result.failures += 1;
				result.notes.push(
					`Failed to mark row ${row.id} as PROCESSED in bridge-db — it will be re-processed on next run: ${toErrorMessage(markError)}`,
				);
			}
		} catch (error) {
			result.failures += 1;
			result.notes.push(
				`Failed to write row ${row.id} ("${row.project_name}"): ${toErrorMessage(error)}`,
			);
		}
	}

	// ---------------------------------------------------------------------------
	// Process personal-ops event rows (TASK_DONE, APPROVAL_SENT, etc.)
	// ---------------------------------------------------------------------------
	let opsSession: BridgeDbMcpSession | null = null;
	try {
		opsSession = await BridgeDbMcpSession.open();
		const opsEntries = await opsSession.getPersonalOpsEvents(limit);
		result.opsRowsFound = opsEntries.length;
		if (opsEntries.length > 0) {
			console.log(
				`[bridge-db-sync] Found ${opsEntries.length} personal-ops event rows. live=${live}`,
			);
		}
		for (const row of opsEntries) {
			const localProjectId = resolveProjectId(row.project_name, projectIndex);
			const sessionDate = row.timestamp?.slice(0, 10) ?? today;
			const title = buildBuildLogTitle(row);

			if (!live) {
				console.log(
					`[bridge-db-sync] [dry-run] Would write ops event: "${title}"${localProjectId ? ` → project ${localProjectId}` : " (no project match)"}`,
				);
				result.opsRowsWritten += 1;
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
				const updateProps: Record<string, unknown> = {
					"Session Date": { date: { start: sessionDate } },
					Tags: buildTagProperty(row),
				};
				if (localProjectId) {
					updateProps["Local Project"] = relationValue([localProjectId]);
				}
				await api.updatePageProperties({
					pageId: created.id,
					properties: updateProps,
				});
				try {
					await markRowProcessed(dbPath, row.id);
					result.opsRowsWritten += 1;
					console.log(
						`[bridge-db-sync] Written ops event: "${title}" (${created.id})`,
					);
				} catch (markError) {
					result.failures += 1;
					result.notes.push(
						`Failed to mark ops row ${row.id} as PROCESSED: ${toErrorMessage(markError)}`,
					);
				}
			} catch (error) {
				result.failures += 1;
				result.notes.push(
					`Failed to write ops row ${row.id} ("${row.project_name}"): ${toErrorMessage(error)}`,
				);
			}
		}
	} catch (error) {
		console.error(
			`[bridge-db-sync] Failed to read personal-ops events: ${toErrorMessage(error)}`,
		);
	} finally {
		if (opsSession) {
			await opsSession.close();
		}
	}

	// Log activity to bridge-db (best-effort, errors are swallowed in logActivity)
	if (live && (result.rowsWritten > 0 || result.opsRowsWritten > 0)) {
		const logSession = await BridgeDbMcpSession.open();
		try {
			const totalWritten = result.rowsWritten + result.opsRowsWritten;
			await logSession.logActivity(
				`Synced ${result.rowsWritten} SHIPPED + ${result.opsRowsWritten} ops events to Build Log`,
				totalWritten,
			);
		} finally {
			await logSession.close();
		}
	}

	const summary = [
		`Bridge-db sync complete (live=${live}):`,
		`  SHIPPED — Found: ${result.rowsFound}, Written: ${result.rowsWritten}, Skipped: ${result.rowsSkipped}`,
		`  Ops     — Found: ${result.opsRowsFound}, Written: ${result.opsRowsWritten}, Skipped: ${result.opsRowsSkipped}`,
		`  Failed:  ${result.failures}`,
	];
	if (result.notes.length > 0) {
		summary.push("  Notes:");
		for (const note of result.notes) {
			summary.push(`    - ${note}`);
		}
	}
	console.log(summary.join("\n"));
	postNotificationHubEvent({
		source: "notion-os",
		level: result.failures > 0 ? "warn" : "info",
		title: "bridge-db-sync complete",
		body: `${live ? "Live" : "Dry-run"}: SHIPPED ${result.rowsFound}→${result.rowsWritten}, Ops ${result.opsRowsFound}→${result.opsRowsWritten}, ${result.failures} failed`,
	});
}

// ---------------------------------------------------------------------------
// Status command (read-only, no writes)
// ---------------------------------------------------------------------------

export interface BridgeDbStatusOptions {
	dbPath?: string;
}

export async function runBridgeDbStatusCommand(
	options: BridgeDbStatusOptions = {},
): Promise<void> {
	const dbPath =
		options.dbPath ??
		(process.env["BRIDGE_DB_PATH"]?.trim() || BRIDGE_DB_DEFAULT_PATH);

	const session = await BridgeDbMcpSession.open();
	try {
		const status = await session.getStatus();
		// Augment with dbPath so callers get the same shape as before
		const output = { ...status, dbPath };
		console.log(JSON.stringify(output, null, 2));
	} catch (error) {
		console.log(
			JSON.stringify({ ok: false, error: toErrorMessage(error), dbPath }),
		);
	} finally {
		await session.close();
	}
}

// ---------------------------------------------------------------------------
// MCP-backed helpers (replaces shell-based sqlite3 spawning)
// ---------------------------------------------------------------------------

// Re-export ShippedEvent as BridgeDbRow alias for backwards compatibility
// with existing callers that reference BridgeDbRow.
export type {
	BridgeDbStatus,
	ShippedEvent as BridgeDbRow,
} from "./bridge-db-mcp-client.js";

/**
 * Read unprocessed SHIPPED rows from bridge-db via MCP.
 * @param _dbPath - retained for API compatibility; MCP uses its own configured path
 * @param limit - maximum rows to return
 */
export async function readShippedRows(
	_dbPath: string,
	limit: number,
): Promise<ShippedEvent[]> {
	const session = await BridgeDbMcpSession.open();
	try {
		return await session.getShippedEvents(limit);
	} finally {
		await session.close();
	}
}

/**
 * Mark a row as PROCESSED in bridge-db via MCP.
 * Throws on failure so callers can catch and handle.
 * @param _dbPath - retained for API compatibility; MCP uses its own configured path
 * @param rowId - the activity_log row id
 */
export async function markRowProcessed(
	_dbPath: string,
	rowId: number,
): Promise<void> {
	const session = await BridgeDbMcpSession.open();
	try {
		await session.markProcessed(rowId);
	} finally {
		await session.close();
	}
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function buildBuildLogTitle(row: ShippedEvent): string {
	let prefix: string;
	if (row.source === "cc") {
		prefix = "CC";
	} else if (row.source === "codex") {
		prefix = "Codex";
	} else if (row.source === "personal_ops") {
		prefix = "Ops";
	} else if (row.source === "manual") {
		prefix = "Manual";
	} else {
		prefix = row.source;
	}
	const date = row.timestamp?.slice(0, 10) ?? "";
	const project = row.project_name;
	return `[${prefix}] ${project} — ${date}`;
}

function buildMarkdownBody(row: ShippedEvent): string {
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

const STRIP_TAGS = new Set(["SHIPPED", "PROCESSED"]);
const OPS_EVENT_TAG_MAP: Record<string, string> = {
	TASK_DONE: "task-done",
	APPROVAL_SENT: "approval-sent",
	PLANNING_APPLIED: "planning-applied",
	REVIEW_CLOSED: "review-closed",
};

export function buildTagProperty(row: ShippedEvent): {
	multi_select: Array<{ name: string }>;
} {
	const tags: string[] = [];
	try {
		const rawTags =
			typeof row.tags === "string" ? row.tags : JSON.stringify(row.tags ?? []);
		const parsed = JSON.parse(rawTags) as unknown;
		if (Array.isArray(parsed)) {
			for (const t of parsed) {
				if (typeof t !== "string" || STRIP_TAGS.has(t)) continue;
				const mapped = OPS_EVENT_TAG_MAP[t];
				tags.push(mapped ?? t);
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
