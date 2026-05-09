import { readFile } from "node:fs/promises";

import { AppError } from "../utils/errors.js";

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
	would_write: false;
	summary: string;
	evidence_refs: string[];
	raw_excerpt: string;
}

export interface CoordinationSnapshotIngestionPlan {
	schema_version: "notion.personal_ops_coordination_ingestion_plan.v1";
	generated_at: string;
	mode: "dry_run";
	source_snapshot_id: string;
	source_generated_at: string;
	summary: {
		rows_seen: number;
		items_planned: number;
		needs_review: number;
		archive_candidates: number;
		highest_urgency: CoordinationSignalUrgency | null;
		dry_run_contract_verified: boolean;
	};
	checks: CoordinationSnapshotIngestionPlanCheck[];
	items: CoordinationSnapshotIngestionPlanItem[];
	next_actions: string[];
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
): CoordinationSnapshotIngestionPlan {
	const payload = assertCoordinationExport(input);
	const items = payload.rows.map((row) => ({
		dedupe_key: row.dedupe_key,
		target: "external_signal_events" as const,
		provider_key: "personal_ops_coordination_snapshot" as const,
		title: `Coordination Snapshot - ${row.project_title}`,
		status: row.status,
		severity: severityForRow(row),
		would_write: false as const,
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
			title: "Dry-run contract",
			state: "pass",
			message: "This command still plans zero Notion writes.",
		},
	];
	return {
		schema_version: "notion.personal_ops_coordination_ingestion_plan.v1",
		generated_at: now.toISOString(),
		mode: "dry_run",
		source_snapshot_id: payload.snapshot_id,
		source_generated_at: payload.generated_at,
		summary: {
			rows_seen: payload.rows.length,
			items_planned: items.length,
			needs_review: payload.rows.filter((row) => row.needs_review).length,
			archive_candidates: payload.rows.filter((row) => row.archive_candidate).length,
			highest_urgency: payload.summary.highest_urgency,
			dry_run_contract_verified: true,
		},
		checks,
		items,
		next_actions: [
			"Review the dry-run plan before wiring live Notion writes.",
			"Keep Personal Ops as the snapshot generator and Notion as the ledger consumer.",
		],
	};
}

export function formatCoordinationSnapshotIngestionPlan(plan: CoordinationSnapshotIngestionPlan): string {
	const lines: string[] = [];
	lines.push("Personal Ops Coordination Ingestion Plan");
	lines.push(`Generated: ${plan.generated_at}`);
	lines.push(`Mode: ${plan.mode}`);
	lines.push(`Source snapshot: ${plan.source_snapshot_id}`);
	lines.push(`Rows: ${plan.summary.rows_seen}`);
	lines.push(`Planned writes: 0`);
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
}): Promise<void> {
	if (!options.input) {
		throw new AppError("--input is required");
	}
	const raw = await readFile(options.input, "utf8");
	const plan = buildCoordinationSnapshotIngestionPlan(JSON.parse(raw));
	if (options.json) {
		console.log(JSON.stringify({ coordination_snapshot_ingestion_plan: plan }, null, 2));
		return;
	}
	console.log(formatCoordinationSnapshotIngestionPlan(plan));
}
