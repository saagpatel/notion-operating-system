import {
	emitIrreversibleActionReceipt,
	loadAndClaimEnvelope,
	preparePrivateAuthorityDirectory,
	sha256Json,
} from "./irreversible-action-envelope.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

export interface NotionHygieneEffect {
	effectId: string;
	kind:
		| "page_archive"
		| "page_properties_update"
		| "page_markdown_replace"
		| "local_file_replace";
	targetId: string;
	payload: Record<string, unknown>;
}

export interface NotionHygienePlan {
	schema: "NotionHygienePlanV1";
	actionKind: string;
	sourceRevision: string;
	effects: NotionHygieneEffect[];
	allowedEffectCount: number;
	maxDeletions: number;
	effectInventoryDigest: string;
	planDigest: string;
	canonicalTargets: Record<string, unknown>;
	preconditions: Record<string, unknown>;
}

export interface NotionHygieneEffectReadback {
	effect_id: string;
	target_id: string;
	provider_reference: string;
	verified: boolean;
	details?: Record<string, unknown>;
}

const REQUIRED_READBACK = [
	"effect_inventory_digest",
	"verified_effect_ids",
	"unverified_effect_ids",
	"readback_complete",
];

function effectInventory(effects: NotionHygieneEffect[]): Array<Record<string, unknown>> {
	return effects.map((effect) => ({
		effect_id: effect.effectId,
		kind: effect.kind,
		target_id: effect.targetId,
		payload_digest: sha256Json(effect.payload),
	}));
}

function planCore(
	plan: Omit<
		NotionHygienePlan,
		"effectInventoryDigest" | "planDigest" | "canonicalTargets" | "preconditions"
	>,
): Record<string, unknown> {
	return {
		schema: plan.schema,
		actionKind: plan.actionKind,
		sourceRevision: plan.sourceRevision,
		effects: plan.effects,
		allowedEffectCount: plan.allowedEffectCount,
		maxDeletions: plan.maxDeletions,
	};
}

export function buildNotionHygienePlan(input: {
	actionKind: string;
	sourceRevision: string;
	effects: NotionHygieneEffect[];
}): NotionHygienePlan {
	if (!input.actionKind.startsWith("notion.")) {
		throw new AppError("Notion hygiene action kind must use the notion namespace");
	}
	if (input.effects.length === 0) {
		throw new AppError("hygiene plan must contain at least one state-changing effect");
	}
	const effectIds = new Set<string>();
	for (const effect of input.effects) {
		if (!effect.effectId.trim() || effectIds.has(effect.effectId)) {
			throw new AppError("hygiene plan effect ids must be non-empty and unique");
		}
		effectIds.add(effect.effectId);
		if (!effect.targetId.trim()) {
			throw new AppError("hygiene plan targets must be exact");
		}
	}
	const allowedEffectCount = input.effects.length;
	const maxDeletions = input.effects.filter(
		(effect) => effect.kind === "page_archive",
	).length;
	const base = {
		schema: "NotionHygienePlanV1" as const,
		actionKind: input.actionKind,
		sourceRevision: input.sourceRevision,
		effects: input.effects,
		allowedEffectCount,
		maxDeletions,
	};
	const inventory = effectInventory(input.effects);
	const effectInventoryDigest = sha256Json(inventory);
	const planDigest = sha256Json(planCore(base));
	return {
		...base,
		effectInventoryDigest,
		planDigest,
		canonicalTargets: {
			effects: inventory,
			plan_digest: planDigest,
		},
		preconditions: {
			effect_inventory_digest: effectInventoryDigest,
			plan_digest: planDigest,
		},
	};
}

function validatePlan(plan: NotionHygienePlan): void {
	if (sha256Json(planCore(plan)) !== plan.planDigest) {
		throw new AppError("artifact digest mismatch: rendered hygiene plan changed");
	}
	if (sha256Json(effectInventory(plan.effects)) !== plan.effectInventoryDigest) {
		throw new AppError("effect inventory digest mismatch");
	}
	if (
		plan.allowedEffectCount !== plan.effects.length ||
		plan.maxDeletions !==
			plan.effects.filter((effect) => effect.kind === "page_archive").length
	) {
		throw new AppError("hygiene plan bounds do not match its effect inventory");
	}
}

