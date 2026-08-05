import "../../config/load-default-env.js";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../../cli/context.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import {
  maybeNormalizeNotionId,
  normalizeNotionId,
} from "../../utils/notion-id.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import {
  DirectNotionClient,
  type DirectNotionPageState,
} from "../../notion/direct-notion-client.js";
import { WorkspaceIds } from "../../config/workspace-ids.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  datePropertyValue,
  fetchAllPages,
  hydrateCompleteRelationProperties,
  relationIds,
  relationValue,
  richTextValue,
  type DataSourcePageRef,
  type NotionPageProperty,
} from "../../notion/local-portfolio-control-tower-live.js";
import {
  canonicalJson,
  claimEnvelope,
  createClaimedActionFailureRecorder,
  emitReceipt,
  loadEnvelope,
  planDigest,
  sourceRevision,
  validateEnvelope,
  type IrreversibleActionEnvelopeV1,
} from "./irreversible-action.js";

const TODAY = losAngelesToday();

export interface SupportDatabaseHygieneFlags {
  live: boolean;
  today: string;
  config: string;
  approval?: string;
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
  precondition: HygieneArchivePrecondition;
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
  canonicalOriginalMarkdown: string;
  canonicalMarkdown: string;
  duplicateOriginalMarkdown: string;
  mergedProjectIds: string[];
  projectIdsNeedingRewrite: string[];
}

export type HygieneEffect =
  | {
      kind: "update_properties";
      page_id: string;
      properties: Record<string, unknown>;
      relation_preconditions?: Record<string, string[]>;
      property_preconditions?: Record<string, unknown>;
    }
  | {
      kind: "patch_markdown";
      page_id: string;
      markdown: string;
      expected_markdown_digest: string;
    }
  | {
      kind: "archive_page";
      page_id: string;
    };

export interface HygieneRequiredPageState {
  page_id: string;
  properties?: Record<string, unknown>;
  markdown?: string;
}

export interface HygieneArchivePrecondition {
  page_id: string;
  parent_data_source_id: string;
  last_edited_time: string;
  state_digest: string;
}

export interface SupportDatabaseHygieneApprovalPlan {
  operation: "notion.support_database_hygiene";
  today: string;
  data_source_ids: string[];
  target_page_ids: string[];
  archive_page_ids: string[];
  effect_count: number;
  pre_archive_effects: HygieneEffect[];
  archive_effects: HygieneEffect[];
  required_pages: HygieneRequiredPageState[];
  archive_preconditions: HygieneArchivePrecondition[];
}

export interface HygieneReadbackResult {
  ok: boolean;
  checks: {
    archive_ids_absent: boolean;
    canonical_properties_exact: boolean;
    canonical_markdown_exact: boolean;
    project_relations_exact: boolean;
    duplicate_relations_absent?: boolean;
  };
}

