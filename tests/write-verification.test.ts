import { describe, expect, test } from "vitest";

import { verifyPublishedContent } from "../src/publishing/write-verification.js";

describe("verifyPublishedContent — full-compare", () => {
	test("passes across known round-trip quirks (escaped links, reflowed whitespace)", () => {
		const parsedBody =
			"# Weekly Review\n\nSee [Docs](https://example.com/docs) for details.\n\nSecond paragraph.";
		const readbackMarkdown =
			"# Weekly Review\n\nSee \\[Docs\\](https://example.com/docs) for details.\n\n\n\nSecond paragraph.";

		const result = verifyPublishedContent({
			readbackMarkdown,
			title: "Weekly Review",
			expectation: { kind: "full", markdown: parsedBody },
		});

		expect(result).toEqual({ status: "verified" });
	});

	test("flags a genuine content divergence (missing section)", () => {
		const parsedBody = "# Command Center\n\nSection A body.\n\nSection B body.";
		const readbackMarkdown = "# Command Center\n\nSection A body.";

		const result = verifyPublishedContent({
			readbackMarkdown,
			title: "Command Center",
			expectation: { kind: "full", markdown: parsedBody },
		});

		expect(result.status).toBe("diverged");
		if (result.status === "diverged") {
			expect(result.detail.length).toBeGreaterThan(0);
		}
	});

	test("child-reference lines present in readback but absent from parsedBody still verify", () => {
		const parsedBody = "# Weekly Review\n\nBody content stays the same.";
		const readbackMarkdown = `${parsedBody}\n\n<page url="https://notion.so/child-page">Child Page</page>`;

		const result = verifyPublishedContent({
			readbackMarkdown,
			title: "Weekly Review",
			expectation: {
				kind: "full",
				markdown: parsedBody,
				stripChildReferences: true,
			},
		});

		expect(result).toEqual({ status: "verified" });
	});

	test("without stripChildReferences, an unexpected child-reference block is a divergence", () => {
		const parsedBody = "# Weekly Review\n\nBody content stays the same.";
		const readbackMarkdown = `${parsedBody}\n\n<page url="https://notion.so/child-page">Child Page</page>`;

		const result = verifyPublishedContent({
			readbackMarkdown,
			title: "Weekly Review",
			expectation: { kind: "full", markdown: parsedBody },
		});

		expect(result.status).toBe("diverged");
	});
});

describe("verifyPublishedContent — contains-check", () => {
	test("replacement present verifies", () => {
		const result = verifyPublishedContent({
			readbackMarkdown: "# Log\n\nStatus: Complete\n\nOwner: Saagar",
			title: "Log",
			expectation: {
				kind: "contains",
				updates: [
					{
						oldStr: "Status: Pending",
						newStr: "Status: Complete",
						replaceAllMatches: false,
					},
				],
			},
		});

		expect(result).toEqual({ status: "verified" });
	});

	test("replacement absent diverges", () => {
		const result = verifyPublishedContent({
			readbackMarkdown: "# Log\n\nStatus: Pending\n\nOwner: Saagar",
			title: "Log",
			expectation: {
				kind: "contains",
				updates: [
					{
						oldStr: "Status: Pending",
						newStr: "Status: Complete",
						replaceAllMatches: false,
					},
				],
			},
		});

		expect(result.status).toBe("diverged");
		if (result.status === "diverged") {
			expect(result.detail).toContain("Status: Complete");
		}
	});

	test("search text still present alongside replacement diverges with a both-present detail", () => {
		const result = verifyPublishedContent({
			readbackMarkdown: "# Log\n\nStatus: Pending\n\nStatus: Complete",
			title: "Log",
			expectation: {
				kind: "contains",
				updates: [
					{
						oldStr: "Status: Pending",
						newStr: "Status: Complete",
						replaceAllMatches: false,
					},
				],
			},
		});

		expect(result.status).toBe("diverged");
		if (result.status === "diverged") {
			expect(result.detail).toContain("still present alongside replacement");
		}
	});

	test("an empty updates list vacuously verifies", () => {
		const result = verifyPublishedContent({
			readbackMarkdown: "# Log\n\nUnchanged content.",
			title: "Log",
			expectation: { kind: "contains", updates: [] },
		});

		expect(result).toEqual({ status: "verified" });
	});
});

describe("verifyPublishedContent — kind: none", () => {
	test("is always unverifiable, never verified", () => {
		const result = verifyPublishedContent({
			readbackMarkdown: "# Weekly Review\n\ntemplate-authored content",
			title: "Weekly Review",
			expectation: {
				kind: "none",
				reason: "template content is not locally known",
			},
		});

		expect(result).toEqual({
			status: "unverifiable",
			reason: "template content is not locally known",
		});
	});
});
