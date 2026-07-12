import { describe, expect, test } from "vitest";

import {
	isMarkdownPatchTransportError,
	replaceCommandCenterPageAfterPatchFailure,
} from "../src/notion/command-center-replacement.js";
import { DirectNotionClient } from "../src/notion/direct-notion-client.js";

describe("command center replacement fallback", () => {
	test("treats retry-exhausted markdown PATCH responses as replacement-eligible", () => {
		expect(
			isMarkdownPatchTransportError(
				new Error(
					"Notion request returned retryable error responses after 5 attempt(s) for PATCH /pages/page-1/markdown",
				),
			),
		).toBe(true);
	});

	test("does not treat unrelated Notion failures as replacement-eligible", () => {
		expect(
			isMarkdownPatchTransportError(
				new Error("Notion request failed for GET /pages/page-1/markdown"),
			),
		).toBe(false);
	});

	test("keeps the current page when read-back proves the lost acknowledgment converged", async () => {
		const calls: string[] = [];
		const api = {
			readPageMarkdown: async () => ({ markdown: "# Command Center\n\nCurrent body" }),
			createPageWithMarkdown: async () => {
				calls.push("create");
				return { id: "new", url: "https://notion.so/new" };
			},
			archivePage: async () => calls.push("archive"),
		} as unknown as DirectNotionClient;
		const config = commandCenterConfig();

		const result = await replaceCommandCenterPageAfterPatchFailure({
			api,
			config,
			markdown: "# Command Center\n\nCurrent body",
		});

		expect(result).toBe(config);
		expect(calls).toEqual([]);
	});
});

function commandCenterConfig() {
	return {
		commandCenter: {
			pageId: "old-page",
			pageUrl: "https://notion.so/old-page",
			parentPageUrl: "https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			title: "Command Center",
		},
		destinations: { commandCenterAlias: "local_portfolio_command_center" },
	} as never;
}
