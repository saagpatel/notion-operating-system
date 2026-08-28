import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

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
