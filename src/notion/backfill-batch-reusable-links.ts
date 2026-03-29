import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  multiSelectValue,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface BatchTarget {
  title: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
}

interface ResearchSeed {
  title: string;
  category: string;
  summary: string;
  keyFindings: string;
  actionable: string;
  confidence: string;
  sources: string;
  sourceUrl?: string;
  tags: string[];
  relatedToolTitles: string[];
  relatedProjectTitles: string[];
  researchType: string;
  decisionImpact: string;
  revalidationCadence: string;
  markdown: string;
}

interface SkillSeed {
  title: string;
  category: string;
  reviewCadence: string;
  projectRelevance: string;
  status: string;
  proofTypes: string[];
  lastPracticed: string;
  proficiency: number;
  notes: string;
  sourceTags: string[];
  relatedProjectTitles: string[];
  projectsText: string;
  markdown: string;
}

interface ToolSeed {
  title: string;
  website: string;
  pricingModel: string;
  whatIPay: string;
  delightScore: number;
  platform: string[];
  stackIntegration: string[];
  dateFirstUsed: string;
  myRole: string;
  oneLiner: string;
  whatFrustrates: string;
  comparedTo: string;
  whatDelights: string;
  subscriptionTier: string;
  tags: string[];
  lastReviewed: string;
  status: string;
  category: string;
  myUseCases: string;
  utilityScore: number;
  relatedProjectTitles: string[];
  markdown: string;
}

interface BatchFlags {
  live: boolean;
  today: string;
}

interface BackfillRunResult {
  ok: true;
  live: boolean;
  today: string;
  results: Array<{
    title: string;
    relatedResearchCount: number;
    supportingSkillsCount: number;
    linkedToolCount: number;
  }>;
}

const TODAY = losAngelesToday();
const COMMON_TOOLS = ["GitHub", "Codex CLI (OpenAI)"];

const TARGETS: BatchTarget[] = [
  {
    title: "DevToolsTranslator",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
    ],
    skillTitles: ["React", "CI/CD", "window.storage API"],
    toolTitles: [...COMMON_TOOLS, "Chrome"],
  },
  {
    title: "JobCommandCenter",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
    ],
    skillTitles: ["Python", "Git", "CI/CD"],
    toolTitles: [...COMMON_TOOLS, "LinkedIn"],
  },
  {
    title: "GPT_RAG",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Local RAG Should Prove Retrieval Quality Before Deployment",
    ],
    skillTitles: ["Python", "RAG", "Prompt Engineering"],
    toolTitles: [...COMMON_TOOLS, "Notion"],
  },
  {
    title: "Recall",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Godot Projects Need Boot Proof Before Readiness Claims",
    ],
    skillTitles: ["Godot / GDScript", "Git"],
    toolTitles: [...COMMON_TOOLS, "Godot Engine"],
  },
  {
    title: "Phantom Frequencies",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Godot Projects Need Boot Proof Before Readiness Claims",
    ],
    skillTitles: ["Godot / GDScript", "Git"],
    toolTitles: [...COMMON_TOOLS, "Godot Engine"],
  },
];

const RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Governed GitHub Issues Should Match the Current Execution Slice",
    category: "Operations",
    summary:
      "Active GitHub lanes stay trustworthy only when the governed issue matches the real next slice instead of stale kickoff wording.",
    keyFindings:
      "The operating layer is strongest when one active issue carries the current blocker list, check posture, and done-state tied to evidence.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 21-22, 2026 live review of DevToolsTranslator, JobCommandCenter, GPT_RAG, Recall, and Phantom Frequencies across Notion, local repos, and GitHub.",
    tags: ["github", "operations", "portfolio"],
    relatedToolTitles: ["GitHub", "Notion", "Codex CLI (OpenAI)"],
    relatedProjectTitles: TARGETS.map((target) => target.title),
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Governed GitHub Issues Should Match the Current Execution Slice",
      "",
      "## Summary",
      "When a project already has an active GitHub lane, the governed issue should describe the slice that is current now, not the slice that was current when the lane was opened.",
      "",
      "## Operating rule",
      "- Keep one issue as the current slice owner.",
      "- Refresh the issue when blockers or evidence needs materially change.",
      "- Keep Notion and GitHub aligned on next move, blocker, and done-state.",
      "",
      "## Why it matters",
      "This prevents stale GitHub wording from making a project look less blocked or more complete than it really is.",
    ].join("\n"),
  },
  {
    title: "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
    category: "Engineering",
    summary:
      "Finish-track projects usually stall on proof and release inputs rather than on missing major features.",
    keyFindings:
      "Near-ship work needs packaging proof, green checks on the branch that matters, and explicit sign-off or credential inputs before the finish call is credible.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 21-22, 2026 finish-batch review of DevToolsTranslator and JobCommandCenter release blockers, packaging proof, and workflow posture.",
    tags: ["release", "desktop", "validation"],
    relatedToolTitles: ["GitHub", "Chrome", "LinkedIn"],
    relatedProjectTitles: ["DevToolsTranslator", "JobCommandCenter"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "",
      "## Summary",
      "Once a project is on the finish track, the blockers are usually proof and release inputs, not a missing feature category.",
      "",
      "## Evidence to require",
      "- Packaging or bundle proof",
      "- Green checks on the real operating branch",
      "- Manual sign-off items and release credentials",
      "- A blocker list that names the actual remaining gates",
      "",
      "## Why it matters",
      "This keeps finish-track projects from drifting in a permanently almost-done state.",
    ].join("\n"),
  },
  {
    title: "Local RAG Should Prove Retrieval Quality Before Deployment",
    category: "AI / Retrieval",
    summary:
      "A local RAG system should earn trust through bounded indexing and answer-quality proof before deployment is treated as the next milestone.",
    keyFindings:
      "The right order is corpus slice, vector coverage, semantic or hybrid retrieval quality, and only then a deployment decision if one is still needed.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 21-22, 2026 review of GPT_RAG local corpus evidence, retrieval-hardening needs, and unresolved deployment posture.",
    tags: ["rag", "retrieval", "local-first"],
    relatedToolTitles: ["GitHub", "Notion", "Codex CLI (OpenAI)"],
    relatedProjectTitles: ["GPT_RAG"],
    researchType: "Architecture",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Local RAG Should Prove Retrieval Quality Before Deployment",
      "",
      "## Summary",
      "For a local-first RAG project, deployment is not automatically the next milestone. Retrieval quality is.",
      "",
      "## Validation order",
      "- Prove the bounded corpus slice",
      "- Confirm vector coverage is sufficient",
      "- Validate semantic or hybrid retrieval on targeted topics",
      "- Decide later whether a deployment surface is actually needed",
      "",
      "## Why it matters",
      "This keeps deployment work from masking the fact that the retrieval system still needs quality proof.",
    ].join("\n"),
  },
  {
    title: "Godot Projects Need Boot Proof Before Readiness Claims",
    category: "Game Development",
    summary:
      "In early Godot projects, a clean boot proof is the minimum reliable evidence before stronger gameplay or readiness claims are made.",
    keyFindings:
      "Boot viability, missing-asset hygiene, and a minimal validation path should come before stronger claims about gameplay readiness or shipping posture.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 21-22, 2026 headless Godot checks and operating review of Recall and Phantom Frequencies.",
    tags: ["godot", "games", "validation"],
    relatedToolTitles: ["GitHub", "Codex CLI (OpenAI)", "Godot Engine"],
    relatedProjectTitles: ["Recall", "Phantom Frequencies"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Godot Projects Need Boot Proof Before Readiness Claims",
      "",
      "## Summary",
      "Early Godot projects are healthiest when the first proof is a working boot plus a clear note of any initialization errors or missing assets.",
      "",
      "## What counts as minimum proof",
      "- The project boots locally",
      "- Asset or initialization errors are documented",
      "- The next gameplay proof step is explicit",
      "- Readiness language stays conservative until gameplay evidence exists",
      "",
      "## Why it matters",
      "This keeps early game work honest while still recognizing real progress.",
    ].join("\n"),
  },
];

const SKILL_SEEDS: SkillSeed[] = [
  {
    title: "Godot / GDScript",
    category: "Game Development",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Prototype"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes:
      "Used for scene-first prototyping, headless boot validation, and early gameplay-system iteration in the local Godot projects.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["Recall", "Phantom Frequencies"],
    projectsText: "Recall; Phantom Frequencies",
    markdown: [
      "# Godot / GDScript",
      "",
      "## Why this skill exists",
      "This skill captures practical Godot and GDScript work used to boot, debug, and iterate on early local game projects.",
      "",
      "## Proof",
      "- Local Godot boot verification",
      "- Scene and script iteration in Recall and Phantom Frequencies",
      "- Early gameplay-system debugging and validation",
    ].join("\n"),
  },
];

