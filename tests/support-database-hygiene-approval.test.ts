import { describe, expect, test, vi } from "vitest";

import {
	buildSupportHygieneEffects,
	executeCurrentSupportHygienePlan,
	performSupportHygieneEffect,
	readbackSupportHygieneEffect,
} from "../src/internal/notion-maintenance/support-database-hygiene-pass.js";
import { runGitHubSupportMaintenance } from "../src/internal/notion-maintenance/github-support-maintenance.js";
import { buildNotionHygienePlan } from "../src/security/notion-hygiene-authority.js";
import type { DataSourcePageRef } from "../src/notion/local-portfolio-control-tower-live.js";

const SOURCE_REVISION = "c".repeat(40);

function page(
	id: string,
	title: string,
	properties: DataSourcePageRef["properties"] = {},
): DataSourcePageRef {
	return {
		id,
		title,
		url: `https://notion.test/${id}`,
		properties,
	};
}

function relation(ids: string[]) {
	return { type: "relation" as const, relation: ids.map((id) => ({ id })) };
}

function notionId(index: number): string {
	return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function exactDuplicatePlan(input: {
	title: string;
	canonicalId: string;
	duplicateId: string;
	projectId: string;
}) {
	const canonical = page(input.canonicalId, input.title, {
		"Related Local Projects": relation([input.projectId]),
	});
	const duplicate = page(input.duplicateId, input.title, {
		"Related Local Projects": relation([input.projectId]),
	});
	return {
		kind: "research" as const,
		title: input.title,
		titlePropertyName: "Topic",
		canonicalPage: canonical,
		canonicalMarkdown: `# ${input.title}`,
		duplicatePages: [duplicate],
		duplicateMarkdowns: new Map([
			[canonical.id, `# ${input.title}`],
			[duplicate.id, `# ${input.title}`],
		]),
		mergedProjectIds: [input.projectId],
		projectIdsNeedingRewrite: [input.projectId],
	};
}

describe("support database hygiene approval integration", () => {
	test("multiple duplicate groups produce one combined project rewrite", () => {
		const projectId = notionId(1);
		const canonicalA = notionId(2);
		const duplicateA = notionId(3);
		const canonicalB = notionId(4);
		const duplicateB = notionId(5);
		const other = notionId(6);
		const project = page(projectId, "Project One", {
			"Related Research": relation([duplicateA, duplicateB, other]),
		});
		const effects = buildSupportHygieneEffects({
			plans: [
				exactDuplicatePlan({
					title: "Research A",
					canonicalId: canonicalA,
					duplicateId: duplicateA,
					projectId: project.id,
				}),
				exactDuplicatePlan({
					title: "Research B",
					canonicalId: canonicalB,
					duplicateId: duplicateB,
					projectId: project.id,
				}),
			],
			lowRiskArchiveCandidates: [],
			forcedNearDuplicateMergePlans: [],
			projectById: new Map([[project.id, project]]),
			today: "2026-07-17",
		});

		const rewrites = effects.filter(
			(effect) =>
				effect.kind === "page_properties_update" &&
				effect.targetId === project.id,
		);
		expect(rewrites).toHaveLength(1);
		expect(
			(
				rewrites[0]!.payload.properties as {
					"Related Research": { relation: Array<{ id: string }> };
				}
			)["Related Research"].relation.map((entry) => entry.id),
		).toEqual([canonicalA, canonicalB, other]);
		expect(
			effects.filter((effect) => effect.kind === "page_archive"),
		).toHaveLength(2);
	});

	test("one duplicate cannot map to conflicting canonical pages", () => {
		const projectId = notionId(11);
		const duplicate = notionId(12);
		const project = page(projectId, "Project One", {
			"Related Research": relation([duplicate]),
		});
		expect(() =>
			buildSupportHygieneEffects({
				plans: [
					exactDuplicatePlan({
						title: "Research A",
						canonicalId: notionId(13),
						duplicateId: duplicate,
						projectId: project.id,
					}),
					exactDuplicatePlan({
						title: "Research B",
						canonicalId: notionId(14),
						duplicateId: duplicate,
						projectId: project.id,
					}),
				],
				lowRiskArchiveCandidates: [],
				forcedNearDuplicateMergePlans: [],
				projectById: new Map([[project.id, project]]),
				today: "2026-07-17",
			}),
		).toThrow(/multiple canonical targets/i);
	});

	test("changed live state is rejected before envelope claim or effects", async () => {
		const renderedPlan = buildNotionHygienePlan({
			actionKind: "notion.support_database_hygiene",
			sourceRevision: SOURCE_REVISION,
			effects: [
				{
					effectId: "archive:duplicate",
					kind: "page_archive",
					targetId: "duplicate",
					payload: { in_trash: true },
				},
			],
		});
		const currentPlan = structuredClone(renderedPlan);
		currentPlan.effects[0]!.targetId = "changed";
		const performEffect = vi.fn();

		await expect(
			executeCurrentSupportHygienePlan({
				currentPlan,
				renderedPlan,
				envelopePath: "/does/not/exist",
				claimStateDir: "/does/not/exist",
				receiptDir: "/does/not/exist",
				performEffect,
				readbackEffect: vi.fn(),
			}),
		).rejects.toThrow(/live state no longer matches/i);
		expect(performEffect).not.toHaveBeenCalled();
	});

	test("fake provider effects require exact post-change readback", async () => {
		const targetId = notionId(21);
		const relatedId = notionId(22);
		const updatePageProperties = vi.fn().mockResolvedValue({});
		const archivePage = vi.fn().mockResolvedValue(undefined);
		const patchPageMarkdown = vi.fn().mockResolvedValue(undefined);
		const readPageMarkdown = vi.fn().mockResolvedValue({
			markdown: "# Canonical",
			truncated: false,
		});
		const retrieve = vi
			.fn()
			.mockResolvedValueOnce({
				properties: {
					"Related Research": relation([relatedId]),
				},
			})
			.mockResolvedValueOnce({ in_trash: true, archived: false });
		const api = {
			updatePageProperties,
			archivePage,
			patchPageMarkdown,
			readPageMarkdown,
		};
		const sdk = { pages: { retrieve } };
		const propertyEffect = {
			effectId: `rewrite:${targetId}`,
			kind: "page_properties_update" as const,
			targetId,
			payload: {
				properties: {
					"Related Research": relation([relatedId]),
				},
			},
		};
		const archiveEffect = {
			effectId: `archive:${targetId}`,
			kind: "page_archive" as const,
			targetId,
			payload: { in_trash: true },
		};
		const markdownEffect = {
			effectId: `markdown:${targetId}`,
			kind: "page_markdown_replace" as const,
			targetId,
			payload: { markdown: "# Canonical" },
		};

		await performSupportHygieneEffect({
			effect: propertyEffect,
			api: api as never,
		});
		await performSupportHygieneEffect({
			effect: archiveEffect,
			api: api as never,
		});
		await performSupportHygieneEffect({
			effect: markdownEffect,
			api: api as never,
		});
		expect(updatePageProperties).toHaveBeenCalledOnce();
		expect(archivePage).toHaveBeenCalledOnce();
		expect(patchPageMarkdown).toHaveBeenCalledOnce();

		await expect(
			readbackSupportHygieneEffect({
				effect: propertyEffect,
				api: api as never,
				sdk: sdk as never,
			}),
		).resolves.toMatchObject({ verified: true });
		await expect(
			readbackSupportHygieneEffect({
				effect: archiveEffect,
				api: api as never,
				sdk: sdk as never,
			}),
		).resolves.toMatchObject({ verified: true });
		await expect(
			readbackSupportHygieneEffect({
				effect: markdownEffect,
				api: api as never,
				sdk: sdk as never,
			}),
		).resolves.toMatchObject({ verified: true });
	});

	test("combined GitHub support live execution fails before either product runs", async () => {
		await expect(
			runGitHubSupportMaintenance({
				live: true,
				owner: "fixture",
				limit: 1,
				today: "2026-07-17",
				config: "/does/not/exist",
				sourceConfig: "/does/not/exist",
			}),
		).rejects.toThrow(/authority cannot be inherited/i);
	});
});
