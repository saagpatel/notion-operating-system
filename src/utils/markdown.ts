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
  return markdown.trim();
}

export function mergeManagedSection(
  existingMarkdown: string,
  sectionMarkdown: string,
  startMarker: string,
  endMarker: string,
): string {
  const trimmedSection = normalizeMarkdown(sectionMarkdown);
  const startIndex = existingMarkdown.indexOf(startMarker);
  const endIndex = existingMarkdown.indexOf(endMarker);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingMarkdown.slice(0, startIndex).trimEnd();
    const after = existingMarkdown.slice(endIndex + endMarker.length).trimStart();
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
  const startIndex = markdown.indexOf(startMarker);
  const endIndex = markdown.indexOf(endMarker);

  if (startIndex < 0 || endIndex <= startIndex) {
    return undefined;
  }

  return markdown.slice(startIndex, endIndex + endMarker.length).trim();
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
