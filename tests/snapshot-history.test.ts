import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ProjectSnapshot } from "../src/notion/snapshot-history.js";
import { renderTrendReport } from "../src/notion/snapshot-history.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnap(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
	return {
		snapshotDate: "2026-04-10",
		projectId: "proj-1",
		projectTitle: "Test Project",
		operatingQueue: "Worth Finishing",
		evidenceFreshness: "Fresh",
		recommendationScore: 0,
		buildSessionCount: 2,
		openPrCount: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// readAllSnapshots — tested via filesystem
// We write real files and import the function fresh with the env var set
// before module load so DEFAULT_SNAPSHOT_PATH picks up the override.
// ---------------------------------------------------------------------------

describe("readAllSnapshots", () => {
	let tmpDir: string;
	let snapshotPath: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "snapshot-test-"));
		snapshotPath = path.join(tmpDir, "snapshots.jsonl");
	});

	afterEach(async () => {
		vi.resetModules();
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function importReadAllSnapshots(envPath: string) {
		vi.stubEnv("NOTION_OS_SNAPSHOT_PATH", envPath);
		// Reset modules so DEFAULT_SNAPSHOT_PATH is re-evaluated with the new env var
		vi.resetModules();
		const mod = await import("../src/notion/snapshot-history.js");
		vi.unstubAllEnvs();
		return mod.readAllSnapshots;
	}

	test("non-existent file path → returns []", async () => {
		const nonExistent = path.join(tmpDir, "does-not-exist.jsonl");
		const readAllSnapshots = await importReadAllSnapshots(nonExistent);
		const result = await readAllSnapshots();
		expect(result).toEqual([]);
	});

	test("file with valid snapshots → returns parsed array with correct field values", async () => {
		const snap1 = makeSnap({ projectId: "proj-1", projectTitle: "Alpha" });
		const snap2 = makeSnap({
			projectId: "proj-2",
			projectTitle: "Beta",
			snapshotDate: "2026-04-11",
		});
		await writeFile(
			snapshotPath,
			[JSON.stringify(snap1), JSON.stringify(snap2)].join("\n") + "\n",
			"utf8",
		);
		const readAllSnapshots = await importReadAllSnapshots(snapshotPath);
		const result = await readAllSnapshots();
		expect(result).toHaveLength(2);
		expect(result[0]?.projectId).toBe("proj-1");
		expect(result[1]?.projectTitle).toBe("Beta");
	});

	test("file with one valid line and one malformed line → returns only valid one (does NOT throw)", async () => {
		const validSnap = makeSnap({ projectId: "proj-ok" });
		await writeFile(
			snapshotPath,
			JSON.stringify(validSnap) + "\n" + "NOT_VALID_JSON{{{bad\n",
			"utf8",
		);
		const readAllSnapshots = await importReadAllSnapshots(snapshotPath);
		const result = await readAllSnapshots();
		expect(result).toHaveLength(1);
		expect(result[0]?.projectId).toBe("proj-ok");
	});
});

// ---------------------------------------------------------------------------
// renderTrendReport — pure function, no I/O
// ---------------------------------------------------------------------------

describe("renderTrendReport", () => {
	const TODAY = "2026-04-14";

	test("empty array → contains no-snapshot-history message", () => {
		const report = renderTrendReport([], TODAY);
		expect(report).toContain("No snapshot history yet.");
	});

	test("two snapshots same project same queue → no anomalies detected", () => {
		const snaps = [
			makeSnap({
				snapshotDate: "2026-04-09",
				operatingQueue: "Worth Finishing",
			}),
			makeSnap({
				snapshotDate: "2026-04-10",
				operatingQueue: "Worth Finishing",
			}),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("No anomalies detected.");
		expect(report).not.toContain("Queue Changes");
	});

	test("two snapshots same project different queues → queue change row appears", () => {
		const snaps = [
			makeSnap({
				snapshotDate: "2026-04-09",
				operatingQueue: "Worth Finishing",
			}),
			makeSnap({ snapshotDate: "2026-04-10", operatingQueue: "Resume Now" }),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("Queue Changes");
		expect(report).toContain("Worth Finishing");
		expect(report).toContain("Resume Now");
		expect(report).not.toContain("No anomalies detected.");
	});

	test("3 consecutive stale entries → sustained stale section appears", () => {
		const snaps = [
			makeSnap({ snapshotDate: "2026-04-08", evidenceFreshness: "Stale" }),
			makeSnap({ snapshotDate: "2026-04-09", evidenceFreshness: "Stale" }),
			makeSnap({ snapshotDate: "2026-04-10", evidenceFreshness: "Stale" }),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("Sustained Stale Evidence");
		expect(report).toContain("Test Project");
		expect(report).not.toContain("No anomalies detected.");
	});

	test("2 consecutive stale entries → sustained stale section does NOT appear", () => {
		const snaps = [
			makeSnap({ snapshotDate: "2026-04-09", evidenceFreshness: "Stale" }),
			makeSnap({ snapshotDate: "2026-04-10", evidenceFreshness: "Stale" }),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).not.toContain("Sustained Stale Evidence");
		expect(report).toContain("No anomalies detected.");
	});

	test("mix of queue change AND sustained stale → both sections appear", () => {
		// Project 1: queue change
		const proj1Snaps = [
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-09",
				operatingQueue: "Worth Finishing",
				evidenceFreshness: "Fresh",
			}),
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-10",
				operatingQueue: "Resume Now",
				evidenceFreshness: "Fresh",
			}),
		];

		// Project 2: 3 stale in a row
		const proj2Snaps = [
			makeSnap({
				projectId: "proj-2",
				projectTitle: "Stale Project",
				snapshotDate: "2026-04-08",
				evidenceFreshness: "Stale",
			}),
			makeSnap({
				projectId: "proj-2",
				projectTitle: "Stale Project",
				snapshotDate: "2026-04-09",
				evidenceFreshness: "Stale",
			}),
			makeSnap({
				projectId: "proj-2",
				projectTitle: "Stale Project",
				snapshotDate: "2026-04-10",
				evidenceFreshness: "Stale",
			}),
		];

		const report = renderTrendReport([...proj1Snaps, ...proj2Snaps], TODAY);
		expect(report).toContain("Queue Changes");
		expect(report).toContain("Sustained Stale Evidence");
		expect(report).not.toContain("No anomalies detected.");
	});
});
