import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  datePropertyValue,
  fetchAllPages,
  relationIds,
  relationValue,
  richTextValue,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();

const CANONICAL_SUPPORT_PAGE_IDS = new Map<string, string>([
  ["tool:ollama", "326c21f1-caf0-81f6-8558-ef78d04f60cb"],
]);

const FORCED_NEAR_DUPLICATE_MERGES = [
  {
    kind: "skill" as const,
    canonicalId: "32bc21f1-caf0-81fe-8451-de2e17ad29d1",
    duplicateId: "326c21f1-caf0-81c6-8120-f91c4f82b6b1",
  },
];

export interface SupportDatabaseHygieneFlags {
  live: boolean;
  today: string;
  config: string;
}

type SupportKind = "research" | "skill" | "tool";

interface SupportGroupPlan {
  kind: SupportKind;
  title: string;
  titlePropertyName: string;
  canonicalPage: DataSourcePageRef;
  canonicalMarkdown: string;
  duplicatePages: DataSourcePageRef[];
  duplicateMarkdowns: Map<string, string>;
  mergedProjectIds: string[];
  projectIdsNeedingRewrite: string[];
}

interface LowRiskArchiveCandidate {
  kind: SupportKind;
  id: string;
  title: string;
}

interface NearDuplicateCandidate {
  kind: SupportKind;
  leftId: string;
  leftTitle: string;
  rightId: string;
  rightTitle: string;
  score: number;
}

interface ForcedNearDuplicateMergePlan {
  kind: SupportKind;
  canonicalPage: DataSourcePageRef;
  duplicatePage: DataSourcePageRef;
  canonicalMarkdown: string;
  mergedProjectIds: string[];
  projectIdsNeedingRewrite: string[];
}

function parseFlags(argv: string[]): SupportDatabaseHygieneFlags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
      continue;
    }
    if (current === "--config") {
      config = argv[index + 1] ?? config;
      index += 1;
    }
  }

  return { live, today, config };
}

