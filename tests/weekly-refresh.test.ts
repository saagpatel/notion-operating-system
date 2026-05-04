import { describe, expect, test } from "vitest";

import {
	applyFastBooleanDefault,
	buildWeeklyRefreshQuickSummary,
} from "../src/notion/weekly-refresh.js";

describe("weekly refresh fast workflow guidance", () => {
	test("lets fast mode enable boolean defaults when the CLI passes false for absent flags", () => {
		expect(applyFastBooleanDefault(false, true)).toBe(true);
		expect(applyFastBooleanDefault(undefined, true)).toBe(true);
		expect(applyFastBooleanDefault(true, false)).toBe(true);
		expect(applyFastBooleanDefault(false, false)).toBe(false);
	});

	test("recommends targeted fast live commands for drifting lanes", () => {
		const summary = buildWeeklyRefreshQuickSummary({
			ok: true,
			liveRequested: false,
			liveExecuted: false,
			needsLiveWrite: true,
			status: "completed",
			today: "2026-05-03",
			config: "config/local-portfolio-control-tower.json",
			preflight: {
				summary: {
					totalSteps: 2,
					cleanSteps: 1,
					driftSteps: 1,
					completedSteps: 0,
					partialSteps: 0,
					failedSteps: 0,
					skippedSteps: 0,
				},
				steps: [
					{
						key: "execution-sync",
						title: "Execution Sync",
						durationMs: 1000,
						live: false,
						wouldChange: false,
						status: "clean",
						summaryCounts: {},
						warnings: [],
					},
					{
						key: "external-signals",
						title: "External Signal Sync",
						durationMs: 2000,
						live: false,
						wouldChange: true,
						status: "drift",
						summaryCounts: {},
						warnings: [],
					},
				],
			},
		});

		expect(summary.recommendedNextCommands).toEqual([
			"npm run maintenance:weekly-refresh -- --today 2026-05-03 --only external-signals --fast --live --confirm-full-live",
		]);
	});

	test("recommends targeted fast dry-runs for partial or failed lanes", () => {
		const summary = buildWeeklyRefreshQuickSummary({
			ok: true,
			liveRequested: false,
			liveExecuted: false,
			needsLiveWrite: true,
			status: "partial",
			today: "2026-05-03",
			config: "config/local-portfolio-control-tower.json",
			preflight: {
				summary: {
					totalSteps: 1,
					cleanSteps: 0,
					driftSteps: 0,
					completedSteps: 0,
					partialSteps: 1,
					failedSteps: 0,
					skippedSteps: 0,
				},
				steps: [
					{
						key: "intelligence-sync",
						title: "Intelligence Sync",
						durationMs: 1000,
						live: false,
						wouldChange: true,
						status: "partial",
						summaryCounts: {},
						warnings: [],
					},
				],
			},
		});

		expect(summary.recommendedNextCommands).toEqual([
			"npm run maintenance:weekly-refresh -- --today 2026-05-03 --only intelligence-sync --fast --step-timeout-minutes 5",
		]);
	});
});
