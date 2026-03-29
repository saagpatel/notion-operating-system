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
  relationIds,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface SkillSeed {
  title: string;
  category: "Frameworks" | "DevTools";
  reviewCadence: "Monthly";
  projectRelevance: "Core";
  status: "Active";
  proofTypes: string[];
  lastPracticed: string;
  proficiency: number;
  notes: string;
  sourceTags: string[];
  relatedProjectTitles: string[];
  projectsText: string;
  markdown: string;
}

interface ProjectCompletionConfig {
  title: string;
  contextQuality: "full" | "standard";
  registryStatus: "active" | "archived" | "parked";
  primaryTool?: "codex";
  completion: string;
  readiness?: string;
  keyIntegrations: string;
  mergedInto: string;
  monetizationValue: string;
  valueOutcome: string;
  latestExternalActivity?: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
}

interface ReferenceArtifacts {
  buildLogId: string;
  decisionId: string;
  packetId: string;
  taskId: string;
  buildTitle: string;
}

const TODAY = losAngelesToday();
const COMPLETION_RUN_TITLE = `Batch completion run - ${TODAY} - current batch`;

const SKILL_SEEDS: SkillSeed[] = [
  {
    title: "Three.js",
    category: "Frameworks",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Prototype", "Hands-on"],
    lastPracticed: TODAY,
    proficiency: 2,
    notes:
      "Used to reason about 3D scene/runtime baselines and dependency health in the current local graphics-heavy projects.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["OrbitForge (staging)", "TerraSynth"],
    projectsText: "OrbitForge (staging); TerraSynth",
    markdown: [
      "# Three.js",
      "",
      "## Why this skill exists",
      "This skill captures practical Three.js work surfaced by the current 3D-heavy local projects.",
      "",
      "## Proof",
      "- OrbitForge (staging) dependency and typecheck baseline references Three.js",
      "- TerraSynth reactivation criteria now explicitly call out the Three.js type/runtime baseline",
    ].join("\n"),
  },
  {
    title: "Xcode / Native macOS Builds",
    category: "DevTools",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Hands-on", "Production Use"],
    lastPracticed: TODAY,
    proficiency: 2,
    notes:
      "Used for local native macOS validation, build/test execution, and finish-readiness checks on Xcode-based projects.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["Conductor"],
    projectsText: "Conductor",
    markdown: [
      "# Xcode / Native macOS Builds",
      "",
      "## Why this skill exists",
      "This skill captures hands-on native macOS build and test validation through Xcode and `xcodebuild`.",
      "",
      "## Proof",
      "- Conductor local debug build passed during the batch completion run",
      "- Conductor local test suite passed through `xcodebuild test`",
    ].join("\n"),
  },
];

const TOOL_TITLES = ["Codex CLI (OpenAI)", "GitHub", "Git", "Notion"];

