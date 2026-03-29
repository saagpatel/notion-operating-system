import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  relationIds,
  relationValue,
  multiSelectValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface BatchFlags {
  live: boolean;
  today: string;
}

interface BatchTarget {
  title: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
  primaryContextDoc: string;
  startHere: string;
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

const TODAY = losAngelesToday();
const COMMON_TOOLS = ["GitHub", "Notion", "Codex CLI (OpenAI)"];
const COMMON_RESEARCH = ["Governed GitHub Issues Should Match the Current Execution Slice"];

const TARGETS: BatchTarget[] = [
  {
    title: "SlackIncidentBot",
    researchTitles: [...COMMON_RESEARCH, "Slack Incident Automation Needs Local Bot Proof Before Production Claims"],
    skillTitles: ["Rust", "Slack Platform", "PostgreSQL", "CI/CD"],
    toolTitles: [...COMMON_TOOLS, "Slack", "PostgreSQL"],
    primaryContextDoc: "QUICKSTART.md",
    startHere: "Start with QUICKSTART.md, then use the current packet to ship the CI and lockfile repair.",
  },
  {
    title: "SmartClipboard",
    researchTitles: [...COMMON_RESEARCH, "Desktop Tauri Apps Need Dependency Baseline Before Blocker Triage"],
    skillTitles: ["Tauri", "React", "TypeScript", "SQLite"],
    toolTitles: COMMON_TOOLS,
    primaryContextDoc: "README.md",
    startHere: "Restore the npm install baseline, rerun the build path, and then use the current packet to capture the first surviving blocker.",
  },
  {
    title: "SnippetLibrary",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Swift Menu Bar Apps Need Permission and Paste Proof Before Ship Calls",
      "Local Semantic Search Should Stay Optional and Bounded",
    ],
    skillTitles: ["Swift", "macOS Desktop", "SQLite", "Ollama Integration"],
    toolTitles: [...COMMON_TOOLS, "Ollama"],
    primaryContextDoc: "README.md",
    startHere: "Start with README.md, then narrow the current dirty tree into one governed slice while keeping the passing Swift baseline intact.",
  },
  {
    title: "TicketDashboard",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Desktop Tauri Apps Need Dependency Baseline Before Blocker Triage",
      "Jira Ticket Dashboards Need Local Sync Proof Before Readiness Claims",
    ],
    skillTitles: ["Tauri", "React", "TypeScript", "Jira / JSM"],
    toolTitles: [...COMMON_TOOLS, "Jira Service Management"],
    primaryContextDoc: "README.md",
    startHere: "Restore the npm install baseline first, then use the packet to capture the first finish slice that survives setup cleanup.",
  },
  {
    title: "TicketDocumentation",
    researchTitles: [
      ...COMMON_RESEARCH,
      "Desktop Tauri Apps Need Dependency Baseline Before Blocker Triage",
      "Activity-Driven Ticket Docs Need Privacy Sanitization and Local Model Proof",
    ],
    skillTitles: ["Tauri", "React", "TypeScript", "Ollama Integration", "Privacy / Data Sanitization"],
    toolTitles: [...COMMON_TOOLS, "Ollama", "Jira Service Management"],
    primaryContextDoc: "README.md",
    startHere: "Start with README.md, restore the pnpm install baseline, and then use the packet to capture the first real blocker beyond setup drift.",
  },
];

