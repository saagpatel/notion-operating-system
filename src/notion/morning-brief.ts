import { createNotionSdkClient } from "./notion-sdk.js";

import { resolveRequiredNotionToken } from "../cli/context.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { fetchAllPages } from "./local-portfolio-control-tower-live.js";
import {
	isExecutionTaskClosed,
	isWorkPacketClosed,
	type ExecutionTaskRecord,
	type WorkPacketRecord,
} from "./local-portfolio-execution.js";
import {
	toExecutionTaskRecord,
	toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
	type ExternalSignalEventRecord,
	type ExternalSignalSeverity,
	requirePhase5ExternalSignals,
} from "./local-portfolio-external-signals.js";
import { toExternalSignalEventRecord } from "./local-portfolio-external-signals-live.js";
import { toIntelligenceProjectRecord } from "./local-portfolio-intelligence-live.js";
import { syncManagedMarkdownSectionWithReadBack } from "./managed-markdown-sync.js";

export const MORNING_BRIEF_START = "<!-- codex:notion-morning-brief:start -->";
export const MORNING_BRIEF_END = "<!-- codex:notion-morning-brief:end -->";

const COVERAGE_GAP_DAYS = 7;
const INACTIVE_STATES: ReadonlySet<string> = new Set([
	"Cold Storage",
	"Parked",
]);
const SEVERITY_ORDER: ExternalSignalSeverity[] = ["Risk", "Watch", "Info"];
const MAX_LINES_PER_GROUP = 10;
const MAX_PRIORITY_PROJECTS = 5;
const SEVERITY_WEIGHTS: Record<ExternalSignalSeverity, number> = {
	Risk: 15,
	Watch: 8,
	Info: 2,
};

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

export interface MorningBriefPacketFocus {
	title: string;
	status: string;
	projectName: string;
	goal: string;
	whyNow: string;
	targetStart: string;
	targetFinish: string;
	nextTask: string;
}

export interface MorningBriefOperatorFocus {
	nowPacket?: MorningBriefPacketFocus;
	standbyPacket?: MorningBriefPacketFocus;
}

