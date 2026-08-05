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
import type { PropertySchema } from "../../types.js";

import { isDirectExecution } from "../../cli/legacy.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";
import {
	loadRuntimeConfig,
	requireNotionToken,
} from "../../config/runtime-config.js";
import { RunLogger } from "../../logging/run-logger.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "../../notion/local-portfolio-control-tower.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import {
	approvalPath,
	claimEnvelope,
	createClaimedActionFailureRecorder,
	emitReceipt,
	loadEnvelope,
	planDigest,
	sourceRevision,
	validateEnvelope,
	type IrreversibleActionEnvelopeV1,
} from "./irreversible-action.js";

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

	const config = await loadLocalPortfolioControlTowerConfig();
	const { dataSourceId } = config.database;
	const revision = sourceRevision();
	const token = requireNotionToken(
		"NOTION_TOKEN is required to render the exact schema-migrate plan",
	);
	const runtimeConfig = loadRuntimeConfig();
	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);
	const schema = await api.retrieveDataSource(dataSourceId);
	const plan = schemaMigrationPlan(dataSourceId, schema.properties);

	console.log(`[schema-migrate] Mode: ${isLive ? "LIVE" : "DRY RUN"}`);
	console.log(`[schema-migrate] Database dataSourceId: ${dataSourceId}`);
	console.log("");

	if (!isLive) {
		printDryRunPlan(plan);
		console.log(`[schema-migrate] Plan digest: ${planDigest(plan)}`);
		console.log(`[schema-migrate] Source revision: ${revision}`);
		console.log("");
		console.log(
			"[schema-migrate] Re-run with --live to apply these changes to Notion.",
		);
		console.log(
			"[schema-migrate] WARNING: Deletions are irreversible. Verify the probe passed first.",
		);
		process.exit(0);
	}
	const envelope = authorizeSchemaMigration({
		approvalFile: approvalPath(argv),
		dataSourceId,
		plan,
		sourceRevision: revision,
	});
	const sdk = createNotionSdkClient(token);
	const beforeFirstDelete = await api.retrieveDataSource(dataSourceId);
	assertMigrationPropertyIdentity(
		plan.delete_properties,
		beforeFirstDelete.properties,
	);
	claimEnvelope(envelope);
	const failure = createClaimedActionFailureRecorder({
		envelope,
		target: schemaMigrationTargets(plan),
		providerReference: `notion:data_source:${dataSourceId}`,
	});

	// ── Step 1: Delete deprecated properties ──────────────────────────────────
	console.log(
		"[schema-migrate] Step 1: Deleting deprecated properties (Momentum, Registry Status, Date Updated, Last Build Session)...",
	);
	try {
		await patchPropertiesWithIdentityCheck({
			api,
			sdk,
			dataSourceId,
			targets: plan.delete_properties.filter((property) =>
				DEPRECATED_PROPERTIES.includes(
					property.name as (typeof DEPRECATED_PROPERTIES)[number],
				),
			),
			properties: Object.fromEntries(
				DEPRECATED_PROPERTIES.map((name) => [name, null]),
			),
			beforePatch: () => failure.markEffectAttempted(),
		});
		console.log(
			`[schema-migrate] ✓ Step 1 complete — deleted: ${DEPRECATED_PROPERTIES.join(", ")}`,
		);
	} catch (err) {
		console.error(`[schema-migrate] ✗ Step 1 failed:`, err);
		failure.fail(err, "delete_deprecated_properties");
	}

	// ── Step 2: Delete stale number count fields ──────────────────────────────
	console.log("");
	console.log(
		"[schema-migrate] Step 2: Deleting stale number count fields (Build Session Count, Related Research Count, Supporting Skills Count, Linked Tool Count)...",
	);
	try {
		await patchPropertiesWithIdentityCheck({
			api,
			sdk,
			dataSourceId,
			targets: plan.delete_properties.filter((property) =>
				STALE_NUMBER_FIELDS.includes(
					property.name as (typeof STALE_NUMBER_FIELDS)[number],
				),
			),
			properties: Object.fromEntries(
				STALE_NUMBER_FIELDS.map((name) => [name, null]),
			),
			beforePatch: () => failure.markEffectAttempted(),
		});
		console.log(
			`[schema-migrate] ✓ Step 2 complete — deleted: ${STALE_NUMBER_FIELDS.join(", ")}`,
		);
	} catch (err) {
		console.error(`[schema-migrate] ✗ Step 2 failed:`, err);
		failure.fail(err, "delete_stale_number_fields");
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
			failure.markEffectAttempted();
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
			failure.fail(err, `create_rollup:${def.propertyName}`);
		}
	}
	console.log(
		`[schema-migrate] ✓ Step 3 complete — 4 rollup properties created`,
	);

	// ── Step 4: Verify ────────────────────────────────────────────────────────
	console.log("");
	console.log("[schema-migrate] Step 4: Verifying exact provider schema...");
	let verifyPassed = true;
	let providerReadback: {
		deleted_provider_ids_absent: true;
		deleted_provider_ids: string[];
		rollup_provider_ids_present: true;
		rollup_provider_properties: Array<{
			name: string;
			provider_id: string;
			type: string;
		}>;
	} | undefined;
	try {
		const afterSchema = await api.retrieveDataSource(dataSourceId);
		const currentProviderIds = new Set(
			Object.values(afterSchema.properties)
				.map((property) => property.id)
				.filter((value): value is string => Boolean(value)),
		);

		for (const property of plan.delete_properties) {
			if (currentProviderIds.has(property.provider_id)) {
				console.error(
					`[schema-migrate]   ✗ provider property "${property.provider_id}" still exists`,
				);
				verifyPassed = false;
			}
		}

		const rollupProviderProperties: Array<{
			name: string;
			provider_id: string;
			type: string;
		}> = [];
		for (const def of ROLLUP_DEFINITIONS) {
			const property = afterSchema.properties[def.propertyName];
			if (property?.type === "rollup" && property.id) {
				rollupProviderProperties.push({
					name: def.propertyName,
					provider_id: property.id,
					type: property.type,
				});
			} else {
				console.error(
					`[schema-migrate]   ✗ "${def.propertyName}" does not have a provider id and rollup type`,
				);
				verifyPassed = false;
			}
		}
		providerReadback = {
			deleted_provider_ids_absent: true,
			deleted_provider_ids: plan.delete_properties.map(
				(property) => property.provider_id,
			),
			rollup_provider_ids_present: true,
			rollup_provider_properties: rollupProviderProperties,
		};
	} catch (err) {
		console.error(`[schema-migrate] ✗ Schema verification failed:`, err);
		failure.fail(err, "terminal_schema_readback");
	}

	console.log("");
	if (verifyPassed) {
		emitReceipt({
			envelope,
			target: schemaMigrationTargets(plan),
			providerReference: `notion:data_source:${dataSourceId}`,
			readbackResult: providerReadback,
			terminalOutcome: "succeeded",
		});
		console.log("[schema-migrate] ✓ Migration complete — all checks passed.");
		console.log(
			"[schema-migrate]   Next: commit Phase 2 config changes, then run portfolio-audit:views-plan.",
		);
	} else {
		console.log(
			"[schema-migrate] ⚠ Migration applied but some verifications failed — inspect output above.",
		);
		failure.fail(
			new Error("schema migration terminal readback mismatch"),
			"terminal_schema_readback",
		);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export interface MigrationPropertyTarget {
	name: string;
	provider_id: string;
	type: string;
}

export function schemaMigrationPlan(
	dataSourceId: string,
	properties: Record<string, PropertySchema>,
) {
	const deleteProperties = [
		...DEPRECATED_PROPERTIES,
		...STALE_NUMBER_FIELDS,
	].map((name): MigrationPropertyTarget => {
		const property = properties[name];
		if (!property?.id || !property.type) {
			throw new Error(
				`schema-migrate plan requires provider id and type for "${name}"`,
			);
		}
		return {
			name,
			provider_id: property.id,
			type: property.type,
		};
	});
	return {
		operation: "notion.schema_migrate",
		data_source_id: dataSourceId,
		delete_properties: deleteProperties,
		create_rollups: ROLLUP_DEFINITIONS,
		required_readback: [
			"deleted_provider_ids_absent",
			"rollup_provider_ids_present",
		],
	};
}

export function schemaMigrationTargets(
	plan: ReturnType<typeof schemaMigrationPlan>,
) {
	return {
		data_source_id: plan.data_source_id,
		property_ids: plan.delete_properties
			.map((property) => property.provider_id)
			.sort(),
	};
}

export function assertMigrationPropertyIdentity(
	targets: MigrationPropertyTarget[],
	properties: Record<string, PropertySchema>,
): void {
	for (const target of targets) {
		const current = properties[target.name];
		if (
			current?.id !== target.provider_id ||
			current.type !== target.type
		) {
			throw new Error(
				`schema-migrate property identity changed for "${target.name}"`,
			);
		}
	}
}

export async function patchPropertiesWithIdentityCheck(input: {
	api: Pick<DirectNotionClient, "retrieveDataSource">;
	sdk: Client;
	dataSourceId: string;
	targets: MigrationPropertyTarget[];
	properties: Record<string, unknown>;
	beforePatch?: () => void;
}): Promise<void> {
	const current = await input.api.retrieveDataSource(input.dataSourceId);
	assertMigrationPropertyIdentity(input.targets, current.properties);
	input.beforePatch?.();
	await patchProperties(input.sdk, input.dataSourceId, input.properties);
}

export function authorizeSchemaMigration(input: {
	approvalFile: string;
	dataSourceId: string;
	plan: ReturnType<typeof schemaMigrationPlan>;
	sourceRevision?: string;
}): IrreversibleActionEnvelopeV1 {
	const envelope = loadEnvelope(input.approvalFile);
	validateEnvelope({
		envelope,
		actionKind: "notion.schema_migrate",
		canonicalTargets: schemaMigrationTargets(input.plan),
		sourceRevision: input.sourceRevision ?? sourceRevision(),
		plan: input.plan,
		effectCount: 6,
		deletionCount: DEPRECATED_PROPERTIES.length + STALE_NUMBER_FIELDS.length,
		requiredReadback: [
			"deleted_provider_ids_absent",
			"rollup_provider_ids_present",
		],
	});
	return envelope;
}

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

function printDryRunPlan(
	plan: ReturnType<typeof schemaMigrationPlan>,
): void {
	console.log("[schema-migrate] DRY RUN — would apply the following changes:");
	console.log("");
	console.log("  Step 1 — DELETE deprecated properties:");
	for (const property of plan.delete_properties.filter((candidate) =>
		DEPRECATED_PROPERTIES.includes(
			candidate.name as (typeof DEPRECATED_PROPERTIES)[number],
		),
	)) {
		console.log(
			`    - ${property.name} (id=${property.provider_id}, type=${property.type})`,
		);
	}
	console.log("");
	console.log("  Step 2 — DELETE stale number count fields:");
	for (const property of plan.delete_properties.filter((candidate) =>
		STALE_NUMBER_FIELDS.includes(
			candidate.name as (typeof STALE_NUMBER_FIELDS)[number],
		),
	)) {
		console.log(
			`    - ${property.name} (id=${property.provider_id}, type=${property.type})`,
		);
	}
	console.log("");
	console.log("  Step 3 — CREATE rollup properties:");
	for (const def of ROLLUP_DEFINITIONS) {
		console.log(
			`    - ${def.propertyName}  →  rollup("${def.rollupPropertyName}" in "${def.relationPropertyName}", count)`,
		);
	}
	console.log("");
	console.log("  Step 4 — VERIFY exact provider ids and rollup schema (reads only)");
}

if (isDirectExecution(import.meta.url)) {
	void main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
