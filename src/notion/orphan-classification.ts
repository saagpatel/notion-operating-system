import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { Publisher } from "../publishing/publisher.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	applyDerivedSignals,
	type ControlTowerProjectRecord,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";

export type OrphanDisposition =
	| "already_parked"
	| "archive_candidate"
	| "viable_needs_kickoff";

export interface OrphanClassificationResult {
	projectId: string;
	projectTitle: string;
	category: string;
	portfolioCall: string;
	currentState: string;
	lastActive: string;
	disposition: OrphanDisposition;
	reason: string;
}

export interface OrphanClassificationCommandOptions {
	live?: boolean;
	createPackets?: boolean;
	today?: string;
	config?: string;
}

const ARCHIVE_CATEGORIES = new Set([
	"Experiment",
	"Prototype",
	"Tool",
	"Script",
]);
const ARCHIVE_INACTIVE_DAYS = 180;

function isOrphan(project: ControlTowerProjectRecord): boolean {
	return (
		project.buildSessionCount === 0 &&
		project.relatedResearchCount === 0 &&
		project.supportingSkillsCount === 0 &&
		project.linkedToolCount === 0
	);
}

function diffDays(fromDate: string, toDate: string): number {
	const from = new Date(`${fromDate}T00:00:00Z`);
	const to = new Date(`${toDate}T00:00:00Z`);
	return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function classifyOrphan(
	project: ControlTowerProjectRecord,
	today: string,
): OrphanClassificationResult {
	// Rule 1: already parked
	if (project.portfolioCall === "Defer" || project.currentState === "Parked") {
		return {
			projectId: project.id,
			projectTitle: project.title,
			category: project.category,
			portfolioCall: project.portfolioCall,
			currentState: project.currentState,
			lastActive: project.lastActive,
			disposition: "already_parked",
			reason:
				project.portfolioCall === "Defer"
					? "Portfolio call is Defer"
					: "Current state is Parked",
		};
	}

	// Rule 2: archive candidate
	if (ARCHIVE_CATEGORIES.has(project.category)) {
		const referenceDate = project.lastActive || project.lastBuildSessionDate;
		if (!referenceDate) {
			return {
				projectId: project.id,
				projectTitle: project.title,
				category: project.category,
				portfolioCall: project.portfolioCall,
				currentState: project.currentState,
				lastActive: project.lastActive,
				disposition: "archive_candidate",
				reason: `${project.category} with no recorded activity`,
			};
		}
		const ageDays = diffDays(referenceDate, today);
		if (ageDays > ARCHIVE_INACTIVE_DAYS) {
			return {
				projectId: project.id,
				projectTitle: project.title,
				category: project.category,
				portfolioCall: project.portfolioCall,
				currentState: project.currentState,
				lastActive: project.lastActive,
				disposition: "archive_candidate",
				reason: `${project.category} inactive ${ageDays} days`,
			};
		}
	}

	// Rule 3: viable needs kickoff
	return {
		projectId: project.id,
		projectTitle: project.title,
		category: project.category,
		portfolioCall: project.portfolioCall,
		currentState: project.currentState,
		lastActive: project.lastActive,
		disposition: "viable_needs_kickoff",
		reason: "No linked records",
	};
}

function renderMarkdownTable(
	results: OrphanClassificationResult[],
	today: string,
): string {
	const visible = results.filter((r) => r.disposition !== "already_parked");

	const lines: string[] = [
		`## Orphan Classification — ${today}`,
		"",
		"| Project | Category | Portfolio Call | Last Active | Disposition | Reason |",
		"|---|---|---|---|---|---|",
	];

	for (const r of visible) {
		const lastActive = r.lastActive || "N/A";
		const disposition =
			r.disposition === "archive_candidate"
				? "Archive Candidate"
				: "Viable — Needs Kickoff";
		lines.push(
			`| ${r.projectTitle} | ${r.category} | ${r.portfolioCall} | ${lastActive} | ${disposition} | ${r.reason} |`,
		);
	}

	if (visible.length === 0) {
		lines.push("| — | — | — | — | — | No orphan projects requiring action. |");
	}

	return lines.join("\n");
}

export async function runOrphanClassificationCommand(
	options: OrphanClassificationCommandOptions = {},
): Promise<void> {
	const runtimeConfig = loadRuntimeConfig();
	const logger = RunLogger.fromRuntimeConfig(runtimeConfig);
	await logger.init();

	const token = runtimeConfig.notion.token;
	if (!token) {
		throw new Error("NOTION_TOKEN is required for orphan classification");
	}

	const live = options.live ?? false;
	const createPackets = options.createPackets ?? false;
	const today = options.today ?? losAngelesToday();

	const [config, registry] = await Promise.all([
		loadLocalPortfolioControlTowerConfig(
			options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
		),
		DestinationRegistry.load(runtimeConfig.paths.destinationsPath),
	]);

	const api = new DirectNotionClient(token, logger);
	const publisher = new Publisher(api, logger);

	const schema = await api.retrieveDataSource(config.database.dataSourceId);
	const projectPages = await fetchAllPages(
		api,
		config.database.dataSourceId,
		schema.titlePropertyName,
	);

	const projects = projectPages.map((page) =>
		applyDerivedSignals(toControlTowerProjectRecord(page), config, today),
	);

	const orphans = projects.filter(isOrphan);
	const results = orphans.map((p) => classifyOrphan(p, today));

	const alreadyParked = results.filter(
		(r) => r.disposition === "already_parked",
	).length;
	const archiveCandidates = results.filter(
		(r) => r.disposition === "archive_candidate",
	);
	const viableNeedsKickoff = results.filter(
		(r) => r.disposition === "viable_needs_kickoff",
	);

	const markdown = renderMarkdownTable(results, today);

	let packetsCreated = 0;

	if (live) {
		const title = `Orphan Classification — ${today}`;
		const fullMarkdown = `---\ntitle: ${title}\n---\n\n${markdown}`;
		const tempDir = await mkdtemp(
			path.join(os.tmpdir(), "orphan-classification-"),
		);
		const filePath = path.join(tempDir, "orphan-classification.md");
		await writeFile(filePath, fullMarkdown, "utf8");

		try {
			const destination = registry.getDestination(
				config.destinations.buildLogAlias,
			);
			await publisher.publish(destination, {
				destinationAlias: destination.alias,
				inputFile: filePath,
				dryRun: false,
				live: true,
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}

		if (createPackets && viableNeedsKickoff.length > 0) {
			const packetsDestination = registry.getDestination("work_packets");
			const packetsTempDir = await mkdtemp(
				path.join(os.tmpdir(), "orphan-packets-"),
			);
			try {
				for (const result of viableNeedsKickoff) {
					const packetTitle = `Kickoff: ${result.projectTitle}`;
					const packetBody =
						`# Kickoff: ${result.projectTitle}\n\n` +
						`Created by orphan-classify on ${today}. This project has no linked build sessions, research, skills, or tools. ` +
						`First step: add a build log entry or decide to defer/archive.\n`;
					const packetFullMarkdown = `---\ntitle: ${packetTitle}\n---\n\n${packetBody}`;
					const packetFilePath = path.join(
						packetsTempDir,
						`packet-${result.projectId}.md`,
					);
					await writeFile(packetFilePath, packetFullMarkdown, "utf8");
					await publisher.publish(packetsDestination, {
						destinationAlias: packetsDestination.alias,
						inputFile: packetFilePath,
						dryRun: false,
						live: true,
					});
					packetsCreated += 1;
				}
			} finally {
				await rm(packetsTempDir, { recursive: true, force: true });
			}
		}
	}

	const summary = {
		ok: true,
		live,
		today,
		totalProjects: projects.length,
		orphanCount: orphans.length,
		alreadyParked,
		archiveCandidates: archiveCandidates.length,
		viableNeedsKickoff: viableNeedsKickoff.length,
		packetsCreated,
	};

	console.log(JSON.stringify(summary, null, 2));
	console.log("\n" + markdown);
}