export interface MorningBriefPriorityProject {
	projectId: string;
	projectName: string;
	score: number;
	riskEvents: number;
	watchEvents: number;
	infoEvents: number;
	coverageGap: boolean;
	latestSignalDate: string;
	reasons: string[];
	nextAction: string;
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
		operatorFocus?: MorningBriefOperatorFocus;
		priorityProjects?: MorningBriefPriorityProject[];
	},
	synthesisMap: Map<string, string> = new Map(),
): string {
	const {
		events,
		projectIndex,
		today,
		activeProjectIds,
		coveredProjectIds,
		operatorFocus,
		priorityProjects,
	} = input;

	const byGroup = groupBySeverity(events);
	const priority =
		priorityProjects ??
		buildMorningBriefPriorityProjects({
			events,
			projectIndex,
			activeProjectIds,
			coveredProjectIds,
		});

	const lines: string[] = [`## Morning Brief — ${today}`, ""];

	lines.push("### Operator Focus", "");
	if (operatorFocus?.nowPacket) {
		lines.push(...formatFocusPacket("Now", operatorFocus.nowPacket));
	} else {
		lines.push("- **Now** — no active Now packet selected.");
	}
	if (operatorFocus?.standbyPacket) {
		lines.push(...formatFocusPacket("Standby", operatorFocus.standbyPacket));
	} else {
		lines.push("- **Standby** — no Standby packet selected.");
	}
	lines.push("");

	lines.push("### Priority Projects", "");
	if (priority.length === 0) {
		lines.push("- No priority project signals in the lookback window.");
	} else {
		for (const project of priority) {
			const mix = [
				project.riskEvents ? `${project.riskEvents} risk` : "",
				project.watchEvents ? `${project.watchEvents} watch` : "",
				project.infoEvents ? `${project.infoEvents} info` : "",
				project.coverageGap ? "coverage gap" : "",
			]
				.filter(Boolean)
				.join(", ");
			const reasons = project.reasons.slice(0, 2).join("; ");
			lines.push(
				`- ${project.projectName} — score ${project.score}; ${mix || "no recent signals"}. ${reasons}. Next: ${project.nextAction}`,
			);
		}
	}
	lines.push("");

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

export function buildMorningBriefPriorityProjects(input: {
	events: ExternalSignalEventRecord[];
	projectIndex: Map<string, string>;
	activeProjectIds: ReadonlySet<string>;
	coveredProjectIds: ReadonlySet<string>;
}): MorningBriefPriorityProject[] {
	type Draft = MorningBriefPriorityProject & {
		reasonSet: Set<string>;
	};
	const drafts = new Map<string, Draft>();

	function ensureDraft(projectId: string): Draft {
		const existing = drafts.get(projectId);
		if (existing) return existing;
		const draft: Draft = {
			projectId,
			projectName: input.projectIndex.get(projectId) ?? projectId,
			score: 0,
			riskEvents: 0,
			watchEvents: 0,
			infoEvents: 0,
			coverageGap: false,
			latestSignalDate: "",
			reasons: [],
			reasonSet: new Set<string>(),
			nextAction: "Review the project and update the next concrete move.",
		};
		drafts.set(projectId, draft);
		return draft;
	}

	for (const event of input.events) {
		for (const projectId of event.localProjectIds) {
			if (!projectId) continue;
			const draft = ensureDraft(projectId);
			draft.score += SEVERITY_WEIGHTS[event.severity];
			if (event.status.toLowerCase().includes("fail")) {
				draft.score += 5;
				draft.reasonSet.add("failed external status");
			}
			if (event.severity === "Risk") {
				draft.riskEvents += 1;
				draft.reasonSet.add("risk signal present");
			} else if (event.severity === "Watch") {
				draft.watchEvents += 1;
				draft.reasonSet.add("watch signal present");
			} else {
				draft.infoEvents += 1;
				draft.reasonSet.add("recent info signal");
			}
			if (
				!draft.latestSignalDate ||
				event.occurredAt.localeCompare(draft.latestSignalDate) > 0
			) {
				draft.latestSignalDate = event.occurredAt;
			}
		}
	}

	for (const projectId of input.activeProjectIds) {
		if (input.coveredProjectIds.has(projectId)) continue;
		const draft = drafts.get(projectId);
		if (!draft) continue;
		draft.coverageGap = true;
		draft.score += 4;
		draft.reasonSet.add(`no signal coverage in ${COVERAGE_GAP_DAYS} days`);
	}

	for (const draft of drafts.values()) {
		draft.reasons = [...draft.reasonSet];
		if (draft.riskEvents > 0) {
			draft.nextAction =
				"Investigate the top risk signal and decide whether it needs a repair packet.";
		} else if (draft.watchEvents > 0) {
			draft.nextAction =
				"Review the watch signal and update the project next move if priority changed.";
		} else if (draft.coverageGap) {
			draft.nextAction =
				"Add fresh evidence or explicitly park/defer the project.";
		}
	}

	return [...drafts.values()]
		.filter((draft) => draft.score > 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			const dateCompare = b.latestSignalDate.localeCompare(a.latestSignalDate);
			if (dateCompare !== 0) return dateCompare;
			return a.projectName.localeCompare(b.projectName);
		})
		.slice(0, MAX_PRIORITY_PROJECTS)
		.map((draft) => ({
			projectId: draft.projectId,
			projectName: draft.projectName,
			score: draft.score,
			riskEvents: draft.riskEvents,
			watchEvents: draft.watchEvents,
			infoEvents: draft.infoEvents,
			coverageGap: draft.coverageGap,
			latestSignalDate: draft.latestSignalDate,
			reasons: draft.reasons,
			nextAction: draft.nextAction,
		}));
}

