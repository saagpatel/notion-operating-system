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
  toControlTowerProjectRecord,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import { ensureGitHubCreateIssueActionRequest, runScriptJson } from "./operational-rollout.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

const SNAPSHOT_START = "<!-- codex:batch-rollout-snapshot:start -->";
const SNAPSHOT_END = "<!-- codex:batch-rollout-snapshot:end -->";
const COMMON_TOOL_TITLES = ["GitHub", "Notion", "Codex CLI (OpenAI)"] as const;

interface BatchTaskConfig {
  title: string;
  status: "Ready" | "Blocked";
  priority: "P0" | "P1" | "P2";
  taskType: "Build" | "Review" | "Decision Prep" | "Fix" | "Ship";
  estimate: "<2h" | "Half day" | "1 day" | "2+ days";
  notes: string;
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
  markdown: string;
}

interface BatchProjectConfig {
  title: string;
  repoSlug: string;
  sourceTitle: string;
  currentState: "Active Build";
  portfolioCall: "Build Now" | "Finish";
  momentum: "Hot" | "Warm";
  setupFriction: "Medium" | "High";
  runsLocally: "Partial";
  buildMaturity?: "Functional Core" | "Feature Complete" | "Demoable";
  shipReadiness?: "Needs Hardening" | "Near Ship";
  effortToDemo: "<2h" | "2-3 days" | "Unknown";
  effortToShip: "2-3 days" | "1 week" | "2+ weeks";
  testPosture: "Some" | "Sparse";
  docsQuality: "Usable";
  evidenceConfidence: "Medium";
  lastActive: string;
  nextMove: string;
  biggestBlocker: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
  buildSessionTitle: string;
  buildSessionPlanned: string;
  buildSessionShipped: string;
  buildSessionBlockers: string;
  buildSessionLessons: string;
  buildSessionNextSteps: string;
  decisionTitle: string;
  decisionChosenOption: string;
  decisionRationale: string;
  packetTitle: string;
  packetStatus: "Ready";
  packetPriority: "Now" | "Standby" | "Later";
  packetType: "Build Push" | "Finish Push" | "Review Prep";
  packetGoal: string;
  packetDefinitionOfDone: string;
  packetWhyNow: string;
  packetEstimatedSize: "1 day" | "2-3 days";
  packetBlockerSummary: string;
  primaryRunCommand: string;
  issueMode: "create_issue" | "reuse_issue";
  issueTitle?: string;
  issueBody?: string;
  existingIssueNumber?: number;
  cleanupSourceTitles?: string[];
  tasks: BatchTaskConfig[];
}

interface BatchFlags {
  live: boolean;
  today: string;
}

const TODAY = losAngelesToday();

