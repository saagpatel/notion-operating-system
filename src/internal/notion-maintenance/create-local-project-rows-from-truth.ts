import "../../config/load-default-env.js";

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../../cli/context.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
	datePropertyValue,
	fetchAllPages,
	richTextValue,
	selectPropertyValue,
	titleValue,
} from "../../notion/local-portfolio-control-tower-live.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";
import { losAngelesToday } from "../../utils/date.js";
import { AppError } from "../../utils/errors.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

const PROJECTS_ROOT =
	process.env["PROJECTS_ROOT"] ?? join(homedir(), "Projects");
const DEFAULT_TRUTH_PATH =
	process.env["PORTFOLIO_TRUTH_PATH"] ??
	join(
		PROJECTS_ROOT,
		"GithubRepoAuditor",
		"output",
		"portfolio-truth-latest.json",
	);

interface Flags {
	live: boolean;
	today: string;
	config: string;
	truthPath: string;
	projectTitles: string[];
}

interface TruthProject {
	identity?: {
		display_name?: string;
		path?: string;
		repo_full_name?: string;
	};
	declared?: {
		purpose?: string;
		criticality?: string;
		notes?: string;
	};
	derived?: {
		attention_state?: string;
		last_meaningful_activity_at?: string;
	};
}

function parseFlags(argv: string[]): Flags {
	const flags: Flags = {
		live: false,
		today: losAngelesToday(),
		config: DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
		truthPath: DEFAULT_TRUTH_PATH,
		projectTitles: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === "--live") {
			flags.live = true;
			continue;
		}
		if (current === "--today") {
			flags.today = requireValue(argv, index, current);
			index += 1;
			continue;
		}
		if (current === "--config") {
			flags.config = requireValue(argv, index, current);
			index += 1;
			continue;
		}
		if (current === "--truth-path") {
			flags.truthPath = requireValue(argv, index, current);
			index += 1;
			continue;
		}
		if (current === "--project-title") {
			flags.projectTitles.push(requireValue(argv, index, current));
			index += 1;
			continue;
		}
		throw new AppError(`Unknown flag "${current}"`);
	}

	if (flags.projectTitles.length === 0) {
		throw new AppError("Provide at least one --project-title value.");
	}
	return flags;
}

function requireValue(argv: string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new AppError(`Expected a value after ${flag}`);
	}
	return value;
}

function loadTruthProjects(path: string): Map<string, TruthProject> {
	const payload = JSON.parse(readFileSync(path, "utf8")) as {
		projects?: TruthProject[];
	};
	const byTitle = new Map<string, TruthProject>();
	for (const project of payload.projects ?? []) {
		const title = project.identity?.display_name?.trim();
		if (title) {
			byTitle.set(title, project);
		}
	}
	return byTitle;
}

function dateOnly(value: string | undefined, fallback: string): string {
	return value ? value.slice(0, 10) : fallback;
}

