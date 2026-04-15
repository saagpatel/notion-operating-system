import { Client } from "@notionhq/client";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import {
	type ExternalSignalEventRecord,
	type ExternalSignalSeverity,
	requirePhase5ExternalSignals,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";
import { toIntelligenceProjectRecord } from "./local-portfolio-intelligence-live.js";
import { syncManagedMarkdownSection } from "./managed-markdown-sync.js";

export const MORNING_BRIEF_START = "<!-- codex:notion-morning-brief:start -->";
export const MORNING_BRIEF_END = "<!-- codex:notion-morning-brief:end -->";

const COVERAGE_GAP_DAYS = 7;
const INACTIVE_STATES: ReadonlySet<string> = new Set([
	"Cold Storage",
	"Parked",
]);
const SEVERITY_ORDER: ExternalSignalSeverity[] = ["Risk", "Watch", "Info"];
const MAX_LINES_PER_GROUP = 10;

export interface MorningBriefCommandOptions {
	live?: boolean;
	today?: string;
	config?: string;
	lookbackDays?: number;
	synthesize?: boolean;
}

export interface MorningBriefCommandOutput {
	ok: boolean;
	live: boolean;
	today: string;
	lookbackDays: number;
	totalEvents: number;
	riskCount: number;
	watchCount: number;
	infoCount: number;
	coverageGaps: number;
	weeklyPageFound: boolean;
	section: string;
	synthesized: boolean;
	synthesisCount: number;
	synthesisErrors: number;
}

export interface SynthesisResult {
	projectName: string;
	synthesis: string | undefined;
	error?: string;
}

/** Returns number of whole days between two YYYY-MM-DD strings (non-negative). */
function diffDays(eventDate: string, referenceDate: string): number {
	return Math.round(
		(Date.parse(`${referenceDate}T00:00:00Z`) -
			Date.parse(`${eventDate}T00:00:00Z`)) /
			86_400_000,
	);
}

/** Build a project-id → title lookup from any array of records with id+title. */
function buildProjectTitleIndex(
	projects: ReadonlyArray<{ id: string; title: string }>,
): Map<string, string> {
	return new Map(projects.map((p) => [p.id, p.title]));
}

/**
 * Call the Claude API to synthesize why risk signals matter and what to do next.
 * Returns the synthesis string or undefined on failure, plus any error message.
 * Exported for unit-testing convenience.
 */
export async function synthesizeRiskProject(
	projectName: string,
	signalSummary: string,
	apiKey: string,
): Promise<SynthesisResult> {
	try {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "claude-haiku-4-5-20251001",
				max_tokens: 150,
				messages: [
					{
						role: "user",
						content: `Project: ${projectName}\nSignals: ${signalSummary}\n\nIn 2 sentences: why does this signal matter and what is the immediate next action? Be specific, be brief.`,
					},
				],
			}),
		});

		if (!response.ok) {
			const body = await response.text();
			return {
				projectName,
				synthesis: undefined,
				error: `API error ${response.status}: ${body.slice(0, 200)}`,
			};
		}

		const data = (await response.json()) as unknown;
		const synthesis = extractSynthesisText(data);
		if (synthesis === undefined) {
			return {
				projectName,
				synthesis: undefined,
				error: "Unexpected API response shape",
			};
		}

		return { projectName, synthesis };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { projectName, synthesis: undefined, error: message };
	}
}

function extractSynthesisText(data: unknown): string | undefined {
	if (
		typeof data !== "object" ||
		data === null ||
		!("content" in data) ||
		!Array.isArray((data as Record<string, unknown>)["content"])
	) {
		return undefined;
	}
	const content = (data as { content: unknown[] }).content;
	for (const block of content) {
		if (
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			(block as Record<string, unknown>)["type"] === "text" &&
			"text" in block &&
			typeof (block as Record<string, unknown>)["text"] === "string"
		) {
			return (block as { type: string; text: string }).text;
		}
	}
	return undefined;
}

