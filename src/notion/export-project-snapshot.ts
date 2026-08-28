import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
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
	type DataSourcePageRef,
	toControlTowerProjectRecord,
} from "./local-portfolio-control-tower-live.js";
import {
	DEFAULT_PORTFOLIO_GENERATION_ROOT,
	readPortfolioTruth,
} from "../portfolio-generation-reader.js";

const SNAPSHOT_PATH = path.join(
	os.homedir(),
	".local",
	"share",
	"notion-os",
	"project-snapshot.json",
);
const PORTFOLIO_TRUTH_PATH = path.join(
	os.homedir(),
	"Projects",
	"GithubRepoAuditor",
	"output",
	"portfolio-truth-latest.json",
);
const CANONICAL_REPO_PATH = path.join(os.homedir(), "Projects", "Notion");
const DEFAULT_ATTENTION_STATES = new Set([
	"active-product",
	"active-infra",
	"decision-needed",
]);

export interface ProjectSnapshot {
	schema_version: "2.0.0";
	generated_at: string;
	extraction_run_id: string;
	source: {
		workspace: { state: "unavailable"; reason: string };
		data_source_id: string;
		watermark: string | null;
	};
	live_read_receipt: {
		state: "verified";
		observed_at: string;
		page_count: number;
	};
	attention_authority_receipt: {
		source: "GithubRepoAuditor";
		generated_at: string | null;
		content_sha256: string | null;
		state: "verified" | "unavailable";
	};
	content_sha256: string;
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
	source_last_edited_at: string | null;
	attention_authority: {
		source: "GithubRepoAuditor";
		state: string | null;
		default_attention: boolean;
		status: "aligned" | "contradiction" | "authority_unavailable";
		reason: string | null;
	};
}

export interface PortfolioAttentionAuthority {
	generatedAt: string;
	contentSha256: string;
	byTitle: Map<string, string>;
}

function toSnapshotEntry(
	project: ControlTowerProjectRecord,
	today: string,
	sourceLastEditedAt: string | null,
	attentionState: string | null,
): ProjectSnapshotEntry {
	const overdue =
		project.nextReviewDate != null && project.nextReviewDate < today;

	const notionRequestsAttention =
		project.needsReview ||
		(project.operatingQueue !== undefined &&
			project.operatingQueue !== "Cold Storage" &&
			project.operatingQueue !== "Shipped");
	const defaultAttention =
		attentionState !== null && DEFAULT_ATTENTION_STATES.has(attentionState);
	const status =
		attentionState === null
			? "authority_unavailable"
			: notionRequestsAttention !== defaultAttention
				? "contradiction"
				: "aligned";

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
		source_last_edited_at: sourceLastEditedAt,
		attention_authority: {
			source: "GithubRepoAuditor",
			state: attentionState,
			default_attention: defaultAttention,
			status,
			reason:
				status === "contradiction"
					? `Notion advisory attention=${notionRequestsAttention} conflicts with canonical attention=${defaultAttention}`
					: status === "authority_unavailable"
						? "No matching GithubRepoAuditor classification was independently read"
						: null,
		},
	};
}