function parseFlags(argv: string[]): SupportDatabaseHygieneFlags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let approval: string | undefined;

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
    if (current === "--approval") {
      approval = argv[index + 1];
      index += 1;
    }
  }

  return { live, today, config, approval };
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
            { flag: "--live", description: "Apply the approved hygiene actions live." },
            { flag: "--today <date>", description: "Override the date anchor in YYYY-MM-DD format." },
            { flag: "--config <path>", description: "Path to the control-tower config file." },
            {
              flag: "--approval <path>",
              description: "Exact IrreversibleActionEnvelopeV1 required with --live.",
            },
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

  const [projectSchema, researchSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
  ]);
  const [skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPages] = await Promise.all([
    fetchCompleteHygienePages(
      api,
      config.database.dataSourceId,
      projectSchema.titlePropertyName,
    ),
    fetchCompleteHygienePages(
      api,
      config.relatedDataSources.researchId,
      researchSchema.titlePropertyName,
    ),
  ]);
  const [skillPages, toolPages] = await Promise.all([
    fetchCompleteHygienePages(
      api,
      config.relatedDataSources.skillsId,
      skillSchema.titlePropertyName,
    ),
    fetchCompleteHygienePages(
      api,
      config.relatedDataSources.toolsId,
      toolSchema.titlePropertyName,
    ),
  ]);
  const dataSourceIdByKind: Record<SupportKind, string> = {
    research: config.relatedDataSources.researchId,
    skill: config.relatedDataSources.skillsId,
    tool: config.relatedDataSources.toolsId,
  };

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
  const lowRiskArchiveCandidates = await buildLowRiskArchiveCandidates({
    api,
    pages: [
      ...researchPages.map((page) => ({ kind: "research" as const, page })),
      ...skillPages.map((page) => ({ kind: "skill" as const, page })),
      ...toolPages.map((page) => ({ kind: "tool" as const, page })),
    ],
    dataSourceIdByKind,
  }).then((candidates) =>
    candidates.filter((candidate) => !duplicatePageIds.has(candidate.id)),
  );
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
  const approvalPlan = supportDatabaseHygienePlan({
    today: flags.today,
    dataSourceIds: [
      config.database.dataSourceId,
      config.relatedDataSources.researchId,
      config.relatedDataSources.skillsId,
      config.relatedDataSources.toolsId,
    ],
    projectPages,
    plans,
    lowRiskArchiveCandidates,
    forcedNearDuplicateMergePlans,
    dataSourceIdByKind,
  });
  let envelope: IrreversibleActionEnvelopeV1 | undefined;
  if (flags.live) {
    if (!flags.approval) {
      throw new AppError(
        "--live requires --approval <IrreversibleActionEnvelopeV1.json>",
      );
    }
    envelope = loadEnvelope(flags.approval);
    validateEnvelope({
      envelope,
      actionKind: "notion.support_database_hygiene",
      canonicalTargets: {
        data_source_ids: approvalPlan.data_source_ids,
        page_ids: approvalPlan.target_page_ids,
      },
      sourceRevision: sourceRevision(),
      plan: approvalPlan,
      effectCount: approvalPlan.effect_count,
      deletionCount: approvalPlan.archive_page_ids.length,
      requiredReadback: [
        "archive_ids_absent",
        "canonical_properties_exact",
        "canonical_markdown_exact",
        "project_relations_exact",
        "duplicate_relations_absent",
        "archive_preconditions_matched",
        "relation_properties_complete",
      ],
    });
    claimEnvelope(envelope);
  }

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

  const unresolvedNearDuplicateCandidates = nearDuplicateCandidates.filter(
    (candidate) =>
      !forcedNearDuplicateMergePlans.some(
        (plan) =>
          plan.kind === candidate.kind &&
          ((plan.canonicalPage.id === candidate.leftId && plan.duplicatePage.id === candidate.rightId) ||
            (plan.canonicalPage.id === candidate.rightId && plan.duplicatePage.id === candidate.leftId)),
      ),
  );

  let liveReadback: Record<string, unknown> | undefined;
  if (flags.live) {
    const failure = createClaimedActionFailureRecorder({
      envelope: envelope!,
      target: {
        data_source_ids: approvalPlan.data_source_ids,
        page_ids: approvalPlan.target_page_ids,
      },
      providerReference: `notion:hygiene:${envelope!.provider_idempotency_key}`,
    });
    const finalReadback = await executeSupportDatabaseHygieneEffects({
      plan: approvalPlan,
      applyEffect: async (effect) => {
        failure.markEffectAttempted();
        await applyHygieneEffect(api, effect);
      },
      verifyPreArchiveEffect: (effect) =>
        assertHygieneEffectPrecondition({ api, effect }),
      verifyState: (requireArchivesAbsent) =>
        readAndVerifySupportDatabaseHygieneState({
          api,
          plan: approvalPlan,
          requireArchivesAbsent,
          sources: [
            {
              id: config.database.dataSourceId,
              titlePropertyName: projectSchema.titlePropertyName,
            },
            {
              id: config.relatedDataSources.researchId,
              titlePropertyName: researchSchema.titlePropertyName,
            },
            {
              id: config.relatedDataSources.skillsId,
              titlePropertyName: skillSchema.titlePropertyName,
            },
            {
              id: config.relatedDataSources.toolsId,
              titlePropertyName: toolSchema.titlePropertyName,
            },
          ],
        }),
      verifyArchivePrecondition: (effect) =>
        assertHygieneArchivePrecondition({
          api,
          plan: approvalPlan,
          effect,
        }),
    }).catch((error: unknown) =>
      failure.fail(error, "hygiene_effect_or_readback"),
    );
    liveReadback = {
      ...finalReadback.checks,
      archive_preconditions_matched: true,
      relation_properties_complete: true,
      effect_count: approvalPlan.effect_count,
      verified_page_ids: approvalPlan.required_pages
        .map((page) => page.page_id)
        .sort(),
    };

    for (const plan of plans) {
      canonicalRefreshes.push({
        kind: plan.kind,
        title: plan.title,
        id: plan.canonicalPage.id,
        mergedProjectCount: plan.mergedProjectIds.length,
        duplicateCount: plan.duplicatePages.length,
      });
      const duplicateIds = new Set(plan.duplicatePages.map((page) => page.id));
      for (const projectId of plan.projectIdsNeedingRewrite) {
        const projectPage = projectById.get(projectId);
        if (!projectPage) {
          continue;
        }
        rewrittenProjects.push({
          projectTitle: projectPage.title,
          kind: plan.kind,
          title: plan.title,
          removedDuplicateCount: relationIds(
            projectPage.properties[projectRelationProperty(plan.kind)],
          ).filter((id) => duplicateIds.has(id)).length,
          canonicalId: plan.canonicalPage.id,
        });
      }
      archivedPages.push(
        ...plan.duplicatePages.map((page) => ({
          kind: plan.kind,
          title: page.title,
          id: page.id,
        })),
      );
    }
    archivedLowRiskPages.push(
      ...lowRiskArchiveCandidates.map((candidate) => ({
        kind: candidate.kind,
        title: candidate.title,
        id: candidate.id,
      })),
    );
    for (const plan of forcedNearDuplicateMergePlans) {
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

    emitReceipt({
      envelope: envelope!,
      target: {
        data_source_ids: approvalPlan.data_source_ids,
        page_ids: approvalPlan.target_page_ids,
      },
      providerReference: `notion:hygiene:${envelope!.provider_idempotency_key}`,
      readbackResult: liveReadback,
      terminalOutcome: "succeeded",
    });
  }

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
    approvalPlan,
    liveReadback,
  };
}

