import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
	buildNotionHygienePlan,
	executeAuthorizedNotionHygiene,
	type NotionHygieneEffect,
	type NotionHygienePlan,
} from "../src/security/notion-hygiene-authority.js";

const SOURCE_REVISION = "b".repeat(40);

function effects(): NotionHygieneEffect[] {
	return [
		{
			effectId: "archive:page-duplicate",
			kind: "page_archive",
			targetId: "page-duplicate",
			payload: { in_trash: true },
		},
		{
			effectId: "markdown:page-canonical",
			kind: "page_markdown_replace",
			targetId: "page-canonical",
			payload: { markdown: "# Canonical" },
		},
	];
}

async function writeEnvelope(
	root: string,
	plan: NotionHygienePlan,
	actionId: string,
): Promise<string> {
	const claimStateDir = path.join(root, "claims");
	const receiptDir = path.join(root, "receipts");
	await mkdir(claimStateDir, { mode: 0o700 });
	await mkdir(receiptDir, { mode: 0o700 });
	const envelopePath = path.join(root, `${actionId}.json`);
	await writeFile(
		envelopePath,
		JSON.stringify({
			schema: "IrreversibleActionEnvelopeV1",
			action_id: actionId,
			action_kind: plan.actionKind,
			principal: { id: "fixture", kind: "test-fixture" },
			canonical_targets: {
				...plan.canonicalTargets,
				authority_state_dir: await realpath(claimStateDir),
				receipt_state_dir: await realpath(receiptDir),
			},
			source_revision: SOURCE_REVISION,
			artifact_digest: plan.planDigest,
			bounds: {
				allowed_effect_count: plan.allowedEffectCount,
				max_deletions: plan.maxDeletions,
			},
			issued_at: new Date(Date.now() - 1_000).toISOString(),
			expires_at: new Date(Date.now() + 60_000).toISOString(),
			one_shot: true,
			provider_idempotency_key: `${actionId}.provider`,
			preconditions: plan.preconditions,
			required_readback: [
				"effect_inventory_digest",
				"verified_effect_ids",
				"unverified_effect_ids",
				"readback_complete",
			],
			receipt_requirements: {
				schema: "IrreversibleActionReceiptV1",
				provider_reference: true,
				readback_result: true,
				terminal_outcome: true,
			},
		}),
		{ mode: 0o600 },
	);
	return envelopePath;
}

function verifiedReadback(effect: NotionHygieneEffect) {
	return {
		effect_id: effect.effectId,
		target_id: effect.targetId,
		provider_reference: `notion:page:${effect.targetId}`,
		verified: true,
	};
}