const PROJECT_CONFIGS: ProjectCompletionConfig[] = [
  {
    title: "Chronomap",
    contextQuality: "full",
    registryStatus: "active",
    primaryTool: "codex",
    completion:
      "Operating flow completion is now done: GitHub repo, governed issue lane, execution records, and project evidence are all live. The remaining completion risk is product-level, not operational.",
    readiness:
      "Operationally ready. Product validation is still blocked until the frontend dependency baseline is restored and typecheck can reach the next real failure.",
    keyIntegrations:
      "Tauri desktop shell, React/TypeScript frontend, Rust app layer, GitHub governed issue flow, and Notion control-tower tracking.",
    mergedInto: "Standalone canonical repo.",
    monetizationValue:
      "High strategic value as the strongest current execution candidate in this batch and a proving ground for the local Tauri + React + Rust operating flow.",
    valueOutcome:
      "Once the dependency baseline is restored, Chronomap is positioned to become the clearest near-term demo and the best signal project for active build momentum.",
    latestExternalActivity: TODAY,
    researchTitles: [
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Weekly Reviews Should Roll Up From Build Log",
    ],
    skillTitles: ["Codex CLI", "Git", "CI/CD", "React", "TypeScript", "Tauri", "Rust"],
    toolTitles: TOOL_TITLES,
  },
  {
    title: "Conductor",
    contextQuality: "full",
    registryStatus: "active",
    primaryTool: "codex",
    completion:
      "Operating flow completion is now done and the project has real local proof behind it. Remaining work is finish-oriented polish and release slicing rather than basic repo setup.",
    readiness:
      "Most technically ready project in this batch. Native build and test proof are both passing locally, so the next move is a bounded finish slice.",
    keyIntegrations:
      "Native macOS/Xcode build pipeline, local test execution through `xcodebuild`, governed GitHub issue flow, and Notion execution tracking.",
    mergedInto: "Standalone canonical repo.",
    monetizationValue:
      "High strategic value as a proof-positive native macOS project that can move from setup into finish mode with strong validation evidence already in hand.",
    valueOutcome:
      "Conductor now serves as the batch's strongest credibility project because it already has passing native build and test evidence, making it the cleanest finish candidate.",
    latestExternalActivity: TODAY,
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Weekly Reviews Should Roll Up From Build Log",
    ],
    skillTitles: ["Codex CLI", "Git", "CI/CD", "Documentation & Runbooks", "Xcode / Native macOS Builds"],
    toolTitles: TOOL_TITLES,
  },
  {
    title: "Echolocate",
    contextQuality: "full",
    registryStatus: "active",
    primaryTool: "codex",
    completion:
      "Operating flow completion is now done: the repo is mapped, the first governed issue exists, and the project is no longer stuck in a local-only state.",
    readiness:
      "Operationally ready. Technical readiness still depends on restoring the missing formatter/tooling dependency so lint and deeper checks can run meaningfully.",
    keyIntegrations:
      "Tauri desktop stack, React/TypeScript frontend, Rust runtime layer, GitHub governed issue flow, and Notion execution tracking.",
    mergedInto: "Standalone canonical repo.",
    monetizationValue:
      "Strategic value comes from turning a broad bootstrap/hardening effort into a governed execution lane that can expose the next real engineering blocker quickly.",
    valueOutcome:
      "Echolocate is now positioned to move from vague local progress into a real active-build narrative, with the formatter baseline serving as the first clear unblock step.",
    latestExternalActivity: TODAY,
    researchTitles: [
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Weekly Reviews Should Roll Up From Build Log",
    ],
    skillTitles: ["Codex CLI", "Git", "React", "TypeScript", "Tauri", "Rust"],
    toolTitles: TOOL_TITLES,
  },
  {
    title: "OrbitForge (staging)",
    contextQuality: "full",
    registryStatus: "active",
    primaryTool: "codex",
    completion:
      "Batch-level completion is now done for the canonical OrbitForge surface: the duplicate-story problem is normalized, the governed issue lane is live, and the staging repo is the single active delivery surface.",
    readiness:
      "Operationally ready, but not product-ready until the missing dependency baseline is restored and the first real post-install finish blocker is captured.",
    keyIntegrations:
      "Canonical OrbitForge staging repo, React/TypeScript app surface, 3D rendering baseline through Three.js, governed GitHub issue flow, and Notion execution tracking.",
    mergedInto: "This is the canonical OrbitForge delivery surface; the base OrbitForge row should merge into this execution lane.",
    monetizationValue:
      "Strategic value comes from consolidating the duplicate OrbitForge story into one finish lane and preserving only one source of execution truth.",
    valueOutcome:
      "OrbitForge (staging) now carries the real finish narrative for the project and can move forward without the old duplicate-row ambiguity.",
    latestExternalActivity: TODAY,
    researchTitles: [
      "Tauri 2 plus React plus Rust Is the Default Local App Stack",
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Governed GitHub Issues Should Match the Current Execution Slice",
    ],
    skillTitles: ["Codex CLI", "Git", "React", "TypeScript", "Tauri", "Rust", "Three.js"],
    toolTitles: TOOL_TITLES,
  },
  {
    title: "TerraSynth",
    contextQuality: "full",
    registryStatus: "archived",
    primaryTool: "codex",
    completion:
      "Archive-track completion is now done: TerraSynth is explicitly mapped into GitHub and Notion with clear reactivation criteria instead of floating in ambiguous limbo.",
    readiness:
      "Not an active ship candidate right now. Reactivation would begin by restoring the install baseline and rechecking the Three.js type/runtime surface.",
    keyIntegrations:
      "Archived project tracking in Notion, governed GitHub issue lane for future reactivation context, and a graphics/runtime baseline that currently points at Three.js typing health.",
    mergedInto: "Standalone archived repo.",
    monetizationValue:
      "Current strategic value is portfolio clarity and future optionality rather than near-term shipping; the important outcome is that archive posture and reactivation criteria are now explicit.",
    valueOutcome:
      "TerraSynth is no longer a hidden archive edge case. It now has a documented path for future revival if priorities change.",
    latestExternalActivity: TODAY,
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Weekly Reviews Should Roll Up From Build Log",
      "Notion Works Best as an Operations Layer Backed by Local Source Data",
    ],
    skillTitles: ["Codex CLI", "Git", "TypeScript", "Three.js"],
    toolTitles: TOOL_TITLES,
  },
  {
    title: "OrbitForge",
    contextQuality: "standard",
    registryStatus: "parked",
    primaryTool: "codex",
    completion:
      "This row is now complete as a merge/reference record rather than as an active execution surface. It should not carry forward independent delivery work.",
    keyIntegrations:
      "Reference/base OrbitForge repo, merge decision into OrbitForge (staging), and Notion control-tower tracking to prevent split execution history.",
    mergedInto: "OrbitForge (staging)",
    monetizationValue:
      "No standalone product value as a separate execution lane. Its strategic value is preserving clean reference history while the staging repo carries the real work.",
    valueOutcome:
      "This row now makes the duplicate OrbitForge story explicit instead of leaving two conflicting active surfaces in the portfolio.",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Notion Works Best as an Operations Layer Backed by Local Source Data",
    ],
    skillTitles: ["Codex CLI", "Git"],
    toolTitles: TOOL_TITLES,
  },
];