const RESEARCH_SEEDS: ResearchSeed[] = [
  {
    title: "Governed GitHub Issues Should Match the Current Execution Slice",
    category: "Operations",
    summary:
      "A governed GitHub lane stays trustworthy only when the active issue mirrors the real next slice and blocker list for the project.",
    keyFindings:
      "Approved requests, packets, and build evidence are useful only when the live GitHub issue describes the same next move that Notion describes today.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 portfolio review across SlackIncidentBot, SmartClipboard, SnippetLibrary, TicketDashboard, and TicketDocumentation in Notion, local repos, and GitHub.",
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
      "The active GitHub issue should describe the slice that is true now, not the slice that was true when the repo was first wired into the operating flow.",
      "",
      "## Operating rule",
      "- Keep one governed issue aligned to the real next move.",
      "- Refresh blocker language when local proof changes.",
      "- Use build evidence and packet links to keep Notion and GitHub synchronized.",
    ].join("\n"),
  },
  {
    title: "Slack Incident Automation Needs Local Bot Proof Before Production Claims",
    category: "Backend Reliability",
    summary:
      "An incident bot should earn readiness through a passing local command path and deployment inputs before production claims are treated as credible.",
    keyFindings:
      "Slack and database integrations are only as strong as the local verification path, the environment setup guide, and the final deploy inputs that match GitHub automation.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 review of SlackIncidentBot README, Quickstart, testing notes, local Rust verification, and failing GitHub workflow posture.",
    tags: ["slack", "incident", "backend"],
    relatedToolTitles: ["GitHub", "Slack", "PostgreSQL"],
    relatedProjectTitles: ["SlackIncidentBot"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Slack Incident Automation Needs Local Bot Proof Before Production Claims",
      "",
      "## Summary",
      "A Slack incident bot should not be treated as production-ready until the local command path, deployment inputs, and GitHub automation tell the same story.",
      "",
      "## Evidence to require",
      "- Passing local Rust verification",
      "- Working Slack setup and database path",
      "- Deployment inputs that match the live GitHub workflow",
    ].join("\n"),
  },
  {
    title: "Desktop Tauri Apps Need Dependency Baseline Before Blocker Triage",
    category: "Desktop Engineering",
    summary:
      "When a Tauri app build fails before React or Rust dependencies are even installed, the first honest blocker is the missing install baseline, not an app-level bug.",
    keyFindings:
      "Build triage is only meaningful after the package manager baseline is healthy; until then the repo is still in setup recovery.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 local verification of SmartClipboard, TicketDashboard, and TicketDocumentation after running their documented build entrypoints.",
    tags: ["tauri", "desktop", "dependency-baseline"],
    relatedToolTitles: ["GitHub", "Notion", "Codex CLI (OpenAI)"],
    relatedProjectTitles: ["SmartClipboard", "TicketDashboard", "TicketDocumentation"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Desktop Tauri Apps Need Dependency Baseline Before Blocker Triage",
      "",
      "## Summary",
      "For Tauri desktop repos, the first blocker is sometimes the install baseline itself. That should be recorded honestly instead of skipping ahead to code-level guesses.",
      "",
      "## Operating rule",
      "- Restore package manager state first.",
      "- Re-run build and test only after install health is real.",
      "- Record the first blocker that survives setup cleanup.",
    ].join("\n"),
  },
  {
    title: "Swift Menu Bar Apps Need Permission and Paste Proof Before Ship Calls",
    category: "Desktop Engineering",
    summary:
      "A macOS menu bar utility is only near-ship when permission flows, global shortcuts, and paste behavior are proven on-device, not just through compile success.",
    keyFindings:
      "Passing `swift build` and `swift test` is a strong baseline, but ship confidence still needs launch, permission, and real insertion proof.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 review of SnippetLibrary README, local Swift build and test success, and the current execution slice in the working tree.",
    tags: ["swift", "macos", "desktop"],
    relatedToolTitles: ["GitHub", "Notion", "Codex CLI (OpenAI)"],
    relatedProjectTitles: ["SnippetLibrary"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Swift Menu Bar Apps Need Permission and Paste Proof Before Ship Calls",
      "",
      "## Summary",
      "Compile health is necessary but not sufficient for a menu bar productivity app. Permission flows and real paste behavior still need proof.",
      "",
      "## Evidence to require",
      "- App launch proof",
      "- Accessibility and Input Monitoring confirmation",
      "- A real paste round-trip in another app",
    ].join("\n"),
  },
  {
    title: "Local Semantic Search Should Stay Optional and Bounded",
    category: "AI / Retrieval",
    summary:
      "A local semantic search feature is strongest when it is additive to fast core search, optional for the user, and bounded to a clear local model dependency.",
    keyFindings:
      "Semantic features should not block the core desktop workflow. They should enhance a stable local-first app without becoming the new single point of failure.",
    actionable: "Yes - Immediate",
    confidence: "Medium",
    sources:
      "March 22, 2026 review of SnippetLibrary README, local feature list, and Ollama-backed semantic search notes.",
    tags: ["ollama", "semantic-search", "local-first"],
    relatedToolTitles: ["Ollama", "GitHub"],
    relatedProjectTitles: ["SnippetLibrary"],
    researchType: "Architecture",
    decisionImpact: "Near Term",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Local Semantic Search Should Stay Optional and Bounded",
      "",
      "## Summary",
      "Local semantic search is valuable when it remains an optional enhancement on top of a fast core workflow.",
      "",
      "## Rule of thumb",
      "- Keep exact and full-text search healthy first.",
      "- Make local model usage optional.",
      "- Record model dependencies clearly in setup and troubleshooting docs.",
    ].join("\n"),
  },
  {
    title: "Jira Ticket Dashboards Need Local Sync Proof Before Readiness Claims",
    category: "Desktop Engineering",
    summary:
      "A Jira dashboard app earns readiness through a successful local sync, healthy charts, and trustworthy ticket metrics rather than through UI completeness alone.",
    keyFindings:
      "Dashboard polish is secondary until the Jira connection, background sync, and local metrics path can be run end to end.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 review of TicketDashboard README, local npm build failure, and the current GitHub workflow posture.",
    tags: ["jira", "dashboard", "desktop"],
    relatedToolTitles: ["Jira Service Management", "GitHub"],
    relatedProjectTitles: ["TicketDashboard"],
    researchType: "Execution Pattern",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Jira Ticket Dashboards Need Local Sync Proof Before Readiness Claims",
      "",
      "## Summary",
      "A ticket dashboard is only as strong as the local sync and metrics path behind it.",
      "",
      "## Evidence to require",
      "- A successful Jira sync",
      "- Healthy chart and metric rendering",
      "- Clear blocker capture when sync or build health is missing",
    ].join("\n"),
  },
  {
    title: "Activity-Driven Ticket Docs Need Privacy Sanitization and Local Model Proof",
    category: "AI / Privacy",
    summary:
      "An activity-to-documentation app needs strong privacy defaults and local model proof before its generated notes should be trusted for real ticket work.",
    keyFindings:
      "The core promise only holds when sensitive data is sanitized, activity capture is understandable, and the local model path is reproducible on the operator's machine.",
    actionable: "Yes - Immediate",
    confidence: "High",
    sources:
      "March 22, 2026 review of TicketDocumentation README, local build baseline failure, and the current governed issue slice.",
    tags: ["privacy", "ollama", "documentation"],
    relatedToolTitles: ["Ollama", "Jira Service Management", "GitHub"],
    relatedProjectTitles: ["TicketDocumentation"],
    researchType: "Architecture",
    decisionImpact: "Immediate",
    revalidationCadence: "Quarterly",
    markdown: [
      "# Activity-Driven Ticket Docs Need Privacy Sanitization and Local Model Proof",
      "",
      "## Summary",
      "Generated ticket documentation is only trustworthy when privacy sanitization and the local model path are both proven and easy to explain.",
      "",
      "## Evidence to require",
      "- Sanitization proof for sensitive strings",
      "- A reproducible local model setup",
      "- Clear operator review before generated text is copied into a real ticket",
    ].join("\n"),
  },
];

