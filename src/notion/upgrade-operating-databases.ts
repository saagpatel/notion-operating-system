import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { normalizeNotionId } from "../utils/notion-id.js";

const TODAY = "2026-03-17";
const CURRENT_WEEK_TITLE = "Week of 2026-03-16";

const IDS = {
  localProjects: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
  legacyProjects: "35e04e4d-bcd8-45c0-b783-238edef210f7",
  skills: "89be2dd1-960d-4d0e-89bc-452eacd9215e",
  research: "fd70f600-1a76-40b7-9946-e77a208b3e1b",
  weekly: "f7cff9c6-eda4-47a8-b0ef-187c607684ca",
  build: "0927e24f-1c0a-4be2-9753-feae194afe91",
  tools: "62bba59c-6004-4b8e-9161-3f336a99bc50",
} as const;

interface DataSourcePageRef {
  id: string;
  url: string;
  title: string;
  properties: Record<string, NotionPageProperty>;
}

interface NotionPageProperty {
  type: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string | null } | null;
  multi_select?: Array<{ name?: string }>;
  relation?: Array<{ id: string }>;
  checkbox?: boolean;
  date?: { start?: string | null } | null;
  number?: number | null;
  url?: string | null;
}

interface SkillsLinkResult {
  matchedProjectIds: string[];
  matchedProjectTitles: string[];
  ambiguousTokens: string[];
  proofTypes: string[];
  reviewCadence?: string;
  projectRelevance?: string;
  normalizedProjectsText?: string;
  needsLinkReview: boolean;
}

interface BuildLogSeed {
  title: string;
  sessionDate: string;
  sessionType: string;
  outcome: string;
  planned: string;
  shipped: string;
  blockers: string;
  lessons: string;
  nextSteps: string;
  tags: string[];
  toolsUsed: string[];
  artifactsUpdated: string[];
  scopeDrift: string;
  sessionRating: string;
  followUpNeeded: boolean;
  localProjects: string[];
  legacyProjects?: string[];
  markdown: string;
}

interface ResearchSeed {
  topic: string;
  category: string;
  researchType: string;
  actionable: string;
  confidence: string;
  decisionImpact: string;
  revalidationCadence: string;
  summary: string;
  keyFindings: string;
  sources: string;
  sourceUrl?: string;
  tags: string[];
  relatedTools: string[];
  relatedLocalProjects: string[];
  markdown: string;
}

interface WeeklyReviewUpdate {
  page: DataSourcePageRef;
  buildLogPages: DataSourcePageRef[];
  localProjectIds: string[];
  skillsLinkedCount: number;
  skillsReviewQueueCount: number;
  researchCount: number;
  toolLinkCount: number;
}

const GENERIC_SKILL_PROJECT_TOKENS = new Set([
  "allartifacts",
  "allprojects",
  "artifacts",
  "claudecode",
  "claudecodeenv",
  "claudecodeenvscripts",
  "claudecodeskillslibrary",
  "confluence",
  "cowork",
  "desktopapps",
  "generalcrossproject",
  "jira",
  "notebooklm",
  "okta",
  "ollama",
  "research",
  "scripts",
  "skillslibrary",
  "windowsaudit",
  "work",
]);

const IGNORED_SKILL_PROJECT_TOKENS = new Set([
  "epidemicsimulator",
  "evspotter",
  "jsmexport",
  "learningcc",
  "nexuscodegen",
  "projectcc",
  "projectccv63",
  "ragtransformer",
]);

const SKILL_PROJECT_ALIASES = new Map([
  ["aiworkflowaccelerator", "aiworkflow"],
  ["jobcc", "jobcommandcenter"],
  ["jobcctauri", "jobcommandcenter"],
  ["jobccv6", "jobcommandcenter"],
  ["nexusai", "nexus"],
]);

const REVIEW_CADENCE_BY_STATUS: Record<string, string> = {
  Active: "Monthly",
  Learning: "Weekly",
  Rusty: "Quarterly",
  Dormant: "As Needed",
};

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required");
  }

  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const markdownApi = new DirectNotionClient(token);

  await ensureSchemas(sdk);

  const [
    localProjects,
    legacyProjects,
    toolPages,
    skillPages,
    buildLogPagesBefore,
    researchPagesBefore,
    weeklyPages,
  ] = await Promise.all([
    fetchAllPages(sdk, IDS.localProjects, "Name"),
    fetchAllPages(sdk, IDS.legacyProjects, "Project Name"),
    fetchAllPages(sdk, IDS.tools, "Tool Name"),
    fetchAllPages(sdk, IDS.skills, "Skill"),
    fetchAllPages(sdk, IDS.build, "Session Title"),
    fetchAllPages(sdk, IDS.research, "Topic"),
    fetchAllPages(sdk, IDS.weekly, "Week"),
  ]);

  const localProjectMap = buildTitleMap(localProjects);
  const legacyProjectMap = buildTitleMap(legacyProjects);
  const toolMap = buildTitleMap(toolPages);
  const buildLogMap = buildTitleMap(buildLogPagesBefore);
  const researchMap = buildTitleMap(researchPagesBefore);
  const weeklyMap = buildTitleMap(weeklyPages);

  const skillsSummary = await backfillSkillsLibrary(markdownApi, skillPages, localProjectMap);
  const buildSeeds = buildBuildLogSeeds();
  const seededBuildLogs = await upsertBuildLogEntries(markdownApi, buildLogMap, localProjectMap, legacyProjectMap, buildSeeds);

  const researchSeeds = buildResearchSeeds();
  const seededResearch = await upsertResearchEntries(
    markdownApi,
    researchMap,
    localProjectMap,
    toolMap,
    researchSeeds,
  );

  const toolSummary = await strengthenToolMatrix(markdownApi, toolMap, localProjectMap);

  const currentWeekly = weeklyMap.get(normalizeKey(CURRENT_WEEK_TITLE));
  if (!currentWeekly) {
    throw new AppError(`Could not find weekly review page titled "${CURRENT_WEEK_TITLE}"`);
  }

  const weeklySummary = await updateCurrentWeeklyReview(markdownApi, {
    page: currentWeekly,
    buildLogPages: seededBuildLogs,
    localProjectIds: resolveLocalProjectIds(
      ["ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "visual-album-studio"],
      localProjectMap,
    ),
    skillsLinkedCount: skillsSummary.linkedRows,
    skillsReviewQueueCount: skillsSummary.needsReviewRows,
    researchCount: seededResearch.length,
    toolLinkCount: toolSummary.updatedTools,
  });

  const [buildLogPagesAfter, researchPagesAfter] = await Promise.all([
    fetchAllPages(sdk, IDS.build, "Session Title"),
    fetchAllPages(sdk, IDS.research, "Topic"),
  ]);

  console.log(
    JSON.stringify(
      {
        skillsLibrary: skillsSummary,
        buildLog: {
          seededRows: seededBuildLogs.length,
          totalRows: buildLogPagesAfter.length,
        },
        researchLibrary: {
          seededRows: seededResearch.length,
          totalRows: researchPagesAfter.length,
        },
        weeklyReview: weeklySummary,
        aiToolMatrix: toolSummary,
      },
      null,
      2,
    ),
  );
}

