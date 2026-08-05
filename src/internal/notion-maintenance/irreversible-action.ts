import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface IrreversibleActionEnvelopeV1 {
  schema: "IrreversibleActionEnvelopeV1";
  action_id: string;
  action_kind: string;
  principal: { id: string; kind: string };
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

const OPAQUE_ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requireOpaqueActionId(actionId: unknown): asserts actionId is string {
  if (
    typeof actionId !== "string" ||
    !OPAQUE_ACTION_ID_PATTERN.test(actionId)
  ) {
    throw new Error("approval action_id must be an opaque identifier");
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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function planDigest(plan: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;
}

export function sourceRevision(cwd = process.cwd()): string {
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
  if (envelope.schema !== "IrreversibleActionEnvelopeV1") {
    throw new Error("approval schema mismatch");
  }
  requireOpaqueActionId(envelope.action_id);
  if (
    !envelope.principal?.id ||
    !envelope.provider_idempotency_key ||
    Object.keys(envelope.preconditions ?? {}).length === 0 ||
    !Array.isArray(envelope.required_readback) ||
    envelope.required_readback.length === 0
  ) {
    throw new Error("approval identity, preconditions, or readback contract is incomplete");
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
    envelope.bounds.allowed_effect_count !== input.effectCount
  ) {
    throw new Error("approval effect bound mismatch");
  }
  if (
    input.deletionCount !== undefined &&
    (envelope.bounds.max_deletions === undefined ||
      envelope.bounds.max_deletions < input.deletionCount)
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
  const stat = statSync(filePath);
  if (linkStat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("approval must be a regular non-symlink file");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("approval permissions must not grant group or other access");
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as IrreversibleActionEnvelopeV1;
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
  if (typeof process.geteuid === "function" && metadata.uid !== process.geteuid()) {
    throw new Error("authority directory must be owned by the effective user");
  }
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
  requireOpaqueActionId(envelope.action_id);
  const trustedStateDir = requirePrivateAuthorityDirectory(stateDir);
  const claimPath = path.join(trustedStateDir, `${envelope.action_id}.claim.json`);
  const claimedAt = new Date().toISOString();
  const providerKeyDigest = createHash("sha256")
    .update(envelope.provider_idempotency_key)
    .digest("hex");
  let descriptor: number;
  try {
    descriptor = openSync(claimPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("approval action_id is already claimed");
    }
    throw error;
  }
  try {
    writeFileSync(
      descriptor,
      `${canonicalJson({
        schema: "IrreversibleActionClaimV1",
        action_id: envelope.action_id,
        envelope_digest: planDigest(envelope),
        provider_idempotency_key_digest: `sha256:${providerKeyDigest}`,
        claimed_at: claimedAt,
      })}\n`,
    );
  } finally {
    closeSync(descriptor);
  }

  const providerStateDir = requirePrivateAuthorityDirectory(
    path.join(trustedStateDir, "provider-operations"),
  );
  const providerClaimPath = path.join(
    providerStateDir,
    `${providerKeyDigest}.claim.json`,
  );
  try {
    descriptor = openSync(providerClaimPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        "provider operation is already claimed; reconcile before retry",
      );
    }
    throw error;
  }
  try {
    writeFileSync(
      descriptor,
      `${canonicalJson({
        schema: "IrreversibleProviderOperationClaimV1",
        action_id: envelope.action_id,
        provider_idempotency_key_digest: `sha256:${providerKeyDigest}`,
        status: "claimed",
        claimed_at: claimedAt,
      })}\n`,
    );
  } finally {
    closeSync(descriptor);
  }
  return claimPath;
}

function validateReceiptContract(input: {
  envelope: IrreversibleActionEnvelopeV1;
  providerReference: string;
  readbackResult: unknown;
  terminalOutcome: "succeeded" | "failed_before_effect" | "outcome_unknown";
}): void {
  const requirements = input.envelope.receipt_requirements;
  if (
    requirements?.schema !== "IrreversibleActionReceiptV1" ||
    requirements.provider_reference !== true ||
    requirements.readback_result !== true ||
    requirements.terminal_outcome !== true
  ) {
    throw new Error("approval receipt requirements are incomplete");
  }
  if (
    !Array.isArray(input.envelope.required_readback) ||
    input.envelope.required_readback.length === 0 ||
    input.envelope.required_readback.some(
      (key) => typeof key !== "string" || !key.trim(),
    )
  ) {
    throw new Error("approval required_readback is incomplete");
  }
  if (
    !["succeeded", "failed_before_effect", "outcome_unknown"].includes(
      input.terminalOutcome,
    )
  ) {
    throw new Error("receipt terminal_outcome is invalid");
  }
  if (
    typeof input.providerReference !== "string" ||
    !input.providerReference.trim()
  ) {
    throw new Error("receipt provider_reference is required");
  }
  if (
    input.readbackResult === null ||
    typeof input.readbackResult !== "object" ||
    Array.isArray(input.readbackResult)
  ) {
    throw new Error("receipt readback_result must be an object");
  }
  if (input.terminalOutcome !== "succeeded") {
    return;
  }
  const readback = input.readbackResult as Record<string, unknown>;
  for (const requiredKey of input.envelope.required_readback) {
    if (
      !Object.hasOwn(readback, requiredKey) ||
      readback[requiredKey] !== true
    ) {
      throw new Error(
        `successful receipt does not satisfy required readback: ${requiredKey}`,
      );
    }
  }
}

export function emitReceipt(input: {
  envelope: IrreversibleActionEnvelopeV1;
  target: unknown;
  providerReference: string;
  readbackResult: unknown;
  terminalOutcome: "succeeded" | "failed_before_effect" | "outcome_unknown";
  receiptDir?: string;
}): string {
  requireOpaqueActionId(input.envelope.action_id);
  const receiptDir = input.receiptDir ?? NOTION_RECEIPT_DIR;
  validateReceiptContract(input);
  if (
    canonicalJson(input.target) !==
    canonicalJson(input.envelope.canonical_targets)
  ) {
    throw new Error("receipt target does not match approved canonical targets");
  }
  const trustedReceiptDir = requirePrivateAuthorityDirectory(receiptDir);
  const receiptPath = path.join(
    trustedReceiptDir,
    `${input.envelope.action_id}.receipt.json`,
  );
  const receipt = {
    schema: "IrreversibleActionReceiptV1",
    action_id: input.envelope.action_id,
    target: input.target,
    artifact_digest: input.envelope.artifact_digest,
    provider_reference: input.providerReference,
    provider_idempotency_key_digest: `sha256:${createHash("sha256")
      .update(input.envelope.provider_idempotency_key)
      .digest("hex")}`,
    required_readback: input.envelope.required_readback,
    readback_result: input.readbackResult,
    terminal_outcome: input.terminalOutcome,
  };
  if (existsSync(receiptPath)) {
    const existing = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
    if (canonicalJson(existing) !== canonicalJson(receipt)) {
      throw new Error("receipt already exists with different terminal evidence");
    }
    return receiptPath;
  }
  const descriptor = openSync(receiptPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${canonicalJson(receipt)}\n`);
  } finally {
    closeSync(descriptor);
  }
  return receiptPath;
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
      emitReceipt({
        envelope: input.envelope,
        target: input.target,
        providerReference: input.providerReference,
        readbackResult: {
          effect_attempted: effectCountAttempted > 0,
          effect_count_attempted: effectCountAttempted,
          failure_phase: failurePhase,
          error_category: normalized.name,
        },
        terminalOutcome:
          effectCountAttempted > 0 ? "outcome_unknown" : "failed_before_effect",
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