const SKILL_SEEDS: SkillSeed[] = [
  {
    title: "Rust",
    category: "Backend / Systems",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 4,
    notes: "Used for local verification, workflow repair, and backend validation across the Rust-backed projects in this batch.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SlackIncidentBot"],
    projectsText: "SlackIncidentBot",
    markdown: ["# Rust", "", "Used for backend, desktop, and verification work in the current portfolio batch."].join("\n"),
  },
  {
    title: "Slack Platform",
    category: "Integrations",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Integration"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used for slash commands, workspace configuration, and incident workflow design in SlackIncidentBot.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SlackIncidentBot"],
    projectsText: "SlackIncidentBot",
    markdown: ["# Slack Platform", "", "Captures practical Slack app setup and interaction work for incident automation."].join("\n"),
  },
  {
    title: "PostgreSQL",
    category: "Data",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used for local database-backed verification in SlackIncidentBot.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SlackIncidentBot"],
    projectsText: "SlackIncidentBot",
    markdown: ["# PostgreSQL", "", "Used for local data and migration-backed verification in the incident bot project."].join("\n"),
  },
  {
    title: "CI/CD",
    category: "Operations",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 4,
    notes: "Used to repair workflow drift and keep GitHub checks aligned with the real local verification contract.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SlackIncidentBot"],
    projectsText: "SlackIncidentBot",
    markdown: ["# CI/CD", "", "Used to align local verification contracts with live GitHub workflows."].join("\n"),
  },
  {
    title: "Tauri",
    category: "Desktop Engineering",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 4,
    notes: "Used across SmartClipboard, TicketDashboard, and TicketDocumentation for Rust-backed desktop delivery.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SmartClipboard", "TicketDashboard", "TicketDocumentation"],
    projectsText: "SmartClipboard; TicketDashboard; TicketDocumentation",
    markdown: ["# Tauri", "", "Used for the Rust-plus-web desktop shell in the current desktop app batch."].join("\n"),
  },
  {
    title: "React",
    category: "Frontend",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 4,
    notes: "Used across the current desktop UI projects to validate build surfaces and current blockers.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SmartClipboard", "TicketDashboard", "TicketDocumentation"],
    projectsText: "SmartClipboard; TicketDashboard; TicketDocumentation",
    markdown: ["# React", "", "Used for desktop UI work and build triage across the current batch."].join("\n"),
  },
  {
    title: "TypeScript",
    category: "Frontend",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 4,
    notes: "Used for desktop frontend build validation and triage across the current Tauri apps.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SmartClipboard", "TicketDashboard", "TicketDocumentation"],
    projectsText: "SmartClipboard; TicketDashboard; TicketDocumentation",
    markdown: ["# TypeScript", "", "Used for strict frontend validation and build triage in the current desktop apps."].join("\n"),
  },
  {
    title: "SQLite",
    category: "Data",
    reviewCadence: "Quarterly",
    projectRelevance: "Medium",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used in the local-first desktop apps where persistent search and ticket history depend on embedded storage.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SmartClipboard", "SnippetLibrary"],
    projectsText: "SmartClipboard; SnippetLibrary",
    markdown: ["# SQLite", "", "Used for embedded local-first data paths in the productivity desktop apps."].join("\n"),
  },
  {
    title: "Swift",
    category: "Desktop Engineering",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used to validate the current SnippetLibrary baseline and to keep the execution slice grounded in a working Swift build.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SnippetLibrary"],
    projectsText: "SnippetLibrary",
    markdown: ["# Swift", "", "Used for the SnippetLibrary app and its current local verification baseline."].join("\n"),
  },
  {
    title: "macOS Desktop",
    category: "Desktop Engineering",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Verification"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used for permission flows, menu bar UX, and desktop behavior across the macOS-focused projects in this batch.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SnippetLibrary"],
    projectsText: "SnippetLibrary",
    markdown: ["# macOS Desktop", "", "Used for menu bar app behavior, permissions, and desktop workflow validation."].join("\n"),
  },
  {
    title: "Ollama Integration",
    category: "AI / Local Models",
    reviewCadence: "Quarterly",
    projectRelevance: "Medium",
    status: "Active",
    proofTypes: ["Project Work", "Integration"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used for local model-backed semantic search and documentation generation in the current batch.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["SnippetLibrary", "TicketDocumentation"],
    projectsText: "SnippetLibrary; TicketDocumentation",
    markdown: ["# Ollama Integration", "", "Used for local model workflows where privacy and offline behavior matter."].join("\n"),
  },
  {
    title: "Jira / JSM",
    category: "Integrations",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Integration"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used for ticket-sync and documentation workflows in the Jira-focused desktop apps.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["TicketDashboard"],
    projectsText: "TicketDashboard",
    markdown: ["# Jira / JSM", "", "Used for local ticket sync and ticket-operations workflows."].join("\n"),
  },
  {
    title: "Privacy / Data Sanitization",
    category: "Privacy",
    reviewCadence: "Quarterly",
    projectRelevance: "High",
    status: "Active",
    proofTypes: ["Project Work", "Review"],
    lastPracticed: TODAY,
    proficiency: 3,
    notes: "Used to reason about sensitive-string removal and safe local processing in TicketDocumentation.",
    sourceTags: ["Local Portfolio", "Hands-On"],
    relatedProjectTitles: ["TicketDocumentation"],
    projectsText: "TicketDocumentation",
    markdown: ["# Privacy / Data Sanitization", "", "Used to keep local activity capture and generated documentation safe to review and reuse."].join("\n"),
  },
];

