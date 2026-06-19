import { homedir } from "node:os";
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
import { createNotionSdkClient } from "./notion-sdk.js";

export interface BridgeDbSyncOptions {
	live?: boolean;
	today?: string;
	config?: string;
	/** Override path to bridge.db */
	dbPath?: string;
	/** Maximum rows to process in one run */
	limit?: number;
	/** Process only SHIPPED rows and skip personal-ops events. */
	shippedOnly?: boolean;
	/** Process only personal-ops events and skip SHIPPED rows. */
	opsOnly?: boolean;
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
const PROJECT_PORTFOLIO_DATA_SOURCE_ID = "35e04e4d-bcd8-45c0-b783-238edef210f7";
const PROJECT_PORTFOLIO_TITLE_PROPERTY = "Project Name";

type BuildLogProjectRelation = "Local Project" | "Project";

interface BuildLogProjectTarget {
	id: string;
	relationProperty: BuildLogProjectRelation;
}

export interface RequiredDataSourceProperty {
	name: string;
	type: string;
}

interface OperationalProjectAlias {
	targetTitle: string;
	relationProperty: BuildLogProjectRelation;
}

const OPERATIONAL_PROJECT_ALIASES = new Map<string, OperationalProjectAlias>([
	[
		"claude-md-lint",
		{ targetTitle: "Machine Audits", relationProperty: "Project" },
	],
	[
		"operator-os-docs",
		{ targetTitle: "Machine Audits", relationProperty: "Project" },
	],
	[
		"portfolio-docs-agent-contract-lane",
		{ targetTitle: "Machine Audits", relationProperty: "Project" },
	],
	[
		"portfolio-dep-security",
		{ targetTitle: "GitHub Repo Auditor", relationProperty: "Local Project" },
	],
	[
		"portfoliocommandcenter",
		{ targetTitle: "GitHub Repo Auditor", relationProperty: "Local Project" },
	],
]);

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
	if (options.shippedOnly && options.opsOnly) {
		throw new Error("--shipped-only and --ops-only cannot be used together.");
	}
	const processShipped = !options.opsOnly;
	const processOps = !options.shippedOnly;

	// Preflight: fail loud before doing any Notion work if the bridge-db bus is an
	// incompatible (too-old) schema, rather than silently producing malformed rows (F4).
	const preflight = await BridgeDbMcpSession.open({ dbPath });
	try {
		await preflight.assertSchemaCompatible();
	} finally {
		await preflight.close();
	}

	const sdk = createNotionSdkClient(token);
	const api = new DirectNotionClient(token);

