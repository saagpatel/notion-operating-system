import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const POINTER_SCHEMA = "PortfolioGenerationPointerV1";
const MANIFEST_SCHEMA = "PortfolioGenerationManifestV1";
const GENERATION_CONTRACT = "portfolio_generation_v1";
const GENERATION_ID = /^portfolio-generation-[0-9a-f]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const DEFAULT_PORTFOLIO_GENERATION_ROOT = path.join(
	os.homedir(),
	".local",
	"state",
	"portfolio-generations",
);

type JsonObject = Record<string, unknown>;

interface PointerEntry {
	generation_id: string;
	manifest_sha256: string;
}

interface ArtifactRecord {
	name: string;
	path: string;
	sha256: string;
	size_bytes: number;
	media_type: string;
	contract_version: string;
}

export interface PortfolioTruthReadback {
	payload: JsonObject;
	artifactSha256: string;
	generationId: string | null;
	manifestSha256: string | null;
	authoritative: boolean;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(bytes: Buffer, label: string): JsonObject {
	const value: unknown = JSON.parse(bytes.toString("utf8"));
	if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
	return value;
}

function exactKeys(value: JsonObject, expected: string[], label: string): void {
	const observed = Object.keys(value).sort();
	const required = [...expected].sort();
	if (observed.join("\0") !== required.join("\0")) {
		throw new Error(`${label} fields are invalid`);
	}
}

function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJson(item)).join(",")}]`;
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as JsonObject).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

async function readRegular(filePath: string, label: string): Promise<Buffer> {
	const metadata = await lstat(filePath);
	if (metadata.isSymbolicLink() || !metadata.isFile()) {
		throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
	}
	return readFile(filePath);
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function pointerEntry(value: unknown, label: string): PointerEntry {
	if (!isObject(value)) throw new Error(`pointer ${label} must be a JSON object`);
	exactKeys(value, ["generation_id", "manifest_sha256"], `pointer ${label}`);
	const generationId = requiredText(
		value.generation_id,
		`pointer ${label}.generation_id`,
	);
	const manifestSha256 = requiredText(
		value.manifest_sha256,
		`pointer ${label}.manifest_sha256`,
	);
	if (!GENERATION_ID.test(generationId) || !SHA256.test(manifestSha256)) {
		throw new Error(`pointer ${label} identity is invalid`);
	}
	return { generation_id: generationId, manifest_sha256: manifestSha256 };
}

function artifactRecord(value: unknown, index: number): ArtifactRecord {
	if (!isObject(value)) {
		throw new Error(`manifest.artifacts[${index}] must be a JSON object`);
	}
	exactKeys(
		value,
		["name", "path", "sha256", "size_bytes", "media_type", "contract_version"],
		`manifest.artifacts[${index}]`,
	);
	const record = {
		name: requiredText(value.name, `manifest.artifacts[${index}].name`),
		path: requiredText(value.path, `manifest.artifacts[${index}].path`),
		sha256: requiredText(value.sha256, `manifest.artifacts[${index}].sha256`),
		size_bytes: value.size_bytes,
		media_type: requiredText(
			value.media_type,
			`manifest.artifacts[${index}].media_type`,
		),
		contract_version: requiredText(
			value.contract_version,
			`manifest.artifacts[${index}].contract_version`,
		),
	};
	if (
		record.path !== record.name ||
		path.basename(record.name) !== record.name ||
		!SHA256.test(record.sha256) ||
		typeof record.size_bytes !== "number" ||
		!Number.isSafeInteger(record.size_bytes) ||
		record.size_bytes < 0
	) {
		throw new Error(`manifest.artifacts[${index}] identity is invalid`);
	}
	return record as ArtifactRecord;
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

export async function readPortfolioTruth(options: {
	generationRoot?: string;
	legacyPath: string;
}): Promise<PortfolioTruthReadback> {
	const generationRoot =
		options.generationRoot ??
		process.env.PORTFOLIO_GENERATION_ROOT ??
		process.env.PERSONAL_OPS_PORTFOLIO_GENERATION_ROOT ??
		DEFAULT_PORTFOLIO_GENERATION_ROOT;
	const pointerPath = path.join(generationRoot, "pointer.json");

	let pointerBytes: Buffer;
	try {
		pointerBytes = await readRegular(
			pointerPath,
			"portfolio generation pointer",
		);
	} catch (error) {
		if (!isMissing(error)) throw error;
		const legacyBytes = await readRegular(
			options.legacyPath,
			"legacy portfolio truth",
		);
		return {
			payload: parseObject(legacyBytes, "legacy portfolio truth"),
			artifactSha256: sha256(legacyBytes),
			generationId: null,
			manifestSha256: null,
			authoritative: false,
		};
	}

	const pointer = parseObject(pointerBytes, "portfolio generation pointer");
	exactKeys(
		pointer,
		["schema_version", "current", "previous", "updated_at"],
		"portfolio generation pointer",
	);
	if (pointer.schema_version !== POINTER_SCHEMA) {
		throw new Error("portfolio generation pointer schema mismatch");
	}
	requiredText(pointer.updated_at, "portfolio generation pointer.updated_at");
	const current = pointerEntry(pointer.current, "current");
	if (pointer.previous !== null) {
		const previous = pointerEntry(pointer.previous, "previous");
		if (
			previous.generation_id === current.generation_id &&
			previous.manifest_sha256 === current.manifest_sha256
		) {
			throw new Error("current and previous portfolio generations are identical");
		}
	}

	const generationDir = path.join(
		generationRoot,
		"releases",
		current.generation_id,
	);
	const generationMetadata = await lstat(generationDir);
	if (generationMetadata.isSymbolicLink() || !generationMetadata.isDirectory()) {
		throw new Error("portfolio generation directory is not immutable");
	}
	const manifestBytes = await readRegular(
		path.join(generationDir, "manifest.json"),
		"portfolio generation manifest",
	);
	if (sha256(manifestBytes) !== current.manifest_sha256) {
		throw new Error("portfolio generation manifest hash mismatch");
	}
	const manifest = parseObject(manifestBytes, "portfolio generation manifest");
	exactKeys(
		manifest,
		[
			"schema_version",
			"contract_version",
			"generation_id",
			"content_identity_sha256",
			"created_at",
			"prior_generation",
			"artifacts",
			"producer",
			"github_security",
		],
		"portfolio generation manifest",
	);
	if (
		manifest.schema_version !== MANIFEST_SCHEMA ||
		manifest.contract_version !== GENERATION_CONTRACT ||
		manifest.generation_id !== current.generation_id
	) {
		throw new Error("portfolio generation manifest identity mismatch");
	}
	const identity = requiredText(
		manifest.content_identity_sha256,
		"manifest.content_identity_sha256",
	);
	if (
		!SHA256.test(identity) ||
		current.generation_id !== `portfolio-generation-${identity.slice(0, 16)}`
	) {
		throw new Error("portfolio generation id is not content-derived");
	}
	const { generation_id: _generationId, content_identity_sha256: _identity, ...core } =
		manifest;
	if (sha256(`${stableJson(core)}\n`) !== identity) {
		throw new Error("portfolio generation content identity mismatch");
	}
	if (!Array.isArray(manifest.artifacts)) {
		throw new Error("portfolio generation manifest artifacts are missing");
	}
	const records = manifest.artifacts.map(artifactRecord);
	if (new Set(records.map((item) => item.name)).size !== records.length) {
		throw new Error("portfolio generation manifest contains duplicate artifacts");
	}
	for (const candidate of records) {
		if (candidate.media_type !== "application/json") continue;
		const candidateBytes = await readRegular(
			path.join(generationDir, candidate.name),
			"portfolio generation JSON artifact",
		);
		if (
			candidateBytes.length !== candidate.size_bytes ||
			sha256(candidateBytes) !== candidate.sha256
		) {
			throw new Error(
				`portfolio generation artifact integrity mismatch: ${candidate.name}`,
			);
		}
		parseObject(candidateBytes, "portfolio generation JSON artifact");
	}
	const record = records.find((item) => item.name === "portfolio-truth.json");
	if (!record) {
		throw new Error("portfolio generation omits portfolio-truth.json");
	}
	const artifactBytes = await readRegular(
		path.join(generationDir, record.path),
		"portfolio generation artifact",
	);
	if (
		artifactBytes.length !== record.size_bytes ||
		sha256(artifactBytes) !== record.sha256
	) {
		throw new Error("portfolio generation artifact integrity mismatch");
	}

	return {
		payload: parseObject(artifactBytes, "portfolio generation artifact"),
		artifactSha256: record.sha256,
		generationId: current.generation_id,
		manifestSha256: current.manifest_sha256,
		authoritative: true,
	};
}
