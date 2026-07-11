import type { ContentUpdate } from "../types.js";
import {
	extractChildReferenceBlocks,
	normalizeMarkdown,
	pageMarkdownMatches,
} from "../utils/markdown.js";

/**
 * Outcome of comparing a Publisher readback against what we meant to write.
 *
 * "unverifiable" is a distinct, honest outcome from "verified" — it means we
 * do not locally know what the final content should look like (e.g. template
 * content), not that the write succeeded.
 */
export type WriteVerification =
	| { status: "verified" }
	| { status: "diverged"; detail: string }
	| { status: "unverifiable"; reason: string };

/**
 * What the readback should be checked against, computed per publish mode by
 * the caller (see the mode table in the PR-3 design doc).
 */
export type WriteExpectation =
	| { kind: "full"; markdown: string; stripChildReferences?: boolean }
	| { kind: "contains"; updates: ContentUpdate[] }
	| { kind: "none"; reason: string };

export type VerifyWritesMode = "warn" | "fail" | "off";

/**
 * Pure comparison of a Publisher readback against an expectation. Performs no
 * API calls and adds no new normalization rules — all equivalence goes
 * through the existing `src/utils/markdown.ts` normalizer family.
 */
export function verifyPublishedContent(input: {
	readbackMarkdown: string;
	title: string | undefined;
	expectation: WriteExpectation;
}): WriteVerification {
	const { readbackMarkdown, title, expectation } = input;

	if (expectation.kind === "none") {
		return { status: "unverifiable", reason: expectation.reason };
	}

	if (expectation.kind === "full") {
		return verifyFullContent(readbackMarkdown, title, expectation);
	}

	return verifyContainsUpdates(readbackMarkdown, expectation.updates);
}

function verifyFullContent(
	readbackMarkdown: string,
	title: string | undefined,
	expectation: { markdown: string; stripChildReferences?: boolean },
): WriteVerification {
	const actual = expectation.stripChildReferences
		? stripChildReferenceBlocks(readbackMarkdown)
		: readbackMarkdown;
	const expected = expectation.stripChildReferences
		? stripChildReferenceBlocks(expectation.markdown)
		: expectation.markdown;

	const matches = pageMarkdownMatches({
		expectedMarkdown: expected,
		actualMarkdown: actual,
		title: title ?? "",
	});

	if (matches) {
		return { status: "verified" };
	}

	return {
		status: "diverged",
		detail: "Readback markdown does not normalize-match the published content.",
	};
}

function verifyContainsUpdates(
	readbackMarkdown: string,
	updates: ContentUpdate[],
): WriteVerification {
	const normalizedReadback = normalizeMarkdown(readbackMarkdown);
	const problems: string[] = [];

	for (const update of updates) {
		const normalizedReplacement = normalizeMarkdown(update.newStr);
		const replacementPresent =
			normalizedReplacement.length === 0 ||
			normalizedReadback.includes(normalizedReplacement);

		if (!replacementPresent) {
			problems.push(
				`replacement text not found in readback: "${truncateForDetail(update.newStr)}"`,
			);
			continue;
		}

		const normalizedSearch = normalizeMarkdown(update.oldStr);
		const searchStillPresent =
			normalizedSearch.length > 0 &&
			normalizedSearch !== normalizedReplacement &&
			normalizedReadback.includes(normalizedSearch);

		if (searchStillPresent) {
			problems.push(
				`search text still present alongside replacement: "${truncateForDetail(update.oldStr)}"`,
			);
		}
	}

	if (problems.length > 0) {
		return { status: "diverged", detail: problems.join("; ") };
	}

	return { status: "verified" };
}

function stripChildReferenceBlocks(markdown: string): string {
	let result = markdown;
	for (const block of extractChildReferenceBlocks(markdown)) {
		result = result.split(block).join("");
	}
	return result;
}

function truncateForDetail(value: string, maxLength = 80): string {
	const singleLine = value.replace(/\s+/g, " ").trim();
	return singleLine.length > maxLength
		? `${singleLine.slice(0, maxLength)}…`
		: singleLine;
}
