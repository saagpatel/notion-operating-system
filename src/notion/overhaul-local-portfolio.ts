import "dotenv/config";

import { Client } from "@notionhq/client";

import { buildProjectIntelligenceDataset, buildProjectProfileMarkdown, type ProjectIntelligenceRow } from "../portfolio-audit/project-intelligence.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { normalizeNotionId } from "../utils/notion-id.js";

const IDS = {
  localProjects: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
  skills: "89be2dd1-960d-4d0e-89bc-452eacd9215e",
  research: "fd70f600-1a76-40b7-9946-e77a208b3e1b",
  build: "0927e24f-1c0a-4be2-9753-feae194afe91",
  tools: "62bba59c-6004-4b8e-9161-3f336a99bc50",
} as const;

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

interface DataSourcePageRef {
  id: string;
  url: string;
  title: string;
  properties: Record<string, NotionPageProperty>;
}

interface ReverseLinks {
  buildSessions: DataSourcePageRef[];
  research: DataSourcePageRef[];
  skills: DataSourcePageRef[];
  tools: DataSourcePageRef[];
}

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

  logLiveStage("Building project intelligence dataset");
  const { projects, scope } = await buildProjectIntelligenceDataset();
  logLiveStage("Ensuring Local Portfolio Projects schema");
  await ensureSchema(sdk);

  logLiveStage("Fetching source datasets");
  const [localPages, buildPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, IDS.localProjects, "Name"),
    fetchAllPages(sdk, IDS.build, "Session Title"),
    fetchAllPages(sdk, IDS.research, "Topic"),
    fetchAllPages(sdk, IDS.skills, "Skill"),
    fetchAllPages(sdk, IDS.tools, "Tool Name"),
  ]);

  const localPageMap = buildTitleMap(localPages);
  const reverseLinks = buildReverseLinks(localPages, {
    buildPages,
    researchPages,
    skillPages,
    toolPages,
  });

  let updatedRows = 0;
  let createdRows = 0;
  const failedProjects: Array<{ title: string; error: string }> = [];

  logLiveStage("Refreshing project profiles", { projectCount: projects.length });
  for (const [index, project] of projects.entries()) {
    logLoopProgress("overhaul-notion", `Project profile ${project.projectName}`, index + 1, projects.length);
    try {
      let existing = localPageMap.get(normalizeKey(project.projectName));
      if (!existing) {
        const created = await markdownApi.createPageWithMarkdown({
          parent: {
            data_source_id: IDS.localProjects,
          },
          properties: buildCreateProjectProperties(project, {
            buildSessions: [],
            research: [],
            skills: [],
            tools: [],
          }),
          markdown: buildProjectProfileMarkdown(project),
        });
        existing = {
          id: created.id,
          url: created.url,
          title: project.projectName,
          properties: {},
        };
        localPageMap.set(normalizeKey(project.projectName), existing);
        createdRows += 1;
      }

      const links = reverseLinks.get(existing.id) ?? {
        buildSessions: [],
        research: [],
        skills: [],
        tools: [],
      };

      await markdownApi.updatePageProperties({
        pageId: existing.id,
        properties: buildProjectProperties(project, links),
      });

      await markdownApi.patchPageMarkdown({
        pageId: existing.id,
        command: "replace_content",
        newMarkdown: buildProjectProfileMarkdown(project, links),
      });

      updatedRows += 1;
    } catch (error) {
      const message = toErrorMessage(error);
      failedProjects.push({
        title: project.projectName,
        error: message,
      });
      logLiveStage("Project refresh failed", {
        title: project.projectName,
        error: message,
      });
    }
  }

  logLiveStage("Verifying refreshed dataset");
  const verification = await fetchAllPages(sdk, IDS.localProjects, "Name");
  const coverage = await summarizeCoverage(sdk, projects.length);

  console.log(
    JSON.stringify(
      {
        databaseId: IDS.localProjects,
        updatedRows,
        createdRows,
        failedProjects,
        totalRowsAfter: verification.length,
        scope,
        coverage,
        note:
          "Schema and project pages were overhauled in place. Validate the saved-view plan locally, then sync the configured views through Notion MCP because the public Notion API still does not expose database view creation.",
      },
      null,
      2,
    ),
  );
}

