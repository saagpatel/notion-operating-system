import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	realpath,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Client } from "@notionhq/client";
import { describe, expect, test, vi } from "vitest";

import { runReadOnlySchemaProbe } from "../src/internal/notion-maintenance/schema-migrate-probe.js";
import {
	buildSchemaMigrationPlan,
	executeSchemaMigration,
} from "../src/internal/notion-maintenance/schema-migrate.js";
import type { DataSourceSchemaSnapshot } from "../src/types.js";

const DATA_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_REVISION = "a".repeat(40);

function property(id: string, name: string, type: string) {
	return { id, name, type, writable: true };
}

function schema(): DataSourceSchemaSnapshot {
	return {
		id: DATA_SOURCE_ID,
		title: "Local Portfolio Projects",
		titlePropertyName: "Name",
		properties: {
			Name: property("title-id", "Name", "title"),
			Momentum: property("momentum-id", "Momentum", "select"),
			"Registry Status": property(
				"registry-id",
				"Registry Status",
				"select",
			),
			"Date Updated": property("date-id", "Date Updated", "date"),
			"Last Build Session": property(
				"last-build-id",
				"Last Build Session",
				"relation",
			),
			"Build Session Count": property(
				"build-count-id",
				"Build Session Count",
				"number",
			),
			"Related Research Count": property(
				"research-count-id",
				"Related Research Count",
				"number",
			),
			"Supporting Skills Count": property(
				"skills-count-id",
				"Supporting Skills Count",
				"number",
			),
			"Linked Tool Count": property(
				"tools-count-id",
				"Linked Tool Count",
				"number",
			),
			"Build Sessions": property(
				"build-sessions-id",
				"Build Sessions",
				"relation",
			),
			"Related Research": property(
				"research-id",
				"Related Research",
				"relation",
			),
			"Supporting Skills": property(
				"skills-id",
				"Supporting Skills",
				"relation",
			),
			"Tool Stack Records": property(
				"tools-id",
				"Tool Stack Records",
				"relation",
			),
		},
	};
}

function migratedSchema(): DataSourceSchemaSnapshot {
	const current = schema();
	for (const name of [
		"Momentum",
		"Registry Status",
		"Date Updated",
		"Last Build Session",
	]) {
		delete current.properties[name];
	}
	for (const name of [
		"Build Session Count",
		"Related Research Count",
		"Supporting Skills Count",
		"Linked Tool Count",
	]) {
		current.properties[name] = property(
			`rollup-${name}`,
			name,
			"rollup",
		);
	}
	return current;
}

async function writeEnvelope(
	root: string,
	plan: ReturnType<typeof buildSchemaMigrationPlan>,
	actionId: string,
): Promise<string> {
	const envelopePath = path.join(root, `${actionId}.json`);
	const claimStateDir = path.join(root, "claims");
	const receiptDir = path.join(root, "receipts");
	await mkdir(claimStateDir, { mode: 0o700 });
	await mkdir(receiptDir, { mode: 0o700 });
	const envelope = {
		schema: "IrreversibleActionEnvelopeV1",
		action_id: actionId,
		action_kind: "notion.schema_migrate",
		principal: { id: "fixture", kind: "test-fixture" },
		canonical_targets: {
			...plan.canonicalTargets,
			authority_state_dir: await realpath(claimStateDir),
			receipt_state_dir: await realpath(receiptDir),
		},
		source_revision: SOURCE_REVISION,
		artifact_digest: plan.planDigest,
		bounds: { allowed_effect_count: 6, max_deletions: 8 },
		issued_at: new Date(Date.now() - 1_000).toISOString(),
		expires_at: new Date(Date.now() + 60_000).toISOString(),
		one_shot: true,
		provider_idempotency_key: `${actionId}.provider`,
		preconditions: plan.preconditions,
		required_readback: [
			"data_source_id",
			"schema_fingerprint",
			"deleted_property_ids_absent",
			"rollup_property_names_present",
		],
		receipt_requirements: {
			schema: "IrreversibleActionReceiptV1",
			provider_reference: true,
			readback_result: true,
			terminal_outcome: true,
		},
	};
	await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
	return envelopePath;
}

