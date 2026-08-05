import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Client } from "@notionhq/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  canonicalJson,
  claimEnvelope,
  createClaimedActionFailureRecorder,
  emitReceipt,
  NOTION_CLAIM_STATE_DIR,
  NOTION_RECEIPT_DIR,
  planDigest,
  validateEnvelope,
  type IrreversibleActionEnvelopeV1,
} from "../src/internal/notion-maintenance/irreversible-action.js";
import {
  probePlan,
  runLiveProbe,
  runProbe,
} from "../src/internal/notion-maintenance/schema-migrate-probe.js";
import {
  assertMigrationPropertyIdentity,
  authorizeSchemaMigration,
  patchPropertiesWithIdentityCheck,
  schemaMigrationPlan,
  schemaMigrationTargets,
  verifySchemaMigrationReadback,
} from "../src/internal/notion-maintenance/schema-migrate.js";
import {
  assertHygieneArchivePrecondition,
  assertHygieneEffectPrecondition,
  executeSupportDatabaseHygieneEffects,
  hygieneArchivePrecondition,
  supportDatabaseHygienePlan,
  verifySupportDatabaseHygieneState,
} from "../src/internal/notion-maintenance/support-database-hygiene-pass.js";
import {
  hydrateCompleteRelationProperties,
  type DataSourcePageRef,
} from "../src/notion/local-portfolio-control-tower-live.js";
import { DirectNotionClient } from "../src/notion/direct-notion-client.js";
import type { PropertySchema } from "../src/types.js";

function envelopeFor(input: {
  actionId: string;
  actionKind: string;
  targets: Record<string, unknown>;
  sourceRevision: string;
  plan: unknown;
  effects: number;
  deletions?: number;
  readback?: string[];
  providerKey?: string;
}): IrreversibleActionEnvelopeV1 {
  const now = Date.now();
  return {
    schema: "IrreversibleActionEnvelopeV1",
    action_id: input.actionId,
    action_kind: input.actionKind,
    principal: { id: "vitest", kind: "test-fixture" },
    canonical_targets: input.targets,
    source_revision: input.sourceRevision,
    artifact_digest: planDigest(input.plan),
    bounds: {
      allowed_effect_count: input.effects,
      ...(input.deletions === undefined ? {} : { max_deletions: input.deletions }),
    },
    issued_at: new Date(now - 1_000).toISOString(),
    expires_at: new Date(now + 120_000).toISOString(),
    one_shot: true,
    provider_idempotency_key: input.providerKey ?? `fixture-${input.actionId}`,
    preconditions: { fixture: true },
    required_readback: input.readback ?? ["provider_state"],
    receipt_requirements: {
      schema: "IrreversibleActionReceiptV1",
      provider_reference: true,
      readback_result: true,
      terminal_outcome: true,
    },
  };
}

function writeEnvelope(directory: string, envelope: IrreversibleActionEnvelopeV1): string {
  const file = path.join(directory, "approval.json");
  writeFileSync(file, `${canonicalJson(envelope)}\n`);
  chmodSync(file, 0o600);
  return file;
}

afterEach(() => {
  delete process.env.IRREVERSIBLE_ACTION_STATE_DIR;
  delete process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR;
  vi.unstubAllGlobals();
});

