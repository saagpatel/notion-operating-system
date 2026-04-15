import { describe, expect, test } from "vitest";

import {
	type BridgeDbRow,
	buildBuildLogTitle,
	buildProjectNameIndex,
	buildTagProperty,
	markRowProcessed,
	readShippedRows,
} from "../src/notion/bridge-db-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRow(overrides: Partial<BridgeDbRow> = {}): BridgeDbRow {
	return {
		id: overrides.id ?? 1,
		source: overrides.source ?? "cc",
		timestamp: overrides.timestamp ?? "2026-04-14T10:00:00Z",
		project_name: overrides.project_name ?? "my-project",
		summary: overrides.summary ?? "Completed the feature.",
		branch: overrides.branch ?? null,
		tags: overrides.tags ?? '["SHIPPED"]',
	};
}

// ---------------------------------------------------------------------------
// A1 — markRowProcessed failure propagation
// ---------------------------------------------------------------------------

describe("markRowProcessed", () => {
	test("returns false when db path does not exist (non-zero exit from sqlite3)", () => {
		// sqlite3 will fail with non-zero exit because the file doesn't exist
		const result = markRowProcessed(
			"/tmp/nonexistent-bridge-test-12345.db",
			99,
		);
		expect(result).toBe(false);
	});

	test("returns false for a second distinct non-existent path (idempotent failure)", () => {
		const result = markRowProcessed(
			"/tmp/bridge-db-test-definitely-absent.db",
			42,
		);
		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// A1 — dry-run: no sqlite3 spawn, rowsWritten stays 0
// ---------------------------------------------------------------------------

describe("readShippedRows", () => {
	test("returns error result when db path does not exist", () => {
		const result = readShippedRows("/tmp/nonexistent-bridge.db", 10);
		expect(result.entries).toHaveLength(0);
		expect(result.error).toBeDefined();
	});

	test("returns empty entries array regardless of sqlite3 availability", () => {
		// When the db file does not exist, readShippedRows either:
		//   (a) returns result.error + result.entries=[] if sqlite3 is present and exits non-zero, or
		//   (b) returns result.error + result.entries=[] if sqlite3 is not installed at all.
		// Either way, `entries` must be an empty array (never undefined/null) so callers
		// can safely iterate. The sqlite3 "[]" stdout path (status=0, stdout="[]") cannot
		// be triggered without a real db file, so this test covers the non-existent-db path
		// and asserts the invariant that callers always get a defined, iterable entries array.
		const result = readShippedRows("/tmp/bridge-db-empty-test.db", 10);
		expect(Array.isArray(result.entries)).toBe(true);
		expect(result.entries).toHaveLength(0);
		// The non-existent-db path always sets an error — document this expectation
		// so a future change that swallows the error does not silently regress.
		expect(result.error).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// MINOR-5 — buildBuildLogTitle: all source values
// ---------------------------------------------------------------------------

describe("buildBuildLogTitle", () => {
	test("cc source produces CC prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "cc" }));
		expect(title).toContain("[CC]");
	});

	test("codex source produces Codex prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "codex" }));
		expect(title).toContain("[Codex]");
	});

	test("manual source produces Manual prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "manual" }));
		expect(title).toContain("[Manual]");
	});

	test("unknown source uses the raw source value as prefix", () => {
		const title = buildBuildLogTitle(baseRow({ source: "claude.ai" }));
		expect(title).toContain("[claude.ai]");
	});

	test("includes project name and date in title", () => {
		const title = buildBuildLogTitle(
			baseRow({
				project_name: "Ghost Routes",
				timestamp: "2026-04-14T10:00:00Z",
			}),
		);
		expect(title).toContain("Ghost Routes");
		expect(title).toContain("2026-04-14");
	});
});

// ---------------------------------------------------------------------------
// buildTagProperty — malformed tags JSON
// ---------------------------------------------------------------------------

describe("buildTagProperty", () => {
	test("handles valid tags JSON and filters SHIPPED/PROCESSED", () => {
		const result = buildTagProperty(
			baseRow({ source: "cc", tags: '["SHIPPED","feature","PROCESSED"]' }),
		);
		const names = result.multi_select.map((t) => t.name);
		expect(names).toContain("feature");
		expect(names).not.toContain("SHIPPED");
		expect(names).not.toContain("PROCESSED");
		expect(names).toContain("cc"); // source is appended
	});

	test("does not throw on malformed tags JSON", () => {
		expect(() =>
			buildTagProperty(baseRow({ source: "cc", tags: "not-valid-json{{{" })),
		).not.toThrow();
	});

	test("returns empty multi_select tags (plus source) when tags is empty JSON array", () => {
		const result = buildTagProperty(baseRow({ source: "codex", tags: "[]" }));
		const names = result.multi_select.map((t) => t.name);
		expect(names).toEqual(["codex"]);
	});
});

// ---------------------------------------------------------------------------
// buildProjectNameIndex — name resolution
// ---------------------------------------------------------------------------

describe("buildProjectNameIndex", () => {
	const projects = [
		{ id: "proj-1", title: "Ghost Routes" },
		{ id: "proj-2", title: "Calibrate" },
		{ id: "proj-3", title: "My Cool Project" },
	];

	test("exact match (case-insensitive)", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("ghost routes")).toBe("proj-1");
		expect(index.get("calibrate")).toBe("proj-2");
	});

	test("kebab-case variant matches", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("ghost-routes")).toBe("proj-1");
		expect(index.get("my-cool-project")).toBe("proj-3");
	});

	test("spaces-from-kebab variant matches", () => {
		const index = buildProjectNameIndex(projects);
		// "My Cool Project" lowercased and replace - → space
		expect(index.get("my cool project")).toBe("proj-3");
	});

	test("returns undefined for unmatched names", () => {
		const index = buildProjectNameIndex(projects);
		expect(index.get("nonexistent-project")).toBeUndefined();
	});
});
