/**
 * portfolio-audit:schema-report
 *
 * Analyzes property usage across all Local Portfolio Projects rows.
 * Designed to inform a schema overhaul: shows which deprecated properties
 * have data worth migrating before deletion, and the full value distribution
 * for the 8 overlapping status fields.
 */

import {
	loadRuntimeConfig,
	requireNotionToken,
} from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import {
	type DataSourcePageRef,
	dateValue,
	fetchAllPages,
	type NotionPageProperty,
	numberValue,
	relationIds,
	selectValue,
	textValue,
} from "./local-portfolio-control-tower-live.js";

// ─── Property categories for the report ───────────────────────────────────────

/** Status-adjacent fields — 8 total, proposing to keep 3 */
const STATUS_FIELDS = [
	"Operating Queue",
	"Current State",
	"Portfolio Call",
	"Momentum",
	"Status",
	"Verdict",
	"Registry Status",
	"Pipeline Stage",
] as const;

/** Count numbers that have corresponding relation counterparts */
const COUNT_VS_RELATION: Array<{ countField: string; relationField: string }> =
	[
		{ countField: "Build Session Count", relationField: "Build Sessions" },
		{ countField: "Related Research Count", relationField: "Related Research" },
		{
			countField: "Supporting Skills Count",
			relationField: "Supporting Skills",
		},
		{ countField: "Linked Tool Count", relationField: "Tool Stack Records" },
	];

/** Rich-text fields proposed for removal (move to body or consolidate) */
const RICH_TEXT_TO_REMOVE = [
	"Summary",
	"Completion",
	"Readiness",
	"Audit Notes",
	"Key Integrations",
	"Last Build Session",
	"Last Meaningful Work",
	"Missing Core Pieces",
	"Project Health Notes",
	"Primary Context Doc",
	"Primary User",
	"Known Risks",
	"Problem Solved",
	"Monetization / Strategic Value",
	"What Works",
	"Merged Into",
	"Stack",
	"Value / Outcome",
] as const;

/** Select/multi-select fields proposed for removal */
const SELECT_TO_REMOVE = [
	"Context Quality",
	"Source Group",
	"Primary Tool",
] as const;

const MULTI_SELECT_TO_REMOVE = ["Integration Tags"] as const;

/** Date fields proposed for removal */
const DATE_TO_REMOVE = ["Date Updated", "Last Build Session Date"] as const;

// ─── Analysis helpers ──────────────────────────────────────────────────────────

function countDistribution(
	pages: DataSourcePageRef[],
	field: string,
	reader: (p?: NotionPageProperty) => string,
): { total: number; nonEmpty: number; distribution: Record<string, number> } {
	const dist: Record<string, number> = {};
	let nonEmpty = 0;
	for (const page of pages) {
		const val = reader(page.properties[field]);
		if (val) {
			nonEmpty++;
			dist[val] = (dist[val] ?? 0) + 1;
		}
	}
	return { total: pages.length, nonEmpty, distribution: dist };
}

function countNonEmpty(
	pages: DataSourcePageRef[],
	field: string,
	reader: (p?: NotionPageProperty) => string,
): number {
	return pages.filter((p) => reader(p.properties[field])).length;
}

function countNonZero(pages: DataSourcePageRef[], field: string): number {
	return pages.filter((p) => numberValue(p.properties[field]) > 0).length;
}

function relationCountStats(
	pages: DataSourcePageRef[],
	field: string,
): { nonEmpty: number; totalLinks: number; mismatches?: number } {
	let nonEmpty = 0;
	let totalLinks = 0;
	for (const page of pages) {
		const ids = relationIds(page.properties[field]);
		if (ids.length > 0) {
			nonEmpty++;
			totalLinks += ids.length;
		}
	}
	return { nonEmpty, totalLinks };
}

function formatDistribution(dist: Record<string, number>): string {
	return Object.entries(dist)
		.sort((a, b) => b[1] - a[1])
		.map(([k, v]) => `  ${v.toString().padStart(3)}  ${k}`)
		.join("\n");
}

function pct(count: number, total: number): string {
	return `${count}/${total} (${Math.round((count / total) * 100)}%)`;
}

