import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { closeSync, existsSync, fsyncSync, openSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

// @ts-expect-error The production launcher is intentionally a plain ESM script.
import { deactivate, reactivate, withGenerationLock } from "../scripts/notion-runtime-generation.mjs";

const scriptPath = path.resolve("scripts/notion-runtime-generation.mjs");
const npmCliPath = realpathSync(
	process.env.npm_execpath ?? "/opt/homebrew/bin/npm",
);
const runtimeBuilderEnv = {
	...process.env,
	NOTION_RUNTIME_NPM_PATH: npmCliPath,
};

function run(command: string, args: string[], cwd?: string, env = process.env) {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

function runAsync(command: string, args: string[]) {
	return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
		const child = spawn(command, args, {
			env: runtimeBuilderEnv,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
		child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
		child.on("close", (status) => resolve({ status, stdout, stderr }));
	});
}

function fsyncDirectory(directory: string) {
	const descriptor = openSync(directory, "r");
	try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

async function fixtureRepository(): Promise<{ root: string; commit: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-source-"));
	await writeFile(
		path.join(root, "package.json"),
		JSON.stringify({
			name: "notion-operating-system",
			version: "0.0.0",
			private: true,
			type: "module",
			scripts: { build: "node build.mjs" },
		}),
	);
	await writeFile(
		path.join(root, "package-lock.json"),
		JSON.stringify({
			name: "notion-operating-system",
			version: "0.0.0",
			lockfileVersion: 3,
			requires: true,
			packages: { "": { name: "notion-operating-system", version: "0.0.0" } },
		}),
	);
	await writeFile(
		path.join(root, "build.mjs"),
		[
			'import { mkdir, writeFile } from "node:fs/promises";',
			'if (process.env.NOTION_TOKEN) throw new Error("secret leaked into build environment");',
			'await mkdir("dist/src/notion", { recursive: true });',
			'await writeFile("dist/src/cli.js", "console.log(\\"--output\\");\\n");',
			'await writeFile("dist/src/notion/export-project-snapshot.js", "export const ok = true;\\n");',
		].join("\n"),
	);
	run(process.execPath, [npmCliPath, "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], root, {
		HOME: process.env.HOME,
		PATH: `${path.dirname(realpathSync(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
		TMPDIR: process.env.TMPDIR,
		npm_config_userconfig: "/dev/null",
	});
	run("/usr/bin/git", ["init", "-b", "main"], root);
	run("/usr/bin/git", ["config", "user.name", "Runtime Test"], root);
	run("/usr/bin/git", ["config", "user.email", "runtime-test@example.invalid"], root);
	run("/usr/bin/git", ["add", "package.json", "package-lock.json", "build.mjs"], root);
	run("/usr/bin/git", ["commit", "-m", "fixture"], root);
	run("/usr/bin/git", ["remote", "add", "origin", "https://github.com/saagpatel/notion-operating-system"], root);
	const commit = run("/usr/bin/git", ["rev-parse", "HEAD"], root);
	run("/usr/bin/git", ["update-ref", "refs/remotes/origin/main", commit], root);
	return { root, commit };
}

describe("immutable Notion runtime generation script", () => {
	test("reverses a first-install selector to inactive while retaining exact release and pointer custody", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-deactivate-"));
		const stageReceipt = JSON.parse(run(process.execPath, [
			scriptPath,
			"stage",
			"--source-root", source.root,
			"--commit", source.commit,
			"--managed-root", managedRoot,
		], undefined, runtimeBuilderEnv));
		const selection = JSON.parse(run(process.execPath, [
			scriptPath,
			"select",
			"--commit", source.commit,
			"--managed-root", managedRoot,
			"--expected-current", "none",
			"--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		const pointerPath = path.join(managedRoot, "current.json");
		const pointerBefore = await readFile(pointerPath);
		const entrypointPath = path.join(managedRoot, "releases", source.commit, "dist/src/cli.js");
		const entrypointBefore = await readFile(entrypointPath);

		const deactivated = JSON.parse(run(process.execPath, [
			scriptPath,
			"deactivate",
			"--managed-root", managedRoot,
			"--expected-current", source.commit,
			"--expected-current-manifest-sha256", stageReceipt.manifest_sha256,
			"--expected-pointer-sha256", selection.pointer_sha256,
			"--expected-previous", "none",
			"--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		expect(deactivated).toMatchObject({
			action: "deactivate",
			state: "reversed-to-inactive",
			pointer_absent: true,
			release_retained: true,
		});
		await expect(readFile(pointerPath)).rejects.toThrow();
		expect(await readFile(deactivated.reversal_custody_pointer)).toEqual(pointerBefore);
		expect(await readFile(entrypointPath)).toEqual(entrypointBefore);

		const inactiveReadback = spawnSync(process.execPath, [
			scriptPath,
			"readback",
			"--managed-root", managedRoot,
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(inactiveReadback.status).toBe(1);

		const reactivated = JSON.parse(run(process.execPath, [
			scriptPath,
			"reactivate",
			"--commit", source.commit,
			"--managed-root", managedRoot,
			"--manifest-sha256", stageReceipt.manifest_sha256,
			"--custody-pointer", deactivated.reversal_custody_pointer,
			"--custody-pointer-sha256", deactivated.reversal_custody_pointer_sha256,
			"--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		expect(reactivated).toMatchObject({ action: "reactivate", state: "reactivated" });
		expect(await readFile(pointerPath)).toEqual(pointerBefore);
		expect(existsSync(deactivated.reversal_custody_pointer)).toBe(false);
		expect(JSON.parse(run(process.execPath, [scriptPath, "readback", "--managed-root", managedRoot])).state).toBe("verified-current");
	});

	test("post-move failures restore the exact selector state and allow retry", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-transaction-recovery-"));
		const stageReceipt = JSON.parse(run(process.execPath, [
			scriptPath, "stage", "--source-root", source.root, "--commit", source.commit, "--managed-root", managedRoot,
		], undefined, runtimeBuilderEnv));
		const selection = JSON.parse(run(process.execPath, [
			scriptPath, "select", "--commit", source.commit, "--managed-root", managedRoot,
			"--expected-current", "none", "--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		const pointerPath = path.join(managedRoot, "current.json");
		const pointerBefore = await readFile(pointerPath);
		await mkdir(path.join(managedRoot, "selector-reversal-custody"), { mode: 0o700 });
		const deactivateArgs = {
			managedRoot,
			expectedCurrent: source.commit,
			expectedCurrentManifestSha256: stageReceipt.manifest_sha256,
			expectedPointerSha256: selection.pointer_sha256,
			expectedPrevious: "none",
			allowSelection: "yes",
		};

		for (const failureAt of [1, 2]) {
			let calls = 0;
			expect(() => deactivate(deactivateArgs, {
				fsyncDirectory(directory: string) {
					calls += 1;
					if (calls === failureAt) throw new Error(`injected fsync failure ${failureAt}`);
					fsyncDirectory(directory);
				},
			})).toThrow(`injected fsync failure ${failureAt}`);
			expect(await readFile(pointerPath)).toEqual(pointerBefore);
			expect(await readdir(path.join(managedRoot, "selector-reversal-custody"))).toEqual([]);
		}

		expect(() => deactivate(deactivateArgs, { sha256File: () => "0".repeat(64) })).toThrow("custody pointer digest mismatch");
		expect(await readFile(pointerPath)).toEqual(pointerBefore);
		expect(await readdir(path.join(managedRoot, "selector-reversal-custody"))).toEqual([]);

		const deactivated = deactivate(deactivateArgs);
		const custodyPointer = deactivated.reversal_custody_pointer as string;
		const reactivateArgs = {
			managedRoot,
			commit: source.commit,
			manifestSha256: stageReceipt.manifest_sha256,
			custodyPointer,
			custodyPointerSha256: selection.pointer_sha256,
			allowSelection: "yes",
		};
		for (const failureAt of [1, 2]) {
			let calls = 0;
			expect(() => reactivate(reactivateArgs, {
				fsyncDirectory(directory: string) {
					calls += 1;
					if (calls === failureAt) throw new Error(`injected reactivation fsync failure ${failureAt}`);
					fsyncDirectory(directory);
				},
			})).toThrow(`injected reactivation fsync failure ${failureAt}`);
			expect(existsSync(pointerPath)).toBe(false);
			expect(await readFile(custodyPointer)).toEqual(pointerBefore);
		}
		const restored = reactivate(reactivateArgs);
		expect(restored.state).toBe("reactivated");
		expect(await readFile(pointerPath)).toEqual(pointerBefore);
	});

	test("fails closed when its exact generation lock disappears", async () => {
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-lock-disappears-"));
		const pointer = path.join(managedRoot, "current.json");
		await writeFile(pointer, "sentinel\n", { mode: 0o600 });
		expect(() => withGenerationLock(managedRoot, "test", () => {
			unlinkSync(path.join(managedRoot, ".notion-runtime-generation.lock"));
		})).toThrow("lock disappeared while held");
		expect(await readFile(pointer, "utf8")).toBe("sentinel\n");
	});

	test("reports committed uncertainty when lock finalization fails", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-lock-finalization-"));
		const stageReceipt = JSON.parse(run(process.execPath, [
			scriptPath, "stage", "--source-root", source.root, "--commit", source.commit, "--managed-root", managedRoot,
		], undefined, runtimeBuilderEnv));
		const selection = JSON.parse(run(process.execPath, [
			scriptPath, "select", "--commit", source.commit, "--managed-root", managedRoot,
			"--expected-current", "none", "--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		const pointer = path.join(managedRoot, "current.json");
		expect(() => deactivate({
			managedRoot,
			expectedCurrent: source.commit,
			expectedCurrentManifestSha256: stageReceipt.manifest_sha256,
			expectedPointerSha256: selection.pointer_sha256,
			expectedPrevious: "none",
			allowSelection: "yes",
		}, {
			lockFinalization: { unlinkLock: () => { throw new Error("injected unlink failure"); } },
		})).toThrow(/operation may be committed.*recovery-required/);
		expect(existsSync(pointer)).toBe(false);
		expect(readdirSync(path.join(managedRoot, "selector-reversal-custody"))).toHaveLength(1);
	});

	test("does not move a replaced custody symlink over the selector", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-custody-replacement-"));
		const stageReceipt = JSON.parse(run(process.execPath, [
			scriptPath, "stage", "--source-root", source.root, "--commit", source.commit, "--managed-root", managedRoot,
		], undefined, runtimeBuilderEnv));
		const selection = JSON.parse(run(process.execPath, [
			scriptPath, "select", "--commit", source.commit, "--managed-root", managedRoot,
			"--expected-current", "none", "--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		const custody = path.join(managedRoot, "selector-reversal-custody");
		await mkdir(custody, { mode: 0o700 });
		let calls = 0;
		expect(() => deactivate({
			managedRoot,
			expectedCurrent: source.commit,
			expectedCurrentManifestSha256: stageReceipt.manifest_sha256,
			expectedPointerSha256: selection.pointer_sha256,
			expectedPrevious: "none",
			allowSelection: "yes",
		}, {
			fsyncDirectory(directory: string) {
				calls += 1;
				if (calls === 1) {
					const [custodyName] = readdirSync(custody);
					const custodyPointer = path.join(custody, custodyName!);
					unlinkSync(custodyPointer);
					symlinkSync(path.join(managedRoot, "releases", source.commit, "dist/src/cli.js"), custodyPointer);
					throw new Error("injected custody replacement");
				}
				fsyncDirectory(directory);
			},
		})).toThrow("recovery-required");
		expect(existsSync(path.join(managedRoot, "current.json"))).toBe(false);
		const [custodyName] = readdirSync(custody);
		expect(custodyName).toBeDefined();
	});

	test("quarantines replaced or mutated reactivation sources instead of leaving them active", async () => {
		for (const replacement of ["symlink", "regular", "inplace"] as const) {
			const source = await fixtureRepository();
			const managedRoot = await mkdtemp(path.join(os.tmpdir(), `notion-runtime-reactivation-${replacement}-`));
			const stageReceipt = JSON.parse(run(process.execPath, [
				scriptPath, "stage", "--source-root", source.root, "--commit", source.commit, "--managed-root", managedRoot,
			], undefined, runtimeBuilderEnv));
			const selection = JSON.parse(run(process.execPath, [
				scriptPath, "select", "--commit", source.commit, "--managed-root", managedRoot,
				"--expected-current", "none", "--allow-selection", "yes",
			], undefined, runtimeBuilderEnv));
			const deactivated = deactivate({
				managedRoot,
				expectedCurrent: source.commit,
				expectedCurrentManifestSha256: stageReceipt.manifest_sha256,
				expectedPointerSha256: selection.pointer_sha256,
				expectedPrevious: "none",
				allowSelection: "yes",
			});
			const custodyPointer = deactivated.reversal_custody_pointer as string;
			const custody = path.dirname(custodyPointer);
			expect(() => reactivate({
				managedRoot,
				commit: source.commit,
				manifestSha256: stageReceipt.manifest_sha256,
				custodyPointer,
				custodyPointerSha256: selection.pointer_sha256,
				allowSelection: "yes",
			}, {
				beforeReactivateMove(target: string) {
					if (replacement === "inplace") {
						writeFileSync(target, "in-place mutation\n", { mode: 0o600 });
					} else if (replacement === "symlink") {
						unlinkSync(target);
						symlinkSync(path.join(managedRoot, "releases", source.commit, "dist/src/cli.js"), target);
					} else {
						unlinkSync(target);
						writeFileSync(target, "replacement\n", { mode: 0o600, flag: "wx" });
					}
				},
			})).toThrow("recovery-required");
			expect(existsSync(path.join(managedRoot, "current.json"))).toBe(false);
			expect(existsSync(custodyPointer)).toBe(false);
			expect(readdirSync(custody).some((name) => name.startsWith("reactivation-recovery-evidence-"))).toBe(true);
		}
	});

	test("deactivation rejects stale bindings and a held operation lock without mutation", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-deactivate-guards-"));
		const stageReceipt = JSON.parse(run(process.execPath, [
			scriptPath, "stage", "--source-root", source.root, "--commit", source.commit, "--managed-root", managedRoot,
		], undefined, runtimeBuilderEnv));
		const selection = JSON.parse(run(process.execPath, [
			scriptPath, "select", "--commit", source.commit, "--managed-root", managedRoot,
			"--expected-current", "none", "--allow-selection", "yes",
		], undefined, runtimeBuilderEnv));
		const pointerPath = path.join(managedRoot, "current.json");
		const before = await readFile(pointerPath);
		const stale = spawnSync(process.execPath, [
			scriptPath, "deactivate", "--managed-root", managedRoot,
			"--expected-current", source.commit,
			"--expected-current-manifest-sha256", "0".repeat(64),
			"--expected-pointer-sha256", selection.pointer_sha256,
			"--expected-previous", "none", "--allow-selection", "yes",
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(stale.status).toBe(1);
		expect(stale.stderr).toContain("manifest binding changed");
		expect(await readFile(pointerPath)).toEqual(before);

		const lock = path.join(managedRoot, ".notion-runtime-generation.lock");
		await writeFile(lock, "held\n", { mode: 0o600 });
		const held = spawnSync(process.execPath, [
			scriptPath, "deactivate", "--managed-root", managedRoot,
			"--expected-current", source.commit,
			"--expected-current-manifest-sha256", stageReceipt.manifest_sha256,
			"--expected-pointer-sha256", selection.pointer_sha256,
			"--expected-previous", "none", "--allow-selection", "yes",
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(held.status).toBe(1);
		expect(held.stderr).toContain("lock is already held");
		expect(await readFile(pointerPath)).toEqual(before);
	});

	test("stages a complete frozen origin/main runtime and readback detects dependency drift", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-managed-"));
		const receiptPath = path.join(managedRoot, "stage-receipt.json");
		const env = {
			...runtimeBuilderEnv,
			NOTION_TOKEN: "must-not-reach-build",
		};

		const stageOutput = run(process.execPath, [
			scriptPath,
			"stage",
			"--source-root", source.root,
			"--commit", source.commit,
			"--managed-root", managedRoot,
			"--receipt", receiptPath,
		], undefined, env);
		const stageReceipt = JSON.parse(stageOutput);
		expect(stageReceipt).toMatchObject({
			schema: "NotionRuntimeGenerationReceiptV1",
			action: "stage",
			state: "created",
			source_commit: source.commit,
		});
		expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual(stageReceipt);
		expect(stageReceipt.file_count).toBeGreaterThanOrEqual(5);

		const selectionArguments = [
			scriptPath,
			"select",
			"--commit", source.commit,
			"--managed-root", managedRoot,
			"--expected-current", "none",
			"--allow-selection", "yes",
		];
		const concurrentSelections = await Promise.all([
			runAsync(process.execPath, selectionArguments),
			runAsync(process.execPath, selectionArguments),
		]);
		const winners = concurrentSelections.filter((result) => result.status === 0);
		const losers = concurrentSelections.filter((result) => result.status !== 0);
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		expect(losers[0]!.stderr).toMatch(/lock is already held|current runtime selection changed|pointer is absent|already selected/);
		const selection = JSON.parse(winners[0]!.stdout);
		expect(selection).toMatchObject({ action: "select", state: "selected" });
		const staleSelection = spawnSync(process.execPath, [
			scriptPath,
			"select",
			"--commit", source.commit,
			"--managed-root", managedRoot,
			"--expected-current", "0".repeat(40),
			"--allow-selection", "yes",
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(staleSelection.status).toBe(1);
		expect(staleSelection.stderr).toContain("current runtime selection changed");

		const readback = JSON.parse(run(process.execPath, [
			scriptPath,
			"readback",
			"--managed-root", managedRoot,
		]));
		expect(readback.state).toBe("verified-current");
		expect(readback.manifest_sha256).toBe(stageReceipt.manifest_sha256);

		const dependency = path.join(
			managedRoot,
			"releases",
			source.commit,
			"dist",
			"src",
			"notion",
			"export-project-snapshot.js",
		);
		await chmod(dependency, 0o644);
		await writeFile(dependency, "export const drift = true;\n");
		await chmod(dependency, 0o444);
		const drift = spawnSync(process.execPath, [
			scriptPath,
			"readback",
			"--managed-root", managedRoot,
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(drift.status).toBe(1);
		expect(drift.stderr).toContain("runtime file manifest mismatch");
	});

	test("cleans its exact generation lock when staging cannot create a workspace", async () => {
		const source = await fixtureRepository();
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-lock-cleanup-"));
		await mkdir(path.join(managedRoot, "releases"), { mode: 0o555 });

		const result = spawnSync(process.execPath, [
			scriptPath,
			"stage",
			"--source-root", source.root,
			"--commit", source.commit,
			"--managed-root", managedRoot,
		], { encoding: "utf8", env: runtimeBuilderEnv });
		expect(result.status).toBe(1);
		expect(await readdir(managedRoot)).toEqual(["releases"]);
	});

	test("rejects a source commit that is not the verified origin/main", async () => {
		const source = await fixtureRepository();
		await writeFile(path.join(source.root, "extra.txt"), "new commit\n");
		run("/usr/bin/git", ["add", "extra.txt"], source.root);
		run("/usr/bin/git", ["commit", "-m", "not remote main"], source.root);
		const newCommit = run("/usr/bin/git", ["rev-parse", "HEAD"], source.root);
		const managedRoot = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-remote-ref-"));

		const result = spawnSync(process.execPath, [
			scriptPath,
			"stage",
			"--source-root", source.root,
			"--commit", newCommit,
			"--managed-root", managedRoot,
		], { encoding: "utf8" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("not the locally verified origin/main");
	});
});