const TOOL_SEEDS: ToolSeed[] = [
  {
    title: "Godot Engine",
    website: "https://godotengine.org/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 8,
    platform: ["Desktop"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Open-source game engine used for local boot checks, scene iteration, and prototype gameplay work.",
    whatFrustrates:
      "Early projects can look healthier than they are if boot errors, missing assets, or gameplay proof are not tracked clearly.",
    comparedTo: "Unity",
    whatDelights: "Fast local iteration, strong scene workflow, and simple headless proof for foundation checks.",
    subscriptionTier: "Free",
    tags: ["godot", "game-dev", "engine"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Local boot validation, scene iteration, gameplay prototyping, and foundation checks for Godot projects.",
    utilityScore: 8,
    relatedProjectTitles: ["Recall", "Phantom Frequencies"],
    markdown: [
      "# Godot Engine",
      "",
      "## Use cases",
      "- Local boot and smoke validation",
      "- Scene and system iteration",
      "- Early gameplay and asset debugging",
      "",
      "## Why it matters",
      "This is the core tool for the current Godot-based game projects in the local portfolio.",
    ].join("\n"),
  },
];

export async function runBatchReusableLinkBackfill(flags: BatchFlags): Promise<BackfillRunResult> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for batch reusable-link backfill");
  }

  const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);

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

  const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  ensurePagesExist(projectByTitle, TARGETS.map((target) => target.title), "project");

  let toolByTitle = new Map(toolPages.map((page) => [page.title, page]));
  let skillByTitle = new Map(skillPages.map((page) => [page.title, page]));
  let researchByTitle = new Map(researchPages.map((page) => [page.title, page]));

  if (flags.live) {
    await upsertToolSeeds({
      api,
      dataSourceId: config.relatedDataSources.toolsId,
      titlePropertyName: toolSchema.titlePropertyName,
      projectByTitle,
      seeds: TOOL_SEEDS,
    });
    await upsertSkillSeeds({
      api,
      dataSourceId: config.relatedDataSources.skillsId,
      titlePropertyName: skillSchema.titlePropertyName,
      projectByTitle,
      seeds: SKILL_SEEDS,
    });

    const [nextToolPages, nextSkillPages] = await Promise.all([
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    ]);
    toolByTitle = new Map(nextToolPages.map((page) => [page.title, page]));
    skillByTitle = new Map(nextSkillPages.map((page) => [page.title, page]));

    await upsertResearchSeeds({
      api,
      dataSourceId: config.relatedDataSources.researchId,
      titlePropertyName: researchSchema.titlePropertyName,
      projectByTitle,
      toolByTitle,
      seeds: RESEARCH_SEEDS,
      today: flags.today,
    });
    const nextResearchPages = await fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName);
    researchByTitle = new Map(nextResearchPages.map((page) => [page.title, page]));
  } else {
    toolByTitle = mergeVirtualPages(toolByTitle, TOOL_SEEDS.map((seed) => seed.title), "tool");
    skillByTitle = mergeVirtualPages(skillByTitle, SKILL_SEEDS.map((seed) => seed.title), "skill");
    researchByTitle = mergeVirtualPages(researchByTitle, RESEARCH_SEEDS.map((seed) => seed.title), "research");
  }

  ensurePagesExist(toolByTitle, uniqueTitles(TARGETS.flatMap((target) => target.toolTitles)), "tool");
  ensurePagesExist(skillByTitle, uniqueTitles(TARGETS.flatMap((target) => target.skillTitles)), "skill");
  ensurePagesExist(researchByTitle, uniqueTitles(TARGETS.flatMap((target) => target.researchTitles)), "research");

  const results = [];

  for (const target of TARGETS) {
    const projectPage = requirePage(projectByTitle, target.title, "project");
    const researchIds = uniqueIds([
      ...relationIds(projectPage.properties["Related Research"]),
      ...target.researchTitles.map((title) => requirePage(researchByTitle, title, "research").id),
    ]);
    const skillIds = uniqueIds([
      ...relationIds(projectPage.properties["Supporting Skills"]),
      ...target.skillTitles.map((title) => requirePage(skillByTitle, title, "skill").id),
    ]);
    const toolIds = uniqueIds([
      ...relationIds(projectPage.properties["Tool Stack Records"]),
      ...target.toolTitles.map((title) => requirePage(toolByTitle, title, "tool").id),
    ]);

    if (flags.live) {
      await api.updatePageProperties({
        pageId: projectPage.id,
        properties: {
          "Related Research": relationValue(researchIds),
          "Supporting Skills": relationValue(skillIds),
          "Tool Stack Records": relationValue(toolIds),
          "Related Research Count": { number: researchIds.length },
          "Supporting Skills Count": { number: skillIds.length },
          "Linked Tool Count": { number: toolIds.length },
        },
      });
    }

    results.push({
      title: target.title,
      projectId: projectPage.id,
      researchIds,
      skillIds,
      toolIds,
    });
  }

  if (flags.live) {
    await syncReverseRelations({
      api,
      targets: TARGETS,
      results,
      researchByTitle,
      skillByTitle,
      toolByTitle,
    });
  }

  return {
    ok: true,
    live: flags.live,
    today: flags.today,
    results: results.map((result) => ({
      title: result.title,
      relatedResearchCount: result.researchIds.length,
      supportingSkillsCount: result.skillIds.length,
      linkedToolCount: result.toolIds.length,
    })),
  };
}