function formatFocusPacket(
	label: "Now" | "Standby",
	packet: MorningBriefPacketFocus,
): string[] {
	const details = [
		packet.projectName,
		packet.status ? `status ${packet.status}` : "",
		packet.targetFinish
			? `target finish ${packet.targetFinish}`
			: packet.targetStart
				? `target start ${packet.targetStart}`
				: "",
	]
		.filter(Boolean)
		.join("; ");
	const action = packet.nextTask || packet.goal || packet.whyNow || "Define the next concrete action.";
	return [`- **${label}** — ${packet.title}${details ? ` (${details})` : ""}. Next: ${action}`];
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

	const sdk = createNotionSdkClient(token);
	const api = new DirectNotionClient(token);

	// Load only what we need: projects, weekly reviews, events
	const [projectSchema, weeklySchema, eventSchema] = await Promise.all([
		api.retrieveDataSource(config.database.dataSourceId),
		api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
		api.retrieveDataSource(phase5.events.dataSourceId),
	]);
	const [packetSchema, taskSchema] = config.phase2Execution
		? await Promise.all([
				api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
				api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
			])
		: [undefined, undefined];

	const [projectPages, weeklyPages, eventPages, packetPages, taskPages] =
		await Promise.all([
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
		config.phase2Execution && packetSchema
			? fetchAllPages(
					sdk,
					config.phase2Execution.packets.dataSourceId,
					packetSchema.titlePropertyName,
				)
			: Promise.resolve([]),
		config.phase2Execution && taskSchema
			? fetchAllPages(
					sdk,
					config.phase2Execution.tasks.dataSourceId,
					taskSchema.titlePropertyName,
				)
			: Promise.resolve([]),
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
	const operatorFocus = buildOperatorFocus({
		packets: packetPages.map((page) => toWorkPacketRecord(page)),
		tasks: taskPages.map((page) => toExecutionTaskRecord(page)),
		projectIndex,
	});

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
			operatorFocus,
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

		await syncManagedMarkdownSectionWithReadBack({
			api,
			pageId: weeklyPage.id,
			previousMarkdown: previousPage.markdown,
			nextMarkdown,
			startMarker: MORNING_BRIEF_START,
			endMarker: MORNING_BRIEF_END,
			maxAttempts: 2,
		});
	}

	console.log(JSON.stringify(output, null, 2));
}

function buildOperatorFocus(input: {
	packets: WorkPacketRecord[];
	tasks: ExecutionTaskRecord[];
	projectIndex: Map<string, string>;
}): MorningBriefOperatorFocus {
	const activePackets = input.packets.filter(
		(packet) => !isWorkPacketClosed(packet.status),
	);
	const nowPacket = activePackets.find((packet) => packet.priority === "Now");
	const standbyPacket = activePackets.find(
		(packet) => packet.priority === "Standby",
	);
	return {
		nowPacket: nowPacket
			? toPacketFocus(nowPacket, input.tasks, input.projectIndex)
			: undefined,
		standbyPacket: standbyPacket
			? toPacketFocus(standbyPacket, input.tasks, input.projectIndex)
			: undefined,
	};
}

function toPacketFocus(
	packet: WorkPacketRecord,
	tasks: ExecutionTaskRecord[],
	projectIndex: Map<string, string>,
): MorningBriefPacketFocus {
	const nextTask =
		tasks
			.filter(
				(task) =>
					task.workPacketIds.includes(packet.id) &&
					!isExecutionTaskClosed(task.status),
			)
			.sort((left, right) =>
				(left.dueDate || "9999-12-31").localeCompare(
					right.dueDate || "9999-12-31",
				),
			)[0]?.title ?? "";
	const projectName =
		packet.localProjectIds.length === 1
			? projectIndex.get(packet.localProjectIds[0] ?? "") ?? "unknown project"
			: `${packet.localProjectIds.length} linked projects`;
	return {
		title: packet.title || "Untitled packet",
		status: packet.status,
		projectName,
		goal: packet.goal,
		whyNow: packet.whyNow,
		targetStart: packet.targetStart,
		targetFinish: packet.targetFinish,
		nextTask,
	};
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