const TOOL_SEEDS: ToolSeed[] = [
  {
    title: "GitHub",
    website: "https://github.com/",
    pricingModel: "Free + Paid",
    whatIPay: "Included in existing workflow",
    delightScore: 9,
    platform: ["Web", "Desktop"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Primary code host and governed delivery surface for active portfolio work.",
    whatFrustrates: "Signal quality drops when repo mappings or PR expectations are stale.",
    comparedTo: "GitLab",
    whatDelights: "Strong issue, PR, workflow, and repository history for execution tracking.",
    subscriptionTier: "Standard",
    tags: ["github", "delivery", "portfolio"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Repo hosting, issue tracking, workflow review, and governed execution for the local portfolio.",
    utilityScore: 10,
    markdown: [
      "# GitHub",
      "",
      "## Why this tool matters",
      "GitHub is the active execution surface for the governed repo lane in the portfolio system.",
      "",
      "## Current use",
      "- Repo hosting",
      "- Issue and PR tracking",
      "- Workflow and failure triage",
      "- Delivery evidence",
    ].join("\n"),
  },
  {
    title: "Notion",
    website: "https://www.notion.so/",
    pricingModel: "Paid",
    whatIPay: "Workspace subscription",
    delightScore: 8,
    platform: ["Web", "Desktop"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Operator",
    oneLiner: "Canonical operating system for portfolio planning, execution, and review memory.",
    whatFrustrates: "Stale rows can look healthy until the operating flow is refreshed from real repo evidence.",
    comparedTo: "Spreadsheets",
    whatDelights: "Rich linked databases for project state, packets, tasks, actions, and reviews.",
    subscriptionTier: "Business",
    tags: ["notion", "operations", "portfolio"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Knowledge Tool",
    myUseCases: "Control tower, execution packets, governance trail, review packets, and portfolio decisions.",
    utilityScore: 10,
    markdown: [
      "# Notion",
      "",
      "## Why this tool matters",
      "Notion holds the durable operating memory for projects, work packets, tasks, action requests, and reviews.",
      "",
      "## Current use",
      "- Portfolio control tower",
      "- Execution planning",
      "- Governance trail",
      "- Weekly and batch review packets",
    ].join("\n"),
  },
  {
    title: "Codex CLI (OpenAI)",
    website: "https://platform.openai.com/",
    pricingModel: "Usage-based",
    whatIPay: "Usage-based",
    delightScore: 8,
    platform: ["Desktop", "CLI"],
    stackIntegration: ["Core"],
    dateFirstUsed: TODAY,
    myRole: "Builder",
    oneLiner: "Primary local operator for repo inspection, verification, and controlled portfolio updates.",
    whatFrustrates: "The operating layer still needs clear targets and truthful repo evidence to stay useful.",
    comparedTo: "Manual shell-only workflow",
    whatDelights: "Fast repo reading, guided execution, and durable portfolio updates from local context.",
    subscriptionTier: "Usage-based",
    tags: ["codex", "automation", "portfolio"],
    lastReviewed: TODAY,
    status: "Active",
    category: "Developer Tool",
    myUseCases: "Repo verification, issue-lane setup, Notion updates, and batch portfolio rollout work.",
    utilityScore: 9,
    markdown: [
      "# Codex CLI (OpenAI)",
      "",
      "## Why this tool matters",
      "Codex is the local operator used to inspect repos, validate blockers, and keep Notion and GitHub aligned.",
      "",
      "## Current use",
      "- Repo inspection",
      "- Check execution",
      "- Notion operating updates",
      "- Controlled GitHub actuation",
    ].join("\n"),
  },
];

const TARGETS: BatchProjectConfig[] = [
  {
    title: "Construction",
    repoSlug: "saagpatel/Construction",
    sourceTitle: "Construction GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Partial",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the existing governed issue to triage PR #1 workflow failures, decide whether those failures are acceptable, and bring the repo back to a trustworthy passing-or-explicitly-accepted state.",
    biggestBlocker:
      "The frontend check reached TypeScript but failed on missing React and routing dependencies, and GitHub still shows PR #1 failing git-hygiene and lockfile-rationale checks.",
    projectHealthNotes:
      "Construction is already inside the governed GitHub lane, so the highest-value work is now tightening truth between Notion, the current issue slice, and the failing PR surface.",
    knownRisks:
      "If the current PR failures remain untriaged, the project will look more ready in Notion than it actually is in GitHub.",
    whatWorks:
      "The repo already has an active source row, operating-flow history, a governed issue trail, and a local frontend check that progressed far enough to reveal dependency-level truth.",
    missingCorePieces:
      "A clear acceptance or fix decision for PR #1 failures, a resolved dependency baseline for local checks, and a refreshed active issue slice.",
    buildSessionTitle: "Batch rollout - Construction",
    buildSessionPlanned:
      "Finish the Construction onboarding by replacing stale archive posture with active execution truth and by capturing the real repo blockers.",
    buildSessionShipped:
      "Confirmed the active repo mapping, preserved the governed issue lane, updated the project execution records, and captured the local dependency and PR-failure blockers.",
    buildSessionBlockers:
      "Frontend validation fails on missing React and related packages, and PR #1 still has failing git-hygiene and lockfile-rationale checks.",
    buildSessionLessons:
      "Construction is not blocked on portfolio wiring anymore; it is blocked on explicit failure triage and a restored local dependency baseline.",
    buildSessionNextSteps:
      "Update or explicitly accept the failing PR checks on the governed issue, restore the local dependency baseline, and rerun the frontend path.",
    decisionTitle: "Construction - finish the live GitHub lane instead of reopening setup",
    decisionChosenOption:
      "Treat Construction as an active finish-track project and use the existing governed issue lane to reconcile PR failures and local dependency blockers.",
    decisionRationale:
      "Construction already has enough GitHub and Notion wiring to move straight into failure triage rather than restarting onboarding work.",
    packetTitle: "Construction - PR failure triage and dependency restore",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal:
      "Resolve or explicitly accept the current PR failures and restore the local dependency baseline so the next meaningful green path can be proven.",
    packetDefinitionOfDone:
      "PR #1 failures are green or explicitly accepted, the local frontend dependency blocker is addressed, and the next active slice is clear on the governed issue.",
    packetWhyNow:
      "Construction is the fastest path in this batch to one fully trustworthy GitHub-backed project.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The current repo truth is split across failing PR checks and a local dependency gap.",
    primaryRunCommand: "pnpm check:frontend",
    issueMode: "reuse_issue",
    existingIssueNumber: 2,
    tasks: [
      {
        title: "Construction - triage PR #1 workflow failures",
        status: "Ready",
        priority: "P0",
        taskType: "Review",
        estimate: "1 day",
        notes: "Review git-hygiene and lockfile-rationale failures on PR #1 and decide whether to fix or explicitly accept them.",
      },
      {
        title: "Construction - restore frontend dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Bring the local frontend dependency baseline back so TypeScript can validate against real code instead of missing-package noise.",
      },
    ],
  },
  {
    title: "RealEstate",
    repoSlug: "saagpatel/RealEstate",
    sourceTitle: "RealEstate GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    effortToDemo: "<2h",
    effortToShip: "1 week",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Keep the active repo mapping, pause the placeholder source rows, and use the current governed issue lane to triage PR #1 and PR #3 workflow failures after the dependency baseline is restored.",
    biggestBlocker:
      "Local lint fails immediately because prettier is missing, and GitHub still shows failing git-hygiene and lockfile-rationale checks on PR #1 and PR #3.",
    projectHealthNotes:
      "RealEstate is already deep in the operating flow, so the remaining work is cleanup and stabilization rather than initial setup.",
    knownRisks:
      "Leaving placeholder source rows and active failing PRs in place will keep the project looking noisier and less trustworthy than it needs to be.",
    whatWorks:
      "The repo already has an active GitHub source, completed onboarding records, webhook delivery history, and a governed issue execution trail.",
    missingCorePieces:
      "Placeholder source cleanup, dependency restore for local checks, and an explicit accept-or-fix decision on the two failing PRs.",
    buildSessionTitle: "Batch rollout - RealEstate",
    buildSessionPlanned:
      "Stabilize RealEstate by cleaning the source mapping, refreshing the execution slice, and capturing the real blocker state from local checks and open PRs.",
    buildSessionShipped:
      "Kept the canonical repo mapping, paused placeholder source rows, refreshed execution records, and captured both the local dependency blocker and current PR failure surface.",
    buildSessionBlockers:
      "Local lint fails because prettier is missing, and PR #1 plus PR #3 still carry failing git-hygiene or lockfile-rationale checks.",
    buildSessionLessons:
      "RealEstate did not need more onboarding; it needed cleaner source truth and a sharper account of the active failure surface.",
    buildSessionNextSteps:
      "Restore the missing frontend dependencies, triage the failing PR checks on the active issue lane, and rerun the repo validation path.",
    decisionTitle: "RealEstate - stabilize the existing lane instead of duplicating setup",
    decisionChosenOption:
      "Use the existing GitHub-backed lane as canonical, pause placeholder sources, and treat dependency restore plus PR-failure triage as the current finish slice.",
    decisionRationale:
      "The repo already has more operating-flow history than most of the batch, so the next value comes from cleanup and trust restoration.",
    packetTitle: "RealEstate - source cleanup and PR failure triage",
    packetStatus: "Ready",
    packetPriority: "Standby",
    packetType: "Finish Push",
    packetGoal:
      "Make RealEstate’s repo state trustworthy by cleaning source rows, restoring local dependencies, and triaging the failing PR checks.",
    packetDefinitionOfDone:
      "The placeholder sources are paused, the dependency baseline is restored, and the failing PR checks are green or explicitly accepted.",
    packetWhyNow:
      "RealEstate is the second-closest project in this batch to a fully stable GitHub-backed lane.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The repo is mostly wired already, but dependency noise and failing PR checks still block a clean readiness call.",
    primaryRunCommand: "pnpm lint",
    issueMode: "reuse_issue",
    existingIssueNumber: 2,
    cleanupSourceTitles: ["RealEstate - GitHub Repo", "RealEstate - Deployment Project"],
    tasks: [
      {
        title: "RealEstate - pause placeholder source rows",
        status: "Ready",
        priority: "P0",
        taskType: "Fix",
        estimate: "<2h",
        notes: "Keep the active repo source canonical by pausing the two placeholder rows that are still marked Needs Mapping.",
      },
      {
        title: "RealEstate - triage PR #1 and PR #3 failures",
        status: "Ready",
        priority: "P0",
        taskType: "Review",
        estimate: "1 day",
        notes: "Decide whether the current git-hygiene and lockfile-rationale failures should be fixed now or explicitly accepted on the active issue lane.",
      },
    ],
  },
  {
    title: "DatabaseSchema",
    repoSlug: "saagpatel/DatabaseSchema",
    sourceTitle: "DatabaseSchema GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the newly created `DatabaseSchema` repo as canonical, restore the frontend dependency baseline, and then rerun the verify path from the first real post-install blocker.",
    biggestBlocker:
      "The first full verify run failed in typecheck because core frontend dependencies like React are missing from the current install state.",
    projectHealthNotes:
      "DatabaseSchema now has a live repo destination and a real first-check blocker, so it is ready for governed execution instead of archive drift.",
    knownRisks:
      "The local package still references the older visualizer naming, so the repo-name decision should stay explicit until the delivery surface settles.",
    whatWorks:
      "The repo exposes a complete verify path and now has a reachable canonical GitHub destination under the chosen `DatabaseSchema` name.",
    missingCorePieces:
      "Dependency restore, a rerun of the full verify path, and the first governed issue slice tied to the canonical repo name.",
    buildSessionTitle: "Batch rollout - DatabaseSchema",
    buildSessionPlanned:
      "Choose the canonical repo name, bring DatabaseSchema into the operating flow, and capture the first live blocker from a real verify run.",
    buildSessionShipped:
      "Created the canonical `saagpatel/DatabaseSchema` repo, wired the project into Notion and GitHub, and captured the missing-dependency typecheck blocker from the first verify run.",
    buildSessionBlockers:
      "The full verify path stops in typecheck because React and related frontend packages are missing from the current install state.",
    buildSessionLessons:
      "The repo-name choice is now settled, so the next useful truth is dependency restoration rather than more naming debate.",
    buildSessionNextSteps:
      "Restore the dependency baseline, rerun `npm run verify:all`, and continue from the first blocker that remains after install is healthy.",
    decisionTitle: "DatabaseSchema - use the new canonical repo and start from real verify evidence",
    decisionChosenOption:
      "Adopt `saagpatel/DatabaseSchema` as the canonical repo name and treat dependency restore as the first governed execution slice.",
    decisionRationale:
      "The project needed a stable GitHub identity before the rest of the operating flow could become trustworthy.",
    packetTitle: "DatabaseSchema - canonical repo and verify baseline",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Build Push",
    packetGoal:
      "Restore the dependency baseline and rerun the full verify path on the canonical `DatabaseSchema` repo.",
    packetDefinitionOfDone:
      "The repo validates past missing-package errors and the next real blocker is captured in the operating flow.",
    packetWhyNow:
      "The project is newly wired and ready for its first real execution slice, but it is behind Construction and RealEstate in the finishing order.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The verify path is blocked before product-level truth because the current install state is incomplete.",
    primaryRunCommand: "npm run verify:all",
    issueMode: "create_issue",
    issueTitle: "DatabaseSchema: restore dependency baseline on the canonical repo",
    issueBody: [
      "## Current state",
      "- The canonical repo is now `saagpatel/DatabaseSchema`.",
      "- The project is wired into the Notion operating flow and GitHub lane.",
      "- `npm run verify:all` currently fails in typecheck because core frontend dependencies are missing from the install state.",
      "",
      "## Next move",
      "- Restore the dependency baseline.",
      "- Rerun `npm run verify:all`.",
      "- Capture the first real blocker that remains after install is healthy.",
      "",
      "## Done when",
      "- The repo validates past missing-package errors.",
      "- The next active blocker is explicit in GitHub and Notion.",
    ].join("\n"),
    tasks: [
      {
        title: "DatabaseSchema - restore dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Install the expected frontend dependencies so the verify path can produce real product-level signal.",
      },
      {
        title: "DatabaseSchema - rerun full verify path",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Run `npm run verify:all` again after dependencies are restored and record the next real blocker or green proof.",
      },
    ],
  },
  {
    title: "LegalDocsReview",
    repoSlug: "saagpatel/LegalDocsReview",
    sourceTitle: "LegalDocsReview GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    testPosture: "Sparse",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the new GitHub repo as canonical, restore the missing node_modules baseline, and rerun lint so the first non-setup blocker can be captured.",
    biggestBlocker:
      "Local lint failed immediately because prettier is not available in the current install state.",
    projectHealthNotes:
      "LegalDocsReview is now wired into the operating flow, but its first real blocker is still basic local dependency restore rather than a product-specific defect.",
    knownRisks:
      "Until the dependency baseline is restored, any stronger readiness claim would be based on scaffolding rather than execution proof.",
    whatWorks:
      "The repo exposes a codex-managed verify surface, has a live canonical GitHub destination, and now has a first concrete local blocker.",
    missingCorePieces:
      "Dependency restore, a rerun of lint and typecheck, and the first governed issue slice against the canonical repo.",
    buildSessionTitle: "Batch rollout - LegalDocsReview",
    buildSessionPlanned:
      "Create the missing repo destination, wire LegalDocsReview into the operating flow, and replace stale archive posture with a real first blocker.",
    buildSessionShipped:
      "Created the canonical GitHub repo, added the operating-flow records, and captured the missing-prettier dependency blocker from the first local check.",
    buildSessionBlockers:
      "Local lint cannot run meaningfully because prettier is missing from the current install state.",
    buildSessionLessons:
      "LegalDocsReview needed visibility and a real repo home before any deeper quality story would matter.",
    buildSessionNextSteps:
      "Restore the dependency baseline, rerun lint and typecheck, and keep the first surviving blocker as the active issue slice.",
    decisionTitle: "LegalDocsReview - activate the repo lane and start from real local proof",
    decisionChosenOption:
      "Use the new GitHub repo as the canonical delivery surface and treat dependency restore as the first execution slice.",
    decisionRationale:
      "The project could not be governed effectively while it lacked both a repo destination and a real first blocker.",
    packetTitle: "LegalDocsReview - dependency restore and first real blocker",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Build Push",
    packetGoal:
      "Restore the dependency baseline and rerun the first local quality commands against the canonical repo.",
    packetDefinitionOfDone:
      "The repo validates past missing-prettier errors and the next real blocker is captured.",
    packetWhyNow:
      "The project is newly onboarded, but it comes after DatabaseSchema in the current execution order.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The current install state is incomplete, so the repo has not reached a product-level quality signal yet.",
    primaryRunCommand: "pnpm lint",
    issueMode: "create_issue",
    issueTitle: "LegalDocsReview: restore dependency baseline and rerun lint",
    issueBody: [
      "## Current state",
      "- The canonical repo is now `saagpatel/LegalDocsReview`.",
      "- The project is wired into the Notion operating flow and GitHub lane.",
      "- `pnpm lint` currently fails because prettier is missing from the local install state.",
      "",
      "## Next move",
      "- Restore the dependency baseline.",
      "- Rerun lint and typecheck.",
      "- Capture the first blocker that remains after the install state is healthy.",
      "",
      "## Done when",
      "- Local quality checks validate past missing-package errors.",
      "- The next active blocker is explicit in GitHub and Notion.",
    ].join("\n"),
    tasks: [
      {
        title: "LegalDocsReview - restore dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Install the missing node_modules baseline so lint and typecheck can reveal real code-level signal.",
      },
      {
        title: "LegalDocsReview - rerun lint and typecheck",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Run the first local quality commands again after dependencies are restored and capture the next blocker.",
      },
    ],
  },
  {
    title: "AIGCCore",
    repoSlug: "saagpatel/AIGCCore",
    sourceTitle: "AIGCCore GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "Unknown",
    effortToShip: "2+ weeks",
    testPosture: "Sparse",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the new GitHub repo as canonical, restore the missing node_modules baseline, and rerun the first frontend gate so AIGCCore can move from setup noise to a real product blocker.",
    biggestBlocker:
      "Local lint failed immediately because eslint is not installed in the current node_modules state.",
    projectHealthNotes:
      "AIGCCore now has a real repo home and operating-flow records, but it still needs the most basic local baseline restored before deeper readiness claims mean anything.",
    knownRisks:
      "Because AIGCCore had the weakest prior confidence in the batch, leaving it without a concrete first blocker would keep it vague and easy to misclassify again.",
    whatWorks:
      "The repo already exposes a broad verify surface across frontend and Rust checks, and it now has a reachable canonical GitHub destination.",
    missingCorePieces:
      "Dependency restore, a rerun of the first frontend gate, and the first governed issue slice based on post-install evidence.",
    buildSessionTitle: "Batch rollout - AIGCCore",
    buildSessionPlanned:
      "Create the missing repo destination, move AIGCCore out of stale archive posture, and capture its first real setup blocker.",
    buildSessionShipped:
      "Created the canonical GitHub repo, wired AIGCCore into the operating flow, and captured the missing-eslint blocker from the first local check.",
    buildSessionBlockers:
      "Local lint fails immediately because eslint is not available in the current install state.",
    buildSessionLessons:
      "AIGCCore needed a truthful baseline more than it needed another abstract readiness label.",
    buildSessionNextSteps:
      "Restore the dependency baseline, rerun lint, and continue from the first blocker that remains after install is healthy.",
    decisionTitle: "AIGCCore - create the repo lane and start from the first real blocker",
    decisionChosenOption:
      "Use the new GitHub repo as canonical and treat dependency restore as the first execution slice before any deeper readiness claim.",
    decisionRationale:
      "AIGCCore was the weakest-readiness project in the batch, so the best next move is a simple, truthful first blocker tied to a real repo home.",
    packetTitle: "AIGCCore - dependency restore and first gate rerun",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Build Push",
    packetGoal:
      "Restore the missing node_modules baseline and rerun the first frontend gate against the canonical repo.",
    packetDefinitionOfDone:
      "The repo validates past missing-eslint errors and the next real blocker is captured.",
    packetWhyNow:
      "AIGCCore is last in the current execution order, but it still needed a real repo home and a real first blocker now.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The project is still blocked at the dependency baseline, so the current signal is setup truth rather than product truth.",
    primaryRunCommand: "pnpm lint",
    issueMode: "create_issue",
    issueTitle: "AIGCCore: restore dependency baseline and rerun lint",
    issueBody: [
      "## Current state",
      "- The canonical repo is now `saagpatel/AIGCCore`.",
      "- The project is wired into the Notion operating flow and GitHub lane.",
      "- `pnpm lint` currently fails because eslint is missing from the local install state.",
      "",
      "## Next move",
      "- Restore the dependency baseline.",
      "- Rerun lint.",
      "- Capture the first blocker that remains after the install state is healthy.",
      "",
      "## Done when",
      "- The repo validates past missing-package errors.",
      "- The next active blocker is explicit in GitHub and Notion.",
    ].join("\n"),
    tasks: [
      {
        title: "AIGCCore - restore dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Install the missing node_modules baseline so the first frontend gate can produce real signal.",
      },
      {
        title: "AIGCCore - rerun lint and capture next blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Run lint again after dependencies are restored and capture the next blocker that survives setup cleanup.",
      },
    ],
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the current batch rollout");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance || !config.phase7Actuation) {
      throw new AppError("Current batch rollout requires phases 2, 5, 6, and 7");
    }
    const phase2 = config.phase2Execution;
    const phase5 = config.phase5ExternalSignals;
    const phase6 = config.phase6Governance;
    const phase7 = config.phase7Actuation;

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, buildSchema, sourceSchema, requestSchema, policySchema, decisionSchema, packetSchema, taskSchema, toolSchema] =
      await Promise.all([
        api.retrieveDataSource(config.database.dataSourceId),
        api.retrieveDataSource(config.relatedDataSources.buildLogId),
        api.retrieveDataSource(phase5.sources.dataSourceId),
        api.retrieveDataSource(phase6.actionRequests.dataSourceId),
        api.retrieveDataSource(phase6.policies.dataSourceId),
        api.retrieveDataSource(phase2.decisions.dataSourceId),
        api.retrieveDataSource(phase2.packets.dataSourceId),
        api.retrieveDataSource(phase2.tasks.dataSourceId),
        api.retrieveDataSource(config.relatedDataSources.toolsId),
      ]);

    const [projectPages, buildPages, sourcePages, requestPages, policyPages, toolPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.policies.dataSourceId, policySchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    ]);

    const projectPageByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const projectRecordByTitle = new Map(projectPages.map((page) => [page.title, toControlTowerProjectRecord(page)]));
    const buildPageByTitle = new Map(buildPages.map((page) => [page.title, page]));
    const sourcePageByTitle = new Map(sourcePages.map((page) => [page.title, page]));
    const sourceRecordByTitle = new Map(sourcePages.map((page) => [page.title, toExternalSignalSourceRecord(page)]));
    const actionRequests = requestPages.map((page) => toActionRequestRecord(page));
    const policies = policyPages.map((page) => toActionPolicyRecord(page));

    let toolByTitle = new Map(toolPages.map((page) => [page.title, page]));
    if (flags.live) {
      await upsertToolSeeds({
        api,
        dataSourceId: config.relatedDataSources.toolsId,
        titlePropertyName: toolSchema.titlePropertyName,
        seeds: TOOL_SEEDS,
      });
      const nextToolPages = await fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName);
      toolByTitle = new Map(nextToolPages.map((page) => [page.title, page]));
    }

    const requestIds: string[] = [];
    const results: Array<Record<string, unknown>> = [];

    for (const target of TARGETS) {
      const projectPage = requirePage(projectPageByTitle, target.title, "project");
      const currentProject = requireRecord(projectRecordByTitle, target.title, "project");

      const existingBuildIds = relationIds(projectPage.properties["Build Sessions"]);
      const existingToolIds = relationIds(projectPage.properties["Tool Stack Records"]);
      const existingResearchIds = relationIds(projectPage.properties["Related Research"]);
      const existingSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
      const toolIds = uniqueIds([
        ...existingToolIds,
        ...COMMON_TOOL_TITLES.map((title) => requirePage(toolByTitle, title, "tool").id),
      ]);

      const buildLog = flags.live
        ? await upsertBuildLog({
            api,
            dataSourceId: config.relatedDataSources.buildLogId,
            titlePropertyName: buildSchema.titlePropertyName,
            existingPageId: buildPageByTitle.get(target.buildSessionTitle)?.id,
            projectId: projectPage.id,
            target,
            today: flags.today,
          })
        : {
            id: buildPageByTitle.get(target.buildSessionTitle)?.id ?? `dry-run-build-${projectPage.id}`,
            url: buildPageByTitle.get(target.buildSessionTitle)?.url ?? "",
          };

      const source = flags.live
        ? await upsertSource({
            api,
            dataSourceId: phase5.sources.dataSourceId,
            titlePropertyName: sourceSchema.titlePropertyName,
            projectId: projectPage.id,
            target,
          })
        : {
            id: `dry-run-source-${projectPage.id}`,
            url: `https://github.com/${target.repoSlug}`,
          };

      if (flags.live) {
        sourceRecordByTitle.set(target.sourceTitle, {
          id: source.id,
          url: source.url,
          title: target.sourceTitle,
          localProjectIds: [projectPage.id],
          provider: "GitHub",
          sourceType: "Repo",
          identifier: target.repoSlug,
          sourceUrl: `https://github.com/${target.repoSlug}`,
          status: "Active",
          environment: "N/A",
          syncStrategy: "Poll",
          lastSyncedAt: "",
        });
      }

      const decision = flags.live
        ? await upsertDecision({
            api,
            dataSourceId: phase2.decisions.dataSourceId,
            titlePropertyName: decisionSchema.titlePropertyName,
            buildLogId: buildLog.id,
            config,
            projectId: projectPage.id,
            target,
            today: flags.today,
          })
        : { id: `dry-run-decision-${projectPage.id}`, url: "" };

      const packet = flags.live
        ? await upsertPacket({
            api,
            dataSourceId: phase2.packets.dataSourceId,
            titlePropertyName: packetSchema.titlePropertyName,
            buildLogId: buildLog.id,
            decisionId: decision.id,
            config,
            projectId: projectPage.id,
            target,
            today: flags.today,
          })
        : { id: `dry-run-packet-${projectPage.id}`, url: "" };

      const tasks = flags.live
        ? await Promise.all(
            target.tasks.map((task) =>
              upsertTask({
                api,
                dataSourceId: phase2.tasks.dataSourceId,
                titlePropertyName: taskSchema.titlePropertyName,
                buildLogId: buildLog.id,
                packetId: packet.id,
                projectId: projectPage.id,
                task,
                today: flags.today,
              }),
            ),
          )
        : target.tasks.map((task, index) => ({ id: `dry-run-task-${projectPage.id}-${index}`, url: "", title: task.title }));

      if (flags.live) {
        await finalizeBuildLog({
          api,
          pageId: buildLog.id,
          decisionId: decision.id,
          packetId: packet.id,
          taskIds: tasks.map((task) => task.id),
        });

        const buildSessionIds = uniqueIds([...existingBuildIds, buildLog.id]);
        await api.updatePageProperties({
          pageId: projectPage.id,
          properties: {
            "Date Updated": { date: { start: flags.today } },
            "Current State": selectPropertyValue(target.currentState),
            "Portfolio Call": selectPropertyValue(target.portfolioCall),
            Momentum: selectPropertyValue(target.momentum),
            "Needs Review": { checkbox: false },
            "Last Active": { date: { start: target.lastActive } },
            "Next Move": richTextValue(target.nextMove),
            "Biggest Blocker": richTextValue(target.biggestBlocker),
            "Setup Friction": selectPropertyValue(target.setupFriction),
            "Runs Locally": selectPropertyValue(target.runsLocally),
            "Build Maturity": selectPropertyValue(target.buildMaturity ?? normalizeBuildMaturity(currentProject.buildMaturity)),
            "Ship Readiness": selectPropertyValue(target.shipReadiness ?? normalizeShipReadiness(currentProject.shipReadiness)),
            "Effort to Demo": selectPropertyValue(target.effortToDemo),
            "Effort to Ship": selectPropertyValue(target.effortToShip),
            "Test Posture": selectPropertyValue(target.testPosture),
            "Docs Quality": selectPropertyValue(target.docsQuality),
            "Evidence Confidence": selectPropertyValue(target.evidenceConfidence),
            "Project Health Notes": richTextValue(target.projectHealthNotes),
            "Known Risks": richTextValue(target.knownRisks),
            "What Works": richTextValue(target.whatWorks),
            "Missing Core Pieces": richTextValue(target.missingCorePieces),
            "Build Sessions": relationValue(buildSessionIds),
            "Related Research": relationValue(existingResearchIds),
            "Supporting Skills": relationValue(existingSkillIds),
            "Tool Stack Records": relationValue(toolIds),
            "Last Build Session": richTextValue(target.buildSessionTitle),
            "Last Build Session Date": { date: { start: flags.today } },
            "Build Session Count": { number: buildSessionIds.length },
            "Related Research Count": { number: existingResearchIds.length },
            "Supporting Skills Count": { number: existingSkillIds.length },
            "Linked Tool Count": { number: toolIds.length },
            "Start Here": richTextValue(`Open the current packet: ${target.packetTitle}`),
            "Primary Run Command": richTextValue(target.primaryRunCommand),
          },
        });

        const currentMarkdown = await api.readPageMarkdown(projectPage.id);
        const merged = mergeManagedSection(
          currentMarkdown.markdown,
          buildProjectSnapshotMarkdown({
            target,
            repoUrl: `https://github.com/${target.repoSlug}`,
            buildLogUrl: buildLog.url,
          }),
          SNAPSHOT_START,
          SNAPSHOT_END,
        );
        if (merged !== currentMarkdown.markdown) {
          await api.patchPageMarkdown({
            pageId: projectPage.id,
            command: "replace_content",
            newMarkdown: merged,
          });
        }
      }

      if (flags.live && target.cleanupSourceTitles?.length) {
        for (const sourceTitle of target.cleanupSourceTitles) {
          const page = sourcePageByTitle.get(sourceTitle);
          if (!page) {
            continue;
          }
          await api.updatePageProperties({
            pageId: page.id,
            properties: {
              Status: selectPropertyValue("Paused"),
            },
          });
          await api.patchPageMarkdown({
            pageId: page.id,
            command: "replace_content",
            newMarkdown: [
              `# ${sourceTitle}`,
              "",
              "- Status: Paused",
              `- Canonical repo source: ${target.sourceTitle}`,
              "",
              "This placeholder row was paused during the current batch rollout so the canonical repo mapping stays clear.",
            ].join("\n"),
          });
        }
      }

      let requestId = "";
      if (flags.live && target.issueMode === "create_issue") {
        const request = await ensureGitHubCreateIssueActionRequest({
          api,
          config,
          actionRequestTitlePropertyName: requestSchema.titlePropertyName,
          policies,
          actionRequests,
          githubSources: [...sourceRecordByTitle.values()],
          requestTitle: `Current batch rollout - ${target.title} - GitHub issue`,
          projectId: projectPage.id,
          projectTitle: target.title,
          projectNextMove: target.nextMove,
          sourceId: source.id,
          today: flags.today,
          approve: true,
          payloadTitle: target.issueTitle ?? `${target.title}: current batch rollout`,
          payloadBody: target.issueBody ?? target.nextMove,
          providerRequestKey: `current-batch-rollout:${projectPage.id}:github.create_issue`,
          approvalReasonApproved:
            "Approved current batch rollout request so the project is fully connected to the governed GitHub issue lane.",
          approvalReasonPending:
            "Pending approval for the current batch rollout GitHub issue request.",
          executionNotes:
            "Created by the current batch rollout workflow to establish the first governed GitHub issue for this project.",
          markdownPurpose:
            "Create the first governed GitHub issue so the project has an active execution surface in GitHub.",
        });
        requestId = request.id;
        requestIds.push(request.id);
      }

      results.push({
        title: target.title,
        projectPageId: projectPage.id,
        sourceId: source.id,
        buildLogId: buildLog.id,
        decisionId: decision.id,
        packetId: packet.id,
        taskIds: tasks.map((task) => task.id),
        requestId,
        issueMode: target.issueMode,
      });
    }

    const followUps: Record<string, unknown> = {};
    let createdIssues: Array<Record<string, unknown>> = [];

    if (flags.live) {
      followUps.actionRequestSyncBeforeRuns = await runScriptJson("portfolio-audit:action-request-sync", ["--live"]);

      if (requestIds.length > 0) {
        createdIssues = await runIssueLane(requestIds);
      }

      followUps.externalSignalSync = await runScriptJson("portfolio-audit:external-signal-sync", ["--provider", "github", "--live"]);
      followUps.controlTowerSync = await runScriptJson("portfolio-audit:control-tower-sync", ["--live"]);
      followUps.executionSync = await runScriptJson("portfolio-audit:execution-sync", ["--live"]);
      followUps.reviewPacket = await runScriptJson("portfolio-audit:review-packet", ["--live"]);
    }

    const liveExecutions =
      flags.live && requestIds.length > 0
        ? await collectCreatedIssueSummaries({
            sdk,
            dataSourceId: phase7.executions.dataSourceId,
            requestIds,
          })
        : [];

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          today: flags.today,
          results,
          createdIssues,
          liveExecutions,
          followUps,
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

async function upsertToolSeeds(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
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
        "Linked Local Projects": relationValue([]),
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

async function upsertBuildLog(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  existingPageId?: string;
  projectId: string;
  target: BatchProjectConfig;
  today: string;
}): Promise<{ id: string; url: string }> {
  const properties = {
    [input.titlePropertyName]: titleValue(input.target.buildSessionTitle),
    "Session Date": { date: { start: input.today } },
    "Session Type": selectPropertyValue("Planning"),
    Outcome: selectPropertyValue("Shipped"),
    "What Was Planned": richTextValue(input.target.buildSessionPlanned),
    "What Shipped": richTextValue(input.target.buildSessionShipped),
    "Blockers Hit": richTextValue(input.target.buildSessionBlockers),
    "Lessons Learned": richTextValue(input.target.buildSessionLessons),
    "Next Steps": richTextValue(input.target.buildSessionNextSteps),
    "Tools Used": multiSelectValue(["Codex CLI (OpenAI)", "Notion", "GitHub"]),
    "Artifacts Updated": multiSelectValue(["notion", "github", "build-log"]),
    Tags: multiSelectValue(["portfolio", "batch", "github"]),
    "Scope Drift": selectPropertyValue("None"),
    "Session Rating": selectPropertyValue("Good"),
    "Follow-up Needed": { checkbox: true },
    "Local Project": relationValue([input.projectId]),
    Duration: richTextValue(""),
    "Model Used": { select: null },
    "Tech Debt Created": richTextValue(""),
    "Project Decisions": relationValue([]),
    "Work Packets": relationValue([]),
    "Execution Tasks": relationValue([]),
  };
  const markdown = [
    `# ${input.target.buildSessionTitle}`,
    "",
    "## What Was Planned",
    input.target.buildSessionPlanned,
    "",
    "## What Shipped",
    input.target.buildSessionShipped,
    "",
    "## Blockers",
    input.target.buildSessionBlockers,
    "",
    "## Lessons",
    input.target.buildSessionLessons,
    "",
    "## Next Steps",
    input.target.buildSessionNextSteps,
  ].join("\n");

  if (input.existingPageId) {
    await input.api.updatePageProperties({
      pageId: input.existingPageId,
      properties,
    });
    await input.api.patchPageMarkdown({
      pageId: input.existingPageId,
      command: "replace_content",
      newMarkdown: markdown,
    });
    return await input.api.retrievePage(input.existingPageId);
  }

  return await input.api.createPageWithMarkdown({
    parent: { data_source_id: input.dataSourceId },
    properties,
    markdown,
  });
}

async function finalizeBuildLog(input: {
  api: DirectNotionClient;
  pageId: string;
  decisionId: string;
  packetId: string;
  taskIds: string[];
}): Promise<void> {
  await input.api.updatePageProperties({
    pageId: input.pageId,
    properties: {
      "Project Decisions": relationValue([input.decisionId]),
      "Work Packets": relationValue([input.packetId]),
      "Execution Tasks": relationValue(input.taskIds),
    },
  });
}

async function upsertSource(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectId: string;
  target: BatchProjectConfig;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.target.sourceTitle,
    properties: {
      [input.titlePropertyName]: titleValue(input.target.sourceTitle),
      "Local Project": relationValue([input.projectId]),
      Provider: selectPropertyValue("GitHub"),
      "Source Type": selectPropertyValue("Repo"),
      Status: selectPropertyValue("Active"),
      Environment: selectPropertyValue("N/A"),
      "Sync Strategy": selectPropertyValue("Poll"),
      Identifier: richTextValue(input.target.repoSlug),
      "Source URL": { url: `https://github.com/${input.target.repoSlug}` },
    },
    markdown: [
      `# ${input.target.sourceTitle}`,
      "",
      "- Provider: GitHub",
      "- Source type: Repo",
      "- Status: Active",
      `- Identifier: ${input.target.repoSlug}`,
      `- Source URL: https://github.com/${input.target.repoSlug}`,
      "",
      "This row is maintained by the current batch rollout workflow so the canonical GitHub repo mapping stays explicit.",
    ].join("\n"),
  });
}

