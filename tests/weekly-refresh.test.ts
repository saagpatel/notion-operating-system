import { describe, expect, test } from "vitest";

import {
	applyFastBooleanDefault,
	buildWeeklyRefreshChildEnv,
	buildWeeklyRefreshCatchUpStatus,
	buildWeeklyRefreshQuickSummary,
	buildWeeklyRefreshRecoveryPlan,
	buildWeeklyRefreshTimingSummary,
	expandExternalSignalLiveProjectBatches,
	shouldPersistWeeklyRefreshState,
} from "../src/notion/weekly-refresh.js";

describe("weekly refresh fast workflow guidance", () => {
	test("lets fast mode enable boolean defaults when the CLI passes false for absent flags", () => {
		expect(applyFastBooleanDefault(false, true)).toBe(true);
		expect(applyFastBooleanDefault(undefined, true)).toBe(true);
		expect(applyFastBooleanDefault(true, false)).toBe(true);
		expect(applyFastBooleanDefault(false, false)).toBe(false);
	});

	test("enables child progress only when child output is streamed", () => {
		expect(
			buildWeeklyRefreshChildEnv({ NOTION_WEEKLY_PROGRESS: "1" }, false)
				.NOTION_WEEKLY_PROGRESS,
		).toBeUndefined();
		expect(
			buildWeeklyRefreshChildEnv({}, true).NOTION_WEEKLY_PROGRESS,
		).toBe("1");
	});

	test("persists weekly freshness only for full live runs", () => {
		expect(
			shouldPersistWeeklyRefreshState({
				live: true,
				only: [],
				skip: [],
			}),
		).toBe(true);
		expect(
			shouldPersistWeeklyRefreshState({
				live: true,
				only: ["control-tower-sync"],
				skip: [],
			}),
		).toBe(false);
		expect(
			shouldPersistWeeklyRefreshState({
				live: true,
				only: [],
				skip: ["external-signals"],
			}),
		).toBe(false);
		expect(
			shouldPersistWeeklyRefreshState({
				live: false,
			}),
		).toBe(false);
	});

	test("classifies weekend catch-up after missed weekday runs", () => {
		const catchUp = buildWeeklyRefreshCatchUpStatus({
			previousRunAt: "2026-06-01",
			today: "2026-06-06",
			status: "clean",
			needsLiveWrite: false,
			liveExecuted: false,
		});

		expect(catchUp).toMatchObject({
			gapDays: 5,
			missedRunDays: 4,
			missedWeekdays: 4,
			catchUpMode: "weekend_catch_up",
			staleBeforeRun: true,
			recovered: true,
		});
		expect(catchUp.summary).toContain("weekend catch-up");
		expect(catchUp.summary).toContain("recovered");
	});

	test("does not mark stale missed runs recovered when drift remains", () => {
		const catchUp = buildWeeklyRefreshCatchUpStatus({
			previousRunAt: "2026-06-01",
			today: "2026-06-05",
			status: "completed",
			needsLiveWrite: true,
			liveExecuted: false,
		});

		expect(catchUp).toMatchObject({
			missedRunDays: 3,
			missedWeekdays: 3,
			catchUpMode: "weekend_catch_up",
			staleBeforeRun: true,
			recovered: false,
		});
	});

	test("does not loop on invalid stored weekly refresh dates", () => {
		const catchUp = buildWeeklyRefreshCatchUpStatus({
			previousRunAt: "not-a-date",
			today: "2026-06-06",
			status: "clean",
			needsLiveWrite: false,
			liveExecuted: false,
		});

		expect(catchUp).toMatchObject({
			gapDays: 0,
			missedRunDays: 0,
			missedWeekdays: 0,
			catchUpMode: "none",
			staleBeforeRun: false,
			recovered: false,
		});
		expect(catchUp.summary).toContain("Prior weekly refresh run date is invalid");
	});

	test("does not loop on invalid current weekly refresh dates", () => {
		const catchUp = buildWeeklyRefreshCatchUpStatus({
			previousRunAt: "2026-06-01",
			today: "2026-02-31",
			status: "clean",
			needsLiveWrite: false,
			liveExecuted: false,
		});

		expect(catchUp).toMatchObject({
			gapDays: 0,
			missedRunDays: 0,
			missedWeekdays: 0,
			catchUpMode: "none",
			staleBeforeRun: false,
			recovered: false,
		});
		expect(catchUp.summary).toContain("Current weekly refresh date is invalid");
	});

	test("chunks large live external signal project-page refreshes", () => {
		const [supportStep, ...externalSteps] = expandExternalSignalLiveProjectBatches(
			[
				{
					key: "support-maintenance",
					title: "GitHub Support Maintenance",
					kind: "script",
					args: ["support"],
					timeoutMs: 1,
				},
				{
					key: "external-signals",
					title: "External Signal Sync",
					kind: "cli",
					args: ["signals", "sync"],
					timeoutMs: 1,
				},
			],
			{
				maxProjectPages: 45,
				projectConcurrency: 2,
				skipKnownBlockedMarkdown: true,
			},
			true,
			{
				sharedArgs: ["--live", "--today", "2026-06-06"],
				externalSignalSourceLimit: 119,
				externalSignalMaxEventsPerSource: 5,
			},
		);

		expect(supportStep?.key).toBe("support-maintenance");
		expect(externalSteps.map((step) => step.title)).toEqual([
			"External Signal Sync (batch 1/3)",
			"External Signal Sync (batch 2/3)",
			"External Signal Sync (batch 3/3)",
		]);
		expect(
			externalSteps.map((step) => ({
				limit: valueAfter(step.args, "--project-limit"),
				offset: valueAfter(step.args, "--project-offset"),
				concurrency: valueAfter(step.args, "--project-concurrency"),
			})),
		).toEqual([
			{ limit: "20", offset: "0", concurrency: "1" },
			{ limit: "20", offset: "20", concurrency: "1" },
			{ limit: "5", offset: "40", concurrency: "1" },
		]);
		expect(externalSteps[0]?.args).toContain("--skip-known-blocked-markdown");
	});

	test("respects manual external signal project offsets without auto-chunking", () => {
		const steps = [
			{
				key: "external-signals",
				title: "External Signal Sync",
				kind: "cli" as const,
				args: ["signals", "sync"],
				timeoutMs: 1,
			},
		];

		expect(
			expandExternalSignalLiveProjectBatches(
				steps,
				{
					maxProjectPages: 45,
					projectOffset: 20,
					projectConcurrency: 2,
					skipKnownBlockedMarkdown: false,
				},
				true,
				{
					sharedArgs: ["--live", "--today", "2026-06-06"],
					externalSignalSourceLimit: 119,
					externalSignalMaxEventsPerSource: 5,
				},
			),
		).toEqual(steps);
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

	test("recommends full-scope loop for external signal source backlog drift", () => {
		const summary = buildWeeklyRefreshQuickSummary({
			ok: true,
			liveRequested: false,
			liveExecuted: false,
			needsLiveWrite: true,
			status: "completed",
			today: "2026-07-03",
			config: "config/local-portfolio-control-tower.json",
			preflight: {
				summary: {
					totalSteps: 1,
					cleanSteps: 0,
					driftSteps: 1,
					completedSteps: 0,
					partialSteps: 0,
					failedSteps: 0,
					skippedSteps: 0,
				},
				steps: [
					{
						key: "external-signals",
						title: "External Signal Sync",
						durationMs: 75_000,
						live: false,
						wouldChange: true,
						status: "drift",
						summaryCounts: {
							projectExternalSignalBriefsWouldChange: 15,
							projectRefreshLimit: 0,
							evaluatedProjectCount: 15,
							syncedSourceCount: 15,
						},
						warnings: ["49 event(s) skipped: event key already exists in Notion."],
					},
				],
			},
		});

		expect(summary.recommendedNextCommands).toEqual([
			"npm run maintenance:weekly-refresh -- --today 2026-07-03 --only external-signals --live --confirm-full-live",
			"npm run maintenance:weekly-refresh -- --today 2026-07-03 --only external-signals --summary-first --stream-child-output",
		]);
		expect(summary.recoveryPlan).toEqual([
			{
				step: "external-signals",
				reason:
					"External Signal Sync is in a full-scope provider/source backlog; run this lane live without --fast, then repeat the same full-scope dry-run until it reports clean.",
				command:
					"npm run maintenance:weekly-refresh -- --today 2026-07-03 --only external-signals --live --confirm-full-live",
			},
		]);
		expect(summary.operatorNotes).toEqual([
			"External Signal Sync is processing a full-scope provider/source window: 15 project brief(s) would change across 15 evaluated project(s) and 15 source(s). Use the full-scope targeted live/dry-run loop, not --fast, until the lane reports clean.",
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
		expect(summary.recoveryPlan).toEqual([
			expect.objectContaining({
				step: "intelligence-sync",
				command:
					"npm run maintenance:weekly-refresh -- --today 2026-05-03 --only intelligence-sync --fast --step-timeout-minutes 5 --stream-child-output",
			}),
		]);
	});

	test("builds live repair plans for drift without replacing existing command hints", () => {
		const plan = buildWeeklyRefreshRecoveryPlan(
			{
				ok: true,
				liveRequested: false,
				liveExecuted: false,
				needsLiveWrite: true,
				status: "completed",
				today: "2026-05-03",
				config: "config/local-portfolio-control-tower.json",
				preflight: {
					summary: {},
					steps: [
						{
							key: "execution-sync",
							title: "Execution Sync",
							durationMs: 1000,
							live: false,
							wouldChange: true,
							status: "drift",
							summaryCounts: {},
							warnings: [],
						},
					],
				},
			},
			[],
			[],
		);

		expect(plan).toEqual([
			{
				step: "execution-sync",
				reason: "Dry-run found drift; run only this lane live, then repeat the same lane dry-run.",
				command:
					"npm run maintenance:weekly-refresh -- --today 2026-05-03 --only execution-sync --fast --live --confirm-full-live",
			},
		]);
	});

	test("summarizes per-lane timings in the compact output", () => {
		const timing = buildWeeklyRefreshTimingSummary([
			{
				key: "control-tower-sync",
				title: "Control Tower Sync",
				status: "clean",
				durationMs: 10_000,
			},
			{
				key: "intelligence-sync",
				title: "Intelligence Sync",
				status: "clean",
				durationMs: 50_000,
			},
		]);

		expect(timing).toMatchObject({
			totalDurationSeconds: 60,
			totalDurationMinutes: 1,
			slowStepThresholdSeconds: 30,
			longestStep: {
				key: "intelligence-sync",
				title: "Intelligence Sync",
				durationSeconds: 50,
			},
		});
		expect(timing.stepTimings).toEqual([
			expect.objectContaining({
				key: "intelligence-sync",
				durationSeconds: 50,
				percentOfRun: 83,
			}),
			expect.objectContaining({
				key: "control-tower-sync",
				durationSeconds: 10,
				percentOfRun: 17,
			}),
		]);
	});

	test("surfaces slow lanes above the operator visibility threshold", () => {
		const summary = buildWeeklyRefreshQuickSummary({
			ok: true,
			liveRequested: false,
			liveExecuted: false,
			needsLiveWrite: false,
			status: "clean",
			today: "2026-05-03",
			config: "config/local-portfolio-control-tower.json",
			preflight: {
				summary: {
					totalSteps: 1,
					cleanSteps: 1,
					driftSteps: 0,
					completedSteps: 0,
					partialSteps: 0,
					failedSteps: 0,
					skippedSteps: 0,
				},
				steps: [
					{
						key: "external-signals",
						title: "External Signal Sync",
						durationMs: 31_000,
						live: false,
						wouldChange: false,
						status: "clean",
						summaryCounts: {},
						warnings: [],
					},
				],
			},
		});

		expect(summary.slowSteps).toEqual([
			{
				key: "external-signals",
				durationSeconds: 31,
				thresholdSeconds: 30,
			},
		]);
	});
});

function valueAfter(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}
