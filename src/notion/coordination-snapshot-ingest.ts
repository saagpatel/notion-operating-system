import { readFile } from "node:fs/promises";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError } from "../utils/errors.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import {
	datePropertyValue,
	relationIds,
	relationValue,
	richTextValue,
	selectPropertyValue,
	selectValue,
	titleValue,
	type NotionPageProperty,
} from "./local-portfolio-control-tower-live.js";
import { requirePhase5ExternalSignals } from "./local-portfolio-external-signals.js";

export const COORDINATION_NOTION_EXPORT_SCHEMA_VERSION = "personal_ops.coordination_notion_export.v1" as const;
export const COORDINATION_NOTION_SIGNAL_SCHEMA_VERSION = "personal_ops.coordination_notion_signal.v1" as const;

export type CoordinationSignalStatus = "ok" | "needs_attention" | "deferred";
export type CoordinationSignalUrgency = "low" | "medium" | "high";

export interface PersonalOpsCoordinationSignalRow {
	schema_version: typeof COORDINATION_NOTION_SIGNAL_SCHEMA_VERSION;
	snapshot_id: string;
	generated_at: string;
	source: string;
	project_key: string | null;
	project_title: string;
	summary: string;
	status: CoordinationSignalStatus;
	urgency: CoordinationSignalUrgency;
	needs_review: boolean;
	archive_candidate: boolean;
	confidence: "high" | "medium" | "low";
	freshness_at: string | null;
	evidence_refs: string[];
	dedupe_key: string;
	raw_excerpt: string;
}

export interface PersonalOpsCoordinationNotionExport {
	schema_version: typeof COORDINATION_NOTION_EXPORT_SCHEMA_VERSION;
	generated_at: string;
	mode: "export_only";
	destination: "notion_external_signal_provider";
	snapshot_id: string;
	source_snapshot: {
		schema_version: "1.0.0";
		generated_at: string;
		overall: "green" | "yellow" | "red";
	};
	summary: {
		rows_total: number;
		needs_review: number;
		archive_candidates: number;
		highest_urgency: CoordinationSignalUrgency | null;
	};
	handoff: {
		consumer: "notion";
		write_mode: "dry_run_only";
		source_owner: "personal_ops";
		ledger_owner: "notion";
		consumer_command: string;
		verification_checks: string[];
	};
	rows: PersonalOpsCoordinationSignalRow[];
	next_actions: string[];
}

export interface CoordinationSnapshotIngestionPlanCheck {
	id: string;
	title: string;
	state: "pass" | "fail";
	message: string;
}

export interface CoordinationSnapshotIngestionPlanItem {
	dedupe_key: string;
	target: "external_signal_events";
	provider_key: "personal_ops_coordination_snapshot";
	title: string;
	status: CoordinationSignalStatus;
	severity: "Info" | "Watch" | "Risk";
	would_write: boolean;
	summary: string;
	evidence_refs: string[];
	raw_excerpt: string;
}

export type CoordinationSnapshotIngestionMode = "dry_run" | "live";
export type CoordinationSnapshotWriteScope = "none" | "events";

export interface CoordinationSnapshotIngestionPlan {
	schema_version: "notion.personal_ops_coordination_ingestion_plan.v1";
	generated_at: string;
	mode: CoordinationSnapshotIngestionMode;
	write_scope: CoordinationSnapshotWriteScope;
	source_snapshot_id: string;
	source_generated_at: string;
	summary: {
		rows_seen: number;
		items_planned: number;
		planned_writes: number;
		needs_review: number;
		archive_candidates: number;
		deferred_rows: number;
		highest_urgency: CoordinationSignalUrgency | null;
		dry_run_contract_verified: boolean;
	};
	checks: CoordinationSnapshotIngestionPlanCheck[];
	items: CoordinationSnapshotIngestionPlanItem[];
	next_actions: string[];
}

export interface CoordinationSnapshotIngestionOptions {
	mode?: CoordinationSnapshotIngestionMode;
	writeScope?: CoordinationSnapshotWriteScope;
}

