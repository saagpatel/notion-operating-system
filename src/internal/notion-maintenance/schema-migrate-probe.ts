/**
 * schema-migrate-probe
 *
 * Verifies that PATCH /data_sources/{id} accepts rollup property creation.
 * Creates a temp rollup "_Probe Build Session Count", reads it back,
 * then deletes it. Exits 0 on success, 1 on failure.
 *
 * Usage: npx tsx src/internal/notion-maintenance/schema-migrate-probe.ts
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

const PROBE_PROP = "_Probe Build Session Count";

async function main() {
	const argv = process.argv.slice(2);
	if (shouldShowHelp(argv)) {
		process.stdout.write(
			renderInternalScriptHelp({
				command: "npm run schema-migrate-probe --",
				description:
					"Run the historical schema migration probe that verifies rollup property creation against the Local Portfolio Projects data source.",
				options: [{ flag: "--help, -h", description: "Show this help message." }],
				notes: [
					"This is a historical migration utility, not part of the shared operator CLI.",
				],
			}),
		);
		return;
	}

	const token = requireNotionToken(
		"NOTION_TOKEN is required for schema-migrate-probe",
	);
	const runtimeConfig = loadRuntimeConfig();
	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);
	const sdk = createNotionSdkClient(token);
	const config = await loadLocalPortfolioControlTowerConfig();
	const { dataSourceId } = config.database;

	console.log(`[probe] Database dataSourceId: ${dataSourceId}`);
	console.log(
		`[probe] Step 1: Creating temp rollup property "${PROBE_PROP}"...`,
	);

	// Step 1: create temp rollup property
	try {
		await sdk.request({
			path: `data_sources/${dataSourceId}`,
			method: "patch",
			body: {
				properties: {
					[PROBE_PROP]: {
						rollup: {
							relation_property_name: "Build Sessions",
							rollup_property_name: "Session Title",
							function: "count",
						},
					},
				},
			},
		});
		console.log(
			`[probe] ✓ PATCH accepted — property created (or already exists)`,
		);
	} catch (err) {
		console.error(`[probe] ✗ PATCH rejected during creation:`, err);
		process.exit(1);
	}

	// Step 2: fetch one page and read the probe property
	console.log(`[probe] Step 2: Fetching a page to read the rollup value...`);
	let rollupShape: unknown;
	try {
		const pages = await fetchAllPages(api, dataSourceId, "Name");
		if (pages.length === 0) {
			console.error(
				`[probe] ✗ No pages found in database — cannot verify rollup value`,
			);
			await cleanup(sdk, dataSourceId);
			process.exit(1);
		}
		const firstPage = pages[0]!;
		const prop = firstPage.properties[PROBE_PROP] as unknown;
		rollupShape = prop;
		console.log(`[probe] Raw property shape for "${PROBE_PROP}":`);
		console.log(JSON.stringify(prop, null, 2));

		const typed = prop as
			| { type?: string; rollup?: { type?: string; number?: unknown } }
			| undefined;
		if (
			typed?.type === "rollup" &&
			typed.rollup?.type === "number" &&
			typeof typed.rollup.number === "number"
		) {
			console.log(`[probe] ✓ Rollup value is a number: ${typed.rollup.number}`);
		} else if (typed?.type === "rollup") {
			console.log(
				`[probe] ⚠ Rollup property exists but value shape is unexpected — inspect output above`,
			);
		} else {
			console.log(
				`[probe] ✗ Property type is "${typed?.type ?? "unknown"}" — not a rollup`,
			);
			await cleanup(sdk, dataSourceId);
			process.exit(1);
		}
	} catch (err) {
		console.error(`[probe] ✗ Failed to fetch/read page properties:`, err);
		await cleanup(sdk, dataSourceId);
		process.exit(1);
	}

	// Step 3: clean up
	await cleanup(sdk, dataSourceId);

	console.log(
		`\n[probe] ✓ Probe complete — rollup property creation and reading works`,
	);
	console.log(`[probe] Shape confirmed: ${JSON.stringify(rollupShape)}`);
	process.exit(0);
}

async function cleanup(sdk: Client, dataSourceId: string) {
	console.log(`[probe] Step 3: Deleting temp property "${PROBE_PROP}"...`);
	try {
		await sdk.request({
			path: `data_sources/${dataSourceId}`,
			method: "patch",
			body: {
				properties: {
					[PROBE_PROP]: null,
				},
			},
		});
		console.log(`[probe] ✓ Temp property deleted`);
	} catch (err) {
		console.error(
			`[probe] ⚠ Failed to delete temp property — remove manually:`,
			err,
		);
	}
}

if (isDirectExecution(import.meta.url)) {
	void main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
