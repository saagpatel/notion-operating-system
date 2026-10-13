import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

const script = fileURLToPath(
	new URL("../scripts/audit-report.mjs", import.meta.url),
);
const workspaces: string[] = [];
const clean = {
	metadata: {
		vulnerabilities: {
			info: 0,
			low: 0,
			moderate: 0,
			high: 0,
			critical: 0,
			total: 0,
		},
	},
};
const vulnerable = {
	metadata: {
		vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1, total: 1 },
	},
};

afterEach(async () => {
	await Promise.all(
		workspaces
			.splice(0)
			.map((workspace) => rm(workspace, { recursive: true, force: true })),
	);
});

async function runReport(input: unknown, flags: string[] = []) {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "notion-audit-test-"));
	workspaces.push(workspace);
	const inputPath = path.join(workspace, "audit.json");
	await writeFile(
		inputPath,
		typeof input === "string" ? input : JSON.stringify(input),
		"utf8",
	);
	return spawnSync(process.execPath, [script, inputPath, ...flags], {
		encoding: "utf8",
	});
}

describe("audit report gate", () => {
	test.each([{ flags: [] }, { flags: ["--fail-on-vulnerabilities"] }])(
		"accepts a clean report with flags $flags",
		async ({ flags }) => {
			const result = await runReport(clean, flags);
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual({
				ok: true,
				...clean.metadata.vulnerabilities,
			});
		},
	);

	test.each([
		{ flags: [], status: 0 },
		{ flags: ["--fail-on-vulnerabilities"], status: 1 },
	])(
		"reports genuine vulnerabilities with flags $flags",
		async ({ flags, status }) => {
			const result = await runReport(vulnerable, flags);
			expect(result.status).toBe(status);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual({
				ok: false,
				...vulnerable.metadata.vulnerabilities,
			});
		},
	);

	test.each([
		{
			input: { error: { code: "ENOAUDIT", summary: "audit unavailable" } },
			message: "contains an error",
		},
		{
			input: { ...clean, error: { code: "EFAIL" } },
			message: "contains an error",
		},
		{ input: {}, message: "metadata.vulnerabilities" },
		{
			input: { metadata: { vulnerabilities: null } },
			message: "metadata.vulnerabilities",
		},
		{ input: { metadata: { vulnerabilities: {} } }, message: "total" },
		{
			input: { metadata: { vulnerabilities: { total: "unknown" } } },
			message: "total",
		},
		{ input: "{malformed", message: "Invalid audit JSON" },
	])(
		"rejects unusable reports: $message ($input)",
		async ({ input, message }) => {
			for (const flags of [[], ["--fail-on-vulnerabilities"]]) {
				const result = await runReport(input, flags);
				expect(result.status).toBe(1);
				expect(result.stderr).toContain(message);
				expect(result.stdout).toBe("");
			}
		},
	);
});

describe("workflow audit steps", () => {
	test.each([
		{ input: clean, auditStatus: 0, ciStatus: 0, hygieneStatus: 0 },
		{ input: vulnerable, auditStatus: 1, ciStatus: 0, hygieneStatus: 1 },
		{ input: clean, auditStatus: 2, ciStatus: 2, hygieneStatus: 2 },
		{
			input: { error: { code: "ENOAUDIT" } },
			auditStatus: 1,
			ciStatus: 1,
			hygieneStatus: 1,
		},
		{ input: {}, auditStatus: 0, ciStatus: 1, hygieneStatus: 1 },
		{ input: "{malformed", auditStatus: 0, ciStatus: 1, hygieneStatus: 1 },
	])(
		"preserves the gate for npm status $auditStatus and report $input",
		async ({ input, auditStatus, ciStatus, hygieneStatus }) => {
			const workspace = await mkdtemp(
				path.join(os.tmpdir(), "notion-audit-workflow-"),
			);
			workspaces.push(workspace);
			const bin = path.join(workspace, "bin");
			await mkdir(bin);
			await symlink(
				fileURLToPath(new URL("../scripts", import.meta.url)),
				path.join(workspace, "scripts"),
			);
			await writeFile(
				path.join(bin, "npm"),
				`#!${process.execPath}\nprocess.stdout.write(process.env.FAKE_AUDIT_JSON);\nprocess.exit(Number(process.env.FAKE_AUDIT_STATUS));\n`,
				{ mode: 0o700 },
			);

			for (const [workflowName, expectedStatus] of [
				["ci.yml", ciStatus],
				["dependency-hygiene.yml", hygieneStatus],
			] as const) {
				const workflow = await readFile(
					new URL(`../.github/workflows/${workflowName}`, import.meta.url),
					"utf8",
				);
				const step = workflow
					.match(/run: \|\n((?:          [^\n]*\n)+)/g)
					?.find((block) => block.includes("npm audit --json"));
				expect(step).toBeDefined();
				const shell = step!
					.replace(/^run: \|\n/, "")
					.replace(/^          /gm, "");
				const result = spawnSync(
					"bash",
					["-e", "-o", "pipefail", "-c", shell],
					{
						cwd: workspace,
						encoding: "utf8",
						env: {
							...process.env,
							PATH: `${bin}${path.delimiter}${process.env.PATH}`,
							FAKE_AUDIT_JSON:
								typeof input === "string" ? input : JSON.stringify(input),
							FAKE_AUDIT_STATUS: String(auditStatus),
						},
					},
				);
				expect(result.status, result.stderr).toBe(expectedStatus);
				if (input === vulnerable) {
					expect(JSON.parse(result.stdout)).toEqual({
						ok: false,
						...vulnerable.metadata.vulnerabilities,
					});
				}
			}
		},
	);
});