export interface CoordinationSnapshotLiveWriteResult {
	mode: "live";
	write_scope: "events";
	source_page_id: string;
	created_events: number;
	updated_events: number;
	read_back_verified: number;
	written_event_ids: string[];
}

export interface CoordinationSnapshotEventWriter {
	upsertEvents(input: {
		payload: PersonalOpsCoordinationNotionExport;
		plan: CoordinationSnapshotIngestionPlan;
	}): Promise<CoordinationSnapshotLiveWriteResult>;
}

function assertCoordinationExport(value: unknown): PersonalOpsCoordinationNotionExport {
	const parsed = value as Partial<{ coordination_notion_export: unknown }> & Partial<PersonalOpsCoordinationNotionExport>;
	const payload = (parsed.coordination_notion_export ?? parsed) as Partial<PersonalOpsCoordinationNotionExport>;
	if (payload.schema_version !== COORDINATION_NOTION_EXPORT_SCHEMA_VERSION) {
		throw new AppError("Coordination export must use personal_ops.coordination_notion_export.v1.");
	}
	if (payload.mode !== "export_only" || payload.destination !== "notion_external_signal_provider") {
		throw new AppError("Coordination export must be export_only for notion_external_signal_provider.");
	}
	if (!payload.snapshot_id || !payload.generated_at || !Array.isArray(payload.rows)) {
		throw new AppError("Coordination export is missing snapshot metadata or rows.");
	}
	if (
		payload.source_snapshot?.schema_version !== "1.0.0" ||
		!payload.source_snapshot.generated_at ||
		!["green", "yellow", "red"].includes(String(payload.source_snapshot.overall))
	) {
		throw new AppError("Coordination export is missing valid source snapshot metadata.");
	}
	if (
		payload.handoff?.consumer !== "notion" ||
		payload.handoff.write_mode !== "dry_run_only" ||
		payload.handoff.source_owner !== "personal_ops" ||
		payload.handoff.ledger_owner !== "notion"
	) {
		throw new AppError("Coordination export handoff must keep Notion ingestion dry-run-only.");
	}
	if (!payload.summary || payload.summary.rows_total !== payload.rows.length) {
		throw new AppError("Coordination export summary does not match rows.");
	}
	const dedupeKeys = new Set<string>();
	for (const [index, row] of payload.rows.entries()) {
		if (row?.schema_version !== COORDINATION_NOTION_SIGNAL_SCHEMA_VERSION) {
			throw new AppError(`Coordination export row ${index} has an unsupported schema version.`);
		}
		if (row.snapshot_id !== payload.snapshot_id) {
			throw new AppError(`Coordination export row ${index} does not match the payload snapshot id.`);
		}
		if (!row.dedupe_key || dedupeKeys.has(row.dedupe_key)) {
			throw new AppError(`Coordination export row ${index} has a missing or duplicate dedupe key.`);
		}
		dedupeKeys.add(row.dedupe_key);
		if (!row.project_title || !row.summary || !Array.isArray(row.evidence_refs) || row.evidence_refs.length === 0) {
			throw new AppError(`Coordination export row ${index} is missing title, summary, or evidence refs.`);
		}
	}
	return payload as PersonalOpsCoordinationNotionExport;
}

function severityForRow(row: PersonalOpsCoordinationSignalRow): CoordinationSnapshotIngestionPlanItem["severity"] {
	if (row.urgency === "high" || row.status === "needs_attention") return "Risk";
	if (row.urgency === "medium" || row.needs_review || row.status === "deferred") return "Watch";
	return "Info";
}

