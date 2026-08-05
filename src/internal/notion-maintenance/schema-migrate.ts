/**
 * Render and execute the historical Local Portfolio Projects schema migration.
 * Rendering is read-only. Live execution requires an exact, one-shot
 * IrreversibleActionEnvelopeV1 bound to the rendered plan and live property IDs.
 */

import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";

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
import {
	emitIrreversibleActionReceipt,
	loadAndClaimEnvelope,
	preparePrivateAuthorityDirectory,
	sha256Json,
} from "../../security/irreversible-action-envelope.js";
import type { DataSourceSchemaSnapshot } from "../../types.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

const DEPRECATED_PROPERTIES = [
	"Momentum",
	"Registry Status",
	"Date Updated",
	"Last Build Session",
] as const;
const STALE_NUMBER_FIELDS = [
	"Build Session Count",
	"Related Research Count",
	"Supporting Skills Count",
	"Linked Tool Count",
] as const;
const ROLLUP_DEFINITIONS = [
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
] as const;
const REQUIRED_READBACK = [
	"data_source_id",
	"schema_fingerprint",
	"deleted_property_ids_absent",
	"rollup_property_names_present",
];

interface PropertyBinding {
	name: string;
	id: string;
	type: string;
}

export interface SchemaMigrationPlan {
	schema: "NotionSchemaMigrationPlanV1";
	dataSourceId: string;
	sourceRevision: string;
	schemaFingerprint: string;
	propertyDeletes: PropertyBinding[];
	relationBindings: PropertyBinding[];
	rollupCreates: Array<{
		propertyName: string;
		relationPropertyName: string;
		rollupPropertyName: string;
	}>;
	allowedEffectCount: number;
	maxDeletions: number;
	planDigest: string;
	canonicalTargets: Record<string, unknown>;
	preconditions: Record<string, unknown>;
}

