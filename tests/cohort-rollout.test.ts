import { describe, expect, test } from "vitest";

import {
	buildCohortIssueNextMove,
	buildCohortRolloutPlan,
	parseCohortProjectSelection,
} from "../src/notion/cohort-rollout.js";
import type {
	ActuationActionKey,
	LocalPortfolioActuationTargetConfig,
} from "../src/notion/local-portfolio-actuation.js";
import type {
	ControlTowerProjectRecord,
	OperatingQueue,
} from "../src/notion/local-portfolio-control-tower.js";
import type {
	ExternalSignalSourceRecord,
	LocalPortfolioExternalSignalSourceConfig,
} from "../src/notion/local-portfolio-external-signals.js";

describe("cohort rollout", () => {
	test("defaults to the fixed four-project cohort in deterministic order", () => {
		expect(parseCohortProjectSelection()).toEqual([
			"BattleGrid",
			"EarthPulse",
			"Relay",
			"SynthWave",
		]);
		expect(
			parseCohortProjectSelection("Relay,BattleGrid,SynthWave,EarthPulse"),
		).toEqual(["BattleGrid", "EarthPulse", "Relay", "SynthWave"]);
	});

	test("builds the four-project plan and excludes EarthPulse-readiness", () => {
		const plan = buildCohortRolloutPlan({
			selectedTitles: parseCohortProjectSelection(
				"BattleGrid,EarthPulse,Relay,SynthWave",
			),
			projects: [
				baseProject({ id: "battlegrid", title: "BattleGrid" }),
				baseProject({ id: "earthpulse", title: "EarthPulse" }),
				baseProject({
					id: "earthpulse-readiness",
					title: "EarthPulse-readiness",
				}),
				baseProject({ id: "relay", title: "Relay" }),
				baseProject({
					id: "synthwave",
					title: "SynthWave",
					currentState: "Archived",
					portfolioCall: "Archive",
					operatingQueue: "Needs Review",
					needsReview: true,
				}),
			],
			githubSources: [
				baseSource({
					id: "battlegrid-source",
					title: "BattleGrid GitHub Repo",
					localProjectIds: ["battlegrid"],
					identifier: "saagpatel/BattleGrid",
					sourceUrl: "https://github.com/saagpatel/BattleGrid",
					status: "Active",
				}),
				baseSource({
					id: "earthpulse-source",
					title: "EarthPulse GitHub Repo",
					localProjectIds: ["earthpulse"],
					identifier: "saagpatel/EarthPulse",
					sourceUrl: "https://github.com/saagpatel/EarthPulse",
					status: "Active",
				}),
				baseSource({
					id: "relay-source",
					title: "Relay GitHub Repo",
					localProjectIds: ["relay"],
					identifier: "saagpatel/Relay",
					sourceUrl: "https://github.com/saagpatel/Relay",
					status: "Active",
				}),
			],
			sourceConfig: baseSourceConfig(),
			targetConfig: baseTargetConfig(),
			today: "2026-03-21",
		});

		expect(plan.orderedTitles).toEqual([
			"BattleGrid",
			"EarthPulse",
			"Relay",
			"SynthWave",
		]);
		expect(plan.projects).toHaveLength(4);
		expect(plan.projects.map((project) => project.title)).toEqual([
			"BattleGrid",
			"EarthPulse",
			"Relay",
			"SynthWave",
		]);
		expect(plan.summary.projectFieldUpdates).toBe(4);
		expect(plan.summary.sourceUpserts).toBe(1);
		expect(plan.summary.decisionUpserts).toBe(4);
		expect(plan.summary.actionRequestPreviews).toBe(4);
		expect(plan.projects.map((project) => project.desiredQueue)).toEqual([
			"Worth Finishing",
			"Worth Finishing",
			"Worth Finishing",
			"Worth Finishing",
		]);
		expect(
			plan.projects.every(
				(project) => project.classification === "move to GitHub next",
			),
		).toBe(true);
		expect(
			plan.projects.every(
				(project) => project.githubLane === "active_allowlisted",
			),
		).toBe(true);
		expect(
			plan.projects.find((project) => project.title === "SynthWave")
				?.sourceAction,
		).toBe("upsert_active");
	});

	test("rewrites next moves into issue-focused rollout language", () => {
		expect(
			buildCohortIssueNextMove(
				"Run cargo tauri dev and capture the first blocker.",
			),
		).toContain("create and work from the governed GitHub issue");
	});
});

