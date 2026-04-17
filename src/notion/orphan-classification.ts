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
	addDays,
	applyDerivedSignals,
	type ControlTowerProjectRecord,
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
	fetchAllPages,
	relationValue,
	richTextValue,
	selectPropertyValue,
	titleValue,
	toControlTowerProjectRecord,
	upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import type { ActionRequestRecord } from "./local-portfolio-governance.js";
import { toActionRequestRecord } from "./local-portfolio-governance-live.js";

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
	requestApproval?: boolean;
	approve?: boolean;
	createApprovedPackets?: boolean;
	today?: string;
	config?: string;
}

export interface OrphanKickoffPacketDraft {
	title: string;
	markdown: string;
	properties: Record<string, unknown>;
}

export interface OrphanKickoffApprovalRequestDraft {
	title: string;
	markdown: string;
	providerRequestKey: string;
	properties: Record<string, unknown>;
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

export function buildKickoffPacketDraft(
	result: OrphanClassificationResult,
	today: string,
	ownerUserId?: string,
): OrphanKickoffPacketDraft {
	const title = `Kickoff: ${result.projectTitle}`;
	const markdown = [
		`# ${title}`,
		"",
		`Created by orphan-classify on ${today}.`,
		"",
		`This project is currently classified as **Viable — Needs Kickoff** because ${result.reason.toLowerCase()}.`,
		"",
		"## Immediate next move",
		"",
		"- Add one build log entry that proves the project can still move.",
		"- If that cannot happen cleanly, decide whether to defer or archive it.",
	].join("\n");

	const properties: Record<string, unknown> = {
		Status: statusValue("Ready"),
		"Execution State": selectPropertyValue("Ready"),
		Priority: selectPropertyValue("Later"),
		"Packet Type": selectPropertyValue("Resume"),
		"Local Project": relationValue([result.projectId]),
		Goal: richTextValue(
			`Create the first concrete operating evidence for ${result.projectTitle}.`,
		),
		"Definition of Done": richTextValue(
			"A build log entry exists or the project is explicitly deferred or archived.",
		),
		"Why Now": richTextValue(
			"This project looks viable, but it still has no linked operating evidence.",
		),
		"Target Start": { date: { start: today } },
		"Target Finish": { date: { start: addDays(today, 2) } },
		"Estimated Size": selectPropertyValue("1 day"),
		"Rollover Count": { number: 0 },
	};

	if (ownerUserId) {
		properties.Owner = peopleValue(ownerUserId);
	}

	return {
		title,
		markdown,
		properties,
	};
}

export function buildKickoffApprovalRequestDraft(
	result: OrphanClassificationResult,
	today: string,
	input: {
		approve?: boolean;
		requestedByUserId?: string;
	},
): OrphanKickoffApprovalRequestDraft {
	const status = input.approve ? "Approved" : "Pending Approval";
	const title = `Approve kickoff packet: ${result.projectTitle}`;
	const providerRequestKey = `orphan-kickoff:${result.projectId}`;
	const packetDraft = buildKickoffPacketDraft(
		result,
		today,
		input.requestedByUserId,
	);
	const markdown = [
		`# ${title}`,
		"",
		`Status: **${status}**`,
		"",
		"## Requested change",
		"",
		`Create the structured work packet **${packetDraft.title}** for ${result.projectTitle}.`,
		"",
		"## Why this exists",
		"",
		`This project was classified as **Viable — Needs Kickoff** because ${result.reason.toLowerCase()}.`,
		"",
		"## Planned packet outcome",
		"",
		"- Status: Ready",
		"- Execution State: Ready",
		"- Priority: Later",
		"- Packet Type: Resume",
		"- Local Project relation: set",
	].join("\n");

	const properties: Record<string, unknown> = {
		Status: selectPropertyValue(status),
		"Source Type": selectPropertyValue("Manual"),
		"Local Project": relationValue([result.projectId]),
		"Requested At": { date: { start: today } },
		"Expires At": { date: { start: addDays(today, 3) } },
		"Planned Payload Summary": richTextValue(
			`Create the structured kickoff packet for ${result.projectTitle} after operator approval.`,
		),
		"Payload Title": richTextValue(packetDraft.title),
		"Payload Body": richTextValue(packetDraft.markdown),
		"Provider Request Key": richTextValue(providerRequestKey),
		"Approval Reason": richTextValue(
			input.approve
				? "Approved kickoff packet request for orphan follow-through."
				: "Pending operator approval for orphan kickoff packet creation.",
		),
		"Execution Notes": richTextValue(
			"Created by orphan-classify as a local approval-backed packet request.",
		),
	};

	if (input.requestedByUserId) {
		properties["Requested By"] = peopleValue(input.requestedByUserId);
	}
	if (input.approve && input.requestedByUserId) {
		properties.Approver = peopleValue(input.requestedByUserId);
		properties["Decided At"] = { date: { start: today } };
	}

	return {
		title,
		markdown,
		providerRequestKey,
		properties,
	};
}

function findMatchingApprovalRequest(
	requests: ActionRequestRecord[],
	projectId: string,
	providerRequestKey: string,
): ActionRequestRecord | undefined {
	return requests.find(
		(request) =>
			request.localProjectIds.includes(projectId) &&
			request.providerRequestKey === providerRequestKey,
	);
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
	const requestApproval = options.requestApproval ?? false;
	const approve = options.approve ?? false;
	const createApprovedPackets = options.createApprovedPackets ?? false;
	const today = options.today ?? losAngelesToday();
	if ((requestApproval || createApprovedPackets || approve) && !live) {
		throw new Error(
			"--request-approval, --approve, and --create-approved-packets require --live",
		);
	}
	if (requestApproval && createPackets) {
		throw new Error(
			"Choose either --request-approval or --create-packets, not both in the same run",
		);
	}

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
	let approvalRequestsUpserted = 0;
	let approvedRequestsMatched = 0;

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

		if (requestApproval && viableNeedsKickoff.length > 0) {
			if (!config.phase6Governance) {
				throw new Error(
					"Control tower config is missing phase6Governance for approval requests",
				);
			}
			const requestSchema = await api.retrieveDataSource(
				config.phase6Governance.actionRequests.dataSourceId,
			);
			const requestPages = await fetchAllPages(
				api,
				config.phase6Governance.actionRequests.dataSourceId,
				requestSchema.titlePropertyName,
			);
			const actionRequests = requestPages.map((page) =>
				toActionRequestRecord(page),
			);
			for (const result of viableNeedsKickoff) {
				const draft = buildKickoffApprovalRequestDraft(result, today, {
					approve,
					requestedByUserId: config.phase2Execution?.defaultOwnerUserId,
				});
				const existing = findMatchingApprovalRequest(
					actionRequests,
					result.projectId,
					draft.providerRequestKey,
				);
				const properties = {
					...draft.properties,
					[requestSchema.titlePropertyName]: titleValue(draft.title),
				};
				if (existing) {
					await api.updatePageProperties({
						pageId: existing.id,
						properties,
					});
					await api.patchPageMarkdown({
						pageId: existing.id,
						command: "replace_content",
						newMarkdown: draft.markdown,
					});
				} else {
					const created = await api.createPageWithMarkdown({
						parent: {
							data_source_id: config.phase6Governance.actionRequests.dataSourceId,
						},
						properties: {
							[requestSchema.titlePropertyName]: titleValue(draft.title),
						},
						markdown: draft.markdown,
					});
					await api.updatePageProperties({
						pageId: created.id,
						properties,
					});
				}
				approvalRequestsUpserted += 1;
			}
		}

		if ((createPackets || createApprovedPackets) && viableNeedsKickoff.length > 0) {
			if (!config.phase2Execution) {
				throw new Error(
					"Control tower config is missing phase2Execution for work packet creation",
				);
			}
			let approvedRequests: ActionRequestRecord[] = [];
			if (createApprovedPackets) {
				if (!config.phase6Governance) {
					throw new Error(
						"Control tower config is missing phase6Governance for approved request lookup",
					);
				}
				const requestSchema = await api.retrieveDataSource(
					config.phase6Governance.actionRequests.dataSourceId,
				);
				const requestPages = await fetchAllPages(
					api,
					config.phase6Governance.actionRequests.dataSourceId,
					requestSchema.titlePropertyName,
				);
				approvedRequests = requestPages
					.map((page) => toActionRequestRecord(page))
					.filter((request) => request.status === "Approved");
			}
			const packetSchema = await api.retrieveDataSource(
				config.phase2Execution.packets.dataSourceId,
			);
			for (const result of viableNeedsKickoff) {
				if (createApprovedPackets) {
					const providerRequestKey = `orphan-kickoff:${result.projectId}`;
					const approvedRequest = findMatchingApprovalRequest(
						approvedRequests,
						result.projectId,
						providerRequestKey,
					);
					if (!approvedRequest) {
						continue;
					}
					approvedRequestsMatched += 1;
				}
				const draft = buildKickoffPacketDraft(
					result,
					today,
					config.phase2Execution.defaultOwnerUserId,
				);
				await upsertPageByTitle({
					api,
					dataSourceId: config.phase2Execution.packets.dataSourceId,
					titlePropertyName: packetSchema.titlePropertyName,
					title: draft.title,
					properties: {
						...draft.properties,
						[packetSchema.titlePropertyName]: titleValue(draft.title),
					},
					markdown: draft.markdown,
				});
				packetsCreated += 1;
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
		approvalRequestsUpserted,
		approvedRequestsMatched,
		packetsCreated,
	};

	console.log(JSON.stringify(summary, null, 2));
	console.log("\n" + markdown);
}

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
	return userId ? { people: [{ id: userId }] } : { people: [] };
}

function statusValue(value: string): { status: { name: string } } {
	return { status: { name: value } };
}