function collapseWhitespace(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function localPath(project: TruthProject): string {
	const relPath = project.identity?.path?.trim();
	return relPath ? join(PROJECTS_ROOT, relPath) : PROJECTS_ROOT;
}

function buildMarkdown(project: TruthProject, today: string): string {
	const repo = project.identity?.repo_full_name?.trim() || "none";
	const purpose = collapseWhitespace(project.declared?.purpose);
	const note = collapseWhitespace(project.declared?.notes) || purpose;
	const attention = project.derived?.attention_state ?? "active-infra";
	const criticality = project.declared?.criticality ?? "high";
	return [
		`Created from GithubRepoAuditor portfolio truth on ${today} to close Local Portfolio projection drift.`,
		"",
		`- Repo: ${repo}`,
		`- Local path: ${localPath(project)}`,
		`- Attention state: ${attention}`,
		`- Criticality: ${criticality}`,
		"",
		note,
	].join("\n");
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (shouldShowHelp(argv)) {
		console.log(
			renderInternalScriptHelp({
				description:
					"Create approved Local Portfolio Project rows from GithubRepoAuditor truth.",
				command:
					"npm run portfolio-audit:create-local-project-rows-from-truth -- --project-title <title> [--project-title <title> ...] [--live]",
				options: [
					{ flag: "--live", description: "Create missing rows in Notion." },
					{
						flag: "--today <date>",
						description: "Override the YYYY-MM-DD date anchor.",
					},
					{
						flag: "--config <path>",
						description: "Path to the control-tower config file.",
					},
					{
						flag: "--truth-path <path>",
						description: "Path to portfolio-truth-latest.json.",
					},
					{
						flag: "--project-title <title>",
						description: "Repeatable exact truth display name to create.",
					},
				],
			}),
		);
		return;
	}

	const flags = parseFlags(argv);
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for Local Portfolio row creation",
	);
	const config = await loadLocalPortfolioControlTowerConfig(flags.config);
	const sdk = createNotionSdkClient(token);
	const truthProjects = loadTruthProjects(flags.truthPath);
	const existingPages = await fetchAllPages(
		sdk,
		config.database.dataSourceId,
		"Name",
	);
	const existingTitles = new Map(
		existingPages.map((page) => [page.title, page]),
	);

	const plans = flags.projectTitles.map((title) => {
		const project = truthProjects.get(title);
		if (!project) {
			throw new AppError(`Project title not found in truth snapshot: ${title}`);
		}
		const existing = existingTitles.get(title);
		return {
			title,
			action: existing
				? "skip-existing"
				: flags.live
					? "create"
					: "would-create",
			existingId: existing?.id ?? null,
			existingUrl: existing?.url ?? null,
			project,
		};
	});

	const created: Array<{ title: string; id: string; url: string }> = [];
	if (flags.live) {
		for (const plan of plans) {
			if (plan.existingId) {
				continue;
			}
			const project = plan.project;
			const purpose = collapseWhitespace(project.declared?.purpose);
			const createdPage = (await sdk.request({
				path: "pages",
				method: "post",
				body: {
					parent: { data_source_id: config.database.dataSourceId },
					properties: {
						Name: titleValue(plan.title),
						"Current State": selectPropertyValue("Active Build"),
						"Portfolio Call": selectPropertyValue("Build Now"),
						"One-Line Pitch": richTextValue(purpose),
						"Value / Outcome": richTextValue(purpose),
						"Next Move": richTextValue(
							"Confirm the Local Portfolio coverage row, then link supporting evidence and external signals in the normal portfolio maintenance lane.",
						),
						"Biggest Blocker": richTextValue(
							"New row created from GithubRepoAuditor truth to close Notion projection drift; support links and derived fields still need normal sync coverage.",
						),
						"Start Here": richTextValue(localPath(project)),
						"Local Path": richTextValue(localPath(project)),
						"Last Active": datePropertyValue(
							dateOnly(
								project.derived?.last_meaningful_activity_at,
								flags.today,
							),
						),
					},
					children: markdownToBlocks(buildMarkdown(project, flags.today)),
				},
			})) as { id: string; url: string };
			created.push({
				title: plan.title,
				id: createdPage.id,
				url: createdPage.url,
			});
		}
	}

	const output = {
		ok: true,
		live: flags.live,
		today: flags.today,
		dataSourceId: config.database.dataSourceId,
		plans: plans.map(({ project: _project, ...plan }) => plan),
		created,
	};
	recordCommandOutputSummary(output);
	console.log(JSON.stringify(output, null, 2));
}

function markdownToBlocks(markdown: string): Array<Record<string, unknown>> {
	return markdown
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const content = line.length > 1900 ? `${line.slice(0, 1897)}...` : line;
			if (line.startsWith("- ")) {
				return {
					object: "block",
					type: "bulleted_list_item",
					bulleted_list_item: {
						rich_text: [{ type: "text", text: { content: content.slice(2) } }],
					},
				};
			}
			return {
				object: "block",
				type: "paragraph",
				paragraph: { rich_text: [{ type: "text", text: { content } }] },
			};
		});
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