describe("IrreversibleActionEnvelopeV1 Notion adapter", () => {
  test("action ids are opaque identifiers, never authority path fragments", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const claims = path.join(directory, "claims");
    const receipts = path.join(directory, "receipts");
    const plan = { fixture: "action-id-containment" };
    const invalidActionIds = [
      "../escaped",
      "..\\escaped",
      "safe/../../escaped",
      "safe:claim",
      ".hidden",
      "évidence",
      "a".repeat(129),
    ];
    for (const actionId of invalidActionIds) {
      const candidate = envelopeFor({
        actionId,
        actionKind: "notion.validation_fixture",
        targets: { fixture: "target" },
        sourceRevision: "fixture-source-revision",
        plan,
        effects: 0,
        readback: ["fixture_containment"],
      });
      expect(() =>
        validateEnvelope({
          envelope: candidate,
          actionKind: candidate.action_kind,
          canonicalTargets: candidate.canonical_targets,
          sourceRevision: candidate.source_revision,
          plan,
          effectCount: 0,
          requiredReadback: candidate.required_readback,
        }),
      ).toThrow("approval action_id must be an opaque identifier");
    }

    const envelope = envelopeFor({
      actionId: "../escaped",
      actionKind: "notion.validation_fixture",
      targets: { fixture: "target" },
      sourceRevision: "fixture-source-revision",
      plan,
      effects: 0,
      readback: ["fixture_containment"],
    });
    expect(() => claimEnvelope(envelope, claims)).toThrow(
      "approval action_id must be an opaque identifier",
    );
    expect(() =>
      emitReceipt({
        envelope,
        target: envelope.canonical_targets,
        providerReference: "fixture:none",
        readbackResult: { fixture_containment: true },
        terminalOutcome: "succeeded",
        receiptDir: receipts,
      }),
    ).toThrow("approval action_id must be an opaque identifier");
    expect(existsSync(claims)).toBe(false);
    expect(existsSync(receipts)).toBe(false);
    expect(existsSync(path.join(directory, "escaped.claim.json"))).toBe(false);
    expect(existsSync(path.join(directory, "escaped.receipt.json"))).toBe(false);
  });

  test("changed plan cannot consume an older approval", () => {
    const approvedPlan = { data_source_id: "db-1", delete: ["old"] };
    const envelope = envelopeFor({
      actionId: "fixture-notion-plan-0001",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: approvedPlan,
      effects: 1,
      deletions: 1,
    });
    expect(() =>
      validateEnvelope({
        envelope,
        actionKind: "notion.schema_migrate",
        canonicalTargets: { data_source_id: "db-1" },
        sourceRevision: "schema-migrate:v2",
        plan: { data_source_id: "db-1", delete: ["old", "new"] },
        effectCount: 1,
        deletionCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("plan digest mismatch");
  });

  test("an envelope carrying an unknown field is refused outright", () => {
    const plan = { data_source_id: "db-1", effects: [{ kind: "archive" }] };
    const envelope = envelopeFor({
      actionId: "fixture-notion-unknown-field-0001",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 1,
    });
    // Every known field still validates; only the extra key differs. Ignoring
    // it would let a field a future version might honor ride through unexamined.
    const tampered = {
      ...envelope,
      allow_destructive_override: true,
    } as unknown as IrreversibleActionEnvelopeV1;

    expect(() =>
      validateEnvelope({
        envelope: tampered,
        actionKind: "notion.support_database_hygiene",
        canonicalTargets: { data_source_id: "db-1" },
        sourceRevision: "hygiene:v2",
        plan,
        effectCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("approval envelope fields mismatch");
  });

  test("an envelope missing a required field is refused", () => {
    const plan = { data_source_id: "db-1", effects: [{ kind: "archive" }] };
    const envelope = envelopeFor({
      actionId: "fixture-notion-missing-field-0001",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 1,
    });
    const { preconditions: _dropped, ...truncated } = envelope;

    expect(() =>
      validateEnvelope({
        envelope: truncated as unknown as IrreversibleActionEnvelopeV1,
        actionKind: "notion.support_database_hygiene",
        canonicalTargets: { data_source_id: "db-1" },
        sourceRevision: "hygiene:v2",
        plan,
        effectCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("approval envelope fields mismatch");
  });

  test("allowed effect count must equal the exact planned effect count", () => {
    const plan = { data_source_id: "db-1", effects: [{ kind: "archive" }] };
    const envelope = envelopeFor({
      actionId: "fixture-notion-effects-0001",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 2,
      deletions: 1,
    });

    expect(() =>
      validateEnvelope({
        envelope,
        actionKind: "notion.support_database_hygiene",
        canonicalTargets: { data_source_id: "db-1" },
        sourceRevision: "hygiene:v2",
        plan,
        effectCount: 1,
        deletionCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("approval effect bound mismatch");
  });

  test("unknown or omitted readback proof cannot consume approval", () => {
    const plan = { data_source_id: "db-1", effects: [] };
    const envelope = envelopeFor({
      actionId: "fixture-notion-readback-0001",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 0,
      readback: ["canonical_markdown_exact"],
    });

    expect(() =>
      validateEnvelope({
        envelope,
        actionKind: "notion.support_database_hygiene",
        canonicalTargets: { data_source_id: "db-1" },
        sourceRevision: "hygiene:v2",
        plan,
        effectCount: 0,
        requiredReadback: ["archive_ids_absent"],
      }),
    ).toThrow("approval required_readback mismatch");
  });

  test("production authority namespaces are fixed installation paths", () => {
    process.env.IRREVERSIBLE_ACTION_STATE_DIR = "/tmp/caller-claims";
    process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR = "/tmp/caller-receipts";
    expect(NOTION_CLAIM_STATE_DIR).toBe(
      "/Users/d/.codex/state/irreversible-actions/notion",
    );
    expect(NOTION_RECEIPT_DIR).toBe(
      "/Users/d/.codex/reports/irreversible-actions/notion/receipts",
    );
  });

  test("claim and receipt reject pre-existing weak authority directories", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const claims = path.join(directory, "claims");
    const receipts = path.join(directory, "receipts");
    mkdirSync(claims, { mode: 0o777 });
    mkdirSync(receipts, { mode: 0o777 });
    chmodSync(claims, 0o777);
    chmodSync(receipts, 0o777);
    const envelope = envelopeFor({
      actionId: "fixture-notion-directory-0001",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
    });

    expect(() => claimEnvelope(envelope, claims)).toThrow("must not grant group or other access");
    expect(() =>
      emitReceipt({
        envelope,
        target: { data_source_id: "db-1" },
        providerReference: "fixture:provider",
        readbackResult: { provider_state: true },
        terminalOutcome: "succeeded",
        receiptDir: receipts,
      }),
    ).toThrow("must not grant group or other access");
  });

  test("claim and receipt reject authority directory symlinks", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const target = path.join(directory, "target");
    mkdirSync(target, { mode: 0o700 });
    const claims = path.join(directory, "claims");
    const receipts = path.join(directory, "receipts");
    symlinkSync(target, claims);
    symlinkSync(target, receipts);
    const envelope = envelopeFor({
      actionId: "fixture-notion-directory-0002",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
    });

    expect(() => claimEnvelope(envelope, claims)).toThrow("non-symlink directory");
    expect(() =>
      emitReceipt({
        envelope,
        target: { data_source_id: "db-1" },
        providerReference: "fixture:provider",
        readbackResult: { provider_state: true },
        terminalOutcome: "succeeded",
        receiptDir: receipts,
      }),
    ).toThrow("non-symlink directory");
  });

  test("provider operation claim blocks a fresh action after outcome_unknown", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const claims = path.join(directory, "claims");
    const receipts = path.join(directory, "receipts");
    const providerKey = "fixture-shared-provider-operation";
    const plan = { data_source_id: "db-1", effects: [{ kind: "archive" }] };
    const first = envelopeFor({
      actionId: "fixture-provider-operation-first",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 1,
      deletions: 1,
      providerKey,
    });
    const replacement = envelopeFor({
      actionId: "fixture-provider-operation-replacement",
      actionKind: "notion.support_database_hygiene",
      targets: { data_source_id: "db-1" },
      sourceRevision: "hygiene:v2",
      plan,
      effects: 1,
      deletions: 1,
      providerKey,
    });

    claimEnvelope(first, claims);
    const failure = createClaimedActionFailureRecorder({
      envelope: first,
      target: first.canonical_targets,
      providerReference: `fixture:notion:${providerKey}`,
      receiptDir: receipts,
    });
    failure.markEffectAttempted();
    expect(() =>
      failure.fail(new Error("fixture ambiguous result"), "provider_effect"),
    ).toThrow("fixture ambiguous result");

    expect(() => claimEnvelope(replacement, claims)).toThrow(
      "provider operation is already claimed; reconcile before retry",
    );
    expect(
      JSON.parse(
        readFileSync(
          path.join(receipts, `${first.action_id}.receipt.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({
      provider_idempotency_key_digest: expect.stringMatching(
        /^sha256:[0-9a-f]{64}$/,
      ),
      required_readback: ["provider_state"],
      terminal_outcome: "outcome_unknown",
    });
  });

  test("successful receipt requires every approved readback key to be true", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receipts = path.join(directory, "receipts");
    const envelope = envelopeFor({
      actionId: "fixture-success-readback-contract",
      actionKind: "notion.schema_probe",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-probe:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
      readback: ["property_absent_after_cleanup"],
    });
    const receiptInput = {
      envelope,
      target: envelope.canonical_targets,
      providerReference: "fixture:notion:property",
      terminalOutcome: "succeeded" as const,
      receiptDir: receipts,
    };

    expect(() =>
      emitReceipt({
        ...receiptInput,
        readbackResult: { property_absent: true },
      }),
    ).toThrow(
      "successful receipt does not satisfy required readback: property_absent_after_cleanup",
    );
    expect(() =>
      emitReceipt({
        ...receiptInput,
        readbackResult: { property_absent_after_cleanup: false },
      }),
    ).toThrow(
      "successful receipt does not satisfy required readback: property_absent_after_cleanup",
    );
    expect(() =>
      emitReceipt({
        ...receiptInput,
        readbackResult: undefined,
      }),
    ).toThrow("receipt readback_result must be an object");
    expect(() =>
      emitReceipt({
        ...receiptInput,
        target: { data_source_id: "db-2" },
        readbackResult: { property_absent_after_cleanup: true },
      }),
    ).toThrow("receipt target does not match approved canonical targets");
    expect(existsSync(receipts)).toBe(false);

    const receiptPath = emitReceipt({
      ...receiptInput,
      readbackResult: {
        property_absent_after_cleanup: true,
        provider_property_id: "fixture-property-id",
      },
    });
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
      provider_idempotency_key_digest: expect.stringMatching(
        /^sha256:[0-9a-f]{64}$/,
      ),
      required_readback: ["property_absent_after_cleanup"],
      terminal_outcome: "succeeded",
      readback_result: {
        property_absent_after_cleanup: true,
        provider_property_id: "fixture-property-id",
      },
    });
  });

  test("default probe never constructs a network client", async () => {
    const sdkFactory = vi.fn();
    const result = await runProbe({
      live: false,
      dataSourceId: "db-1",
      sdkFactory,
    });
    expect(result.mode).toBe("side-effect-free");
    expect(sdkFactory).not.toHaveBeenCalled();
  });

  test("claimed failure before any provider effect emits failed_before_effect", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receiptDirectory = path.join(directory, "receipts");
    const envelope = envelopeFor({
      actionId: "fixture-notion-failed-before-effect-0001",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
    });
    const failure = createClaimedActionFailureRecorder({
      envelope,
      target: envelope.canonical_targets,
      providerReference: "fixture:notion:db-1",
      receiptDir: receiptDirectory,
    });

    expect(() =>
      failure.fail(new Error("fixture pre-effect readback failed"), "pre_effect_readback"),
    ).toThrow("fixture pre-effect readback failed");
    const receipt = JSON.parse(
      readFileSync(
        path.join(receiptDirectory, `${envelope.action_id}.receipt.json`),
        "utf8",
      ),
    );
    expect(receipt).toMatchObject({
      action_id: envelope.action_id,
      terminal_outcome: "failed_before_effect",
      readback_result: {
        effect_attempted: false,
        effect_count_attempted: 0,
        failure_phase: "pre_effect_readback",
        error_category: "Error",
      },
    });
  });

  test("live probe cannot delete a property whose provider id changed", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receiptDirectory = path.join(directory, "receipts");
    process.env.IRREVERSIBLE_ACTION_STATE_DIR = path.join(directory, "claims");
    process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR = receiptDirectory;
    const actionId = "fixture-notion-probe-0001";
    const plan = probePlan("db-1", actionId);
    const envelope = envelopeFor({
      actionId,
      actionKind: "notion.schema_probe",
      targets: {
        data_source_id: "db-1",
        property_name: plan.property_name,
      },
      sourceRevision: "fixture-source-revision",
      plan,
      effects: 2,
      deletions: 1,
      readback: ["property_absent_after_cleanup"],
    });
    const approvalFile = writeEnvelope(directory, envelope);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ properties: {} })
      .mockResolvedValueOnce({
        properties: { [plan.property_name]: { id: "created-property-id" } },
      })
      .mockResolvedValueOnce({
        properties: { [plan.property_name]: { id: "different-property-id" } },
      });
    const sdk = { request } as unknown as Client;

    await expect(
      runLiveProbe({
        sdk,
        dataSourceId: "db-1",
        approvalFile,
        sourceRevision: "fixture-source-revision",
        claimStateDir: process.env.IRREVERSIBLE_ACTION_STATE_DIR,
        receiptDir: process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR,
      }),
    ).rejects.toThrow("property identity changed");
    expect(
      request.mock.calls.some(
        ([call]) =>
          (call as { body?: { properties?: Record<string, unknown> } }).body?.properties?.[
            plan.property_name
          ] === null,
      ),
    ).toBe(false);
    const receipt = JSON.parse(
      readFileSync(path.join(receiptDirectory, `${actionId}.receipt.json`), "utf8"),
    );
    expect(receipt).toMatchObject({
      action_id: actionId,
      provider_reference: `notion:probe:${envelope.provider_idempotency_key}`,
      terminal_outcome: "outcome_unknown",
      readback_result: {
        effect_attempted: true,
        effect_count_attempted: 1,
        failure_phase: "cleanup_and_readback",
        error_category: "Error",
      },
    });
  });

  test("probe claims one-shot authority before mutable provider preflight", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const claimDirectory = path.join(directory, "claims");
    const receiptDirectory = path.join(directory, "receipts");
    const actionId = "fixture-notion-probe-preflight-0001";
    const plan = probePlan("db-1", actionId);
    const envelope = envelopeFor({
      actionId,
      actionKind: "notion.schema_probe",
      targets: {
        data_source_id: "db-1",
        property_name: plan.property_name,
      },
      sourceRevision: "fixture-source-revision",
      plan,
      effects: 2,
      deletions: 1,
      readback: ["property_absent_after_cleanup"],
    });
    const approvalFile = writeEnvelope(directory, envelope);
    const request = vi.fn().mockResolvedValue({
      properties: { [plan.property_name]: { id: "preexisting-property-id" } },
    });
    const sdk = { request } as unknown as Client;
    const input = {
      sdk,
      dataSourceId: "db-1",
      approvalFile,
      sourceRevision: "fixture-source-revision",
      claimStateDir: claimDirectory,
      receiptDir: receiptDirectory,
    };

    await expect(runLiveProbe(input)).rejects.toThrow(
      "nonce-owned probe property already exists",
    );
    const receipt = JSON.parse(
      readFileSync(path.join(receiptDirectory, `${actionId}.receipt.json`), "utf8"),
    );
    expect(receipt).toMatchObject({
      action_id: actionId,
      terminal_outcome: "failed_before_effect",
      readback_result: {
        effect_attempted: false,
        effect_count_attempted: 0,
        failure_phase: "pre_effect_property_absence",
      },
    });

    await expect(runLiveProbe(input)).rejects.toThrow("already claimed");
    expect(request).toHaveBeenCalledOnce();
  });

  test("successful live probe emits a stable readback receipt", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receiptDirectory = path.join(directory, "receipts");
    process.env.IRREVERSIBLE_ACTION_STATE_DIR = path.join(directory, "claims");
    process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR = receiptDirectory;
    const actionId = "fixture-notion-probe-0002";
    const plan = probePlan("db-1", actionId);
    const envelope = envelopeFor({
      actionId,
      actionKind: "notion.schema_probe",
      targets: {
        data_source_id: "db-1",
        property_name: plan.property_name,
      },
      sourceRevision: "fixture-source-revision",
      plan,
      effects: 2,
      deletions: 1,
      readback: ["property_absent_after_cleanup"],
    });
    const approvalFile = writeEnvelope(directory, envelope);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ properties: {} })
      .mockResolvedValueOnce({
        properties: { [plan.property_name]: { id: "created-property-id" } },
      })
      .mockResolvedValueOnce({
        properties: { [plan.property_name]: { id: "created-property-id" } },
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ properties: {} });
    const sdk = { request } as unknown as Client;

    const result = await runLiveProbe({
      sdk,
      dataSourceId: "db-1",
      approvalFile,
      sourceRevision: "fixture-source-revision",
      claimStateDir: process.env.IRREVERSIBLE_ACTION_STATE_DIR,
      receiptDir: process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR,
    });
    const receipt = JSON.parse(
      readFileSync(path.join(receiptDirectory, `${actionId}.receipt.json`), "utf8"),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(receipt).toMatchObject({
      action_id: actionId,
      target: {
        data_source_id: "db-1",
        property_name: plan.property_name,
      },
      artifact_digest: planDigest(plan),
      provider_reference: "notion:property:created-property-id",
      readback_result: { property_absent_after_cleanup: true },
      terminal_outcome: "succeeded",
    });
  });
});

function migrationSchema(
  override: Partial<Record<string, PropertySchema>> = {},
): Record<string, PropertySchema> {
  const names = [
    "Momentum",
    "Registry Status",
    "Date Updated",
    "Last Build Session",
    "Build Session Count",
    "Related Research Count",
    "Supporting Skills Count",
    "Linked Tool Count",
  ];
  return Object.fromEntries(
    names.map((name, index) => [
      name,
      override[name] ?? {
        id: `provider-property-${index + 1}`,
        name,
        type: index < 4 ? "rich_text" : "number",
        writable: true,
      },
    ]),
  );
}

function page(
  id: string,
  title: string,
  properties: DataSourcePageRef["properties"],
): DataSourcePageRef {
  return {
    id,
    title,
    url: `https://notion.test/${id}`,
    lastEditedTime: "2026-07-17T12:00:00.000Z",
    properties,
  };
}

describe("exact Notion migration property authority", () => {
  test("provider property identity changes the approved plan digest", () => {
    const approved = schemaMigrationPlan("db-1", migrationSchema());
    const replacementSchema = migrationSchema({
      Momentum: {
        id: "replacement-property-id",
        name: "Momentum",
        type: "rich_text",
        writable: true,
      },
    });
    const changed = schemaMigrationPlan("db-1", replacementSchema);

    expect(planDigest(changed)).not.toBe(planDigest(approved));
    expect(() =>
      assertMigrationPropertyIdentity(approved.delete_properties, replacementSchema),
    ).toThrow("property identity changed");
  });

  test("matching provider ids and types preserve the approved deletion set", () => {
    const schema = migrationSchema();
    const plan = schemaMigrationPlan("db-1", schema);

    expect(() =>
      assertMigrationPropertyIdentity(plan.delete_properties, schema),
    ).not.toThrow();
    expect(plan.delete_properties).toHaveLength(8);
    expect(plan.delete_properties.every((property) => property.provider_id)).toBe(true);
    expect(plan.required_readback).toEqual([
      "deleted_provider_ids_absent",
      "rollup_provider_semantics_exact",
    ]);
  });

  test("the stronger migration plan cannot consume an older semantic approval", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const currentPlan = schemaMigrationPlan("db-1", migrationSchema());
    const oldPlan = {
      ...currentPlan,
      create_rollups: currentPlan.create_rollups.map(
        ({ function: _function, ...definition }) => definition,
      ),
      required_readback: [
        "deleted_provider_ids_absent",
        "rollup_provider_ids_present",
      ],
    };
    const oldEnvelope = envelopeFor({
      actionId: "fixture-old-rollup-semantic-approval",
      actionKind: "notion.schema_migrate",
      targets: schemaMigrationTargets(currentPlan),
      sourceRevision: "fixture-source-revision",
      plan: oldPlan,
      effects: 6,
      deletions: 8,
      readback: oldPlan.required_readback,
    });

    expect(() =>
      authorizeSchemaMigration({
        approvalFile: writeEnvelope(directory, oldEnvelope),
        dataSourceId: "db-1",
        plan: currentPlan,
        sourceRevision: "fixture-source-revision",
      }),
    ).toThrow("approval plan digest mismatch");
  });

  test("wrong rollup semantics cannot satisfy terminal migration readback", () => {
    const plan = schemaMigrationPlan("db-1", migrationSchema());
    const properties = Object.fromEntries(
      plan.create_rollups.map((definition, index) => [
        definition.propertyName,
        {
          id: `created-rollup-${index + 1}`,
          type: "rollup",
          rollup: {
            relation_property_id: `relation-${index + 1}`,
            relation_property_name:
              index === 0 ? "Tool Stack Records" : definition.relationPropertyName,
            rollup_property_id: `source-${index + 1}`,
            rollup_property_name: definition.rollupPropertyName,
            function: "count",
          },
        },
      ]),
    );

    expect(() => verifySchemaMigrationReadback(plan, properties)).toThrow(
      'rollup semantics changed for "Build Session Count"',
    );
  });

  test("exact rollup semantics produce provider-specific terminal evidence", () => {
    const plan = schemaMigrationPlan("db-1", migrationSchema());
    const properties = Object.fromEntries(
      plan.create_rollups.map((definition, index) => [
        definition.propertyName,
        {
          id: `created-rollup-${index + 1}`,
          type: "rollup",
          rollup: {
            relation_property_id: `relation-${index + 1}`,
            relation_property_name: definition.relationPropertyName,
            rollup_property_id: `source-${index + 1}`,
            rollup_property_name: definition.rollupPropertyName,
            function: definition.function,
          },
        },
      ]),
    );

    const readback = verifySchemaMigrationReadback(plan, properties);
    expect(readback).toMatchObject({
      deleted_provider_ids_absent: true,
      rollup_provider_semantics_exact: true,
    });
    expect(readback.rollup_provider_properties).toHaveLength(4);
    expect(readback.rollup_provider_properties[0]).toEqual({
      name: "Build Session Count",
      provider_id: "created-rollup-1",
      type: "rollup",
      relation_property_id: "relation-1",
      relation_property_name: "Build Sessions",
      rollup_property_id: "source-1",
      rollup_property_name: "Session Title",
      function: "count",
    });

    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const envelope = envelopeFor({
      actionId: "fixture-exact-rollup-semantic-receipt",
      actionKind: "notion.schema_migrate",
      targets: schemaMigrationTargets(plan),
      sourceRevision: "fixture-source-revision",
      plan,
      effects: 6,
      deletions: 8,
      readback: plan.required_readback,
    });
    const receiptPath = emitReceipt({
      envelope,
      target: schemaMigrationTargets(plan),
      providerReference: "notion:data_source:db-1",
      readbackResult: readback,
      terminalOutcome: "succeeded",
      receiptDir: path.join(directory, "receipts"),
    });
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
      action_id: envelope.action_id,
      target: schemaMigrationTargets(plan),
      artifact_digest: planDigest(plan),
      provider_reference: "notion:data_source:db-1",
      required_readback: [
        "deleted_provider_ids_absent",
        "rollup_provider_semantics_exact",
      ],
      readback_result: {
        deleted_provider_ids_absent: true,
        rollup_provider_semantics_exact: true,
        rollup_provider_properties: readback.rollup_provider_properties,
      },
      terminal_outcome: "succeeded",
    });
  });

  test("changed provider identity suppresses the destructive schema patch", async () => {
    const approvedSchema = migrationSchema();
    const plan = schemaMigrationPlan("db-1", approvedSchema);
    const changedSchema = migrationSchema({
      Momentum: {
        id: "replacement-property-id",
        name: "Momentum",
        type: "rich_text",
        writable: true,
      },
    });
    const request = vi.fn();
    const beforePatch = vi.fn();

    await expect(
      patchPropertiesWithIdentityCheck({
        api: {
          retrieveDataSource: vi.fn().mockResolvedValue({
            id: "db-1",
            title: "Fixture",
            titlePropertyName: "Name",
            properties: changedSchema,
          }),
        },
        sdk: { request } as unknown as Client,
        dataSourceId: "db-1",
        targets: plan.delete_properties.filter(
          (property) => property.name === "Momentum",
        ),
        properties: { Momentum: null },
        beforePatch,
      }),
    ).rejects.toThrow("property identity changed");
    expect(request).not.toHaveBeenCalled();
    expect(beforePatch).not.toHaveBeenCalled();
  });

  test("matching provider identity marks the effect immediately before patch", async () => {
    const schema = migrationSchema();
    const plan = schemaMigrationPlan("db-1", schema);
    const request = vi.fn().mockResolvedValue({});
    const beforePatch = vi.fn();

    await patchPropertiesWithIdentityCheck({
      api: {
        retrieveDataSource: vi.fn().mockResolvedValue({
          id: "db-1",
          title: "Fixture",
          titlePropertyName: "Name",
          properties: schema,
        }),
      },
      sdk: { request } as unknown as Client,
      dataSourceId: "db-1",
      targets: plan.delete_properties.filter(
        (property) => property.name === "Momentum",
      ),
      properties: { Momentum: null },
      beforePatch,
    });
    expect(beforePatch).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("exact Notion hygiene effects and readback", () => {
  const ids = {
    canonical: "11111111-1111-4111-8111-111111111111",
    duplicate: "22222222-2222-4222-8222-222222222222",
    projectA: "33333333-3333-4333-8333-333333333333",
    projectB: "44444444-4444-4444-8444-444444444444",
    projectPage: "55555555-5555-4555-8555-555555555555",
    unrelated: "66666666-6666-4666-8666-666666666666",
  };

  function hygieneFixture(canonicalMarkdown = "# Approved merged notes") {
    const canonical = page(ids.canonical, "Tool", {
      "Linked Local Projects": {
        type: "relation",
        relation: [{ id: ids.projectA }],
      },
      "Last Reviewed": { type: "date", date: { start: "2026-07-16" } },
    });
    const duplicate = page(ids.duplicate, "Tool", {
      "Linked Local Projects": {
        type: "relation",
        relation: [{ id: ids.projectB }],
      },
    });
    const project = page(ids.projectPage, "Project", {
      "Tool Stack Records": {
        type: "relation",
        relation: [{ id: ids.duplicate }, { id: ids.unrelated }],
      },
    });
    const plan = supportDatabaseHygienePlan({
      today: "2026-07-17",
      dataSourceIds: ["projects-db", "tools-db"],
      projectPages: [project],
      plans: [
        {
          kind: "tool",
          title: "Tool",
          titlePropertyName: "Name",
          canonicalPage: canonical,
          canonicalMarkdown,
          duplicatePages: [duplicate],
          duplicateMarkdowns: new Map([
            [ids.canonical, "# Old notes"],
            [ids.duplicate, canonicalMarkdown],
          ]),
          mergedProjectIds: [ids.projectA, ids.projectB],
          projectIdsNeedingRewrite: [ids.projectPage],
        },
      ],
      lowRiskArchiveCandidates: [],
      forcedNearDuplicateMergePlans: [],
      dataSourceIdByKind: {
        research: "research-db",
        skill: "skills-db",
        tool: "tools-db",
      },
    });
    return { canonical, duplicate, project, plan };
  }

  test("approval binds exact properties, relations, markdown, and effect count", () => {
    const approved = hygieneFixture("# Approved merged notes").plan;
    const changed = hygieneFixture("# Unreviewed replacement").plan;

    expect(planDigest(changed)).not.toBe(planDigest(approved));
    expect(approved.effect_count).toBe(4);
    expect(approved.pre_archive_effects).toHaveLength(3);
    expect(approved.archive_effects).toHaveLength(1);
    expect(approved.effect_count).toBe(
      approved.pre_archive_effects.length + approved.archive_effects.length,
    );
  });

  test("archive approval binds complete reviewed provider prestate", () => {
    const archiveTarget = page(
      "77777777-7777-4777-8777-777777777777",
      "Sparse sandbox note",
      {
        "Linked Local Projects": {
          id: "provider-relation",
          type: "relation",
          relation: [],
        },
        Classification: {
          type: "select",
          select: { name: "temporary" },
        },
      },
    );
    const renderPlan = (markdown: string, classification: string) =>
      supportDatabaseHygienePlan({
        today: "2026-07-17",
        dataSourceIds: ["tools-db"],
        projectPages: [],
        plans: [],
        lowRiskArchiveCandidates: [
          {
            kind: "tool",
            id: archiveTarget.id,
            title: archiveTarget.title,
            precondition: hygieneArchivePrecondition({
              page: {
                ...archiveTarget,
                properties: {
                  ...archiveTarget.properties,
                  Classification: {
                    type: "select",
                    select: { name: classification },
                  },
                },
              },
              parentDataSourceId: "tools-db",
              markdown,
            }),
          },
        ],
        forcedNearDuplicateMergePlans: [],
        dataSourceIdByKind: {
          research: "research-db",
          skill: "skills-db",
          tool: "tools-db",
        },
      });

    const approved = renderPlan("# Sparse disposable note", "temporary");
    const changed = renderPlan(
      "# Incident evidence\n\nPreserve this record.",
      "evidence",
    );

    expect(approved.archive_preconditions).toHaveLength(1);
    expect(approved.archive_preconditions[0]).toMatchObject({
      page_id: archiveTarget.id,
      parent_data_source_id: "tools-db",
      last_edited_time: archiveTarget.lastEditedTime,
      state_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(planDigest(changed)).not.toBe(planDigest(approved));
  });

  test("changed provider prestate is denied immediately before archive", async () => {
    const archiveTarget = page(
      "77777777-7777-4777-8777-777777777777",
      "Sparse sandbox note",
      {
        "Linked Local Projects": {
          id: "provider-relation",
          type: "relation",
          relation: [],
        },
        Classification: {
          type: "select",
          select: { name: "temporary" },
        },
      },
    );
    const plan = supportDatabaseHygienePlan({
      today: "2026-07-17",
      dataSourceIds: ["tools-db"],
      projectPages: [],
      plans: [],
      lowRiskArchiveCandidates: [
        {
          kind: "tool",
          id: archiveTarget.id,
          title: archiveTarget.title,
          precondition: hygieneArchivePrecondition({
            page: archiveTarget,
            parentDataSourceId: "tools-db",
            markdown: "# Sparse disposable note",
          }),
        },
      ],
      forcedNearDuplicateMergePlans: [],
      dataSourceIdByKind: {
        research: "research-db",
        skill: "skills-db",
        tool: "tools-db",
      },
    });
    const applied: string[] = [];
    const changedProperties = {
      ...archiveTarget.properties,
      Classification: {
        type: "select",
        select: { name: "evidence" },
      },
      "Legal Hold": { type: "checkbox", checkbox: true },
    };
    const api = {
      retrievePageState: vi.fn().mockResolvedValue({
        id: archiveTarget.id,
        url: archiveTarget.url,
        title: archiveTarget.title,
        parentDataSourceId: "tools-db",
        lastEditedTime: "2026-07-17T12:01:00.000Z",
        properties: changedProperties,
      }),
      retrievePagePropertyItems: vi.fn(),
      readPageMarkdown: vi.fn().mockResolvedValue({
        markdown: "# Incident evidence\n\nPreserve this record.",
        raw: {},
        truncated: false,
        unknownBlockIds: [],
      }),
    };

    await expect(
      executeSupportDatabaseHygieneEffects({
        plan,
        applyEffect: async (effect) => {
          applied.push(`${effect.kind}:${effect.page_id}`);
        },
        verifyPreArchiveEffect: async () => {},
        verifyArchivePrecondition: (effect) =>
          assertHygieneArchivePrecondition({ api, plan, effect }),
        verifyState: async () => ({
          ok: true,
          checks: {
            archive_ids_absent: true,
            canonical_properties_exact: true,
            canonical_markdown_exact: true,
            project_relations_exact: true,
            duplicate_relations_absent: true,
          },
        }),
      }),
    ).rejects.toThrow("changed after approval");
    expect(applied).toEqual([]);

    const approvedApi = {
      retrievePageState: vi.fn().mockResolvedValue({
        id: archiveTarget.id,
        url: archiveTarget.url,
        title: archiveTarget.title,
        parentDataSourceId: "tools-db",
        lastEditedTime: archiveTarget.lastEditedTime,
        properties: archiveTarget.properties,
      }),
      retrievePagePropertyItems: vi.fn(),
      readPageMarkdown: vi.fn().mockResolvedValue({
        markdown: "# Sparse disposable note",
        raw: {},
        truncated: false,
        unknownBlockIds: [],
      }),
    };
    await expect(
      executeSupportDatabaseHygieneEffects({
        plan,
        applyEffect: async (effect) => {
          applied.push(`${effect.kind}:${effect.page_id}`);
        },
        verifyPreArchiveEffect: async () => {},
        verifyArchivePrecondition: (effect) =>
          assertHygieneArchivePrecondition({
            api: approvedApi,
            plan,
            effect,
          }),
        verifyState: async () => ({
          ok: true,
          checks: {
            archive_ids_absent: true,
            canonical_properties_exact: true,
            canonical_markdown_exact: true,
            project_relations_exact: true,
            duplicate_relations_absent: true,
          },
        }),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(applied).toEqual([`archive_page:${archiveTarget.id}`]);
  });

  test("paginated relation hydration preserves hidden survivors and exposes hidden archives", async () => {
    const relationId = (index: number) =>
      `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const stablePrefix = Array.from({ length: 24 }, (_, index) =>
      relationId(index + 1),
    );
    const hiddenSurvivor = relationId(25);
    const completeIds = [...stablePrefix, ids.duplicate, hiddenSurvivor];
    const retrievePagePropertyItems = vi
      .fn()
      .mockResolvedValueOnce({
        relationIds: completeIds.slice(0, 25),
        hasMore: true,
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        relationIds: completeIds.slice(25),
        hasMore: false,
      });
    const [hydratedProject] = await hydrateCompleteRelationProperties(
      { retrievePagePropertyItems },
      [
        page(ids.projectPage, "Project", {
          "Tool Stack Records": {
            id: "provider-relation-id",
            type: "relation",
            relation: completeIds.slice(0, 25).map((id) => ({ id })),
            has_more: true,
          },
        }),
      ],
    );
    expect(retrievePagePropertyItems).toHaveBeenCalledTimes(2);
    expect(hydratedProject).toBeDefined();
    if (!hydratedProject) {
      throw new Error("fixture hydration did not return the project page");
    }
    expect(
      hydratedProject?.properties["Tool Stack Records"]?.relation?.map(
        (entry) => entry.id,
      ),
    ).toEqual(completeIds);

    const canonical = page(ids.canonical, "Tool", {
      "Linked Local Projects": { type: "relation", relation: [] },
    });
    const duplicate = page(ids.duplicate, "Tool", {
      "Linked Local Projects": { type: "relation", relation: [] },
    });
    const plan = supportDatabaseHygienePlan({
      today: "2026-07-17",
      dataSourceIds: ["projects-db", "tools-db"],
      projectPages: [hydratedProject],
      plans: [
        {
          kind: "tool",
          title: "Tool",
          titlePropertyName: "Name",
          canonicalPage: canonical,
          canonicalMarkdown: "# Tool",
          duplicatePages: [duplicate],
          duplicateMarkdowns: new Map([
            [canonical.id, "# Tool"],
            [duplicate.id, "# Duplicate"],
          ]),
          mergedProjectIds: [],
          projectIdsNeedingRewrite: [hydratedProject.id],
        },
      ],
      lowRiskArchiveCandidates: [],
      forcedNearDuplicateMergePlans: [],
      dataSourceIdByKind: {
        research: "research-db",
        skill: "skills-db",
        tool: "tools-db",
      },
    });
    const rewrite = plan.pre_archive_effects.find(
      (effect) =>
        effect.kind === "update_properties" &&
        effect.page_id === hydratedProject.id,
    );
    expect(rewrite).toMatchObject({ kind: "update_properties" });
    if (!rewrite) {
      throw new Error("fixture plan did not contain the project rewrite");
    }
    const replacement = (
      rewrite as Extract<
        (typeof plan.pre_archive_effects)[number],
        { kind: "update_properties" }
      >
    ).properties["Tool Stack Records"] as {
      relation: Array<{ id: string }>;
    };
    expect(replacement.relation.map((entry) => entry.id)).toContain(
      hiddenSurvivor,
    );
    expect(replacement.relation.map((entry) => entry.id)).not.toContain(
      ids.duplicate,
    );
    expect(replacement.relation.map((entry) => entry.id)).toContain(
      ids.canonical,
    );
    expect(
      (
        rewrite as Extract<
          (typeof plan.pre_archive_effects)[number],
          { kind: "update_properties" }
        >
      ).relation_preconditions,
    ).toEqual({
      "Tool Stack Records": [...completeIds].sort(),
    });

    const changedCompleteIds = [
      ...completeIds.slice(0, 25),
      ids.unrelated,
    ];
    const staleApi = {
      retrievePageState: vi.fn().mockResolvedValue({
        id: hydratedProject.id,
        url: hydratedProject.url,
        title: hydratedProject.title,
        lastEditedTime: "2026-07-17T12:01:00.000Z",
        properties: {
          "Tool Stack Records": {
            id: "provider-relation-id",
            type: "relation",
            relation: changedCompleteIds.slice(0, 25).map((id) => ({ id })),
            has_more: true,
          },
        },
      }),
      retrievePagePropertyItems: vi
        .fn()
        .mockResolvedValueOnce({
          relationIds: changedCompleteIds.slice(0, 25),
          hasMore: true,
          nextCursor: "changed-cursor-2",
        })
        .mockResolvedValueOnce({
          relationIds: changedCompleteIds.slice(25),
          hasMore: false,
        }),
      readPageMarkdown: vi.fn(),
    };
    const attempted: string[] = [];
    await expect(
      executeSupportDatabaseHygieneEffects({
        plan: {
          ...plan,
          archive_page_ids: [],
          effect_count: 1,
          pre_archive_effects: [rewrite],
          archive_effects: [],
          archive_preconditions: [],
        },
        applyEffect: async (effect) => {
          attempted.push(`${effect.kind}:${effect.page_id}`);
        },
        verifyPreArchiveEffect: (effect) =>
          assertHygieneEffectPrecondition({ api: staleApi, effect }),
        verifyArchivePrecondition: async () => {},
        verifyState: async () => ({
          ok: true,
          checks: {
            archive_ids_absent: true,
            canonical_properties_exact: true,
            canonical_markdown_exact: true,
            project_relations_exact: true,
            duplicate_relations_absent: true,
          },
        }),
      }),
    ).rejects.toThrow("changed after approval");
    expect(attempted).toEqual([]);

    const readback = verifySupportDatabaseHygieneState({
      plan,
      visiblePages: [
        page(ids.projectPage, "Project", {
          "Tool Stack Records": {
            id: "provider-relation-id",
            type: "relation",
            relation: [...stablePrefix, hiddenSurvivor, ids.duplicate].map(
              (id) => ({ id }),
            ),
            has_more: false,
          },
        }),
      ],
      markdownByPageId: new Map(),
      requireArchivesAbsent: true,
    });
    expect(readback.checks.duplicate_relations_absent).toBe(false);
    expect(readback.ok).toBe(false);
  });

  test("incomplete relation without a provider property id fails closed", async () => {
    await expect(
      hydrateCompleteRelationProperties(
        { retrievePagePropertyItems: vi.fn() },
        [
          page(ids.projectPage, "Project", {
            "Tool Stack Records": {
              type: "relation",
              relation: [{ id: ids.duplicate }],
              has_more: true,
            },
          }),
        ],
      ),
    ).rejects.toThrow("has no provider property id");
  });

  test("provider relation-property pagination preserves cursor and relation ids", async () => {
    const relationId = "70000000-0000-4000-8000-000000000001";
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          results: [{ type: "relation", relation: { id: relationId } }],
          has_more: true,
          next_cursor: "cursor-2",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = new DirectNotionClient("fixture-token", undefined, {
      maxAttempts: 1,
    });

    await expect(
      api.retrievePagePropertyItems({
        pageId: ids.projectPage,
        propertyId: "provider relation/id",
        startCursor: "cursor-1",
      }),
    ).resolves.toEqual({
      relationIds: [relationId],
      hasMore: true,
      nextCursor: "cursor-2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.notion.com/v1/pages/${ids.projectPage}/properties/provider%20relation%2Fid?page_size=100&start_cursor=cursor-1`,
      expect.objectContaining({ method: "GET" }),
    );
    await api.retrievePagePropertyItems({
      pageId: ids.projectPage,
      propertyId: "provider%20relation%2Fid",
      startCursor: "cursor-1",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api.notion.com/v1/pages/${ids.projectPage}/properties/provider%20relation%2Fid?page_size=100&start_cursor=cursor-1`,
    );
  });

  test("incomplete canonical and project state cannot satisfy success readback", () => {
    const { plan } = hygieneFixture();
    const result = verifySupportDatabaseHygieneState({
      plan,
      visiblePages: [
        page(ids.canonical, "Tool", {
          "Linked Local Projects": {
            type: "relation",
            relation: [{ id: ids.projectA }],
          },
          "Last Reviewed": {
            type: "date",
            date: { start: "2026-07-17" },
          },
        }),
        page(ids.projectPage, "Project", {
          "Tool Stack Records": {
            type: "relation",
            relation: [{ id: ids.unrelated }],
          },
        }),
      ],
      markdownByPageId: new Map([
        [ids.canonical, "# Old notes"],
      ]),
      requireArchivesAbsent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.canonical_properties_exact).toBe(false);
    expect(result.checks.canonical_markdown_exact).toBe(false);
    expect(result.checks.project_relations_exact).toBe(false);
  });

  test("failed pre-archive readback withholds every archive effect", async () => {
    const { plan } = hygieneFixture();
    const applied: string[] = [];

    await expect(
      executeSupportDatabaseHygieneEffects({
        plan,
        applyEffect: async (effect) => {
          applied.push(`${effect.kind}:${effect.page_id}`);
        },
        verifyPreArchiveEffect: async () => {},
        verifyArchivePrecondition: async () => {},
        verifyState: async (requireArchivesAbsent) => ({
          ok: requireArchivesAbsent,
          checks: {
            archive_ids_absent: requireArchivesAbsent,
            canonical_properties_exact: false,
            canonical_markdown_exact: false,
            project_relations_exact: false,
          },
        }),
      }),
    ).rejects.toThrow("pre-archive readback");
    expect(applied.some((entry) => entry === `archive_page:${ids.duplicate}`)).toBe(false);
  });

  test("claimed hygiene partial effects emit outcome_unknown before rethrow", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receiptDirectory = path.join(directory, "receipts");
    const { plan } = hygieneFixture();
    const envelope = envelopeFor({
      actionId: "fixture-notion-hygiene-partial-0001",
      actionKind: "notion.support_database_hygiene",
      targets: {
        data_source_ids: plan.data_source_ids,
        page_ids: plan.target_page_ids,
      },
      sourceRevision: "hygiene:v2",
      plan,
      effects: plan.effect_count,
      deletions: plan.archive_page_ids.length,
      readback: [
        "archive_ids_absent",
        "canonical_properties_exact",
        "canonical_markdown_exact",
        "project_relations_exact",
        "duplicate_relations_absent",
        "archive_preconditions_matched",
        "relation_properties_complete",
      ],
    });
    const failure = createClaimedActionFailureRecorder({
      envelope,
      target: envelope.canonical_targets,
      providerReference: `notion:hygiene:${envelope.provider_idempotency_key}`,
      receiptDir: receiptDirectory,
    });

    await expect(
      (async () => {
        try {
          await executeSupportDatabaseHygieneEffects({
            plan,
            applyEffect: async () => {
              failure.markEffectAttempted();
            },
            verifyPreArchiveEffect: async () => {},
            verifyArchivePrecondition: async () => {},
            verifyState: async (requireArchivesAbsent) => ({
              ok: requireArchivesAbsent,
              checks: {
                archive_ids_absent: requireArchivesAbsent,
                canonical_properties_exact: false,
                canonical_markdown_exact: false,
                project_relations_exact: false,
              },
            }),
          });
        } catch (error) {
          failure.fail(error, "hygiene_effect_or_readback");
        }
      })(),
    ).rejects.toThrow("pre-archive readback");
    const receipt = JSON.parse(
      readFileSync(
        path.join(receiptDirectory, `${envelope.action_id}.receipt.json`),
        "utf8",
      ),
    );
    expect(receipt).toMatchObject({
      action_id: envelope.action_id,
      terminal_outcome: "outcome_unknown",
      readback_result: {
        effect_attempted: true,
        effect_count_attempted: plan.pre_archive_effects.length,
        failure_phase: "hygiene_effect_or_readback",
        error_category: "AppError",
      },
    });
  });

  test("complete provider state permits the exact approved effects", async () => {
    const { plan } = hygieneFixture();
    const applied: string[] = [];
    let verificationCount = 0;
    const exactReadback = verifySupportDatabaseHygieneState({
      plan,
      visiblePages: [
        page(ids.canonical, "Tool", {
          "Linked Local Projects": {
            type: "relation",
            relation: [{ id: ids.projectA }, { id: ids.projectB }],
          },
          "Last Reviewed": {
            type: "date",
            date: { start: "2026-07-17" },
          },
        }),
        page(ids.projectPage, "Project", {
          "Tool Stack Records": {
            type: "relation",
            relation: [{ id: ids.unrelated }, { id: ids.canonical }],
          },
        }),
      ],
      markdownByPageId: new Map([
        [ids.canonical, "# Approved merged notes"],
      ]),
      requireArchivesAbsent: true,
    });
    expect(exactReadback.ok).toBe(true);

    const result = await executeSupportDatabaseHygieneEffects({
      plan,
      applyEffect: async (effect) => {
        applied.push(`${effect.kind}:${effect.page_id}`);
      },
      verifyPreArchiveEffect: async () => {},
      verifyArchivePrecondition: async () => {},
      verifyState: async () => {
        verificationCount += 1;
        return {
          ok: true,
          checks: {
            archive_ids_absent: true,
            canonical_properties_exact: true,
            canonical_markdown_exact: true,
            project_relations_exact: true,
          },
        };
      },
    });

    expect(applied).toHaveLength(plan.effect_count);
    expect(applied.at(-1)).toBe(`archive_page:${ids.duplicate}`);
    expect(verificationCount).toBe(2);
    expect(result.checks.canonical_markdown_exact).toBe(true);
  });

  test("successful hygiene simulation emits a stable plan-bound receipt", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const receiptDirectory = path.join(directory, "receipts");
    const { plan } = hygieneFixture();
    const envelope = envelopeFor({
      actionId: "fixture-notion-hygiene-0001",
      actionKind: "notion.support_database_hygiene",
      targets: {
        data_source_ids: plan.data_source_ids,
        page_ids: plan.target_page_ids,
      },
      sourceRevision: "hygiene:v2",
      plan,
      effects: plan.effect_count,
      deletions: plan.archive_page_ids.length,
      readback: [
        "archive_ids_absent",
        "canonical_properties_exact",
        "canonical_markdown_exact",
        "project_relations_exact",
        "duplicate_relations_absent",
        "archive_preconditions_matched",
        "relation_properties_complete",
      ],
    });
    const readback = {
      archive_ids_absent: true,
      canonical_properties_exact: true,
      canonical_markdown_exact: true,
      project_relations_exact: true,
      duplicate_relations_absent: true,
      archive_preconditions_matched: true,
      relation_properties_complete: true,
    };

    validateEnvelope({
      envelope,
      actionKind: "notion.support_database_hygiene",
      canonicalTargets: envelope.canonical_targets,
      sourceRevision: "hygiene:v2",
      plan,
      effectCount: plan.effect_count,
      deletionCount: plan.archive_page_ids.length,
      requiredReadback: envelope.required_readback,
    });
    const receiptPath = emitReceipt({
      envelope,
      target: envelope.canonical_targets,
      providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
      readbackResult: readback,
      terminalOutcome: "succeeded",
      receiptDir: receiptDirectory,
    });
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<
      string,
      unknown
    >;

    expect(receipt).toMatchObject({
      action_id: envelope.action_id,
      target: envelope.canonical_targets,
      artifact_digest: planDigest(plan),
      provider_reference: `fixture:notion:${envelope.provider_idempotency_key}`,
      readback_result: readback,
      terminal_outcome: "succeeded",
    });
    expect(
      emitReceipt({
        envelope,
        target: envelope.canonical_targets,
        providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
        readbackResult: readback,
        terminalOutcome: "succeeded",
        receiptDir: receiptDirectory,
      }),
    ).toBe(receiptPath);
  });
});
