import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Durable per-(provider, source) cursor for the external-signal layer (P3).
// This is a rebuildable local cache, not a source of truth: deleting the
// file just means the next run re-derives dedup state from live Notion
// queries and (for notification_hub) re-scans the JSONL log from the start.
// Mirrors the persistence style of snapshot-history.ts.

export const DEFAULT_SIGNAL_WATERMARK_PATH: string =
	process.env["NOTION_OS_SIGNAL_WATERMARK_PATH"] ??
	path.join(
		os.homedir(),
		".local",
		"share",
		"notion-os",
		"signal-watermarks.json",
	);

export interface SignalWatermark {
	provider: string;
	sourceId: string;
	lastOccurredAt: string;
	lastEventId?: string;
}

function watermarkKey(provider: string, sourceId: string): string {
	return `${provider}::${sourceId}`;
}

export async function loadSignalWatermarks(): Promise<SignalWatermark[]> {
	let raw: string;
	try {
		raw = await readFile(DEFAULT_SIGNAL_WATERMARK_PATH, "utf8");
	} catch (err: unknown) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return [];
		}
		throw err;
	}

	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isSignalWatermark) : [];
	} catch {
		console.warn(
			`[signal-watermarks] Skipping unreadable watermark file at ${DEFAULT_SIGNAL_WATERMARK_PATH}`,
		);
		return [];
	}
}

export function getSignalWatermark(
	watermarks: SignalWatermark[],
	provider: string,
	sourceId: string,
): SignalWatermark | undefined {
	const key = watermarkKey(provider, sourceId);
	return watermarks.find(
		(watermark) => watermarkKey(watermark.provider, watermark.sourceId) === key,
	);
}

/** Pure merge: an update replaces any prior watermark sharing its (provider, sourceId) key. */
export function mergeSignalWatermarks(
	existing: SignalWatermark[],
	updates: SignalWatermark[],
): SignalWatermark[] {
	const byKey = new Map(
		existing.map((watermark) => [
			watermarkKey(watermark.provider, watermark.sourceId),
			watermark,
		]),
	);
	for (const update of updates) {
		byKey.set(watermarkKey(update.provider, update.sourceId), update);
	}
	return [...byKey.values()];
}

/**
 * Loads the current watermark file, merges in `updates`, and writes the
 * result back. Call only after the writes the watermark represents have
 * actually landed — advancing a cursor past events that were never
 * confirmed written would silently drop them on the next run.
 */
export async function persistSignalWatermarks(
	updates: SignalWatermark[],
): Promise<void> {
	if (updates.length === 0) {
		return;
	}
	const dir = path.dirname(DEFAULT_SIGNAL_WATERMARK_PATH);
	await mkdir(dir, { recursive: true });
	const existing = await loadSignalWatermarks();
	const merged = mergeSignalWatermarks(existing, updates);
	await writeFile(
		DEFAULT_SIGNAL_WATERMARK_PATH,
		JSON.stringify(merged, null, 2) + "\n",
		"utf8",
	);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

function isSignalWatermark(value: unknown): value is SignalWatermark {
	if (!value || typeof value !== "object") {
		return false;
	}
	const obj = value as Record<string, unknown>;
	return (
		typeof obj["provider"] === "string" &&
		typeof obj["sourceId"] === "string" &&
		typeof obj["lastOccurredAt"] === "string" &&
		(obj["lastEventId"] === undefined || typeof obj["lastEventId"] === "string")
	);
}
