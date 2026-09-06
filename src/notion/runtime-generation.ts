import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const REPOSITORY = "saagpatel/notion-operating-system";
const SOURCE_REMOTE = "https://github.com/saagpatel/notion-operating-system.git";
const MANIFEST_SCHEMA = "NotionRuntimeGenerationV1";
const ENTRYPOINT = "dist/src/cli.js";
const EXPORT_MODULE = "dist/src/notion/export-project-snapshot.js";

interface FileRecord {
	kind: "file";
	mode: string;
	sha256: string;
	size: number;
}

interface RuntimeManifest {
	schema: string;
	repository: string;
	source_remote: string;
	source_commit: string;
	source_tree: string;
	package_lock_sha256: string;
	created_at: string;
	entrypoint: string;
	export_module: string;
	files: Record<string, FileRecord | { kind: string }>;
}

interface RuntimePointerEntry {
	source_commit: string;
	manifest_sha256: string;
}

interface RuntimePointer {
	schema: "NotionRuntimePointerV1";
	current: RuntimePointerEntry;
	previous: RuntimePointerEntry | null;
	updated_at: string;
}

export interface RuntimeGenerationIdentity {
	mode: "canonical-checkout" | "immutable-generation";
	sourceModulePath: string;
	manifestPath?: string;
	manifestSha256?: string;
	sourceCommit?: string;
}

export interface RuntimeGenerationVerificationOptions {
	canonicalRoot?: string;
	productionRoot?: string;
	manifestPath?: string;
	manifestSha256?: string;
	pointerPath?: string;
	allowCanonicalCheckout?: boolean;
}

export function verifySnapshotRuntimeSource(
	sourceModulePath: string,
	options: RuntimeGenerationVerificationOptions = {},
): RuntimeGenerationIdentity {
	const canonicalRoot = realpathOrResolved(
		options.canonicalRoot ?? path.join(os.homedir(), "Projects", "Notion"),
	);
	const sourcePath = realpathSync(sourceModulePath);
	if (isWithin(sourcePath, canonicalRoot)) {
		const allowCanonical =
			options.allowCanonicalCheckout ??
			process.env.NOTION_ALLOW_CANONICAL_SNAPSHOT_RUNTIME === "1";
		if (!allowCanonical) {
			throw new Error(
				"Canonical snapshot runtime requires explicit development-only opt-in",
			);
		}
		return { mode: "canonical-checkout", sourceModulePath: sourcePath };
	}

	const manifestInput =
		options.manifestPath ?? process.env.NOTION_RUNTIME_GENERATION_MANIFEST;
	const expectedManifestSha =
		options.manifestSha256 ??
		process.env.NOTION_RUNTIME_GENERATION_MANIFEST_SHA256;
	if (!manifestInput || !expectedManifestSha || !HEX64.test(expectedManifestSha)) {
		throw new Error(
			"Non-canonical snapshot runtime requires an exact generation manifest path and SHA-256",
		);
	}
	const manifestPath = realpathSync(manifestInput);
	if (path.basename(manifestPath) !== "notion-runtime-generation.json") {
		throw new Error("Runtime generation manifest path is not canonical");
	}
	assertOwnedRegularFile(manifestPath, "runtime generation manifest");
	const manifestBytes = readFileSync(manifestPath);
	const manifestSha256 = sha256(manifestBytes);
	if (manifestSha256 !== expectedManifestSha) {
		throw new Error("Runtime generation manifest SHA-256 mismatch");
	}

	let manifest: RuntimeManifest;
	try {
		manifest = JSON.parse(manifestBytes.toString("utf8")) as RuntimeManifest;
	} catch (error) {
		throw new Error(`Runtime generation manifest is invalid JSON: ${String(error)}`);
	}
	const expectedFields = new Set([
		"schema",
		"repository",
		"source_remote",
		"source_commit",
		"source_tree",
		"package_lock_sha256",
		"created_at",
		"entrypoint",
		"export_module",
		"files",
	]);
	if (
		Object.keys(manifest).length !== expectedFields.size ||
		Object.keys(manifest).some((key) => !expectedFields.has(key)) ||
		manifest.schema !== MANIFEST_SCHEMA ||
		manifest.repository !== REPOSITORY ||
		manifest.source_remote !== SOURCE_REMOTE ||
		!HEX40.test(manifest.source_commit) ||
		!HEX40.test(manifest.source_tree) ||
		!HEX64.test(manifest.package_lock_sha256) ||
		manifest.entrypoint !== ENTRYPOINT ||
		manifest.export_module !== EXPORT_MODULE ||
		typeof manifest.files !== "object" ||
		manifest.files === null
	) {
		throw new Error("Runtime generation manifest contract mismatch");
	}
	if (Number.isNaN(Date.parse(manifest.created_at))) {
		throw new Error("Runtime generation manifest created_at is invalid");
	}
	const productionRoot = realpathOrResolved(
		options.productionRoot ??
			"/Users/d/.local/state/notion-operating-system",
	);
	const releaseRoot = path.dirname(manifestPath);
	const expectedRelease = path.join(
		productionRoot,
		"releases",
		manifest.source_commit,
	);
	if (releaseRoot !== expectedRelease) {
		throw new Error(
			`Runtime generation release path mismatch: expected ${expectedRelease}, observed ${releaseRoot}`,
		);
	}
	const expectedSource = path.join(releaseRoot, EXPORT_MODULE);
	if (sourcePath !== expectedSource) {
		throw new Error("Snapshot export module is not the manifest-bound runtime module");
	}
	assertCurrentPointer(
		productionRoot,
		options.pointerPath ?? process.env.NOTION_RUNTIME_GENERATION_POINTER,
		manifest.source_commit,
		manifestSha256,
	);
	const packageLockRecord = manifest.files["package-lock.json"];
	if (
		!packageLockRecord ||
		packageLockRecord.kind !== "file" ||
		!("sha256" in packageLockRecord) ||
		packageLockRecord.sha256 !== manifest.package_lock_sha256
	) {
		throw new Error("Runtime generation package-lock binding mismatch");
	}
	assertCompleteManifestFiles(releaseRoot, manifest.files);
	for (const requiredPath of [EXPORT_MODULE, ENTRYPOINT, "package-lock.json"]) {
		if (!(requiredPath in manifest.files)) {
			throw new Error(`Runtime generation is missing required file: ${requiredPath}`);
		}
	}

	return {
		mode: "immutable-generation",
		sourceModulePath: sourcePath,
		manifestPath,
		manifestSha256,
		sourceCommit: manifest.source_commit,
	};
}

