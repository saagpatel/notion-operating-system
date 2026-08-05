import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	link,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rm,
} from "node:fs/promises";
import path from "node:path";

import { AppError } from "../utils/errors.js";

const ENVELOPE_FIELDS = new Set([
	"schema",
	"action_id",
	"action_kind",
	"principal",
	"canonical_targets",
	"source_revision",
	"artifact_digest",
	"bounds",
	"issued_at",
	"expires_at",
	"one_shot",
	"provider_idempotency_key",
	"preconditions",
	"required_readback",
	"receipt_requirements",
]);
const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface IrreversibleActionEnvelope {
	schema: "IrreversibleActionEnvelopeV1";
	action_id: string;
	action_kind: string;
	principal: { id: string; kind: string };
	canonical_targets: Record<string, unknown>;
	source_revision: string;
	artifact_digest: string;
	bounds: Record<string, unknown> & { allowed_effect_count: number };
	issued_at: string;
	expires_at: string;
	one_shot: boolean;
	provider_idempotency_key: string;
	preconditions: Record<string, unknown>;
	required_readback: string[];
	receipt_requirements: Record<string, unknown>;
}

export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function sha256Json(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export async function preparePrivateAuthorityDirectory(
	directory: string,
): Promise<string> {
	const absolute = path.resolve(directory);
	await mkdir(absolute, { recursive: true, mode: 0o700 });
	const metadata = await lstat(absolute);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new AppError("authority path must be a non-symlink directory");
	}
	if ((metadata.mode & 0o077) !== 0) {
		throw new AppError("authority directory must not grant group or other access");
	}
	if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
		throw new AppError("authority directory must be owned by the effective user");
	}
	return realpath(absolute);
}

function exactJson(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new AppError(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

export async function loadAndClaimEnvelope(input: {
	envelopePath: string;
	actionKind: string;
	canonicalTargets: Record<string, unknown>;
	sourceRevision: string;
	artifactDigest: string;
	preconditions: Record<string, unknown>;
	bounds: Record<string, unknown>;
	requiredReadback: string[];
	claimStateDir: string;
	now?: Date;
}): Promise<IrreversibleActionEnvelope> {
	const metadata = await lstat(input.envelopePath);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new AppError("envelope must be a regular non-symlink file");
	}
	if ((metadata.mode & 0o077) !== 0) {
		throw new AppError("envelope must not grant group or other access");
	}
	if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
		throw new AppError("envelope must be owned by the effective user");
	}
	const parsed = JSON.parse(
		await readFile(input.envelopePath, "utf8"),
	) as unknown;
	const payload = requireObject(parsed, "envelope") as unknown as IrreversibleActionEnvelope;
	const keys = Object.keys(payload);
	if (
		keys.length !== ENVELOPE_FIELDS.size ||
		keys.some((key) => !ENVELOPE_FIELDS.has(key))
	) {
		throw new AppError("envelope fields mismatch");
	}
	if (payload.schema !== "IrreversibleActionEnvelopeV1") {
		throw new AppError("envelope schema mismatch");
	}
	if (!ACTION_ID.test(payload.action_id)) {
		throw new AppError("action_id has an invalid format");
	}
	if (payload.action_kind !== input.actionKind) {
		throw new AppError("action kind mismatch");
	}
	if (
		!payload.principal ||
		!["operator", "automation", "service", "test-fixture"].includes(
			payload.principal.kind,
		) ||
		!payload.principal.id?.trim()
	) {
		throw new AppError("principal is invalid");
	}
	if (!exactJson(payload.canonical_targets, input.canonicalTargets)) {
		throw new AppError("canonical targets mismatch");
	}
	if (payload.source_revision !== input.sourceRevision) {
		throw new AppError("source revision mismatch");
	}
	if (!DIGEST.test(payload.artifact_digest)) {
		throw new AppError("artifact digest format is invalid");
	}
	if (payload.artifact_digest !== input.artifactDigest) {
		throw new AppError("artifact digest mismatch");
	}
	if (!exactJson(payload.preconditions, input.preconditions)) {
		throw new AppError("preconditions mismatch");
	}
	if (!exactJson(payload.bounds, input.bounds)) {
		throw new AppError("bounds mismatch");
	}
	if (!exactJson(payload.required_readback, input.requiredReadback)) {
		throw new AppError("required readback mismatch");
	}
	if (
		payload.receipt_requirements?.schema !== "IrreversibleActionReceiptV1" ||
		payload.receipt_requirements.provider_reference !== true ||
		payload.receipt_requirements.readback_result !== true ||
		payload.receipt_requirements.terminal_outcome !== true
	) {
		throw new AppError("receipt requirements mismatch");
	}
	if (
		payload.one_shot !== true ||
		typeof payload.provider_idempotency_key !== "string" ||
		payload.provider_idempotency_key.length < 8
	) {
		throw new AppError("one-shot provider authority is required");
	}
	const issuedAt = new Date(payload.issued_at);
	const expiresAt = new Date(payload.expires_at);
	const now = input.now ?? new Date();
	if (
		Number.isNaN(issuedAt.valueOf()) ||
		Number.isNaN(expiresAt.valueOf()) ||
		expiresAt <= issuedAt ||
		expiresAt.valueOf() - issuedAt.valueOf() > 15 * 60 * 1000 ||
		now < issuedAt ||
		now >= expiresAt
	) {
		throw new AppError("authority is not currently valid");
	}

	const claimDirectory = await preparePrivateAuthorityDirectory(
		input.claimStateDir,
	);
	const claimPath = path.join(claimDirectory, `${payload.action_id}.claim.json`);
	let handle;
	try {
		handle = await open(claimPath, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new AppError("one-shot authority has already been claimed");
		}
		throw error;
	}
	await handle.writeFile(
		`${canonicalJson({
			schema: "IrreversibleActionClaimV1",
			action_id: payload.action_id,
			action_kind: payload.action_kind,
			envelope_digest: sha256Json(payload),
			claimed_at: new Date().toISOString(),
		})}\n`,
	);
	await handle.sync();
	await handle.close();
	await syncDirectory(claimDirectory);
	return payload;
}

