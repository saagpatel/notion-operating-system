import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface IrreversibleActionEnvelopeV1 {
  schema: "IrreversibleActionEnvelopeV1";
  action_id: string;
  action_kind: string;
  principal: { id: string; kind: "operator" };
  canonical_targets: Record<string, unknown>;
  source_revision: string;
  artifact_digest: string;
  bounds: { allowed_effect_count: number; max_deletions?: number };
  issued_at: string;
  expires_at: string;
  one_shot: boolean;
  provider_idempotency_key: string;
  preconditions: Record<string, unknown>;
  required_readback: string[];
  receipt_requirements: {
    schema: "IrreversibleActionReceiptV1";
    provider_reference: true;
    readback_result: true;
    terminal_outcome: true;
  };
}

export const NOTION_CLAIM_STATE_DIR =
  "/Users/d/.codex/state/irreversible-actions/notion";
export const NOTION_RECEIPT_DIR =
  "/Users/d/.codex/reports/irreversible-actions/notion/receipts";
const ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ACTION_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]+$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ENVELOPE_FIELDS = [
  "action_id",
  "action_kind",
  "artifact_digest",
  "bounds",
  "canonical_targets",
  "expires_at",
  "issued_at",
  "one_shot",
  "preconditions",
  "principal",
  "provider_idempotency_key",
  "receipt_requirements",
  "required_readback",
  "schema",
  "source_revision",
].sort();
const NOTION_SOURCE_REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

export function assertPathSafeActionId(actionId: string): void {
  if (!ACTION_ID_PATTERN.test(actionId)) {
    throw new Error("approval action_id must be path-safe");
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function planDigest(plan: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;
}

export function sourceRevision(cwd = NOTION_SOURCE_REPO_ROOT): string {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("source revision is unavailable");
  }
  return `git:${revision}`;
}

export function validateEnvelope(input: {
  envelope: IrreversibleActionEnvelopeV1;
  actionKind: string;
  canonicalTargets: Record<string, unknown>;
  sourceRevision: string;
  plan: unknown;
  effectCount: number;
  deletionCount?: number;
  requiredReadback: string[];
  now?: Date;
}): IrreversibleActionEnvelopeV1 {
  const { envelope } = input;
  if (
    canonicalJson(Object.keys(envelope).sort()) !== canonicalJson(ENVELOPE_FIELDS)
  ) {
    throw new Error("approval fields mismatch");
  }
  if (envelope.schema !== "IrreversibleActionEnvelopeV1") {
    throw new Error("approval schema mismatch");
  }
  if (
    typeof envelope.action_id !== "string" ||
    !envelope.action_id ||
    typeof envelope.action_kind !== "string" ||
    !isRecord(envelope.principal) ||
    typeof envelope.principal.id !== "string" ||
    !envelope.principal.id ||
    typeof envelope.provider_idempotency_key !== "string" ||
    !envelope.provider_idempotency_key ||
    typeof envelope.source_revision !== "string" ||
    typeof envelope.artifact_digest !== "string" ||
    !isRecord(envelope.bounds) ||
    !isRecord(envelope.canonical_targets) ||
    Object.keys(envelope.canonical_targets).length === 0 ||
    !isRecord(envelope.preconditions) ||
    Object.keys(envelope.preconditions ?? {}).length === 0 ||
    !isRecord(envelope.receipt_requirements) ||
    !Array.isArray(envelope.required_readback) ||
    envelope.required_readback.length === 0 ||
    envelope.required_readback.some(
      (field) => typeof field !== "string" || !field.trim(),
    ) ||
    new Set(envelope.required_readback).size !== envelope.required_readback.length
  ) {
    throw new Error("approval identity, preconditions, or readback contract is incomplete");
  }
  assertPathSafeActionId(envelope.action_id);
  if (
    Object.keys(envelope.principal).sort().join(",") !== "id,kind" ||
    envelope.principal.id.length > 200
  ) {
    throw new Error("approval principal is malformed");
  }
  if (envelope.principal.kind !== "operator") {
    throw new Error("approval principal kind must be operator");
  }
  if (!ACTION_KIND_PATTERN.test(envelope.action_kind)) {
    throw new Error("approval action_kind format is invalid");
  }
  if (envelope.action_kind !== input.actionKind) {
    throw new Error("approval action_kind mismatch");
  }
  if (canonicalJson(envelope.canonical_targets) !== canonicalJson(input.canonicalTargets)) {
    throw new Error("approval canonical_targets mismatch");
  }
  if (envelope.source_revision !== input.sourceRevision) {
    throw new Error("approval source_revision mismatch");
  }
  if (
    !envelope.source_revision ||
    envelope.source_revision.length > 256 ||
    !DIGEST_PATTERN.test(envelope.artifact_digest)
  ) {
    throw new Error("approval revision or artifact digest is malformed");
  }
  if (envelope.artifact_digest !== planDigest(input.plan)) {
    throw new Error("approval plan digest mismatch");
  }
  if (
    canonicalJson(envelope.required_readback) !==
    canonicalJson(input.requiredReadback)
  ) {
    throw new Error("approval required_readback mismatch");
  }
  if (
    !Number.isInteger(envelope.bounds.allowed_effect_count) ||
    envelope.bounds.allowed_effect_count < 1 ||
    envelope.bounds.allowed_effect_count !== input.effectCount
  ) {
    throw new Error("approval effect bound mismatch");
  }
  if (
    input.deletionCount !== undefined &&
    (envelope.bounds.max_deletions === undefined ||
      !Number.isInteger(envelope.bounds.max_deletions) ||
      envelope.bounds.max_deletions < 0 ||
      envelope.bounds.max_deletions !== input.deletionCount)
  ) {
    throw new Error("approval deletion bound exceeded");
  }
  if (!envelope.one_shot) {
    throw new Error("Notion live mutations require one-shot authority");
  }
  const issued = Date.parse(envelope.issued_at);
  const expires = Date.parse(envelope.expires_at);
  const now = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > 15 * 60 * 1000 ||
    now < issued ||
    now >= expires
  ) {
    throw new Error("approval is expired or has an invalid validity window");
  }
  if (
    envelope.provider_idempotency_key.length < 8 ||
    envelope.provider_idempotency_key.length > 200
  ) {
    throw new Error("approval provider idempotency key is malformed");
  }
  if (
    Object.keys(envelope.receipt_requirements).sort().join(",") !==
      "provider_reference,readback_result,schema,terminal_outcome" ||
    envelope.receipt_requirements?.schema !== "IrreversibleActionReceiptV1" ||
    envelope.receipt_requirements.provider_reference !== true ||
    envelope.receipt_requirements.readback_result !== true ||
    envelope.receipt_requirements.terminal_outcome !== true
  ) {
    throw new Error("approval receipt requirements are incomplete");
  }
  return envelope;
}