async function upsertDecision(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  buildLogId: string;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  projectId: string;
  target: BatchProjectConfig;
  today: string;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.target.decisionTitle,
    properties: {
      [input.titlePropertyName]: titleValue(input.target.decisionTitle),
      Status: { select: { name: "Committed" } },
      "Decision Type": { select: { name: "Portfolio" } },
      "Decision Owner": peopleValue(input.config.phase2Execution?.defaultOwnerUserId),
      "Proposed On": { date: { start: input.today } },
      "Decided On": { date: { start: input.today } },
      "Revisit By": { date: { start: addDays(input.today, 14) } },
      "Local Project": relationValue([input.projectId]),
      "Chosen Option": richTextValue(input.target.decisionChosenOption),
      Rationale: richTextValue(input.target.decisionRationale),
      "Expected Impact": richTextValue(input.target.nextMove),
      "Build Log Sessions": relationValue([input.buildLogId]),
      "Options Considered": richTextValue("Keep the project in stale archive posture or move it into truthful active execution with a canonical GitHub lane."),
    },
    markdown: [
      `# ${input.target.decisionTitle}`,
      "",
      "## Chosen Option",
      input.target.decisionChosenOption,
      "",
      "## Rationale",
      input.target.decisionRationale,
      "",
      "## Expected Impact",
      input.target.nextMove,
    ].join("\n"),
  });
}

