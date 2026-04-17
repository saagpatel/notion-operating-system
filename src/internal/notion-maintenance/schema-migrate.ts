/**
 * schema-migrate
 *
 * Applies the Local Portfolio Projects database schema overhaul:
 *   Step 1 — Delete 4 deprecated properties: Momentum, Registry Status, Date Updated, Last Build Session
 *   Step 2 — Delete 4 stale manual number count properties: Build Session Count, Related Research Count,
 *             Supporting Skills Count, Linked Tool Count
 *   Step 3 — Create 4 native Notion rollup properties with the same names as the deleted count fields
 *   Step 4 — Verify: fetch one page and confirm rollup types are present + deprecated fields are gone
 *
 * Usage:
 *   npx tsx src/internal/notion-maintenance/schema-migrate.ts           # dry-run (prints what would happen, no Notion writes)
 *   npx tsx src/internal/notion-maintenance/schema-migrate.ts --live    # applies changes to live Notion database
 *
 * IMPORTANT: Run Phase 0 probe (schema-migrate-probe) first to confirm rollup creation works.
 * IMPORTANT: --live makes irreversible schema changes. Properties deleted here cannot be recovered.
 */

import type { Client } from "@notionhq/client";

import { isDirectExecution } from "../../cli/legacy.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";
import {
	loadRuntimeConfig,
	requireNotionToken,
} from "../../config/runtime-config.js";
import { RunLogger } from "../../logging/run-logger.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "../../notion/local-portfolio-control-tower.js";
import { fetchAllPages } from "../../notion/local-portfolio-control-tower-live.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Track 3: deprecated properties to delete */
const DEPRECATED_PROPERTIES = [
	"Momentum",
	"Registry Status",
	"Date Updated",
	"Last Build Session",
] as const;

/** Track 1: stale manual number fields to delete */
const STALE_NUMBER_FIELDS = [
	"Build Session Count",
	"Related Research Count",
	"Supporting Skills Count",
	"Linked Tool Count",
] as const;

/** Track 1: rollup property definitions — relation name and rollup_property_name
 *  verified via schema-migrate-probe.ts; rollup_property_name is the title property
 *  of each related database, NOT "Name" */
