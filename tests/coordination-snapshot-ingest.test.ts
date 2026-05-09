import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCli } from "../src/cli/runner.js";
import {
	buildCoordinationSnapshotIngestionPlan,
	formatCoordinationSnapshotIngestionPlan,
} from "../src/notion/coordination-snapshot-ingest.js";

describe("Personal Ops coordination snapshot ingestion", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	test("builds a dry-run-only ingestion plan from the Personal Ops export payload", () => {
		const plan = buildCoordinationSnapshotIngestionPlan(exportFixture(), new Date("2026-05-09T00:00:00.000Z"));
		const formatted = formatCoordinationSnapshotIngestionPlan(plan);

		expect(plan.mode).toBe("dry_run");
		expect(plan.summary).toEqual({
			rows_seen: 2,
			items_planned: 2,
			needs_review: 1,
			archive_candidates: 1,
		});
		expect(plan.items[0]).toEqual(
			expect.objectContaining({
				provider_key: "personal_ops_coordination_snapshot",
				target: "external_signal_events",
				would_write: false,
				severity: "Info",
			}),
		);
		expect(plan.items[1]?.severity).toBe("Risk");
		expect(formatted).toContain("Planned writes: 0");
	});

	test("CLI exposes the dry-run plan without requiring Notion credentials", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "notion-coordination-snapshot-"));
		tempDirs.push(tempDir);
		const inputPath = join(tempDir, "coordination-export.json");
		await writeFile(inputPath, JSON.stringify({ coordination_notion_export: exportFixture() }, null, 2), "utf8");

		const result = await runCliForTest(["signals", "coordination-snapshot", "--input", inputPath, "--json"]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout).coordination_snapshot_ingestion_plan.mode).toBe("dry_run");
	});
});

function exportFixture() {
	return {
		schema_version: "personal_ops.coordination_notion_export.v1",
		generated_at: "2026-05-09T00:00:00.000Z",
		mode: "export_only",
		destination: "notion_external_signal_provider",
		snapshot_id: "coordination-20260509T000000Z",
		next_actions: [],
		rows: [
			{
				schema_version: "personal_ops.coordination_notion_signal.v1",
				snapshot_id: "coordination-20260509T000000Z",
				generated_at: "2026-05-09T00:00:00.000Z",
				source: "personal_ops",
				project_key: "personal-ops",
				project_title: "Personal Ops health",
				summary: "Personal Ops health is ready.",
				status: "ok",
				urgency: "low",
				needs_review: false,
				archive_candidate: true,
				confidence: "high",
				freshness_at: "2026-05-09T00:00:00.000Z",
				evidence_refs: ["personal-ops health check --deep --json"],
				dedupe_key: "coordination-20260509T000000Z:health:green",
				raw_excerpt: "Personal Ops health is ready.",
			},
			{
				schema_version: "personal_ops.coordination_notion_signal.v1",
				snapshot_id: "coordination-20260509T000000Z",
				generated_at: "2026-05-09T00:00:00.000Z",
				source: "notification_hub",
				project_key: "notification_hub",
				project_title: "notification-hub",
				summary: "notification-hub health endpoint is not reachable",
				status: "needs_attention",
				urgency: "high",
				needs_review: true,
				archive_candidate: false,
				confidence: "low",
				freshness_at: null,
				evidence_refs: ["http://127.0.0.1:9199/health"],
				dedupe_key: "coordination-20260509T000000Z:source:notification_hub:degraded",
				raw_excerpt: "notification-hub health endpoint is not reachable",
			},
		],
	};
}

async function runCliForTest(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const stdout: string[] = [];
	const stderr: string[] = [];
	let exitCode = 0;
	const previousLog = console.log;
	const previousError = console.error;
	try {
		console.log = (...values: unknown[]) => stdout.push(values.map((value) => String(value)).join(" "));
		console.error = (...values: unknown[]) => stderr.push(values.map((value) => String(value)).join(" "));
		await runCli(argv, {
			stdout: (value) => stdout.push(value),
			stderr: (value) => stderr.push(value),
			setExitCode: (code) => {
				exitCode = code;
			},
		});
	} finally {
		console.log = previousLog;
		console.error = previousError;
	}
	return {
		stdout: stdout.join("\n"),
		stderr: stderr.join("\n"),
		exitCode,
	};
}
