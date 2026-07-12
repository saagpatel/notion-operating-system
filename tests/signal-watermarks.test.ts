import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
	getSignalWatermark,
	mergeSignalWatermarks,
	type SignalWatermark,
} from "../src/notion/signal-watermarks.js";

// ---------------------------------------------------------------------------
// Pure helpers — no I/O
// ---------------------------------------------------------------------------

describe("getSignalWatermark", () => {
	test("finds the watermark matching (provider, sourceId)", () => {
		const watermarks: SignalWatermark[] = [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-01",
			},
			{
				provider: "Notification Hub",
				sourceId: "nh-source-1",
				lastOccurredAt: "2026-06-05",
				lastEventId: "abc",
			},
		];

		expect(
			getSignalWatermark(watermarks, "Notification Hub", "nh-source-1"),
		).toEqual({
			provider: "Notification Hub",
			sourceId: "nh-source-1",
			lastOccurredAt: "2026-06-05",
			lastEventId: "abc",
		});
	});

	test("returns undefined when no watermark matches", () => {
		expect(getSignalWatermark([], "GitHub", "source-1")).toBeUndefined();
	});

	test("does not cross-match a different provider on the same sourceId", () => {
		const watermarks: SignalWatermark[] = [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-01",
			},
		];
		expect(
			getSignalWatermark(watermarks, "Vercel", "source-1"),
		).toBeUndefined();
	});
});

describe("mergeSignalWatermarks", () => {
	test("an update replaces the prior watermark sharing its (provider, sourceId) key", () => {
		const existing: SignalWatermark[] = [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-01",
			},
		];
		const merged = mergeSignalWatermarks(existing, [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-10",
			},
		]);

		expect(merged).toEqual([
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-10",
			},
		]);
	});

	test("an update for a new (provider, sourceId) key is appended, not dropped", () => {
		const existing: SignalWatermark[] = [
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-01",
			},
		];
		const merged = mergeSignalWatermarks(existing, [
			{
				provider: "Notification Hub",
				sourceId: "nh-source-1",
				lastOccurredAt: "2026-06-02",
			},
		]);

		expect(merged.map((w) => w.provider).sort()).toEqual([
			"GitHub",
			"Notification Hub",
		]);
	});
});

// ---------------------------------------------------------------------------
// loadSignalWatermarks / persistSignalWatermarks — filesystem round trip.
// Mirrors the dynamic-import pattern in snapshot-history.test.ts so
// DEFAULT_SIGNAL_WATERMARK_PATH picks up the stubbed env var at import time.
// ---------------------------------------------------------------------------

describe("loadSignalWatermarks / persistSignalWatermarks", () => {
	let tmpDir: string;
	let watermarkPath: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-watermark-test-"));
		watermarkPath = path.join(tmpDir, "signal-watermarks.json");
	});

	afterEach(async () => {
		vi.resetModules();
		await rm(tmpDir, { recursive: true, force: true });
	});

	async function importSignalWatermarks(envPath: string) {
		vi.stubEnv("NOTION_OS_SIGNAL_WATERMARK_PATH", envPath);
		vi.resetModules();
		const mod = await import("../src/notion/signal-watermarks.js");
		vi.unstubAllEnvs();
		return mod;
	}

	test("non-existent file → returns an empty list (rebuildable local cache)", async () => {
		const { loadSignalWatermarks } = await importSignalWatermarks(
			path.join(tmpDir, "does-not-exist.json"),
		);
		expect(await loadSignalWatermarks()).toEqual([]);
	});

	test("persisting then loading round-trips the watermark", async () => {
		const { loadSignalWatermarks, persistSignalWatermarks } =
			await importSignalWatermarks(watermarkPath);

		await persistSignalWatermarks([
			{
				provider: "Notification Hub",
				sourceId: "nh-source-1",
				lastOccurredAt: "2026-06-05",
				lastEventId: "evt-42",
			},
		]);

		expect(await loadSignalWatermarks()).toEqual([
			{
				provider: "Notification Hub",
				sourceId: "nh-source-1",
				lastOccurredAt: "2026-06-05",
				lastEventId: "evt-42",
			},
		]);
	});

	test("persisting again for the same (provider, sourceId) updates in place, not append", async () => {
		const { loadSignalWatermarks, persistSignalWatermarks } =
			await importSignalWatermarks(watermarkPath);

		await persistSignalWatermarks([
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-01",
			},
		]);
		await persistSignalWatermarks([
			{
				provider: "GitHub",
				sourceId: "source-1",
				lastOccurredAt: "2026-06-10",
			},
		]);

		const result = await loadSignalWatermarks();
		expect(result).toHaveLength(1);
		expect(result[0]?.lastOccurredAt).toBe("2026-06-10");
	});

	test("a malformed watermark file is skipped rather than throwing", async () => {
		await writeFile(watermarkPath, "NOT_VALID_JSON{{{", "utf8");
		const { loadSignalWatermarks } =
			await importSignalWatermarks(watermarkPath);

		expect(await loadSignalWatermarks()).toEqual([]);
	});

	test("calling persistSignalWatermarks with an empty list is a no-op (does not create the file)", async () => {
		const { loadSignalWatermarks, persistSignalWatermarks } =
			await importSignalWatermarks(watermarkPath);

		await persistSignalWatermarks([]);

		expect(await loadSignalWatermarks()).toEqual([]);
	});
});
