/**
 * Approval authority for the portfolio hygiene pass.
 *
 * The hygiene pass archives Notion pages, rewrites canonical source rows, and
 * replaces a local config file. All of that is irreversible, and until this
 * module existed it ran on a bare `--live` flag while its three sibling
 * maintenance surfaces (schema-migrate, schema-migrate-probe,
 * support-database-hygiene-pass) each required an approval envelope.
 *
 * The shape is plan/execute: `buildNotionHygienePlan` renders an exact,
 * digest-pinned inventory of effects from read-only state, and
 * `executeAuthorizedNotionHygiene` refuses to touch anything unless an envelope
 * authorizes that exact inventory.
 *
 * Ported from the `src/security/notion-hygiene-authority.ts` implementation onto
 * this tree's `irreversible-action.ts` primitives. Three call-shape differences
 * were bridged rather than dropped; see `assertHygieneAuthority` and
 * `REQUIRED_READBACK` below, both of which carry the reason inline.
 */
import {
  claimEnvelope,
  emitReceipt,
  loadEnvelope,
  planDigest,
  requirePrivateAuthorityDirectory,
  validateEnvelope,
  type IrreversibleActionEnvelopeV1,
} from "./irreversible-action.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";

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

export interface NotionHygieneResult {
  schema: "NotionHygieneResultV1";
  action_id: string;
  target: Record<string, unknown>;
  artifact_digest: string;
  provider_reference: string[];
  readback_result: Record<string, unknown>;
  terminal_outcome: "succeeded";
}

/**
 * Every key here must be present on the readback result and strictly `true`
 * before a receipt may claim success.
 *
 * The source implementation listed evidence keys (`effect_inventory_digest`,
 * `verified_effect_ids`, ...) here instead. That is incompatible with this
 * tree's receipt contract, which requires each named key to equal `true` — a
 * digest string or an id array would fail it, or worse, would have forced the
 * contract to be loosened for every governed surface. The evidence is still
 * emitted on the readback result; what is *required* is now the set of boolean
 * assertions that evidence supports, which is what the sibling surfaces do.
 */
const REQUIRED_READBACK = [
  "readback_complete",
  "effect_inventory_matched",
  "effect_count_matched",
];

const PRINCIPAL_KINDS = new Set([
  "operator",
  "automation",
  "service",
  "test-fixture",
]);