async function upsertPacket(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  buildLogId: string;
  decisionId: string;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  projectId: string;
  target: BatchProjectConfig;
  today: string;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.target.packetTitle,
    properties: {
      [input.titlePropertyName]: titleValue(input.target.packetTitle),
      Status: { status: { name: input.target.packetStatus } },
      "Packet Type": selectPropertyValue(input.target.packetType),
      Priority: selectPropertyValue(input.target.packetPriority),
      Owner: peopleValue(input.config.phase2Execution?.defaultOwnerUserId),
      "Local Project": relationValue([input.projectId]),
      "Driving Decision": relationValue([input.decisionId]),
      Goal: richTextValue(input.target.packetGoal),
      "Definition of Done": richTextValue(input.target.packetDefinitionOfDone),
      "Why Now": richTextValue(input.target.packetWhyNow),
      "Target Start": { date: { start: input.today } },
      "Target Finish": { date: { start: addDays(input.today, input.target.packetEstimatedSize === "1 day" ? 1 : 3) } },
      "Estimated Size": selectPropertyValue(input.target.packetEstimatedSize),
      "Rollover Count": { number: 0 },
      "Execution Tasks": relationValue([]),
      "Build Log Sessions": relationValue([input.buildLogId]),
      "Weekly Reviews": relationValue([]),
      "Blocker Summary": richTextValue(input.target.packetBlockerSummary),
    },
    markdown: [
      `# ${input.target.packetTitle}`,
      "",
      "## Goal",
      input.target.packetGoal,
      "",
      "## Definition of Done",
      input.target.packetDefinitionOfDone,
      "",
      "## Why Now",
      input.target.packetWhyNow,
      "",
      "## Current blocker",
      input.target.packetBlockerSummary,
    ].join("\n"),
  });
}

