import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import {
	buildDerivedPropertyUpdates,
	buildNextControlTowerPhaseState,
	buildSnapshotBatchInput,
	countControlTowerChangedRows,
} from "../src/notion/control-tower-sync.js";
import {
	applyDerivedSignals,
	buildStaleActiveRescueItems,
	type ControlTowerBuildSessionRecord,
	type ControlTowerProjectRecord,
	calculateControlTowerMetrics,
	deriveEvidenceFreshness,
	deriveNextReviewDate,
	deriveOperatingQueue,
	parseLocalPortfolioControlTowerConfig,
	renderCommandCenterMarkdown,
	renderFreshnessByLayerSection,
	renderWeeklyReviewMarkdown,
} from "../src/notion/local-portfolio-control-tower.js";
import {
	type DataSourcePageRef,
	toControlTowerProjectRecord,
} from "../src/notion/local-portfolio-control-tower-live.js";
import type { ExternalSignalSourceRecord } from "../src/notion/local-portfolio-external-signals.js";
import {
	buildRoadmapPhases,
	renderLocalPortfolioAdrMarkdown,
	renderNotionRoadmapMarkdown,
} from "../src/notion/local-portfolio-roadmap.js";
import {
	ACTUATION_COMMAND_CENTER_SECTION,
	COMMAND_CENTER_MANAGED_SECTIONS,
	GOVERNANCE_COMMAND_CENTER_SECTION,
} from "../src/notion/managed-markdown-sections.js";
import {
	buildRepoMappingAudit,
	loadRepoMappingProjectionPolicy,
	REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION,
} from "../src/notion/repo-mapping-audit.js";
import { buildStaleActiveRescueUpdatePlan } from "../src/notion/stale-active-rescue.js";

const TODAY = "2026-03-17";