function parseFlags(argv: string[]): { live: boolean; today: string } {
  let live = false;
  let today = TODAY;

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

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
  return {
    people: userId ? [{ id: userId }] : [],
  };
}

async function upsertSkillSeed(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  seed: SkillSeed;
  relatedProjectIds: string[];
}): Promise<{ id: string; url: string }> {
  const result = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.seed.title,
    properties: {
      [input.titlePropertyName]: titleValue(input.seed.title),
      Category: selectPropertyValue(input.seed.category),
      "Review Cadence": selectPropertyValue(input.seed.reviewCadence),
      "Project Relevance": selectPropertyValue(input.seed.projectRelevance),
      Status: selectPropertyValue(input.seed.status),
      "Proof Type": multiSelectValue(input.seed.proofTypes),
      "Last Practiced": { date: { start: input.seed.lastPracticed } },
      Proficiency: { number: input.seed.proficiency },
      Notes: richTextValue(input.seed.notes),
      Source: multiSelectValue(input.seed.sourceTags),
      Projects: richTextValue(input.seed.projectsText),
      "Related Local Projects": relationValue(input.relatedProjectIds),
      "Needs Link Review": { checkbox: false },
    },
    markdown: input.seed.markdown,
  });

  return {
    id: result.id,
    url: result.url,
  };
}

async function addReverseRelation(input: {
  api: DirectNotionClient;
  pageId: string;
  existingIds: string[];
  propertyName: string;
  projectIdsToAdd: string[];
}): Promise<void> {
  const nextIds = [...new Set([...input.existingIds, ...input.projectIdsToAdd])];
  await input.api.updatePageProperties({
    pageId: input.pageId,
    properties: {
      [input.propertyName]: relationValue(nextIds),
    },
  });
}