export function loadEnvelope(filePath: string): IrreversibleActionEnvelopeV1 {
  const linkStat = lstatSync(filePath);
  if (linkStat.isSymbolicLink()) {
    throw new Error("approval must be a regular non-symlink file");
  }
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error("approval must be a regular non-symlink file");
    }
    requireEffectiveUserOwnership(metadata.uid, "approval");
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("approval permissions must not grant group or other access");
    }
    const parsed = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("approval must be a JSON object");
    }
    return parsed as unknown as IrreversibleActionEnvelopeV1;
  } finally {
    closeSync(descriptor);
  }
}

function requireEffectiveUserOwnership(uid: number, subject: string): void {
  if (typeof process.geteuid === "function" && uid !== process.geteuid()) {
    throw new Error(`${subject} must be owned by the effective user`);
  }
}

function actionRecordPath(
  directory: string,
  actionId: string,
  recordKind: "claim" | "receipt",
): string {
  assertPathSafeActionId(actionId);
  return path.join(directory, `${actionId}.${recordKind}.json`);
}

function readPrivateRecord(filePath: string, subject: string): unknown {
  const link = lstatSync(filePath);
  if (link.isSymbolicLink()) {
    throw new Error(`${subject} must be a regular non-symlink file`);
  }
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error(`${subject} must be a regular non-symlink file`);
    }
    requireEffectiveUserOwnership(metadata.uid, subject);
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`${subject} permissions must not grant group or other access`);
    }
    return JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function requirePrivateAuthorityDirectory(directory: string): string {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).slice(0, -1)) {
    if (!component) {
      continue;
    }
    current = path.join(current, component);
    if (!existsSync(current)) {
      continue;
    }
    const ancestor = lstatSync(current);
    if (ancestor.isSymbolicLink() && ancestor.uid !== 0) {
      throw new Error("authority directory path contains an untrusted symlink");
    }
  }
  if (existsSync(directory)) {
    const link = lstatSync(directory);
    if (link.isSymbolicLink() || !link.isDirectory()) {
      throw new Error("authority path must be a non-symlink directory");
    }
  } else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const link = lstatSync(directory);
  if (link.isSymbolicLink() || !link.isDirectory()) {
    throw new Error("authority path must be a non-symlink directory");
  }
  const metadata = statSync(directory);
  requireEffectiveUserOwnership(metadata.uid, "authority directory");
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("authority directory must not grant group or other access");
  }
  const canonical = realpathSync(directory);
  return canonical;
}