export async function emitIrreversibleActionReceipt(input: {
	envelope: IrreversibleActionEnvelope;
	receiptDir: string;
	target: Record<string, unknown>;
	providerReference: string;
	readbackResult: Record<string, unknown>;
	terminalOutcome: "failed_before_effect" | "succeeded" | "outcome_unknown";
	effectCount: number;
}): Promise<string> {
	if (!exactJson(input.target, input.envelope.canonical_targets)) {
		throw new AppError("receipt target does not bind canonical targets");
	}
	if (
		input.envelope.required_readback.some(
			(field) => !(field in input.readbackResult),
		)
	) {
		throw new AppError("receipt is missing required readback");
	}
	if (
		!Number.isInteger(input.effectCount) ||
		input.effectCount < 0 ||
		input.effectCount >
			(input.envelope.bounds.allowed_effect_count as number)
	) {
		throw new AppError("receipt effect count exceeds authority");
	}
	const directory = await preparePrivateAuthorityDirectory(input.receiptDir);
	const receipt = {
		schema: "IrreversibleActionReceiptV1",
		action_id: input.envelope.action_id,
		action_kind: input.envelope.action_kind,
		target: input.target,
		artifact_digest: input.envelope.artifact_digest,
		provider_idempotency_key: input.envelope.provider_idempotency_key,
		provider_reference: input.providerReference,
		readback_result: input.readbackResult,
		effect_count: input.effectCount,
		terminal_outcome: input.terminalOutcome,
		recorded_at: new Date().toISOString(),
	};
	const targetPath = path.join(
		directory,
		`${input.envelope.action_id}.receipt.json`,
	);
	const temporary = path.join(directory, `.receipt-${randomUUID()}`);
	await writePrivateFile(temporary, `${canonicalJson(receipt)}\n`);
	try {
		await link(temporary, targetPath);
		await syncDirectory(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
		const metadata = await lstat(targetPath);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new AppError(
				"existing receipt must be a regular non-symlink file",
			);
		}
		if (
			(metadata.mode & 0o077) !== 0 ||
			(typeof process.getuid === "function" &&
				metadata.uid !== process.getuid())
		) {
			throw new AppError(
				"existing receipt must be owner-private and owned by the effective user",
			);
		}
		const existing = JSON.parse(await readFile(targetPath, "utf8")) as Record<
			string,
			unknown
		>;
		const { recorded_at: _existingTime, ...existingComparable } = existing;
		const { recorded_at: _newTime, ...newComparable } = receipt;
		if (!exactJson(existingComparable, newComparable)) {
			throw new AppError(
				"receipt already exists with different terminal evidence",
			);
		}
	} finally {
		await rm(temporary, { force: true });
	}
	return targetPath;
}

async function writePrivateFile(filePath: string, contents: string): Promise<void> {
	const handle = await open(filePath, "wx", 0o600);
	await handle.writeFile(contents);
	await handle.sync();
	await handle.close();
	await chmod(filePath, 0o600);
}

async function syncDirectory(directory: string): Promise<void> {
	const handle = await open(directory, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
