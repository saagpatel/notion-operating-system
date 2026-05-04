import { promises as fs } from "node:fs";
import path from "node:path";

import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";

export const DEFAULT_PROJECT_MARKDOWN_BLOCKLIST_PATH =
	"./config/local-portfolio-blocked-markdown-pages.json";

export type ProjectMarkdownLane =
	| "execution"
	| "intelligence"
	| "external-signals";

export interface ProjectMarkdownBlocklistEntry {
	title: string;
	pageId?: string;
	lanes?: ProjectMarkdownLane[];
	reason?: string;
	firstSeen?: string;
	lastSeen?: string;
}

export interface ProjectMarkdownBlocklistFile {
	version: 1;
	description?: string;
	entries: ProjectMarkdownBlocklistEntry[];
}

export interface ProjectMarkdownBlocklist {
	path: string;
	entries: ProjectMarkdownBlocklistEntry[];
}

export interface ProjectMarkdownTarget {
	projectId: string;
	projectTitle: string;
}

export async function loadProjectMarkdownBlocklist(
	filePath = DEFAULT_PROJECT_MARKDOWN_BLOCKLIST_PATH,
): Promise<ProjectMarkdownBlocklist> {
	const absolutePath = path.resolve(filePath);
	if (!(await fileExists(absolutePath))) {
		return { path: absolutePath, entries: [] };
	}

	const parsed = await readJsonFile<ProjectMarkdownBlocklistFile>(absolutePath);
	if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
		throw new AppError(
			`Project markdown blocklist must be version 1 with an entries array: ${absolutePath}`,
		);
	}

	return {
		path: absolutePath,
		entries: parsed.entries.map(normalizeEntry),
	};
}

export function isKnownBlockedProjectMarkdown(
	blocklist: ProjectMarkdownBlocklist,
	target: ProjectMarkdownTarget,
	lane: ProjectMarkdownLane,
): boolean {
	const normalizedTitle = normalizeTitle(target.projectTitle);
	return blocklist.entries.some((entry) => {
		if (entry.lanes && !entry.lanes.includes(lane)) {
			return false;
		}
		return (
			(Boolean(entry.pageId) && entry.pageId === target.projectId) ||
			normalizeTitle(entry.title) === normalizedTitle
		);
	});
}

export function partitionKnownBlockedProjectMarkdown<T extends ProjectMarkdownTarget>(
	targets: T[],
	blocklist: ProjectMarkdownBlocklist,
	lane: ProjectMarkdownLane,
): { writable: T[]; skipped: T[] } {
	const writable: T[] = [];
	const skipped: T[] = [];
	for (const target of targets) {
		if (isKnownBlockedProjectMarkdown(blocklist, target, lane)) {
			skipped.push(target);
		} else {
			writable.push(target);
		}
	}
	return { writable, skipped };
}

function normalizeEntry(
	entry: ProjectMarkdownBlocklistEntry,
): ProjectMarkdownBlocklistEntry {
	if (!entry.title?.trim() && !entry.pageId?.trim()) {
		throw new AppError("Project markdown blocklist entries need a title or pageId");
	}
	if (entry.lanes?.some((lane) => !isProjectMarkdownLane(lane))) {
		throw new AppError(
			`Project markdown blocklist entry has an unsupported lane: ${entry.title}`,
		);
	}
	return {
		...entry,
		title: entry.title?.trim() ?? "",
		pageId: entry.pageId?.trim(),
	};
}

function isProjectMarkdownLane(value: string): value is ProjectMarkdownLane {
	return value === "execution" || value === "intelligence" || value === "external-signals";
}

function normalizeTitle(title: string): string {
	return title.trim().toLowerCase().replace(/\s+/g, " ");
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}