export function buildProjectSnapshot(input: {
	pages: DataSourcePageRef[];
	dataSourceId: string;
	today: string;
	generatedAt?: string;
	extractionRunId?: string;
	config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
	attentionAuthority?: PortfolioAttentionAuthority;
}): ProjectSnapshot {
	const generatedAt = input.generatedAt ?? new Date().toISOString();
	const projects = input.pages.map((page) =>
		applyDerivedSignals(
			toControlTowerProjectRecord(page),
			input.config,
			input.today,
		),
	);
	const entries = projects.map((project, index) =>
		toSnapshotEntry(
			project,
			input.today,
			input.pages[index]?.lastEditedTime ?? null,
			input.attentionAuthority?.byTitle.get(project.title) ?? null,
		),
	);
	const watermark = input.pages.reduce<string | null>((latest, page) => {
		if (!page.lastEditedTime) return latest;
		return latest === null || page.lastEditedTime > latest
			? page.lastEditedTime
			: latest;
	}, null);
	const contentSha256 = createHash("sha256")
		.update(JSON.stringify(entries))
		.digest("hex");

	return {
		schema_version: "2.0.0",
		generated_at: generatedAt,
		extraction_run_id: input.extractionRunId ?? randomUUID(),
		source: {
			workspace: {
				state: "unavailable",
				reason: "Notion API response does not expose a stable workspace identifier",
			},
			data_source_id: input.dataSourceId,
			watermark,
		},
		live_read_receipt: {
			state: "verified",
			observed_at: generatedAt,
			page_count: input.pages.length,
		},
		attention_authority_receipt: {
			source: "GithubRepoAuditor",
			generated_at: input.attentionAuthority?.generatedAt ?? null,
			content_sha256: input.attentionAuthority?.contentSha256 ?? null,
			state: input.attentionAuthority ? "verified" : "unavailable",
		},
		content_sha256: contentSha256,
		project_count: entries.length,
		projects: entries,
	};
}

export async function loadPortfolioAttentionAuthority(
	truthPath: string = PORTFOLIO_TRUTH_PATH,
	generationRoot: string =
		process.env.PORTFOLIO_GENERATION_ROOT ??
		process.env.PERSONAL_OPS_PORTFOLIO_GENERATION_ROOT ??
		DEFAULT_PORTFOLIO_GENERATION_ROOT,
): Promise<PortfolioAttentionAuthority> {
	const readback = await readPortfolioTruth({
		generationRoot,
		legacyPath: truthPath,
	});
	const raw: unknown = readback.payload;
	if (typeof raw !== "object" || raw === null || !("projects" in raw)) {
		throw new Error("GithubRepoAuditor truth root is invalid");
	}
	const root = raw as { generated_at?: unknown; projects?: unknown };
	if (typeof root.generated_at !== "string" || !Array.isArray(root.projects)) {
		throw new Error("GithubRepoAuditor truth lacks generated_at or projects");
	}
	const byTitle = new Map<string, string>();
	for (const item of root.projects) {
		if (typeof item !== "object" || item === null) continue;
		const project = item as {
			identity?: { display_name?: unknown };
			derived?: { attention_state?: unknown };
		};
		const title = project.identity?.display_name;
		const state = project.derived?.attention_state;
		if (typeof title === "string" && typeof state === "string") {
			byTitle.set(title, state);
		}
	}
	return {
		generatedAt: root.generated_at,
		contentSha256: readback.artifactSha256,
		byTitle,
	};
}

export async function runExportProjectSnapshotCommand(options: {
	config?: string;
	today?: string;
}): Promise<void> {
	const sourceModulePath = fileURLToPath(import.meta.url);
	if (!sourceModulePath.startsWith(`${CANONICAL_REPO_PATH}${path.sep}`)) {
		throw new Error(
			`Refusing snapshot publication from non-canonical Notion checkout: ${sourceModulePath}; expected ${CANONICAL_REPO_PATH}`,
		);
	}
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
	const attentionAuthority = await loadPortfolioAttentionAuthority();

	const snapshot = buildProjectSnapshot({
		pages: projectPages,
		dataSourceId: config.database.dataSourceId,
		today,
		config,
		attentionAuthority,
	});

	await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
	await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");

	console.log(
		`Wrote snapshot: ${snapshot.project_count} projects → ${SNAPSHOT_PATH}`,
	);

	const overdueCount = snapshot.projects.filter((p) => p.overdue).length;
	const needsReviewCount = snapshot.projects.filter(
		(p) => p.needs_review,
	).length;

	const output = {
		ok: true,
		snapshotPath: SNAPSHOT_PATH,
		projectCount: snapshot.project_count,
		overdueCount,
		needsReviewCount,
	};

	recordCommandOutputSummary(output, { status: "completed" });

	console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
	void runLegacyCliPath(["control-tower", "export-project-snapshot"]);
}
