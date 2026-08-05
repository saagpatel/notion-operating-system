import "../../config/load-default-env.js";

import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../../cli/context.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { createNotionSdkClient } from "../../notion/notion-sdk.js";
import { WorkspaceIds } from "../../config/workspace-ids.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  datePropertyValue,
  fetchAllPages,
  relationIds,
  relationValue,
  richTextValue,
  type DataSourcePageRef,
} from "../../notion/local-portfolio-control-tower-live.js";
import {
  buildNotionHygienePlan,
  executeAuthorizedNotionHygiene,
  type NotionHygieneEffect,
  type NotionHygieneEffectReadback,
  type NotionHygienePlan,
} from "../../security/notion-hygiene-authority.js";
import {
  canonicalJson,
  sha256Json,
} from "../../security/irreversible-action-envelope.js";

const TODAY = losAngelesToday();

export interface SupportDatabaseHygieneFlags {
  live: boolean;
  today: string;
  config: string;
  planOutput?: string;
  plan?: string;
  envelope?: string;
  claimStateDir?: string;
  receiptDir?: string;
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
  currentCanonicalMarkdown: string;
  canonicalMarkdown: string;
  mergedProjectIds: string[];
  projectIdsNeedingRewrite: string[];
}

function parseFlags(argv: string[]): SupportDatabaseHygieneFlags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let planOutput: string | undefined;
  let plan: string | undefined;
  let envelope: string | undefined;
  let claimStateDir: string | undefined;
  let receiptDir: string | undefined;

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
      continue;
    }
    if (current === "--plan-output") {
      planOutput = requiredFlagValue(argv, index, current);
      index += 1;
      continue;
    }
    if (current === "--plan") {
      plan = requiredFlagValue(argv, index, current);
      index += 1;
      continue;
    }
    if (current === "--envelope") {
      envelope = requiredFlagValue(argv, index, current);
      index += 1;
      continue;
    }
    if (current === "--claim-state-dir") {
      claimStateDir = requiredFlagValue(argv, index, current);
      index += 1;
      continue;
    }
    if (current === "--receipt-dir") {
      receiptDir = requiredFlagValue(argv, index, current);
      index += 1;
    }
  }

  return {
    live,
    today,
    config,
    planOutput,
    plan,
    envelope,
    claimStateDir,
    receiptDir,
  };
}