const MIN_PROVIDER_IDEMPOTENCY_KEY_LENGTH = 8;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function effectInventory(
  effects: NotionHygieneEffect[],
): Array<Record<string, unknown>> {
  return effects.map((effect) => ({
    effect_id: effect.effectId,
    kind: effect.kind,
    target_id: effect.targetId,
    payload_digest: planDigest(effect.payload),
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
    throw new AppError(
      "hygiene plan must contain at least one state-changing effect",
    );
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
    if (
      effect.kind === "page_archive" &&
      !SHA256_DIGEST_PATTERN.test(
        String(effect.payload.expected_prestate_digest ?? ""),
      )
    ) {
      throw new AppError(
        "page archive effects must bind a complete provider prestate digest",
      );
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
  const effectInventoryDigest = planDigest(inventory);
  const digest = planDigest(planCore(base));
  return {
    ...base,
    effectInventoryDigest,
    planDigest: digest,
    canonicalTargets: {
      effects: inventory,
      plan_digest: digest,
    },
    preconditions: {
      effect_inventory_digest: effectInventoryDigest,
      plan_digest: digest,
    },
  };
}

function validatePlan(plan: NotionHygienePlan): void {
  if (planDigest(planCore(plan)) !== plan.planDigest) {
    throw new AppError("artifact digest mismatch: rendered hygiene plan changed");
  }
  if (planDigest(effectInventory(plan.effects)) !== plan.effectInventoryDigest) {
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

/**
 * Checks this surface requires that the shared envelope validator does not make.
 *
 * The shared validator is written for surfaces whose bounds are a ceiling: it
 * accepts `max_deletions` greater than the plan needs, and it checks only that
 * `preconditions` is non-empty. For an irreversible bulk archive an envelope
 * granting more deletion authority than the rendered plan consumes is
 * over-authorization, and unpinned preconditions mean the approver signed
 * something other than what runs. Both are enforced here rather than in the
 * shared validator so the three sibling surfaces keep their existing contract.
 */
function assertHygieneAuthority(
  envelope: IrreversibleActionEnvelopeV1,
  plan: NotionHygienePlan,
): void {
  if (!PRINCIPAL_KINDS.has(envelope.principal?.kind)) {
    throw new AppError("hygiene authority principal kind is not recognized");
  }
  if (
    envelope.provider_idempotency_key.length <
    MIN_PROVIDER_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new AppError("hygiene authority provider idempotency key is too short");
  }
  if (
    envelope.bounds.allowed_effect_count !== plan.allowedEffectCount ||
    envelope.bounds.max_deletions !== plan.maxDeletions
  ) {
    throw new AppError("hygiene authority bounds mismatch");
  }
  if (
    planDigest(envelope.preconditions) !== planDigest(plan.preconditions)
  ) {
    throw new AppError("hygiene authority preconditions mismatch");
  }
}

function readbackResult(input: {
  plan: NotionHygienePlan;
  readbacks: NotionHygieneEffectReadback[];
  effectCount: number;
  error?: unknown;
}): Record<string, unknown> {
  const verified = input.readbacks
    .filter((readback) => readback.verified)
    .map((readback) => readback.effect_id);
  const verifiedSet = new Set(verified);
  const unverified = input.plan.effects
    .map((effect) => effect.effectId)
    .filter((effectId) => !verifiedSet.has(effectId));
  return {
    readback_complete: unverified.length === 0 && input.error === undefined,
    effect_inventory_matched:
      planDigest(effectInventory(input.plan.effects)) ===
      input.plan.effectInventoryDigest,
    effect_count_matched: input.effectCount === input.plan.allowedEffectCount,
    effect_inventory_digest: input.plan.effectInventoryDigest,
    verified_effect_ids: verified,
    unverified_effect_ids: unverified,
    effect_count: input.effectCount,
    effects: input.readbacks,
    ...(input.error ? { error: toErrorMessage(input.error) } : {}),
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
    markEffectAttempted: () => void,
  ) => Promise<string>;
  readbackEffect: (
    effect: NotionHygieneEffect,
  ) => Promise<NotionHygieneEffectReadback>;
  now?: Date;
}): Promise<NotionHygieneResult> {
  validatePlan(input.plan);
  const claimStateDir = requirePrivateAuthorityDirectory(input.claimStateDir);
  const receiptDir = requirePrivateAuthorityDirectory(input.receiptDir);
  const canonicalTargets = {
    ...input.plan.canonicalTargets,
    authority_state_dir: claimStateDir,
    receipt_state_dir: receiptDir,
  };

  const envelope = loadEnvelope(input.envelopePath);
  assertHygieneAuthority(envelope, input.plan);
  validateEnvelope({
    envelope,
    actionKind: input.plan.actionKind,
    canonicalTargets,
    sourceRevision: input.plan.sourceRevision,
    plan: planCore(input.plan),
    effectCount: input.plan.allowedEffectCount,
    deletionCount: input.plan.maxDeletions,
    requiredReadback: REQUIRED_READBACK,
    now: input.now,
  });
  claimEnvelope(envelope, claimStateDir);

  let effectCount = 0;
  const providerReferences: string[] = [];
  try {
    for (const effect of input.plan.effects) {
      let effectAttempted = false;
      const providerReference = await input.performEffect(
        effect,
        `${envelope.provider_idempotency_key}:${effect.effectId}`,
        () => {
          if (!effectAttempted) {
            effectAttempted = true;
            effectCount += 1;
          }
        },
      );
      // A successful provider call is itself proof that an effect was
      // attempted. This fallback keeps adapters honest while still allowing a
      // pre-write check to throw without inflating the attempted-effect count.
      if (!effectAttempted) {
        effectCount += 1;
      }
      providerReferences.push(providerReference);
    }
  } catch (error) {
    // The shared failure recorder is deliberately not used here. It records
    // that an effect was attempted but not which ones landed, and on a partial
    // bulk archive the per-effect readback is the only evidence that says what
    // state the workspace is actually in.
    const readbacks = await collectReadbacks(input.plan, input.readbackEffect);
    emitReceipt({
      envelope,
      receiptDir,
      target: canonicalTargets,
      providerReference:
        providerReferences.join(",") || "notion:no-provider-reference",
      readbackResult: readbackResult({
        plan: input.plan,
        readbacks,
        effectCount,
        error,
      }),
      terminalOutcome: effectCount > 0 ? "outcome_unknown" : "failed_before_effect",
    });
    throw new AppError(
      "Notion hygiene outcome is unknown; automatic retry is prohibited",
    );
  }

  const readbacks = await collectReadbacks(input.plan, input.readbackEffect);
  const result = readbackResult({ plan: input.plan, readbacks, effectCount });
  const succeeded = REQUIRED_READBACK.every((key) => result[key] === true);
  emitReceipt({
    envelope,
    receiptDir,
    target: canonicalTargets,
    providerReference:
      providerReferences.join(",") || "notion:no-provider-reference",
    readbackResult: result,
    terminalOutcome: succeeded ? "succeeded" : "outcome_unknown",
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
