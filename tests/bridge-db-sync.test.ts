import { describe, expect, test } from "vitest";

import {
	type BridgeDbRow,
	buildBuildLogTitle,
	buildProjectNameIndex,
	buildTagProperty,
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

// Note: readShippedRows and markRowProcessed are now async MCP-backed functions.
// They are tested in bridge-db-mcp-client integration tests, not here.
// Formatting helpers below remain synchronous and are unit-tested here.

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
