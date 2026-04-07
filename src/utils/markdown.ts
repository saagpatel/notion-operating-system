import type { ContentUpdate, ParsedInputFile, TitleRule } from "../types.js";
import { AppError } from "./errors.js";

export function resolveTitle(parsed: ParsedInputFile, rule: TitleRule, override?: string): string | undefined {
  if (override) {
    return override;
  }

  switch (rule.source) {
    case "literal":
      return rule.value ?? rule.fallback;
    case "filename":
      return parsed.basename || rule.fallback;
    case "first_heading":
      return parsed.firstHeading ?? rule.fallback;
    case "frontmatter": {
      const fieldName = rule.frontmatterField ?? "title";
      const value = parsed.frontmatter[fieldName];
      return typeof value === "string" ? value : rule.fallback;
    }
    case "none":
      return rule.fallback;
    default:
      return rule.fallback;
  }
}

export function buildReplaceCommand(markdown: string): string {
  return markdown.trim();
}

export function validateContentUpdates(contentUpdates?: ContentUpdate[]): ContentUpdate[] {
  if (!contentUpdates || contentUpdates.length === 0) {
    throw new AppError("targeted_search_replace mode requires contentUpdates");
  }

  return contentUpdates;
}

export function extractChildReferenceBlocks(markdown: string): string[] {
  const matches = markdown.match(/<(page|database)\s+url="[^"]+">.*?<\/(page|database)>/g) ?? [];
  return matches;
}

export function assertSafeReplacement(previousMarkdown: string, nextMarkdown: string): void {
  const previousChildRefs = extractChildReferenceBlocks(previousMarkdown);
  if (previousChildRefs.length === 0) {
    return;
  }

  const removed = previousChildRefs.filter((ref) => !nextMarkdown.includes(ref));
  if (removed.length > 0) {
    throw new AppError(
      "Refusing to replace page content because child page or database references would be removed while allowDeletingContent=false",
      { removedReferences: removed },
    );
  }
}

export function normalizeMarkdown(markdown: string): string {
  return normalizeComparisonMarkdown(markdown).trim();
}

export function mergeManagedSection(
  existingMarkdown: string,
  sectionMarkdown: string,
  startMarker: string,
  endMarker: string,
): string {
  const trimmedSection = normalizeMarkdown(sectionMarkdown);
  const match = findManagedSectionBounds(existingMarkdown, startMarker, endMarker);

  if (match) {
    const before = existingMarkdown.slice(0, match.startIndex).trimEnd();
    const after = existingMarkdown.slice(match.endIndex + match.endMarker.length).trimStart();
    return [before, trimmedSection, after].filter((part) => part.length > 0).join("\n\n").trim();
  }

  return [normalizeMarkdown(existingMarkdown), trimmedSection]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
}

export function extractManagedSection(
  markdown: string,
  startMarker: string,
  endMarker: string,
): string | undefined {
  const match = findManagedSectionBounds(markdown, startMarker, endMarker);
  if (!match) {
    return undefined;
  }

  return markdown.slice(match.startIndex, match.endIndex + match.endMarker.length).trim();
}

export function preserveManagedSections(
  nextMarkdown: string,
  previousMarkdown: string,
  sections: Array<{ startMarker: string; endMarker: string }>,
): string {
  let preserved = normalizeMarkdown(nextMarkdown);

  for (const section of sections) {
    const existing = extractManagedSection(previousMarkdown, section.startMarker, section.endMarker);
    if (!existing) {
      continue;
    }
    preserved = mergeManagedSection(preserved, existing, section.startMarker, section.endMarker);
  }

  return preserved;
}

function findManagedSectionBounds(
  markdown: string,
  startMarker: string,
  endMarker: string,
): { startIndex: number; endIndex: number; endMarker: string } | undefined {
  for (const resolvedStartMarker of markerCandidates(startMarker)) {
    const startIndex = markdown.indexOf(resolvedStartMarker);
    if (startIndex < 0) {
      continue;
    }
    for (const resolvedEndMarker of markerCandidates(endMarker)) {
      const endIndex = markdown.indexOf(resolvedEndMarker, startIndex + resolvedStartMarker.length);
      if (endIndex > startIndex) {
        return {
          startIndex,
          endIndex,
          endMarker: resolvedEndMarker,
        };
      }
    }
  }

  return undefined;
}

function markerCandidates(marker: string): string[] {
  const escaped = escapeManagedMarker(marker);
  return escaped === marker ? [marker] : [marker, escaped];
}

function escapeManagedMarker(marker: string): string {
  return marker.replace("<", "\\<").replace(/>$/, "\\>");
}

function normalizeManagedMarkers(markdown: string): string {
  return markdown.replace(/\\<!--/g, "<!--").replace(/--\\>/g, "-->");
}

function normalizeComparisonMarkdown(markdown: string): string {
  return normalizeAdjacentDuplicateLinks(
    normalizeManagedMarkers(markdown)
    .replace(/\r\n/g, "\n")
    .replace(/\\\|/g, "|")
    .replace(/\\</g, "<")
    .replace(/\\>/g, ">")
    .replace(/\n{2,}/g, "\n")
    .replace(/(https:\/\/www\.notion\.so\/[^\s)#?]+)(?:\?[^\s)#]*)?(?:#[^\s)#]*)?/gi, "$1")
    .replace(
      /https:\/\/www\.notion\.so\/(?:[^/\s?#]+-)?([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
      (_match, notionId: string) => `https://www.notion.so/${notionId}`,
    ),
  );
}

function normalizeAdjacentDuplicateLinks(markdown: string): string {
  let normalized = markdown;

  while (true) {
    const next = normalized.replace(
      /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\[([^\]]*)\]\(\2\)/g,
      (_match, leftText: string, url: string, rightText: string) => `[${leftText}${rightText}](${url})`,
    );

    if (next === normalized) {
      return normalized;
    }

    normalized = next;
  }
}
