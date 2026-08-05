import {
  chmodSync,
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
  loadEnvelope,
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
  patchPropertiesWithIdentityCheck,
  schemaMigrationApprovalEnvelope,
  schemaMigrationPlan,
} from "../src/internal/notion-maintenance/schema-migrate.js";
import { assertSupportApprovalBeforeLiveWrites } from "../src/internal/notion-maintenance/github-support-maintenance.js";
import {
  executeSupportDatabaseHygieneEffects,
  supportDatabaseHygienePlan,
  verifySupportDatabaseHygieneState,
} from "../src/internal/notion-maintenance/support-database-hygiene-pass.js";
import type { DataSourcePageRef } from "../src/notion/local-portfolio-control-tower-live.js";
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
}): IrreversibleActionEnvelopeV1 {
  const now = Date.now();
  return {
    schema: "IrreversibleActionEnvelopeV1",
    action_id: input.actionId,
    action_kind: input.actionKind,
    principal: { id: "vitest", kind: "operator" },
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
    provider_idempotency_key: `fixture-${input.actionId}`,
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
  vi.restoreAllMocks();
  delete process.env.IRREVERSIBLE_ACTION_STATE_DIR;
  delete process.env.IRREVERSIBLE_ACTION_RECEIPT_DIR;
});

describe("IrreversibleActionEnvelopeV1 Notion adapter", () => {
  test("action ids cannot escape the claim or receipt namespace", () => {
    const envelope = envelopeFor({
      actionId: "../escape",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
    });
    expect(() =>
      validateEnvelope({
        envelope,
        actionKind: envelope.action_kind,
        canonicalTargets: envelope.canonical_targets,
        sourceRevision: envelope.source_revision,
        plan: { data_source_id: "db-1" },
        effectCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("action_id must be path-safe");

    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    expect(() => claimEnvelope(envelope, path.join(directory, "claims"))).toThrow(
      "action_id must be path-safe",
    );
  });

  test("only an operator principal can authorize a live action", () => {
    const plan = { data_source_id: "db-1" };
    const envelope = envelopeFor({
      actionId: "fixture-notion-principal-0001",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan,
      effects: 1,
    });
    (envelope.principal as { id: string; kind: string }).kind = "automation";

    expect(() =>
      validateEnvelope({
        envelope,
        actionKind: envelope.action_kind,
        canonicalTargets: envelope.canonical_targets,
        sourceRevision: envelope.source_revision,
        plan,
        effectCount: 1,
        requiredReadback: ["provider_state"],
      }),
    ).toThrow("principal kind must be operator");
  });

  test("approval files must be owned by the effective user", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "notion-envelope-"));
    const envelope = envelopeFor({
      actionId: "fixture-notion-owner-0001",
      actionKind: "notion.schema_migrate",
      targets: { data_source_id: "db-1" },
      sourceRevision: "schema-migrate:v2",
      plan: { data_source_id: "db-1" },
      effects: 1,
    });
    const approvalFile = writeEnvelope(directory, envelope);
    const effectiveUid = process.geteuid?.() ?? 0;
    vi.spyOn(process, "geteuid").mockReturnValue(effectiveUid + 1);

    expect(() => loadEnvelope(approvalFile)).toThrow(
      "approval must be owned by the effective user",
    );
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
        effectCount: 1,
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
        effectCount: 1,
        terminalOutcome: "succeeded",
        receiptDir: receipts,
      }),
    ).toThrow("non-symlink directory");
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

  test("dry probe renders exact envelope fields for a chosen action id", async () => {
    const result = await runProbe({
      live: false,
      dataSourceId: "db-1",
      actionId: "fixture-notion-dry-probe-0001",
    });

    expect(result).toMatchObject({
      mode: "side-effect-free",
      approval_envelope: {
        action_kind: "notion.schema_probe",
        canonical_targets: {
          data_source_id: "db-1",
          property_name: "_Probe Build Session Count dryprobe0001",
        },
        bounds: { allowed_effect_count: 2, max_deletions: 1 },
        required_readback: ["property_absent_after_cleanup"],
      },
    });
    expect(
      (result.approval_envelope as { artifact_digest: string }).artifact_digest,
    ).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("combined live support maintenance refuses missing authority before I/O", () => {
    expect(() =>
      assertSupportApprovalBeforeLiveWrites({
        live: true,
        hygieneEffectCount: 1,
      }),
    ).toThrow("before any maintenance write");
    expect(() =>
      assertSupportApprovalBeforeLiveWrites({
        live: true,
        hygieneEffectCount: 0,
      }),
    ).not.toThrow();
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
      effect_count: 2,
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
  return { id, title, url: `https://notion.test/${id}`, properties };
}

describe("exact Notion migration property authority", () => {
  test("dry-run authority fields bind the exact migration plan", () => {
    const plan = schemaMigrationPlan("db-1", migrationSchema());
    const authority = schemaMigrationApprovalEnvelope(
      plan,
      "git:0123456789012345678901234567890123456789",
    );

    expect(authority).toMatchObject({
      action_kind: "notion.schema_migrate",
      canonical_targets: { data_source_id: "db-1" },
      bounds: { allowed_effect_count: 6, max_deletions: 8 },
      required_readback: [
        "deleted_provider_ids_absent",
        "rollup_provider_ids_present",
      ],
    });
    expect(authority.artifact_digest).toBe(planDigest(plan));
  });

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
      "rollup_provider_ids_present",
    ]);
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
      ],
    });
    const readback = {
      archive_ids_absent: true,
      canonical_properties_exact: true,
      canonical_markdown_exact: true,
      project_relations_exact: true,
      duplicate_relations_absent: true,
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
    expect(() =>
      emitReceipt({
        envelope,
        target: envelope.canonical_targets,
        providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
        readbackResult: { archive_ids_absent: true },
        effectCount: plan.effect_count,
        terminalOutcome: "succeeded",
        receiptDir: receiptDirectory,
      }),
    ).toThrow("missing required readback fields");
    expect(() =>
      emitReceipt({
        envelope,
        target: envelope.canonical_targets,
        providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
        readbackResult: readback,
        effectCount: plan.effect_count + 1,
        terminalOutcome: "succeeded",
        receiptDir: receiptDirectory,
      }),
    ).toThrow("effect_count exceeds envelope authority");
    const receiptPath = emitReceipt({
      envelope,
      target: envelope.canonical_targets,
      providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
      readbackResult: readback,
      effectCount: plan.effect_count,
      terminalOutcome: "succeeded",
      receiptDir: receiptDirectory,
    });
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<
      string,
      unknown
    >;

    expect(receipt).toMatchObject({
      action_id: envelope.action_id,
      action_kind: envelope.action_kind,
      target: envelope.canonical_targets,
      artifact_digest: planDigest(plan),
      provider_idempotency_key: envelope.provider_idempotency_key,
      provider_reference: `fixture:notion:${envelope.provider_idempotency_key}`,
      readback_result: readback,
      effect_count: plan.effect_count,
      terminal_outcome: "succeeded",
    });
    expect(receipt.recorded_at).toEqual(expect.any(String));
    expect(
      emitReceipt({
        envelope,
        target: envelope.canonical_targets,
        providerReference: `fixture:notion:${envelope.provider_idempotency_key}`,
        readbackResult: readback,
        effectCount: plan.effect_count,
        terminalOutcome: "succeeded",
        receiptDir: receiptDirectory,
      }),
    ).toBe(receiptPath);
  });
});