export function supportDatabaseHygienePlan(input: {
  today: string;
  dataSourceIds: string[];
  projectPages: DataSourcePageRef[];
  plans: SupportGroupPlan[];
  lowRiskArchiveCandidates: LowRiskArchiveCandidate[];
  forcedNearDuplicateMergePlans: ForcedNearDuplicateMergePlan[];
  dataSourceIdByKind: Record<SupportKind, string>;
}): SupportDatabaseHygieneApprovalPlan {
  const pageById = new Map(
    [
      ...input.projectPages,
      ...input.plans.flatMap((plan) => [
        plan.canonicalPage,
        ...plan.duplicatePages,
      ]),
      ...input.forcedNearDuplicateMergePlans.flatMap((plan) => [
        plan.canonicalPage,
        plan.duplicatePage,
      ]),
    ].map((page) => [page.id, page]),
  );
  const relationState = new Map<string, string[]>();
  const propertyState = new Map<string, unknown>();
  const preArchiveEffects: HygieneEffect[] = [];
  const archivePageIds = new Set<string>();
  const archivePreconditions = new Map<string, HygieneArchivePrecondition>();
  const requiredMarkdown = new Map<string, string>();
  const markdownState = new Map<string, string>();

  const addArchiveTarget = (
    page: DataSourcePageRef,
    kind: SupportKind,
    markdown: string,
  ): void => {
    const precondition = hygieneArchivePrecondition({
      page,
      parentDataSourceId: input.dataSourceIdByKind[kind],
      markdown,
    });
    archivePageIds.add(page.id);
    archivePreconditions.set(page.id, precondition);
  };

  const addPropertiesEffect = (
    pageId: string,
    properties: Record<string, unknown>,
  ): void => {
    const page = pageById.get(pageId);
    if (!page) {
      throw new AppError(
        `Approved hygiene property target ${pageId} is missing from the rendered plan state`,
      );
    }
    const relationPreconditions: Record<string, string[]> = {};
    const propertyPreconditions: Record<string, unknown> = {};
    for (const [propertyName, value] of Object.entries(properties)) {
      const requested = value as NotionPageProperty | undefined;
      const stateKey = `${pageId}:${propertyName}`;
      if (Array.isArray(requested?.relation)) {
        const currentIds =
          relationState.get(stateKey) ??
          relationIds(page.properties[propertyName]);
        relationPreconditions[propertyName] = [...currentIds].sort();
        relationState.set(
          stateKey,
          requested.relation.map((entry) => normalizeNotionId(entry.id)),
        );
      } else {
        const currentValue = propertyState.has(stateKey)
          ? propertyState.get(stateKey)
          : propertySemanticValue(page.properties[propertyName] ?? null);
        propertyPreconditions[propertyName] = currentValue ?? null;
        propertyState.set(stateKey, propertySemanticValue(requested ?? null));
      }
    }
    preArchiveEffects.push({
      kind: "update_properties",
      page_id: pageId,
      properties: serializableRecord(properties),
      ...(Object.keys(relationPreconditions).length > 0
        ? { relation_preconditions: relationPreconditions }
        : {}),
      ...(Object.keys(propertyPreconditions).length > 0
        ? { property_preconditions: propertyPreconditions }
        : {}),
    });
  };

  const addMarkdownEffect = (
    pageId: string,
    observedMarkdown: string,
    replacementMarkdown: string,
  ): void => {
    const currentMarkdown = markdownState.get(pageId) ?? observedMarkdown;
    if (normalizeMarkdown(currentMarkdown) === normalizeMarkdown(replacementMarkdown)) {
      return;
    }
    preArchiveEffects.push({
      kind: "patch_markdown",
      page_id: pageId,
      markdown: replacementMarkdown,
      expected_markdown_digest: planDigest(currentMarkdown),
    });
    markdownState.set(pageId, replacementMarkdown);
  };

  const addProjectRewrite = (input: {
    projectId: string;
    propertyName: string;
    duplicateIds: Set<string>;
    canonicalId: string;
  }): void => {
    const projectPage = pageById.get(input.projectId);
    if (!projectPage) {
      throw new AppError(
        `Approved hygiene project target ${input.projectId} is missing from the rendered plan state`,
      );
    }
    const stateKey = `${input.projectId}:${input.propertyName}`;
    const currentIds =
      relationState.get(stateKey) ??
      relationIds(projectPage.properties[input.propertyName]);
    const nextIds = uniqueIds([
      ...currentIds.filter((id) => !input.duplicateIds.has(id)),
      input.canonicalId,
    ]);
    if (!sameIdSet(currentIds, nextIds)) {
      addPropertiesEffect(input.projectId, {
        [input.propertyName]: relationValue(nextIds),
      });
    }
  };

  for (const plan of input.plans) {
    const properties: Record<string, unknown> = {
      [supportProjectProperty(plan.kind)]: relationValue(plan.mergedProjectIds),
    };
    if (plan.kind === "tool") {
      properties["Last Reviewed"] = datePropertyValue(input.today);
    }
    addPropertiesEffect(plan.canonicalPage.id, properties);
    requiredMarkdown.set(plan.canonicalPage.id, plan.canonicalMarkdown.trim());
    addMarkdownEffect(
      plan.canonicalPage.id,
      plan.duplicateMarkdowns.get(plan.canonicalPage.id) ?? "",
      plan.canonicalMarkdown,
    );

    const duplicateIds = new Set(plan.duplicatePages.map((page) => page.id));
    for (const projectId of plan.projectIdsNeedingRewrite) {
      addProjectRewrite({
        projectId,
        propertyName: projectRelationProperty(plan.kind),
        duplicateIds,
        canonicalId: plan.canonicalPage.id,
      });
    }
    for (const duplicatePage of plan.duplicatePages) {
      addArchiveTarget(
        duplicatePage,
        plan.kind,
        plan.duplicateMarkdowns.get(duplicatePage.id) ?? "",
      );
    }
  }

  for (const plan of input.forcedNearDuplicateMergePlans) {
    addPropertiesEffect(
      plan.canonicalPage.id,
      buildForcedNearDuplicateProperties({
        kind: plan.kind,
        canonicalPage: plan.canonicalPage,
        duplicatePage: plan.duplicatePage,
        mergedProjectIds: plan.mergedProjectIds,
        today: input.today,
      }),
    );
    requiredMarkdown.set(plan.canonicalPage.id, plan.canonicalMarkdown.trim());
    addMarkdownEffect(
      plan.canonicalPage.id,
      plan.canonicalOriginalMarkdown,
      plan.canonicalMarkdown,
    );
    for (const projectId of plan.projectIdsNeedingRewrite) {
      addProjectRewrite({
        projectId,
        propertyName: projectRelationProperty(plan.kind),
        duplicateIds: new Set([plan.duplicatePage.id]),
        canonicalId: plan.canonicalPage.id,
      });
    }
    addArchiveTarget(
      plan.duplicatePage,
      plan.kind,
      plan.duplicateOriginalMarkdown,
    );
  }

  for (const candidate of input.lowRiskArchiveCandidates) {
    if (
      !candidate.precondition ||
      candidate.precondition.page_id !== candidate.id
    ) {
      throw new AppError(
        `Archive target ${candidate.id} has no approved provider prestate`,
      );
    }
    archivePageIds.add(candidate.id);
    archivePreconditions.set(candidate.id, candidate.precondition);
  }

  const archiveEffects: HygieneEffect[] = [...archivePageIds]
    .sort()
    .map((pageId) => ({ kind: "archive_page", page_id: pageId }));
  if (
    archivePreconditions.size !== archiveEffects.length ||
    archiveEffects.some(
      (effect) =>
        effect.kind !== "archive_page" ||
        !archivePreconditions.has(effect.page_id),
    )
  ) {
    throw new AppError(
      "Every Notion hygiene archive target must have an approved provider prestate",
    );
  }
  const requiredPagesById = new Map<string, HygieneRequiredPageState>();
  for (const effect of preArchiveEffects) {
    if (effect.kind !== "update_properties") {
      continue;
    }
    const existing = requiredPagesById.get(effect.page_id) ?? {
      page_id: effect.page_id,
    };
    requiredPagesById.set(effect.page_id, {
      ...existing,
      properties: {
        ...(existing.properties ?? {}),
        ...effect.properties,
      },
    });
  }
  for (const [pageId, markdown] of requiredMarkdown) {
    const existing = requiredPagesById.get(pageId) ?? { page_id: pageId };
    requiredPagesById.set(pageId, { ...existing, markdown });
  }

  const targetPageIds = [
    ...new Set([
      ...preArchiveEffects.map((effect) => effect.page_id),
      ...archiveEffects.map((effect) => effect.page_id),
    ]),
  ].sort();
  return {
    operation: "notion.support_database_hygiene",
    today: input.today,
    data_source_ids: [...input.dataSourceIds].sort(),
    target_page_ids: targetPageIds,
    archive_page_ids: archiveEffects.map((effect) => effect.page_id),
    effect_count: preArchiveEffects.length + archiveEffects.length,
    pre_archive_effects: preArchiveEffects,
    archive_effects: archiveEffects,
    required_pages: [...requiredPagesById.values()].sort((left, right) =>
      left.page_id.localeCompare(right.page_id),
    ),
    archive_preconditions: [...archivePreconditions.values()].sort(
      (left, right) => left.page_id.localeCompare(right.page_id),
    ),
  };
}

function serializableRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}

export function hygieneArchivePrecondition(input: {
  page: DataSourcePageRef;
  parentDataSourceId: string;
  markdown: string;
}): HygieneArchivePrecondition {
  if (!input.page.lastEditedTime) {
    throw new AppError(
      `Archive target ${input.page.id} has no provider last-edited marker`,
    );
  }
  const parentDataSourceId =
    maybeNormalizeNotionId(input.parentDataSourceId) ??
    input.parentDataSourceId.trim();
  if (!parentDataSourceId) {
    throw new AppError(
      `Archive target ${input.page.id} has no parent data-source identity`,
    );
  }
  return {
    page_id: input.page.id,
    parent_data_source_id: parentDataSourceId,
    last_edited_time: input.page.lastEditedTime,
    state_digest: planDigest({
      page_id: input.page.id,
      parent_data_source_id: parentDataSourceId,
      last_edited_time: input.page.lastEditedTime,
      title: input.page.title,
      properties: Object.fromEntries(
        Object.entries(input.page.properties).map(([name, property]) => [
          name,
          propertySemanticValue(property),
        ]),
      ),
      markdown: normalizeMarkdown(input.markdown),
    }),
  };
}

interface HygieneArchiveReadApi {
  retrievePageState(pageId: string): Promise<DirectNotionPageState>;
  retrievePagePropertyItems(input: {
    pageId: string;
    propertyId: string;
    startCursor?: string;
  }): Promise<{
    relationIds: string[];
    hasMore: boolean;
    nextCursor?: string;
  }>;
  readPageMarkdown(pageId: string): ReturnType<
    DirectNotionClient["readPageMarkdown"]
  >;
}