/**
 * Render the morning brief section markdown.
 * Exported for unit-testing convenience.
 */
export function renderMorningBriefSection(
	input: {
		events: ExternalSignalEventRecord[];
		projectIndex: Map<string, string>;
		today: string;
		lookbackDays: number;
		/** All active projects (not Cold Storage / Parked) for coverage-gap detection */
		activeProjectIds: ReadonlySet<string>;
		/** Projects that had at least one event in the last COVERAGE_GAP_DAYS */
		coveredProjectIds: ReadonlySet<string>;
	},
	synthesisMap: Map<string, string> = new Map(),
): string {
	const { events, projectIndex, today, activeProjectIds, coveredProjectIds } =
		input;

	const byGroup = groupBySeverity(events);

	const lines: string[] = [`## Morning Brief — ${today}`, ""];

	for (const severity of SEVERITY_ORDER) {
		const group = byGroup[severity];
		if (severity === "Info") {
			if (group.length === 0) {
				lines.push(
					"### Info",
					"",
					"- No info events in the lookback window.",
					"",
				);
			} else {
				const projectCount = new Set(group.flatMap((e) => e.localProjectIds))
					.size;
				lines.push(
					"### Info",
					"",
					`- ${group.length} info event${group.length === 1 ? "" : "s"} across ${projectCount} project${projectCount === 1 ? "" : "s"}.`,
					"",
				);
			}
		} else {
			const label = `${severity} (${group.length})`;
			lines.push(`### ${label}`, "");
			if (group.length === 0) {
				lines.push(
					`- No ${severity.toLowerCase()} events in the lookback window.`,
				);
			} else {
				const capped = group.slice(0, MAX_LINES_PER_GROUP);
				for (const event of capped) {
					const projectId = event.localProjectIds[0] ?? "";
					const projectName = projectIndex.get(projectId) ?? "unknown";
					const providerType = `${event.provider} / ${event.signalType}`;
					const link = event.url || event.sourceUrl;
					const linkPart = link ? ` — [view](${link})` : "";
					lines.push(
						`- **${projectName}** — ${event.title} (${providerType})${linkPart}`,
					);

					// Append synthesis blockquote for Risk events if available
					if (severity === "Risk" && synthesisMap.size > 0) {
						const synthesis =
							synthesisMap.get(projectId) ?? synthesisMap.get(projectName);
						if (synthesis) {
							lines.push(`  > _Synthesis: ${synthesis}_`);
						}
					}
				}
				if (group.length > MAX_LINES_PER_GROUP) {
					lines.push(`- …and ${group.length - MAX_LINES_PER_GROUP} more`);
				}
			}
			lines.push("");
		}
	}

	// Coverage gaps
	const gapProjectIds = [...activeProjectIds].filter(
		(id) => !coveredProjectIds.has(id),
	);
	lines.push("### Coverage Gaps", "");
	if (gapProjectIds.length === 0) {
		lines.push(
			`- All active projects have signal activity in the last ${COVERAGE_GAP_DAYS} days.`,
		);
	} else {
		const names = gapProjectIds
			.map((id) => projectIndex.get(id) ?? id)
			.sort((a, b) => a.localeCompare(b));
		lines.push(
			`- ${names.join(", ")} — no events in ${COVERAGE_GAP_DAYS} days`,
		);
	}
	lines.push("");

	return lines.join("\n");
}

function groupBySeverity(
	events: ExternalSignalEventRecord[],
): Record<ExternalSignalSeverity, ExternalSignalEventRecord[]> {
	const result: Record<ExternalSignalSeverity, ExternalSignalEventRecord[]> = {
		Risk: [],
		Watch: [],
		Info: [],
	};
	for (const event of events) {
		result[event.severity].push(event);
	}
	return result;
}