async function main(): Promise<void> {
  try {
    const output = await runSupportDatabaseHygienePass(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runSupportDatabaseHygienePass(
  flags: SupportDatabaseHygieneFlags,
): Promise<Record<string, unknown>> {
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for the support database hygiene pass",
  );
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);

  const [projectSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const plans = await buildSupportGroupPlans({
    api,
    projectPages,
    researchPages,
    researchTitlePropertyName: researchSchema.titlePropertyName,
    skillPages,
    skillTitlePropertyName: skillSchema.titlePropertyName,
    toolPages,
    toolTitlePropertyName: toolSchema.titlePropertyName,
  });
  const duplicatePageIds = new Set(plans.flatMap((plan) => plan.duplicatePages.map((page) => page.id)));
  const lowRiskArchiveCandidates = buildLowRiskArchiveCandidates([
    ...researchPages.map((page) => ({ kind: "research" as const, page })),
    ...skillPages.map((page) => ({ kind: "skill" as const, page })),
    ...toolPages.map((page) => ({ kind: "tool" as const, page })),
  ]).filter((candidate) => !duplicatePageIds.has(candidate.id));
  const nearDuplicateCandidates = buildNearDuplicateCandidates({
    researchPages,
    skillPages,
    toolPages,
    excludeIds: duplicatePageIds,
  });
  const forcedNearDuplicateMergePlans = await buildForcedNearDuplicateMergePlans({
    api,
    projectPages,
    researchPages,
    skillPages,
    toolPages,
  });

  const projectById = new Map(projectPages.map((page) => [page.id, page]));
  const archivedPages: Array<{ kind: SupportKind; title: string; id: string }> = [];
  const archivedLowRiskPages: Array<{ kind: SupportKind; title: string; id: string }> = [];
  const archivedForcedNearDuplicatePages: Array<{ kind: SupportKind; title: string; id: string }> = [];
  const rewrittenProjects: Array<{
    projectTitle: string;
    kind: SupportKind;
    title: string;
    removedDuplicateCount: number;
    canonicalId: string;
  }> = [];
  const mergedNearDuplicateRows: Array<{
    kind: SupportKind;
    canonicalTitle: string;
    canonicalId: string;
    archivedDuplicateId: string;
    archivedDuplicateTitle: string;
  }> = [];
  const canonicalRefreshes: Array<{
    kind: SupportKind;
    title: string;
    id: string;
    mergedProjectCount: number;
    duplicateCount: number;
  }> = [];

  if (flags.live) {
    for (const plan of plans) {
      await refreshCanonicalSupportPage({
        api,
        kind: plan.kind,
        page: plan.canonicalPage,
        mergedProjectIds: plan.mergedProjectIds,
        markdown: plan.canonicalMarkdown,
        today: flags.today,
      });
      canonicalRefreshes.push({
        kind: plan.kind,
        title: plan.title,
        id: plan.canonicalPage.id,
        mergedProjectCount: plan.mergedProjectIds.length,
        duplicateCount: plan.duplicatePages.length,
      });

      for (const projectId of plan.projectIdsNeedingRewrite) {
        const projectPage = projectById.get(projectId);
        if (!projectPage) {
          continue;
        }
        const propertyName = projectRelationProperty(plan.kind);
        const currentIds = relationIds(projectPage.properties[propertyName]);
        const duplicateIds = new Set(plan.duplicatePages.map((page) => page.id));
        const removedDuplicateCount = currentIds.filter((id) => duplicateIds.has(id)).length;
        const nextIds = uniqueIds([
          ...currentIds.filter((id) => !duplicateIds.has(id)),
          plan.canonicalPage.id,
        ]);
        if (!sameIdSet(currentIds, nextIds)) {
          await api.updatePageProperties({
            pageId: projectPage.id,
            properties: {
              [propertyName]: relationValue(nextIds),
            },
          });
        }
        rewrittenProjects.push({
          projectTitle: projectPage.title,
          kind: plan.kind,
          title: plan.title,
          removedDuplicateCount,
          canonicalId: plan.canonicalPage.id,
        });
      }

      for (const duplicatePage of plan.duplicatePages) {
        await sdk.pages.update({
          page_id: duplicatePage.id,
          in_trash: true,
        });
        archivedPages.push({
          kind: plan.kind,
          title: duplicatePage.title,
          id: duplicatePage.id,
        });
      }
    }

    for (const candidate of lowRiskArchiveCandidates) {
      await sdk.pages.update({
        page_id: candidate.id,
        in_trash: true,
      });
      archivedLowRiskPages.push({
        kind: candidate.kind,
        title: candidate.title,
        id: candidate.id,
      });
    }

    for (const plan of forcedNearDuplicateMergePlans) {
      await mergeForcedNearDuplicate({
        api,
        sdk,
        projectById,
        plan,
        today: flags.today,
      });
      mergedNearDuplicateRows.push({
        kind: plan.kind,
        canonicalTitle: plan.canonicalPage.title,
        canonicalId: plan.canonicalPage.id,
        archivedDuplicateId: plan.duplicatePage.id,
        archivedDuplicateTitle: plan.duplicatePage.title,
      });
      archivedForcedNearDuplicatePages.push({
        kind: plan.kind,
        title: plan.duplicatePage.title,
        id: plan.duplicatePage.id,
      });
    }
  }

  const unresolvedNearDuplicateCandidates = nearDuplicateCandidates.filter(
    (candidate) =>
      !forcedNearDuplicateMergePlans.some(
        (plan) =>
          plan.kind === candidate.kind &&
          ((plan.canonicalPage.id === candidate.leftId && plan.duplicatePage.id === candidate.rightId) ||
            (plan.canonicalPage.id === candidate.rightId && plan.duplicatePage.id === candidate.leftId)),
      ),
  );

  return {
    ok: true,
    live: flags.live,
    duplicateGroupCount: plans.length,
    lowRiskArchiveCount: lowRiskArchiveCandidates.length,
    forcedNearDuplicateMergeCount: forcedNearDuplicateMergePlans.length,
    nearDuplicateCandidateCount: unresolvedNearDuplicateCandidates.length,
    duplicateCounts: {
      research: plans.filter((plan) => plan.kind === "research").reduce((sum, plan) => sum + plan.duplicatePages.length, 0),
      skills: plans.filter((plan) => plan.kind === "skill").reduce((sum, plan) => sum + plan.duplicatePages.length, 0),
      tools: plans.filter((plan) => plan.kind === "tool").reduce((sum, plan) => sum + plan.duplicatePages.length, 0),
    },
    plans: plans.map((plan) => ({
      kind: plan.kind,
      title: plan.title,
      canonicalPage: {
        id: plan.canonicalPage.id,
        title: plan.canonicalPage.title,
      },
      duplicatePages: plan.duplicatePages.map((page) => ({ id: page.id, title: page.title })),
      mergedProjectIds: plan.mergedProjectIds,
      projectIdsNeedingRewrite: plan.projectIdsNeedingRewrite,
    })),
    lowRiskArchiveCandidates,
    nearDuplicateCandidates: unresolvedNearDuplicateCandidates,
    forcedNearDuplicateMergePlans: forcedNearDuplicateMergePlans.map((plan) => ({
      kind: plan.kind,
      canonicalPage: { id: plan.canonicalPage.id, title: plan.canonicalPage.title },
      duplicatePage: { id: plan.duplicatePage.id, title: plan.duplicatePage.title },
      mergedProjectIds: plan.mergedProjectIds,
      projectIdsNeedingRewrite: plan.projectIdsNeedingRewrite,
    })),
    canonicalRefreshes,
    rewrittenProjects,
    mergedNearDuplicateRows,
    archivedPages,
    archivedLowRiskPages,
    archivedForcedNearDuplicatePages,
  };
}

async function buildSupportGroupPlans(input: {
  api: DirectNotionClient;
  projectPages: DataSourcePageRef[];
  researchPages: DataSourcePageRef[];
  researchTitlePropertyName: string;
  skillPages: DataSourcePageRef[];
  skillTitlePropertyName: string;
  toolPages: DataSourcePageRef[];
  toolTitlePropertyName: string;
}): Promise<SupportGroupPlan[]> {
  const projectPages = input.projectPages;
  const plans: SupportGroupPlan[] = [];

  plans.push(
    ...(await buildPlansForKind({
      api: input.api,
      kind: "research",
      pages: input.researchPages,
      titlePropertyName: input.researchTitlePropertyName,
      projectPages,
    })),
  );
  plans.push(
    ...(await buildPlansForKind({
      api: input.api,
      kind: "skill",
      pages: input.skillPages,
      titlePropertyName: input.skillTitlePropertyName,
      projectPages,
    })),
  );
  plans.push(
    ...(await buildPlansForKind({
      api: input.api,
      kind: "tool",
      pages: input.toolPages,
      titlePropertyName: input.toolTitlePropertyName,
      projectPages,
    })),
  );

  return plans;
}

async function buildPlansForKind(input: {
  api: DirectNotionClient;
  kind: SupportKind;
  pages: DataSourcePageRef[];
  titlePropertyName: string;
  projectPages: DataSourcePageRef[];
}): Promise<SupportGroupPlan[]> {
  const groups = findDuplicateGroups(input.pages);
  const projectPages = input.projectPages;
  const plans: SupportGroupPlan[] = [];

  for (const group of groups) {
    const markdownByPageId = new Map<string, string>();
    for (const page of group) {
      const markdown = await input.api.readPageMarkdown(page.id);
      markdownByPageId.set(page.id, markdown.markdown.trim());
    }

    const canonicalPage = chooseCanonicalPage({
      kind: input.kind,
      pages: group,
      markdownByPageId,
    });
    const duplicatePages = group.filter((page) => page.id !== canonicalPage.id);
    const mergedProjectIds = uniqueIds(group.flatMap((page) => relationIds(page.properties[supportProjectProperty(input.kind)])));
    const projectIdsNeedingRewrite = projectPages
      .filter((page) => {
        const currentIds = relationIds(page.properties[projectRelationProperty(input.kind)]);
        return currentIds.some((id) => duplicatePages.some((candidate) => candidate.id === id));
      })
      .map((page) => page.id);

    plans.push({
      kind: input.kind,
      title: canonicalPage.title,
      titlePropertyName: input.titlePropertyName,
      canonicalPage,
      canonicalMarkdown: chooseCanonicalMarkdown({
        kind: input.kind,
        title: canonicalPage.title,
        canonicalPage,
        pages: group,
        markdownByPageId,
      }),
      duplicatePages,
      duplicateMarkdowns: markdownByPageId,
      mergedProjectIds,
      projectIdsNeedingRewrite,
    });
  }

  return plans;
}

async function buildForcedNearDuplicateMergePlans(input: {
  api: DirectNotionClient;
  projectPages: DataSourcePageRef[];
  researchPages: DataSourcePageRef[];
  skillPages: DataSourcePageRef[];
  toolPages: DataSourcePageRef[];
}): Promise<ForcedNearDuplicateMergePlan[]> {
  const pagesByKind = {
    research: new Map(input.researchPages.map((page) => [page.id, page])),
    skill: new Map(input.skillPages.map((page) => [page.id, page])),
    tool: new Map(input.toolPages.map((page) => [page.id, page])),
  };

  const plans: ForcedNearDuplicateMergePlan[] = [];

  for (const rule of FORCED_NEAR_DUPLICATE_MERGES) {
    const pageMap = pagesByKind[rule.kind];
    const canonicalPage = pageMap.get(rule.canonicalId);
    const duplicatePage = pageMap.get(rule.duplicateId);
    if (!canonicalPage || !duplicatePage) {
      continue;
    }

    const [canonicalMarkdown, duplicateMarkdown] = await Promise.all([
      input.api.readPageMarkdown(canonicalPage.id),
      input.api.readPageMarkdown(duplicatePage.id),
    ]);
    const mergedProjectIds = uniqueIds([
      ...relationIds(canonicalPage.properties[supportProjectProperty(rule.kind)]),
      ...relationIds(duplicatePage.properties[supportProjectProperty(rule.kind)]),
    ]);
    const projectIdsNeedingRewrite = input.projectPages
      .filter((page) => relationIds(page.properties[projectRelationProperty(rule.kind)]).includes(duplicatePage.id))
      .map((page) => page.id);

    plans.push({
      kind: rule.kind,
      canonicalPage,
      duplicatePage,
      canonicalMarkdown: mergeNearDuplicateMarkdown({
        kind: rule.kind,
        canonicalTitle: canonicalPage.title,
        canonicalMarkdown: canonicalMarkdown.markdown.trim(),
        duplicateMarkdown: duplicateMarkdown.markdown.trim(),
      }),
      mergedProjectIds,
      projectIdsNeedingRewrite,
    });
  }

  return plans;
}

async function refreshCanonicalSupportPage(input: {
  api: DirectNotionClient;
  kind: SupportKind;
  page: DataSourcePageRef;
  mergedProjectIds: string[];
  markdown: string;
  today: string;
}): Promise<void> {
  const properties: Record<string, unknown> = {
    [supportProjectProperty(input.kind)]: relationValue(input.mergedProjectIds),
  };

  if (input.kind === "tool") {
    properties["Last Reviewed"] = datePropertyValue(input.today);
  }

  await input.api.updatePageProperties({
    pageId: input.page.id,
    properties,
  });

  const currentMarkdown = await input.api.readPageMarkdown(input.page.id);
  if (currentMarkdown.markdown.trim() !== input.markdown.trim()) {
    await input.api.patchPageMarkdown({
      pageId: input.page.id,
      command: "replace_content",
      newMarkdown: input.markdown,
    });
  }
}

async function mergeForcedNearDuplicate(input: {
  api: DirectNotionClient;
  sdk: Client;
  projectById: Map<string, DataSourcePageRef>;
  plan: ForcedNearDuplicateMergePlan;
  today: string;
}): Promise<void> {
  const mergedProperties = buildForcedNearDuplicateProperties({
    kind: input.plan.kind,
    canonicalPage: input.plan.canonicalPage,
    duplicatePage: input.plan.duplicatePage,
    mergedProjectIds: input.plan.mergedProjectIds,
    today: input.today,
  });

  await input.api.updatePageProperties({
    pageId: input.plan.canonicalPage.id,
    properties: mergedProperties,
  });

  const currentMarkdown = await input.api.readPageMarkdown(input.plan.canonicalPage.id);
  if (currentMarkdown.markdown.trim() !== input.plan.canonicalMarkdown.trim()) {
    await input.api.patchPageMarkdown({
      pageId: input.plan.canonicalPage.id,
      command: "replace_content",
      newMarkdown: input.plan.canonicalMarkdown,
    });
  }

  for (const projectId of input.plan.projectIdsNeedingRewrite) {
    const projectPage = input.projectById.get(projectId);
    if (!projectPage) {
      continue;
    }
    const propertyName = projectRelationProperty(input.plan.kind);
    const currentIds = relationIds(projectPage.properties[propertyName]);
    const nextIds = uniqueIds([
      ...currentIds.filter((id) => id !== input.plan.duplicatePage.id),
      input.plan.canonicalPage.id,
    ]);
    if (!sameIdSet(currentIds, nextIds)) {
      await input.api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          [propertyName]: relationValue(nextIds),
        },
      });
    }
  }

  await input.sdk.pages.update({
    page_id: input.plan.duplicatePage.id,
    in_trash: true,
  });
}