export async function assertHygieneArchivePrecondition(input: {
  api: HygieneArchiveReadApi;
  plan: SupportDatabaseHygieneApprovalPlan;
  effect: Extract<HygieneEffect, { kind: "archive_page" }>;
}): Promise<void> {
  const expected = input.plan.archive_preconditions.find(
    (precondition) => precondition.page_id === input.effect.page_id,
  );
  if (!expected) {
    throw new AppError(
      `Archive target ${input.effect.page_id} has no approved provider prestate`,
    );
  }
  const providerPage = await input.api.retrievePageState(input.effect.page_id);
  const [page] = await hydrateCompleteRelationProperties(input.api, [
    dataSourcePageFromProviderState(providerPage),
  ]);
  if (!page) {
    throw new AppError(
      `Archive target ${input.effect.page_id} could not be read back`,
    );
  }
  const markdown = await input.api.readPageMarkdown(input.effect.page_id);
  requireCompleteMarkdownReadback(input.effect.page_id, markdown);
  const observed = hygieneArchivePrecondition({
    page,
    parentDataSourceId: providerPage.parentDataSourceId ?? "",
    markdown: markdown.markdown,
  });
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new AppError(
      `Archive target ${input.effect.page_id} changed after approval`,
    );
  }
}

export async function assertHygieneEffectPrecondition(input: {
  api: HygieneArchiveReadApi;
  effect: HygieneEffect;
}): Promise<void> {
  if (input.effect.kind === "patch_markdown") {
    const markdown = await input.api.readPageMarkdown(input.effect.page_id);
    requireCompleteMarkdownReadback(input.effect.page_id, markdown);
    if (planDigest(markdown.markdown) !== input.effect.expected_markdown_digest) {
      throw new AppError(
        `Markdown ${input.effect.page_id} changed after approval`,
      );
    }
    return;
  }
  if (
    input.effect.kind !== "update_properties" ||
    (!input.effect.relation_preconditions && !input.effect.property_preconditions)
  ) {
    return;
  }
  const providerPage = await input.api.retrievePageState(input.effect.page_id);
  const [page] = await hydrateCompleteRelationProperties(input.api, [
    dataSourcePageFromProviderState(providerPage),
  ]);
  if (!page) {
    throw new AppError(
      `Property target ${input.effect.page_id} could not be read back`,
    );
  }
  for (const [propertyName, expectedIds] of Object.entries(
    input.effect.relation_preconditions ?? {},
  )) {
    const observedIds = relationIds(page.properties[propertyName]).sort();
    if (canonicalJson(observedIds) !== canonicalJson([...expectedIds].sort())) {
      throw new AppError(
        `Relation ${input.effect.page_id}:${propertyName} changed after approval`,
      );
    }
  }
  for (const [propertyName, expectedValue] of Object.entries(
    input.effect.property_preconditions ?? {},
  )) {
    const observedValue = propertySemanticValue(
      page.properties[propertyName] ?? null,
    );
    if (canonicalJson(observedValue) !== canonicalJson(expectedValue)) {
      throw new AppError(
        `Property ${input.effect.page_id}:${propertyName} changed after approval`,
      );
    }
  }
}

