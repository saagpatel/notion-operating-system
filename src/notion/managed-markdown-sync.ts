import { recordCommandFailureCategory } from "../cli/run-observability.js";
import type { ContentUpdate } from "../types.js";
import { AppError } from "../utils/errors.js";
import {
	assertSafeReplacement,
	buildReplaceCommand,
	extractManagedSection,
	normalizeMarkdown,
} from "../utils/markdown.js";
import type { DirectNotionClient } from "./direct-notion-client.js";

const APPEND_TAIL_LENGTH_CANDIDATES = [1200, 900, 600, 400, 250] as const;
const DEFAULT_READ_BACK_MAX_ATTEMPTS = 1;

type ManagedMarkdownSyncMode =
	| "replace_content"
	| "update_content"
	| "append_tail_update";

export type ManagedMarkdownSyncWithReadBackMode =
	| ManagedMarkdownSyncMode
	| "read_back_converged";

export async function syncManagedMarkdownSection(input: {
	api: DirectNotionClient;
	pageId: string;
	previousMarkdown: string;
	nextMarkdown: string;
	startMarker: string;
	endMarker: string;
	patchMaxAttempts?: number;
}): Promise<ManagedMarkdownSyncMode> {
	if (
		normalizeMarkdown(input.previousMarkdown) ===
		normalizeMarkdown(input.nextMarkdown)
	) {
		return "update_content";
	}

	const previousSection = extractManagedSection(
		input.previousMarkdown,
		input.startMarker,
		input.endMarker,
	);
	const nextSection = extractManagedSection(
		input.nextMarkdown,
		input.startMarker,
		input.endMarker,
	);

	if (previousSection && nextSection) {
		try {
			await input.api.patchPageMarkdown({
				pageId: input.pageId,
				command: "update_content",
				contentUpdates: [
					{
						oldStr: previousSection,
						newStr: nextSection,
						replaceAllMatches: true,
					},
				],
				maxAttempts: input.patchMaxAttempts,
				recordClientErrorAsFailure: false,
			});
			return "update_content";
		} catch (error) {
			if (!isNotionPolicyBlockedError(error)) {
				throw error;
			}
		}
	}

	assertSafeReplacement(input.previousMarkdown, input.nextMarkdown);

	try {
		await input.api.patchPageMarkdown({
			pageId: input.pageId,
			command: "replace_content",
			newMarkdown: buildReplaceCommand(input.nextMarkdown),
			maxAttempts: input.patchMaxAttempts,
			recordClientErrorAsFailure: false,
		});
		return "replace_content";
	} catch (error) {
		if (!nextSection || !isNotionPolicyBlockedError(error)) {
			throw error;
		}

		const fallbackUpdates = [
			buildInsertSectionAfterHeadingUpdate(input.previousMarkdown, nextSection),
			buildAppendSectionTailUpdate(input.previousMarkdown, nextSection),
		].filter((update): update is ContentUpdate => Boolean(update));

		for (const fallbackUpdate of fallbackUpdates) {
			try {
				await input.api.patchPageMarkdown({
					pageId: input.pageId,
					command: "update_content",
					contentUpdates: [fallbackUpdate],
					maxAttempts: input.patchMaxAttempts,
					recordClientErrorAsFailure: false,
				});
				return "append_tail_update";
			} catch (fallbackError) {
				if (!isNotionPolicyBlockedError(fallbackError)) {
					throw fallbackError;
				}
			}
		}

		recordCommandFailureCategory("validation_error");
		throw error;
	}
}

export async function syncManagedMarkdownSectionWithReadBack(input: {
	api: DirectNotionClient;
	pageId: string;
	previousMarkdown: string;
	nextMarkdown: string;
	startMarker: string;
	endMarker: string;
	maxAttempts?: number;
	patchMaxAttempts?: number;
}): Promise<ManagedMarkdownSyncWithReadBackMode> {
	let previousMarkdown = input.previousMarkdown;
	const maxAttempts = input.maxAttempts ?? DEFAULT_READ_BACK_MAX_ATTEMPTS;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await syncManagedMarkdownSection({
				...input,
				previousMarkdown,
				patchMaxAttempts: input.patchMaxAttempts,
			});
		} catch (error) {
			lastError = error;
			if (!isReadBackRecoverableMarkdownError(error)) {
				throw error;
			}
		}

		const readBack = await input.api.readPageMarkdown(input.pageId);
		if (
			normalizeMarkdown(readBack.markdown) ===
			normalizeMarkdown(input.nextMarkdown)
		) {
			return "read_back_converged";
		}
		previousMarkdown = readBack.markdown;
	}

	throw lastError instanceof Error
		? lastError
		: new AppError(
				"Managed markdown section did not converge after read-back attempts",
			);
}

export function isNotionPolicyBlockedError(error: unknown): error is AppError {
	if (!(error instanceof AppError)) {
		return false;
	}

	const status = error.details?.status;
	const body = error.details?.body;
	return (
		status === 403 &&
		typeof body === "string" &&
		/cloudflare|sorry,\s+you have been blocked/i.test(body)
	);
}

export function isReadBackRecoverableMarkdownError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /Notion request (transport error|timed out|returned retryable error responses).*PATCH \/pages\/.*\/markdown/i.test(
		message,
	);
}

export function buildAppendSectionTailUpdate(
	previousMarkdown: string,
	nextSection: string,
): ContentUpdate | undefined {
	const trimmedPrevious = previousMarkdown.trimEnd();
	if (!trimmedPrevious || !nextSection.trim()) {
		return undefined;
	}

	for (const candidateLength of APPEND_TAIL_LENGTH_CANDIDATES) {
		const oldStr = trimmedPrevious
			.slice(-Math.min(candidateLength, trimmedPrevious.length))
			.trimStart();
		if (
			oldStr.length < 120 ||
			countOccurrences(trimmedPrevious, oldStr) !== 1
		) {
			continue;
		}

		return {
			oldStr,
			newStr: `${oldStr}\n\n${nextSection.trim()}`,
			replaceAllMatches: false,
		};
	}

	return undefined;
}

export function buildInsertSectionAfterHeadingUpdate(
	previousMarkdown: string,
	nextSection: string,
): ContentUpdate | undefined {
	const trimmedPrevious = previousMarkdown.trim();
	if (!trimmedPrevious || !nextSection.trim()) {
		return undefined;
	}

	const headingMatch = trimmedPrevious.match(/^(# .+)$/m);
	const anchor =
		headingMatch?.[1] ??
		trimmedPrevious.split("\n").find((line) => line.trim().length > 0);
	if (!anchor || countOccurrences(trimmedPrevious, anchor) !== 1) {
		return undefined;
	}

	return {
		oldStr: anchor,
		newStr: `${anchor}\n\n${nextSection.trim()}`,
		replaceAllMatches: false,
	};
}

function countOccurrences(source: string, target: string): number {
	if (!target) {
		return 0;
	}

	let count = 0;
	let index = 0;
	while (index < source.length) {
		const foundAt = source.indexOf(target, index);
		if (foundAt === -1) {
			return count;
		}
		count += 1;
		index = foundAt + target.length;
	}

	return count;
}
