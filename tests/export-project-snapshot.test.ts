import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import {
	buildProjectSnapshot,
	writeProjectSnapshotAtomic,
} from "../src/notion/export-project-snapshot.js";
import type { DataSourcePageRef } from "../src/notion/local-portfolio-control-tower-live.js";

describe("project snapshot provenance", () => {
	test("binds a live extraction to its source, watermark, and content", async () => {
		const config = await loadLocalPortfolioControlTowerConfig(
			"./config/local-portfolio-control-tower.json",
		);
		const pages: DataSourcePageRef[] = [
			{
				id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				url: "https://notion.so/example",
				title: "Example",
				lastEditedTime: "2026-07-12T09:30:00.000Z",
				properties: {},
			},
		];

		const snapshot = buildProjectSnapshot({
			pages,
			dataSourceId: "11111111-2222-3333-4444-555555555555",
			today: "2026-07-12",
			generatedAt: "2026-07-12T10:00:00.000Z",
			extractionRunId: "run-123",
			config,
			attentionAuthority: {
				generatedAt: "2026-07-12T09:00:00.000Z",
				contentSha256: "abc123",
				byTitle: new Map([["Example", "parked"]]),
			},
		});

		expect(snapshot.schema_version).toBe("2.0.0");
		expect(snapshot.extraction_run_id).toBe("run-123");
		expect(snapshot.source).toEqual({
			workspace: {
				state: "unavailable",
				reason:
					"Notion API response does not expose a stable workspace identifier",
			},
			data_source_id: "11111111-2222-3333-4444-555555555555",
			watermark: "2026-07-12T09:30:00.000Z",
		});
		expect(snapshot.live_read_receipt).toEqual({
			state: "verified",
			observed_at: "2026-07-12T10:00:00.000Z",
			page_count: 1,
		});
		expect(snapshot.attention_authority_receipt).toEqual({
			source: "GithubRepoAuditor",
			generated_at: "2026-07-12T09:00:00.000Z",
			content_sha256: "abc123",
			state: "verified",
		});
		expect(snapshot.projects[0]?.attention_authority).toMatchObject({
			state: "parked",
			default_attention: false,
		});
		expect(snapshot.projects[0]?.source_last_edited_at).toBe(
			"2026-07-12T09:30:00.000Z",
		);
		expect(snapshot.content_sha256).toBe(
			createHash("sha256")
				.update(JSON.stringify(snapshot.projects))
				.digest("hex"),
		);
	});

	test("does not invent a watermark when source timestamps are absent", async () => {
		const config = await loadLocalPortfolioControlTowerConfig(
			"./config/local-portfolio-control-tower.json",
		);
		const snapshot = buildProjectSnapshot({
			pages: [],
			dataSourceId: "source",
			today: "2026-07-12",
			generatedAt: "2026-07-12T10:00:00.000Z",
			extractionRunId: "run-empty",
			config,
		});

		expect(snapshot.source.watermark).toBeNull();
		expect(snapshot.live_read_receipt.page_count).toBe(0);
		expect(snapshot.attention_authority_receipt.state).toBe("unavailable");
	});

	test("publishes through a same-directory atomic rename without leaving temp files", async () => {
		const config = await loadLocalPortfolioControlTowerConfig(
			"./config/local-portfolio-control-tower.json",
		);
		const snapshot = buildProjectSnapshot({
			pages: [],
			dataSourceId: "source",
			today: "2026-07-12",
			generatedAt: "2026-07-12T10:00:00.000Z",
			extractionRunId: "run-atomic",
			config,
		});
		const directory = await mkdtemp(path.join(tmpdir(), "notion-snapshot-"));
		const destination = path.join(directory, "project-snapshot.json");
		try {
			await writeProjectSnapshotAtomic(snapshot, destination);
			expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(snapshot);
			expect(await readdir(directory)).toEqual(["project-snapshot.json"]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