export function claimEnvelope(
  envelope: IrreversibleActionEnvelopeV1,
  stateDir = NOTION_CLAIM_STATE_DIR,
): string {
  const trustedStateDir = requirePrivateAuthorityDirectory(stateDir);
  const claimPath = actionRecordPath(
    trustedStateDir,
    envelope.action_id,
    "claim",
  );
  const descriptor = openSync(claimPath, "wx", 0o600);
  try {
    writeFileSync(
      descriptor,
      `${canonicalJson({
        schema: "IrreversibleActionClaimV1",
        action_id: envelope.action_id,
        action_kind: envelope.action_kind,
        envelope_digest: planDigest(envelope),
        claimed_at: new Date().toISOString(),
      })}\n`,
    );
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(trustedStateDir);
  return claimPath;
}

export function emitReceipt(input: {
  envelope: IrreversibleActionEnvelopeV1;
  target: unknown;
  providerReference: string;
  readbackResult: unknown;
  effectCount: number;
  terminalOutcome: "succeeded" | "failed_before_effect" | "outcome_unknown";
  receiptDir?: string;
}): string {
  const receiptDir = input.receiptDir ?? NOTION_RECEIPT_DIR;
  const trustedReceiptDir = requirePrivateAuthorityDirectory(receiptDir);
  const receiptPath = actionRecordPath(
    trustedReceiptDir,
    input.envelope.action_id,
    "receipt",
  );
  if (!isRecord(input.target) || Object.keys(input.target).length === 0) {
    throw new Error("receipt target must be a non-empty object");
  }
  for (const [field, expected] of Object.entries(input.envelope.canonical_targets)) {
    if (
      !(field in input.target) ||
      canonicalJson(input.target[field]) !== canonicalJson(expected)
    ) {
      throw new Error(`receipt target does not bind canonical target: ${field}`);
    }
  }
  if (!input.providerReference.trim()) {
    throw new Error("receipt provider_reference must be non-empty");
  }
  const readbackResult = input.readbackResult;
  if (!isRecord(readbackResult) || Object.keys(readbackResult).length === 0) {
    throw new Error("receipt readback_result must be a non-empty object");
  }
  const missingReadback = input.envelope.required_readback.filter(
    (field) => !(field in readbackResult),
  );
  if (missingReadback.length > 0) {
    throw new Error(
      `receipt is missing required readback fields: ${missingReadback.join(",")}`,
    );
  }
  if (
    !Number.isInteger(input.effectCount) ||
    input.effectCount < 0 ||
    input.effectCount > input.envelope.bounds.allowed_effect_count
  ) {
    throw new Error("receipt effect_count exceeds envelope authority");
  }
  const receipt = {
    schema: "IrreversibleActionReceiptV1",
    action_id: input.envelope.action_id,
    action_kind: input.envelope.action_kind,
    target: input.target,
    artifact_digest: input.envelope.artifact_digest,
    provider_idempotency_key: input.envelope.provider_idempotency_key,
    provider_reference: input.providerReference,
    readback_result: readbackResult,
    effect_count: input.effectCount,
    terminal_outcome: input.terminalOutcome,
    recorded_at: new Date().toISOString(),
  };
  const temporaryPath = path.join(
    trustedReceiptDir,
    `.receipt-${process.pid}-${randomUUID()}`,
  );
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${canonicalJson(receipt)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    try {
      linkSync(temporaryPath, receiptPath);
      fsyncDirectory(trustedReceiptDir);
      return receiptPath;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const existing = readPrivateRecord(receiptPath, "receipt");
      if (!isRecord(existing)) {
        throw new Error("existing receipt must be a JSON object");
      }
      const { recorded_at: _existingRecordedAt, ...existingComparable } = existing;
      const { recorded_at: _recordedAt, ...receiptComparable } = receipt;
      if (canonicalJson(existingComparable) !== canonicalJson(receiptComparable)) {
        throw new Error("receipt already exists with different terminal evidence");
      }
      return receiptPath;
    }
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

export function createClaimedActionFailureRecorder(input: {
  envelope: IrreversibleActionEnvelopeV1;
  target: unknown;
  providerReference: string;
  receiptDir?: string;
}) {
  let effectCountAttempted = 0;
  return {
    markEffectAttempted(): void {
      effectCountAttempted += 1;
    },
    fail(error: unknown, failurePhase: string): never {
      const normalized =
        error instanceof Error ? error : new Error("Unknown claimed action failure");
      const unavailableReadback = Object.fromEntries(
        input.envelope.required_readback.map((field) => [field, "unavailable"]),
      );
      emitReceipt({
        envelope: input.envelope,
        target: input.target,
        providerReference: input.providerReference,
        readbackResult: {
          ...unavailableReadback,
          effect_attempted: effectCountAttempted > 0,
          effect_count_attempted: effectCountAttempted,
          failure_phase: failurePhase,
          error_category: normalized.name,
        },
        terminalOutcome:
          effectCountAttempted > 0 ? "outcome_unknown" : "failed_before_effect",
        effectCount: effectCountAttempted,
        receiptDir: input.receiptDir,
      });
      throw normalized;
    },
  };
}

export function approvalPath(argv: string[]): string {
  const index = argv.indexOf("--approval");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) {
    throw new Error("--approval <IrreversibleActionEnvelopeV1.json> is required");
  }
  return value;
}