async function main(): Promise<void> {
  try {
    const result = await runBatchReusableLinkBackfill(parseFlags(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

async function upsertResearchSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  toolByTitle: Map<string, DataSourcePageRef>;
  seeds: ResearchSeed[];
  today: string;
}): Promise<void> {
  for (const seed of input.seeds) {
    await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.title,
      properties: {
        [input.titlePropertyName]: titleValue(seed.title),
        Category: selectPropertyValue(seed.category),
        Summary: richTextValue(seed.summary),
        "Key Findings": richTextValue(seed.keyFindings),
        Actionable: selectPropertyValue(seed.actionable),
        Confidence: selectPropertyValue(seed.confidence),
        Sources: richTextValue(seed.sources),
        "Source URLs": { url: seed.sourceUrl ?? null },
        "Date Researched": { date: { start: input.today } },
        "Last Verified": { date: { start: input.today } },
        Tags: multiSelectValue(seed.tags),
        "Related Tools": relationValue(seed.relatedToolTitles.map((title) => requirePage(input.toolByTitle, title, "tool").id)),
        "Related Local Projects": relationValue(
          seed.relatedProjectTitles.map((title) => requirePage(input.projectByTitle, title, "project").id),
        ),
        "Related Projects": relationValue([]),
        "Research Type": selectPropertyValue(seed.researchType),
        "Decision Impact": selectPropertyValue(seed.decisionImpact),
        "Revalidation Cadence": selectPropertyValue(seed.revalidationCadence),
      },
      markdown: seed.markdown,
    });
  }
}

async function upsertSkillSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  seeds: SkillSeed[];
}): Promise<void> {
  for (const seed of input.seeds) {
    await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.title,
      properties: {
        [input.titlePropertyName]: titleValue(seed.title),
        Projects: richTextValue(seed.projectsText),
        Category: selectPropertyValue(seed.category),
        "Review Cadence": selectPropertyValue(seed.reviewCadence),
        "Project Relevance": selectPropertyValue(seed.projectRelevance),
        "Related Local Projects": relationValue(
          seed.relatedProjectTitles.map((title) => requirePage(input.projectByTitle, title, "project").id),
        ),
        Status: selectPropertyValue(seed.status),
        "Proof Type": multiSelectValue(seed.proofTypes),
        "Last Practiced": { date: { start: seed.lastPracticed } },
        Proficiency: { number: seed.proficiency },
        Notes: richTextValue(seed.notes),
        "Needs Link Review": { checkbox: false },
        Source: multiSelectValue(seed.sourceTags),
      },
      markdown: seed.markdown,
    });
  }
}