async function ensureOrbitForgeReferenceArtifacts(input: {
  api: DirectNotionClient;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  buildTitlePropertyName: string;
  decisionTitlePropertyName: string;
  packetTitlePropertyName: string;
  taskTitlePropertyName: string;
  projectId: string;
  today: string;
}): Promise<ReferenceArtifacts> {
  const buildTitle = "Batch complete - OrbitForge base reference row";
  const decisionTitle = "OrbitForge base - keep reference row non-canonical";
  const packetTitle = "OrbitForge base - maintain merge reference";
  const taskTitle = "OrbitForge base - preserve reference-only posture";

  const build = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.config.relatedDataSources.buildLogId,
    titlePropertyName: input.buildTitlePropertyName,
    title: buildTitle,
    properties: {
      [input.buildTitlePropertyName]: titleValue(buildTitle),
      "Session Date": { date: { start: input.today } },
      "Session Type": selectPropertyValue("Planning"),
      Outcome: selectPropertyValue("Shipped"),
      "What Was Planned": richTextValue(
        "Remove the last confusing blanks from the non-canonical OrbitForge base row without reopening it as an active execution surface.",
      ),
      "What Shipped": richTextValue(
        "Added a finished reference checkpoint so the base row clearly reads as a merge/reference record instead of an abandoned active project.",
      ),
      "Blockers Hit": richTextValue(
        "The only real blocker was avoiding fake active work while still backfilling the execution-history fields.",
      ),
      "Lessons Learned": richTextValue(
        "Reference rows still need explicit execution history if blank operational fields make them look half-configured.",
      ),
      "Next Steps": richTextValue(
        "Keep OrbitForge (staging) as the only active execution surface and use this base row strictly as reference context.",
      ),
      "Tools Used": multiSelectValue(["Codex CLI (OpenAI)", "Notion"]),
      "Artifacts Updated": multiSelectValue(["notion", "build-log"]),
      Tags: multiSelectValue(["portfolio", "reference", "merge"]),
      "Scope Drift": selectPropertyValue("None"),
      "Session Rating": selectPropertyValue("Good"),
      "Follow-up Needed": { checkbox: false },
      "Local Project": relationValue([input.projectId]),
      Duration: richTextValue(""),
      "Model Used": { select: null },
      "Tech Debt Created": richTextValue(""),
      "Project Decisions": relationValue([]),
      "Work Packets": relationValue([]),
      "Execution Tasks": relationValue([]),
    },
    markdown: [
      `# ${buildTitle}`,
      "",
      "## What Was Planned",
      "Remove the last confusing blanks from the non-canonical OrbitForge base row without reopening it as an active execution surface.",
      "",
      "## What Shipped",
      "Added a finished reference checkpoint so the base row clearly reads as a merge/reference record instead of an abandoned active project.",
      "",
      "## Next Steps",
      "Keep OrbitForge (staging) as the only active execution surface and use this base row strictly as reference context.",
    ].join("\n"),
  });

  const decision = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.config.phase2Execution!.decisions.dataSourceId,
    titlePropertyName: input.decisionTitlePropertyName,
    title: decisionTitle,
    properties: {
      [input.decisionTitlePropertyName]: titleValue(decisionTitle),
      Status: selectPropertyValue("Committed"),
      "Decision Type": selectPropertyValue("Portfolio"),
      "Decision Owner": peopleValue(input.config.phase2Execution?.defaultOwnerUserId),
      "Proposed On": { date: { start: input.today } },
      "Decided On": { date: { start: input.today } },
      "Revisit By": { date: { start: input.today } },
      "Local Project": relationValue([input.projectId]),
      "Chosen Option": richTextValue("Keep the base OrbitForge row as a reference-only merge record."),
      Rationale: richTextValue(
        "The staging repo is the canonical delivery surface, and the base row should describe that decision instead of pretending to be active work.",
      ),
      "Expected Impact": richTextValue(
        "The portfolio now shows one active OrbitForge surface and one explicit reference row, with no misleading execution blanks.",
      ),
      "Build Log Sessions": relationValue([build.id]),
      "Options Considered": richTextValue(
        "Leave the row partially blank, or remove it entirely, or keep it as an explicit parked merge/reference record.",
      ),
      "Decision Notes": richTextValue(
        "This decision exists to preserve clean portfolio truth, not to reopen the base repo as an execution target.",
      ),
      "Work Packets": relationValue([]),
    },
    markdown: [
      `# ${decisionTitle}`,
      "",
      "## Chosen Option",
      "Keep the base OrbitForge row as a reference-only merge record.",
      "",
      "## Rationale",
      "The staging repo is the canonical delivery surface, and the base row should describe that decision instead of pretending to be active work.",
    ].join("\n"),
  });

  const packet = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.config.phase2Execution!.packets.dataSourceId,
    titlePropertyName: input.packetTitlePropertyName,
    title: packetTitle,
    properties: {
      [input.packetTitlePropertyName]: titleValue(packetTitle),
      Status: { status: { name: "Done" } },
      "Packet Type": selectPropertyValue("Review Prep"),
      Priority: selectPropertyValue("Later"),
      Owner: peopleValue(input.config.phase2Execution?.defaultOwnerUserId),
      "Local Project": relationValue([input.projectId]),
      "Driving Decision": relationValue([decision.id]),
      Goal: richTextValue("Keep the base OrbitForge row accurate as a merge/reference record."),
      "Definition of Done": richTextValue(
        "The base row has explicit execution history and no longer looks like an unfinished active project.",
      ),
      "Why Now": richTextValue(
        "This removes the last confusing blanks from the base row while preserving OrbitForge (staging) as the only active lane.",
      ),
      "Target Start": { date: { start: input.today } },
      "Target Finish": { date: { start: input.today } },
      "Estimated Size": selectPropertyValue("1 day"),
      "Rollover Count": { number: 0 },
      "Execution Tasks": relationValue([]),
      "Build Log Sessions": relationValue([build.id]),
      "Weekly Reviews": relationValue([]),
      "Blocker Summary": richTextValue("No active engineering blocker; this packet only exists to preserve accurate reference posture."),
    },
    markdown: [
      `# ${packetTitle}`,
      "",
      "## Goal",
      "Keep the base OrbitForge row accurate as a merge/reference record.",
      "",
      "## Definition of Done",
      "The base row has explicit execution history and no longer looks like an unfinished active project.",
    ].join("\n"),
  });

  const task = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.config.phase2Execution!.tasks.dataSourceId,
    titlePropertyName: input.taskTitlePropertyName,
    title: taskTitle,
    properties: {
      [input.taskTitlePropertyName]: titleValue(taskTitle),
      Status: { status: { name: "Done" } },
      Priority: selectPropertyValue("P2"),
      "Task Type": selectPropertyValue("Decision Prep"),
      Estimate: selectPropertyValue("<2h"),
      "Due Date": { date: { start: input.today } },
      "Local Project": relationValue([input.projectId]),
      "Work Packet": relationValue([packet.id]),
      "Build Log Sessions": relationValue([build.id]),
      "Task Notes": richTextValue(
        "Reference-only cleanup task completed so the non-canonical OrbitForge row no longer carries misleading empty execution fields.",
      ),
      "Completed On": { date: { start: input.today } },
      Assignee: peopleValue(),
    },
    markdown: [
      `# ${taskTitle}`,
      "",
      "## Notes",
      "Reference-only cleanup task completed so the non-canonical OrbitForge row no longer carries misleading empty execution fields.",
    ].join("\n"),
  });

  await input.api.updatePageProperties({
    pageId: build.id,
    properties: {
      "Project Decisions": relationValue([decision.id]),
      "Work Packets": relationValue([packet.id]),
      "Execution Tasks": relationValue([task.id]),
    },
  });

  await input.api.updatePageProperties({
    pageId: packet.id,
    properties: {
      "Execution Tasks": relationValue([task.id]),
    },
  });

  await input.api.updatePageProperties({
    pageId: decision.id,
    properties: {
      "Work Packets": relationValue([packet.id]),
    },
  });

  return {
    buildLogId: build.id,
    decisionId: decision.id,
    packetId: packet.id,
    taskId: task.id,
    buildTitle,
  };
}

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for batch project completion");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase3Intelligence) {
      throw new AppError("Batch project completion requires phase 3 intelligence");
    }

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, buildSchema, researchSchema, skillSchema, toolSchema, runSchema, weeklySchema, decisionSchema, packetSchema, taskSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
      api.retrieveDataSource(config.relatedDataSources.researchId),
      api.retrieveDataSource(config.relatedDataSources.skillsId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
      api.retrieveDataSource(config.phase3Intelligence.recommendationRuns.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
      api.retrieveDataSource(config.phase2Execution!.decisions.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.tasks.dataSourceId),
    ]);

    const [projectPages, researchPages, skillPages, toolPages, weeklyPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.weeklyReviewsId, weeklySchema.titlePropertyName),
    ]);

    const projectPageByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const researchPageByTitle = new Map(researchPages.map((page) => [page.title, page]));
    let skillPageByTitle = new Map(skillPages.map((page) => [page.title, page]));
    const toolPageByTitle = new Map(toolPages.map((page) => [page.title, page]));

    const seededSkills: Array<{ title: string; id: string }> = [];

    if (flags.live) {
      for (const seed of SKILL_SEEDS) {
        const relatedProjectIds = seed.relatedProjectTitles
          .map((title) => projectPageByTitle.get(title)?.id)
          .filter((value): value is string => Boolean(value));
        if (relatedProjectIds.length === 0) {
          continue;
        }
        const page = await upsertSkillSeed({
          api,
          dataSourceId: config.relatedDataSources.skillsId,
          titlePropertyName: skillSchema.titlePropertyName,
          seed,
          relatedProjectIds,
        });
        seededSkills.push({ title: seed.title, id: page.id });
      }

      if (seededSkills.length > 0) {
        const nextSkillPages = await fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName);
        skillPageByTitle = new Map(nextSkillPages.map((page) => [page.title, page]));
      }
    }

    const weeklyReview = weeklyPages.sort((left, right) => right.title.localeCompare(left.title))[0];
    const recommendationMarkdown = [
      `# ${COMPLETION_RUN_TITLE}`,
      "",
      "## Why this run exists",
      "This ad hoc recommendation run captures the current batch completion pass so the target projects have an explicit intelligence artifact linked back into their project pages.",
      "",
      "## Current recommendation lanes",
      "- Resume: Chronomap",
      "- Finish: Conductor",
      "- Investigate: Echolocate",
      "- Finish follow-on: OrbitForge (staging)",
      "- Defer / archive: TerraSynth",
      "- Merge / reference only: OrbitForge",
    ].join("\n");

    const recommendation = flags.live
      ? await upsertPageByTitle({
          api,
          dataSourceId: config.phase3Intelligence.recommendationRuns.dataSourceId,
          titlePropertyName: runSchema.titlePropertyName,
          title: COMPLETION_RUN_TITLE,
          properties: {
            [runSchema.titlePropertyName]: titleValue(COMPLETION_RUN_TITLE),
            "Run Date": { date: { start: flags.today } },
            "Run Type": selectPropertyValue("Ad hoc"),
            Status: selectPropertyValue("Published"),
            "Model Version": richTextValue("manual-batch-completion-2026-03-22"),
            "Top Resume Project": relationValue([projectPageByTitle.get("Chronomap")!.id]),
            "Top Finish Project": relationValue([projectPageByTitle.get("Conductor")!.id]),
            "Top Investigate Project": relationValue([projectPageByTitle.get("Echolocate")!.id]),
            "Top Defer Project": relationValue([projectPageByTitle.get("TerraSynth")!.id]),
            "Projects Mentioned": relationValue(
              PROJECT_CONFIGS.map((entry) => projectPageByTitle.get(entry.title)?.id).filter(
                (value): value is string => Boolean(value),
              ),
            ),
            "Weekly Review": relationValue(weeklyReview ? [weeklyReview.id] : []),
            Summary: richTextValue(
              "Current batch completion run linking the five canonical projects plus OrbitForge base into a single recommendation artifact.",
            ),
          },
          markdown: recommendationMarkdown,
        })
      : undefined;

    const results: Array<Record<string, unknown>> = [];

    for (const projectConfig of PROJECT_CONFIGS) {
      const projectPage = projectPageByTitle.get(projectConfig.title);
      if (!projectPage) {
        throw new AppError(`Could not find project page for "${projectConfig.title}"`);
      }

      const existingResearchIds = relationIds(projectPage.properties["Related Research"]);
      const existingSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
      const existingToolIds = relationIds(projectPage.properties["Tool Stack Records"]);

      const researchIds = [
        ...new Set([
          ...existingResearchIds,
          ...projectConfig.researchTitles
            .map((title) => researchPageByTitle.get(title)?.id)
            .filter((value): value is string => Boolean(value)),
        ]),
      ];
      const skillIds = [
        ...new Set([
          ...existingSkillIds,
          ...projectConfig.skillTitles
            .map((title) => skillPageByTitle.get(title)?.id)
            .filter((value): value is string => Boolean(value)),
        ]),
      ];
      const toolIds = [
        ...new Set([
          ...existingToolIds,
          ...projectConfig.toolTitles
            .map((title) => toolPageByTitle.get(title)?.id)
            .filter((value): value is string => Boolean(value)),
        ]),
      ];

      if (flags.live) {
        await api.updatePageProperties({
          pageId: projectPage.id,
          properties: {
            "Date Updated": { date: { start: flags.today } },
            "Context Quality": selectPropertyValue(projectConfig.contextQuality),
            "Registry Status": selectPropertyValue(projectConfig.registryStatus),
            ...(projectConfig.primaryTool ? { "Primary Tool": selectPropertyValue(projectConfig.primaryTool) } : {}),
            Completion: richTextValue(projectConfig.completion),
            ...(projectConfig.readiness ? { Readiness: richTextValue(projectConfig.readiness) } : {}),
            "Key Integrations": richTextValue(projectConfig.keyIntegrations),
            "Merged Into": richTextValue(projectConfig.mergedInto),
            "Monetization / Strategic Value": richTextValue(projectConfig.monetizationValue),
            "Value / Outcome": richTextValue(projectConfig.valueOutcome),
            ...(projectConfig.latestExternalActivity
              ? { "Latest External Activity": { date: { start: projectConfig.latestExternalActivity } } }
              : {}),
            "Related Research": relationValue(researchIds),
            "Supporting Skills": relationValue(skillIds),
            "Tool Stack Records": relationValue(toolIds),
            "Related Research Count": { number: researchIds.length },
            "Supporting Skills Count": { number: skillIds.length },
            "Linked Tool Count": { number: toolIds.length },
          },
        });
      }

      if (flags.live) {
        for (const researchId of researchIds) {
          const researchPage = researchPages.find((page) => page.id === researchId);
          if (!researchPage) {
            continue;
          }
          await addReverseRelation({
            api,
            pageId: researchId,
            existingIds: relationIds(researchPage.properties["Related Local Projects"]),
            propertyName: "Related Local Projects",
            projectIdsToAdd: [projectPage.id],
          });
        }

        for (const skillId of skillIds) {
          const skillPage = [...skillPageByTitle.values()].find((page) => page.id === skillId);
          if (!skillPage) {
            continue;
          }
          await addReverseRelation({
            api,
            pageId: skillId,
            existingIds: relationIds(skillPage.properties["Related Local Projects"]),
            propertyName: "Related Local Projects",
            projectIdsToAdd: [projectPage.id],
          });
        }

        for (const toolId of toolIds) {
          const toolPage = toolPages.find((page) => page.id === toolId);
          if (!toolPage) {
            continue;
          }
          await addReverseRelation({
            api,
            pageId: toolId,
            existingIds: relationIds(toolPage.properties["Linked Local Projects"]),
            propertyName: "Linked Local Projects",
            projectIdsToAdd: [projectPage.id],
          });
        }
      }

      results.push({
        title: projectConfig.title,
        researchCount: researchIds.length,
        skillCount: skillIds.length,
        toolCount: toolIds.length,
      });
    }

    if (flags.live) {
      const orbitForgePage = projectPageByTitle.get("OrbitForge");
      if (orbitForgePage) {
        const artifacts = await ensureOrbitForgeReferenceArtifacts({
          api,
          config,
          buildTitlePropertyName: buildSchema.titlePropertyName,
          decisionTitlePropertyName: decisionSchema.titlePropertyName,
          packetTitlePropertyName: packetSchema.titlePropertyName,
          taskTitlePropertyName: taskSchema.titlePropertyName,
          projectId: orbitForgePage.id,
          today: flags.today,
        });

        await api.updatePageProperties({
          pageId: orbitForgePage.id,
          properties: {
            "Build Sessions": relationValue([artifacts.buildLogId]),
            "Project Decisions": relationValue([artifacts.decisionId]),
            "Work Packets": relationValue([artifacts.packetId]),
            "Execution Tasks": relationValue([artifacts.taskId]),
            "Last Build Session": richTextValue(artifacts.buildTitle),
            "Last Build Session Date": { date: { start: flags.today } },
            "External Signal Updated": { date: { start: flags.today } },
            "Latest External Activity": { date: { start: flags.today } },
            "Build Session Count": { number: 1 },
          },
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          today: flags.today,
          seededSkills,
          recommendationRunId: recommendation?.id ?? null,
          results,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
