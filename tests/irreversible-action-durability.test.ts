/**
 * The one-shot claim must survive a crash.
 *
 * Kept in its own file because asserting the fsync happens requires mocking
 * node:fs, and the main irreversible-action suite uses the real filesystem
 * throughout. Vitest module mocks are per-file, so scoping it here leaves that
 * suite untouched.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

const fsyncCalls: number[] = [];

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    fsyncSync: (descriptor: number) => {
      fsyncCalls.push(descriptor);
      return actual.fsyncSync(descriptor);
    },
  };
});

const { claimEnvelope, planDigest } = await import(
  "../src/internal/notion-maintenance/irreversible-action.js"
);
type Envelope = Awaited<
  ReturnType<typeof import("../src/internal/notion-maintenance/irreversible-action.js").validateEnvelope>
>;

function envelope(actionId: string): Envelope {
  const now = Date.now();
  const plan = { data_source_id: "db-1", effects: [{ kind: "archive" }] };
  return {
    schema: "IrreversibleActionEnvelopeV1",
    action_id: actionId,
    action_kind: "notion.support_database_hygiene",
    principal: { id: "vitest", kind: "test-fixture" },
    canonical_targets: { data_source_id: "db-1" },
    source_revision: "hygiene:v2",
    artifact_digest: planDigest(plan),
    bounds: { allowed_effect_count: 1 },
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 120_000).toISOString(),
    one_shot: true,
    provider_idempotency_key: `fixture-${actionId}`,
    preconditions: { fixture: true },
    required_readback: ["provider_state"],
    receipt_requirements: {
      schema: "IrreversibleActionReceiptV1",
      provider_reference: true,
      readback_result: true,
      terminal_outcome: true,
    },
  };
}

describe("claim durability", () => {
  test("claiming flushes both claim files and both directory entries", () => {
    fsyncCalls.length = 0;
    const claims = mkdtempSync(path.join(os.tmpdir(), "claim-durability-"));

    claimEnvelope(envelope("fixture-notion-durability-0001"), claims);

    // Two claims are written (action_id and provider idempotency key), and each
    // needs its file flushed plus the directory entry that names it. A claim
    // that is written but not flushed can vanish in a crash, which would let a
    // replay succeed against an already-executed irreversible action.
    expect(fsyncCalls.length).toBe(4);
  });

  test("a second claim on the same action_id is still refused", () => {
    const claims = mkdtempSync(path.join(os.tmpdir(), "claim-durability-"));
    const target = envelope("fixture-notion-durability-0002");

    claimEnvelope(target, claims);

    expect(() => claimEnvelope(target, claims)).toThrow(
      "approval action_id is already claimed",
    );
  });
});
