import { describe, expect, test } from "vitest";

import {
	buildAppendSectionTailUpdate,
	buildInsertSectionAfterHeadingUpdate,
	isNotionPolicyBlockedError,
	syncManagedMarkdownSection,
	syncManagedMarkdownSectionWithReadBack,
} from "../src/notion/managed-markdown-sync.js";
import {
	limitRelationIds,
	stripLeadingMarkdownTitle,
} from "../src/notion/review-packet.js";
import { AppError } from "../src/utils/errors.js";
import {
	extractManagedSection,
	mergeManagedSection,
	normalizeMarkdown,
	pageMarkdownMatches,
} from "../src/utils/markdown.js";

describe("managed markdown sync", () => {
	test("strips the database title heading from weekly review page bodies", () => {
		const markdown = [
			"# Week of 2026-05-04",
			"",
			"Review window: Since 2026-04-27",
		].join("\n");

		expect(stripLeadingMarkdownTitle(markdown, "Week of 2026-05-04")).toBe(
			"Review window: Since 2026-04-27",
		);
		expect(stripLeadingMarkdownTitle(markdown, "Different title")).toBe(
			markdown,
		);
	});

	test("compares page markdown idempotently with or without the Notion title heading", () => {
		const expected = [
			"# Local Portfolio Command Center",
			"",
			"Updated: 2026-05-09",
			"<!-- codex:notion-example:start -->",
			"## Example",
			"- Stable",
			"<!-- codex:notion-example:end -->",
		].join("\n");
		const actual = [
			"Updated: 2026-05-09",
			"\\<!-- codex:notion-example:start --\\>",
			"## Example",
			"- Stable",
			"\\<!-- codex:notion-example:end --\\>",
		].join("\n");

		expect(
			pageMarkdownMatches({
				expectedMarkdown: expected,
				actualMarkdown: actual,
				title: "Local Portfolio Command Center",
			}),
		).toBe(true);
	});

	test("builds a unique tail update for first-time managed section inserts", () => {
		const previousMarkdown = [
			"# Project",
			"## Notes",
			"This page already has a stable tail that should be unique for the append helper.",
			"Closing line for the unique tail.",
		].join("\n\n");
		const nextSection = [
			"<!-- codex:notion-execution-brief:start -->",
			"## Execution Brief",
			"- One next action",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");

		const update = buildAppendSectionTailUpdate(previousMarkdown, nextSection);

		expect(update).toBeDefined();
		expect(update?.newStr).toContain(nextSection);
		expect(update?.replaceAllMatches).toBe(false);
	});

	test("can insert a first managed section after the page heading", () => {
		const previousMarkdown = [
			"# RAG Knowledge Base",
			"Intro paragraph.",
			"More detail.",
		].join("\n\n");
		const nextSection = [
			"<!-- codex:notion-execution-brief:start -->",
			"## Execution Brief",
			"- One next action",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");

		const update = buildInsertSectionAfterHeadingUpdate(
			previousMarkdown,
			nextSection,
		);

		expect(update).toEqual({
			oldStr: "# RAG Knowledge Base",
			newStr: `# RAG Knowledge Base\n\n${nextSection}`,
			replaceAllMatches: false,
		});
	});

	test("detects Cloudflare-backed policy blocks", () => {
		const error = new AppError("blocked", {
			status: 403,
			body: "<html><title>Cloudflare</title><h1>Sorry, you have been blocked</h1></html>",
		});

		expect(isNotionPolicyBlockedError(error)).toBe(true);
		expect(
			isNotionPolicyBlockedError(
				new AppError("bad request", { status: 400, body: "validation" }),
			),
		).toBe(false);
	});

	test("falls back to safe replacement when section update is Cloudflare-blocked", async () => {
		const previousMarkdown = [
			"# Project",
			"<!-- codex:notion-execution-brief:start -->",
			"old",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const calls: Array<{ command: string }> = [];
		const api = {
			patchPageMarkdown: async (input: { command: string }) => {
				calls.push({ command: input.command });
				if (input.command === "update_content") {
					throw new AppError("blocked", {
						status: 403,
						body: "<html><title>Cloudflare</title><h1>Sorry, you have been blocked</h1></html>",
					});
				}
			},
		};

		const mode = await syncManagedMarkdownSection({
			api: api as never,
			pageId: "page-1",
			previousMarkdown,
			nextMarkdown,
			startMarker: "<!-- codex:notion-execution-brief:start -->",
			endMarker: "<!-- codex:notion-execution-brief:end -->",
		});

		expect(mode).toBe("replace_content");
		expect(calls.map((call) => call.command)).toEqual([
			"update_content",
			"replace_content",
		]);
	});

	test("treats an ambiguous markdown PATCH transport error as success when read-back already converged", async () => {
		const previousMarkdown = [
			"# Project",
			"<!-- codex:notion-execution-brief:start -->",
			"old",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const patchInputs: Array<{ command: string; maxAttempts?: number }> = [];
		const api = {
			patchPageMarkdown: async (input: {
				command: string;
				maxAttempts?: number;
			}) => {
				patchInputs.push(input);
				throw new AppError(
					"Notion request transport error after 1 attempt(s) for PATCH /pages/page-1/markdown",
				);
			},
			readPageMarkdown: async () => ({
				markdown: nextMarkdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		const mode = await syncManagedMarkdownSectionWithReadBack({
			api: api as never,
			pageId: "page-1",
			previousMarkdown,
			nextMarkdown,
			startMarker: "<!-- codex:notion-execution-brief:start -->",
			endMarker: "<!-- codex:notion-execution-brief:end -->",
			maxAttempts: 2,
		});

		expect(mode).toBe("read_back_converged");
		expect(patchInputs).toEqual([
			expect.objectContaining({ command: "update_content" }),
		]);
	});

	test("recomputes from read-back markdown before retrying an ambiguous managed-section write", async () => {
		const previousMarkdown = [
			"# Project",
			"<!-- codex:notion-execution-brief:start -->",
			"old",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");
		const staleReadBack = previousMarkdown.replace("old", "still old");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const patchInputs: Array<{
			command: string;
			contentUpdates?: Array<{ oldStr: string }>;
			maxAttempts?: number;
		}> = [];
		const api = {
			patchPageMarkdown: async (input: {
				command: string;
				contentUpdates?: Array<{ oldStr: string }>;
				maxAttempts?: number;
			}) => {
				patchInputs.push(input);
				if (patchInputs.length === 1) {
					throw new AppError(
						"Notion request returned retryable error responses after 1 attempt(s) for PATCH /pages/page-1/markdown",
					);
				}
			},
			readPageMarkdown: async () => ({
				markdown: staleReadBack,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		const mode = await syncManagedMarkdownSectionWithReadBack({
			api: api as never,
			pageId: "page-1",
			previousMarkdown,
			nextMarkdown,
			startMarker: "<!-- codex:notion-execution-brief:start -->",
			endMarker: "<!-- codex:notion-execution-brief:end -->",
			maxAttempts: 2,
		});

		expect(mode).toBe("update_content");
		expect(patchInputs).toHaveLength(2);
		expect(patchInputs[1]?.contentUpdates?.[0]?.oldStr).toContain("still old");
	});

	test("forwards undefined patchMaxAttempts so the http client default applies", async () => {
		const previousMarkdown = [
			"# Project",
			"<!-- codex:notion-execution-brief:start -->",
			"old",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const patchInputs: Array<{ command: string; maxAttempts?: number }> = [];
		const api = {
			patchPageMarkdown: async (input: {
				command: string;
				maxAttempts?: number;
			}) => {
				patchInputs.push(input);
			},
			readPageMarkdown: async () => ({
				markdown: nextMarkdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		await syncManagedMarkdownSectionWithReadBack({
			api: api as never,
			pageId: "page-1",
			previousMarkdown,
			nextMarkdown,
			startMarker: "<!-- codex:notion-execution-brief:start -->",
			endMarker: "<!-- codex:notion-execution-brief:end -->",
		});

		expect(patchInputs).toHaveLength(1);
		expect(patchInputs[0]?.maxAttempts).toBeUndefined();
	});

	test("forwards an explicit patchMaxAttempts override to the inner PATCH", async () => {
		const previousMarkdown = [
			"# Project",
			"<!-- codex:notion-execution-brief:start -->",
			"old",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const patchInputs: Array<{ command: string; maxAttempts?: number }> = [];
		const api = {
			patchPageMarkdown: async (input: {
				command: string;
				maxAttempts?: number;
			}) => {
				patchInputs.push(input);
			},
			readPageMarkdown: async () => ({
				markdown: nextMarkdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		await syncManagedMarkdownSectionWithReadBack({
			api: api as never,
			pageId: "page-1",
			previousMarkdown,
			nextMarkdown,
			startMarker: "<!-- codex:notion-execution-brief:start -->",
			endMarker: "<!-- codex:notion-execution-brief:end -->",
			patchMaxAttempts: 3,
		});

		expect(patchInputs).toHaveLength(1);
		expect(patchInputs[0]?.maxAttempts).toBe(3);
	});

	test("recognizes managed sections after Notion escapes the markers", () => {
		const existing = [
			"# Project",
			"\\<!-- codex:notion-execution-brief:start --\\>",
			"## Execution Brief",
			"Updated: 2026-04-07",
			"\\<!-- codex:notion-execution-brief:end --\\>",
			"## Rest",
			"- Stable",
		].join("\n");
		const nextSection = [
			"<!-- codex:notion-execution-brief:start -->",
			"## Execution Brief",
			"Updated: 2026-04-08",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");

		expect(
			extractManagedSection(
				existing,
				"<!-- codex:notion-execution-brief:start -->",
				"<!-- codex:notion-execution-brief:end -->",
			),
		).toContain("Updated: 2026-04-07");
		expect(
			mergeManagedSection(
				existing,
				nextSection,
				"<!-- codex:notion-execution-brief:start -->",
				"<!-- codex:notion-execution-brief:end -->",
			),
		).toContain("Updated: 2026-04-08");
		expect(normalizeMarkdown(existing)).toContain(
			"<!-- codex:notion-execution-brief:start -->",
		);
	});

	test("normalizes Notion-style escaped formatting for idempotent comparison", () => {
		const stored = [
			"# Project",
			"\\<!-- codex:notion-execution-brief:start --\\>",
			"## Execution Brief",
			"- [Legacy build work](https://www.notion.so/32bc21f1caf08123863dc48f4f479b64) \\| Progress",
			"\\<!-- codex:notion-execution-brief:end --\\>",
		].join("\n");
		const rendered = [
			"# Project",
			"",
			"<!-- codex:notion-execution-brief:start -->",
			"## Execution Brief",
			"- [Legacy build work](https://www.notion.so/Legacy-build-work-32bc21f1caf08123863dc48f4f479b64) | Progress",
			"<!-- codex:notion-execution-brief:end -->",
		].join("\n");

		expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
	});

	test("normalizes adjacent same-url links that Notion splits during readback", () => {
		const stored = [
			"# Project",
			"- [Claude (](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)[claude.ai](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)[)](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)",
			"- [window.storage](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)[ API](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)",
		].join("\n");
		const rendered = [
			"# Project",
			"- [Claude (claude.ai)](https://www.notion.so/326c21f1caf0810a946cfa381a5232a9)",
			"- [window.storage API](https://www.notion.so/326c21f1caf0813cb16ed81f5059678d)",
		].join("\n");

		expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
	});

	test("normalizes Notion mention-page link readback into plain markdown links", () => {
		const stored =
			'- \\[2026-05-09 - \\[CC\\] bridge-db — 2026-05-09\\](<mention-page url="https://www.notion.so/35bc21f1caf0819f9c8afc89d2fb0f9d"/>)';
		const rendered =
			"- [2026-05-09 - [CC] bridge-db — 2026-05-09](https://www.notion.so/35bc21f1caf0819f9c8afc89d2fb0f9d)";

		expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
	});

	test("normalizes slugged Notion urls that include underscores", () => {
		const stored =
			"- [Packet](https://www.notion.so/326c21f1caf0813fae47fa49e67efc35)";
		const rendered =
			"- [Packet](https://www.notion.so/Phase-2-now-packet-GPT_RAG-326c21f1caf0813fae47fa49e67efc35)";

		expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
	});

	test("normalizes Notion urls that lose query parameters on readback", () => {
		const stored =
			"- [Resume Now](https://www.notion.so/1258652152454b6a81325eb988ec04d4)";
		const rendered =
			"- [Resume Now](https://www.notion.so/1258652152454b6a81325eb988ec04d4?v=326c21f1caf081dc8903000cadb44c92)";

		expect(normalizeMarkdown(stored)).toBe(normalizeMarkdown(rendered));
	});
});

describe("review packet relation limiting", () => {
	test("caps relation ids at the Notion page-property limit", () => {
		const ids = Array.from({ length: 113 }, (_, index) => `page-${index}`);

		expect(limitRelationIds(ids, 100)).toHaveLength(100);
		expect(limitRelationIds(ids, 100)[0]).toBe("page-0");
		expect(limitRelationIds(ids, 100)[99]).toBe("page-99");
	});
});
