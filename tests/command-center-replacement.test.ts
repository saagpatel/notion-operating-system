import { describe, expect, test } from "vitest";

import { isMarkdownPatchTransportError } from "../src/notion/command-center-replacement.js";

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
});