function baseProject(
	overrides: Partial<ControlTowerProjectRecord> = {},
): ControlTowerProjectRecord {
	return {
		id: overrides.id ?? "project-1",
		url: overrides.url ?? "https://notion.so/project-1",
		title: overrides.title ?? "BattleGrid",
		currentState: overrides.currentState ?? "Active Build",
		portfolioCall: overrides.portfolioCall ?? "Finish",
		needsReview: overrides.needsReview ?? true,
		nextMove:
			overrides.nextMove ??
			"Run the main dev command and capture the first blocker.",
		biggestBlocker: overrides.biggestBlocker ?? "",
		lastActive: overrides.lastActive ?? "2026-03-17",
		lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-17",
		buildSessionCount: overrides.buildSessionCount ?? 1,
		relatedResearchCount: overrides.relatedResearchCount ?? 0,
		supportingSkillsCount: overrides.supportingSkillsCount ?? 0,
		linkedToolCount: overrides.linkedToolCount ?? 0,
		setupFriction: overrides.setupFriction ?? "Medium",
		runsLocally: overrides.runsLocally ?? "Unknown",
		buildMaturity: overrides.buildMaturity ?? "Feature Complete",
		shipReadiness: overrides.shipReadiness ?? "Near Ship",
		effortToDemo: overrides.effortToDemo ?? "1-2 sessions",
		effortToShip: overrides.effortToShip ?? "1 sprint",
		oneLinePitch: overrides.oneLinePitch ?? "Pitch",
		valueOutcome: overrides.valueOutcome ?? "High",
		monetizationValue: overrides.monetizationValue ?? "Strategic",
		evidenceConfidence: overrides.evidenceConfidence ?? "Medium",
		docsQuality: overrides.docsQuality ?? "Okay",
		testPosture: overrides.testPosture ?? "Partial",
		category: overrides.category ?? "Desktop App",
		operatingQueue:
			overrides.operatingQueue ?? ("Needs Review" as OperatingQueue),
		nextReviewDate: overrides.nextReviewDate ?? "2026-03-24",
		evidenceFreshness: overrides.evidenceFreshness ?? "Fresh",
	};
}

function baseSource(
	overrides: Partial<ExternalSignalSourceRecord> = {},
): ExternalSignalSourceRecord {
	return {
		id: overrides.id ?? "source-1",
		url: overrides.url ?? "https://notion.so/source-1",
		title: overrides.title ?? "Project GitHub Repo",
		localProjectIds: overrides.localProjectIds ?? ["project-1"],
		provider: overrides.provider ?? "GitHub",
		sourceType: overrides.sourceType ?? "Repo",
		identifier: overrides.identifier ?? "",
		sourceUrl: overrides.sourceUrl ?? "",
		status: overrides.status ?? "Needs Mapping",
		environment: overrides.environment ?? "N/A",
		syncStrategy: overrides.syncStrategy ?? "Poll",
		lastSyncedAt: overrides.lastSyncedAt ?? "",
	};
}

function baseTargetConfig(): LocalPortfolioActuationTargetConfig {
	return {
		version: 1,
		strategy: {
			primary: "repo_config",
			fallback: "manual_review",
			notes: [],
		},
		defaults: {
			allowedActions: ["github.create_issue"],
			titlePrefix: "[Portfolio]",
			defaultLabels: [],
			supportsIssueCreate: true,
			supportsPrComment: true,
		},
		targets: [
			buildTarget("BattleGrid", "battlegrid", "saagpatel/BattleGrid"),
			buildTarget("EarthPulse", "earthpulse", "saagpatel/EarthPulse"),
			buildTarget("Relay", "relay", "saagpatel/Relay"),
			buildTarget("SynthWave", "synthwave", "saagpatel/SynthWave"),
		],
	};
}

function buildTarget(title: string, localProjectId: string, slug: string) {
	return {
		title,
		localProjectId,
		sourceIdentifier: slug,
		sourceUrl: `https://github.com/${slug}`,
		allowedActions: ["github.create_issue" as ActuationActionKey],
		titlePrefix: "[Portfolio]",
		defaultLabels: [],
		supportsIssueCreate: true,
		supportsPrComment: true,
	};
}

function baseSourceConfig(): LocalPortfolioExternalSignalSourceConfig {
	return {
		version: 1,
		strategy: {
			primary: "direct_rest",
			fallback: "manual_review",
			notes: [],
		},
		seedRules: {
			targetQueues: ["Resume Now", "Worth Finishing", "Needs Decision"],
			includePacketPriorities: ["Now", "Standby"],
			limit: 15,
		},
		sourceTemplates: [
			{
				provider: "GitHub",
				sourceType: "Repo",
				titleSuffix: "GitHub Repo",
				defaultStatus: "Needs Mapping",
				defaultEnvironment: "N/A",
				defaultSyncStrategy: "Poll",
			},
		],
		manualSeeds: [
			{
				title: "SynthWave GitHub Repo",
				localProjectId: "synthwave",
				provider: "GitHub",
				sourceType: "Repo",
				status: "Active",
				environment: "N/A",
				syncStrategy: "Poll",
				identifier: "saagpatel/SynthWave",
				sourceUrl: "https://github.com/saagpatel/SynthWave",
			},
		],
	};
}