describe("schema migration irreversible-action boundary", () => {
	test("the default probe performs readback only and makes zero SDK mutations", async () => {
		const request = vi.fn();
		const retrieveDataSource = vi.fn().mockResolvedValue(schema());

		const result = await runReadOnlySchemaProbe({
			dataSourceId: DATA_SOURCE_ID,
			retrieveDataSource,
			sdk: { request } as unknown as Client,
		});

		expect(result.mode).toBe("read_only");
		expect(retrieveDataSource).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
	});

	test("a changed rendered plan cannot consume an older approval", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-envelope-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const changedPlan = structuredClone(plan);
		changedPlan.rollupCreates[0]!.rollupPropertyName = "Changed Title";
		const envelopePath = await writeEnvelope(
			root,
			plan,
			"fixture.notion.schema.0001",
		);
		const request = vi.fn();

		await expect(
			executeSchemaMigration({
				plan: changedPlan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi.fn().mockResolvedValue(schema()),
			}),
		).rejects.toThrow(/artifact digest mismatch/i);
		expect(request).not.toHaveBeenCalled();
		expect(await readdir(path.join(root, "claims"))).toEqual([]);
	});

	test("successful fake execution emits a stable receipt and blocks replay", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-success-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const actionId = "fixture.notion.schema.success.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const request = vi.fn().mockResolvedValue({});
		const retrieveDataSource = vi
			.fn()
			.mockResolvedValueOnce(schema())
			.mockResolvedValueOnce(migratedSchema());

		const result = await executeSchemaMigration({
			plan,
			envelopePath,
			claimStateDir: path.join(root, "claims"),
			receiptDir: path.join(root, "receipts"),
			sdk: { request } as unknown as Client,
			retrieveDataSource,
		});

		expect(result.terminal_outcome).toBe("succeeded");
		expect(request).toHaveBeenCalledTimes(6);
		const receipt = JSON.parse(
			await readFile(
				path.join(root, "receipts", `${actionId}.receipt.json`),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			action_id: actionId,
			artifact_digest: plan.planDigest,
			provider_reference: `notion:data_source:${DATA_SOURCE_ID}`,
			terminal_outcome: "succeeded",
			effect_count: 6,
		});
		expect(receipt.target).toMatchObject(plan.canonicalTargets);
		expect(receipt.target).toMatchObject({
			authority_state_dir: await realpath(path.join(root, "claims")),
			receipt_state_dir: await realpath(path.join(root, "receipts")),
		});

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi.fn().mockResolvedValue(schema()),
			}),
		).rejects.toThrow(/already been claimed/i);
		expect(request).toHaveBeenCalledTimes(6);
	});

	test("partial failure is outcome_unknown and cannot automatically retry", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-unknown-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const actionId = "fixture.notion.schema.unknown.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const request = vi
			.fn()
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error("fixture timeout"));

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi.fn().mockResolvedValue(schema()),
			}),
		).rejects.toThrow(/automatic retry is prohibited/i);
		const receipt = JSON.parse(
			await readFile(
				path.join(root, "receipts", `${actionId}.receipt.json`),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			terminal_outcome: "outcome_unknown",
			effect_count: 2,
		});

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi.fn().mockResolvedValue(schema()),
			}),
		).rejects.toThrow(/already been claimed/i);
		expect(request).toHaveBeenCalledTimes(2);
	});

	test("post-effect readback failure emits outcome_unknown and blocks retry", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-readback-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const actionId = "fixture.notion.schema.readback.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const request = vi.fn().mockResolvedValue({});
		const retrieveDataSource = vi
			.fn()
			.mockResolvedValueOnce(schema())
			.mockRejectedValueOnce(new Error("fixture readback unavailable"));

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource,
			}),
		).rejects.toThrow(/automatic retry is prohibited/i);
		const receipt = JSON.parse(
			await readFile(
				path.join(root, "receipts", `${actionId}.receipt.json`),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			terminal_outcome: "outcome_unknown",
			effect_count: 6,
		});
		expect(receipt.readback_result).toMatchObject({
			readback_error: "fixture readback unavailable",
		});
	});

	test("authority cannot be redirected to different claim or receipt namespaces", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-state-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const envelopePath = await writeEnvelope(
			root,
			plan,
			"fixture.notion.schema.state.0001",
		);
		const request = vi.fn();

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "other-claims"),
				receiptDir: path.join(root, "other-receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi.fn().mockResolvedValue(schema()),
			}),
		).rejects.toThrow(/canonical targets mismatch/i);
		expect(request).not.toHaveBeenCalled();
	});

	test("a pre-planted receipt symlink cannot redirect terminal evidence", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-schema-receipt-"));
		const plan = buildSchemaMigrationPlan({
			dataSourceId: DATA_SOURCE_ID,
			sourceRevision: SOURCE_REVISION,
			schema: schema(),
		});
		const actionId = "fixture.notion.schema.receipt.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const external = path.join(root, "external.json");
		await writeFile(external, '{"preserve":true}\n', { mode: 0o600 });
		await symlink(
			external,
			path.join(root, "receipts", `${actionId}.receipt.json`),
		);
		const request = vi.fn().mockResolvedValue({});

		await expect(
			executeSchemaMigration({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				sdk: { request } as unknown as Client,
				retrieveDataSource: vi
					.fn()
					.mockResolvedValueOnce(schema())
					.mockResolvedValueOnce(migratedSchema()),
			}),
		).rejects.toThrow(/regular non-symlink file/i);
		expect(await readFile(external, "utf8")).toBe('{"preserve":true}\n');
	});
});
