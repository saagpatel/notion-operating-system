import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import type { ParsedInputFile } from "../types.js";

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const absolutePath = path.resolve(filePath);
  const file = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(file) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(absolutePath, serialized, "utf8");
}

export async function parseInputFile(filePath: string): Promise<ParsedInputFile> {
  const absolutePath = path.resolve(filePath);
  const rawText = await fs.readFile(absolutePath, "utf8");
  const extension = path.extname(absolutePath).toLowerCase();
  const basename = path.basename(absolutePath, extension);

  if (extension === ".md" || extension === ".markdown") {
    const parsed = matter(rawText);
    return {
      absolutePath,
      rawText,
      body: parsed.content.trim(),
      frontmatter: parsed.data,
      firstHeading: findFirstHeading(parsed.content),
      basename,
    };
  }

  return {
    absolutePath,
    rawText,
    body: rawText.trim(),
    frontmatter: {},
    firstHeading: findFirstHeading(rawText),
    basename,
  };
}

function findFirstHeading(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}
