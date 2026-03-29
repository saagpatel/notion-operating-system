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