export function buildCoordinationSnapshotIngestionPlan(
	input: unknown,
	now = new Date(),
	options: CoordinationSnapshotIngestionOptions = {},
): CoordinationSnapshotIngestionPlan {
	const payload = assertCoordinationExport(input);
	const mode = options.mode ?? "dry_run";
	const writeScope = options.writeScope ?? "none";
	if (mode === "dry_run" && writeScope !== "none") {
		throw new AppError("Dry-run coordination ingestion must use write_scope none.");
	}
	if (mode === "live" && writeScope !== "events") {
		throw new AppError("Live coordination ingestion must use write_scope events.");
	}
	const items = payload.rows.map((row) => ({
		dedupe_key: row.dedupe_key,
		target: "external_signal_events" as const,
		provider_key: "personal_ops_coordination_snapshot" as const,
		title: `Coordination Snapshot - ${row.project_title}`,
		status: row.status,
		severity: severityForRow(row),
		would_write: mode === "live",
		summary: row.summary,
		evidence_refs: row.evidence_refs,
		raw_excerpt: row.raw_excerpt,
	}));
	const checks: CoordinationSnapshotIngestionPlanCheck[] = [
		{
			id: "schema",
			title: "Schema and snapshot identity",
			state: "pass",
			message: "Payload and row schema versions are supported and row snapshot ids match the export.",
		},
		{
			id: "dedupe",
			title: "Dedupe keys are unique",
			state: "pass",
			message: `${payload.rows.length} row dedupe keys are unique within this snapshot.`,
		},
		{
			id: "evidence",
			title: "Rows include evidence references",
			state: "pass",
			message: "Every planned signal has at least one evidence reference.",
		},
		{
			id: "dry_run",
			title: mode === "dry_run" ? "Dry-run contract" : "Approved write contract",
			state: "pass",
			message:
				mode === "dry_run"
					? "This command still plans zero Notion writes."
					: "Live writes are limited to External Signal Events and require explicit approval flags.",
		},
	];
	return {
		schema_version: "notion.personal_ops_coordination_ingestion_plan.v1",
		generated_at: now.toISOString(),
		mode,
		write_scope: writeScope,
		source_snapshot_id: payload.snapshot_id,
		source_generated_at: payload.generated_at,
		summary: {
			rows_seen: payload.rows.length,
			items_planned: items.length,
			planned_writes: mode === "live" ? items.length : 0,
			needs_review: payload.rows.filter((row) => row.needs_review).length,
			archive_candidates: payload.rows.filter((row) => row.archive_candidate).length,
			deferred_rows: payload.rows.filter((row) => row.status === "deferred").length,
			highest_urgency: payload.summary.highest_urgency,
			dry_run_contract_verified: mode === "dry_run",
		},
		checks,
		items,
		next_actions:
			mode === "dry_run"
				? [
						"Review the dry-run plan before running the approved Notion event write.",
						"Run live only with --live --write-scope events --confirm-live after the plan is accepted.",
					]
				: [
						"Read back the written External Signal Events by dedupe key.",
						"Keep Personal Ops as the snapshot generator and Notion as the ledger consumer.",
					],
	};
}

export function formatCoordinationSnapshotIngestionPlan(plan: CoordinationSnapshotIngestionPlan): string {
	const lines: string[] = [];
	lines.push("Personal Ops Coordination Ingestion Plan");
	lines.push(`Generated: ${plan.generated_at}`);
	lines.push(`Mode: ${plan.mode}`);
	lines.push(`Write scope: ${plan.write_scope}`);
	lines.push(`Source snapshot: ${plan.source_snapshot_id}`);
	lines.push(`Rows: ${plan.summary.rows_seen}`);
	lines.push(`Planned writes: ${plan.summary.planned_writes}`);
	lines.push(`Deferred rows: ${plan.summary.deferred_rows}`);
	lines.push(`Dry-run contract: ${plan.summary.dry_run_contract_verified ? "verified" : "not verified"}`);
	lines.push("");
	lines.push("Quality Checks");
	for (const check of plan.checks) {
		lines.push(`- ${check.state}: ${check.title}`);
		lines.push(`  ${check.message}`);
	}
	lines.push("");
	lines.push("Signals");
	for (const item of plan.items) {
		lines.push(`- ${item.severity}: ${item.title} (${item.status})`);
		lines.push(`  ${item.summary}`);
	}
	lines.push("");
	lines.push("Next Actions");
	for (const action of plan.next_actions) lines.push(`- ${action}`);
	return lines.join("\n");
}