const ROLLUP_DEFINITIONS: Array<{
	propertyName: string;
	relationPropertyName: string;
	rollupPropertyName: string;
}> = [
	{
		propertyName: "Build Session Count",
		relationPropertyName: "Build Sessions",
		rollupPropertyName: "Session Title",
	},
	{
		propertyName: "Related Research Count",
		relationPropertyName: "Related Research",
		rollupPropertyName: "Topic",
	},
	{
		propertyName: "Supporting Skills Count",
		relationPropertyName: "Supporting Skills",
		rollupPropertyName: "Skill",
	},
	{
		propertyName: "Linked Tool Count",
		relationPropertyName: "Tool Stack Records",
		rollupPropertyName: "Tool Name",
	},
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const argv = process.argv.slice(2);
	if (shouldShowHelp(argv)) {
		process.stdout.write(
			renderInternalScriptHelp({
				command: "npm run schema-migrate --",
				description:
					"Run the historical Local Portfolio Projects schema migration that replaces manual count fields with native rollups.",
				options: [
					{ flag: "--help, -h", description: "Show this help message." },
					{ flag: "--live", description: "Apply the irreversible schema changes in Notion." },
				],
				notes: [
					"Run schema-migrate-probe first before using --live.",
					"This is a historical migration utility, not part of the shared operator CLI.",
				],
			}),
		);
		return;
	}

	const isLive = argv.includes("--live");

	const token = requireNotionToken(
		"NOTION_TOKEN is required for schema-migrate",
	);
	const runtimeConfig = loadRuntimeConfig();
	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);
	const sdk = createNotionSdkClient(token);
	const config = await loadLocalPortfolioControlTowerConfig();
	const { dataSourceId } = config.database;

	console.log(`[schema-migrate] Mode: ${isLive ? "LIVE" : "DRY RUN"}`);
	console.log(`[schema-migrate] Database dataSourceId: ${dataSourceId}`);
	console.log("");

	if (!isLive) {
		printDryRunPlan();
		console.log("");
		console.log(
			"[schema-migrate] Re-run with --live to apply these changes to Notion.",
		);
		console.log(
			"[schema-migrate] WARNING: Deletions are irreversible. Verify the probe passed first.",
		);
		process.exit(0);
	}

	// ── Step 1: Delete deprecated properties ──────────────────────────────────
	console.log(
		"[schema-migrate] Step 1: Deleting deprecated properties (Momentum, Registry Status, Date Updated, Last Build Session)...",
	);
	try {
		await patchProperties(
			sdk,
			dataSourceId,
			Object.fromEntries(DEPRECATED_PROPERTIES.map((name) => [name, null])),
		);
		console.log(
			`[schema-migrate] ✓ Step 1 complete — deleted: ${DEPRECATED_PROPERTIES.join(", ")}`,
		);
	} catch (err) {
		console.error(`[schema-migrate] ✗ Step 1 failed:`, err);
		process.exit(1);
	}

	// ── Step 2: Delete stale number count fields ──────────────────────────────
	console.log("");
	console.log(
		"[schema-migrate] Step 2: Deleting stale number count fields (Build Session Count, Related Research Count, Supporting Skills Count, Linked Tool Count)...",
	);
	try {
		await patchProperties(
			sdk,
			dataSourceId,
			Object.fromEntries(STALE_NUMBER_FIELDS.map((name) => [name, null])),
		);
		console.log(
			`[schema-migrate] ✓ Step 2 complete — deleted: ${STALE_NUMBER_FIELDS.join(", ")}`,
		);
	} catch (err) {
		console.error(`[schema-migrate] ✗ Step 2 failed:`, err);
		process.exit(1);
	}

	// ── Step 3: Create rollup properties ─────────────────────────────────────
	console.log("");
	console.log(
		"[schema-migrate] Step 3: Creating 4 native rollup properties...",
	);
	for (const def of ROLLUP_DEFINITIONS) {
		console.log(
			`[schema-migrate]   Creating "${def.propertyName}" (rollup of "${def.rollupPropertyName}" in "${def.relationPropertyName}")...`,
		);
		try {
			await patchProperties(sdk, dataSourceId, {
				[def.propertyName]: {
					rollup: {
						relation_property_name: def.relationPropertyName,
						rollup_property_name: def.rollupPropertyName,
						function: "count",
					},
				},
			});
			console.log(`[schema-migrate]   ✓ Created "${def.propertyName}"`);
		} catch (err) {
			console.error(
				`[schema-migrate]   ✗ Failed to create "${def.propertyName}":`,
				err,
			);
			console.error(
				`[schema-migrate]   Aborting — remaining rollups NOT created. Fix and re-run.`,
			);
			process.exit(1);
		}
	}
	console.log(
		`[schema-migrate] ✓ Step 3 complete — 4 rollup properties created`,
	);

	// ── Step 4: Verify ────────────────────────────────────────────────────────
	console.log("");
	console.log("[schema-migrate] Step 4: Verifying schema via page fetch...");
	let verifyPassed = true;
	try {
		const pages = await fetchAllPages(api, dataSourceId, "Name");
		if (pages.length === 0) {
			console.error(
				`[schema-migrate] ✗ No pages found — cannot verify. Check database manually.`,
			);
			process.exit(1);
		}
		const page = pages[0]!;

		// Check deprecated fields are gone
		for (const name of DEPRECATED_PROPERTIES) {
			const prop = page.properties[name];
			if (prop !== undefined) {
				console.error(
					`[schema-migrate]   ✗ "${name}" still present — deletion may not have propagated yet`,
				);
				verifyPassed = false;
			} else {
				console.log(`[schema-migrate]   ✓ "${name}" is absent (deleted)`);
			}
		}

		// Check rollup fields are present with correct type
		for (const def of ROLLUP_DEFINITIONS) {
			const prop = page.properties[def.propertyName] as
				| {
						type?: string;
						rollup?: { type?: string; number?: unknown; function?: string };
				  }
				| undefined;
			if (prop?.type === "rollup") {
				const num = prop.rollup?.number;
				console.log(
					`[schema-migrate]   ✓ "${def.propertyName}" is type=rollup, value=${typeof num === "number" ? num : "(non-number — may be unsupported)"}`,
				);
			} else {
				console.error(
					`[schema-migrate]   ✗ "${def.propertyName}" type="${prop?.type ?? "missing"}" — expected "rollup"`,
				);
				verifyPassed = false;
			}
		}
	} catch (err) {
		console.error(`[schema-migrate] ✗ Verification fetch failed:`, err);
		process.exit(1);
	}

	console.log("");
	if (verifyPassed) {
		console.log("[schema-migrate] ✓ Migration complete — all checks passed.");
		console.log(
			"[schema-migrate]   Next: commit Phase 2 config changes, then run portfolio-audit:views-plan.",
		);
	} else {
		console.log(
			"[schema-migrate] ⚠ Migration applied but some verifications failed — inspect output above.",
		);
		process.exit(1);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function patchProperties(
	sdk: Client,
	dataSourceId: string,
	properties: Record<string, unknown>,
): Promise<void> {
	await sdk.request({
		path: `data_sources/${dataSourceId}`,
		method: "patch",
		body: { properties },
	});
}

function printDryRunPlan(): void {
	console.log("[schema-migrate] DRY RUN — would apply the following changes:");
	console.log("");
	console.log("  Step 1 — DELETE deprecated properties:");
	for (const name of DEPRECATED_PROPERTIES) {
		console.log(`    - ${name}`);
	}
	console.log("");
	console.log("  Step 2 — DELETE stale number count fields:");
	for (const name of STALE_NUMBER_FIELDS) {
		console.log(`    - ${name}`);
	}
	console.log("");
	console.log("  Step 3 — CREATE rollup properties:");
	for (const def of ROLLUP_DEFINITIONS) {
		console.log(
			`    - ${def.propertyName}  →  rollup("${def.rollupPropertyName}" in "${def.relationPropertyName}", count)`,
		);
	}
	console.log("");
	console.log("  Step 4 — VERIFY via page fetch (reads only)");
}

if (isDirectExecution(import.meta.url)) {
	void main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