async function upsertTask(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  buildLogId: string;
  packetId: string;
  projectId: string;
  task: BatchTaskConfig;
  today: string;
}): Promise<{ id: string; url: string; title: string }> {
  const result = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.task.title,
    properties: {
      [input.titlePropertyName]: titleValue(input.task.title),
      Status: { status: { name: input.task.status } },
      Priority: selectPropertyValue(input.task.priority),
      "Task Type": selectPropertyValue(input.task.taskType),
      Estimate: selectPropertyValue(input.task.estimate),
      "Due Date": { date: { start: addDays(input.today, input.task.estimate === "<2h" ? 1 : 2) } },
      "Local Project": relationValue([input.projectId]),
      "Work Packet": relationValue([input.packetId]),
      "Build Log Sessions": relationValue([input.buildLogId]),
      "Task Notes": richTextValue(input.task.notes),
      "Completed On": { date: null },
      Assignee: peopleValue(),
    },
    markdown: [
      `# ${input.task.title}`,
      "",
      `- Status: ${input.task.status}`,
      `- Type: ${input.task.taskType}`,
      `- Priority: ${input.task.priority}`,
      "",
      "## Notes",
      input.task.notes,
    ].join("\n"),
  });
  return {
    ...result,
    title: input.task.title,
  };
}