function findDuplicateGroups(pages: DataSourcePageRef[]): DataSourcePageRef[][] {
  const groupsByTitle = new Map<string, DataSourcePageRef[]>();

  for (const page of pages) {
    const key = normalizeKey(page.title);
    if (!key) {
      continue;
    }
    const existing = groupsByTitle.get(key) ?? [];
    existing.push(page);
    groupsByTitle.set(key, existing);
  }

  return Array.from(groupsByTitle.values()).filter((group) => group.length > 1);
}

function buildLowRiskArchiveCandidates(
  pages: Array<{ kind: SupportKind; page: DataSourcePageRef }>,
): LowRiskArchiveCandidate[] {
  return pages
    .filter(({ kind, page }) => {
      if (!/\bsandbox\b/i.test(page.title)) {
        return false;
      }
      return relationIds(page.properties[supportProjectProperty(kind)]).length === 0;
    })
    .map(({ kind, page }) => ({
      kind,
      id: page.id,
      title: page.title,
    }));
}

function buildNearDuplicateCandidates(input: {
  researchPages: DataSourcePageRef[];
  skillPages: DataSourcePageRef[];
  toolPages: DataSourcePageRef[];
  excludeIds: Set<string>;
}): NearDuplicateCandidate[] {
  const candidates: NearDuplicateCandidate[] = [];

  const scan = (kind: SupportKind, pages: DataSourcePageRef[]): void => {
    const filteredPages = pages.filter((page) => !input.excludeIds.has(page.id));
    for (let leftIndex = 0; leftIndex < filteredPages.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < filteredPages.length; rightIndex += 1) {
        const left = filteredPages[leftIndex]!;
        const right = filteredPages[rightIndex]!;
        const leftKey = normalizedTokenString(left.title);
        const rightKey = normalizedTokenString(right.title);
        if (!leftKey || !rightKey || leftKey === rightKey) {
          continue;
        }
        const score = jaccardScore(left.title, right.title);
        if (score >= 0.55) {
          candidates.push({
            kind,
            leftId: left.id,
            leftTitle: left.title,
            rightId: right.id,
            rightTitle: right.title,
            score: Number(score.toFixed(2)),
          });
        }
      }
    }
  };

  scan("research", input.researchPages);
  scan("skill", input.skillPages);
  scan("tool", input.toolPages);

  return candidates.sort((left, right) => right.score - left.score).slice(0, 20);
}

