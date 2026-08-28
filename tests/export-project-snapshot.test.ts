import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";
import {
	buildProjectSnapshot,
	loadPortfolioAttentionAuthority,
} from "../src/notion/export-project-snapshot.js";
import type { DataSourcePageRef } from "../src/notion/local-portfolio-control-tower-live.js";

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		return `{${Object.entries(value)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

async function writePortfolioGenerationFixture(root: string): Promise<{
	generationDir: string;
	truthSha: string;
}> {
	const truth = {
		generated_at: "2026-08-27T09:00:00.000Z",
		projects: [
			{
				identity: { display_name: "Generated Project" },
				derived: { attention_state: "active-product" },
			},
		],
	};
	const truthBytes = Buffer.from(JSON.stringify(truth));
	const truthSha = createHash("sha256").update(truthBytes).digest("hex");
	const core = {
		schema_version: "PortfolioGenerationManifestV1",
		contract_version: "portfolio_generation_v1",
		created_at: "2026-08-27T09:00:00.000Z",
		prior_generation: null,
		artifacts: [
			{
				name: "portfolio-truth.json",
				path: "portfolio-truth.json",
				sha256: truthSha,
				size_bytes: truthBytes.length,
				media_type: "application/json",
				contract_version: "ghra.portfolio_truth@0.12.0",
			},
		],
		producer: {},
		github_security: {},
	};
	const identity = createHash("sha256")
		.update(`${stableJson(core)}\n`)
		.digest("hex");
	const generationId = `portfolio-generation-${identity.slice(0, 16)}`;
	const manifest = {
		...core,
		generation_id: generationId,
		content_identity_sha256: identity,
	};
	const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`);
	const generationDir = path.join(root, "releases", generationId);
	await mkdir(generationDir, { recursive: true });
	await writeFile(path.join(generationDir, "portfolio-truth.json"), truthBytes);
	await writeFile(path.join(generationDir, "manifest.json"), manifestBytes);
	await writeFile(
		path.join(root, "pointer.json"),
		JSON.stringify({
			schema_version: "PortfolioGenerationPointerV1",
			current: {
				generation_id: generationId,
				manifest_sha256: createHash("sha256")
					.update(manifestBytes)
					.digest("hex"),
			},
			previous: null,
			updated_at: "2026-08-27T09:00:00.000Z",
		}),
	);
	return { generationDir, truthSha };
}

describe("project snapshot provenance", () => {
	test("binds attention authority to the current content-addressed portfolio generation", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-portfolio-generation-"));
		try {
			const { truthSha } = await writePortfolioGenerationFixture(root);
			const legacyPath = path.join(root, "legacy.json");
			await writeFile(
				legacyPath,
				JSON.stringify({ generated_at: "stale", projects: [] }),
			);

			const authority = await loadPortfolioAttentionAuthority(legacyPath, root);

			expect(authority.generatedAt).toBe("2026-08-27T09:00:00.000Z");
			expect(authority.contentSha256).toBe(truthSha);
			expect(authority.byTitle.get("Generated Project")).toBe("active-product");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("falls back to the legacy truth only when no generation pointer exists", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-portfolio-legacy-"));
		try {
			const legacyPath = path.join(root, "legacy.json");
			const legacyBytes = Buffer.from(
				JSON.stringify({
					generated_at: "2026-08-20T09:00:00.000Z",
					projects: [
						{
							identity: { display_name: "Legacy Project" },
							derived: { attention_state: "parked" },
						},
					],
				}),
			);
			await writeFile(legacyPath, legacyBytes);

			const authority = await loadPortfolioAttentionAuthority(legacyPath, root);

			expect(authority.contentSha256).toBe(
				createHash("sha256").update(legacyBytes).digest("hex"),
			);
			expect(authority.byTitle.get("Legacy Project")).toBe("parked");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("fails closed when the current generation manifest digest drifts", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "notion-portfolio-invalid-"));
		try {
			const { generationDir } = await writePortfolioGenerationFixture(root);
			await writeFile(
				path.join(generationDir, "manifest.json"),
				JSON.stringify({ tampered: true }),
			);
			await expect(
				loadPortfolioAttentionAuthority(path.join(root, "legacy.json"), root),
			).rejects.toThrow("portfolio generation manifest hash mismatch");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

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
});