function logLiveStage(stage: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[overhaul-notion] ${stage}${suffix}`);
}

function logLoopProgress(scope: string, label: string, index: number, total: number): void {
  console.error(`[${scope}] ${label} ${index}/${total}`);
}

async function ensureSchema(sdk: Client): Promise<void> {
  await sdk.request({
    path: `data_sources/${IDS.localProjects}`,
    method: "patch",
    body: {
      properties: {
        "Current State": {
          select: {
            options: colorize([
              ["Active Build", "green"],
              ["Ready for Review", "blue"],
              ["Ready to Demo", "purple"],
              ["Needs Decision", "orange"],
              ["Parked", "gray"],
              ["Archived", "brown"],
              ["Shipped", "green"],
            ]),
          },
        },
        "Portfolio Call": {
          select: {
            options: colorize([
              ["Build Now", "green"],
              ["Finish", "blue"],
              ["Polish", "purple"],
              ["Hold", "gray"],
              ["Archive", "brown"],
              ["Merge", "orange"],
            ]),
          },
        },
        "One-Line Pitch": { rich_text: {} },
        "Next Move": { rich_text: {} },
        "Biggest Blocker": { rich_text: {} },
        Momentum: {
          select: {
            options: colorize([
              ["Hot", "green"],
              ["Warm", "orange"],
              ["Cold", "gray"],
            ]),
          },
        },
        "Last Active": { date: {} },
        "Project Shape": {
          multi_select: {
            options: colorize([
              ["Product", "green"],
              ["Tool", "blue"],
              ["System", "purple"],
              ["Experiment", "gray"],
              ["Client Work", "orange"],
              ["Game", "pink"],
              ["Creative", "brown"],
            ]),
          },
        },
        "Deployment Surface": {
          multi_select: {
            options: colorize([
              ["Desktop", "blue"],
              ["Web", "green"],
              ["CLI", "gray"],
              ["API", "purple"],
              ["Bot", "orange"],
              ["Game", "pink"],
              ["Library", "brown"],
              ["Internal Tool", "default"],
            ]),
          },
        },
        "Docs Quality": {
          select: {
            options: colorize([
              ["Strong", "green"],
              ["Usable", "blue"],
              ["Thin", "orange"],
              ["Missing", "red"],
            ]),
          },
        },
        "Test Posture": {
          select: {
            options: colorize([
              ["Strong", "green"],
              ["Some", "blue"],
              ["Sparse", "orange"],
              ["Unknown", "gray"],
            ]),
          },
        },
        "Evidence Confidence": {
          select: {
            options: colorize([
              ["High", "green"],
              ["Medium", "orange"],
              ["Low", "red"],
            ]),
          },
        },
        "Start Here": { rich_text: {} },
        "Primary Run Command": { rich_text: {} },
        "Primary Context Doc": { rich_text: {} },
        "Setup Friction": {
          select: {
            options: colorize([
              ["Low", "green"],
              ["Medium", "orange"],
              ["High", "red"],
            ]),
          },
        },
        "Runs Locally": {
          select: {
            options: colorize([
              ["Yes", "green"],
              ["Partial", "orange"],
              ["Likely", "blue"],
              ["Unknown", "gray"],
              ["No", "red"],
            ]),
          },
        },
        "Last Meaningful Work": { rich_text: {} },
        "Primary User": { rich_text: {} },
        "Problem Solved": { rich_text: {} },
        "Value / Outcome": { rich_text: {} },
        "Build Maturity": {
          select: {
            options: colorize([
              ["Idea", "gray"],
              ["Scaffolded", "orange"],
              ["Functional Core", "blue"],
              ["Feature Complete", "purple"],
              ["Demoable", "green"],
              ["Shippable", "green"],
            ]),
          },
        },
        "Ship Readiness": {
          select: {
            options: colorize([
              ["Not Ready", "red"],
              ["Needs Hardening", "orange"],
              ["Near Ship", "blue"],
              ["Ship-Ready", "green"],
            ]),
          },
        },
        Completion: { rich_text: {} },
        Readiness: { rich_text: {} },
        "Registry Status": {
          select: {
            options: colorize([
              ["active", "green"],
              ["recent", "blue"],
              ["parked", "gray"],
              ["archived", "brown"],
              ["unknown", "default"],
            ]),
          },
        },
        "Primary Tool": {
          select: {
            options: colorize([
              ["codex", "blue"],
              ["claude-code", "purple"],
              ["gpt", "orange"],
              ["grok", "red"],
              ["unknown", "default"],
            ]),
          },
        },
        "Context Quality": {
          select: {
            options: colorize([
              ["full", "green"],
              ["standard", "blue"],
              ["boilerplate", "gray"],
              ["none", "red"],
              ["unknown", "default"],
            ]),
          },
        },
        "Merged Into": { rich_text: {} },
        "Integration Tags": {
          multi_select: {
            options: colorize([
              ["Slack", "orange"],
              ["Claude API", "purple"],
              ["GitHub", "default"],
              ["Jira", "blue"],
              ["Google Workspace", "green"],
              ["Stripe", "yellow"],
              ["Supabase", "gray"],
              ["Ollama", "pink"],
              ["Vercel", "brown"],
              ["FFmpeg", "red"],
              ["PostgreSQL", "blue"],
              ["SQLite", "gray"],
              ["Qdrant", "purple"],
              ["OCR", "orange"],
              ["YouTube", "red"],
            ]),
          },
        },
        "Effort to Demo": {
          select: {
            options: colorize([
              ["<2h", "green"],
              ["1 day", "blue"],
              ["2-3 days", "orange"],
              ["1 week+", "red"],
              ["Unknown", "gray"],
            ]),
          },
        },
        "Effort to Ship": {
          select: {
            options: colorize([
              ["<1 day", "green"],
              ["2-3 days", "blue"],
              ["1 week", "orange"],
              ["2+ weeks", "red"],
              ["Unknown", "gray"],
            ]),
          },
        },
        "Monetization / Strategic Value": { rich_text: {} },
        "Project Health Notes": { rich_text: {} },
        "Known Risks": { rich_text: {} },
        "What Works": { rich_text: {} },
        "Missing Core Pieces": { rich_text: {} },
        "Build Sessions": {
          relation: relationSchema(IDS.build),
        },
        "Related Research": {
          relation: relationSchema(IDS.research),
        },
        "Supporting Skills": {
          relation: relationSchema(IDS.skills),
        },
        "Tool Stack Records": {
          relation: relationSchema(IDS.tools),
        },
        "Last Build Session": { rich_text: {} },
        "Last Build Session Date": { date: {} },
        "Build Session Count": {
          number: { format: "number" },
        },
        "Related Research Count": {
          number: { format: "number" },
        },
        "Supporting Skills Count": {
          number: { format: "number" },
        },
        "Linked Tool Count": {
          number: { format: "number" },
        },
      },
    },
  });
}

function buildProjectProperties(project: ProjectIntelligenceRow, links: ReverseLinks): Record<string, unknown> {
  const latestBuild = links.buildSessions
    .map((page) => ({ page, date: dateFromProperty(page.properties["Session Date"]) }))
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))[0];

  const properties: Record<string, unknown> = {
    Status: selectValue(project.canonicalStatus),
    "Pipeline Stage": selectValue(project.canonicalPipelineStage),
    Category: selectValue(project.canonicalCategory),
    Verdict: selectValue(project.canonicalVerdict),
    Summary: richTextValue(project.oneLinePitch),
    "Source Group": selectValue(project.sourceGroup),
    "Local Path": richTextValue(project.localPath),
    Stack: richTextValue(project.stack),
    "Audit Notes": richTextValue(project.projectHealthNotes),
    "Key Integrations": richTextValue(project.keyIntegrations),
    "Date Updated": dateValue(project.canonicalDateUpdated || project.lastActive),
    "Needs Review": {
      checkbox: project.needsReview,
    },
    "Current State": selectValue(project.currentState),
    "Portfolio Call": selectValue(project.portfolioCall),
    "One-Line Pitch": richTextValue(project.oneLinePitch),
    "Next Move": richTextValue(project.nextMove),
    "Biggest Blocker": richTextValue(project.biggestBlocker),
    Momentum: selectValue(project.momentum),
    "Last Active": dateValue(project.lastActive),
    "Project Shape": multiSelectValue(project.projectShape),
    "Deployment Surface": multiSelectValue(project.deploymentSurface),
    "Docs Quality": selectValue(project.docsQuality),
    "Test Posture": selectValue(project.testPosture),
    "Evidence Confidence": selectValue(project.evidenceConfidence),
    "Start Here": richTextValue(project.startHere),
    "Primary Run Command": richTextValue(project.primaryRunCommand),
    "Primary Context Doc": richTextValue(project.primaryContextDoc),
    "Setup Friction": selectValue(project.setupFriction),
    "Runs Locally": selectValue(project.runsLocally),
    "Last Meaningful Work": richTextValue(project.lastMeaningfulWork),
    "Primary User": richTextValue(project.primaryUser),
    "Problem Solved": richTextValue(project.problemSolved),
    "Value / Outcome": richTextValue(project.valueOutcome),
    "Build Maturity": selectValue(project.buildMaturity),
    "Ship Readiness": selectValue(project.shipReadiness),
    Completion: richTextValue(project.completion),
    Readiness: richTextValue(project.readiness),
    "Registry Status": selectValue(normalizeRegistryValue(project.registryStatus)),
    "Primary Tool": selectValue(normalizeRegistryValue(project.primaryTool)),
    "Context Quality": selectValue(normalizeRegistryValue(project.contextQuality)),
    "Merged Into": richTextValue(project.mergedInto),
    "Integration Tags": multiSelectValue(
      deriveIntegrationTags(project.keyIntegrations, project.stack, project.oneLinePitch),
    ),
    "Effort to Demo": selectValue(project.effortToDemo),
    "Effort to Ship": selectValue(project.effortToShip),
    "Monetization / Strategic Value": richTextValue(project.monetizationValue),
    "Project Health Notes": richTextValue(project.projectHealthNotes),
    "Known Risks": richTextValue(project.knownRisks),
    "What Works": richTextValue(project.whatWorks),
    "Missing Core Pieces": richTextValue(project.missingCorePieces),
    "Build Sessions": relationValue(links.buildSessions.map((page) => page.id)),
    "Related Research": relationValue(links.research.map((page) => page.id)),
    "Supporting Skills": relationValue(links.skills.map((page) => page.id)),
    "Tool Stack Records": relationValue(links.tools.map((page) => page.id)),
    "Last Build Session": richTextValue(latestBuild?.page.title ?? ""),
    "Last Build Session Date": dateValue(latestBuild?.date ?? ""),
    "Build Session Count": { number: links.buildSessions.length },
    "Related Research Count": { number: links.research.length },
    "Supporting Skills Count": { number: links.skills.length },
    "Linked Tool Count": { number: links.tools.length },
  };

  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function buildCreateProjectProperties(project: ProjectIntelligenceRow, links: ReverseLinks): Record<string, unknown> {
  return {
    Name: {
      title: [
        {
          type: "text",
          text: {
            content: project.projectName,
          },
        },
      ],
    },
    ...buildProjectProperties(project, links),
  };
}

function buildReverseLinks(
  localPages: DataSourcePageRef[],
  sources: {
    buildPages: DataSourcePageRef[];
    researchPages: DataSourcePageRef[];
    skillPages: DataSourcePageRef[];
    toolPages: DataSourcePageRef[];
  },
): Map<string, ReverseLinks> {
  const links = new Map<string, ReverseLinks>();
  for (const page of localPages) {
    links.set(page.id, {
      buildSessions: [],
      research: [],
      skills: [],
      tools: [],
    });
  }

  const pushLinks = (
    pages: DataSourcePageRef[],
    propertyName: string,
    target: keyof ReverseLinks,
  ) => {
    for (const page of pages) {
      const relations = page.properties[propertyName]?.relation ?? [];
      for (const relation of relations) {
        const projectId = normalizeNotionId(relation.id);
        const bucket = links.get(projectId);
        if (!bucket) {
          continue;
        }
        bucket[target].push(page);
      }
    }
  };

  pushLinks(sources.buildPages, "Local Project", "buildSessions");
  pushLinks(sources.researchPages, "Related Local Projects", "research");
  pushLinks(sources.skillPages, "Related Local Projects", "skills");
  pushLinks(sources.toolPages, "Linked Local Projects", "tools");

  return links;
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

async function summarizeCoverage(sdk: Client, expectedRows: number): Promise<Record<string, number>> {
  const response = (await sdk.request({
    path: `data_sources/${IDS.localProjects}/query`,
    method: "post",
    body: {
      page_size: 100,
    },
  })) as {
    results?: Array<{ properties?: Record<string, NotionPageProperty> }>;
  };

  const rows = response.results ?? [];
  const fields = [
    "Current State",
    "Portfolio Call",
    "One-Line Pitch",
    "Next Move",
    "Biggest Blocker",
    "Momentum",
    "Last Active",
    "Project Shape",
    "Deployment Surface",
    "Docs Quality",
    "Test Posture",
    "Evidence Confidence",
    "Start Here",
    "Primary Run Command",
    "Build Maturity",
    "Ship Readiness",
    "Completion",
    "Readiness",
    "Registry Status",
    "Primary Tool",
    "Context Quality",
    "Merged Into",
    "Integration Tags",
  ];

  const coverage: Record<string, number> = {
    expectedRows,
    actualRows: rows.length,
  };

  for (const field of fields) {
    coverage[field] = rows.filter((row) => isPropertyFilled(row.properties?.[field])).length;
  }

  return coverage;
}

function isPropertyFilled(property?: NotionPageProperty): boolean {
  if (!property) {
    return false;
  }
  if (property.type === "select") {
    return Boolean(property.select?.name);
  }
  if (property.type === "rich_text") {
    return (property.rich_text ?? []).some((entry) => Boolean(entry.plain_text?.trim()));
  }
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).length > 0;
  }
  if (property.type === "relation") {
    return (property.relation ?? []).length > 0;
  }
  if (property.type === "date") {
    return Boolean(property.date?.start);
  }
  if (property.type === "number") {
    return typeof property.number === "number";
  }
  if (property.type === "checkbox") {
    return true;
  }
  return false;
}

function titleFromProperty(property?: NotionPageProperty): string {
  return (property?.title ?? []).map((part) => part.plain_text ?? "").join("").trim();
}

function richTextValue(value: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return {
    rich_text: chunkText(value).map((content) => ({
      type: "text",
      text: { content },
    })),
  };
}

function selectValue(value?: string): { select: { name: string } | null } | undefined {
  if (!value) {
    return undefined;
  }
  return { select: { name: value } };
}

function multiSelectValue(values: string[]): { multi_select: Array<{ name: string }> } {
  return {
    multi_select: values.filter(Boolean).map((name) => ({ name })),
  };
}

function relationValue(values: string[]): { relation: Array<{ id: string }> } {
  return {
    relation: values.map((id) => ({ id })),
  };
}

function deriveIntegrationTags(keyIntegrations: string, stack: string, summary: string): string[] {
  const haystack = `${keyIntegrations} ${stack} ${summary}`.toLowerCase();
  const tags = new Set<string>();

  const keywords: Array<[string, RegExp]> = [
    ["Slack", /\bslack\b/],
    ["Claude API", /\bclaude api\b|\banthropic\b/],
    ["GitHub", /\bgithub\b/],
    ["Jira", /\bjira\b/],
    ["Google Workspace", /\bgoogle workspace\b|\bgoogle calendar\b|\bgoogle tasks\b|\bgoogle sheets\b/],
    ["Stripe", /\bstripe\b/],
    ["Supabase", /\bsupabase\b/],
    ["Ollama", /\bollama\b|\bllama\.cpp\b|\blm studio\b/],
    ["Vercel", /\bvercel\b/],
    ["FFmpeg", /\bffmpeg\b/],
    ["PostgreSQL", /\bpostgres\b|\bpostgresql\b|\bpgvector\b/],
    ["SQLite", /\bsqlite\b|\bfts5\b|\bsqlcipher\b/],
    ["Qdrant", /\bqdrant\b/],
    ["OCR", /\bocr\b|\bvision\b|\btesseract\b/],
    ["YouTube", /\byoutube\b/],
  ];

  for (const [label, pattern] of keywords) {
    if (pattern.test(haystack)) {
      tags.add(label);
    }
  }

  return [...tags];
}

function normalizeRegistryValue(value: string): string | undefined {
  const normalized = value.trim().replace(/\.$/, "");
  return normalized || undefined;
}

function dateValue(value: string): { date: { start: string } | null } | undefined {
  if (!value) {
    return undefined;
  }
  return {
    date: {
      start: value,
    },
  };
}

function chunkText(value: string, maxLength = 1900): string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
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

function dateFromProperty(property?: NotionPageProperty): string | undefined {
  return property?.date?.start ?? undefined;
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