function dataSourcePageFromProviderState(
  page: DirectNotionPageState,
): DataSourcePageRef {
  return {
    id: page.id,
    url: page.url,
    title: page.title ?? "",
    lastEditedTime: page.lastEditedTime,
    properties: page.properties as Record<string, NotionPageProperty>,
  };
}

function requireCompleteMarkdownReadback(
  pageId: string,
  readback: {
    truncated: boolean;
    unknownBlockIds: string[];
  },
): void {
  if (readback.truncated || readback.unknownBlockIds.length > 0) {
    throw new AppError(
      `Notion hygiene markdown readback for ${pageId} is incomplete`,
    );
  }
}

export function verifySupportDatabaseHygieneState(input: {
  plan: SupportDatabaseHygieneApprovalPlan;
  visiblePages: DataSourcePageRef[];
  markdownByPageId: Map<string, string>;
  requireArchivesAbsent: boolean;
}): HygieneReadbackResult {
  const pageById = new Map(input.visiblePages.map((page) => [page.id, page]));
  const projectRelationNames = new Set([
    "Related Research",
    "Supporting Skills",
    "Tool Stack Records",
  ]);
  let canonicalPropertiesExact = true;
  let projectRelationsExact = true;
  let canonicalMarkdownExact = true;

  for (const expectedPage of input.plan.required_pages) {
    const observedPage = pageById.get(expectedPage.page_id);
    for (const [propertyName, expected] of Object.entries(
      expectedPage.properties ?? {},
    )) {
      const matches =
        observedPage !== undefined &&
        canonicalJson(propertySemanticValue(observedPage.properties[propertyName])) ===
          canonicalJson(propertySemanticValue(expected));
      if (projectRelationNames.has(propertyName)) {
        projectRelationsExact &&= matches;
      } else {
        canonicalPropertiesExact &&= matches;
      }
    }
    if (
      expectedPage.markdown !== undefined &&
      normalizeMarkdown(input.markdownByPageId.get(expectedPage.page_id) ?? "") !==
        normalizeMarkdown(expectedPage.markdown)
    ) {
      canonicalMarkdownExact = false;
    }
  }

  const archivedIds = new Set(input.plan.archive_page_ids);
  const archiveIdsAbsent =
    !input.requireArchivesAbsent ||
    input.plan.archive_page_ids.every((pageId) => !pageById.has(pageId));
  const duplicateRelationsAbsent = input.visiblePages.every((page) =>
    Object.values(page.properties).every((property) =>
      (property.relation ?? []).every((relation) => !archivedIds.has(relation.id)),
    ),
  );
  const checks = {
    archive_ids_absent: archiveIdsAbsent,
    canonical_properties_exact: canonicalPropertiesExact,
    canonical_markdown_exact: canonicalMarkdownExact,
    project_relations_exact: projectRelationsExact,
    duplicate_relations_absent: duplicateRelationsAbsent,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}

export async function executeSupportDatabaseHygieneEffects(input: {
  plan: SupportDatabaseHygieneApprovalPlan;
  applyEffect: (effect: HygieneEffect) => Promise<void>;
  verifyPreArchiveEffect: (effect: HygieneEffect) => Promise<void>;
  verifyArchivePrecondition: (
    effect: Extract<HygieneEffect, { kind: "archive_page" }>,
  ) => Promise<void>;
  verifyState: (
    requireArchivesAbsent: boolean,
  ) => Promise<HygieneReadbackResult>;
}): Promise<HygieneReadbackResult> {
  for (const effect of input.plan.pre_archive_effects) {
    await input.verifyPreArchiveEffect(effect);
    await input.applyEffect(effect);
  }
  const preArchive = await input.verifyState(false);
  if (!preArchive.ok) {
    throw new AppError(
      "Notion hygiene pre-archive readback did not prove the approved canonical state",
    );
  }
  for (const effect of input.plan.archive_effects) {
    if (effect.kind !== "archive_page") {
      throw new AppError("Notion hygiene archive phase contains a non-archive effect");
    }
    await input.verifyArchivePrecondition(effect);
    await input.applyEffect(effect);
  }
  const finalReadback = await input.verifyState(true);
  if (!finalReadback.ok) {
    throw new AppError(
      "Notion hygiene post-archive readback did not prove the approved terminal state",
    );
  }
  return finalReadback;
}

async function applyHygieneEffect(
  api: DirectNotionClient,
  effect: HygieneEffect,
): Promise<void> {
  switch (effect.kind) {
    case "update_properties":
      await api.updatePageProperties({
        pageId: effect.page_id,
        properties: effect.properties,
      });
      return;
    case "patch_markdown":
      await api.patchPageMarkdown({
        pageId: effect.page_id,
        command: "replace_content",
        newMarkdown: effect.markdown,
      });
      return;
    case "archive_page":
      await api.archivePage(effect.page_id);
  }
}

async function readAndVerifySupportDatabaseHygieneState(input: {
  api: DirectNotionClient;
  plan: SupportDatabaseHygieneApprovalPlan;
  requireArchivesAbsent: boolean;
  sources: Array<{ id: string; titlePropertyName: string }>;
}): Promise<HygieneReadbackResult> {
  const pageGroups = await Promise.all(
    input.sources.map((source) =>
      fetchCompleteHygienePages(
        input.api,
        source.id,
        source.titlePropertyName,
      ),
    ),
  );
  const markdownByPageId = new Map<string, string>();
  for (const expected of input.plan.required_pages) {
    if (expected.markdown === undefined) {
      continue;
    }
    const readback = await input.api.readPageMarkdown(expected.page_id);
    requireCompleteMarkdownReadback(expected.page_id, readback);
    markdownByPageId.set(expected.page_id, readback.markdown);
  }
  return verifySupportDatabaseHygieneState({
    plan: input.plan,
    visiblePages: pageGroups.flat(),
    markdownByPageId,
    requireArchivesAbsent: input.requireArchivesAbsent,
  });
}

async function fetchCompleteHygienePages(
  api: DirectNotionClient,
  dataSourceId: string,
  titlePropertyName: string,
): Promise<DataSourcePageRef[]> {
  return hydrateCompleteRelationProperties(
    api,
    await fetchAllPages(api, dataSourceId, titlePropertyName),
  );
}

function propertySemanticValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const property = value as NotionPageProperty & Record<string, unknown>;
  if (Array.isArray(property.relation)) {
    return {
      relation: property.relation
        .map((entry) => normalizeNotionId(entry.id))
        .sort(),
    };
  }
  if ("date" in property) {
    return { date: property.date?.start ?? null };
  }
  if ("select" in property) {
    return { select: property.select?.name ?? null };
  }
  if (Array.isArray(property.multi_select)) {
    return {
      multi_select: property.multi_select
        .map((entry) => entry.name ?? "")
        .filter(Boolean)
        .sort(),
    };
  }
  if ("number" in property) {
    return { number: property.number ?? null };
  }
  if (Array.isArray(property.rich_text)) {
    return {
      rich_text: property.rich_text
        .map((entry) => {
          const requestEntry = entry as typeof entry & {
            text?: { content?: string };
          };
          return requestEntry.plain_text ?? requestEntry.text?.content ?? "";
        })
        .join(""),
    };
  }
  if ("checkbox" in property) {
    return { checkbox: Boolean(property.checkbox) };
  }
  return JSON.parse(canonicalJson(value)) as unknown;
}