export async function runCoordinationSnapshotIngestionPlanCommand(options: {
	input?: string;
	json?: boolean;
	live?: boolean;
	confirmLive?: boolean;
	writeScope?: CoordinationSnapshotWriteScope;
	config?: string;
	writer?: CoordinationSnapshotEventWriter;
}): Promise<void> {
	if (!options.input) {
		throw new AppError("--input is required");
	}
	const live = options.live ?? false;
	const confirmLive = options.confirmLive ?? false;
	const writeScope = options.writeScope ?? "none";
	if (confirmLive && !live) {
		throw new AppError("--confirm-live can only be used with --live.");
	}
	if (writeScope === "events" && !live) {
		throw new AppError("--write-scope events requires --live.");
	}
	if (live && !confirmLive) {
		throw new AppError("Live coordination ingestion requires --confirm-live.");
	}
	if (live && writeScope !== "events") {
		throw new AppError("Live coordination ingestion requires --write-scope events.");
	}
	const raw = await readFile(options.input, "utf8");
	const parsed = JSON.parse(raw);
	const mode: CoordinationSnapshotIngestionMode = live ? "live" : "dry_run";
	const plan = buildCoordinationSnapshotIngestionPlan(parsed, new Date(), {
		mode,
		writeScope,
	});
	let writeResult: CoordinationSnapshotLiveWriteResult | undefined;
	if (live) {
		const payload = assertCoordinationExport(parsed);
		const writer = options.writer ?? (await createNotionCoordinationSnapshotEventWriter(options.config));
		writeResult = await writer.upsertEvents({ payload, plan });
	}
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					coordination_snapshot_ingestion_plan: plan,
					...(writeResult ? { coordination_snapshot_write_result: writeResult } : {}),
				},
				null,
				2,
			),
		);
		return;
	}
	console.log(formatCoordinationSnapshotIngestionPlan(plan));
	if (writeResult) {
		console.log("");
		console.log("Write Result");
		console.log(`- Created events: ${writeResult.created_events}`);
		console.log(`- Updated events: ${writeResult.updated_events}`);
		console.log(`- Read-back verified: ${writeResult.read_back_verified}`);
	}
}

async function createNotionCoordinationSnapshotEventWriter(
	configPath?: string,
): Promise<CoordinationSnapshotEventWriter> {
	const token = resolveRequiredNotionToken("NOTION_TOKEN is required for live coordination snapshot ingestion");
	const config = await loadLocalPortfolioControlTowerConfig(configPath);
	const phase5 = requirePhase5ExternalSignals(config);
	const api = new DirectNotionClient(token);
	const [, eventSchema] = await Promise.all([
		api.retrieveDataSource(phase5.sources.dataSourceId),
		api.retrieveDataSource(phase5.events.dataSourceId),
	]);

	return {
		async upsertEvents({ payload, plan }) {
			const sourcePage = await findPersonalOpsCoordinationSource({
				api,
				dataSourceId: phase5.sources.dataSourceId,
			});
			if (!sourcePage) {
				throw new AppError(
					"Live coordination ingestion requires an active External Signal Source row with Identifier = personal_ops_coordination_snapshot.",
				);
			}
			const sourceStatus = selectValue(sourcePage.properties?.Status);
			if (sourceStatus !== "Active") {
				throw new AppError("The personal_ops_coordination_snapshot source row must be Active before live writes.");
			}
			const localProjectIds = relationIds(sourcePage.properties?.["Local Project"]);

			let createdEvents = 0;
			let updatedEvents = 0;
			const writtenEventIds: string[] = [];
			for (const item of plan.items) {
				const row = payload.rows.find((candidate) => candidate.dedupe_key === item.dedupe_key);
				if (!row) {
					throw new AppError(`No source row found for planned dedupe key ${item.dedupe_key}.`);
				}
				const existing = await findCoordinationEventByKey({
					api,
					dataSourceId: phase5.events.dataSourceId,
					eventKey: item.dedupe_key,
				});
				const properties = buildCoordinationEventProperties({
					titlePropertyName: eventSchema.titlePropertyName,
					item,
					row,
					sourcePageId: sourcePage.id,
					localProjectIds,
				});
				if (existing) {
					await api.updatePageProperties({
						pageId: existing.id,
						properties,
					});
					updatedEvents += 1;
					writtenEventIds.push(existing.id);
				} else {
					const created = await api.createPageWithMarkdown({
						parent: {
							data_source_id: phase5.events.dataSourceId,
						},
						properties,
						markdown: renderCoordinationEventMarkdown(item, row),
					});
					createdEvents += 1;
					writtenEventIds.push(created.id);
				}
			}

			let readBackVerified = 0;
			for (const item of plan.items) {
				const readBack = await findCoordinationEventByKey({
					api,
					dataSourceId: phase5.events.dataSourceId,
					eventKey: item.dedupe_key,
				});
				if (!readBack) {
					throw new AppError(`Read-back verification failed for coordination event ${item.dedupe_key}.`);
				}
				readBackVerified += 1;
			}

			return {
				mode: "live",
				write_scope: "events",
				source_page_id: sourcePage.id,
				created_events: createdEvents,
				updated_events: updatedEvents,
				read_back_verified: readBackVerified,
				written_event_ids: writtenEventIds,
			};
		},
	};
}