async function runIssueLane(requestIds: string[]): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const requestId of requestIds) {
    const dryRun = await runScriptJson("portfolio-audit:action-dry-run", ["--request", requestId]);
    const syncAfterDryRun = await runScriptJson("portfolio-audit:action-request-sync", ["--live"]);
    const liveRun = await runScriptJson("portfolio-audit:action-runner", ["--mode", "live", "--request", requestId]);
    const syncAfterLive = await runScriptJson("portfolio-audit:action-request-sync", ["--live"]);
    const webhookDrain = await runScriptJson("portfolio-audit:webhook-shadow-drain", []);
    const webhookReconcile = await runScriptJson("portfolio-audit:webhook-reconcile", ["--provider", "github"]);
    results.push({
      requestId,
      dryRun,
      syncAfterDryRun,
      liveRun,
      syncAfterLive,
      webhookDrain,
      webhookReconcile,
    });
  }
  return results;
}

async function collectCreatedIssueSummaries(input: {
  sdk: Client;
  dataSourceId: string;
  requestIds: string[];
}): Promise<Array<Record<string, unknown>>> {
  const pages = await fetchAllPages(input.sdk, input.dataSourceId, "Name");
  return pages
    .filter((page) => input.requestIds.some((requestId) => relationIds(page.properties["Action Request"]).includes(requestId)))
    .map((page) => ({
      title: page.title,
      issueNumber: page.properties["Issue Number"]?.number ?? null,
      providerUrl: page.properties["Provider URL"]?.url ?? "",
      status: page.properties.Status?.status?.name ?? page.properties.Status?.select?.name ?? "",
      requestIds: relationIds(page.properties["Action Request"]),
    }));
}