	// Fetch project lists and build log schema
	const [projectSchema, projectPortfolioSchema, buildSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(PROJECT_PORTFOLIO_DATA_SOURCE_ID),
		api.retrieveDataSource(config.relatedDataSources.buildLogId),
	]);
	assertDataSourceSchemaProperties("Local Portfolio Projects", projectSchema, [
		{ name: projectSchema.titlePropertyName, type: "title" },
	]);
	assertDataSourceSchemaProperties("Project Portfolio", projectPortfolioSchema, [
		{ name: PROJECT_PORTFOLIO_TITLE_PROPERTY, type: "title" },
	]);
	assertDataSourceSchemaProperties("Build Log", buildSchema, [
		{ name: buildSchema.titlePropertyName, type: "title" },
		{ name: "Session Date", type: "date" },
		{ name: "Local Project", type: "relation" },
		{ name: "Project", type: "relation" },
		{ name: "Tags", type: "multi_select" },
	]);

	const [projectPages, projectPortfolioPages] = await Promise.all([
		fetchAllPages(
			sdk,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			PROJECT_PORTFOLIO_DATA_SOURCE_ID,
			PROJECT_PORTFOLIO_TITLE_PROPERTY,
		),
	]);

	const projects = projectPages.map((page) =>
		toIntelligenceProjectRecord(page),
	);
	const projectIndex = buildProjectNameIndex(
		projects.map((p) => ({ id: p.id, title: p.title })),
	);
	const projectPortfolioIndex = buildProjectNameIndex(
		projectPortfolioPages.map((page) => ({ id: page.id, title: page.title })),
	);

	// Read unprocessed SHIPPED rows from bridge-db via MCP
	let entries: ShippedEvent[] = [];
	if (processShipped) {
		try {
			entries = await readShippedRows(dbPath, limit);
		} catch (error) {
			console.error(
				`[bridge-db-sync] Failed to read bridge.db at ${dbPath}: ${toErrorMessage(error)}`,
			);
			return;
		}
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

	if (processShipped) {
		console.log(
			`[bridge-db-sync] Found ${result.rowsFound} unprocessed SHIPPED rows. live=${live}`,
		);
	} else {
		console.log("[bridge-db-sync] Skipping SHIPPED rows (--ops-only).");
	}

	for (const row of entries) {
		const projectTarget = resolveShippedProjectTarget(
			row,
			projectIndex,
			projectPortfolioIndex,
		);
		if (!projectTarget) {
			const alias = resolveOperationalProjectAlias(row.project_name);
			result.rowsSkipped += 1;
			if (alias) {
				result.notes.push(
					`Skipped row ${row.id}: operational alias "${row.project_name}" target "${alias.targetTitle}" not found for Build Log ${alias.relationProperty} relation.`,
				);
			} else {
				result.notes.push(
					`Skipped row ${row.id}: project "${row.project_name}" not matched to a Local Portfolio project.`,
				);
			}
			continue;
		}

		const sessionDate = row.timestamp?.slice(0, 10) ?? today;
		const title = buildBuildLogTitle(row);

		if (!live) {
			console.log(
				`[bridge-db-sync] [dry-run] Would write: "${title}" → ${projectTarget.relationProperty} ${projectTarget.id}`,
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
					[projectTarget.relationProperty]: relationValue([projectTarget.id]),
					Tags: buildTagProperty(row),
				},
			});
			try {
				await confirmShippedRowSynced(dbPath, {
					rowId: row.id,
					downstreamRef: created.id,
					notes: `Created Build Log page "${title}" with Session Date ${sessionDate}`,
				});
				result.rowsWritten += 1;
				console.log(`[bridge-db-sync] Written: "${title}" (${created.id})`);
			} catch (markError) {
				result.failures += 1;
				result.notes.push(
					`Failed to confirm shipped row ${row.id} in bridge-db — it will be re-processed on next run: ${toErrorMessage(markError)}`,
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
	if (processOps) {
		let opsSession: BridgeDbMcpSession | null = null;
		try {
			opsSession = await BridgeDbMcpSession.open({ dbPath });
			const opsEntries = await opsSession.getPersonalOpsEvents(limit);
			result.opsRowsFound = opsEntries.length;
			if (opsEntries.length > 0) {
				console.log(
					`[bridge-db-sync] Found ${opsEntries.length} personal-ops event rows. live=${live}`,
				);
			}
			for (const row of opsEntries) {
				const projectTarget = resolveBuildLogProjectTarget(
					row.project_name,
					projectIndex,
					projectPortfolioIndex,
				);
				const sessionDate = row.timestamp?.slice(0, 10) ?? today;
				const title = buildBuildLogTitle(row);

				if (!live) {
					console.log(
						`[bridge-db-sync] [dry-run] Would write ops event: "${title}"${projectTarget ? ` → ${projectTarget.relationProperty} ${projectTarget.id}` : " (no project match)"}`,
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
					if (projectTarget) {
						updateProps[projectTarget.relationProperty] = relationValue([
							projectTarget.id,
						]);
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
	} else {
		console.log(
			"[bridge-db-sync] Skipping personal-ops event rows (--shipped-only).",
		);
	}

	// Log activity to bridge-db (best-effort, errors are swallowed in logActivity)
	if (live && (result.rowsWritten > 0 || result.opsRowsWritten > 0)) {
		const logSession = await BridgeDbMcpSession.open({ dbPath });
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
	// Unrouted rows = events whose project_name matched no Notion page/alias. They are
	// never written to the Build Log and never marked processed, so they retry every
	// run and silently accumulate. Surface them explicitly and request warn-level
	// handling; notification-hub stores that as normal/Slack-routed instead of
	// info/log-only, so they don't stay invisible (F9).
	const unrouted = result.rowsSkipped + result.opsRowsSkipped;
	postNotificationHubEvent({
		source: "notion-os",
		level: result.failures > 0 || unrouted > 0 ? "warn" : "info",
		title: "bridge-db-sync complete",
		body: `${live ? "Live" : "Dry-run"}: SHIPPED ${result.rowsFound}→${result.rowsWritten}, Ops ${result.opsRowsFound}→${result.opsRowsWritten}, ${unrouted} unrouted, ${result.failures} failed`,
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

	const session = await BridgeDbMcpSession.open({ dbPath });
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
 * @param dbPath - bridge.db path forwarded to the MCP subprocess
 * @param limit - maximum rows to return
 */
export async function readShippedRows(
	dbPath: string,
	limit: number,
): Promise<ShippedEvent[]> {
	const session = await BridgeDbMcpSession.open({ dbPath });
	try {
		return await session.getShippedEvents(limit);
	} finally {
		await session.close();
	}
}

/**
 * Mark a row as PROCESSED in bridge-db via MCP.
 * Throws on failure so callers can catch and handle.
 * @param dbPath - bridge.db path forwarded to the MCP subprocess
 * @param rowId - the activity_log row id
 */
export async function markRowProcessed(
	dbPath: string,
	rowId: number,
): Promise<void> {
	const session = await BridgeDbMcpSession.open({ dbPath });
	try {
		await session.markProcessed(rowId);
	} finally {
		await session.close();
	}
}

export interface ConfirmShippedRowSyncedOptions {
	rowId: number;
	downstreamRef: string;
	notes?: string;
}

/**
 * Record downstream Notion proof for a SHIPPED row and mark it PROCESSED.
 * Throws on failure so callers can catch and retry the row later.
 * @param dbPath - bridge.db path forwarded to the MCP subprocess
 * @param options - activity row and durable downstream Notion proof
 */
export async function confirmShippedRowSynced(
	dbPath: string,
	options: ConfirmShippedRowSyncedOptions,
): Promise<void> {
	const session = await BridgeDbMcpSession.open({ dbPath });
	try {
		await session.confirmShippedSync({
			activityId: options.rowId,
			downstreamRef: options.downstreamRef,
			...(options.notes ? { notes: options.notes } : {}),
		});
	} finally {
		await session.close();
	}
}

export function assertDataSourceSchemaProperties(
	label: string,
	schema: {
		titlePropertyName: string;
		properties?: Record<string, { type?: string }>;
	},
	required: RequiredDataSourceProperty[],
): void {
	const missingOrMismatched = required.flatMap((property) => {
		const actual = schema.properties?.[property.name]?.type;
		if (actual === property.type) {
			return [];
		}
		return [
			`${property.name} expected ${property.type}, got ${actual ?? "missing"}`,
		];
	});
	if (missingOrMismatched.length > 0) {
		throw new Error(
			`${label} schema drift blocks bridge-db sync: ${missingOrMismatched.join("; ")}`,
		);
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
		for (const key of projectNameLookupKeys(project.title)) {
			index.set(key, project.id);
		}
	}
	return index;
}

function resolveProjectId(
	projectName: string,
	index: Map<string, string>,
): string | undefined {
	for (const key of projectNameLookupKeys(projectName)) {
		const projectId = index.get(key);
		if (projectId) return projectId;
	}
	return undefined;
}

/**
 * Resolve the Build Log project relation for a SHIPPED row, preferring the
 * canonical registry over fuzzy title matching (F1).
 *
 * When bridge-db has resolved the row's project through GithubRepoAuditor's
 * canonical registry to an explicit Notion Local Portfolio page id
 * (`notion_sync.state === "ready"`), route directly to that page id. This is a
 * stable `canonical_key → notion_local_page_id` mapping, so a Notion page-title
 * rename or a name divergence (e.g. `IncidentMgmt` vs `IncidentManagement`) no
 * longer silently drops the event. Otherwise fall back to the existing
 * name-based fuzzy/alias resolution — preserving today's behavior for an older
 * bridge-db that omits `notion_sync`, or for a project the registry can't map.
 */
function resolveShippedProjectTarget(
	row: ShippedEvent,
	localProjectIndex: Map<string, string>,
	projectPortfolioIndex: Map<string, string>,
): BuildLogProjectTarget | undefined {
	const notionSync = row.notion_sync;
	if (notionSync?.state === "ready" && notionSync.notion_page_id) {
		// notion_page_id is a Local Portfolio Projects page id → Local Project relation.
		return {
			id: notionSync.notion_page_id,
			relationProperty: "Local Project",
		};
	}
	return resolveBuildLogProjectTarget(
		row.project_name,
		localProjectIndex,
		projectPortfolioIndex,
	);
}

function resolveBuildLogProjectTarget(
	projectName: string,
	localProjectIndex: Map<string, string>,
	projectPortfolioIndex: Map<string, string>,
): BuildLogProjectTarget | undefined {
	const localProjectId = resolveProjectId(projectName, localProjectIndex);
	if (localProjectId) {
		return { id: localProjectId, relationProperty: "Local Project" };
	}

	const portfolioProjectId = resolveProjectId(
		projectName,
		projectPortfolioIndex,
	);
	if (portfolioProjectId) {
		return { id: portfolioProjectId, relationProperty: "Project" };
	}

	const alias = resolveOperationalProjectAlias(projectName);
	if (!alias) {
		return undefined;
	}

	const targetIndex =
		alias.relationProperty === "Project"
			? projectPortfolioIndex
			: localProjectIndex;
	const targetId = resolveProjectId(alias.targetTitle, targetIndex);
	if (!targetId) {
		return undefined;
	}

	return { id: targetId, relationProperty: alias.relationProperty };
}

function resolveOperationalProjectAlias(
	projectName: string,
): OperationalProjectAlias | undefined {
	for (const key of projectNameLookupKeys(projectName)) {
		const alias = OPERATIONAL_PROJECT_ALIASES.get(key);
		if (alias) return alias;
	}
	return undefined;
}

function projectNameLookupKeys(projectName: string): string[] {
	const normalized = projectName.toLowerCase().trim();
	const keys = new Set<string>([
		normalized,
		normalized.replace(/\s+/g, "-"),
		normalized.replace(/-/g, " "),
		normalized.replace(/[^a-z0-9]/g, ""),
	]);
	keys.delete("");
	return [...keys];
}

// ---------------------------------------------------------------------------
// Legacy entry point
// ---------------------------------------------------------------------------

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["bridge-db", "sync"]);
}