// ─── Report builder ────────────────────────────────────────────────────────────

function buildReport(pages: DataSourcePageRef[]): string {
	const n = pages.length;
	const lines: string[] = [];

	lines.push(`# Local Portfolio Projects — Schema Report`);
	lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
	lines.push(`Total projects: **${n}**`);
	lines.push("");

	// ── 1. Status field consolidation ──────────────────────────────────────────
	lines.push("## 1. Status Field Consolidation (8 → 3)");
	lines.push("");
	lines.push(
		"The 8 status-adjacent fields. Proposing to keep **Operating Queue**, **Current State**, **Portfolio Call** and remove the rest.",
	);
	lines.push("");

	for (const field of STATUS_FIELDS) {
		const { nonEmpty, distribution } = countDistribution(
			pages,
			field,
			selectValue,
		);
		const keep = [
			"Operating Queue",
			"Current State",
			"Portfolio Call",
		].includes(field);
		const tag = keep ? "✅ KEEP" : "❌ REMOVE";
		lines.push(`### ${field} ${tag}`);
		lines.push(`Used in: ${pct(nonEmpty, n)}`);
		if (nonEmpty > 0) {
			lines.push("Values:");
			lines.push(formatDistribution(distribution));
		} else {
			lines.push("_No values set across any project_");
		}
		lines.push("");
	}

	// ── 2. Count fields vs relation accuracy ───────────────────────────────────
	lines.push("## 2. Count Fields vs. Relation Accuracy");
	lines.push("");
	lines.push(
		"Comparison of manual count numbers vs. actual relation item counts.",
	);
	lines.push("");

	let totalMismatches = 0;
	for (const { countField, relationField } of COUNT_VS_RELATION) {
		const relationStats = relationCountStats(pages, relationField);
		const countNonZeroVal = countNonZero(pages, countField);

		// Compute mismatches
		let mismatches = 0;
		for (const page of pages) {
			const storedCount = numberValue(page.properties[countField]);
			const actualCount = (page.properties[relationField]?.relation ?? [])
				.length;
			if (storedCount !== actualCount) mismatches++;
		}
		totalMismatches += mismatches;

		lines.push(`### ${countField} vs ${relationField} (relation)`);
		lines.push(
			`- Relation non-empty: ${pct(relationStats.nonEmpty, n)} — ${relationStats.totalLinks} total links`,
		);
		lines.push(`- Count field non-zero: ${pct(countNonZeroVal, n)}`);
		lines.push(`- **Mismatches (stale count): ${mismatches}/${n}**`);
		lines.push("");
	}

	lines.push(
		`> **Total stale count fields: ${totalMismatches}** rows have at least one mismatch`,
	);
	lines.push("");

	// ── 3. Rich-text fields proposed for removal ───────────────────────────────
	lines.push("## 3. Rich-Text Fields → Move to Page Body or Consolidate");
	lines.push("");
	lines.push("Fields with content need manual migration before deletion.");
	lines.push("");

	const richTextRows: Array<[string, number, string]> = [];
	for (const field of RICH_TEXT_TO_REMOVE) {
		const count = countNonEmpty(pages, field, textValue);
		const urgency =
			count > 50
				? "🔴 HIGH"
				: count > 10
					? "🟡 MED"
					: count === 0
						? "⚪ EMPTY"
						: "🟢 LOW";
		richTextRows.push([field, count, urgency]);
	}

	richTextRows.sort((a, b) => b[1] - a[1]);
	lines.push("| Field | Non-empty | Priority |");
	lines.push("|---|---|---|");
	for (const [field, count, urgency] of richTextRows) {
		lines.push(`| ${field} | ${pct(count, n)} | ${urgency} |`);
	}
	lines.push("");

	// ── 4. Select/multi-select fields proposed for removal ─────────────────────
	lines.push("## 4. Select Fields Proposed for Removal");
	lines.push("");

	for (const field of SELECT_TO_REMOVE) {
		const { nonEmpty, distribution } = countDistribution(
			pages,
			field,
			selectValue,
		);
		lines.push(`### ${field}`);
		lines.push(`Used in: ${pct(nonEmpty, n)}`);
		if (nonEmpty > 0) {
			lines.push("Values:");
			lines.push(formatDistribution(distribution));
		} else {
			lines.push("_No values set_");
		}
		lines.push("");
	}

	for (const field of MULTI_SELECT_TO_REMOVE) {
		const count = pages.filter(
			(p) => (p.properties[field]?.multi_select ?? []).length > 0,
		).length;
		lines.push(`### ${field} (multi_select)`);
		lines.push(`Used in: ${pct(count, n)}`);
		lines.push("");
	}

	// ── 5. Date fields proposed for removal ────────────────────────────────────
	lines.push("## 5. Date Fields Proposed for Removal");
	lines.push("");

	for (const field of DATE_TO_REMOVE) {
		const count = countNonEmpty(pages, field, dateValue);
		lines.push(`### ${field}`);
		lines.push(`Non-null: ${pct(count, n)}`);
		lines.push("");
	}

	// ── 6. Relation coverage ───────────────────────────────────────────────────
	lines.push("## 6. Relation Coverage (keep all)");
	lines.push("");
	lines.push(
		"All 8 relations exist. Coverage shows which are actively linked.",
	);
	lines.push("");

	const allRelations = [
		"Build Sessions",
		"Related Research",
		"Supporting Skills",
		"Tool Stack Records",
		"Project Decisions",
		"Work Packets",
		"Execution Tasks",
		"Recommendation Runs",
	];

	lines.push("| Relation | Projects with links | Total links |");
	lines.push("|---|---|---|");
	for (const rel of allRelations) {
		const stats = relationCountStats(pages, rel);
		lines.push(`| ${rel} | ${pct(stats.nonEmpty, n)} | ${stats.totalLinks} |`);
	}
	lines.push("");

	// ── 7. Summary ─────────────────────────────────────────────────────────────
	lines.push("## 7. Overhaul Decision Summary");
	lines.push("");
	lines.push("### Safe to delete immediately (no data)");
	const safeToDelete = richTextRows
		.filter(([, count]) => count === 0)
		.map(([f]) => f);
	if (safeToDelete.length > 0) {
		for (const f of safeToDelete) lines.push(`- ${f}`);
	} else {
		lines.push("_All rich-text fields have some data_");
	}
	lines.push("");

	lines.push(
		"### Status fields safe to delete after Operating Queue validation",
	);
	const statusSafeRemove = STATUS_FIELDS.filter(
		(f) => !["Operating Queue", "Current State", "Portfolio Call"].includes(f),
	);
	const statusWithData = statusSafeRemove.filter((f) => {
		const { nonEmpty } = countDistribution(pages, f, selectValue);
		return nonEmpty > 0;
	});
	const statusEmpty = statusSafeRemove.filter((f) => {
		const { nonEmpty } = countDistribution(pages, f, selectValue);
		return nonEmpty === 0;
	});

	if (statusEmpty.length > 0) {
		lines.push("Empty (delete freely):");
		for (const f of statusEmpty) lines.push(`- ${f}`);
	}
	if (statusWithData.length > 0) {
		lines.push("Has data (review before deleting):");
		for (const f of statusWithData) lines.push(`- ${f}`);
	}
	lines.push("");

	lines.push("### Count fields");
	lines.push(
		`${totalMismatches} total stale count rows. ` +
			`Recommendation: convert to Notion rollup properties (automatic, always accurate).`,
	);
	lines.push("");

	return lines.join("\n");
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export interface SchemaReportCommandOptions {
	config?: string;
}

export async function runSchemaReportCommand(
	options: SchemaReportCommandOptions = {},
): Promise<void> {
	const token = requireNotionToken(
		"NOTION_TOKEN is required for schema-report",
	);
	const runtimeConfig = loadRuntimeConfig();

	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);

	const config = await loadLocalPortfolioControlTowerConfig(options.config);

	console.error("[info] Fetching all project pages from Notion...");
	const pages = await fetchAllPages(api, config.database.dataSourceId, "Name");
	console.error(`[info] Fetched ${pages.length} projects`);

	const report = buildReport(pages);
	console.log(report);
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["control-tower", "schema-report"]);
}