function assertCurrentPointer(
	productionRoot: string,
	pointerInput: string | undefined,
	sourceCommit: string,
	manifestSha256: string,
): void {
	const expectedPointer = path.join(productionRoot, "current.json");
	const pointerPath = realpathSync(pointerInput ?? expectedPointer);
	if (pointerPath !== expectedPointer) {
		throw new Error("Runtime generation pointer path mismatch");
	}
	assertOwnedRegularFile(pointerPath, "runtime generation pointer");
	let pointer: RuntimePointer;
	try {
		pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as RuntimePointer;
	} catch (error) {
		throw new Error(`Runtime generation pointer is invalid JSON: ${String(error)}`);
	}
	const exactEntry = (value: unknown): value is RuntimePointerEntry =>
		typeof value === "object" &&
		value !== null &&
		Object.keys(value).sort().join("\0") ===
			["manifest_sha256", "source_commit"].join("\0") &&
		"source_commit" in value &&
		"manifest_sha256" in value &&
		typeof value.source_commit === "string" &&
		typeof value.manifest_sha256 === "string" &&
		HEX40.test(value.source_commit) &&
		HEX64.test(value.manifest_sha256);
	if (
		Object.keys(pointer).sort().join("\0") !==
			["current", "previous", "schema", "updated_at"].join("\0") ||
		pointer.schema !== "NotionRuntimePointerV1" ||
		!exactEntry(pointer.current) ||
		(pointer.previous !== null && !exactEntry(pointer.previous)) ||
		(pointer.previous !== null &&
			pointer.previous.source_commit === pointer.current.source_commit &&
			pointer.previous.manifest_sha256 === pointer.current.manifest_sha256) ||
		Number.isNaN(Date.parse(pointer.updated_at))
	) {
		throw new Error("Runtime generation pointer contract mismatch");
	}
	if (
		pointer.current.source_commit !== sourceCommit ||
		pointer.current.manifest_sha256 !== manifestSha256
	) {
		throw new Error("Runtime generation is not selected by the current pointer");
	}
}

function assertCompleteManifestFiles(
	releaseRoot: string,
	declared: RuntimeManifest["files"],
): void {
	const observed: string[] = [];
	const walk = (directory: string): void => {
		const directoryInfo = lstatSync(directory);
		if (
			!directoryInfo.isDirectory() ||
			directoryInfo.isSymbolicLink() ||
			directoryInfo.uid !== process.getuid?.() ||
			(directoryInfo.mode & 0o777) !== 0o555
		) {
			throw new Error("Runtime generation directory ownership or mode drift");
		}
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			const relativePath = path.relative(releaseRoot, entryPath).split(path.sep).join("/");
			if (entry.isSymbolicLink()) {
				throw new Error(`Runtime generation contains a symlink: ${relativePath}`);
			}
			if (entry.isDirectory()) {
				walk(entryPath);
				continue;
			}
			if (!entry.isFile()) {
				throw new Error(`Runtime generation contains an unsupported entry: ${relativePath}`);
			}
			if (relativePath !== "notion-runtime-generation.json") {
				observed.push(relativePath);
			}
		}
	};
	walk(releaseRoot);

	const declaredPaths = Object.keys(declared).sort();
	observed.sort();
	if (declaredPaths.join("\0") !== observed.join("\0")) {
		throw new Error("Runtime generation file manifest is incomplete or contains stale records");
	}
	for (const relativePath of observed) {
		assertManifestFile(releaseRoot, relativePath, declared[relativePath]);
	}
}

function assertManifestFile(
	releaseRoot: string,
	relativePath: string,
	record: FileRecord | { kind: string } | undefined,
): void {
	if (
		!record ||
		record.kind !== "file" ||
		!("sha256" in record) ||
		!("size" in record) ||
		!("mode" in record) ||
		!HEX64.test(record.sha256) ||
		!Number.isInteger(record.size) ||
		record.size < 0
	) {
		throw new Error(`Runtime generation file record is invalid: ${relativePath}`);
	}
	const filePath = path.join(releaseRoot, relativePath);
	assertOwnedRegularFile(filePath, `runtime file ${relativePath}`);
	const bytes = readFileSync(filePath);
	const mode = (lstatSync(filePath).mode & 0o777).toString(8).padStart(4, "0");
	if (
		bytes.length !== record.size ||
		sha256(bytes) !== record.sha256 ||
		mode !== record.mode
	) {
		throw new Error(`Runtime generation file drift: ${relativePath}`);
	}
}

function assertOwnedRegularFile(filePath: string, description: string): void {
	const info = lstatSync(filePath);
	if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.()) {
		throw new Error(`${description} must be an owner-bound regular file`);
	}
	if ((info.mode & 0o022) !== 0) {
		throw new Error(`${description} is group/world writable`);
	}
}

function realpathOrResolved(value: string): string {
	try {
		return realpathSync(value);
	} catch {
		return path.resolve(value);
	}
}

function isWithin(candidate: string, root: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}