describe("Notion hygiene irreversible-action boundary", () => {
	test("live execution fails closed without an exact envelope", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-none-"));
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const performEffect = vi.fn();

		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath: path.join(root, "missing-envelope.json"),
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow();
		expect(performEffect).not.toHaveBeenCalled();
	});

	test("a changed effect inventory cannot consume older authority", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-changed-"));
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const envelopePath = await writeEnvelope(
			root,
			plan,
			"fixture.notion.hygiene.changed.0001",
		);
		const changed = structuredClone(plan);
		changed.effects[0]!.targetId = "different-page";
		const performEffect = vi.fn();

		await expect(
			executeAuthorizedNotionHygiene({
				plan: changed,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow(/artifact digest mismatch/i);
		expect(performEffect).not.toHaveBeenCalled();
		expect(await readdir(path.join(root, "claims"))).toEqual([]);
	});

	test("deletion authority must be exactly bounded and unexpired", async () => {
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const performEffect = vi.fn();

		const boundsRoot = await mkdtemp(
			path.join(os.tmpdir(), "notion-hygiene-bounds-"),
		);
		const boundsEnvelope = await writeEnvelope(
			boundsRoot,
			plan,
			"fixture.notion.hygiene.bounds.0001",
		);
		const widened = JSON.parse(
			await readFile(boundsEnvelope, "utf8"),
		) as {
			bounds: { max_deletions: number };
		};
		widened.bounds.max_deletions += 1;
		await writeFile(boundsEnvelope, JSON.stringify(widened), { mode: 0o600 });
		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath: boundsEnvelope,
				claimStateDir: path.join(boundsRoot, "claims"),
				receiptDir: path.join(boundsRoot, "receipts"),
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow(/bounds mismatch/i);

		const expiryRoot = await mkdtemp(
			path.join(os.tmpdir(), "notion-hygiene-expiry-"),
		);
		const expiryEnvelope = await writeEnvelope(
			expiryRoot,
			plan,
			"fixture.notion.hygiene.expiry.0001",
		);
		const expired = JSON.parse(await readFile(expiryEnvelope, "utf8")) as {
			issued_at: string;
			expires_at: string;
		};
		expired.issued_at = new Date(Date.now() - 120_000).toISOString();
		expired.expires_at = new Date(Date.now() - 60_000).toISOString();
		await writeFile(expiryEnvelope, JSON.stringify(expired), { mode: 0o600 });
		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath: expiryEnvelope,
				claimStateDir: path.join(expiryRoot, "claims"),
				receiptDir: path.join(expiryRoot, "receipts"),
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow(/not currently valid/i);
		expect(performEffect).not.toHaveBeenCalled();
	});

	test("successful fake effects emit a stable readback receipt and block replay", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-success-"));
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const actionId = "fixture.notion.hygiene.success.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const performEffect = vi
			.fn()
			.mockImplementation(async (effect: NotionHygieneEffect) => {
				return `notion:page:${effect.targetId}`;
			});
		const readbackEffect = vi
			.fn()
			.mockImplementation(async (effect: NotionHygieneEffect) =>
				verifiedReadback(effect),
			);

		const result = await executeAuthorizedNotionHygiene({
			plan,
			envelopePath,
			claimStateDir: path.join(root, "claims"),
			receiptDir: path.join(root, "receipts"),
			performEffect,
			readbackEffect,
		});

		expect(result.terminal_outcome).toBe("succeeded");
		expect(performEffect).toHaveBeenCalledTimes(2);
		const receipt = JSON.parse(
			await readFile(
				path.join(root, "receipts", `${actionId}.receipt.json`),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			action_id: actionId,
			artifact_digest: plan.planDigest,
			effect_count: 2,
			terminal_outcome: "succeeded",
			readback_result: {
				effect_inventory_digest: plan.effectInventoryDigest,
				verified_effect_ids: plan.effects.map((effect) => effect.effectId),
				unverified_effect_ids: [],
				readback_complete: true,
			},
		});

		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect,
				readbackEffect,
			}),
		).rejects.toThrow(/already been claimed/i);
		expect(performEffect).toHaveBeenCalledTimes(2);
	});

	test("partial failure is outcome_unknown and prohibits automatic retry", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-unknown-"));
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const actionId = "fixture.notion.hygiene.unknown.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);
		const performEffect = vi
			.fn()
			.mockResolvedValueOnce("notion:page:page-duplicate")
			.mockRejectedValueOnce(new Error("fixture timeout"));

		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect,
				readbackEffect: vi.fn().mockImplementation(verifiedReadback),
			}),
		).rejects.toThrow(/automatic retry is prohibited/i);
		const receipt = JSON.parse(
			await readFile(
				path.join(root, "receipts", `${actionId}.receipt.json`),
				"utf8",
			),
		) as Record<string, unknown>;
		expect(receipt).toMatchObject({
			effect_count: 2,
			terminal_outcome: "outcome_unknown",
		});

		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow(/already been claimed/i);
		expect(performEffect).toHaveBeenCalledTimes(2);
	});

	test("failed readback produces outcome_unknown rather than success", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-readback-"));
		const plan = buildNotionHygienePlan({
			actionKind: "notion.portfolio_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: effects(),
		});
		const actionId = "fixture.notion.hygiene.readback.0001";
		const envelopePath = await writeEnvelope(root, plan, actionId);

		await expect(
			executeAuthorizedNotionHygiene({
				plan,
				envelopePath,
				claimStateDir: path.join(root, "claims"),
				receiptDir: path.join(root, "receipts"),
				performEffect: vi
					.fn()
					.mockImplementation(
						async (effect: NotionHygieneEffect) =>
							`notion:page:${effect.targetId}`,
					),
				readbackEffect: vi.fn().mockImplementation(async (effect) => ({
					...verifiedReadback(effect),
					verified: effect.effectId !== "markdown:page-canonical",
				})),
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
			readback_result: {
				unverified_effect_ids: ["markdown:page-canonical"],
				readback_complete: false,
			},
		});
	});
});
