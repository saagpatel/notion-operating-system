import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import {
	isKnownBlockedProjectMarkdown,
	loadProjectMarkdownBlocklist,
	partitionKnownBlockedProjectMarkdown,
} from "../src/notion/project-markdown-blocklist.js";

describe("project markdown blocklist", () => {
	test("loads missing blocklist files as an empty registry", async () => {
		const blocklist = await loadProjectMarkdownBlocklist(
			join(tmpdir(), `missing-blocklist-${Date.now()}.json`),
		);

		expect(blocklist.entries).toEqual([]);
	});

	test("matches blocked pages by title and lane", async () => {
		const dir = await mkdtemp(join(tmpdir(), "notion-blocklist-"));
		const filePath = join(dir, "blocked.json");
		await writeFile(
			filePath,
			JSON.stringify({
				version: 1,
				entries: [
					{
						title: "Screenshot to Data Select",
						lanes: ["execution"],
					},
				],
			}),
			"utf8",
		);
		const blocklist = await loadProjectMarkdownBlocklist(filePath);

		expect(
			isKnownBlockedProjectMarkdown(
				blocklist,
				{ projectId: "page-1", projectTitle: " screenshot   to data select " },
				"execution",
			),
		).toBe(true);
		expect(
			isKnownBlockedProjectMarkdown(
				blocklist,
				{ projectId: "page-1", projectTitle: "Screenshot to Data Select" },
				"intelligence",
			),
		).toBe(false);
	});

	test("partitions writable and known blocked project markdown targets", () => {
		const blocklist = {
			path: "/tmp/blocked.json",
			entries: [{ title: "API Reverse", lanes: ["intelligence" as const] }],
		};

		const partition = partitionKnownBlockedProjectMarkdown(
			[
				{ projectId: "page-1", projectTitle: "API Reverse" },
				{ projectId: "page-2", projectTitle: "Network Mapper" },
			],
			blocklist,
			"intelligence",
		);

		expect(partition.skipped.map((entry) => entry.projectTitle)).toEqual([
			"API Reverse",
		]);
		expect(partition.writable.map((entry) => entry.projectTitle)).toEqual([
			"Network Mapper",
		]);
	});
});
