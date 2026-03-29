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

interface Flags {
  live: boolean;
  today: string;
}

const TODAY = losAngelesToday();
const COMMON_TOOL_TITLES = ["Codex CLI (OpenAI)", "GitHub", "Git", "Notion"];

const TARGETS: BatchTarget[] = [
  {
    title: "Nexus",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
      "Dependency Restores Should Convert Setup Noise Into Real Blockers",
    ],
    skillTitles: ["Codex CLI", "Git", "CI/CD", "React", "TypeScript", "Tauri", "Rust", "Dependency Management"],
    toolTitles: [...COMMON_TOOL_TITLES, "pnpm"],
  },
  {
    title: "SignalFlow",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Dependency Restores Should Convert Setup Noise Into Real Blockers",
    ],
    skillTitles: ["Codex CLI", "Git", "CI/CD", "React", "TypeScript", "Tauri", "Rust", "Dependency Management"],
    toolTitles: [...COMMON_TOOL_TITLES, "pnpm"],
  },
  {
    title: "OPscinema",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    ],
    skillTitles: ["Codex CLI", "Git", "CI/CD", "React", "TypeScript", "Tauri", "Rust"],
    toolTitles: [...COMMON_TOOL_TITLES, "pnpm"],
  },
  {
    title: "prompt-englab",
    researchTitles: [
      "Governed GitHub Issues Should Match the Current Execution Slice",
      "Dependency Restores Should Convert Setup Noise Into Real Blockers",
      "Security Audit Gates Need Deliberate Upgrade Plans",
    ],
    skillTitles: [
      "Codex CLI",
      "Git",
      "CI/CD",
      "React",
      "TypeScript",
      "Next.js",
      "Prisma",
      "Security Review",
      "Dependency Management",
    ],
    toolTitles: [...COMMON_TOOL_TITLES, "npm", "Prisma"],
  },
  {
    title: "app",
    researchTitles: [
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
      "Scaffold Projects Need Explicit Stop-or-Fix Decisions",
    ],
    skillTitles: ["Codex CLI", "Git", "SwiftUI", "Xcode / Native macOS Builds"],
    toolTitles: [...COMMON_TOOL_TITLES, "Xcode"],
  },
];

const RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    category: "Engineering",
    summary:
      "Passing tests or typechecks are useful, but desktop projects still need a real product happy-path run before readiness claims are trustworthy.",
    keyFindings:
      "The most misleading desktop posture is a repo that passes fast checks while the actual launch, packaging, or primary user flow still has not been proven.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 selected-batch normalization of Nexus, OPscinema, and app across local repos, GitHub, and Notion.",
    tags: ["desktop", "validation", "readiness"],
    relatedToolTitles: ["Codex CLI (OpenAI)", "GitHub", "Notion"],
    relatedProjectTitles: ["Nexus", "OPscinema", "app"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
      "",
      "## Summary",
      "Passing tests are not the same as proving the real desktop experience. A truthful readiness call still needs a real happy-path run.",
      "",
      "## Operating rule",
      "- Treat unit or workspace tests as foundation proof.",
      "- Treat desktop happy-path validation as a separate gate.",
      "- Record the first blocker that appears once the product path runs.",
    ].join("\n"),
  },
  {
    title: "Dependency Restores Should Convert Setup Noise Into Real Blockers",
    category: "Operations",
    summary:
      "Restoring missing package state is valuable because it replaces generic tool-missing failures with concrete product or release blockers.",
    keyFindings:
      "The most useful install work is the work that unlocks the next true blocker, not the work that stops at green installs and vague optimism.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 selected-batch normalization of Nexus, SignalFlow, and prompt-englab after restoring local dependency baselines.",
    tags: ["dependencies", "validation", "operations"],
    relatedToolTitles: ["Codex CLI (OpenAI)", "GitHub", "Notion", "pnpm", "npm"],
    relatedProjectTitles: ["Nexus", "SignalFlow", "prompt-englab"],
    researchType: "Workflow",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Dependency Restores Should Convert Setup Noise Into Real Blockers",
      "",
      "## Summary",
      "Dependency restoration matters because it reveals the next real blocker. It is not the goal by itself.",
      "",
      "## What good looks like",
      "- Missing-tool failures disappear",
      "- The next product, security, or release blocker becomes visible",
      "- The operating flow records that deeper blocker instead of the old setup noise",
    ].join("\n"),
  },
  {
    title: "Security Audit Gates Need Deliberate Upgrade Plans",
    category: "Security",
    summary:
      "A high-severity audit result is not a command to run force-upgrades blindly. It is a prompt to choose a safe remediation plan that fits the repo state.",
    keyFindings:
      "When a worktree is already large and active, the right next step is to bound the vulnerable chain and choose a deliberate upgrade path, not to mix breaking upgrades into unrelated work.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 selected-batch normalization of prompt-englab after install, test, and build restoration exposed a high-severity audit surface.",
    tags: ["security", "dependencies", "remediation"],
    relatedToolTitles: ["Codex CLI (OpenAI)", "GitHub", "Notion", "npm", "Prisma"],
    relatedProjectTitles: ["prompt-englab"],
    researchType: "Risk Management",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Security Audit Gates Need Deliberate Upgrade Plans",
      "",
      "## Summary",
      "High-severity audit findings should drive a bounded remediation decision, not an automatic breaking upgrade in the middle of unrelated work.",
      "",
      "## Safer pattern",
      "- Identify the vulnerable chain",
      "- Decide whether to patch, pin, isolate, or defer with explicit risk",
      "- Rerun the remaining quality gates after the remediation choice is made",
    ].join("\n"),
  },
  {
    title: "Scaffold Projects Need Explicit Stop-or-Fix Decisions",
    category: "Product Strategy",
    summary:
      "Early scaffolds create less confusion when they carry one explicit blocker and one explicit decision point instead of drifting in archive limbo.",
    keyFindings:
      "A scaffold-level repo becomes easier to manage when the operating flow says either fix the entry blocker next or stop confidently for now.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 selected-batch normalization of app after reconnecting the repo and capturing the missing ContentView build failure.",
    tags: ["scaffold", "decision", "portfolio"],
    relatedToolTitles: ["Codex CLI (OpenAI)", "GitHub", "Notion", "Xcode"],
    relatedProjectTitles: ["app"],
    researchType: "Portfolio",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Scaffold Projects Need Explicit Stop-or-Fix Decisions",
      "",
      "## Summary",
      "Scaffold projects are easier to reason about when they carry one explicit blocker and one explicit decision point instead of an ambiguous archived posture.",
      "",
      "## Operating rule",
      "- Capture the first concrete build or flow blocker",
      "- Decide whether to fix it now or stop clearly",
      "- Avoid vague half-active archive states",
    ].join("\n"),
  },
];

