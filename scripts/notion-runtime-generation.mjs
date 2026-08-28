#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCHEMA = "NotionRuntimeGenerationV1";
const RECEIPT_SCHEMA = "NotionRuntimeGenerationReceiptV1";
const REPOSITORY = "saagpatel/notion-operating-system";
const EXPECTED_REMOTE = "https://github.com/saagpatel/notion-operating-system.git";
const MANIFEST_NAME = "notion-runtime-generation.json";
const POINTER_NAME = "current.json";
const REVERSAL_CUSTODY = "selector-reversal-custody";
const ENTRYPOINT = "dist/src/cli.js";
const EXPORT_MODULE = "dist/src/notion/export-project-snapshot.js";
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GIT = "/usr/bin/git";
const TAR = "/usr/bin/tar";

class GenerationError extends Error {}

function sha256Bytes(value) {
	return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
	return sha256Bytes(readFileSync(filePath));
}

function utcNow() {
	return new Date().toISOString();
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function run(command, args, options = {}) {
	const completed = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (completed.error || completed.status !== 0) {
		const detail = completed.error?.message ?? completed.stderr.trim() ?? completed.stdout.trim();
		throw new GenerationError(`${path.basename(command)} ${args.join(" ")} failed: ${detail || `exit ${completed.status}`}`);
	}
	return completed.stdout.trim();
}

function requireOwnedDirectory(directory, description, expectedMode) {
	const info = lstatSync(directory);
	if (
		!info.isDirectory() ||
		info.isSymbolicLink() ||
		info.uid !== process.getuid() ||
		(info.mode & 0o022) !== 0 ||
		(expectedMode !== undefined && (info.mode & 0o777) !== expectedMode)
	) {
		throw new GenerationError(`${description} has unsafe ownership, type, or mode`);
	}
}

function requireTrustedTool(filePath, description) {
	const info = lstatSync(filePath);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		![0, process.getuid()].includes(info.uid) ||
		(info.mode & 0o022) !== 0
	) {
		throw new GenerationError(`${description} has unsafe ownership, type, or mode`);
	}
}

function requireOwnedFile(filePath, description, expectedMode) {
	const info = lstatSync(filePath);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.uid !== process.getuid() ||
		info.nlink !== 1 ||
		(info.mode & 0o022) !== 0 ||
		(expectedMode !== undefined && (info.mode & 0o777) !== expectedMode)
	) {
		throw new GenerationError(`${description} has unsafe ownership, links, type, or mode`);
	}
}