function buildForcedNearDuplicateProperties(input: {
  kind: SupportKind;
  canonicalPage: DataSourcePageRef;
  duplicatePage: DataSourcePageRef;
  mergedProjectIds: string[];
  today: string;
}): Record<string, unknown> {
  const canonical = input.canonicalPage.properties;
  const duplicate = input.duplicatePage.properties;

  if (input.kind === "skill") {
    return {
      "Related Local Projects": relationValue(input.mergedProjectIds),
      Category: canonical.Category?.select?.name
        ? { select: { name: canonical.Category.select.name } }
        : duplicate.Category?.select?.name
          ? { select: { name: duplicate.Category.select.name } }
          : undefined,
      Status: canonical.Status?.select?.name
        ? { select: { name: canonical.Status.select.name } }
        : duplicate.Status?.select?.name
          ? { select: { name: duplicate.Status.select.name } }
          : undefined,
      "Project Relevance": canonical["Project Relevance"]?.select?.name
        ? { select: { name: canonical["Project Relevance"].select.name } }
        : duplicate["Project Relevance"]?.select?.name
          ? { select: { name: duplicate["Project Relevance"].select.name } }
          : undefined,
      "Review Cadence": canonical["Review Cadence"]?.select?.name || duplicate["Review Cadence"]?.select?.name
        ? {
            select: {
              name:
                canonical["Review Cadence"]?.select?.name ??
                duplicate["Review Cadence"]?.select?.name ??
                "Monthly",
            },
          }
        : undefined,
      "Proof Type": {
        multi_select: uniqueIds([
          ...(canonical["Proof Type"]?.multi_select ?? []).map((entry) => entry.name ?? "").filter(Boolean),
          ...(duplicate["Proof Type"]?.multi_select ?? []).map((entry) => entry.name ?? "").filter(Boolean),
        ]).map((name) => ({ name })),
      },
      "Last Practiced": datePropertyValue(
        canonical["Last Practiced"]?.date?.start ??
          duplicate["Last Practiced"]?.date?.start ??
          input.today,
      ),
      Proficiency: {
        number:
          typeof canonical.Proficiency?.number === "number"
            ? canonical.Proficiency.number
            : typeof duplicate.Proficiency?.number === "number"
              ? duplicate.Proficiency.number
              : 4,
      },
      Notes: richTextValue(
        uniqueNonEmpty([
          richTextPlain(canonical.Notes),
          richTextPlain(duplicate.Notes),
        ]).join(" "),
      ),
      Projects: richTextValue(
        uniqueNonEmpty([
          richTextPlain(canonical.Projects),
          richTextPlain(duplicate.Projects),
        ]).join(", "),
      ),
      "Needs Link Review": { checkbox: false },
    };
  }

  return {
    [supportProjectProperty(input.kind)]: relationValue(input.mergedProjectIds),
  };
}

