import { describe, expect, test } from "vitest";

import { syncExternalSignalCommandCenterMarkdown } from "../src/notion/external-signal-sync.js";

describe("external signal sync command center markdown", () => {
	test("patches managed command center sections one at a time", async () => {
		const previousMarkdown = [
			"# Local Portfolio Command Center",
			"<!-- codex:notion-intelligence-command-center:start -->",
			"old intelligence",
			"<!-- codex:notion-intelligence-command-center:end -->",
			"<!-- codex:notion-external-signal-command-center:start -->",
			"old signals",
			"<!-- codex:notion-external-signal-command-center:end -->",
		].join("\n");
		const nextMarkdown = previousMarkdown
			.replace("old intelligence", "new intelligence")
			.replace("old signals", "new signals");
		let currentMarkdown = previousMarkdown;
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
				const update = input.contentUpdates?.[0];
				if (update) {
					currentMarkdown = currentMarkdown.replace(update.oldStr, update.newStr);
				}
			},
			readPageMarkdown: async () => ({
				markdown: currentMarkdown,
				raw: {},
				truncated: false,
				unknownBlockIds: [],
			}),
		};

		const result = await syncExternalSignalCommandCenterMarkdown({
			api: api as never,
			pageId: "command-center",
			previousMarkdown,
			nextMarkdown,
		});

		expect(result).toBe(nextMarkdown);
		expect(patchInputs).toHaveLength(2);
		expect(patchInputs[0]).toEqual(
			expect.objectContaining({ command: "update_content", maxAttempts: 1 }),
		);
		expect(patchInputs[0]?.contentUpdates?.[0]?.newStr).toContain(
			"new intelligence",
		);
		expect(patchInputs[1]?.contentUpdates?.[0]?.newStr).toContain(
			"new signals",
		);
	});
});
