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

	test("duplicate (projectId, snapshotDate) rows on disk → dedupes to the last-written one (P5)", async () => {
		const stale = makeSnap({
			projectId: "proj-1",
			operatingQueue: "Cold Storage",
		});
		const fresh = makeSnap({
			projectId: "proj-1",
			operatingQueue: "Resume Now",
		});
		await writeFile(
			snapshotPath,
			[JSON.stringify(stale), JSON.stringify(fresh)].join("\n") + "\n",
			"utf8",
		);
		const readAllSnapshots = await importReadAllSnapshots(snapshotPath);
		const result = await readAllSnapshots();
		expect(result).toHaveLength(1);
		expect(result[0]?.operatingQueue).toBe("Resume Now");
	});
});

// ---------------------------------------------------------------------------
// appendSnapshotBatch — same-day idempotency (P5)
// ---------------------------------------------------------------------------

describe("appendSnapshotBatch", () => {
	let tmpDir: string;
	let snapshotPath: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "snapshot-append-test-"));
		snapshotPath = path.join(tmpDir, "snapshots.jsonl");
	});

	afterEach(async () => {
		vi.resetModules();
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function importSnapshotHistory(envPath: string) {
		vi.stubEnv("NOTION_OS_SNAPSHOT_PATH", envPath);
		vi.resetModules();
		const mod = await import("../src/notion/snapshot-history.js");
		vi.unstubAllEnvs();
		return mod;
	}

	test("running the same batch twice in a day writes exactly one row per project (P5)", async () => {
		const { appendSnapshotBatch, readAllSnapshots } =
			await importSnapshotHistory(snapshotPath);
		const batch = [
			{
				id: "proj-1",
				title: "Alpha",
				operatingQueue: "Worth Finishing",
				evidenceFreshness: "Fresh",
				buildSessionCount: 2,
				openPrCount: 1,
			},
		];

		await appendSnapshotBatch(batch, "2026-04-10");
		await appendSnapshotBatch(batch, "2026-04-10");

		const result = await readAllSnapshots();
		expect(result).toHaveLength(1);
		expect(result[0]?.projectId).toBe("proj-1");
	});

	test("a same-day rerun still appends genuinely new projects (P5)", async () => {
		const { appendSnapshotBatch, readAllSnapshots } =
			await importSnapshotHistory(snapshotPath);
		const first = [
			{
				id: "proj-1",
				title: "Alpha",
				operatingQueue: "Worth Finishing",
				evidenceFreshness: "Fresh",
				buildSessionCount: 2,
			},
		];
		const second = [
			...first,
			{
				id: "proj-2",
				title: "Beta",
				operatingQueue: "Resume Now",
				evidenceFreshness: "Stale",
				buildSessionCount: 5,
			},
		];

		await appendSnapshotBatch(first, "2026-04-10");
		await appendSnapshotBatch(second, "2026-04-10");

		const result = await readAllSnapshots();
		expect(result.map((s) => s.projectId).sort()).toEqual(["proj-1", "proj-2"]);
	});

	test("a different day's batch is not treated as a duplicate (P5)", async () => {
		const { appendSnapshotBatch, readAllSnapshots } =
			await importSnapshotHistory(snapshotPath);
		const batch = [
			{
				id: "proj-1",
				title: "Alpha",
				operatingQueue: "Worth Finishing",
				evidenceFreshness: "Fresh",
				buildSessionCount: 2,
			},
		];

		await appendSnapshotBatch(batch, "2026-04-10");
		await appendSnapshotBatch(batch, "2026-04-11");

		const result = await readAllSnapshots();
		expect(result).toHaveLength(2);
		expect(result.map((s) => s.snapshotDate).sort()).toEqual([
			"2026-04-10",
			"2026-04-11",
		]);
	});

	test("an unset Open PR Count is persisted as null, not fabricated as 0 (P5)", async () => {
		const { appendSnapshotBatch, readAllSnapshots } =
			await importSnapshotHistory(snapshotPath);
		const batch = [
			{
				id: "proj-1",
				title: "Alpha",
				operatingQueue: "Worth Finishing",
				evidenceFreshness: "Fresh",
				buildSessionCount: 2,
				openPrCount: null,
			},
		];

		await appendSnapshotBatch(batch, "2026-04-10");

		const result = await readAllSnapshots();
		expect(result[0]?.openPrCount).toBeNull();
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
		expect(report).toContain("Portfolio Movement");
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
		expect(report).toContain("Portfolio Movement");
		expect(report).toContain("Worth Finishing");
		expect(report).toContain("Resume Now");
		expect(report).not.toContain("No anomalies detected.");
	});

	test("latest two snapshot dates → portfolio movement table shows metric deltas", () => {
		const snaps = [
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-09",
				evidenceFreshness: "Fresh",
				recommendationScore: 2,
				openPrCount: 0,
			}),
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-10",
				evidenceFreshness: "Stale",
				recommendationScore: 4,
				openPrCount: 1,
			}),
			makeSnap({
				projectId: "proj-2",
				projectTitle: "Second Project",
				snapshotDate: "2026-04-10",
				evidenceFreshness: "Fresh",
				recommendationScore: 6,
				openPrCount: 0,
			}),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("Comparing 2026-04-09 to 2026-04-10");
		expect(report).toContain("| Projects tracked | 1 | 2 | +1 |");
		expect(report).toContain("| Stale evidence | 0 | 1 | +1 |");
		expect(report).toContain("| Open PRs | 0 | 1 | +1 |");
		expect(report).toContain(
			"| Average recommendation score | 2.0 | 5.0 | +3.0 |",
		);
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

	test("same-day duplicate stale snapshots count as one trend observation", () => {
		const snaps = [
			makeSnap({ snapshotDate: "2026-04-09", evidenceFreshness: "Fresh" }),
			makeSnap({ snapshotDate: "2026-04-10", evidenceFreshness: "Stale" }),
			makeSnap({ snapshotDate: "2026-04-10", evidenceFreshness: "Stale" }),
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

	test("unknown Open PR Count renders as an annotated cell, never a fabricated 0 (P5)", () => {
		const snaps = [
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-09",
				openPrCount: 2,
			}),
			makeSnap({
				projectId: "proj-1",
				snapshotDate: "2026-04-10",
				openPrCount: 2,
			}),
			makeSnap({
				projectId: "proj-2",
				projectTitle: "Second Project",
				snapshotDate: "2026-04-10",
				openPrCount: null,
			}),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("| Open PRs | 2 | 2 (1 unknown) |");
		expect(report).toContain(
			"Open PRs total excludes projects where Open PR Count has not yet been captured",
		);
	});

	test("all-known Open PR Counts render as a plain number, matching pre-P5 output", () => {
		const snaps = [
			makeSnap({ snapshotDate: "2026-04-09", openPrCount: 0 }),
			makeSnap({ snapshotDate: "2026-04-10", openPrCount: 1 }),
		];
		const report = renderTrendReport(snaps, TODAY);
		expect(report).toContain("| Open PRs | 0 | 1 | +1 |");
		expect(report).not.toContain("unknown");
	});
});