function mergeNearDuplicateMarkdown(input: {
  kind: SupportKind;
  canonicalTitle: string;
  canonicalMarkdown: string;
  duplicateMarkdown: string;
}): string {
  if (input.kind !== "skill") {
    return input.canonicalMarkdown || `# ${input.canonicalTitle}`;
  }

  const canonical = input.canonicalMarkdown.trim();
  const duplicate = input.duplicateMarkdown.trim();
  if (!canonical && !duplicate) {
    return `# ${input.canonicalTitle}`;
  }
  if (!duplicate) {
    return normalizeMarkdownTitle(canonical, input.canonicalTitle);
  }
  if (!canonical) {
    return normalizeMarkdownTitle(duplicate, input.canonicalTitle);
  }
  if (canonical.includes("Demonstrated Capabilities")) {
    return normalizeMarkdownTitle(canonical, input.canonicalTitle);
  }
  return normalizeMarkdownTitle(`${canonical}\n\n## Merged Notes\n${duplicate}`, input.canonicalTitle);
}

function chooseCanonicalPage(input: {
  kind: SupportKind;
  pages: DataSourcePageRef[];
  markdownByPageId: Map<string, string>;
}): DataSourcePageRef {
  const canonicalId = CANONICAL_SUPPORT_PAGE_IDS.get(`${input.kind}:${normalizeKey(input.pages[0]?.title ?? "")}`);
  if (canonicalId) {
    const forced = input.pages.find((page) => page.id === canonicalId);
    if (forced) {
      return forced;
    }
  }

  return [...input.pages].sort((left, right) => scoreSupportPage(right, input.kind, input.markdownByPageId) - scoreSupportPage(left, input.kind, input.markdownByPageId))[0]!;
}

