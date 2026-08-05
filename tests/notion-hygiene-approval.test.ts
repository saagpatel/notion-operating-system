/**
 * The approval boundary around the portfolio hygiene pass.
 *
 * Every test here is about refusing to act: no envelope, a plan that drifted
 * after approval, authority that grants more than the plan needs, authority
 * that expired, and authority that was already spent. The two success-path
 * tests exist to prove the receipt records what actually happened rather than
 * what was intended.
 */
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
} from "../src/internal/notion-maintenance/notion-hygiene-authority.js";

const SOURCE_REVISION = `git:${"b".repeat(40)}`;

const REQUIRED_READBACK = [
  "readback_complete",
  "effect_inventory_matched",
  "effect_count_matched",
];

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

function hygienePlan(): NotionHygienePlan {
  return buildNotionHygienePlan({
    actionKind: "notion.portfolio_hygiene",
    sourceRevision: SOURCE_REVISION,
    effects: effects(),
  });
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
      required_readback: REQUIRED_READBACK,
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

async function tamperEnvelope(
  envelopePath: string,
  mutate: (envelope: Record<string, unknown>) => void,
): Promise<void> {
  const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as Record<
    string,
    unknown
  >;
  mutate(envelope);
  await writeFile(envelopePath, JSON.stringify(envelope), { mode: 0o600 });
}

function verifiedReadback(effect: NotionHygieneEffect) {
  return {
    effect_id: effect.effectId,
    target_id: effect.targetId,
    provider_reference: `notion:page:${effect.targetId}`,
    verified: true,
  };
}

async function readReceipt(
  root: string,
  actionId: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      path.join(root, "receipts", `${actionId}.receipt.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("Notion hygiene irreversible-action boundary", () => {
  test("live execution fails closed without an exact envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-none-"));
    const performEffect = vi.fn();

    await expect(
      executeAuthorizedNotionHygiene({
        plan: hygienePlan(),
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
    const plan = hygienePlan();
    await writeEnvelope(root, plan, "fixture-notion-hygiene-changed-0001");
    const changed = structuredClone(plan);
    changed.effects[0]!.targetId = "different-page";
    const performEffect = vi.fn();

    await expect(
      executeAuthorizedNotionHygiene({
        plan: changed,
        envelopePath: path.join(root, "fixture-notion-hygiene-changed-0001.json"),
        claimStateDir: path.join(root, "claims"),
        receiptDir: path.join(root, "receipts"),
        performEffect,
        readbackEffect: vi.fn(),
      }),
    ).rejects.toThrow(/artifact digest mismatch/i);
    expect(performEffect).not.toHaveBeenCalled();
    expect(await readdir(path.join(root, "claims"))).toEqual([]);
  });

  test("authority granting more deletions than the plan needs is refused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-bounds-"));
    const plan = hygienePlan();
    const envelopePath = await writeEnvelope(
      root,
      plan,
      "fixture-notion-hygiene-bounds-0001",
    );
    // A ceiling is not good enough here. An envelope authorizing more archives
    // than the rendered plan performs is over-authorization on an irreversible
    // action, so the bound must match the plan exactly.
    await tamperEnvelope(envelopePath, (envelope) => {
      const bounds = envelope.bounds as { max_deletions: number };
      bounds.max_deletions += 1;
    });
    const performEffect = vi.fn();

    await expect(
      executeAuthorizedNotionHygiene({
        plan,
        envelopePath,
        claimStateDir: path.join(root, "claims"),
        receiptDir: path.join(root, "receipts"),
        performEffect,
        readbackEffect: vi.fn(),
      }),
    ).rejects.toThrow(/bounds mismatch/i);
    expect(performEffect).not.toHaveBeenCalled();
    expect(await readdir(path.join(root, "claims"))).toEqual([]);
  });

  test("authority whose preconditions do not pin the plan is refused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-precond-"));
    const plan = hygienePlan();
    const envelopePath = await writeEnvelope(
      root,
      plan,
      "fixture-notion-hygiene-precond-0001",
    );
    await tamperEnvelope(envelopePath, (envelope) => {
      envelope.preconditions = { effect_inventory_digest: "sha256:0" };
    });
    const performEffect = vi.fn();

    await expect(
      executeAuthorizedNotionHygiene({
        plan,
        envelopePath,
        claimStateDir: path.join(root, "claims"),
        receiptDir: path.join(root, "receipts"),
        performEffect,
        readbackEffect: vi.fn(),
      }),
    ).rejects.toThrow(/preconditions mismatch/i);
    expect(performEffect).not.toHaveBeenCalled();
  });

  test("expired authority is refused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-expiry-"));
    const plan = hygienePlan();
    const envelopePath = await writeEnvelope(
      root,
      plan,
      "fixture-notion-hygiene-expiry-0001",
    );
    await tamperEnvelope(envelopePath, (envelope) => {
      envelope.issued_at = new Date(Date.now() - 120_000).toISOString();
      envelope.expires_at = new Date(Date.now() - 60_000).toISOString();
    });
    const performEffect = vi.fn();

    await expect(
      executeAuthorizedNotionHygiene({
        plan,
        envelopePath,
        claimStateDir: path.join(root, "claims"),
        receiptDir: path.join(root, "receipts"),
        performEffect,
        readbackEffect: vi.fn(),
      }),
    ).rejects.toThrow(/expired or has an invalid validity window/i);
    expect(performEffect).not.toHaveBeenCalled();
  });

  test("successful effects emit a stable readback receipt and block replay", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-success-"));
    const plan = hygienePlan();
    const actionId = "fixture-notion-hygiene-success-0001";
    const envelopePath = await writeEnvelope(root, plan, actionId);
    const performEffect = vi
      .fn()
      .mockImplementation(
        async (effect: NotionHygieneEffect) => `notion:page:${effect.targetId}`,
      );
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
    expect(await readReceipt(root, actionId)).toMatchObject({
      action_id: actionId,
      artifact_digest: plan.planDigest,
      terminal_outcome: "succeeded",
      readback_result: {
        readback_complete: true,
        effect_inventory_matched: true,
        effect_count_matched: true,
        effect_count: 2,
        effect_inventory_digest: plan.effectInventoryDigest,
        verified_effect_ids: plan.effects.map((effect) => effect.effectId),
        unverified_effect_ids: [],
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
    ).rejects.toThrow(/already claimed/i);
    expect(performEffect).toHaveBeenCalledTimes(2);
  });

  test("partial failure is outcome_unknown and prohibits automatic retry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-unknown-"));
    const plan = hygienePlan();
    const actionId = "fixture-notion-hygiene-unknown-0001";
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
    // Every readback verified, yet the receipt must not claim success: an
    // effect threw, so what the provider actually did is unknown.
    expect(await readReceipt(root, actionId)).toMatchObject({
      terminal_outcome: "outcome_unknown",
      readback_result: {
        readback_complete: false,
        effect_count: 2,
        error: "fixture timeout",
      },
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
    ).rejects.toThrow(/already claimed/i);
    expect(performEffect).toHaveBeenCalledTimes(2);
  });

  test("failed readback produces outcome_unknown rather than success", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "notion-hygiene-readback-"));
    const plan = hygienePlan();
    const actionId = "fixture-notion-hygiene-readback-0001";
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
    expect(await readReceipt(root, actionId)).toMatchObject({
      terminal_outcome: "outcome_unknown",
      readback_result: {
        readback_complete: false,
        unverified_effect_ids: ["markdown:page-canonical"],
      },
    });
  });
});