function schemaFingerprint(schema: DataSourceSchemaSnapshot): string {
	return sha256Json(
		Object.values(schema.properties)
			.map((property) => ({
				name: property.name,
				id: property.id ?? "",
				type: property.type,
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
	);
}

function planCore(plan: Omit<
	SchemaMigrationPlan,
	"planDigest" | "canonicalTargets" | "preconditions"
>): Record<string, unknown> {
	return {
		schema: plan.schema,
		dataSourceId: plan.dataSourceId,
		sourceRevision: plan.sourceRevision,
		schemaFingerprint: plan.schemaFingerprint,
		propertyDeletes: plan.propertyDeletes,
		relationBindings: plan.relationBindings,
		rollupCreates: plan.rollupCreates,
		allowedEffectCount: plan.allowedEffectCount,
		maxDeletions: plan.maxDeletions,
	};
}

function requireBinding(
	schema: DataSourceSchemaSnapshot,
	name: string,
	expectedType?: string,
): PropertyBinding {
	const property = schema.properties[name];
	if (!property?.id) {
		throw new AppError(`schema plan requires exact property id for "${name}"`);
	}
	if (expectedType && property.type !== expectedType) {
		throw new AppError(
			`schema plan expected "${name}" type=${expectedType}, found ${property.type}`,
		);
	}
	return { name, id: property.id, type: property.type };
}

export function buildSchemaMigrationPlan(input: {
	dataSourceId: string;
	sourceRevision: string;
	schema: DataSourceSchemaSnapshot;
}): SchemaMigrationPlan {
	if (input.schema.id !== input.dataSourceId) {
		throw new AppError("schema data source id does not match configured target");
	}
	const propertyDeletes = [
		...DEPRECATED_PROPERTIES.map((name) => requireBinding(input.schema, name)),
		...STALE_NUMBER_FIELDS.map((name) =>
			requireBinding(input.schema, name, "number"),
		),
	];
	const relationBindings = ROLLUP_DEFINITIONS.map((definition) =>
		requireBinding(input.schema, definition.relationPropertyName, "relation"),
	);
	const base = {
		schema: "NotionSchemaMigrationPlanV1" as const,
		dataSourceId: input.dataSourceId,
		sourceRevision: input.sourceRevision,
		schemaFingerprint: schemaFingerprint(input.schema),
		propertyDeletes,
		relationBindings,
		rollupCreates: ROLLUP_DEFINITIONS.map((definition) => ({ ...definition })),
		allowedEffectCount: 6,
		maxDeletions: propertyDeletes.length,
	};
	const planDigest = sha256Json(planCore(base));
	return {
		...base,
		planDigest,
		canonicalTargets: {
			data_source_id: input.dataSourceId,
			delete_property_ids: propertyDeletes.map((property) => property.id),
			create_property_names: ROLLUP_DEFINITIONS.map(
				(definition) => definition.propertyName,
			),
			relation_property_ids: relationBindings.map((property) => property.id),
			plan_digest: planDigest,
		},
		preconditions: {
			schema_fingerprint: base.schemaFingerprint,
			plan_digest: planDigest,
		},
	};
}

function validateRenderedPlan(plan: SchemaMigrationPlan): void {
	const recomputed = sha256Json(planCore(plan));
	if (recomputed !== plan.planDigest) {
		throw new AppError("artifact digest mismatch: rendered plan changed");
	}
}

function migrationReadback(
	plan: SchemaMigrationPlan,
	schema: DataSourceSchemaSnapshot,
): Record<string, unknown> {
	const currentIds = new Set(
		Object.values(schema.properties).map((property) => property.id),
	);
	const deletedPropertyIdsAbsent = plan.propertyDeletes.every(
		(property) => !currentIds.has(property.id),
	);
	const rollupPropertyNamesPresent = plan.rollupCreates.every(
		(definition) =>
			schema.properties[definition.propertyName]?.type === "rollup",
	);
	return {
		data_source_id: schema.id,
		schema_fingerprint: schemaFingerprint(schema),
		deleted_property_ids_absent: deletedPropertyIdsAbsent,
		rollup_property_names_present: rollupPropertyNamesPresent,
	};
}

export async function executeSchemaMigration(input: {
	plan: SchemaMigrationPlan;
	envelopePath: string;
	claimStateDir: string;
	receiptDir: string;
	sdk: Client;
	retrieveDataSource: (
		dataSourceId: string,
	) => Promise<DataSourceSchemaSnapshot>;
}): Promise<Record<string, unknown>> {
	validateRenderedPlan(input.plan);
	const before = await input.retrieveDataSource(input.plan.dataSourceId);
	if (schemaFingerprint(before) !== input.plan.schemaFingerprint) {
		throw new AppError("live schema no longer matches the rendered plan");
	}
	const claimStateDir = await preparePrivateAuthorityDirectory(
		input.claimStateDir,
	);
	const receiptDir = await preparePrivateAuthorityDirectory(input.receiptDir);
	const canonicalTargets = {
		...input.plan.canonicalTargets,
		authority_state_dir: claimStateDir,
		receipt_state_dir: receiptDir,
	};
	const envelope = await loadAndClaimEnvelope({
		envelopePath: input.envelopePath,
		actionKind: "notion.schema_migrate",
		canonicalTargets,
		sourceRevision: input.plan.sourceRevision,
		artifactDigest: input.plan.planDigest,
		preconditions: input.plan.preconditions,
		bounds: {
			allowed_effect_count: input.plan.allowedEffectCount,
			max_deletions: input.plan.maxDeletions,
		},
		requiredReadback: REQUIRED_READBACK,
		claimStateDir,
	});

	let effectCount = 0;
	try {
		effectCount += 1;
		await patchProperties(
			input.sdk,
			input.plan.dataSourceId,
			Object.fromEntries(
				input.plan.propertyDeletes
					.slice(0, DEPRECATED_PROPERTIES.length)
					.map((property) => [property.name, null]),
			),
		);
		effectCount += 1;
		await patchProperties(
			input.sdk,
			input.plan.dataSourceId,
			Object.fromEntries(
				input.plan.propertyDeletes
					.slice(DEPRECATED_PROPERTIES.length)
					.map((property) => [property.name, null]),
			),
		);
		for (const definition of input.plan.rollupCreates) {
			effectCount += 1;
			await patchProperties(input.sdk, input.plan.dataSourceId, {
				[definition.propertyName]: {
					rollup: {
						relation_property_name: definition.relationPropertyName,
						rollup_property_name: definition.rollupPropertyName,
						function: "count",
					},
				},
			});
		}
	} catch (error) {
		let readback: Record<string, unknown> = {
			data_source_id: input.plan.dataSourceId,
			schema_fingerprint: null,
			deleted_property_ids_absent: null,
			rollup_property_names_present: null,
			error: toErrorMessage(error),
		};
		try {
			readback = migrationReadback(
				input.plan,
				await input.retrieveDataSource(input.plan.dataSourceId),
			);
		} catch (readbackError) {
			readback.readback_error = toErrorMessage(readbackError);
		}
		await emitIrreversibleActionReceipt({
			envelope,
			receiptDir,
			target: canonicalTargets,
			providerReference: `notion:data_source:${input.plan.dataSourceId}`,
			readbackResult: readback,
			terminalOutcome: "outcome_unknown",
			effectCount,
		});
		throw new AppError(
			"Notion migration outcome is unknown; automatic retry is prohibited",
		);
	}

	let readback: Record<string, unknown>;
	let succeeded = false;
	try {
		const after = await input.retrieveDataSource(input.plan.dataSourceId);
		readback = migrationReadback(input.plan, after);
		succeeded =
			readback.deleted_property_ids_absent === true &&
			readback.rollup_property_names_present === true;
	} catch (error) {
		readback = {
			data_source_id: input.plan.dataSourceId,
			schema_fingerprint: null,
			deleted_property_ids_absent: null,
			rollup_property_names_present: null,
			readback_error: toErrorMessage(error),
		};
	}
	await emitIrreversibleActionReceipt({
		envelope,
		receiptDir,
		target: canonicalTargets,
		providerReference: `notion:data_source:${input.plan.dataSourceId}`,
		readbackResult: readback,
		terminalOutcome: succeeded ? "succeeded" : "outcome_unknown",
		effectCount,
	});
	if (!succeeded) {
		throw new AppError(
			"Notion migration outcome is unknown; automatic retry is prohibited",
		);
	}
	return {
		schema: "NotionSchemaMigrationResultV1",
		action_id: envelope.action_id,
		target: canonicalTargets,
		artifact_digest: input.plan.planDigest,
		provider_reference: `notion:data_source:${input.plan.dataSourceId}`,
		readback_result: readback,
		terminal_outcome: "succeeded",
	};
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

function flagValue(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (shouldShowHelp(argv)) {
		process.stdout.write(
			renderInternalScriptHelp({
				command: "npm run schema-migrate --",
				description:
					"Render or execute the historical Local Portfolio Projects schema migration.",
				options: [
					{ flag: "--help, -h", description: "Show this help message." },
					{ flag: "--plan-output <path>", description: "Write the read-only rendered plan." },
					{ flag: "--live", description: "Execute an exact previously rendered plan." },
					{ flag: "--plan <path>", description: "Previously rendered plan JSON." },
					{ flag: "--envelope <path>", description: "One-shot approval envelope." },
					{ flag: "--claim-state-dir <path>", description: "Private one-shot claim directory." },
					{ flag: "--receipt-dir <path>", description: "Private terminal receipt directory." },
				],
				notes: [
					"Rendering performs schema reads only.",
					"Live execution fails closed unless every authority artifact is supplied.",
				],
			}),
		);
		return;
	}
	const token = requireNotionToken("NOTION_TOKEN is required for schema-migrate");
	const runtimeConfig = loadRuntimeConfig();
	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);
	const sdk = createNotionSdkClient(token);
	const config = await loadLocalPortfolioControlTowerConfig();

	if (!argv.includes("--live")) {
		const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();
		const plan = buildSchemaMigrationPlan({
			dataSourceId: config.database.dataSourceId,
			sourceRevision,
			schema: await api.retrieveDataSource(config.database.dataSourceId),
		});
		const output = flagValue(argv, "--plan-output");
		if (output) {
			await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, {
				mode: 0o600,
				flag: "wx",
			});
			await chmod(output, 0o600);
		}
		console.log(JSON.stringify(plan, null, 2));
		return;
	}

	const planPath = flagValue(argv, "--plan");
	const envelopePath = flagValue(argv, "--envelope");
	const claimStateDir = flagValue(argv, "--claim-state-dir");
	const receiptDir = flagValue(argv, "--receipt-dir");
	if (!planPath || !envelopePath || !claimStateDir || !receiptDir) {
		throw new AppError(
			"--live requires --plan, --envelope, --claim-state-dir, and --receipt-dir",
		);
	}
	const plan = JSON.parse(await readFile(planPath, "utf8")) as SchemaMigrationPlan;
	if (plan.dataSourceId !== config.database.dataSourceId) {
		throw new AppError("plan target does not match configured data source");
	}
	const result = await executeSchemaMigration({
		plan,
		envelopePath,
		claimStateDir,
		receiptDir,
		sdk,
		retrieveDataSource: (id) => api.retrieveDataSource(id),
	});
	console.log(JSON.stringify(result, null, 2));
}

if (isDirectExecution(import.meta.url)) {
	void main().catch((error) => {
		console.error(toErrorMessage(error));
		process.exitCode = 1;
	});
}