/**
 * Collect the top-5 unique projects from Risk events and run synthesis for each.
 * Returns the synthesis map (keyed by project ID and project name) and error counts.
 */
async function runSynthesisForRiskEvents(
	riskEvents: ExternalSignalEventRecord[],
	projectIndex: Map<string, string>,
	apiKey: string,
): Promise<{ synthesisMap: Map<string, string>; errors: number }> {
	const synthesisMap = new Map<string, string>();
	let errors = 0;

	// Collect up to 5 unique project IDs from the top MAX_LINES_PER_GROUP risk events
	const capped = riskEvents.slice(0, MAX_LINES_PER_GROUP);
	const seenProjectIds = new Set<string>();
	const projectsToSynthesize: Array<{
		id: string;
		name: string;
		signals: string[];
	}> = [];

	for (const event of capped) {
		const projectId = event.localProjectIds[0] ?? "";
		if (!projectId || seenProjectIds.has(projectId)) continue;
		seenProjectIds.add(projectId);

		const projectName = projectIndex.get(projectId) ?? "unknown";
		projectsToSynthesize.push({
			id: projectId,
			name: projectName,
			signals: [],
		});

		if (projectsToSynthesize.length >= 5) break;
	}

	// Aggregate signals per project
	for (const proj of projectsToSynthesize) {
		const signals = riskEvents
			.filter((e) => e.localProjectIds.includes(proj.id))
			.map((e) => {
				const parts = [`${e.title} (${e.provider}/${e.signalType})`];
				if (e.url || e.sourceUrl) parts.push(`url: ${e.url || e.sourceUrl}`);
				return parts.join(", ");
			})
			.slice(0, 5); // cap per project to avoid oversized prompt
		proj.signals = signals;
	}

	// Fire synthesis calls (sequential to avoid rate limits)
	for (const proj of projectsToSynthesize) {
		const signalSummary = proj.signals.join("; ");
		const result = await synthesizeRiskProject(
			proj.name,
			signalSummary,
			apiKey,
		);
		if (result.synthesis !== undefined) {
			synthesisMap.set(proj.id, result.synthesis);
			synthesisMap.set(proj.name, result.synthesis);
		} else {
			errors++;
			console.error(
				`[morning-brief] synthesis failed for "${proj.name}": ${result.error ?? "unknown error"}`,
			);
		}
	}

	return { synthesisMap, errors };
}

