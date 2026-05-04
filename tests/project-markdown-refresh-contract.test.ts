import { describe, expect, test } from "vitest";

import { buildProjectMarkdownRefreshContract } from "../src/notion/project-markdown-refresh-contract.js";

describe("project markdown refresh contract", () => {
	test("does not keep known blocked-only batches partial", () => {
		const contract = buildProjectMarkdownRefreshContract({
			live: false,
			blockedMarkdownProjectPages: 0,
			writableMarkdownProjectPagesWouldChange: 0,
			portfolioSectionWouldChange: false,
			summaryCounts: {
				projectRecommendationBriefsWouldChange: 5,
				knownBlockedMarkdownProjectPages: 5,
				projectRefreshWritableBatchCount: 0,
			},
			warnings: [
				"Recommendation brief markdown skipped as known blocked for 5 project page(s): Example.",
			],
		});

		expect(contract.status).toBe("clean");
		expect(contract.wouldChange).toBe(false);
		expect(contract.summaryCounts.knownBlockedMarkdownProjectPages).toBe(5);
		expect(contract.warnings).toHaveLength(1);
	});

	test("keeps newly blocked markdown batches partial", () => {
		const contract = buildProjectMarkdownRefreshContract({
			live: true,
			blockedMarkdownProjectPages: 1,
			writableMarkdownProjectPagesWouldChange: 0,
			portfolioSectionWouldChange: false,
			summaryCounts: {
				blockedMarkdownProjectPages: 1,
			},
			warnings: ["Recommendation brief markdown remained blocked for 1 project page(s): Example."],
		});

		expect(contract.status).toBe("partial");
		expect(contract.wouldChange).toBe(true);
	});

	test("keeps writable markdown drift actionable", () => {
		const dryRun = buildProjectMarkdownRefreshContract({
			live: false,
			blockedMarkdownProjectPages: 0,
			writableMarkdownProjectPagesWouldChange: 2,
			portfolioSectionWouldChange: false,
			summaryCounts: {
				projectRefreshWritableBatchCount: 2,
			},
			warnings: [],
		});

		expect(dryRun.status).toBe("drift");
		expect(dryRun.wouldChange).toBe(true);
	});
});
