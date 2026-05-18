import { describe, expect, test } from "vitest";

import { syncIntelligenceCommandCenterMarkdown } from "../src/notion/intelligence-sync.js";
import { AppError } from "../src/utils/errors.js";

describe("intelligence sync command center markdown", () => {
	test("patches only the managed intelligence section with one PATCH attempt", async () => {
		const previousMarkdown = [
			"# Local Portfolio Command Center",
			"Intro",
			"<!-- codex:notion-intelligence-command-center:start -->",
			"## Phase 3 Cross-Database Intelligence",
			"- Old metric",
			"<!-- codex:notion-intelligence-command-center:end -->",
			"Tail",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("- Old metric", "- New metric");
		const patchInputs: Array<{
			command: string;
			contentUpdates?: Array<{ oldStr: string; newStr: string }>;
			maxAttempts?: number;
		}> = [];
		const api = {
			patchPageMarkdown: async (input: {
				command: string;
				contentUpdates?: Array<{ oldStr: string; newStr: string }>;
				maxAttempts?: number;
			}) => {
				patchInputs.push(input);
			},
		};

		const mode = await syncIntelligenceCommandCenterMarkdown({
			api: api as never,
			pageId: "command-center",
			previousMarkdown,
			nextMarkdown,
		});

		expect(mode).toBe("update_content");
		expect(patchInputs).toHaveLength(1);
		expect(patchInputs[0]).toEqual(
			expect.objectContaining({
				command: "update_content",
				maxAttempts: 1,
			}),
		);
		expect(patchInputs[0]?.contentUpdates?.[0]?.oldStr).toContain(
			"- Old metric",
		);
		expect(patchInputs[0]?.contentUpdates?.[0]?.newStr).toContain(
			"- New metric",
		);
	});

	test("accepts a transport-ambiguous patch when read-back already converged", async () => {
		const previousMarkdown = [
			"# Local Portfolio Command Center",
			"<!-- codex:notion-intelligence-command-center:start -->",
			"old",
			"<!-- codex:notion-intelligence-command-center:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown.replace("old", "new");
		const patchInputs: Array<{ maxAttempts?: number }> = [];
		const api = {
			patchPageMarkdown: async (input: { maxAttempts?: number }) => {
				patchInputs.push(input);
				throw new AppError(
					"Notion request transport error after 1 attempt(s) for PATCH /pages/command-center/markdown",
				);
			},
			readPageMarkdown: async () => ({
				markdown: nextMarkdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		const mode = await syncIntelligenceCommandCenterMarkdown({
			api: api as never,
			pageId: "command-center",
			previousMarkdown,
			nextMarkdown,
		});

		expect(mode).toBe("read_back_converged");
		expect(patchInputs).toEqual([expect.objectContaining({ maxAttempts: 1 })]);
	});
});