const TOOL_SEEDS: ToolSeed[] = [
  {
    title: "Slack",
    website: "https://slack.com/",
    pricingModel: "Paid",
    whatIPay: "Workspace subscription",
    delightScore: 8,
    platform: ["Web", "Desktop", "Mobile"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Primary communication and slash-command surface for the incident automation project.",
    whatFrustrates: "App setup and scope drift can hide the real delivery blocker if the bot workflow is not verified end to end.",
    comparedTo: "Microsoft Teams",
    whatDelights: "Fast interaction surface for alerts, commands, and incident coordination.",
    subscriptionTier: "Standard",
    tags: ["slack", "incident", "collaboration"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Product Tool",
    myUseCases: "Incident declaration, status updates, and bot-driven coordination.",
    utilityScore: 9,
    relatedProjectTitles: ["SlackIncidentBot"],
    markdown: ["# Slack", "", "Used as the live interaction surface for the incident bot workflow."].join("\n"),
  },
  {
    title: "PostgreSQL",
    website: "https://www.postgresql.org/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 8,
    platform: ["Desktop", "Cloud"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Database backing the incident bot workflow and compile-time query validation path.",
    whatFrustrates: "Schema or environment drift can make a healthy app look broken before the actual bot logic is exercised.",
    comparedTo: "SQLite",
    whatDelights: "Strong local reliability and predictable migration-driven validation.",
    subscriptionTier: "Free",
    tags: ["postgres", "database", "backend"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Local database validation and migration-backed runtime proof.",
    utilityScore: 8,
    relatedProjectTitles: ["SlackIncidentBot"],
    markdown: ["# PostgreSQL", "", "Used to back the incident workflow and its local migration-driven verification path."].join("\n"),
  },
  {
    title: "Ollama",
    website: "https://ollama.com/",
    pricingModel: "Free",
    whatIPay: "$0",
    delightScore: 7,
    platform: ["Desktop", "CLI"],
    stackIntegration: ["Optional"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Local model runtime used for semantic search and local documentation generation.",
    whatFrustrates: "Model setup can become a hidden dependency if the core app workflow is not kept healthy without it.",
    comparedTo: "Cloud LLM APIs",
    whatDelights: "Private local inference that fits the local-first desktop workflow.",
    subscriptionTier: "Free",
    tags: ["ollama", "local-llm", "ai"],
    lastReviewed: TODAY,
    status: "Active",
    category: "AI Tool",
    myUseCases: "Semantic search, local note generation, and privacy-friendly model-backed features.",
    utilityScore: 8,
    relatedProjectTitles: ["SnippetLibrary", "TicketDocumentation"],
    markdown: ["# Ollama", "", "Used when local model-backed features need privacy and offline behavior."].join("\n"),
  },
  {
    title: "Jira Service Management",
    website: "https://www.atlassian.com/software/jira/service-management",
    pricingModel: "Paid",
    whatIPay: "Workspace subscription",
    delightScore: 7,
    platform: ["Web"],
    stackIntegration: ["External"],
    dateFirstUsed: TODAY,
    myRole: "Operator",
    oneLiner: "Primary ticket surface for the Jira-focused dashboard and documentation tools.",
    whatFrustrates: "Desktop tools can look polished before the real ticket sync and documentation workflows are proven against live data.",
    comparedTo: "ServiceNow",
    whatDelights: "Clear ticket structure and a useful API surface for local-first tooling.",
    subscriptionTier: "Standard",
    tags: ["jira", "tickets", "operations"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Product Tool",
    myUseCases: "Ticket sync, dashboard metrics, and resolution documentation workflows.",
    utilityScore: 8,
    relatedProjectTitles: ["TicketDashboard", "TicketDocumentation"],
    markdown: ["# Jira Service Management", "", "Used as the ticket data surface for dashboard and documentation workflows."].join("\n"),
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

async function runBackfill(flags: BatchFlags): Promise<Record<string, unknown>> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new AppError("NOTION_TOKEN is required for governance batch context backfill");
  }

  const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
  const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
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
          "Primary Context Doc": richTextValue(target.primaryContextDoc),
          "Start Here": richTextValue(target.startHere),
        },
      });
    }

    results.push({
      title: target.title,
      relatedResearchCount: researchIds.length,
      supportingSkillsCount: skillIds.length,
      linkedToolCount: toolIds.length,
    });
  }

  if (flags.live) {
    await syncReverseRelations({
      api,
      targets: TARGETS,
      projectByTitle,
      researchByTitle,
      skillByTitle,
      toolByTitle,
    });
  }

  return { ok: true, live: flags.live, today: flags.today, results };
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
  projectByTitle: Map<string, DataSourcePageRef>;
  researchByTitle: Map<string, DataSourcePageRef>;
  skillByTitle: Map<string, DataSourcePageRef>;
  toolByTitle: Map<string, DataSourcePageRef>;
}): Promise<void> {
  for (const target of input.targets) {
    const projectId = requirePage(input.projectByTitle, target.title, "project").id;

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

function requirePage(pageMap: Map<string, DataSourcePageRef>, title: string, kind: string): DataSourcePageRef {
  const page = pageMap.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page for "${title}"`);
  }
  return page;
}

function ensurePagesExist(pageMap: Map<string, DataSourcePageRef>, titles: string[], kind: string): void {
  for (const title of titles) {
    if (!pageMap.has(title)) {
      throw new AppError(`Could not find ${kind} page for "${title}"`);
    }
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function uniqueTitles(titles: string[]): string[] {
  return [...new Set(titles)];
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

if (process.argv[1]?.endsWith("backfill-governance-batch-context.ts")) {
  void main();
}