function buildProjectSnapshotMarkdown(input: {
  target: BatchProjectConfig;
  repoUrl: string;
  buildLogUrl: string;
}): string {
  const issueLine =
    input.target.issueMode === "reuse_issue" && input.target.existingIssueNumber
      ? `- Active governed issue: [#${input.target.existingIssueNumber}](${input.repoUrl}/issues/${input.target.existingIssueNumber})`
      : `- Governed issue request: Current batch rollout - ${input.target.title} - GitHub issue`;
  return [
    SNAPSHOT_START,
    "## Current Batch Snapshot",
    "",
    `- GitHub repo: [${input.target.repoSlug}](${input.repoUrl})`,
    `- Build-log checkpoint: [${input.target.buildSessionTitle}](${input.buildLogUrl})`,
    issueLine,
    "",
    "### Current slice",
    input.target.nextMove,
    "",
    "### Blocking reality",
    input.target.biggestBlocker,
    "",
    "### Health notes",
    input.target.projectHealthNotes,
    SNAPSHOT_END,
  ].join("\n");
}

function normalizeBuildMaturity(value: string): "Functional Core" | "Feature Complete" | "Demoable" {
  if (value === "Feature Complete" || value === "Demoable") {
    return value;
  }
  return "Functional Core";
}

function normalizeShipReadiness(value: string): "Needs Hardening" | "Near Ship" {
  if (value === "Near Ship") {
    return value;
  }
  return "Needs Hardening";
}

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
  return {
    people: userId ? [{ id: userId }] : [],
  };
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function requirePage<T>(pageMap: Map<string, T>, title: string, kind: string): T {
  const page = pageMap.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page for "${title}"`);
  }
  return page;
}

function requireRecord<T>(recordMap: Map<string, T>, title: string, kind: string): T {
  const record = recordMap.get(title);
  if (!record) {
    throw new AppError(`Could not find ${kind} record for "${title}"`);
  }
  return record;
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

void main();