function normalizeMarkdown(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
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
      requireCompleteMarkdownReadback(page.id, markdown);
      markdownByPageId.set(page.id, markdown.markdown);
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
    requireCompleteMarkdownReadback(canonicalPage.id, canonicalMarkdown);
    requireCompleteMarkdownReadback(duplicatePage.id, duplicateMarkdown);
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
      canonicalOriginalMarkdown: canonicalMarkdown.markdown,
      canonicalMarkdown: mergeNearDuplicateMarkdown({
        kind: rule.kind,
        canonicalTitle: canonicalPage.title,
        canonicalMarkdown: canonicalMarkdown.markdown,
        duplicateMarkdown: duplicateMarkdown.markdown,
      }),
      duplicateOriginalMarkdown: duplicateMarkdown.markdown,
      mergedProjectIds,
      projectIdsNeedingRewrite,
    });
  }

  return plans;
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

async function buildLowRiskArchiveCandidates(input: {
  api: DirectNotionClient;
  pages: Array<{ kind: SupportKind; page: DataSourcePageRef }>;
  dataSourceIdByKind: Record<SupportKind, string>;
}): Promise<LowRiskArchiveCandidate[]> {
  return Promise.all(
    input.pages
      .filter(({ kind, page }) => {
      if (!/\bsandbox\b/i.test(page.title)) {
        return false;
      }
      return relationIds(page.properties[supportProjectProperty(kind)]).length === 0;
      })
      .map(async ({ kind, page }) => {
        const markdown = await input.api.readPageMarkdown(page.id);
        requireCompleteMarkdownReadback(page.id, markdown);
        return {
          kind,
          id: page.id,
          title: page.title,
          precondition: hygieneArchivePrecondition({
            page,
            parentDataSourceId: input.dataSourceIdByKind[kind],
            markdown: markdown.markdown,
          }),
        };
      }),
  );
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