async function ensureSchemas(sdk: Client): Promise<void> {
  await Promise.all([
    sdk.request({
      path: `data_sources/${IDS.skills}`,
      method: "patch",
      body: {
        properties: {
          "Related Local Projects": {
            relation: relationSchema(IDS.localProjects),
          },
          "Project Relevance": {
            select: {
              options: colorize([
                ["Core", "green"],
                ["Useful", "blue"],
                ["Peripheral", "gray"],
              ]),
            },
          },
          "Proof Type": {
            multi_select: {
              options: colorize([
                ["Resume", "default"],
                ["Chat History", "blue"],
                ["Hands-on", "green"],
                ["Cert", "orange"],
                ["Production Use", "purple"],
              ]),
            },
          },
          "Review Cadence": {
            select: {
              options: colorize([
                ["Weekly", "green"],
                ["Monthly", "blue"],
                ["Quarterly", "orange"],
                ["As Needed", "gray"],
              ]),
            },
          },
          "Needs Link Review": {
            checkbox: {},
          },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${IDS.build}`,
      method: "patch",
      body: {
        properties: {
          "Local Project": {
            relation: relationSchema(IDS.localProjects),
          },
          "Session Type": {
            select: {
              options: colorize([
                ["Feature", "green"],
                ["Bugfix", "red"],
                ["Research", "blue"],
                ["Refactor", "purple"],
                ["Infra", "orange"],
                ["Planning", "gray"],
              ]),
            },
          },
          Outcome: {
            select: {
              options: colorize([
                ["Shipped", "green"],
                ["Progress", "blue"],
                ["Blocked", "red"],
                ["Abandoned", "brown"],
                ["Exploration", "purple"],
              ]),
            },
          },
          "Artifacts Updated": {
            multi_select: {
              options: colorize([
                ["code", "blue"],
                ["docs", "orange"],
                ["tests", "green"],
                ["notion", "purple"],
                ["design", "pink"],
                ["data", "gray"],
              ]),
            },
          },
          "Follow-up Needed": {
            checkbox: {},
          },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${IDS.weekly}`,
      method: "patch",
      body: {
        properties: {
          "Local Projects Touched": {
            relation: relationSchema(IDS.localProjects),
          },
          "Build Log Sessions": {
            relation: relationSchema(IDS.build),
          },
          "Review Status": {
            select: {
              options: colorize([
                ["Draft", "gray"],
                ["Completed", "green"],
                ["Published", "blue"],
              ]),
            },
          },
          "Top Priorities Next Week": {
            rich_text: {},
          },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${IDS.research}`,
      method: "patch",
      body: {
        properties: {
          "Related Local Projects": {
            relation: relationSchema(IDS.localProjects),
          },
          "Research Type": {
            select: {
              options: colorize([
                ["Tool Eval", "blue"],
                ["Technical Pattern", "green"],
                ["Market", "orange"],
                ["Workflow", "purple"],
                ["Reference", "gray"],
              ]),
            },
          },
          "Decision Impact": {
            select: {
              options: colorize([
                ["Immediate", "green"],
                ["Near-Term", "blue"],
                ["Background", "gray"],
                ["Archived", "brown"],
              ]),
            },
          },
          "Revalidation Cadence": {
            select: {
              options: colorize([
                ["1 month", "orange"],
                ["Quarterly", "blue"],
                ["As Needed", "gray"],
              ]),
            },
          },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${IDS.tools}`,
      method: "patch",
      body: {
        properties: {
          "Linked Local Projects": {
            relation: relationSchema(IDS.localProjects),
          },
        },
      },
    }),
  ]);
}

async function fetchAllPages(
  sdk: Client,
  dataSourceId: string,
  titlePropertyName: string,
): Promise<DataSourcePageRef[]> {
  const pages: DataSourcePageRef[] = [];
  let nextCursor: string | undefined;

  while (true) {
    const response = (await sdk.request({
      path: `data_sources/${dataSourceId}/query`,
      method: "post",
      body: {
        page_size: 100,
        start_cursor: nextCursor,
      },
    })) as {
      results?: Array<{
        id: string;
        url: string;
        properties?: Record<string, NotionPageProperty>;
      }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const page of response.results ?? []) {
      pages.push({
        id: normalizeNotionId(page.id),
        url: page.url,
        title: titleFromProperty(page.properties?.[titlePropertyName]),
        properties: page.properties ?? {},
      });
    }

    if (!response.has_more || !response.next_cursor) {
      break;
    }

    nextCursor = response.next_cursor;
  }

  return pages;
}

function buildTitleMap(pages: DataSourcePageRef[]): Map<string, DataSourcePageRef> {
  const mapped = new Map<string, DataSourcePageRef>();
  for (const page of pages) {
    if (!page.title) {
      continue;
    }
    mapped.set(normalizeKey(page.title), page);
  }
  return mapped;
}

async function backfillSkillsLibrary(
  markdownApi: DirectNotionClient,
  skillPages: DataSourcePageRef[],
  localProjectMap: Map<string, DataSourcePageRef>,
): Promise<{ totalRows: number; linkedRows: number; needsReviewRows: number }> {
  let linkedRows = 0;
  let needsReviewRows = 0;

  for (const page of skillPages) {
    const status = selectName(page.properties.Status);
    const notes = richTextFromProperty(page.properties.Notes);
    const category = selectName(page.properties.Category);
    const projectsText = richTextFromProperty(page.properties.Projects);
    const sources = multiSelectNames(page.properties.Source);

    const linkResult = linkSkillProjects({
      projectsText,
      status,
      notes,
      category,
      sources,
      localProjectMap,
    });

    if (linkResult.matchedProjectIds.length > 0) {
      linkedRows += 1;
    }
    if (linkResult.needsLinkReview) {
      needsReviewRows += 1;
    }

    await markdownApi.updatePageProperties({
      pageId: page.id,
      properties: {
        ...(linkResult.normalizedProjectsText && linkResult.normalizedProjectsText !== projectsText
          ? {
              Projects: richTextValue(linkResult.normalizedProjectsText),
            }
          : {}),
        "Related Local Projects": relationValue(linkResult.matchedProjectIds),
        "Project Relevance": selectValue(linkResult.projectRelevance),
        "Proof Type": multiSelectValue(linkResult.proofTypes),
        "Review Cadence": selectValue(linkResult.reviewCadence),
        "Needs Link Review": {
          checkbox: linkResult.needsLinkReview,
        },
      },
    });
  }

  return {
    totalRows: skillPages.length,
    linkedRows,
    needsReviewRows,
  };
}

function linkSkillProjects(input: {
  projectsText: string;
  status: string;
  notes: string;
  category: string;
  sources: string[];
  localProjectMap: Map<string, DataSourcePageRef>;
}): SkillsLinkResult {
  const tokens = input.projectsText
    .split(/[,\n;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const normalizedKeys = tokens
    .map((token) => SKILL_PROJECT_ALIASES.get(normalizeKey(token)) ?? normalizeKey(token))
    .filter(Boolean);

  const matched = new Map<string, string>();
  const ambiguousTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    const rawKey = normalizedKeys[index];
    if (!rawKey || GENERIC_SKILL_PROJECT_TOKENS.has(rawKey) || IGNORED_SKILL_PROJECT_TOKENS.has(rawKey)) {
      continue;
    }
    const key = rawKey;

    const match = input.localProjectMap.get(key);
    if (match) {
      matched.set(match.id, match.title);
      continue;
    }

    ambiguousTokens.push(token);
  }

  const proofTypes = new Set<string>();
  if (input.sources.includes("Resume")) {
    proofTypes.add("Resume");
  }
  if (input.sources.includes("Chat History")) {
    proofTypes.add("Chat History");
  }
  if (input.sources.includes("GitHub")) {
    proofTypes.add("Hands-on");
  }
  if (input.category === "Certifications" || /certified/i.test(input.notes)) {
    proofTypes.add("Cert");
  }
  if (matched.size > 0 && /(daily|applied daily|production|admin)/i.test(input.notes)) {
    proofTypes.add("Production Use");
  }

  const reviewCadence = REVIEW_CADENCE_BY_STATUS[input.status];
  let projectRelevance: string | undefined;
  if (matched.size === 1 && ambiguousTokens.length === 0 && tokens.length === 1) {
    projectRelevance = "Core";
  } else if (matched.size > 0 && (input.status === "Rusty" || input.status === "Dormant")) {
    projectRelevance = "Peripheral";
  } else if (matched.size > 0) {
    projectRelevance = "Useful";
  }

  const normalizedProjectsText = normalizedKeys.length > 0
    && normalizedKeys.every((key) => GENERIC_SKILL_PROJECT_TOKENS.has(key))
    ? "General / cross-project"
    : undefined;

  return {
    matchedProjectIds: [...matched.keys()],
    matchedProjectTitles: [...matched.values()],
    ambiguousTokens,
    proofTypes: [...proofTypes],
    reviewCadence,
    projectRelevance,
    normalizedProjectsText,
    needsLinkReview: ambiguousTokens.length > 0,
  };
}

function buildBuildLogSeeds(): BuildLogSeed[] {
  return [
    {
      title: "Rebuilt local portfolio audit dataset",
      sessionDate: "2026-03-16",
      sessionType: "Research",
      outcome: "Shipped",
      planned: "Re-audit the local portfolio, reconcile the project inventory, and mirror the Notion project schema into durable local artifacts.",
      shipped: "Regenerated the markdown audit and workbook from one canonical dataset covering 65 local projects.",
      blockers: "The older audit had inconsistent counts, staging duplicates, and hand-maintained summary drift that had to be corrected before the export was trustworthy.",
      lessons: "Shared dataset generation is more reliable than keeping portfolio summaries as freehand prose.",
      nextSteps: "Promote the cleaned local dataset into Notion and use it as the operational project source of truth.",
      tags: ["portfolio", "audit", "notion"],
      toolsUsed: ["Codex CLI (OpenAI)", "Warp", "Notion"],
      artifactsUpdated: ["docs", "data"],
      scopeDrift: "Minor",
      sessionRating: "Great",
      followUpNeeded: true,
      localProjects: ["ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "SpecCompanion", "visual-album-studio"],
      legacyProjects: ["ComplianceKit"],
      markdown: [
        "# Rebuilt local portfolio audit dataset",
        "",
        "## What Was Planned",
        "Re-audit the local portfolio, reconcile the project inventory, and mirror the Notion project schema into durable local artifacts.",
        "",
        "## What Shipped",
        "Regenerated the markdown audit and workbook from one canonical dataset covering 65 local projects.",
        "",
        "## Blockers",
        "The older audit had inconsistent counts, staging duplicates, and hand-maintained summary drift that had to be corrected before the export was trustworthy.",
        "",
        "## Lessons",
        "Shared dataset generation is more reliable than keeping portfolio summaries as freehand prose.",
        "",
        "## Next Steps",
        "Promote the cleaned local dataset into Notion and use it as the operational project source of truth.",
      ].join("\n"),
    },
    {
      title: "Imported Local Portfolio Projects into Notion",
      sessionDate: "2026-03-17",
      sessionType: "Infra",
      outcome: "Shipped",
      planned: "Create a dedicated Local Portfolio Projects database and import the audited local project rows.",
      shipped: "Created the Local Portfolio Projects database, patched the data-source schema, and imported 65 project profiles with richer local-operating metadata.",
      blockers: "The new Notion database flow initially exposed only the default title property, so the data source had to be patched after creation before rows could be inserted.",
      lessons: "For the current Notion data-source model the safe flow is create database, patch schema, then populate rows.",
      nextSteps: "Point the rest of the non-project operating system at Local Portfolio Projects instead of treating the scored project portfolio as the execution source of truth.",
      tags: ["portfolio", "notion", "schema"],
      toolsUsed: ["Codex CLI (OpenAI)", "Warp", "Notion"],
      artifactsUpdated: ["notion", "docs"],
      scopeDrift: "Minor",
      sessionRating: "Great",
      followUpNeeded: true,
      localProjects: [],
      markdown: [
        "# Imported Local Portfolio Projects into Notion",
        "",
        "## What Was Planned",
        "Create a dedicated Local Portfolio Projects database and import the audited local project rows.",
        "",
        "## What Shipped",
        "Created the Local Portfolio Projects database, patched the data-source schema, and imported 65 project profiles with richer local-operating metadata.",
        "",
        "## Blockers",
        "The new Notion database flow initially exposed only the default title property, so the data source had to be patched after creation before rows could be inserted.",
        "",
        "## Lessons",
        "For the current Notion data-source model the safe flow is create database, patch schema, then populate rows.",
        "",
        "## Next Steps",
        "Point the rest of the non-project operating system at Local Portfolio Projects instead of treating the scored project portfolio as the execution source of truth.",
      ].join("\n"),
    },
    {
      title: "Published weekly review baseline",
      sessionDate: "2026-03-17",
      sessionType: "Planning",
      outcome: "Shipped",
      planned: "Dry-run and publish a live weekly review entry, then clean the sample content so the page can become the ongoing weekly template.",
      shipped: "Created the current weekly review page, corrected the stale setup wording, and verified the final markdown readback.",
      blockers: "The first live publish carried setup-era text that needed a second pass before the review page felt production-ready.",
      lessons: "Templates and sample content need to stay production-safe because live promotion from dry-run is intentionally fast.",
      nextSteps: "Derive future weekly reviews from build-log sessions instead of relying on memory or ad hoc notes.",
      tags: ["weekly-review", "notion", "workflow"],
      toolsUsed: ["Codex CLI (OpenAI)", "Notion", "Warp"],
      artifactsUpdated: ["notion", "docs"],
      scopeDrift: "None",
      sessionRating: "Good",
      followUpNeeded: true,
      localProjects: [],
      markdown: [
        "# Published weekly review baseline",
        "",
        "## What Was Planned",
        "Dry-run and publish a live weekly review entry, then clean the sample content so the page can become the ongoing weekly template.",
        "",
        "## What Shipped",
        "Created the current weekly review page, corrected the stale setup wording, and verified the final markdown readback.",
        "",
        "## Blockers",
        "The first live publish carried setup-era text that needed a second pass before the review page felt production-ready.",
        "",
        "## Lessons",
        "Templates and sample content need to stay production-safe because live promotion from dry-run is intentionally fast.",
        "",
        "## Next Steps",
        "Derive future weekly reviews from build-log sessions instead of relying on memory or ad hoc notes.",
      ].join("\n"),
    },
    {
      title: "Reviewed non-project database operating model",
      sessionDate: "2026-03-17",
      sessionType: "Planning",
      outcome: "Progress",
      planned: "Inspect the live non-project Notion databases and decide how they should connect around the local project system.",
      shipped: "Confirmed Skills Library and AI Tool & Site Matrix as the strongest content systems, and chose Local Portfolio Projects as the operational project source of truth.",
      blockers: "Build Log, Weekly Reviews, and Research Library still pointed at the older Project Portfolio, so a non-destructive migration path was required.",
      lessons: "The system needs additive migration around local execution data rather than a destructive replacement of the older strategic database.",
      nextSteps: "Add new local-project relations, seed the empty databases with high-signal entries, and keep the legacy project relations intact during transition.",
      tags: ["notion", "operations", "architecture"],
      toolsUsed: ["Codex CLI (OpenAI)", "Notion", "Warp"],
      artifactsUpdated: ["notion", "docs"],
      scopeDrift: "Minor",
      sessionRating: "Good",
      followUpNeeded: true,
      localProjects: ["ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "AIWorkFlow"],
      legacyProjects: ["ComplianceKit"],
      markdown: [
        "# Reviewed non-project database operating model",
        "",
        "## What Was Planned",
        "Inspect the live non-project Notion databases and decide how they should connect around the local project system.",
        "",
        "## What Shipped",
        "Confirmed Skills Library and AI Tool & Site Matrix as the strongest content systems, and chose Local Portfolio Projects as the operational project source of truth.",
        "",
        "## Blockers",
        "Build Log, Weekly Reviews, and Research Library still pointed at the older Project Portfolio, so a non-destructive migration path was required.",
        "",
        "## Lessons",
        "The system needs additive migration around local execution data rather than a destructive replacement of the older strategic database.",
        "",
        "## Next Steps",
        "Add new local-project relations, seed the empty databases with high-signal entries, and keep the legacy project relations intact during transition.",
      ].join("\n"),
    },
    {
      title: "Upgraded non-project operating databases",
      sessionDate: TODAY,
      sessionType: "Infra",
      outcome: "Shipped",
      planned: "Add operational relations around Local Portfolio Projects and seed the empty knowledge systems so the Notion layer becomes useful immediately.",
      shipped: "Added new fields across Skills Library, Build Log, Weekly Reviews, Research Library, and AI Tool & Site Matrix; backfilled project links; seeded research and session logs; and completed the current weekly review.",
      blockers: "The system still carries a legacy split between scored ideas and real local projects, so the upgrade had to preserve old relations while adding new operational ones.",
      lessons: "Additive schema evolution lets the operations layer improve quickly without sacrificing the historical idea-scoring database.",
      nextSteps: "Keep the new rhythm alive by logging real sessions continuously, reviewing ambiguous skill links, and extending Research Library only when the entry is genuinely reusable.",
      tags: ["notion", "operations", "migration"],
      toolsUsed: ["Codex CLI (OpenAI)", "Notion", "Warp"],
      artifactsUpdated: ["notion", "docs", "data"],
      scopeDrift: "Minor",
      sessionRating: "Great",
      followUpNeeded: true,
      localProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "visual-album-studio"],
      legacyProjects: ["ComplianceKit"],
      markdown: [
        "# Upgraded non-project operating databases",
        "",
        "## What Was Planned",
        "Add operational relations around Local Portfolio Projects and seed the empty knowledge systems so the Notion layer becomes useful immediately.",
        "",
        "## What Shipped",
        "Added new fields across Skills Library, Build Log, Weekly Reviews, Research Library, and AI Tool & Site Matrix; backfilled project links; seeded research and session logs; and completed the current weekly review.",
        "",
        "## Blockers",
        "The system still carries a legacy split between scored ideas and real local projects, so the upgrade had to preserve old relations while adding new operational ones.",
        "",
        "## Lessons",
        "Additive schema evolution lets the operations layer improve quickly without sacrificing the historical idea-scoring database.",
        "",
        "## Next Steps",
        "Keep the new rhythm alive by logging real sessions continuously, reviewing ambiguous skill links, and extending Research Library only when the entry is genuinely reusable.",
      ].join("\n"),
    },
  ];
}

async function upsertBuildLogEntries(
  markdownApi: DirectNotionClient,
  existingPages: Map<string, DataSourcePageRef>,
  localProjectMap: Map<string, DataSourcePageRef>,
  legacyProjectMap: Map<string, DataSourcePageRef>,
  seeds: BuildLogSeed[],
): Promise<DataSourcePageRef[]> {
  const results: DataSourcePageRef[] = [];

  for (const seed of seeds) {
    const existing = existingPages.get(normalizeKey(seed.title));
    const properties = {
      "Session Title": {
        title: toRichText(seed.title),
      },
      "Session Date": dateValue(seed.sessionDate),
      "Session Type": selectValue(seed.sessionType),
      Outcome: selectValue(seed.outcome),
      "What Was Planned": richTextValue(seed.planned),
      "What Shipped": richTextValue(seed.shipped),
      "Blockers Hit": richTextValue(seed.blockers),
      "Lessons Learned": richTextValue(seed.lessons),
      "Next Steps": richTextValue(seed.nextSteps),
      "Tools Used": multiSelectValue(seed.toolsUsed),
      "Artifacts Updated": multiSelectValue(seed.artifactsUpdated),
      Tags: multiSelectValue(seed.tags),
      "Scope Drift": selectValue(seed.scopeDrift),
      "Session Rating": selectValue(seed.sessionRating),
      "Follow-up Needed": {
        checkbox: seed.followUpNeeded,
      },
      "Local Project": relationValue(resolveLocalProjectIds(seed.localProjects, localProjectMap)),
      Project: relationValue(resolveLegacyProjectIds(seed.legacyProjects ?? [], legacyProjectMap)),
      Duration: richTextValue(""),
      "Model Used": selectValue(undefined),
      "Tech Debt Created": richTextValue(""),
    };

    const page = await upsertPageWithMarkdown(markdownApi, {
      existingPageId: existing?.id,
      existingPageUrl: existing?.url,
      dataSourceId: IDS.build,
      properties,
      markdown: seed.markdown,
    });
    results.push({
      id: page.id,
      url: page.url,
      title: seed.title,
      properties: {},
    });
  }

  return results;
}

function buildResearchSeeds(): ResearchSeed[] {
  return [
    {
      topic: "Claude Code as Primary Multi-Project Operator",
      category: "Product",
      researchType: "Tool Eval",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "Quarterly",
      summary:
        "Claude Code is the strongest fit for deep code-plus-operations work across the active local portfolio when paired with explicit project context and a clean Notion operating layer.",
      keyFindings:
        "Best overall for long-form reasoning, repository navigation, and multi-step execution; strongest when the surrounding project system is structured enough to reduce re-explaining context.",
      sources:
        "AI Tool & Site Matrix entries for Claude Code, Claude (claude.ai), Notion, and Warp; current operating-system build work inside the Notion repo.",
      tags: ["agentic-coding", "portfolio-ops", "workflow"],
      relatedTools: ["Claude Code", "Claude (claude.ai)", "Notion", "Warp"],
      relatedLocalProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "IncidentReview", "SpecCompanion", "visual-album-studio"],
      markdown: [
        "# Claude Code as Primary Multi-Project Operator",
        "",
        "## Summary",
        "Claude Code is the strongest fit for deep code-plus-operations work across the active local portfolio when paired with explicit project context and a clean Notion operating layer.",
        "",
        "## Key Findings",
        "- Best overall for long-form reasoning, repository navigation, and multi-step execution.",
        "- Works especially well when the surrounding project system reduces re-explaining context.",
        "- Still benefits from a strong external operating layer for portfolio state and documentation.",
        "",
        "## Recommended Use",
        "Use Claude Code as the default operator for cross-repo engineering and ops work, with Notion carrying the durable operating memory.",
      ].join("\n"),
    },
    {
      topic: "Optional Local LLM Layer via Ollama",
      category: "Architecture",
      researchType: "Technical Pattern",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "Quarterly",
      summary:
        "Ollama works best across the desktop-app portfolio as an optional local inference path rather than a mandatory first-run dependency.",
      keyFindings:
        "The strongest pattern is local-first enhancement, fallback, or privacy-sensitive processing; user experience degrades when local inference is required before the product is useful.",
      sources:
        "AI Tool & Site Matrix entries for Ollama and LM Studio plus the local project audit notes for apps that already mention optional Ollama support.",
      tags: ["local-llm", "desktop-apps", "architecture"],
      relatedTools: ["Ollama", "LM Studio"],
      relatedLocalProjects: ["AssistSupport", "Chronomap", "CryptForge", "SignalFlow", "TicketDocumentation", "TicketHandoff", "WorkdayDebrief"],
      markdown: [
        "# Optional Local LLM Layer via Ollama",
        "",
        "## Summary",
        "Ollama works best across the desktop-app portfolio as an optional local inference path rather than a mandatory first-run dependency.",
        "",
        "## Key Findings",
        "- Strong fit for augmentation, privacy-sensitive local processing, and offline capability.",
        "- Weak fit as a hard prerequisite for initial product value.",
        "- Should be framed in product copy as optional enhancement, not setup burden.",
        "",
        "## Recommended Use",
        "Default to non-LLM value first and let Ollama unlock advanced local workflows where it materially improves the product.",
      ].join("\n"),
    },
    {
      topic: "Tauri 2 plus React plus Rust Is the Default Local App Stack",
      category: "Architecture",
      researchType: "Technical Pattern",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "Quarterly",
      summary:
        "Tauri 2 with a React frontend and Rust backend is the dominant and most reusable implementation pattern across the current local portfolio.",
      keyFindings:
        "The stack appears repeatedly in the strongest local projects and supports a good balance of native packaging, local-first data handling, and reusable engineering patterns.",
      sources:
        "Local portfolio audit data for ApplyKit, AssistSupport, IncidentReview, SpecCompanion, AuraForge, and other desktop projects.",
      tags: ["tauri", "rust", "react", "desktop"],
      relatedTools: ["Claude Code", "GitHub"],
      relatedLocalProjects: ["ApplyKit", "AssistSupport", "AuraForge", "IncidentReview", "SpecCompanion"],
      markdown: [
        "# Tauri 2 plus React plus Rust Is the Default Local App Stack",
        "",
        "## Summary",
        "Tauri 2 with a React frontend and Rust backend is the dominant and most reusable implementation pattern across the current local portfolio.",
        "",
        "## Key Findings",
        "- The strongest local projects share the same broad desktop architecture.",
        "- Reuse opportunities are highest around local storage, settings, sync, and deterministic workflow modules.",
        "- Stack standardization reduces switching cost across projects.",
        "",
        "## Recommended Use",
        "Treat this stack as the default for local-first desktop products unless a project has a clear reason to diverge.",
      ].join("\n"),
    },
    {
      topic: "Split Idea Portfolio From Real Local Execution Portfolio",
      category: "Product",
      researchType: "Workflow",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "As Needed",
      summary:
        "The older Project Portfolio and the newer Local Portfolio Projects database should stay distinct because they answer different questions.",
      keyFindings:
        "The scored portfolio is for idea triage and strategic pipeline thinking, while the local project database is for real execution state, local evidence, and current operations.",
      sources:
        "Live comparison between the scored Project Portfolio database and the imported Local Portfolio Projects database during the current Notion operating-system work.",
      tags: ["portfolio", "operations", "notion"],
      relatedTools: ["Notion"],
      relatedLocalProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview"],
      markdown: [
        "# Split Idea Portfolio From Real Local Execution Portfolio",
        "",
        "## Summary",
        "The older Project Portfolio and the newer Local Portfolio Projects database should stay distinct because they answer different questions.",
        "",
        "## Key Findings",
        "- The scored portfolio is best for idea triage and strategic pipeline thinking.",
        "- The local project database is best for execution state, evidence, and active operating links.",
        "- Trying to collapse both roles into one database increases noise and weakens trust.",
        "",
        "## Recommended Use",
        "Keep both systems, but build the day-to-day operating layer around Local Portfolio Projects.",
      ].join("\n"),
    },
    {
      topic: "Weekly Reviews Should Roll Up From Build Log",
      category: "Product",
      researchType: "Workflow",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "As Needed",
      summary:
        "Weekly reviews are most useful when they summarize actual logged sessions and project links rather than relying on memory at the end of the week.",
      keyFindings:
        "The schema for Weekly Reviews is strong, but it only becomes reliable when Build Log acts as the feed and the review becomes a lightweight rollup step.",
      sources:
        "Live schema review of Weekly Reviews and Build Log plus the current effort to backfill the week of March 16, 2026.",
      tags: ["weekly-review", "build-log", "workflow"],
      relatedTools: ["Notion"],
      relatedLocalProjects: [],
      markdown: [
        "# Weekly Reviews Should Roll Up From Build Log",
        "",
        "## Summary",
        "Weekly reviews are most useful when they summarize actual logged sessions and project links rather than relying on memory at the end of the week.",
        "",
        "## Key Findings",
        "- Build Log should hold the session-level truth.",
        "- Weekly Reviews should hold the reflection and prioritization layer.",
        "- The system works best when the weekly step is lightweight and evidence-backed.",
        "",
        "## Recommended Use",
        "Use Build Log continuously and let Weekly Reviews summarize the week instead of reconstructing it from scratch.",
      ].join("\n"),
    },
    {
      topic: "Skills-to-Project Linking Requires Conservative Matching",
      category: "Product",
      researchType: "Workflow",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Near-Term",
      revalidationCadence: "As Needed",
      summary:
        "The Skills Library should gain structured project links, but only when the existing free-text project context is specific enough to support a confident match.",
      keyFindings:
        "Conservative linking preserves trust. Exact or normalization-safe matches are worth linking; vague buckets like Work or All artifacts should remain unstructured until manually reviewed.",
      sources:
        "Current Skills Library `Projects` field values compared against Local Portfolio Projects during the operating-system migration.",
      tags: ["skills", "linking", "notion"],
      relatedTools: ["Notion", "Claude Code"],
      relatedLocalProjects: ["ComplianceKit", "ModelColosseum"],
      markdown: [
        "# Skills-to-Project Linking Requires Conservative Matching",
        "",
        "## Summary",
        "The Skills Library should gain structured project links, but only when the existing free-text project context is specific enough to support a confident match.",
        "",
        "## Key Findings",
        "- Exact and normalization-safe matches are worth linking immediately.",
        "- Broad buckets like Work or All artifacts should stay as legacy context rather than becoming guessed links.",
        "- A small review queue is healthier than aggressive auto-linking.",
        "",
        "## Recommended Use",
        "Preserve the free-text history, add structured links only where confident, and review the ambiguous rows over time.",
      ].join("\n"),
    },
    {
      topic: "Current AI Tool Stack: Claude First, ChatGPT Supplement, Perplexity for Research",
      category: "AI/ML",
      researchType: "Tool Eval",
      actionable: "Reference Only",
      confidence: "High",
      decisionImpact: "Background",
      revalidationCadence: "Quarterly",
      summary:
        "The current tool stack is already differentiated: Claude and Claude Code carry primary execution, ChatGPT is a supplement, and Perplexity is strongest as a research helper rather than a coding driver.",
      keyFindings:
        "The existing AI Tool & Site Matrix already captures clear comparative judgment; the main gap is linking those tool decisions back to the projects they influence.",
      sources:
        "Current AI Tool & Site Matrix entries for Claude, Claude Code, ChatGPT, Gemini, and Perplexity.",
      tags: ["ai-tools", "workflow", "decision-support"],
      relatedTools: ["Claude (claude.ai)", "Claude Code", "ChatGPT", "Perplexity"],
      relatedLocalProjects: [],
      markdown: [
        "# Current AI Tool Stack: Claude First, ChatGPT Supplement, Perplexity for Research",
        "",
        "## Summary",
        "The current tool stack is already differentiated: Claude and Claude Code carry primary execution, ChatGPT is a supplement, and Perplexity is strongest as a research helper rather than a coding driver.",
        "",
        "## Key Findings",
        "- The tool roles are already distinct enough to support real operating decisions.",
        "- The biggest value now is better linkage back to projects, not more comparison prose.",
        "- Refresh cadence matters more than adding many more tools.",
        "",
        "## Recommended Use",
        "Keep using the matrix as the canonical qualitative tool judgment layer and link the high-impact rows back to the projects they affect.",
      ].join("\n"),
    },
    {
      topic: "Notion Works Best as an Operations Layer Backed by Local Source Data",
      category: "Architecture",
      researchType: "Reference",
      actionable: "Yes - Immediate",
      confidence: "High",
      decisionImpact: "Immediate",
      revalidationCadence: "As Needed",
      summary:
        "Notion is most reliable in this system when it reflects local source data and explicit workflows rather than trying to be the only source of truth.",
      keyFindings:
        "The strongest pattern is local generation plus structured publish into Notion, with Notion acting as the shared operating surface rather than the only canonical record.",
      sources:
        "Current Notion publishing tooling, local portfolio audit artifacts, and the live database upgrade work completed in this repo.",
      tags: ["notion", "operations", "source-of-truth"],
      relatedTools: ["Notion", "Claude Code"],
      relatedLocalProjects: ["ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview"],
      markdown: [
        "# Notion Works Best as an Operations Layer Backed by Local Source Data",
        "",
        "## Summary",
        "Notion is most reliable in this system when it reflects local source data and explicit workflows rather than trying to be the only source of truth.",
        "",
        "## Key Findings",
        "- Local generation and audit tooling produce higher-trust data than manual spreadsheet-style upkeep.",
        "- Notion is strongest as the visible operating surface and shared decision layer.",
        "- Structured publish flows reduce drift between local reality and the knowledge system.",
        "",
        "## Recommended Use",
        "Keep local artifacts and scripts as the source of generation, then publish the stable operating view into Notion.",
      ].join("\n"),
    },
  ];
}

async function upsertResearchEntries(
  markdownApi: DirectNotionClient,
  existingPages: Map<string, DataSourcePageRef>,
  localProjectMap: Map<string, DataSourcePageRef>,
  toolMap: Map<string, DataSourcePageRef>,
  seeds: ResearchSeed[],
): Promise<DataSourcePageRef[]> {
  const results: DataSourcePageRef[] = [];

  for (const seed of seeds) {
    const existing = existingPages.get(normalizeKey(seed.topic));
    const properties = {
      Topic: {
        title: toRichText(seed.topic),
      },
      Category: selectValue(seed.category),
      Summary: richTextValue(seed.summary),
      "Key Findings": richTextValue(seed.keyFindings),
      Actionable: selectValue(seed.actionable),
      Confidence: selectValue(seed.confidence),
      Sources: richTextValue(seed.sources),
      "Source URLs": urlValue(seed.sourceUrl),
      "Date Researched": dateValue(TODAY),
      "Last Verified": dateValue(TODAY),
      Tags: multiSelectValue(seed.tags),
      "Related Tools": relationValue(resolveToolIds(seed.relatedTools, toolMap)),
      "Related Local Projects": relationValue(resolveLocalProjectIds(seed.relatedLocalProjects, localProjectMap)),
      "Related Projects": relationValue([]),
      "Research Type": selectValue(seed.researchType),
      "Decision Impact": selectValue(seed.decisionImpact),
      "Revalidation Cadence": selectValue(seed.revalidationCadence),
    };

    const page = await upsertPageWithMarkdown(markdownApi, {
      existingPageId: existing?.id,
      existingPageUrl: existing?.url,
      dataSourceId: IDS.research,
      properties,
      markdown: seed.markdown,
    });
    results.push({
      id: page.id,
      url: page.url,
      title: seed.topic,
      properties: {},
    });
  }

  return results;
}

async function strengthenToolMatrix(
  markdownApi: DirectNotionClient,
  toolMap: Map<string, DataSourcePageRef>,
  localProjectMap: Map<string, DataSourcePageRef>,
): Promise<{ updatedTools: number }> {
  const updates: Array<{ tool: string; lastReviewed?: string; relatedLocalProjects: string[] }> = [
    {
      tool: "Claude (claude.ai)",
      lastReviewed: TODAY,
      relatedLocalProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "SpecCompanion", "visual-album-studio"],
    },
    {
      tool: "Claude Code",
      lastReviewed: TODAY,
      relatedLocalProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "SpecCompanion", "visual-album-studio"],
    },
    {
      tool: "Ollama",
      lastReviewed: TODAY,
      relatedLocalProjects: ["AssistSupport", "Chronomap", "CryptForge", "SignalFlow", "TicketDocumentation", "TicketHandoff", "WorkdayDebrief"],
    },
    {
      tool: "GitHub",
      lastReviewed: TODAY,
      relatedLocalProjects: ["AIWorkFlow", "ApplyKit", "AssistSupport", "ComplianceKit", "IncidentReview", "SpecCompanion", "visual-album-studio"],
    },
    {
      tool: "Notion",
      lastReviewed: TODAY,
      relatedLocalProjects: [],
    },
    {
      tool: "Warp",
      lastReviewed: TODAY,
      relatedLocalProjects: [],
    },
    {
      tool: "Vercel",
      lastReviewed: TODAY,
      relatedLocalProjects: ["AIWorkFlow", "ComplianceKit"],
    },
    {
      tool: "Supabase",
      lastReviewed: TODAY,
      relatedLocalProjects: ["ComplianceKit"],
    },
    {
      tool: "Perplexity",
      lastReviewed: TODAY,
      relatedLocalProjects: [],
    },
    {
      tool: "ChatGPT",
      lastReviewed: TODAY,
      relatedLocalProjects: [],
    },
  ];

  let updatedTools = 0;

  for (const update of updates) {
    const page = toolMap.get(normalizeKey(update.tool));
    if (!page) {
      continue;
    }

    updatedTools += 1;
    await markdownApi.updatePageProperties({
      pageId: page.id,
      properties: {
        "Linked Local Projects": relationValue(resolveLocalProjectIds(update.relatedLocalProjects, localProjectMap)),
        "Last Reviewed": dateValue(update.lastReviewed),
      },
    });
  }

  return { updatedTools };
}

async function updateCurrentWeeklyReview(
  markdownApi: DirectNotionClient,
  input: WeeklyReviewUpdate,
): Promise<{ pageId: string; pageUrl: string; buildSessions: number }> {
  const buildLogIds = input.buildLogPages.map((page) => page.id);

  const properties = {
    Week: {
      title: toRichText(CURRENT_WEEK_TITLE),
    },
    "Week Start": dateValue("2026-03-16"),
    "Local Projects Touched": relationValue(input.localProjectIds),
    "Build Log Sessions": relationValue(buildLogIds),
    "Build Sessions": numberValue(input.buildLogPages.length),
    "What Shipped": richTextValue(
      "Promoted Local Portfolio Projects into Notion, upgraded the non-project operating databases, linked the strongest skills and tools back to local projects, and seeded Build Log plus Research Library.",
    ),
    Blockers: richTextValue(
      "The new Notion data-source model required post-create schema patching, and the system still carries a temporary split between legacy scored ideas and real local execution records.",
    ),
    "Claude Usage": richTextValue(
      "Most of the week’s system work ran through Codex-style agentic execution and the local Notion tooling layer, with Claude-related judgment still captured in the tool matrix and research seeds.",
    ),
    Highlights: richTextValue(
      `Local Portfolio Projects is now the operational source of truth, ${input.skillsLinkedCount} skill rows gained structured local project links, and ${input.toolLinkCount} high-value tools now point back to local projects.`,
    ),
    "Skill Library Changes": richTextValue(
      `Added Related Local Projects, Project Relevance, Proof Type, Review Cadence, and a link-review queue. ${input.skillsReviewQueueCount} skill rows still need manual project-link review.`,
    ),
    Tags: multiSelectValue(["notion", "portfolio", "ops"]),
    "Energy Level": selectValue("Steady"),
    Lessons: richTextValue(
      "Additive migration works better than ripping out legacy structures. Notion is strongest when it reflects explicit local source data instead of trying to hold every truth by hand.",
    ),
    Wins: richTextValue(
      "The local project database went live with 65 rows, the empty operating databases are now seeded, and the overall system has a much clearer role split.",
    ),
    "What Stalled": richTextValue(
      "Deep historical backfill for build sessions remains intentionally deferred; the current week is seeded, but older weeks should only be added when evidence is strong.",
    ),
    "Collaboration Quality": selectValue("Excellent"),
    "Next Week Focus": richTextValue(
      "Use Build Log continuously, review the ambiguous Skills Library project links, and add Research Library entries only when they are reusable enough to guide future work.",
    ),
    "Top Priorities Next Week": richTextValue(
      "1. Start using Build Log continuously.\n2. Review ambiguous skill-to-project links.\n3. Extend Research Library only with reusable patterns.\n4. Decide later whether any legacy project relations can be retired.",
    ),
    "Review Status": selectValue("Completed"),
  };

  await markdownApi.updatePageProperties({
    pageId: input.page.id,
    properties,
  });

  const markdown = [
    `# ${CURRENT_WEEK_TITLE}`,
    "",
    "## What Shipped",
    "- Local Portfolio Projects became the operational project source of truth.",
    "- Skills Library, Build Log, Weekly Reviews, Research Library, and AI Tool & Site Matrix were upgraded to link into the local project system.",
    `- ${input.buildLogPages.length} build-log sessions and ${input.researchCount} research entries were seeded to make the operating layer immediately useful.`,
    "",
    "## Highlights",
    `- ${input.skillsLinkedCount} skill rows now have structured local project links.`,
    `- ${input.toolLinkCount} high-value tools now point back to local projects.`,
    "- The week now has a usable build-log backbone instead of a memory-only review.",
    "",
    "## Blockers",
    "- The current Notion data-source flow still requires post-create schema patching.",
    "- Legacy project relations remain in place during migration so the old strategic portfolio is not lost.",
    "",
    "## Lessons",
    "- Additive schema evolution is the safest way to improve the system without sacrificing older data.",
    "- Notion is strongest when it reflects local source artifacts and explicit workflows.",
    "",
    "## What Stalled",
    "- Historical build-log backfill beyond the current week remains intentionally deferred.",
    "",
    "## Next Week Focus",
    "- Use Build Log continuously.",
    "- Review the ambiguous skill-to-project links.",
    "- Extend Research Library only with reusable, decision-shaping entries.",
  ].join("\n");

  await markdownApi.patchPageMarkdown({
    pageId: input.page.id,
    command: "replace_content",
    newMarkdown: markdown,
  });

  return {
    pageId: input.page.id,
    pageUrl: input.page.url,
    buildSessions: input.buildLogPages.length,
  };
}

async function upsertPageWithMarkdown(
  markdownApi: DirectNotionClient,
  input: {
    existingPageId?: string;
    existingPageUrl?: string;
    dataSourceId: string;
    properties: Record<string, unknown>;
    markdown: string;
  },
): Promise<{ id: string; url: string }> {
  if (input.existingPageId) {
    const updated = await markdownApi.updatePageProperties({
      pageId: input.existingPageId,
      properties: input.properties,
    });
    await markdownApi.patchPageMarkdown({
      pageId: input.existingPageId,
      command: "replace_content",
      newMarkdown: input.markdown,
    });
    return {
      id: updated.id,
      url: updated.url,
    };
  }

  return markdownApi.createPageWithMarkdown({
    parent: {
      data_source_id: input.dataSourceId,
    },
    properties: input.properties,
    markdown: input.markdown,
  });
}

function resolveLocalProjectIds(
  titles: string[],
  localProjectMap: Map<string, DataSourcePageRef>,
): string[] {
  return resolvePageIds(titles, localProjectMap);
}

function resolveLegacyProjectIds(
  titles: string[],
  legacyProjectMap: Map<string, DataSourcePageRef>,
): string[] {
  return resolvePageIds(titles, legacyProjectMap);
}

function resolveToolIds(
  titles: string[],
  toolMap: Map<string, DataSourcePageRef>,
): string[] {
  return resolvePageIds(titles, toolMap);
}

function resolvePageIds(
  titles: string[],
  pageMap: Map<string, DataSourcePageRef>,
): string[] {
  return [...new Set(
    titles
      .map((title) => pageMap.get(normalizeKey(title))?.id)
      .filter((id): id is string => Boolean(id)),
  )];
}

function titleFromProperty(property: NotionPageProperty | undefined): string {
  return (property?.title ?? []).map((part) => part.plain_text ?? "").join("").trim();
}

function richTextFromProperty(property: NotionPageProperty | undefined): string {
  return (property?.rich_text ?? []).map((part) => part.plain_text ?? "").join("").trim();
}

function selectName(property: NotionPageProperty | undefined): string {
  return property?.select?.name?.trim() ?? "";
}

function multiSelectNames(property: NotionPageProperty | undefined): string[] {
  return (property?.multi_select ?? [])
    .map((option) => option.name?.trim() ?? "")
    .filter(Boolean);
}

function relationValue(ids: string[]): { relation: Array<{ id: string }> } {
  return {
    relation: ids.map((id) => ({ id })),
  };
}

function selectValue(name?: string): { select: { name: string } | null } {
  return {
    select: name ? { name } : null,
  };
}

function multiSelectValue(names: string[]): { multi_select: Array<{ name: string }> } {
  return {
    multi_select: [...new Set(names.filter(Boolean))].map((name) => ({ name })),
  };
}

function richTextValue(value: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return {
    rich_text: toRichText(value),
  };
}

function dateValue(value?: string): { date: { start: string } | null } {
  return {
    date: value ? { start: value } : null,
  };
}

function numberValue(value?: number): { number: number | null } {
  return {
    number: value ?? null,
  };
}

function urlValue(value?: string): { url: string | null } {
  return {
    url: value ?? null,
  };
}

function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return chunkText(trimmed, 1900).map((content) => ({
    type: "text",
    text: {
      content,
    },
  }));
}

function chunkText(value: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf(" ", maxLength);
    if (splitIndex < maxLength * 0.6) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function colorize(options: Array<[string, string]>): Array<{ name: string; color: string }> {
  return options.map(([name, color]) => ({ name, color }));
}

function relationSchema(dataSourceId: string): { data_source_id: string; single_property: Record<string, never> } {
  return {
    data_source_id: dataSourceId,
    single_property: {},
  };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exitCode = 1;
});