const SKILL_SEEDS: SkillSeed[] = [
  {
    title: "Prisma",
    category: "Frameworks",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Hands-on"],
    lastPracticed: TODAY,
    proficiency: 2,
    notes: "Used to restore client generation, schema-backed builds, and dependency-risk analysis in prompt-englab.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["prompt-englab"],
    projectsText: "prompt-englab",
    markdown: [
      "# Prisma",
      "",
      "## Why this skill exists",
      "This skill captures hands-on schema, client-generation, and dependency-risk work around Prisma-backed app flows.",
      "",
      "## Proof",
      "- Prisma client generation restored during prompt-englab normalization",
      "- Build and audit posture reviewed after the dependency baseline came back",
    ].join("\n"),
  },
  {
    title: "SwiftUI",
    category: "Frameworks",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Hands-on"],
    lastPracticed: TODAY,
    proficiency: 1,
    notes: "Used for scaffold-level macOS app validation and entry-view debugging in the app project.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["app"],
    projectsText: "app",
    markdown: [
      "# SwiftUI",
      "",
      "## Why this skill exists",
      "This skill captures early-stage SwiftUI debugging and entry-view validation for local macOS app scaffolds.",
      "",
      "## Proof",
      "- app normalization surfaced a missing `ContentView` entry-point blocker",
      "- The next build decision is now tied to SwiftUI-level fix or stop work",
    ].join("\n"),
  },
  {
    title: "Security Review",
    category: "DevTools",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Hands-on", "Risk Review"],
    lastPracticed: TODAY,
    proficiency: 2,
    notes: "Used to turn audit output into bounded remediation decisions instead of force-upgrading blindly in active worktrees.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["prompt-englab"],
    projectsText: "prompt-englab",
    markdown: [
      "# Security Review",
      "",
      "## Why this skill exists",
      "This skill captures practical dependency-risk and audit-triage work used to keep active repos safe without creating unnecessary churn.",
      "",
      "## Proof",
      "- prompt-englab audit findings were converted into an explicit remediation decision slice",
    ].join("\n"),
  },
  {
    title: "Dependency Management",
    category: "DevTools",
    reviewCadence: "Monthly",
    projectRelevance: "Core",
    status: "Active",
    proofTypes: ["Project Work", "Hands-on"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used to restore missing package baselines and turn setup noise into real blockers across JS-heavy local projects.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["Nexus", "SignalFlow", "prompt-englab"],
    projectsText: "Nexus; SignalFlow; prompt-englab",
    markdown: [
      "# Dependency Management",
      "",
      "## Why this skill exists",
      "This skill captures package-baseline restoration and dependency-risk handling across the local portfolio.",
      "",
      "## Proof",
      "- pnpm and npm baseline restoration for the selected normalization batch",
      "- Deeper blockers surfaced only after installs became healthy",
    ].join("\n"),
  },
];

const TOOL_SEEDS: ToolSeed[] = [
  {
    title: "pnpm",
    website: "https://pnpm.io/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 9,
    platform: ["CLI"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Package manager used to restore and verify JS desktop repos in the local portfolio.",
    whatFrustrates: "Missing install state can hide the real blocker until the workspace is made healthy again.",
    comparedTo: "npm",
    whatDelights: "Fast installs and predictable lockfile-driven restores for multi-tool desktop repos.",
    subscriptionTier: "Free",
    tags: ["pnpm", "javascript", "dependencies"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Install restoration, typecheck/test validation, and readiness baselines for pnpm-managed repos.",
    utilityScore: 9,
    relatedProjectTitles: ["Nexus", "SignalFlow", "OPscinema"],
    markdown: [
      "# pnpm",
      "",
      "## Use cases",
      "- Restore missing dependency baselines",
      "- Run verification commands on desktop-heavy JS repos",
      "",
      "## Why it matters",
      "pnpm was the unlock step for deeper readiness truth in this selected batch.",
    ].join("\n"),
  },
  {
    title: "npm",
    website: "https://www.npmjs.com/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 8,
    platform: ["CLI"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Package manager used for Next.js and Prisma-backed app verification in the local portfolio.",
    whatFrustrates: "Audit and upgrade paths can become noisy when transitive dependencies force breaking remediation choices.",
    comparedTo: "pnpm",
    whatDelights: "Simple restore path for single-app repos that already standardize on npm lockfiles.",
    subscriptionTier: "Free",
    tags: ["npm", "javascript", "dependencies"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Install restoration, audit review, and build verification for npm-managed apps.",
    utilityScore: 8,
    relatedProjectTitles: ["prompt-englab"],
    markdown: [
      "# npm",
      "",
      "## Use cases",
      "- Restore lockfile-backed app dependencies",
      "- Run audit and build verification",
      "",
      "## Why it matters",
      "npm exposed the real security-risk gate in prompt-englab once the install state came back.",
    ].join("\n"),
  },
  {
    title: "Xcode",
    website: "https://developer.apple.com/xcode/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 8,
    platform: ["Desktop"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Native macOS build surface used to validate early SwiftUI scaffolds and app targets.",
    whatFrustrates: "Entry-point and signing problems can make a scaffold look quieter than it really is until a real build is attempted.",
    comparedTo: "Command-line only native workflows",
    whatDelights: "Clear native build surface and direct signal for macOS app readiness.",
    subscriptionTier: "Free",
    tags: ["xcode", "macos", "native"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "macOS build validation and early native readiness checks.",
    utilityScore: 8,
    relatedProjectTitles: ["app"],
    markdown: [
      "# Xcode",
      "",
      "## Use cases",
      "- Native macOS build validation",
      "- SwiftUI scaffold debugging",
      "",
      "## Why it matters",
      "Xcode is the key truth surface for whether the app project is still only a scaffold or an actual buildable product.",
    ].join("\n"),
  },
  {
    title: "Prisma",
    website: "https://www.prisma.io/",
    pricingModel: "Free + Paid",
    whatIPay: "Included in repo workflow",
    delightScore: 8,
    platform: ["CLI", "Web"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "ORM and schema tool used in prompt-englab for client generation and data-backed app flows.",
    whatFrustrates: "Transitive dependency chains can turn routine audit cleanup into a breaking upgrade decision.",
    comparedTo: "Handwritten SQL-first app setup",
    whatDelights: "Fast client generation and clear schema-centered workflow for app validation.",
    subscriptionTier: "Standard",
    tags: ["prisma", "database", "orm"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Client generation, schema-backed app checks, and dependency-risk review.",
    utilityScore: 8,
    relatedProjectTitles: ["prompt-englab"],
    markdown: [
      "# Prisma",
      "",
      "## Use cases",
      "- Client generation",
      "- Schema-backed build validation",
      "- Dependency-risk review",
      "",
      "## Why it matters",
      "Prisma sits on the critical path for prompt-englab correctness and audit posture.",
    ].join("\n"),
  },
];

async function main(): Promise<void> {
  try {
    const result = await runBackfill(parseFlags(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

async function runBackfill(flags: Flags): Promise<{
  ok: true;
  live: boolean;
  today: string;
  results: Array<{ title: string; relatedResearchCount: number; supportingSkillsCount: number; linkedToolCount: number }>;
}> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for selected batch link backfill");
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

  let [projectPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const projectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  ensurePagesExist(projectByTitle, TARGETS.map((target) => target.title), "project");

  if (flags.live) {
    await ensureMissingTools({
      api,
      dataSourceId: config.relatedDataSources.toolsId,
      titlePropertyName: toolSchema.titlePropertyName,
      projectByTitle,
      existingPages: new Map(toolPages.map((page) => [page.title, page])),
      seeds: TOOL_SEEDS,
    });
    toolPages = await fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName);
    await ensureMissingSkills({
      api,
      dataSourceId: config.relatedDataSources.skillsId,
      titlePropertyName: skillSchema.titlePropertyName,
      projectByTitle,
      existingPages: new Map(skillPages.map((page) => [page.title, page])),
      seeds: SKILL_SEEDS,
    });
    await ensureMissingResearch({
      api,
      dataSourceId: config.relatedDataSources.researchId,
      titlePropertyName: researchSchema.titlePropertyName,
      projectByTitle,
      existingResearchPages: new Map(researchPages.map((page) => [page.title, page])),
      toolByTitle: new Map(toolPages.map((page) => [page.title, page])),
      seeds: RESEARCH_SEEDS,
      today: flags.today,
    });

    [projectPages, researchPages, skillPages, toolPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    ]);
  }

  const refreshedProjectByTitle = new Map(projectPages.map((page) => [page.title, page]));
  const researchByTitle = mergeVirtualPages(
    new Map(researchPages.map((page) => [page.title, page])),
    uniqueTitles(TARGETS.flatMap((target) => target.researchTitles)),
    "research",
  );
  const skillByTitle = mergeVirtualPages(
    new Map(skillPages.map((page) => [page.title, page])),
    uniqueTitles(TARGETS.flatMap((target) => target.skillTitles)),
    "skill",
  );
  const toolByTitle = mergeVirtualPages(
    new Map(toolPages.map((page) => [page.title, page])),
    uniqueTitles(TARGETS.flatMap((target) => target.toolTitles)),
    "tool",
  );

  ensurePagesExist(researchByTitle, uniqueTitles(TARGETS.flatMap((target) => target.researchTitles)), "research");
  ensurePagesExist(skillByTitle, uniqueTitles(TARGETS.flatMap((target) => target.skillTitles)), "skill");
  ensurePagesExist(toolByTitle, uniqueTitles(TARGETS.flatMap((target) => target.toolTitles)), "tool");

  const results = [];

  for (const target of TARGETS) {
    const projectPage = requirePage(refreshedProjectByTitle, target.title, "project");
    const researchIds = uniqueIds([
      ...readRelationIds(projectPage.properties["Related Research"]),
      ...target.researchTitles.map((title) => requirePage(researchByTitle, title, "research").id),
    ]);
    const skillIds = uniqueIds([
      ...readRelationIds(projectPage.properties["Supporting Skills"]),
      ...target.skillTitles.map((title) => requirePage(skillByTitle, title, "skill").id),
    ]);
    const toolIds = uniqueIds([
      ...readRelationIds(projectPage.properties["Tool Stack Records"]),
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

async function ensureMissingResearch(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  existingResearchPages: Map<string, DataSourcePageRef>;
  toolByTitle: Map<string, DataSourcePageRef>;
  seeds: ResearchSeed[];
  today: string;
}): Promise<void> {
  for (const seed of input.seeds) {
    if (input.existingResearchPages.has(seed.title)) {
      continue;
    }
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

async function ensureMissingSkills(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  existingPages: Map<string, DataSourcePageRef>;
  seeds: SkillSeed[];
}): Promise<void> {
  for (const seed of input.seeds) {
    if (input.existingPages.has(seed.title)) {
      continue;
    }
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

async function ensureMissingTools(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectByTitle: Map<string, DataSourcePageRef>;
  existingPages: Map<string, DataSourcePageRef>;
  seeds: ToolSeed[];
}): Promise<void> {
  for (const seed of input.seeds) {
    if (input.existingPages.has(seed.title)) {
      continue;
    }
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
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(uniqueIds([...readRelationIds(page.properties["Related Local Projects"]), projectId])),
        },
      });
    }

    for (const title of target.skillTitles) {
      const page = requirePage(input.skillByTitle, title, "skill");
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Related Local Projects": relationValue(uniqueIds([...readRelationIds(page.properties["Related Local Projects"]), projectId])),
        },
      });
    }

    for (const title of target.toolTitles) {
      const page = requirePage(input.toolByTitle, title, "tool");
      await input.api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Linked Local Projects": relationValue(uniqueIds([...readRelationIds(page.properties["Linked Local Projects"]), projectId])),
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

function readRelationIds(
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

function parseFlags(argv: string[]): Flags {
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

void main();