function requiredFlagValue(
  argv: string[],
  index: number,
  flag: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new AppError(`Expected a value after ${flag}`);
  }
  return value;
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (shouldShowHelp(argv)) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:support-database-hygiene-pass --",
          description: "Run the review-first hygiene pass for support databases.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--live", description: "Execute an exact previously rendered plan." },
            { flag: "--plan-output <path>", description: "Write the read-only rendered plan." },
            { flag: "--plan <path>", description: "Previously rendered plan JSON." },
            { flag: "--envelope <path>", description: "One-shot approval envelope." },
            { flag: "--claim-state-dir <path>", description: "Private one-shot claim directory." },
            { flag: "--receipt-dir <path>", description: "Private terminal receipt directory." },
            { flag: "--today <date>", description: "Override the date anchor in YYYY-MM-DD format." },
            { flag: "--config <path>", description: "Path to the control-tower config file." },
          ],
          notes: [
            "Plan rendering performs Notion reads only.",
            "Live execution fails closed unless every authority artifact is supplied.",
          ],
        }),
      );
      return;
    }

    const output = await runSupportDatabaseHygienePass(parseFlags(argv));
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
  const workspaceIds = await WorkspaceIds.load();
  const api = new DirectNotionClient(token);
  const sdk = createNotionSdkClient(token);

  const [projectSchema, researchSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
  ]);
  const [skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPages] = await Promise.all([
    fetchAllPages(api, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(api, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
  ]);
  const [skillPages, toolPages] = await Promise.all([
    fetchAllPages(api, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(api, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
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
    canonicalSupportPageIds: workspaceIds.canonicalSupportPageIds,
  });
  const duplicatePageIds = new Set(plans.flatMap((plan) => plan.duplicatePages.map((page) => page.id)));
  const rawLowRiskArchiveCandidates = buildLowRiskArchiveCandidates([
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
    forcedNearDuplicateMerges: workspaceIds.forcedNearDuplicateMerges,
  });
  const forcedPageIds = new Set(
    forcedNearDuplicateMergePlans.flatMap((plan) => [
      plan.canonicalPage.id,
      plan.duplicatePage.id,
    ]),
  );
  const lowRiskArchiveCandidates = rawLowRiskArchiveCandidates.filter(
    (candidate) => !forcedPageIds.has(candidate.id),
  );
  const groupedPageIds = new Set(
    plans.flatMap((plan) => [
      plan.canonicalPage.id,
      ...plan.duplicatePages.map((page) => page.id),
    ]),
  );
  for (const plan of forcedNearDuplicateMergePlans) {
    if (
      groupedPageIds.has(plan.canonicalPage.id) ||
      groupedPageIds.has(plan.duplicatePage.id)
    ) {
      throw new AppError(
        `forced near-duplicate merge overlaps an exact-duplicate group: ${plan.canonicalPage.id}/${plan.duplicatePage.id}`,
      );
    }
  }

  const projectById = new Map(projectPages.map((page) => [page.id, page]));
  const effects = buildSupportHygieneEffects({
    plans,
    lowRiskArchiveCandidates,
    forcedNearDuplicateMergePlans,
    projectById,
    today: flags.today,
  });
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const currentApprovalPlan =
    effects.length > 0
      ? buildNotionHygienePlan({
          actionKind: "notion.support_database_hygiene",
          sourceRevision,
          effects,
        })
      : null;
  if (!flags.live && flags.planOutput && currentApprovalPlan) {
    await writeFile(
      flags.planOutput,
      `${JSON.stringify(currentApprovalPlan, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await chmod(flags.planOutput, 0o600);
  }
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
    if (
      !flags.plan ||
      !flags.envelope ||
      !flags.claimStateDir ||
      !flags.receiptDir
    ) {
      throw new AppError(
        "--live requires --plan, --envelope, --claim-state-dir, and --receipt-dir",
      );
    }
    if (!currentApprovalPlan) {
      throw new AppError("live support hygiene execution has no state-changing effects");
    }
    const renderedPlan = JSON.parse(
      await readFile(flags.plan, "utf8"),
    ) as NotionHygienePlan;
    await executeCurrentSupportHygienePlan({
      currentPlan: currentApprovalPlan,
      renderedPlan,
      envelopePath: flags.envelope,
      claimStateDir: flags.claimStateDir,
      receiptDir: flags.receiptDir,
      performEffect: async (effect) => {
        const providerReference = await performSupportHygieneEffect({
          effect,
          api,
        });
        recordAppliedSupportEffect({
          effect,
          archivedPages,
          archivedLowRiskPages,
          archivedForcedNearDuplicatePages,
          rewrittenProjects,
          mergedNearDuplicateRows,
          canonicalRefreshes,
        });
        return providerReference;
      },
      readbackEffect: (effect) =>
        readbackSupportHygieneEffect({ effect, api, sdk }),
    });
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
    approvalPlan: currentApprovalPlan,
  };
}

export async function executeCurrentSupportHygienePlan(input: {
  currentPlan: NotionHygienePlan;
  renderedPlan: NotionHygienePlan;
  envelopePath: string;
  claimStateDir: string;
  receiptDir: string;
  performEffect: (
    effect: NotionHygieneEffect,
    providerIdempotencyKey: string,
  ) => Promise<string>;
  readbackEffect: (
    effect: NotionHygieneEffect,
  ) => Promise<NotionHygieneEffectReadback>;
}): Promise<Record<string, unknown>> {
  if (canonicalJson(input.renderedPlan) !== canonicalJson(input.currentPlan)) {
    throw new AppError(
      "live state no longer matches the previously rendered support hygiene plan",
    );
  }
  return executeAuthorizedNotionHygiene({
    plan: input.renderedPlan,
    envelopePath: input.envelopePath,
    claimStateDir: input.claimStateDir,
    receiptDir: input.receiptDir,
    performEffect: input.performEffect,
    readbackEffect: input.readbackEffect,
  });
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
  canonicalSupportPageIds: ReadonlyMap<string, string>;
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
      canonicalSupportPageIds: input.canonicalSupportPageIds,
    })),
  );
  plans.push(
    ...(await buildPlansForKind({
      api: input.api,
      kind: "skill",
      pages: input.skillPages,
      titlePropertyName: input.skillTitlePropertyName,
      projectPages,
      canonicalSupportPageIds: input.canonicalSupportPageIds,
    })),
  );
  plans.push(
    ...(await buildPlansForKind({
      api: input.api,
      kind: "tool",
      pages: input.toolPages,
      titlePropertyName: input.toolTitlePropertyName,
      projectPages,
      canonicalSupportPageIds: input.canonicalSupportPageIds,
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
  canonicalSupportPageIds: ReadonlyMap<string, string>;
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
      canonicalSupportPageIds: input.canonicalSupportPageIds,
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
  forcedNearDuplicateMerges: Array<{ kind: SupportKind; canonicalId: string; duplicateId: string }>;
}): Promise<ForcedNearDuplicateMergePlan[]> {
  const pagesByKind = {
    research: new Map(input.researchPages.map((page) => [page.id, page])),
    skill: new Map(input.skillPages.map((page) => [page.id, page])),
    tool: new Map(input.toolPages.map((page) => [page.id, page])),
  };

  const plans: ForcedNearDuplicateMergePlan[] = [];

  for (const rule of input.forcedNearDuplicateMerges) {
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
      currentCanonicalMarkdown: canonicalMarkdown.markdown.trim(),
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

export function buildSupportHygieneEffects(input: {
  plans: SupportGroupPlan[];
  lowRiskArchiveCandidates: LowRiskArchiveCandidate[];
  forcedNearDuplicateMergePlans: ForcedNearDuplicateMergePlan[];
  projectById: Map<string, DataSourcePageRef>;
  today: string;
}): NotionHygieneEffect[] {
  const effects: NotionHygieneEffect[] = [];
  const groupedPageIds = new Set(
    input.plans.flatMap((plan) => [
      plan.canonicalPage.id,
      ...plan.duplicatePages.map((page) => page.id),
    ]),
  );
  const forcedPageIds = new Set<string>();
  for (const plan of input.forcedNearDuplicateMergePlans) {
    for (const pageId of [plan.canonicalPage.id, plan.duplicatePage.id]) {
      if (groupedPageIds.has(pageId) || forcedPageIds.has(pageId)) {
        throw new AppError(
          `support merge plans overlap at page ${pageId}`,
        );
      }
      forcedPageIds.add(pageId);
    }
  }
  const replacements: Record<SupportKind, Map<string, string>> = {
    research: new Map(),
    skill: new Map(),
    tool: new Map(),
  };
  const reportedForcedMergeIds = new Set<string>();

  for (const plan of input.plans) {
    for (const duplicate of plan.duplicatePages) {
      addReplacement(
        replacements[plan.kind],
        duplicate.id,
        plan.canonicalPage.id,
      );
    }
    const properties: Record<string, unknown> = {
      [supportProjectProperty(plan.kind)]: relationValue(plan.mergedProjectIds),
    };
    if (plan.kind === "tool") {
      properties["Last Reviewed"] = datePropertyValue(input.today);
    }
    const groupEffects: NotionHygieneEffect[] = [];
    if (!matchesDesiredProperties(plan.canonicalPage.properties, properties)) {
      groupEffects.push({
        effectId: `refresh-canonical-properties:${plan.kind}:${plan.canonicalPage.id}`,
        kind: "page_properties_update",
        targetId: plan.canonicalPage.id,
        payload: { properties: compactProperties(properties) },
      });
    }
    const currentMarkdown =
      plan.duplicateMarkdowns.get(plan.canonicalPage.id)?.trim() ?? "";
    if (currentMarkdown !== plan.canonicalMarkdown.trim()) {
      groupEffects.push({
        effectId: `refresh-canonical-markdown:${plan.kind}:${plan.canonicalPage.id}`,
        kind: "page_markdown_replace",
        targetId: plan.canonicalPage.id,
        payload: { markdown: plan.canonicalMarkdown },
      });
    }
    if (groupEffects[0]) {
      groupEffects[0].payload.report = {
        kind: "canonical_refresh",
        support_kind: plan.kind,
        title: plan.title,
        merged_project_count: plan.mergedProjectIds.length,
        duplicate_count: plan.duplicatePages.length,
      };
    }
    effects.push(...groupEffects);
  }

  for (const plan of input.forcedNearDuplicateMergePlans) {
    addReplacement(
      replacements[plan.kind],
      plan.duplicatePage.id,
      plan.canonicalPage.id,
    );
    const mergedProperties = compactProperties(
      buildForcedNearDuplicateProperties({
        kind: plan.kind,
        canonicalPage: plan.canonicalPage,
        duplicatePage: plan.duplicatePage,
        mergedProjectIds: plan.mergedProjectIds,
        today: input.today,
      }),
    );
    const mergeEffects: NotionHygieneEffect[] = [];
    if (!matchesDesiredProperties(plan.canonicalPage.properties, mergedProperties)) {
      mergeEffects.push({
        effectId: `forced-merge-properties:${plan.kind}:${plan.canonicalPage.id}`,
        kind: "page_properties_update",
        targetId: plan.canonicalPage.id,
        payload: { properties: mergedProperties },
      });
    }
    if (
      plan.currentCanonicalMarkdown.trim() !== plan.canonicalMarkdown.trim()
    ) {
      mergeEffects.push({
        effectId: `forced-merge-markdown:${plan.kind}:${plan.canonicalPage.id}`,
        kind: "page_markdown_replace",
        targetId: plan.canonicalPage.id,
        payload: { markdown: plan.canonicalMarkdown },
      });
    }
    if (mergeEffects[0]) {
      reportedForcedMergeIds.add(plan.duplicatePage.id);
      mergeEffects[0].payload.report = {
        kind: "forced_merge",
        support_kind: plan.kind,
        canonical_title: plan.canonicalPage.title,
        canonical_id: plan.canonicalPage.id,
        archived_duplicate_id: plan.duplicatePage.id,
        archived_duplicate_title: plan.duplicatePage.title,
      };
    }
    effects.push(...mergeEffects);
  }

  for (const project of input.projectById.values()) {
    for (const kind of ["research", "skill", "tool"] as const) {
      const propertyName = projectRelationProperty(kind);
      const currentIds = relationIds(project.properties[propertyName]);
      const replacementMap = replacements[kind];
      const nextIds = uniqueIds(
        currentIds.map((id) => replacementMap.get(id) ?? id),
      );
      if (sameIdSet(currentIds, nextIds)) {
        continue;
      }
      effects.push({
        effectId: `rewrite-project:${kind}:${project.id}`,
        kind: "page_properties_update",
        targetId: project.id,
        payload: {
          properties: {
            [propertyName]: relationValue(nextIds),
          },
          report: {
            kind: "project_rewrite",
            project_title: project.title,
            support_kind: kind,
            title: "Consolidated support relations",
            removed_duplicate_count: currentIds.filter((id) =>
              replacementMap.has(id),
            ).length,
            canonical_ids: uniqueIds(
              currentIds
                .map((id) => replacementMap.get(id))
                .filter((id): id is string => Boolean(id)),
            ),
          },
        },
      });
    }
  }

  for (const plan of input.plans) {
    for (const duplicate of plan.duplicatePages) {
      effects.push({
        effectId: `archive-duplicate:${plan.kind}:${duplicate.id}`,
        kind: "page_archive",
        targetId: duplicate.id,
        payload: {
          in_trash: true,
          report: {
            kind: "archive_duplicate",
            support_kind: plan.kind,
            title: duplicate.title,
          },
        },
      });
    }
  }
  for (const candidate of input.lowRiskArchiveCandidates) {
    effects.push({
      effectId: `archive-low-risk:${candidate.kind}:${candidate.id}`,
      kind: "page_archive",
      targetId: candidate.id,
      payload: {
        in_trash: true,
        report: {
          kind: "archive_low_risk",
          support_kind: candidate.kind,
          title: candidate.title,
        },
      },
    });
  }
  for (const plan of input.forcedNearDuplicateMergePlans) {
    effects.push({
      effectId: `archive-forced-duplicate:${plan.kind}:${plan.duplicatePage.id}`,
      kind: "page_archive",
      targetId: plan.duplicatePage.id,
      payload: {
        in_trash: true,
        report: {
          kind: "archive_forced_duplicate",
          support_kind: plan.kind,
          title: plan.duplicatePage.title,
          forced_merge: !reportedForcedMergeIds.has(plan.duplicatePage.id),
          canonical_title: plan.canonicalPage.title,
          canonical_id: plan.canonicalPage.id,
          archived_duplicate_id: plan.duplicatePage.id,
          archived_duplicate_title: plan.duplicatePage.title,
        },
      },
    });
  }
  const archiveTargets = new Set<string>();
  for (const effect of effects.filter(
    (candidate) => candidate.kind === "page_archive",
  )) {
    if (archiveTargets.has(effect.targetId)) {
      throw new AppError(
        `support page is scheduled for archive more than once: ${effect.targetId}`,
      );
    }
    archiveTargets.add(effect.targetId);
  }
  return effects;
}

function addReplacement(
  replacements: Map<string, string>,
  duplicateId: string,
  canonicalId: string,
): void {
  const existing = replacements.get(duplicateId);
  if (existing && existing !== canonicalId) {
    throw new AppError(
      `duplicate support page maps to multiple canonical targets: ${duplicateId}`,
    );
  }
  replacements.set(duplicateId, canonicalId);
}

function compactProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
}

function propertySemanticValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value ?? null;
  }
  const property = value as {
    relation?: Array<{ id?: string }>;
    select?: { name?: string } | null;
    multi_select?: Array<{ name?: string }>;
    date?: { start?: string } | null;
    number?: number | null;
    checkbox?: boolean;
    rich_text?: Array<{
      plain_text?: string;
      text?: { content?: string };
    }>;
  };
  if ("relation" in property) {
    return uniqueIds(
      (property.relation ?? [])
        .map((entry) => entry.id ?? "")
        .filter(Boolean),
    ).sort();
  }
  if ("select" in property) return property.select?.name ?? null;
  if ("multi_select" in property) {
    return uniqueIds(
      (property.multi_select ?? [])
        .map((entry) => entry.name ?? "")
        .filter(Boolean),
    ).sort();
  }
  if ("date" in property) return property.date?.start ?? null;
  if ("number" in property) return property.number ?? null;
  if ("checkbox" in property) return property.checkbox ?? false;
  if ("rich_text" in property) {
    return (property.rich_text ?? [])
      .map((entry) => entry.plain_text ?? entry.text?.content ?? "")
      .join("");
  }
  return value;
}

function desiredPropertyReadback(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      propertySemanticValue(value),
    ]),
  );
}

function matchesDesiredProperties(
  actual: Record<string, unknown>,
  desired: Record<string, unknown>,
): boolean {
  const actualSubset = Object.fromEntries(
    Object.keys(desired).map((name) => [
      name,
      propertySemanticValue(actual[name]),
    ]),
  );
  return (
    canonicalJson(actualSubset) ===
    canonicalJson(desiredPropertyReadback(desired))
  );
}

export async function performSupportHygieneEffect(input: {
  effect: NotionHygieneEffect;
  api: DirectNotionClient;
}): Promise<string> {
  if (input.effect.kind === "page_archive") {
    await input.api.archivePage(input.effect.targetId);
  } else if (input.effect.kind === "page_properties_update") {
    await input.api.updatePageProperties({
      pageId: input.effect.targetId,
      properties: input.effect.payload.properties as Record<string, unknown>,
    });
  } else if (input.effect.kind === "page_markdown_replace") {
    await input.api.patchPageMarkdown({
      pageId: input.effect.targetId,
      command: "replace_content",
      newMarkdown: String(input.effect.payload.markdown),
    });
  } else {
    throw new AppError("support hygiene cannot execute local file effects");
  }
  return `notion:page:${input.effect.targetId}`;
}

export async function readbackSupportHygieneEffect(input: {
  effect: NotionHygieneEffect;
  api: DirectNotionClient;
  sdk: ReturnType<typeof createNotionSdkClient>;
}): Promise<NotionHygieneEffectReadback> {
  let verified = false;
  let details: Record<string, unknown> = {};
  if (input.effect.kind === "page_archive") {
    const page = (await input.sdk.pages.retrieve({
      page_id: input.effect.targetId,
    })) as unknown as Record<string, unknown>;
    verified = page.in_trash === true || page.archived === true;
    details = {
      in_trash: page.in_trash ?? null,
      archived: page.archived ?? null,
    };
  } else if (input.effect.kind === "page_properties_update") {
    const page = (await input.sdk.pages.retrieve({
      page_id: input.effect.targetId,
    })) as unknown as { properties?: Record<string, unknown> };
    const desired = input.effect.payload.properties as Record<string, unknown>;
    verified = matchesDesiredProperties(page.properties ?? {}, desired);
    details = {
      expected: desiredPropertyReadback(desired),
      actual: desiredPropertyReadback(
        Object.fromEntries(
          Object.keys(desired).map((name) => [
            name,
            page.properties?.[name],
          ]),
        ),
      ),
    };
  } else if (input.effect.kind === "page_markdown_replace") {
    const markdown = await input.api.readPageMarkdown(input.effect.targetId);
    verified =
      !markdown.truncated &&
      markdown.markdown.trim() === String(input.effect.payload.markdown).trim();
    details = {
      truncated: markdown.truncated,
      markdown_digest: sha256Json(markdown.markdown.trim()),
    };
  }
  return {
    effect_id: input.effect.effectId,
    target_id: input.effect.targetId,
    provider_reference: `notion:page:${input.effect.targetId}`,
    verified,
    details,
  };
}

function recordAppliedSupportEffect(input: {
  effect: NotionHygieneEffect;
  archivedPages: Array<{ kind: SupportKind; title: string; id: string }>;
  archivedLowRiskPages: Array<{ kind: SupportKind; title: string; id: string }>;
  archivedForcedNearDuplicatePages: Array<{ kind: SupportKind; title: string; id: string }>;
  rewrittenProjects: Array<{
    projectTitle: string;
    kind: SupportKind;
    title: string;
    removedDuplicateCount: number;
    canonicalId: string;
  }>;
  mergedNearDuplicateRows: Array<{
    kind: SupportKind;
    canonicalTitle: string;
    canonicalId: string;
    archivedDuplicateId: string;
    archivedDuplicateTitle: string;
  }>;
  canonicalRefreshes: Array<{
    kind: SupportKind;
    title: string;
    id: string;
    mergedProjectCount: number;
    duplicateCount: number;
  }>;
}): void {
  const report = input.effect.payload.report as
    | Record<string, unknown>
    | undefined;
  if (!report) return;
  const kind = report.support_kind as SupportKind;
  if (report.kind === "canonical_refresh") {
    input.canonicalRefreshes.push({
      kind,
      title: String(report.title),
      id: input.effect.targetId,
      mergedProjectCount: Number(report.merged_project_count),
      duplicateCount: Number(report.duplicate_count),
    });
  } else if (report.kind === "project_rewrite") {
    const canonicalIds = report.canonical_ids as string[];
    input.rewrittenProjects.push({
      projectTitle: String(report.project_title),
      kind,
      title: String(report.title),
      removedDuplicateCount: Number(report.removed_duplicate_count),
      canonicalId: canonicalIds.join(","),
    });
  } else if (report.kind === "archive_duplicate") {
    input.archivedPages.push({
      kind,
      title: String(report.title),
      id: input.effect.targetId,
    });
  } else if (report.kind === "archive_low_risk") {
    input.archivedLowRiskPages.push({
      kind,
      title: String(report.title),
      id: input.effect.targetId,
    });
  } else if (report.kind === "forced_merge") {
    input.mergedNearDuplicateRows.push({
      kind,
      canonicalTitle: String(report.canonical_title),
      canonicalId: String(report.canonical_id),
      archivedDuplicateId: String(report.archived_duplicate_id),
      archivedDuplicateTitle: String(report.archived_duplicate_title),
    });
  } else if (report.kind === "archive_forced_duplicate") {
    input.archivedForcedNearDuplicatePages.push({
      kind,
      title: String(report.title),
      id: input.effect.targetId,
    });
    if (report.forced_merge === true) {
      input.mergedNearDuplicateRows.push({
        kind,
        canonicalTitle: String(report.canonical_title),
        canonicalId: String(report.canonical_id),
        archivedDuplicateId: String(report.archived_duplicate_id),
        archivedDuplicateTitle: String(report.archived_duplicate_title),
      });
    }
  }
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
  canonicalSupportPageIds: ReadonlyMap<string, string>;
}): DataSourcePageRef {
  const canonicalId = input.canonicalSupportPageIds.get(`${input.kind}:${normalizeKey(input.pages[0]?.title ?? "")}`);
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