async function upsertToolSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  seeds: ToolSeed[];
}): Promise<void> {
  for (const seed of input.seeds) {
    await upsertPageByTitle({
      api: input.api,
      dataSourceId: input.dataSourceId,
      titlePropertyName: input.titlePropertyName,
      title: seed.title,
      properties: {
        [input.titlePropertyName]: titleValue(seed.title),
        Website: { url: seed.website },
        "Pricing Model": selectPropertyValue(seed.pricingModel),
        "What I Pay": richTextValue(seed.whatIPay),
        "Delight Score": { number: seed.delightScore },
        Platform: multiSelectValue(seed.platform),
        "Linked Local Projects": relationValue(
          seed.relatedProjectTitles.map((title) => requirePage(input.projectByTitle, title, "project").id),
        ),
        "Stack Integration": multiSelectValue(seed.stackIntegration),
        "Date First Used": { date: { start: seed.dateFirstUsed } },
        "My Role": selectPropertyValue(seed.myRole),
        "One-Liner": richTextValue(seed.oneLiner),
        "What Frustrates": richTextValue(seed.whatFrustrates),
        "Compared To": richTextValue(seed.comparedTo),
        "What Delights": richTextValue(seed.whatDelights),
        "Subscription Tier": richTextValue(seed.subscriptionTier),
        Tags: multiSelectValue(seed.tags),
        "Last Reviewed": { date: { start: seed.lastReviewed } },
        Status: selectPropertyValue(seed.status),
        Category: selectPropertyValue(seed.category),
        "My Use Cases": richTextValue(seed.myUseCases),
        "Utility Score": { number: seed.utilityScore },
      },
      markdown: seed.markdown,
    });
  }
}

async function syncReverseRelations(input: {
  api: DirectNotionClient;
  targets: BatchTarget[];
  results: Array<{ title: string; projectId: string }>;
  researchByTitle: Map<string, DataSourcePageRef>;
  skillByTitle: Map<string, DataSourcePageRef>;
  toolByTitle: Map<string, DataSourcePageRef>;
}): Promise<void> {
  const projectIdByTitle = new Map(input.results.map((result) => [result.title, result.projectId]));

  for (const target of input.targets) {
    const projectId = projectIdByTitle.get(target.title);
    if (!projectId) {
      continue;
    }

    for (const title of target.researchTitles) {
      const page = requirePage(input.researchByTitle, title, "research");
      const relatedIds = uniqueIds([...relationIds(page.properties["Related Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(relatedIds),
        },
      });
    }

    for (const title of target.skillTitles) {
      const page = requirePage(input.skillByTitle, title, "skill");
      const relatedIds = uniqueIds([...relationIds(page.properties["Related Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(relatedIds),
        },
      });
    }

    for (const title of target.toolTitles) {
      const page = requirePage(input.toolByTitle, title, "tool");
      const relatedIds = uniqueIds([...relationIds(page.properties["Linked Local Projects"]), projectId]);
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Linked Local Projects": relationValue(relatedIds),
        },
      });
    }
  }
}

function mergeVirtualPages(
  pageMap: Map<string, DataSourcePageRef>,
  titles: string[],
  prefix: string,
): Map<string, DataSourcePageRef> {
  const merged = new Map(pageMap);
  for (const title of titles) {
    if (!merged.has(title)) {
      merged.set(title, {
        id: `dry-run-${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        url: "",
        title,
        properties: {},
      });
    }
  }
  return merged;
}

function ensurePagesExist(pageMap: Map<string, DataSourcePageRef>, titles: string[], kind: string): void {
  for (const title of titles) {
    if (!pageMap.has(title)) {
      throw new AppError(`Could not find ${kind} page for "${title}"`);
    }
  }
}

function requirePage(pageMap: Map<string, DataSourcePageRef>, title: string, kind: string): DataSourcePageRef {
  const page = pageMap.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page for "${title}"`);
  }
  return page;
}

function relationIds(
  property?: {
    relation?: Array<{ id: string }>;
  },
): string[] {
  return (property?.relation ?? []).map((entry) => entry.id);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function uniqueTitles(titles: string[]): string[] {
  return [...new Set(titles)];
}

function parseFlags(argv: string[]): BatchFlags {
  let live = false;
  let today = losAngelesToday();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
    }
  }

  return { live, today };
}

if (process.argv[1]?.endsWith("backfill-batch-reusable-links.ts")) {
  void main();
}
