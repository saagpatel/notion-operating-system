import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { losAngelesToday } from "../utils/date.js";
import { postNotificationHubEvent } from "../utils/notification-hub.js";
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

const SNAPSHOT_PATH = path.join(
	os.homedir(),
	".local",
	"share",
	"notion-os",
	"project-snapshot.json",
);

export interface ProjectSnapshot {
	schema_version: "1.0.0";
	generated_at: string;
	project_count: number;
	projects: ProjectSnapshotEntry[];
}

export interface ProjectSnapshotEntry {
	title: string;
	current_state: string;
	portfolio_call: string;
	category: string;
	operating_queue: string | null;
	next_review_date: string | null;
	evidence_freshness: string | null;
	overdue: boolean;
	needs_review: boolean;
	last_active: string;
	build_session_count: number;
	ship_readiness: string;
	biggest_blocker: string;
}

function toSnapshotEntry(
	project: ControlTowerProjectRecord,
	today: string,
): ProjectSnapshotEntry {
	const overdue =
		project.nextReviewDate != null && project.nextReviewDate < today;

	return {
		title: project.title,
		current_state: project.currentState,
		portfolio_call: project.portfolioCall,
		category: project.category,
		operating_queue: project.operatingQueue ?? null,
		next_review_date: project.nextReviewDate ?? null,
		evidence_freshness: project.evidenceFreshness ?? null,
		overdue,
		needs_review: project.needsReview,
		last_active: project.lastActive,
		build_session_count: project.buildSessionCount,
		ship_readiness: project.shipReadiness,
		biggest_blocker: project.biggestBlocker,
	};
}

export async function runExportProjectSnapshotCommand(options: {
	config?: string;
	today?: string;
}): Promise<void> {
	const runtimeConfig = loadRuntimeConfig();
	const logger = RunLogger.fromRuntimeConfig(runtimeConfig);
	await logger.init();

	const token = runtimeConfig.notion.token;
	if (!token) {
		throw new Error("NOTION_TOKEN is required for export-project-snapshot");
	}

	const today = options.today ?? losAngelesToday();
	const config = await loadLocalPortfolioControlTowerConfig(
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);

	const api = new DirectNotionClient(token, logger);
	const schema = await api.retrieveDataSource(config.database.dataSourceId);

	const projectPages = await fetchAllPages(
		api,
		config.database.dataSourceId,
		schema.titlePropertyName,
	);

	const projects = projectPages.map((page) =>
		toControlTowerProjectRecord(page),
	);
	const derivedProjects = projects.map((project) =>
		applyDerivedSignals(project, config, today),
	);

	const snapshot: ProjectSnapshot = {
		schema_version: "1.0.0",
		generated_at: new Date().toISOString(),
		project_count: derivedProjects.length,
		projects: derivedProjects.map((p) => toSnapshotEntry(p, today)),
	};

	await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
	await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");

	console.log(
		`Wrote snapshot: ${derivedProjects.length} projects → ${SNAPSHOT_PATH}`,
	);

	const overdueCount = snapshot.projects.filter((p) => p.overdue).length;
	const needsReviewCount = snapshot.projects.filter(
		(p) => p.needs_review,
	).length;

	const output = {
		ok: true,
		snapshotPath: SNAPSHOT_PATH,
		projectCount: derivedProjects.length,
		overdueCount,
		needsReviewCount,
	};

	recordCommandOutputSummary(output, { status: "completed" });

	postNotificationHubEvent({
		source: "notion-os",
		level: "info",
		title: "export-project-snapshot complete",
		body: `${derivedProjects.length} projects written to snapshot (${overdueCount} overdue, ${needsReviewCount} need review)`,
	});

	console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["control-tower", "export-project-snapshot"]);
}
