import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { verifySnapshotRuntimeSource } from "../src/notion/runtime-generation.js";

function sha256(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

describe("snapshot runtime generation identity", () => {
	test("accepts the canonical checkout without a runtime manifest", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-canonical-runtime-"));
		const source = path.join(root, "src", "notion", "export-project-snapshot.ts");
		await mkdir(path.dirname(source), { recursive: true });
		await writeFile(source, "fixture", "utf8");

		expect(
			verifySnapshotRuntimeSource(source, {
				canonicalRoot: root,
				allowCanonicalCheckout: true,
			}),
		).toMatchObject({
			mode: "canonical-checkout",
			sourceModulePath: await realpath(source),
		});
	});

	test("accepts only the exact manifest-bound immutable module and detects drift", async () => {
		const productionRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-root-"));
		const commit = "a".repeat(40);
		const release = path.join(productionRoot, "releases", commit);
		const files = [
			"dist/src/cli.js",
			"dist/src/notion/export-project-snapshot.js",
			"package-lock.json",
		];
		const records: Record<string, { kind: "file"; mode: string; sha256: string; size: number }> = {};
		for (const relative of files) {
			const destination = path.join(release, relative);
			await mkdir(path.dirname(destination), { recursive: true });
			const bytes = Buffer.from(`fixture:${relative}\n`);
			await writeFile(destination, bytes);
			await chmod(destination, relative.endsWith("cli.js") ? 0o555 : 0o444);
			records[relative] = {
				kind: "file",
				mode: relative.endsWith("cli.js") ? "0555" : "0444",
				sha256: sha256(bytes),
				size: bytes.length,
			};
		}
		const manifestPath = path.join(release, "notion-runtime-generation.json");
		const manifest = {
			schema: "NotionRuntimeGenerationV1",
			repository: "saagpatel/notion-operating-system",
			source_remote: "https://github.com/saagpatel/notion-operating-system.git",
			source_commit: commit,
			source_tree: "b".repeat(40),
			package_lock_sha256: records["package-lock.json"]!.sha256,
			created_at: "2026-08-28T00:00:00Z",
			entrypoint: "dist/src/cli.js",
			export_module: "dist/src/notion/export-project-snapshot.js",
			files: records,
		};
		await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
		await chmod(manifestPath, 0o444);
		for (const directory of [
			path.join(release, "dist", "src", "notion"),
			path.join(release, "dist", "src"),
			path.join(release, "dist"),
			release,
		]) await chmod(directory, 0o555);
		const manifestSha = sha256(await readFile(manifestPath));
		await writeFile(path.join(productionRoot, "current.json"), JSON.stringify({
			schema: "NotionRuntimePointerV1",
			current: { source_commit: commit, manifest_sha256: manifestSha },
			previous: null,
			updated_at: "2026-08-28T00:01:00Z",
		}), { mode: 0o600 });
		const source = path.join(release, "dist/src/notion/export-project-snapshot.js");

		expect(
			verifySnapshotRuntimeSource(source, {
				canonicalRoot: path.join(productionRoot, "absent-canonical"),
				productionRoot,
				manifestPath,
				manifestSha256: manifestSha,
			}),
		).toMatchObject({
				mode: "immutable-generation",
				sourceCommit: commit,
				manifestSha256: manifestSha,
		});

		await writeFile(path.join(productionRoot, "current.json"), JSON.stringify({
			schema: "NotionRuntimePointerV1",
			current: { source_commit: "e".repeat(40), manifest_sha256: manifestSha },
			previous: null,
			updated_at: "2026-08-28T00:02:00Z",
		}), { mode: 0o600 });
		expect(() => verifySnapshotRuntimeSource(source, {
			canonicalRoot: path.join(productionRoot, "absent-canonical"),
			productionRoot,
			manifestPath,
			manifestSha256: manifestSha,
		})).toThrow("not selected by the current pointer");
		await writeFile(path.join(productionRoot, "current.json"), JSON.stringify({
			schema: "NotionRuntimePointerV1",
			current: { source_commit: commit, manifest_sha256: manifestSha },
			previous: null,
			updated_at: "2026-08-28T00:03:00Z",
		}), { mode: 0o600 });

		await chmod(source, 0o644);
		await writeFile(source, "drift\n", "utf8");
		await chmod(source, 0o444);
		expect(() =>
			verifySnapshotRuntimeSource(source, {
				canonicalRoot: path.join(productionRoot, "absent-canonical"),
				productionRoot,
				manifestPath,
				manifestSha256: manifestSha,
			}),
		).toThrow("Runtime generation file drift");
	});

	test("rejects canonical execution without explicit development opt-in", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-canonical-runtime-denied-"));
		const source = path.join(root, "src", "notion", "export-project-snapshot.ts");
		await mkdir(path.dirname(source), { recursive: true });
		await writeFile(source, "fixture", "utf8");
		expect(() => verifySnapshotRuntimeSource(source, { canonicalRoot: root }))
			.toThrow("development-only opt-in");
	});

	test("rejects undeclared dependency files and package-lock binding drift", async () => {
		const productionRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-completeness-"));
		const commit = "f".repeat(40);
		const release = path.join(productionRoot, "releases", commit);
		const files = [
			"dist/src/cli.js",
			"dist/src/notion/export-project-snapshot.js",
			"package-lock.json",
		];
		const records: Record<string, { kind: "file"; mode: string; sha256: string; size: number }> = {};
		for (const relative of files) {
			const destination = path.join(release, relative);
			await mkdir(path.dirname(destination), { recursive: true });
			const bytes = Buffer.from(`fixture:${relative}\n`);
			await writeFile(destination, bytes);
			await chmod(destination, 0o444);
			records[relative] = { kind: "file", mode: "0444", sha256: sha256(bytes), size: bytes.length };
		}
		const dependencyPath = path.join(release, "node_modules", "dependency", "index.js");
		await mkdir(path.dirname(dependencyPath), { recursive: true });
		await writeFile(dependencyPath, "export default true;\n", "utf8");
		await chmod(dependencyPath, 0o444);
		for (const directory of [
			path.join(release, "dist", "src", "notion"),
			path.join(release, "dist", "src"),
			path.join(release, "dist"),
			path.join(release, "node_modules", "dependency"),
			path.join(release, "node_modules"),
			release,
		]) await chmod(directory, 0o555);
		const manifestPath = path.join(release, "notion-runtime-generation.json");
		const manifest = {
			schema: "NotionRuntimeGenerationV1",
			repository: "saagpatel/notion-operating-system",
			source_remote: "https://github.com/saagpatel/notion-operating-system.git",
			source_commit: commit,
			source_tree: "1".repeat(40),
			package_lock_sha256: records["package-lock.json"]!.sha256,
			created_at: "2026-08-28T00:00:00Z",
			entrypoint: "dist/src/cli.js",
			export_module: "dist/src/notion/export-project-snapshot.js",
			files: records,
		};
		await chmod(release, 0o755);
		await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
		await chmod(manifestPath, 0o444);
		await chmod(release, 0o555);

		const manifestSha = sha256(await readFile(manifestPath));
		await writeFile(path.join(productionRoot, "current.json"), JSON.stringify({
			schema: "NotionRuntimePointerV1",
			current: { source_commit: commit, manifest_sha256: manifestSha },
			previous: null,
			updated_at: "2026-08-28T00:01:00Z",
		}), { mode: 0o600 });
		expect(() => verifySnapshotRuntimeSource(
			path.join(release, "dist/src/notion/export-project-snapshot.js"),
			{
				canonicalRoot: path.join(productionRoot, "absent"),
				productionRoot,
				manifestPath,
				manifestSha256: manifestSha,
			},
		)).toThrow("file manifest is incomplete");
	});

	test("rejects a valid manifest placed outside its commit release", async () => {
		const productionRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-path-"));
		const outside = path.join(productionRoot, "outside");
		await mkdir(outside, { recursive: true });
		const source = path.join(outside, "export-project-snapshot.js");
		await writeFile(source, "fixture\n", "utf8");
		const manifestPath = path.join(outside, "notion-runtime-generation.json");
		const manifest = {
			schema: "NotionRuntimeGenerationV1",
			repository: "saagpatel/notion-operating-system",
			source_remote: "https://github.com/saagpatel/notion-operating-system.git",
			source_commit: "c".repeat(40),
			source_tree: "d".repeat(40),
			package_lock_sha256: "e".repeat(64),
			created_at: "2026-08-28T00:00:00Z",
			entrypoint: "dist/src/cli.js",
			export_module: "dist/src/notion/export-project-snapshot.js",
			files: {},
		};
		await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
		await chmod(manifestPath, 0o444);

		expect(() =>
			verifySnapshotRuntimeSource(source, {
				canonicalRoot: path.join(productionRoot, "absent-canonical"),
				productionRoot,
				manifestPath,
				manifestSha256: sha256(Buffer.from(`${JSON.stringify(manifest)}\n`)),
			}),
		).toThrow("release path mismatch");
	});
});