function normalizeRemote(value) {
	return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function safeBuildEnv() {
	const allowed = ["HOME", "LANG", "LC_ALL", "TMPDIR", "TERM"];
	const env = Object.fromEntries(
		allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
	);
	env.PATH = `${path.dirname(realpathSync(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
	env.npm_config_userconfig = "/dev/null";
	env.npm_config_audit = "false";
	env.npm_config_fund = "false";
	return env;
}

function ensureManagedRoot(root) {
	if (!path.isAbsolute(root)) throw new GenerationError("managed root must be absolute");
	if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
	root = realpathSync(root);
	requireOwnedDirectory(root, "managed root");
	const releases = path.join(root, "releases");
	if (!existsSync(releases)) mkdirSync(releases, { mode: 0o700 });
	requireOwnedDirectory(releases, "release root");
	return { root, releases };
}

function fsyncDirectory(directory) {
	const descriptor = openSync(directory, "r");
	try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function withGenerationLock(root, action, callback, finalization = {}) {
	const generationLock = path.join(root, ".notion-runtime-generation.lock");
	let descriptor;
	let identity;
	let lockOwned = false;
	try {
		descriptor = openSync(generationLock, "wx", 0o600);
		lockOwned = true;
		identity = fstatSync(descriptor);
		writeFileSync(
			descriptor,
			`${canonicalJson({ action, pid: process.pid, started_at: utcNow() })}\n`,
		);
		fsyncSync(descriptor);
	} catch (error) {
		if (descriptor !== undefined) closeSync(descriptor);
		if (lockOwned && existsSync(generationLock)) {
			const observed = lstatSync(generationLock);
			if (identity !== undefined && observed.dev === identity.dev && observed.ino === identity.ino) {
				unlinkSync(generationLock);
			}
		}
		throw new GenerationError(`runtime generation lock is already held: ${error.message}`);
	}
	let result;
	let actionError;
	try {
		result = callback();
	} catch (error) {
		actionError = error;
	}
	let finalizationError;
	try {
		if (!existsSync(generationLock)) {
			throw new GenerationError("runtime generation lock disappeared while held");
		}
		const observed = lstatSync(generationLock);
		if (observed.dev !== identity.dev || observed.ino !== identity.ino) {
			throw new GenerationError("runtime generation lock identity changed while held");
		}
		if (descriptor !== undefined) closeSync(descriptor);
		descriptor = undefined;
		(finalization.unlinkLock ?? unlinkSync)(generationLock);
		(finalization.fsyncDirectory ?? fsyncDirectory)(root);
	} catch (error) {
		finalizationError = error;
		if (descriptor !== undefined) closeSync(descriptor);
	}
	if (finalizationError !== undefined) {
		const prefix = actionError === undefined
			? "operation may be committed; lock finalization is recovery-required"
			: `operation failed (${actionError.message}); lock finalization also requires recovery`;
		throw new GenerationError(`${prefix}: ${finalizationError.message}. Inspect the exact selector and lock before retrying.`);
	}
	if (actionError !== undefined) throw actionError;
	return result;
}

function validateSource(sourceRoot, commit) {
	if (!path.isAbsolute(sourceRoot)) throw new GenerationError("source root must be absolute");
	requireOwnedDirectory(sourceRoot, "source root");
	if (!HEX40.test(commit)) throw new GenerationError("commit must be a full lowercase SHA-1");
	const git = (args) => run(GIT, args, { cwd: sourceRoot });
	if (git(["rev-parse", "HEAD"]) !== commit) throw new GenerationError("source HEAD does not equal requested commit");
	if (git(["status", "--porcelain=v1", "--untracked-files=all"])) throw new GenerationError("source must be clean including untracked files");
	const remote = git(["remote", "get-url", "origin"]);
	if (normalizeRemote(remote) !== normalizeRemote(EXPECTED_REMOTE)) throw new GenerationError("source remote does not match the canonical repository");
	if (git(["rev-parse", "refs/remotes/origin/main"]) !== commit) throw new GenerationError("requested commit is not the locally verified origin/main");
	return {
		remote: EXPECTED_REMOTE,
		tree: git(["rev-parse", `${commit}^{tree}`]),
	};
}

function walkFiles(root) {
	const records = {};
	const walk = (directory) => {
		requireOwnedDirectory(directory, "runtime directory", 0o555);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			const relative = path.relative(root, absolute).split(path.sep).join("/");
			if (entry.isSymbolicLink()) throw new GenerationError(`runtime contains symlink: ${relative}`);
			if (entry.isDirectory()) {
				walk(absolute);
				continue;
			}
			if (!entry.isFile()) throw new GenerationError(`runtime contains unsupported entry: ${relative}`);
			if (relative === MANIFEST_NAME) continue;
			requireOwnedFile(absolute, `runtime file ${relative}`);
			const info = statSync(absolute);
			records[relative] = {
				kind: "file",
				mode: (info.mode & 0o777).toString(8).padStart(4, "0"),
				sha256: sha256File(absolute),
				size: info.size,
			};
		}
	};
	walk(root);
	return Object.fromEntries(Object.entries(records).sort(([left], [right]) => left.localeCompare(right)));
}

function freezePayload(root) {
	const paths = [];
	const collect = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new GenerationError(`staged runtime contains symlink: ${path.relative(root, absolute)}`);
			if (entry.isDirectory()) collect(absolute);
			else if (!entry.isFile()) throw new GenerationError("staged runtime contains an unsupported entry");
			paths.push(absolute);
		}
	};
	collect(root);
	for (const item of paths) {
		const info = lstatSync(item);
		chmodSync(item, info.isDirectory() ? 0o555 : ((info.mode & 0o111) ? 0o555 : 0o444));
	}
	chmodSync(root, 0o555);
}

function fsyncTree(root) {
	const directories = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, entry.name);
			if (entry.isDirectory()) walk(absolute);
			else {
				const descriptor = openSync(absolute, "r");
				try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
			}
		}
		directories.push(directory);
	};
	walk(root);
	for (const directory of directories) {
		const descriptor = openSync(directory, "r");
		try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	}
}

function validateManifest(release, expectedCommit) {
	requireOwnedDirectory(release, "runtime release", 0o555);
	if (path.basename(release) !== expectedCommit) throw new GenerationError("release directory does not equal source commit");
	const manifestPath = path.join(release, MANIFEST_NAME);
	requireOwnedFile(manifestPath, "runtime manifest", 0o444);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const expectedFields = ["created_at", "entrypoint", "export_module", "files", "package_lock_sha256", "repository", "schema", "source_commit", "source_remote", "source_tree"].sort();
	if (Object.keys(manifest).sort().join("\0") !== expectedFields.join("\0") || manifest.schema !== SCHEMA || manifest.repository !== REPOSITORY) throw new GenerationError("runtime manifest fields or schema mismatch");
	if (manifest.source_commit !== expectedCommit || !HEX40.test(manifest.source_tree) || normalizeRemote(manifest.source_remote) !== normalizeRemote(EXPECTED_REMOTE)) throw new GenerationError("runtime manifest source binding mismatch");
	if (manifest.entrypoint !== ENTRYPOINT || manifest.export_module !== EXPORT_MODULE || !HEX64.test(manifest.package_lock_sha256) || Number.isNaN(Date.parse(manifest.created_at))) throw new GenerationError("runtime manifest contract mismatch");
	const observed = walkFiles(release);
	if (canonicalJson(observed) !== canonicalJson(manifest.files)) throw new GenerationError("runtime file manifest mismatch");
	for (const required of [ENTRYPOINT, EXPORT_MODULE, "package-lock.json"]) if (!(required in observed)) throw new GenerationError(`runtime missing required file: ${required}`);
	if (observed["package-lock.json"].sha256 !== manifest.package_lock_sha256) throw new GenerationError("package-lock binding mismatch");
	return manifest;
}

function validatePointer(root) {
	const pointerPath = path.join(root, POINTER_NAME);
	requireOwnedFile(pointerPath, "runtime pointer", 0o600);
	const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
	const exactEntry = (value) =>
		value !== null &&
		typeof value === "object" &&
		Object.keys(value).sort().join("\0") === "manifest_sha256\0source_commit" &&
		HEX40.test(value.source_commit) &&
		HEX64.test(value.manifest_sha256);
	if (
		Object.keys(pointer).sort().join("\0") !== "current\0previous\0schema\0updated_at" ||
		pointer.schema !== "NotionRuntimePointerV1" ||
		!exactEntry(pointer.current) ||
		(pointer.previous !== null && !exactEntry(pointer.previous)) ||
		(pointer.previous !== null &&
			pointer.previous.source_commit === pointer.current.source_commit &&
			pointer.previous.manifest_sha256 === pointer.current.manifest_sha256) ||
		Number.isNaN(Date.parse(pointer.updated_at))
	) throw new GenerationError("runtime pointer contract mismatch");
	const release = path.join(root, "releases", pointer.current.source_commit);
	const manifest = validateManifest(release, pointer.current.source_commit);
	if (sha256File(path.join(release, MANIFEST_NAME)) !== pointer.current.manifest_sha256) throw new GenerationError("runtime pointer manifest binding mismatch");
	return { pointer, pointerPath, release, manifest };
}

function receipt(action, state, release, manifest, tools = {}) {
	return {
		schema: RECEIPT_SCHEMA,
		action,
		state,
		observed_at: utcNow(),
		release,
		source_commit: manifest.source_commit,
		source_tree: manifest.source_tree,
		manifest_sha256: sha256File(path.join(release, MANIFEST_NAME)),
		package_lock_sha256: manifest.package_lock_sha256,
		entrypoint_sha256: manifest.files[ENTRYPOINT].sha256,
		file_count: Object.keys(manifest.files).length,
		tools,
		claim_ceiling: "Immutable local runtime bytes and stage-time clean origin/main source binding only; loaded runtime, credentials, provider behavior, and scheduler execution require separate proof.",
	};
}

function stage(args) {
	const { root: managedRoot, releases } = ensureManagedRoot(args.managedRoot);
	const source = realpathSync(args.sourceRoot);
	const sourceIdentity = validateSource(source, args.commit);
	const release = path.join(releases, args.commit);
	if (existsSync(release)) return receipt("stage", "already_present", release, validateManifest(release, args.commit));
	const lock = path.join(managedRoot, ".notion-runtime-generation.lock");
	let lockDescriptor;
	try {
		lockDescriptor = openSync(lock, "wx", 0o600);
	} catch (error) {
		throw new GenerationError(`runtime generation lock is already held: ${error.message}`);
	}
	closeSync(lockDescriptor);
	let staging;
	const archive = path.join(managedRoot, `.${args.commit}.${process.pid}.tar`);
	const cleanup = () => {
		if (existsSync(archive)) unlinkSync(archive);
		if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
		if (existsSync(lock)) unlinkSync(lock);
	};
	const onSignal = (signal) => {
		cleanup();
		process.exit(signal === "SIGINT" ? 130 : 143);
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		staging = mkdtempSync(path.join(releases, `.${args.commit}.staging-`));
		run(GIT, ["archive", "--format=tar", `--output=${archive}`, args.commit], { cwd: source });
		requireOwnedFile(archive, "git archive");
		for (const member of run(TAR, ["-tf", archive]).split("\n")) {
			if (member.startsWith("/") || member.split("/").includes("..")) throw new GenerationError(`archive member escapes release root: ${member}`);
		}
		run(TAR, ["-xf", archive, "-C", staging]);
		const buildEnv = safeBuildEnv();
		const npmRealpath = realpathSync(
			process.env.NOTION_RUNTIME_NPM_PATH ?? "/opt/homebrew/bin/npm",
		);
		requireTrustedTool(npmRealpath, "npm runtime tool");
		const nodeRealpath = realpathSync(process.execPath);
		run(nodeRealpath, [npmRealpath, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: staging, env: buildEnv });
		run(nodeRealpath, [npmRealpath, "run", "build"], { cwd: staging, env: buildEnv });
		run(nodeRealpath, [npmRealpath, "prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: staging, env: buildEnv });
		// The runtime invokes the compiled entrypoint through an exact Node path;
		// package-manager command shims are unnecessary and are symlinks by design.
		// Excluding them keeps the immutable payload symlink-free and fail-closed.
		rmSync(path.join(staging, "node_modules", ".bin"), { recursive: true, force: true });
		const sourceLockSha = sha256File(path.join(source, "package-lock.json"));
		if (sha256File(path.join(staging, "package-lock.json")) !== sourceLockSha) throw new GenerationError("package-lock changed during build staging");
		for (const required of [ENTRYPOINT, EXPORT_MODULE]) if (!existsSync(path.join(staging, required))) throw new GenerationError(`built runtime missing ${required}`);
		const entrypointSmoke = run(
			nodeRealpath,
			[ENTRYPOINT, "control-tower", "export-project-snapshot", "--help"],
			{ cwd: staging, env: buildEnv },
		);
		if (!entrypointSmoke.includes("--output")) throw new GenerationError("built runtime entrypoint smoke did not expose the snapshot output contract");
		freezePayload(staging);
		const files = walkFiles(staging);
		const manifest = {
			schema: SCHEMA,
			repository: REPOSITORY,
			source_remote: sourceIdentity.remote,
			source_commit: args.commit,
			source_tree: sourceIdentity.tree,
			package_lock_sha256: sourceLockSha,
			created_at: utcNow(),
			entrypoint: ENTRYPOINT,
			export_module: EXPORT_MODULE,
			files,
		};
		chmodSync(staging, 0o755);
		writeFileSync(path.join(staging, MANIFEST_NAME), `${canonicalJson(manifest)}\n`, { mode: 0o444, flag: "wx" });
		chmodSync(staging, 0o555);
		fsyncTree(staging);
		renameSync(staging, release);
		const releasesDescriptor = openSync(releases, "r");
		try { fsyncSync(releasesDescriptor); } finally { closeSync(releasesDescriptor); }
		const verified = validateManifest(release, args.commit);
		return receipt("stage", "created", release, verified, {
			node_path: nodeRealpath,
			node_version: process.version,
			node_sha256: sha256File(nodeRealpath),
			npm_path: npmRealpath,
			npm_version: run(nodeRealpath, [npmRealpath, "--version"], { env: buildEnv }),
			npm_sha256: sha256File(npmRealpath),
			git_path: GIT,
			git_sha256: sha256File(GIT),
			tar_path: TAR,
			tar_sha256: sha256File(TAR),
			entrypoint_smoke: `${nodeRealpath} ${ENTRYPOINT} control-tower export-project-snapshot --help`,
		});
	} finally {
		process.removeListener("SIGINT", onSignal);
		process.removeListener("SIGTERM", onSignal);
		cleanup();
	}
}

function readback(args) {
	const root = realpathSync(args.managedRoot);
	requireOwnedDirectory(root, "managed root");
	return withGenerationLock(root, "readback", () => {
		const selected = validatePointer(root);
		const result = receipt("readback", "verified-current", selected.release, selected.manifest);
		result.pointer = selected.pointerPath;
		result.pointer_sha256 = sha256File(selected.pointerPath);
		return result;
	});
}

function select(args) {
	if (args.allowSelection !== "yes") throw new GenerationError("selection requires --allow-selection yes");
	const root = realpathSync(args.managedRoot);
	requireOwnedDirectory(root, "managed root");
	return withGenerationLock(root, "select", () => {
		const release = path.join(root, "releases", args.commit);
		const manifest = validateManifest(release, args.commit);
		const manifestSha = sha256File(path.join(release, MANIFEST_NAME));
		const pointerPath = path.join(root, POINTER_NAME);
		let previous = null;
		if (existsSync(pointerPath)) {
			const selected = validatePointer(root);
			if (args.expectedCurrent !== selected.pointer.current.source_commit) throw new GenerationError("current runtime selection changed");
			if (args.commit === selected.pointer.current.source_commit) throw new GenerationError("target runtime is already selected");
			previous = selected.pointer.current;
		} else if (args.expectedCurrent !== "none") {
			throw new GenerationError("runtime pointer is absent but --expected-current was not none");
		}
		const pointer = {
			schema: "NotionRuntimePointerV1",
			current: { source_commit: args.commit, manifest_sha256: manifestSha },
			previous,
			updated_at: utcNow(),
		};
		const temporary = path.join(root, `.${POINTER_NAME}.${process.pid}.tmp`);
		try {
			writeFileSync(temporary, `${canonicalJson(pointer)}\n`, { flag: "wx", mode: 0o600 });
			const descriptor = openSync(temporary, "r");
			try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
			renameSync(temporary, pointerPath);
			const rootDescriptor = openSync(root, "r");
			try { fsyncSync(rootDescriptor); } finally { closeSync(rootDescriptor); }
		} finally {
			if (existsSync(temporary)) unlinkSync(temporary);
		}
		validatePointer(root);
		const result = receipt("select", "selected", release, manifest);
		result.pointer = pointerPath;
		result.pointer_sha256 = sha256File(pointerPath);
		result.previous = previous;
		result.claim_ceiling = "Local runtime selector and immutable bytes only; loaded wrapper, credentials, provider behavior, and scheduler execution require separate proof.";
		return result;
	});
}

function deactivate(args, operations = {}) {
	if (args.allowSelection !== "yes") throw new GenerationError("deactivation requires --allow-selection yes");
	if (args.expectedPrevious !== "none") throw new GenerationError("first-install deactivation requires --expected-previous none");
	if (!HEX64.test(args.expectedCurrentManifestSha256) || !HEX64.test(args.expectedPointerSha256)) {
		throw new GenerationError("deactivation digest bindings must be lowercase SHA-256 values");
	}
	const root = realpathSync(args.managedRoot);
	const syncDirectory = operations.fsyncDirectory ?? fsyncDirectory;
	const digestFile = operations.sha256File ?? sha256File;
	requireOwnedDirectory(root, "managed root");
	return withGenerationLock(root, "deactivate", () => {
		const selected = validatePointer(root);
		if (selected.pointer.current.source_commit !== args.expectedCurrent) {
			throw new GenerationError("current runtime selection changed");
		}
		if (selected.pointer.current.manifest_sha256 !== args.expectedCurrentManifestSha256) {
			throw new GenerationError("current runtime manifest binding changed");
		}
		if (selected.pointer.previous !== null) {
			throw new GenerationError("deactivation is limited to a first-install selector with previous null");
		}
		const pointerSha = sha256File(selected.pointerPath);
		if (pointerSha !== args.expectedPointerSha256) {
			throw new GenerationError("current runtime pointer digest changed");
		}
		const custody = path.join(root, REVERSAL_CUSTODY);
		if (!existsSync(custody)) {
			mkdirSync(custody, { mode: 0o700 });
			syncDirectory(root);
		}
		requireOwnedDirectory(custody, "selector reversal custody", 0o700);
		const custodyPointer = path.join(
			custody,
			`current.pre-deactivate-${args.expectedCurrent}-${Date.now()}-${process.pid}.json`,
		);
		if (existsSync(custodyPointer)) throw new GenerationError("selector reversal custody target already exists");
		let moved = false;
		try {
			renameSync(selected.pointerPath, custodyPointer);
			moved = true;
			syncDirectory(custody);
			syncDirectory(root);
			if (existsSync(selected.pointerPath)) throw new GenerationError("runtime pointer remains present after deactivation");
			requireOwnedFile(custodyPointer, "selector reversal custody pointer", 0o600);
			if (digestFile(custodyPointer) !== pointerSha) throw new GenerationError("selector reversal custody pointer digest mismatch");
		} catch (error) {
			if (moved) {
				try {
					if (!existsSync(selected.pointerPath) && existsSync(custodyPointer)) {
						requireOwnedFile(custodyPointer, "selector reversal custody pointer before restoration", 0o600);
						if (sha256File(custodyPointer) !== pointerSha) {
							throw new GenerationError("custody pointer digest changed before restoration");
						}
						renameSync(custodyPointer, selected.pointerPath);
						syncDirectory(custody);
						syncDirectory(root);
					}
					if (!existsSync(selected.pointerPath) || existsSync(custodyPointer)) {
						throw new GenerationError("selector restoration did not reach an exact active state");
					}
					const restored = validatePointer(root);
					if (sha256File(restored.pointerPath) !== pointerSha) {
						throw new GenerationError("restored selector digest mismatch");
					}
				} catch (recoveryError) {
					throw new GenerationError(`deactivation failed and selector restoration is recovery-required: ${error.message}; recovery: ${recoveryError.message}`);
				}
			}
			throw error;
		}
		const result = receipt("deactivate", "reversed-to-inactive", selected.release, selected.manifest);
		result.before_pointer_sha256 = pointerSha;
		result.before = selected.pointer;
		result.pointer_absent = true;
		result.reversal_custody_pointer = custodyPointer;
		result.reversal_custody_pointer_sha256 = pointerSha;
		result.release_retained = true;
		result.rollback = {
			action: "reactivate",
			commit: args.expectedCurrent,
			manifest_sha256: args.expectedCurrentManifestSha256,
			custody_pointer: custodyPointer,
			custody_pointer_sha256: pointerSha,
			requires_selection_authority: true,
		};
		result.claim_ceiling = "Local first-install selector reversal only; immutable release bytes are retained, and loaded wrapper, production activation, credentials, provider behavior, and scheduler execution require separate proof.";
		return result;
	}, operations.lockFinalization ?? {});
}

function reactivate(args, operations = {}) {
	if (args.allowSelection !== "yes") throw new GenerationError("reactivation requires --allow-selection yes");
	if (!HEX40.test(args.commit) || !HEX64.test(args.manifestSha256) || !HEX64.test(args.custodyPointerSha256)) {
		throw new GenerationError("reactivation identity bindings are invalid");
	}
	const root = realpathSync(args.managedRoot);
	const syncDirectory = operations.fsyncDirectory ?? fsyncDirectory;
	requireOwnedDirectory(root, "managed root");
	return withGenerationLock(root, "reactivate", () => {
		const pointerPath = path.join(root, POINTER_NAME);
		if (existsSync(pointerPath)) throw new GenerationError("runtime pointer is already present");
		const custody = path.join(root, REVERSAL_CUSTODY);
		requireOwnedDirectory(custody, "selector reversal custody", 0o700);
		if (!path.isAbsolute(args.custodyPointer) || realpathSync(path.dirname(args.custodyPointer)) !== realpathSync(custody)) {
			throw new GenerationError("custody pointer is outside selector reversal custody");
		}
		requireOwnedFile(args.custodyPointer, "selector reversal custody pointer", 0o600);
		const custodyIdentity = lstatSync(args.custodyPointer);
		if (sha256File(args.custodyPointer) !== args.custodyPointerSha256) {
			throw new GenerationError("custody pointer digest changed");
		}
		const payload = JSON.parse(readFileSync(args.custodyPointer, "utf8"));
		if (
			payload.schema !== "NotionRuntimePointerV1" ||
			payload.current?.source_commit !== args.commit ||
			payload.current?.manifest_sha256 !== args.manifestSha256 ||
			payload.previous !== null
		) {
			throw new GenerationError("custody pointer does not bind the requested first-install generation");
		}
		let moved = false;
		try {
			operations.beforeReactivateMove?.(args.custodyPointer);
			renameSync(args.custodyPointer, pointerPath);
			moved = true;
			const movedIdentity = lstatSync(pointerPath);
			if (movedIdentity.dev !== custodyIdentity.dev || movedIdentity.ino !== custodyIdentity.ino) {
				throw new GenerationError("custody pointer identity changed across reactivation move");
			}
			syncDirectory(custody);
			syncDirectory(root);
			const selected = validatePointer(root);
			if (sha256File(pointerPath) !== args.custodyPointerSha256) {
				throw new GenerationError("restored selector digest mismatch");
			}
			const result = receipt("reactivate", "reactivated", selected.release, selected.manifest);
			result.pointer = pointerPath;
			result.pointer_sha256 = args.custodyPointerSha256;
			result.reversal_custody_pointer_consumed = true;
			result.claim_ceiling = "Local runtime selector restoration only; loaded wrapper, production activation, credentials, provider behavior, and scheduler execution require separate proof.";
			return result;
		} catch (error) {
			if (moved) {
				try {
					if (existsSync(pointerPath) && !existsSync(args.custodyPointer)) {
						const activeIdentity = lstatSync(pointerPath);
						const identityMatches = activeIdentity.dev === custodyIdentity.dev && activeIdentity.ino === custodyIdentity.ino;
						let bytesMatch = false;
						if (identityMatches) {
							try {
								requireOwnedFile(pointerPath, "runtime pointer before inactive-state restoration", 0o600);
								bytesMatch = sha256File(pointerPath) === args.custodyPointerSha256;
							} catch {
								bytesMatch = false;
							}
						}
						if (!identityMatches || !bytesMatch) {
							const evidence = path.join(custody, `reactivation-recovery-evidence-${Date.now()}-${process.pid}`);
							if (existsSync(evidence)) throw new GenerationError("reactivation recovery evidence target already exists");
							renameSync(pointerPath, evidence);
							syncDirectory(custody);
							syncDirectory(root);
							throw new GenerationError(`unexpected active selector was quarantined at ${evidence}`);
						}
						renameSync(pointerPath, args.custodyPointer);
						syncDirectory(custody);
						syncDirectory(root);
					}
					if (existsSync(pointerPath) || !existsSync(args.custodyPointer)) {
						throw new GenerationError("inactive selector custody was not restored");
					}
					requireOwnedFile(args.custodyPointer, "selector reversal custody pointer", 0o600);
					if (sha256File(args.custodyPointer) !== args.custodyPointerSha256) {
						throw new GenerationError("restored custody pointer digest mismatch");
					}
				} catch (recoveryError) {
					throw new GenerationError(`reactivation failed and inactive-state recovery is recovery-required: ${error.message}; recovery: ${recoveryError.message}`);
				}
			}
			throw error;
		}
	}, operations.lockFinalization ?? {});
}

function parseArgs(argv) {
	const [action, ...rest] = argv;
	if (!["stage", "select", "readback", "deactivate", "reactivate"].includes(action)) throw new GenerationError("action must be stage, select, readback, deactivate, or reactivate");
	const values = { action };
	for (let index = 0; index < rest.length; index += 2) {
		const key = rest[index];
		const value = rest[index + 1];
		if (!key?.startsWith("--") || value === undefined) throw new GenerationError("arguments must be --name value pairs");
		values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
	}
	const requiredFields = action === "stage"
		? ["sourceRoot", "commit", "managedRoot"]
		: action === "select"
			? ["commit", "managedRoot", "expectedCurrent", "allowSelection"]
			: action === "deactivate"
				? ["managedRoot", "expectedCurrent", "expectedCurrentManifestSha256", "expectedPointerSha256", "expectedPrevious", "allowSelection"]
				: action === "reactivate"
					? ["managedRoot", "commit", "manifestSha256", "custodyPointer", "custodyPointerSha256", "allowSelection"]
				: ["managedRoot"];
	for (const required of requiredFields) if (!values[required]) throw new GenerationError(`missing --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
	if (values.commit && !HEX40.test(values.commit)) throw new GenerationError("commit must be a full lowercase SHA-1");
	return values;
}

function atomicReceipt(receiptPath, value) {
	const resolved = path.resolve(receiptPath);
	mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
	const temporary = `${resolved}.${process.pid}.tmp`;
	writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: 0o600, flag: "wx" });
	const descriptor = openSync(temporary, "r");
	try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
	renameSync(temporary, resolved);
	const parentDescriptor = openSync(path.dirname(resolved), "r");
	try { fsyncSync(parentDescriptor); } finally { closeSync(parentDescriptor); }
}

export { GenerationError, deactivate, reactivate, readback, select, stage, validateManifest, validatePointer, withGenerationLock };

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const result = args.action === "stage" ? stage(args) : args.action === "select" ? select(args) : args.action === "deactivate" ? deactivate(args) : args.action === "reactivate" ? reactivate(args) : readback(args);
		if (args.receipt) atomicReceipt(args.receipt, result);
		process.stdout.write(`${canonicalJson(result)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