async function findPersonalOpsCoordinationSource(input: {
	api: DirectNotionClient;
	dataSourceId: string;
}): Promise<{
	id: string;
	url: string;
	title?: string;
	properties?: Record<string, NotionPageProperty>;
} | null> {
	const response = await input.api.queryDataSourcePages({
		dataSourceId: input.dataSourceId,
		pageSize: 1,
		filter: {
			and: [
				{
					property: "Identifier",
					rich_text: { equals: "personal_ops_coordination_snapshot" },
				},
				{
					property: "Status",
					select: { equals: "Active" },
				},
			],
		},
	});
	return (response.results?.[0] as
		| {
				id: string;
				url: string;
				title?: string;
				properties?: Record<string, NotionPageProperty>;
		  }
		| undefined) ?? null;
}

async function findCoordinationEventByKey(input: {
	api: DirectNotionClient;
	dataSourceId: string;
	eventKey: string;
}): Promise<{ id: string; url: string; properties?: Record<string, unknown> } | null> {
	const response = await input.api.queryDataSourcePages({
		dataSourceId: input.dataSourceId,
		pageSize: 1,
		filter: {
			property: "Event Key",
			rich_text: { equals: input.eventKey },
		},
	});
	return response.results?.[0] ?? null;
}

function buildCoordinationEventProperties(input: {
	titlePropertyName: string;
	item: CoordinationSnapshotIngestionPlanItem;
	row: PersonalOpsCoordinationSignalRow;
	sourcePageId: string;
	localProjectIds: string[];
}): Record<string, unknown> {
	return {
		[input.titlePropertyName]: titleValue(input.item.title),
		"Local Project": relationValue(input.localProjectIds),
		Source: relationValue([input.sourcePageId]),
		Provider: selectPropertyValue("Personal Ops"),
		"Signal Type": selectPropertyValue("Audit"),
		"Occurred At": datePropertyValue(input.row.freshness_at ?? input.row.generated_at),
		Status: richTextValue(input.row.status),
		Environment: selectPropertyValue("N/A"),
		Severity: selectPropertyValue(input.item.severity),
		"Source ID": richTextValue(input.row.dedupe_key),
		"Source URL": { url: null },
		"Sync Run": relationValue([]),
		"Event Key": richTextValue(input.row.dedupe_key),
		Summary: richTextValue(input.row.summary),
		"Raw Excerpt": richTextValue(input.row.raw_excerpt),
	};
}

function renderCoordinationEventMarkdown(
	item: CoordinationSnapshotIngestionPlanItem,
	row: PersonalOpsCoordinationSignalRow,
): string {
	return [
		`# ${item.title}`,
		"",
		`- Provider: Personal Ops`,
		`- Signal type: Audit`,
		`- Status: ${row.status}`,
		`- Urgency: ${row.urgency}`,
		`- Severity: ${item.severity}`,
		`- Snapshot: ${row.snapshot_id}`,
		`- Dedupe key: ${row.dedupe_key}`,
		"",
		"## Summary",
		row.summary,
		"",
		"## Evidence",
		...row.evidence_refs.map((ref) => `- ${ref}`),
		"",
		"## Raw Excerpt",
		row.raw_excerpt || "No raw excerpt captured.",
	].join("\n");
}