describe("local portfolio control tower rules", () => {
	test("parses the repo control-tower config", async () => {
		const raw = JSON.parse(
			await readFile(
				new URL(
					"../config/local-portfolio-control-tower.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const config = parseLocalPortfolioControlTowerConfig(raw);

		expect(config.database.name).toBe("Local Portfolio Projects");
		expect(config.fieldOwnership.derived).toEqual(
			expect.arrayContaining([
				"Operating Queue",
				"Next Review Date",
				"Evidence Freshness",
				"Recommendation Lane",
				"Recommendation Score",
				"Recommendation Confidence",
				"Recommendation Updated",
			]),
		);
		expect(config.queuePrecedence).toContain("Resume Now");
	});

	test("derives queue precedence in the expected order", async () => {
		const config = await loadConfig();

		expect(
			deriveOperatingQueue({
				currentState: "Shipped",
				needsReview: true,
				portfolioCall: "Finish",
				runsLocally: "Yes",
				setupFriction: "Low",
			}),
		).toBe("Shipped");

		expect(
			deriveOperatingQueue({
				currentState: "Needs Decision",
				needsReview: true,
				portfolioCall: "Finish",
				runsLocally: "Yes",
				setupFriction: "Low",
			}),
		).toBe("Needs Review");

		const project = applyDerivedSignals(
			{
				...baseProject(),
				currentState: "Active Build",
				portfolioCall: "Build Now",
				runsLocally: "Yes",
				setupFriction: "Low",
			},
			config,
			TODAY,
		);
		expect(project.operatingQueue).toBe("Resume Now");
	});

	test("derives review dates and freshness windows from the newest evidence date", async () => {
		const config = await loadConfig();
		const project = baseProject({
			currentState: "Ready to Demo",
			lastActive: "2026-03-10",
			lastBuildSessionDate: "2026-03-12",
		});

		expect(deriveNextReviewDate(project, config.reviewCadenceDays)).toBe(
			"2026-03-26",
		);
		expect(
			deriveEvidenceFreshness(project, config.freshnessWindows, TODAY),
		).toBe("Fresh");
		expect(
			deriveEvidenceFreshness(
				{
					...project,
					lastActive: "2026-01-01",
					lastBuildSessionDate: "",
				},
				config.freshnessWindows,
				TODAY,
			),
		).toBe("Stale");
	});

	test("calculates completeness and review metrics", async () => {
		const config = await loadConfig();
		const projects = [
			applyDerivedSignals(
				baseProject({
					title: "Needs Decision",
					currentState: "Needs Decision",
				}),
				config,
				TODAY,
			),
			applyDerivedSignals(
				baseProject({
					title: "Orphan",
					currentState: "Active Build",
					nextMove: "",
					buildSessionCount: 0,
					relatedResearchCount: 0,
					supportingSkillsCount: 0,
					linkedToolCount: 0,
					lastActive: "",
					lastBuildSessionDate: "",
				}),
				config,
				TODAY,
			),
		];
		const metrics = calculateControlTowerMetrics(projects, [], TODAY);

		expect(metrics.queueCounts["Needs Decision"]).toBe(1);
		expect(metrics.missingNextMove).toBe(1);
		expect(metrics.missingLastActive).toBe(1);
		expect(metrics.orphanedProjects).toBe(1);
	});

	test("classifies stale active projects into operator rescue reasons", async () => {
		const config = await loadConfig();
		const projects = [
			applyDerivedSignals(
				baseProject({
					title: "Needs Next Move",
					currentState: "Active Build",
					nextMove: "",
					lastActive: "2026-01-01",
					lastBuildSessionDate: "2026-01-01",
				}),
				config,
				TODAY,
			),
			applyDerivedSignals(
				baseProject({
					title: "Thin Support",
					currentState: "Active Build",
					lastActive: "2026-01-02",
					lastBuildSessionDate: "2026-01-02",
					relatedResearchCount: 0,
					supportingSkillsCount: 0,
					linkedToolCount: 0,
				}),
				config,
				TODAY,
			),
		];

		const items = buildStaleActiveRescueItems(projects, TODAY);

		expect(items.map((item) => item.reason)).toEqual([
			"overdue-review",
			"missing-next-move",
		]);
		expect(items[1]?.nextAction).toContain("Next Move");
	});

	test("plans missing local repo rows as mapping decisions", async () => {
		const config = await loadConfig();
		const [item] = buildStaleActiveRescueItems(
			[
				applyDerivedSignals(
					baseProject({
						title: "Missing Local Repo",
						currentState: "Active Build",
						lastActive: "2026-01-01",
						lastBuildSessionDate: "2026-01-01",
					}),
					config,
					TODAY,
				),
			],
			TODAY,
		);

		const plan = buildStaleActiveRescueUpdatePlan({
			item: item!,
			today: TODAY,
			reviewCadenceDays: config.reviewCadenceDays,
			projectsRoot: "/tmp/notion-os-no-such-projects-root",
		});

		expect(plan.action).toBe("repair-mapping-decision");
		expect(plan.summary.currentState).toBe("Needs Decision");
		expect(plan.summary.nextMove).toContain("Repair project mapping");
		expect(plan.properties["Current State"]).toEqual({
			select: { name: "Needs Decision" },
		});
	});

	test("builds the decision queue and repo mapping audit packet", () => {
		const projectsRoot = mkdtempSync(join(tmpdir(), "notion-repo-audit-"));
		try {
			mkdirSync(join(projectsRoot, "MappedProject", ".git"), {
				recursive: true,
			});
			mkdirSync(join(projectsRoot, "ScreenshottoDataSelect", ".git"), {
				recursive: true,
			});

			const result = buildRepoMappingAudit({
				today: TODAY,
				projectsRoot,
				projectPages: [
					projectPage({
						id: "needs-decision",
						title: "MappedProject",
						currentState: "Needs Decision",
						localPath: "MappedProject.",
					}),
					projectPage({
						id: "missing-repo",
						title: "Missing Local Repo",
						currentState: "Active Build",
						operatingQueue: "Resume Now",
					}),
					projectPage({
						id: "screenshot-annotate",
						title: "ScreenshotAnnotate",
						currentState: "Needs Decision",
					}),
				],
				sources: [
					githubSource({
						localProjectIds: ["needs-decision"],
						status: "Active",
						identifier: "saagpatel/MappedProject",
						sourceUrl: "https://github.com/saagpatel/MappedProject",
					}),
					githubSource({
						localProjectIds: ["screenshot-annotate"],
						status: "Needs Mapping",
					}),
				],
			});

			expect(result.decisionQueueCount).toBe(2);
			expect(result.localMappingGapCount).toBe(3);
			expect(result.githubMappingGapCount).toBe(2);
			expect(result.projects.map((project) => project.title)).toEqual([
				"ScreenshotAnnotate",
				"MappedProject",
				"Missing Local Repo",
			]);
			expect(result.projects[0]?.localMappingStatus).toBe("ambiguous");
			expect(result.projects[0]?.repoCandidates[0]).toContain(
				"ScreenshottoDataSelect",
			);
			expect(result.projects[1]?.localMappingStatus).toBe(
				"needs-normalization",
			);
			expect(result.projects[1]?.recommendedLocalPath).toBe("MappedProject");
			expect(result.markdown).toContain(
				"Decision Queue and Repo Mapping Audit",
			);
		} finally {
			rmSync(projectsRoot, { recursive: true, force: true });
		}
	});

	test("treats blank paused GitHub sources as documented non-mappings", () => {
		const result = buildRepoMappingAudit({
			today: TODAY,
			projectsRoot: "/tmp/notion-os-no-such-projects-root",
			includeAllGaps: true,
			projectPages: [
				projectPage({
					id: "monitor-only",
					title: "Monitor Only",
					currentState: "Shipped",
					operatingQueue: "Shipped",
				}),
			],
			sources: [
				githubSource({
					localProjectIds: ["monitor-only"],
					status: "Paused",
					identifier: "",
					sourceUrl: "",
				}),
			],
		});

		expect(result.githubMappingGapCount).toBe(0);
		expect(result.projects[0]?.githubSourceStatus).toBe("paused");
	});

	test("exempts parked or archived rows with paused sources from local-path repair noise", () => {
		const result = buildRepoMappingAudit({
			today: TODAY,
			projectsRoot: "/tmp/notion-os-no-such-projects-root",
			includeAllGaps: true,
			projectPages: [
				projectPage({
					id: "parked-local-artifact",
					title: "Parked Local Artifact",
					currentState: "Parked",
					localPath: "parked-local-artifact",
				}),
				projectPage({
					id: "archived-placeholder",
					title: "Archived Placeholder",
					currentState: "Archived",
					localPath: "archived-placeholder",
				}),
				projectPage({
					id: "active-missing",
					title: "Active Missing",
					currentState: "Active Build",
					localPath: "active-missing",
				}),
			],
			sources: [
				githubSource({
					localProjectIds: ["parked-local-artifact"],
					status: "Paused",
					identifier: "",
					sourceUrl: "",
				}),
				githubSource({
					localProjectIds: ["archived-placeholder"],
					status: "Paused",
					identifier: "",
					sourceUrl: "",
				}),
				githubSource({
					localProjectIds: ["active-missing"],
					status: "Paused",
					identifier: "",
					sourceUrl: "",
				}),
			],
		});

		expect(result.localMappingGapCount).toBe(1);
		expect(result.githubMappingGapCount).toBe(0);
		expect(result.attentionCount).toBe(1);
		expect(result.projects.map((project) => project.title)).toEqual([
			"Active Missing",
		]);
	});

	test("uses shared projection policy for alias rows and projection-only rows", () => {
		const projectsRoot = mkdtempSync(join(tmpdir(), "notion-os-policy-repos-"));
		try {
			mkdirSync(join(projectsRoot, "DesktopPEt", ".git"), { recursive: true });
			const result = buildRepoMappingAudit({
				today: TODAY,
				projectsRoot,
				includeAllGaps: true,
				projectionPolicy: {
					notionTitleAliases: {
						"DesktopPEt-ready": "DesktopPEt",
					},
					notionProjectionOnlyRows: {
						"Sandbox Local Portfolio Project": "actuation sandbox fixture row",
					},
					notionTruthShadowRows: {},
				},
				projectPages: [
					projectPage({
						id: "desktop-ready",
						title: "DesktopPEt-ready",
						currentState: "Needs Decision",
					}),
					projectPage({
						id: "sandbox",
						title: "Sandbox Local Portfolio Project",
						currentState: "Active Build",
					}),
				],
				sources: [
					githubSource({
						localProjectIds: ["desktop-ready"],
						status: "Active",
						identifier: "saagpatel/DesktopPEt-ready",
						sourceUrl: "https://github.com/saagpatel/DesktopPEt-ready",
					}),
				],
			});

			expect(result.decisionQueueCount).toBe(1);
			expect(result.localMappingGapCount).toBe(0);
			expect(result.githubMappingGapCount).toBe(0);
			expect(result.attentionCount).toBe(1);
			expect(result.projects.map((project) => project.title)).toEqual([
				"DesktopPEt-ready",
			]);
			expect(result.projects[0]?.localMappingStatus).toBe("inferred");
			expect(result.projects[0]?.recommendedLocalPath).toBe("DesktopPEt");
			expect(result.projects[0]?.projectionPolicyStatus).toBe("alias");
			expect(result.projects[0]?.projectionPolicyTarget).toBe("DesktopPEt");
		} finally {
			rmSync(projectsRoot, { recursive: true, force: true });
		}
	});

	test("loads only versioned shared projection policy from project registry", () => {
		const policyDir = mkdtempSync(join(tmpdir(), "notion-os-policy-registry-"));
		try {
			const registryPath = join(policyDir, "project-registry.json");
			writeFileSync(
				registryPath,
				JSON.stringify({
					projection_policy: {
						schema_version: REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION,
						notion_title_aliases: {
							"DesktopPEt-ready": "DesktopPEt",
						},
						notion_projection_only_rows: {
							"Sandbox Local Portfolio Project":
								"actuation sandbox fixture row",
						},
						notion_truth_shadow_rows: {
							"PortfolioCommandCenter-public": "PortfolioCommandCenter",
						},
					},
				}),
			);

			expect(loadRepoMappingProjectionPolicy(registryPath)).toEqual({
				schemaVersion: REPO_MAPPING_PROJECTION_POLICY_SCHEMA_VERSION,
				notionTitleAliases: {
					"DesktopPEt-ready": "DesktopPEt",
				},
				notionProjectionOnlyRows: {
					"Sandbox Local Portfolio Project": "actuation sandbox fixture row",
				},
				notionTruthShadowRows: {
					"PortfolioCommandCenter-public": "PortfolioCommandCenter",
				},
			});

			const unversionedPath = join(policyDir, "unversioned-registry.json");
			writeFileSync(
				unversionedPath,
				JSON.stringify({
					projection_policy: {
						notion_title_aliases: {
							"Wrong-alias": "Wrong",
						},
						notion_projection_only_rows: {},
						notion_truth_shadow_rows: {},
					},
				}),
			);

			expect(loadRepoMappingProjectionPolicy(unversionedPath)).not.toEqual(
				expect.objectContaining({
					notionTitleAliases: {
						"Wrong-alias": "Wrong",
					},
				}),
			);
		} finally {
			rmSync(policyDir, { recursive: true, force: true });
		}
	});

	test("counts only the rows whose derived properties actually changed", async () => {
		const config = await loadConfig();
		const previousProjects = [
			applyDerivedSignals(
				baseProject({
					id: "project-stable",
					title: "Stable",
					currentState: "Active Build",
					portfolioCall: "Build Now",
					lastActive: "2026-03-16",
					lastBuildSessionDate: "2026-03-16",
				}),
				config,
				TODAY,
			),
			applyDerivedSignals(
				baseProject({
					id: "project-changed",
					title: "Changed",
					currentState: "Active Build",
					portfolioCall: "Build Now",
					lastActive: "2026-01-01",
					lastBuildSessionDate: "2026-01-01",
				}),
				config,
				TODAY,
			),
		];

		const nextProjects = [
			previousProjects[0]!,
			{
				...previousProjects[1]!,
				evidenceFreshness: "Stale" as const,
				nextReviewDate: "2026-03-18",
			},
		];

		expect(countControlTowerChangedRows(previousProjects, nextProjects)).toBe(
			1,
		);
	});

	test("builds live updates only for changed derived fields", () => {
		const previous = baseProject({
			operatingQueue: "Resume Now",
			nextReviewDate: "2026-03-20",
			evidenceFreshness: "Fresh",
		});
		const next = {
			...previous,
			nextReviewDate: "2026-03-27",
		};

		expect(buildDerivedPropertyUpdates(previous, next)).toEqual({
			"Next Review Date": { date: { start: "2026-03-27" } },
		});
	});

	test("preserves governance and actuation command center sections", () => {
		expect(COMMAND_CENTER_MANAGED_SECTIONS).toEqual(
			expect.arrayContaining([
				GOVERNANCE_COMMAND_CENTER_SECTION,
				ACTUATION_COMMAND_CENTER_SECTION,
			]),
		);
	});

	test("emits no live updates when derived fields are unchanged", () => {
		const stable = baseProject({
			operatingQueue: "Resume Now",
			nextReviewDate: "2026-03-20",
			evidenceFreshness: "Fresh",
		});

		expect(buildDerivedPropertyUpdates(stable, { ...stable })).toEqual({});
	});

	test("reads Open PR Count as a real number once external-signal-sync has populated it (P5)", () => {
		const page = projectPage({
			id: "project-1",
			title: "Sample",
			currentState: "Active Build",
		});
		page.properties["Open PR Count"] = { type: "number", number: 3 };

		expect(toControlTowerProjectRecord(page).openPrCount).toBe(3);
	});

	test("leaves Open PR Count undefined, not 0, when external-signal-sync has never run (P5)", () => {
		const page = projectPage({
			id: "project-1",
			title: "Sample",
			currentState: "Active Build",
		});

		expect(toControlTowerProjectRecord(page).openPrCount).toBeUndefined();
	});

	test("threads a project's real Open PR Count into the snapshot batch input (P5)", () => {
		const project = baseProject({ id: "project-1", openPrCount: 4 });

		expect(buildSnapshotBatchInput([project])).toEqual([
			expect.objectContaining({ id: "project-1", openPrCount: 4 }),
		]);
	});

	test("records null, not a fabricated 0, when a project has no Open PR Count yet (P5)", () => {
		const project = baseProject({ id: "project-1", openPrCount: undefined });

		expect(buildSnapshotBatchInput([project])).toEqual([
			expect.objectContaining({ id: "project-1", openPrCount: null }),
		]);
	});

	test("keeps changed-row counting stable when multiple fields change on one row", () => {
		const previousProjects = [
			baseProject({
				id: "project-1",
				operatingQueue: "Worth Finishing",
				nextReviewDate: "2026-03-20",
				evidenceFreshness: "Aging",
			}),
			baseProject({
				id: "project-2",
				operatingQueue: "Resume Now",
				nextReviewDate: "2026-03-18",
				evidenceFreshness: "Fresh",
			}),
		];
		const nextProjects = [
			{
				...previousProjects[0]!,
				operatingQueue: "Resume Now" as const,
				nextReviewDate: "2026-03-27",
				evidenceFreshness: "Stale" as const,
			},
			previousProjects[1]!,
		];

		expect(countControlTowerChangedRows(previousProjects, nextProjects)).toBe(
			1,
		);
	});

	test("captures the baseline once and keeps later sync metrics deterministic", () => {
		const metrics = {
			totalProjects: 1,
			queueCounts: {
				Shipped: 0,
				"Needs Review": 0,
				"Needs Decision": 0,
				"Worth Finishing": 0,
				"Resume Now": 1,
				"Cold Storage": 0,
				Watch: 0,
			},
			overdueReviews: 0,
			staleActiveProjects: 0,
			missingNextMove: 0,
			missingLastActive: 0,
			orphanedProjects: 0,
			recentBuildSessions: 1,
		};

		const initial = buildNextControlTowerPhaseState(
			{
				currentPhase: 1,
				currentPhaseStatus: "Active",
			},
			metrics,
			"2026-03-17",
		);
		const followUp = buildNextControlTowerPhaseState(
			{
				...initial.phaseState,
				baselineMetrics: metrics,
				baselineCapturedAt: "2026-03-17",
			},
			{
				...metrics,
				recentBuildSessions: 2,
			},
			"2026-03-24",
		);

		expect(initial.baselineCaptured).toBe(true);
		expect(initial.phaseState.baselineCapturedAt).toBe("2026-03-17");
		expect(initial.phaseState.lastSyncMetrics).toEqual(metrics);
		expect(followUp.baselineCaptured).toBe(false);
		expect(followUp.phaseState.baselineCapturedAt).toBe("2026-03-17");
		expect(followUp.phaseState.baselineMetrics).toEqual(metrics);
		expect(followUp.phaseState.lastSyncMetrics).toEqual({
			...metrics,
			recentBuildSessions: 2,
		});
	});

	test("renders command-center, review-packet, roadmap, and ADR artifacts", async () => {
		const config = await loadConfig();
		const projects = [
			applyDerivedSignals(
				baseProject({
					title: "Resume Fast",
					currentState: "Active Build",
					portfolioCall: "Build Now",
					nextMove: "Run the local boot flow",
				}),
				config,
				TODAY,
			),
		];
		const sessions: ControlTowerBuildSessionRecord[] = [
			{
				id: "session-1",
				url: "https://notion.so/session-1",
				title: "Shipped command center scaffolding",
				sessionDate: "2026-03-16",
				outcome: "Shipped",
				localProjectIds: [projects[0]!.id],
			},
		];

		const metrics = calculateControlTowerMetrics(projects, sessions, TODAY);
		const commandCenter = renderCommandCenterMarkdown({
			generatedAt: TODAY,
			metrics,
			baselineMetrics: metrics,
			projects,
			recentBuildSessions: sessions,
			config,
			today: TODAY,
		});
		const reviewPacket = renderWeeklyReviewMarkdown({
			weekTitle: "Week of 2026-03-16",
			compareStartDate: "2026-03-09",
			compareLabel: "Since 2026-03-09",
			projectsChanged: projects,
			projectsNeedDecision: [],
			projectsWorthFinishing: [],
			overdueProjects: [],
			staleActiveProjects: [],
			recentBuildSessions: sessions,
			topPrioritiesNextWeek: ["Resume Resume Fast."],
			nextPhaseBrief: "Phase 2 will add the project decision register.",
		});
		const roadmap = renderNotionRoadmapMarkdown({
			generatedAt: TODAY,
			currentPhase: 2,
			currentPhaseStatus: "Planned",
			baselineMetrics: metrics,
			latestMetrics: metrics,
			lastClosedPhase: 1,
		});
		const adr = renderLocalPortfolioAdrMarkdown();

		expect(commandCenter).toContain("Local Portfolio Command Center");
		expect(commandCenter).toContain("Today's Attention");
		expect(commandCenter).toContain("Stale Active Projects");
		expect(commandCenter).toContain("Saved Views");
		expect(commandCenter).toContain(
			"codex:notion-freshness-command-center:start",
		);
		expect(commandCenter).toContain("Support maintenance");
		expect(commandCenter).toContain(
			"codex:notion-execution-command-center:start",
		);
		expect(reviewPacket).toContain("## Next Phase");
		expect(reviewPacket).toContain(
			"codex:notion-weekly-external-signals:start",
		);
		expect(roadmap).toContain("Phase: 2 - Project Execution System");
		expect(roadmap).toContain("## Phase Transition Memory");
		expect(roadmap).toContain(
			"Build the project execution system around Local Portfolio Projects",
		);
		expect(roadmap).toContain("## Phase Memory");
		expect(roadmap).toContain("Phase 2 gave us structured execution data");
		expect(roadmap).toContain("Phase 3 - Cross-Database Intelligence");
		expect(roadmap).toContain(
			"Phase 3 will turn the combined project, execution, research, skill, and tool records",
		);
		expect(roadmap).toContain("### Phase 4: Premium-Native Augmentation");
		expect(roadmap).toContain("### Phase 5: External Signal Integration");
		expect(roadmap).toContain("### Phase 6: Cross-System Governance");
		expect(adr).toContain(
			"Local Portfolio Projects is the project control tower",
		);
		expect(buildRoadmapPhases(2, "Planned", true)[1]?.status).toBe("Planned");
	});

	test("renders recovered missed weekday catch-up in freshness section", async () => {
		const config = await loadConfig();
		const section = renderFreshnessByLayerSection({
			...config,
			weeklyMaintenance: {
				...config.weeklyMaintenance,
				weeklyRefreshLastRunAt: "2026-06-06",
				weeklyRefreshLastStatus: "completed",
				weeklyRefreshLastSummary: {
					missedWeekdays: 4,
					staleBeforeRun: "yes",
					catchUpRecovered: "yes",
				},
			},
		});

		expect(section).toContain(
			"Weekly refresh: 2026-06-06 (completed; caught up after 4 missed weekday(s))",
		);
	});
});

async function loadConfig() {
	const raw = JSON.parse(
		await readFile(
			new URL("../config/local-portfolio-control-tower.json", import.meta.url),
			"utf8",
		),
	);
	return parseLocalPortfolioControlTowerConfig(raw);
}

function baseProject(
	overrides: Partial<ControlTowerProjectRecord> = {},
): ControlTowerProjectRecord {
	return {
		id: overrides.id ?? "project-1",
		url: overrides.url ?? "https://notion.so/project-1",
		title: overrides.title ?? "Sample Project",
		currentState: overrides.currentState ?? "Active Build",
		portfolioCall: overrides.portfolioCall ?? "Finish",
		needsReview: overrides.needsReview ?? false,
		nextMove: overrides.nextMove ?? "Ship the next small milestone",
		biggestBlocker: overrides.biggestBlocker ?? "Need one more pass",
		lastActive: overrides.lastActive ?? "2026-03-12",
		lastBuildSessionDate: overrides.lastBuildSessionDate ?? "2026-03-13",
		buildSessionCount: overrides.buildSessionCount ?? 1,
		relatedResearchCount: overrides.relatedResearchCount ?? 1,
		supportingSkillsCount: overrides.supportingSkillsCount ?? 1,
		linkedToolCount: overrides.linkedToolCount ?? 1,
		setupFriction: overrides.setupFriction ?? "Low",
		runsLocally: overrides.runsLocally ?? "Yes",
		buildMaturity: overrides.buildMaturity ?? "Feature Complete",
		shipReadiness: overrides.shipReadiness ?? "Near Ship",
		effortToDemo: overrides.effortToDemo ?? "1 day",
		effortToShip: overrides.effortToShip ?? "2-3 days",
		oneLinePitch: overrides.oneLinePitch ?? "A control-tower test project",
		valueOutcome: overrides.valueOutcome ?? "Clear PM visibility",
		monetizationValue: overrides.monetizationValue ?? "Strategic leverage",
		evidenceConfidence: overrides.evidenceConfidence ?? "High",
		docsQuality: overrides.docsQuality ?? "Strong",
		testPosture: overrides.testPosture ?? "Some",
		category: overrides.category ?? "Dev Tool",
		operatingQueue: overrides.operatingQueue,
		nextReviewDate: overrides.nextReviewDate,
		evidenceFreshness: overrides.evidenceFreshness,
		openPrCount: overrides.openPrCount,
	};
}

function projectPage(overrides: {
	id: string;
	title: string;
	currentState: string;
	operatingQueue?: string;
	localPath?: string;
}): DataSourcePageRef {
	return {
		id: overrides.id,
		url: `https://notion.so/${overrides.id}`,
		title: overrides.title,
		properties: {
			"Current State": {
				type: "select",
				select: { name: overrides.currentState },
			},
			"Operating Queue": {
				type: "select",
				select: overrides.operatingQueue
					? { name: overrides.operatingQueue }
					: null,
			},
			"Portfolio Call": { type: "select", select: { name: "Finish" } },
			"Next Move": {
				type: "rich_text",
				rich_text: [{ plain_text: "Review the next move" }],
			},
			"Local Path": {
				type: "rich_text",
				rich_text: overrides.localPath
					? [{ plain_text: overrides.localPath }]
					: [],
			},
			"Last Active": { type: "date", date: { start: "2026-03-12" } },
			"Evidence Freshness": { type: "select", select: { name: "Fresh" } },
		},
	};
}

function githubSource(
	overrides: Partial<ExternalSignalSourceRecord> = {},
): ExternalSignalSourceRecord {
	return {
		id: overrides.id ?? "source-1",
		url: overrides.url ?? "https://notion.so/source-1",
		title: overrides.title ?? "MappedProject - GitHub Repo",
		localProjectIds: overrides.localProjectIds ?? [],
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