function chooseCanonicalMarkdown(input: {
  kind: SupportKind;
  title: string;
  canonicalPage: DataSourcePageRef;
  pages: DataSourcePageRef[];
  markdownByPageId: Map<string, string>;
}): string {
  if (input.kind !== "tool") {
    return input.markdownByPageId.get(input.canonicalPage.id)?.trim() || `# ${input.title}`;
  }

  const richest = [...input.pages].sort((left, right) => markdownLength(input.markdownByPageId.get(right.id)) - markdownLength(input.markdownByPageId.get(left.id)))[0];
  if (!richest) {
    return `# ${input.title}`;
  }
  const richestMarkdown = input.markdownByPageId.get(richest.id)?.trim() || "";
  return normalizeMarkdownTitle(richestMarkdown, input.title);
}

function scoreSupportPage(
  page: DataSourcePageRef,
  kind: SupportKind,
  markdownByPageId: Map<string, string>,
): number {
  const projectCount = relationIds(page.properties[supportProjectProperty(kind)]).length;
  const markdownScore = markdownLength(markdownByPageId.get(page.id));
  const createdAt = page.createdTime ? Date.parse(page.createdTime) : 0;
  return projectCount * 100000 + markdownScore * 10 + createdAt / 1000;
}

function supportProjectProperty(kind: SupportKind): string {
  switch (kind) {
    case "research":
    case "skill":
      return "Related Local Projects";
    case "tool":
      return "Linked Local Projects";
  }
}

function projectRelationProperty(kind: SupportKind): string {
  switch (kind) {
    case "research":
      return "Related Research";
    case "skill":
      return "Supporting Skills";
    case "tool":
      return "Tool Stack Records";
  }
}

function markdownLength(markdown?: string): number {
  return markdown?.trim().length ?? 0;
}

function normalizeMarkdownTitle(markdown: string, title: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return `# ${title}`;
  }
  if (trimmed.startsWith("#")) {
    return trimmed.replace(/^# .*/u, `# ${title}`);
  }
  return `# ${title}\n\n${trimmed}`;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedTokenString(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccardScore(left: string, right: string): number {
  const leftTokens = new Set(normalizedTokenString(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(normalizedTokenString(right).split(/\s+/).filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function richTextPlain(property?: DataSourcePageRef["properties"][string]): string {
  return (property?.rich_text ?? []).map((entry) => entry.plain_text ?? "").join("").trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

if (process.argv[1]?.endsWith("support-database-hygiene-pass.ts")) {
  void main();
}
