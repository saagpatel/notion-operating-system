import type { ContentUpdate } from "../types.js";
import { recordCommandFailureCategory } from "../cli/run-observability.js";
import { AppError } from "../utils/errors.js";
import {
  assertSafeReplacement,
  buildReplaceCommand,
  extractManagedSection,
  normalizeMarkdown,
} from "../utils/markdown.js";
import { DirectNotionClient } from "./direct-notion-client.js";

const APPEND_TAIL_LENGTH_CANDIDATES = [1200, 900, 600, 400, 250] as const;

export async function syncManagedMarkdownSection(input: {
  api: DirectNotionClient;
  pageId: string;
  previousMarkdown: string;
  nextMarkdown: string;
  startMarker: string;
  endMarker: string;
}): Promise<"replace_content" | "update_content" | "append_tail_update"> {
  if (normalizeMarkdown(input.previousMarkdown) === normalizeMarkdown(input.nextMarkdown)) {
    return "update_content";
  }

  const previousSection = extractManagedSection(input.previousMarkdown, input.startMarker, input.endMarker);
  const nextSection = extractManagedSection(input.nextMarkdown, input.startMarker, input.endMarker);

  if (previousSection && nextSection) {
    await input.api.patchPageMarkdown({
      pageId: input.pageId,
      command: "update_content",
      contentUpdates: [{ oldStr: previousSection, newStr: nextSection, replaceAllMatches: true }],
      recordClientErrorAsFailure: false,
    });
    return "update_content";
  }

  assertSafeReplacement(input.previousMarkdown, input.nextMarkdown);

  try {
    await input.api.patchPageMarkdown({
      pageId: input.pageId,
      command: "replace_content",
      newMarkdown: buildReplaceCommand(input.nextMarkdown),
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

export function isNotionPolicyBlockedError(error: unknown): error is AppError {
  if (!(error instanceof AppError)) {
    return false;
  }

  const status = error.details?.status;
  const body = error.details?.body;
  return status === 403 && typeof body === "string" && /cloudflare|sorry,\s+you have been blocked/i.test(body);
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
    const oldStr = trimmedPrevious.slice(-Math.min(candidateLength, trimmedPrevious.length)).trimStart();
    if (oldStr.length < 120 || countOccurrences(trimmedPrevious, oldStr) !== 1) {
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
  const anchor = headingMatch?.[1] ?? trimmedPrevious.split("\n").find((line) => line.trim().length > 0);
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