function readbackResult(
	plan: NotionHygienePlan,
	readbacks: NotionHygieneEffectReadback[],
	error?: unknown,
): Record<string, unknown> {
	const verified = readbacks
		.filter((readback) => readback.verified)
		.map((readback) => readback.effect_id);
	const verifiedSet = new Set(verified);
	const unverified = plan.effects
		.map((effect) => effect.effectId)
		.filter((effectId) => !verifiedSet.has(effectId));
	return {
		effect_inventory_digest: plan.effectInventoryDigest,
		verified_effect_ids: verified,
		unverified_effect_ids: unverified,
		readback_complete: unverified.length === 0,
		effects: readbacks,
		...(error ? { error: toErrorMessage(error) } : {}),
	};
}

export async function executeAuthorizedNotionHygiene(input: {
	plan: NotionHygienePlan;
	envelopePath: string;
	claimStateDir: string;
	receiptDir: string;
	performEffect: (
		effect: NotionHygieneEffect,
		providerIdempotencyKey: string,
	) => Promise<string>;
	readbackEffect: (
		effect: NotionHygieneEffect,
	) => Promise<NotionHygieneEffectReadback>;
}): Promise<Record<string, unknown>> {
	validatePlan(input.plan);
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
		actionKind: input.plan.actionKind,
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
	const providerReferences: string[] = [];
	try {
		for (const effect of input.plan.effects) {
			effectCount += 1;
			providerReferences.push(
				await input.performEffect(
					effect,
					`${envelope.provider_idempotency_key}:${effect.effectId}`,
				),
			);
		}
	} catch (error) {
		const readbacks = await collectReadbacks(input.plan, input.readbackEffect);
		await emitIrreversibleActionReceipt({
			envelope,
			receiptDir,
			target: canonicalTargets,
			providerReference:
				providerReferences.join(",") || "notion:no-provider-reference",
			readbackResult: readbackResult(input.plan, readbacks, error),
			terminalOutcome: "outcome_unknown",
			effectCount,
		});
		throw new AppError(
			"Notion hygiene outcome is unknown; automatic retry is prohibited",
		);
	}

	const readbacks = await collectReadbacks(input.plan, input.readbackEffect);
	const result = readbackResult(input.plan, readbacks);
	const succeeded = result.readback_complete === true;
	await emitIrreversibleActionReceipt({
		envelope,
		receiptDir,
		target: canonicalTargets,
		providerReference:
			providerReferences.join(",") || "notion:no-provider-reference",
		readbackResult: result,
		terminalOutcome: succeeded ? "succeeded" : "outcome_unknown",
		effectCount,
	});
	if (!succeeded) {
		throw new AppError(
			"Notion hygiene outcome is unknown; automatic retry is prohibited",
		);
	}
	return {
		schema: "NotionHygieneResultV1",
		action_id: envelope.action_id,
		target: canonicalTargets,
		artifact_digest: input.plan.planDigest,
		provider_reference: providerReferences,
		readback_result: result,
		terminal_outcome: "succeeded",
	};
}

async function collectReadbacks(
	plan: NotionHygienePlan,
	readbackEffect: (
		effect: NotionHygieneEffect,
	) => Promise<NotionHygieneEffectReadback>,
): Promise<NotionHygieneEffectReadback[]> {
	const results: NotionHygieneEffectReadback[] = [];
	for (const effect of plan.effects) {
		try {
			results.push(await readbackEffect(effect));
		} catch (error) {
			results.push({
				effect_id: effect.effectId,
				target_id: effect.targetId,
				provider_reference: `notion:page:${effect.targetId}`,
				verified: false,
				details: { readback_error: toErrorMessage(error) },
			});
		}
	}
	return results;
}