export async function runMorningBriefCommand(
	options: MorningBriefCommandOptions = {},
): Promise<void> {
	const token = resolveRequiredNotionToken(
		"NOTION_TOKEN is required for morning-brief",
	);
	const live = options.live ?? false;
	const today = options.today ?? losAngelesToday();
	const weekStart = startOfWeekMonday(today);
	const lookbackDays = options.lookbackDays ?? 1;
	const configPath =
		options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
	const synthesize = options.synthesize ?? false;

	const config = await loadLocalPortfolioControlTowerConfig(configPath);
	const phase5 = requirePhase5ExternalSignals(config);

	const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
	const api = new DirectNotionClient(token);

	// Load only what we need: projects, weekly reviews, events
	const [projectSchema, weeklySchema, eventSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
		api.retrieveDataSource(phase5.events.dataSourceId),
	]);

	const [projectPages, weeklyPages, eventPages] = await Promise.all([
		fetchAllPages(
			sdk,
			config.database.dataSourceId,
			projectSchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			config.relatedDataSources.weeklyReviewsId,
			weeklySchema.titlePropertyName,
		),
		fetchAllPages(
			sdk,
			phase5.events.dataSourceId,
			eventSchema.titlePropertyName,
		),
	]);

	const projects = projectPages.map((page) =>
		toIntelligenceProjectRecord(page),
	);
	const allEvents = eventPages.map((page) => toExternalSignalEventRecord(page));

	// Filter to lookback window
	const recentEvents = allEvents.filter(
		(event) => diffDays(event.occurredAt, today) <= lookbackDays,
	);

	// Build project title index
	const projectIndex = buildProjectTitleIndex(projects);

	// Derive active project ids (not Cold Storage / Parked)
	const activeProjectIds = new Set(
		projects
			.filter((p) => !INACTIVE_STATES.has(p.currentState))
			.map((p) => p.id),
	);

	// Projects with any event in the last COVERAGE_GAP_DAYS
	const coveredProjectIds = new Set(
		allEvents
			.filter((e) => diffDays(e.occurredAt, today) <= COVERAGE_GAP_DAYS)
			.flatMap((e) => e.localProjectIds),
	);

	const grouped = groupBySeverity(recentEvents);

	// Run synthesis if requested
	let synthesisMap = new Map<string, string>();
	let synthesized = false;
	let synthesisCount = 0;
	let synthesisErrors = 0;

	if (synthesize) {
		const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
		if (!apiKey) {
			console.error(
				"[morning-brief] synthesize=true requested but ANTHROPIC_API_KEY is not set — skipping synthesis",
			);
		} else if (grouped.Risk.length > 0) {
			synthesized = true;
			const result = await runSynthesisForRiskEvents(
				grouped.Risk,
				projectIndex,
				apiKey,
			);
			synthesisMap = result.synthesisMap;
			// Count unique project IDs that have a synthesis (divide by 2 since we store id+name)
			synthesisCount = Math.round(synthesisMap.size / 2);
			synthesisErrors = result.errors;
		}
	}

	const section = renderMorningBriefSection(
		{
			events: recentEvents,
			projectIndex,
			today,
			lookbackDays,
			activeProjectIds,
			coveredProjectIds,
		},
		synthesisMap,
	);

	// Find current weekly review page
	const weeklyPage = weeklyPages.find(
		(page) => page.title === `Week of ${weekStart}`,
	);

	const output: MorningBriefCommandOutput = {
		ok: true,
		live,
		today,
		lookbackDays,
		totalEvents: recentEvents.length,
		riskCount: grouped.Risk.length,
		watchCount: grouped.Watch.length,
		infoCount: grouped.Info.length,
		coverageGaps: [...activeProjectIds].filter(
			(id) => !coveredProjectIds.has(id),
		).length,
		weeklyPageFound: Boolean(weeklyPage),
		section,
		synthesized,
		synthesisCount,
		synthesisErrors,
	};

	if (live && weeklyPage) {
		const previousPage = await api.readPageMarkdown(weeklyPage.id);
		const nextMarkdown = previousPage.markdown.includes(MORNING_BRIEF_START)
			? mergeManagedSectionInto(previousPage.markdown, section)
			: `${previousPage.markdown}\n\n${MORNING_BRIEF_START}\n${section}\n${MORNING_BRIEF_END}`;

		await syncManagedMarkdownSection({
			api,
			pageId: weeklyPage.id,
			previousMarkdown: previousPage.markdown,
			nextMarkdown,
			startMarker: MORNING_BRIEF_START,
			endMarker: MORNING_BRIEF_END,
		});
	}

	console.log(JSON.stringify(output, null, 2));
}

/**
 * Splice a new section body between the managed markers in an existing markdown string.
 * Returns a new string with the section replaced.
 */
function mergeManagedSectionInto(
	markdown: string,
	nextSectionBody: string,
): string {
	const startIdx = markdown.indexOf(MORNING_BRIEF_START);
	const endIdx = markdown.indexOf(MORNING_BRIEF_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return `${markdown}\n\n${MORNING_BRIEF_START}\n${nextSectionBody}\n${MORNING_BRIEF_END}`;
	}
	const before = markdown.slice(0, startIdx);
	const after = markdown.slice(endIdx + MORNING_BRIEF_END.length);
	return `${before}${MORNING_BRIEF_START}\n${nextSectionBody}\n${MORNING_BRIEF_END}${after}`;
}
