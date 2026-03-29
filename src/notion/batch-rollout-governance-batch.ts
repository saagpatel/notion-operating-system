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
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import { ensureGitHubCreateIssueActionRequest, runScriptJson } from "./operational-rollout.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

const SNAPSHOT_START = "<!-- codex:governance-batch-snapshot:start -->";
const SNAPSHOT_END = "<!-- codex:governance-batch-snapshot:end -->";
const COMMON_TOOL_TITLES = ["GitHub", "Notion", "Codex CLI (OpenAI)"] as const;
const TODAY = losAngelesToday();

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
  localPath: string;
  currentState: "Active Build";
  portfolioCall: "Build Now" | "Finish";
  momentum: "Hot" | "Warm";
  setupFriction: "Medium" | "High";
  runsLocally: "Yes" | "Partial" | "Unknown";
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
  packetType: "Build Push" | "Finish Push";
  packetGoal: string;
  packetDefinitionOfDone: string;
  packetWhyNow: string;
  packetEstimatedSize: "1 day" | "2-3 days";
  packetBlockerSummary: string;
  primaryRunCommand: string;
  issueTitle: string;
  issueBody: string;
  tasks: BatchTaskConfig[];
}

interface BatchFlags {
  live: boolean;
  today: string;
}

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
    whatFrustrates: "Signal quality drops when repo mappings, PR posture, or workflow expectations drift from reality.",
    comparedTo: "GitLab",
    whatDelights: "Strong repo, issue, PR, and workflow history for portfolio execution tracking.",
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
    myUseCases: "Control tower, execution planning, governance trail, review packets, and portfolio decisions.",
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
    title: "SlackIncidentBot",
    repoSlug: "saagpatel/SlackIncidentBot",
    sourceTitle: "SlackIncidentBot GitHub Repo",
    localPath: "/Users/d/Projects/ITPRJsViaClaude/SlackIncidentBot",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Demoable",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Ship the local CI workflow repair and generated Cargo.lock to GitHub, rerun the main-branch checks, and link the first green or explicitly accepted workflow proof back into Notion.",
    biggestBlocker:
      "Local Rust verification is healthy, but GitHub main still shows CI and Docker failures until the upload-artifact upgrade and generated Cargo.lock are shipped.",
    projectHealthNotes:
      "SlackIncidentBot is the closest project in this batch to a fully trustworthy finish posture. The remaining work is GitHub hardening, not product uncertainty.",
    knownRisks:
      "If the local workflow repair is not shipped, the public repo will keep looking less ready than the local evidence says it is.",
    whatWorks:
      "cargo fmt, cargo clippy, cargo test --lib, and cargo build --release all passed locally after generating Cargo.lock.",
    missingCorePieces:
      "A committed CI workflow repair, a committed Cargo.lock for Docker, and a rerun of main-branch automation.",
    buildSessionTitle: "Governance batch - SlackIncidentBot",
    buildSessionPlanned:
      "Upgrade SlackIncidentBot from placeholder verification to a real local Rust proof and refresh the GitHub-backed operating records around that truth.",
    buildSessionShipped:
      "Upgraded the local verify contract, generated Cargo.lock, passed the local Rust verification path, and captured the remaining GitHub workflow work needed on main.",
    buildSessionBlockers:
      "The remaining blocker is GitHub-side: main still needs the artifact-action upgrade and committed Cargo.lock before CI and Docker can turn green.",
    buildSessionLessons:
      "SlackIncidentBot was already close to finish; the gap was stale automation contract drift rather than missing core app work.",
    buildSessionNextSteps:
      "Commit and push the workflow plus lockfile repair, rerun GitHub checks, and link the resulting proof into the project page.",
    decisionTitle: "SlackIncidentBot - use passing local Rust proof to drive GitHub hardening",
    decisionChosenOption:
      "Treat the passing local Rust baseline as enough evidence to move SlackIncidentBot into a small GitHub-hardening slice instead of reopening broad investigation.",
    decisionRationale:
      "The repo already demonstrates a healthy local app baseline, so the highest-value next move is making GitHub reflect that truth.",
    packetTitle: "SlackIncidentBot - ship workflow repair and rerun main",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal:
      "Ship the workflow and lockfile repair so GitHub main matches the passing local Rust baseline.",
    packetDefinitionOfDone:
      "The GitHub main branch is green or explicitly accepted with the repaired CI and Docker posture documented.",
    packetWhyNow:
      "This is the fastest project in the batch to move from mostly-ready to clearly trustworthy.",
    packetEstimatedSize: "1 day",
    packetBlockerSummary:
      "Local proof is good; GitHub main still lags because the workflow and lockfile repair are not shipped yet.",
    primaryRunCommand: "cargo build --release",
    issueTitle: "SlackIncidentBot: ship workflow repair and rerun main checks",
    issueBody: [
      "## Current state",
      "- Local Rust verification is healthy: `cargo fmt`, `cargo clippy`, `cargo test --lib`, and `cargo build --release` all passed.",
      "- A fresh `Cargo.lock` was generated locally for the binary app.",
      "- GitHub main still shows CI and Docker failures because the workflow and lockfile repair are not shipped yet.",
      "",
      "## Next move",
      "- Commit and push the local CI workflow repair.",
      "- Commit the generated `Cargo.lock` so Docker can build on GitHub.",
      "- Rerun the main-branch checks and log the resulting posture.",
      "",
      "## Done when",
      "- GitHub main is green or explicitly accepted with the exact remaining risk documented.",
    ].join("\n"),
    tasks: [
      {
        title: "SlackIncidentBot - ship CI and lockfile repair",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Push the upload-artifact upgrade and generated Cargo.lock so GitHub main can rerun with the same baseline that passed locally.",
      },
      {
        title: "SlackIncidentBot - capture post-rerun workflow posture",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "<2h",
        notes: "Record the first green or explicitly accepted main-branch CI and Docker result in the operating flow.",
      },
    ],
  },
  {
    title: "SmartClipboard",
    repoSlug: "saagpatel/SmartClipboard",
    sourceTitle: "SmartClipboard GitHub Repo",
    localPath: "/Users/d/Projects/ITPRJsViaClaude/SmartClipboard",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Demoable",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Restore the npm install state on the current working tree, rerun build and test from a healthy dependency baseline, and turn the existing dirty tree into one explicit governed slice.",
    biggestBlocker:
      "The repo guard and perf entrypoints start cleanly, but the build currently fails because node_modules are missing core React and highlight.js dependencies. The stale Dependabot PR was closed because repo policy blocks its branch and commit format.",
    projectHealthNotes:
      "SmartClipboard now has a cleaner GitHub posture, but it still needs a healthy local install baseline before its current dirty tree can be assessed honestly.",
    knownRisks:
      "If the install baseline is not restored, the repo will keep reporting setup noise instead of the first real product blocker in the current branch.",
    whatWorks:
      "The canonical GitHub repo is live, the stale Dependabot PR was closed, and `npm run git:guard:all` plus the perf wrappers get through to the real build failure.",
    missingCorePieces:
      "A healthy npm install, a rerun of build and tests, and one explicit slice for the current local changes.",
    buildSessionTitle: "Governance batch - SmartClipboard",
    buildSessionPlanned:
      "Refresh SmartClipboard from stale PR-noise posture into a truthful local-blocker story backed by the governed GitHub lane.",
    buildSessionShipped:
      "Confirmed the repo mapping, closed the stale Dependabot PR, preserved the issue lane, and captured the missing node_modules blocker from the local build path.",
    buildSessionBlockers:
      "The current dependency install state is incomplete, so the build stops before the repo can prove the next code-level blocker.",
    buildSessionLessons:
      "The repo was not mainly blocked by GitHub wiring anymore; it was blocked by a noisy dependency PR and an incomplete local install baseline.",
    buildSessionNextSteps:
      "Restore the npm install baseline, rerun build and test, and capture the first blocker that survives setup cleanup.",
    decisionTitle: "SmartClipboard - close stale PR noise and treat install restore as the active slice",
    decisionChosenOption:
      "Use the governed lane that already exists, close the policy-incompatible Dependabot PR, and treat dependency restore as the active finish slice.",
    decisionRationale:
      "The repo already has the operating-flow scaffolding it needs, so the next value comes from replacing stale PR noise with a truthful local blocker.",
    packetTitle: "SmartClipboard - restore npm baseline and capture first real blocker",
    packetStatus: "Ready",
    packetPriority: "Standby",
    packetType: "Finish Push",
    packetGoal:
      "Restore the npm install baseline so build and test can reveal the first surviving product blocker on the current working tree.",
    packetDefinitionOfDone:
      "Build and test run from a healthy install state and the next blocker is explicit in GitHub and Notion.",
    packetWhyNow:
      "SmartClipboard is already wired into the operating flow, so it can move quickly once the local install state is healthy.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The current install state is incomplete, so the build never reaches the first code-level blocker on the dirty tree.",
    primaryRunCommand: "npm run build",
    issueTitle: "SmartClipboard: restore npm install state and capture next blocker",
    issueBody: [
      "## Current state",
      "- The stale Dependabot PR was closed because repo policy blocks its branch and commit format.",
      "- `npm run git:guard:all` and the perf wrappers reach the real build path locally.",
      "- `npm run build` currently fails because node_modules are missing core React and highlight.js dependencies.",
      "",
      "## Next move",
      "- Restore the npm install baseline on the current working tree.",
      "- Rerun build and tests.",
      "- Capture the first blocker that survives setup cleanup.",
      "",
      "## Done when",
      "- The repo validates from a healthy install state and the next blocker is explicit.",
    ].join("\n"),
    tasks: [
      {
        title: "SmartClipboard - restore npm install baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Run the install path needed for React, highlight.js, and the rest of the current frontend dependency set.",
      },
      {
        title: "SmartClipboard - capture first post-install blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once build and test can run from a healthy install state, record the first blocker that remains on the current branch.",
      },
    ],
  },
  {
    title: "SnippetLibrary",
    repoSlug: "saagpatel/SnippetLibrary",
    sourceTitle: "SnippetLibrary GitHub Repo",
    localPath: "/Users/d/Projects/ITPRJsViaClaude/SnippetLibrary",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the new canonical repo and pushed codex branch as the execution surface, then turn the current 22-file local delta into one explicit governed slice with a tighter done-state.",
    biggestBlocker:
      "The repo home problem is now resolved and the local Swift baseline is healthy. The real blocker is execution focus: the current dirty tree is large and needs to be turned into one bounded slice.",
    projectHealthNotes:
      "SnippetLibrary is healthier than the old operating story suggested. Build and tests pass locally, so the missing piece is delivery focus, not basic app viability.",
    knownRisks:
      "If the 22-file local delta is not sliced intentionally, future sessions will have trouble knowing what should ship together and what can wait.",
    whatWorks:
      "A new canonical GitHub repo now exists, both `main` and the current codex branch are pushed, and `swift build` plus `swift test` passed locally.",
    missingCorePieces:
      "One explicit governed slice for the current dirty tree and a follow-up decision about what should merge first.",
    buildSessionTitle: "Governance batch - SnippetLibrary",
    buildSessionPlanned:
      "Re-home SnippetLibrary into a canonical GitHub repo, prove the local Swift baseline, and replace missing-lane ambiguity with an execution-ready operating story.",
    buildSessionShipped:
      "Created the canonical GitHub repo, pushed the baseline branches, passed `swift build` and `swift test`, and reframed the blocker around the current dirty-tree slice instead of setup drift.",
    buildSessionBlockers:
      "The current blocker is not build health. It is the need to turn a large local delta into one bounded, governed slice.",
    buildSessionLessons:
      "SnippetLibrary no longer needs onboarding investigation. It needs explicit execution slicing against a healthy local baseline.",
    buildSessionNextSteps:
      "Choose the first bounded slice from the current dirty tree, open or refresh the governed issue, and keep the merge surface small.",
    decisionTitle: "SnippetLibrary - treat the new repo and passing Swift baseline as enough to start execution",
    decisionChosenOption:
      "Use the new canonical repo immediately and treat execution slicing, not setup repair, as the active work.",
    decisionRationale:
      "The project now has both a real repo home and passing local Swift proof, which is enough to move into governed execution.",
    packetTitle: "SnippetLibrary - slice the current delta against a passing Swift baseline",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Build Push",
    packetGoal:
      "Turn the current local delta into one bounded slice while preserving the healthy Swift build and test baseline.",
    packetDefinitionOfDone:
      "The current dirty tree is narrowed into one explicit slice with a crisp done-state and the passing Swift baseline remains intact.",
    packetWhyNow:
      "The repo re-home and build proof are already done, so the next value is shaping the current branch into a tractable execution surface.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The project is no longer blocked on setup; it is blocked on delivery focus for a large local delta.",
    primaryRunCommand: "swift test",
    issueTitle: "SnippetLibrary: slice the current dirty tree against a passing Swift baseline",
    issueBody: [
      "## Current state",
      "- The canonical repo is now `saagpatel/SnippetLibrary`.",
      "- Both `main` and the current codex branch are pushed.",
      "- `swift build` and `swift test` both passed locally.",
      "",
      "## Next move",
      "- Turn the current local delta into one bounded execution slice.",
      "- Keep the passing Swift baseline intact while that slice is shaped.",
      "- Use the governed issue to track what belongs in the first merge surface.",
      "",
      "## Done when",
      "- The first slice from the current dirty tree is explicit and the local Swift baseline is still healthy.",
    ].join("\n"),
    tasks: [
      {
        title: "SnippetLibrary - define the first bounded dirty-tree slice",
        status: "Ready",
        priority: "P0",
        taskType: "Decision Prep",
        estimate: "Half day",
        notes: "Decide which portion of the current 22-file local delta should become the first governed merge surface.",
      },
      {
        title: "SnippetLibrary - preserve the passing Swift baseline while slicing",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Keep `swift build` and `swift test` healthy while the first slice is being shaped and reviewed.",
      },
    ],
  },
  {
    title: "TicketDashboard",
    repoSlug: "saagpatel/TicketDashboard",
    sourceTitle: "TicketDashboard GitHub Repo",
    localPath: "/Users/d/Projects/ITPRJsViaClaude/TicketDashboard",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Demoable",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Restore the npm install state, rerun build and tests on the current branch, and then decide the first finish slice now that the stale Dependabot PR backlog has been cleared.",
    biggestBlocker:
      "The dependency PR backlog is closed and the verification contract now matches npm, but the build still fails because node_modules are missing React, Recharts, and Tauri dependencies.",
    projectHealthNotes:
      "TicketDashboard is operationally cleaner now, but it still needs a healthy install baseline before the real product blocker on the current branch can be assessed.",
    knownRisks:
      "Without restoring the install baseline, the repo will stay stuck in setup noise even though the GitHub backlog is already triaged.",
    whatWorks:
      "The stale Dependabot PRs were closed, `npm run git:guard:all` passes with the corrected npm contract, and the build path now points directly at the missing dependency baseline.",
    missingCorePieces:
      "A healthy npm install, a rerun of build and tests, and a bounded finish slice for the current repo state.",
    buildSessionTitle: "Governance batch - TicketDashboard",
    buildSessionPlanned:
      "Triage the noisy dependency PR backlog, align TicketDashboard's verification contract with npm, and capture the first real local blocker on the repo.",
    buildSessionShipped:
      "Closed the stale Dependabot PRs, aligned the npm-based verification contract, and captured the missing node_modules blocker from the local build path.",
    buildSessionBlockers:
      "The local dependency install state is incomplete, so build still stops before the repo reaches the next code-level blocker.",
    buildSessionLessons:
      "TicketDashboard needed operational cleanup and install truth more than it needed another round of generic review language.",
    buildSessionNextSteps:
      "Restore the npm install baseline, rerun build and tests, and decide the first finish slice after the setup noise is gone.",
    decisionTitle: "TicketDashboard - clear stale PR noise and treat install restore as the active slice",
    decisionChosenOption:
      "Use the existing GitHub lane, close the policy-incompatible Dependabot PRs, and treat dependency restore as the current finish slice.",
    decisionRationale:
      "The repo already has the right operating scaffolding, so the next value comes from cleaning the signal and reaching the first real local blocker.",
    packetTitle: "TicketDashboard - restore npm baseline and rerun finish checks",
    packetStatus: "Ready",
    packetPriority: "Standby",
    packetType: "Finish Push",
    packetGoal:
      "Restore the npm install baseline so build and test can reveal the first surviving finish blocker.",
    packetDefinitionOfDone:
      "Build and test run from a healthy install state and the first surviving finish blocker is explicit.",
    packetWhyNow:
      "The dependency PR backlog is already handled, so the local install baseline is now the clearest remaining gate.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The verification contract is fixed, but the repo still needs node_modules before it can prove the next code-level blocker.",
    primaryRunCommand: "npm run build",
    issueTitle: "TicketDashboard: restore npm install state and capture next blocker",
    issueBody: [
      "## Current state",
      "- The stale Dependabot PR backlog was closed because repo policy blocks those branch and commit formats.",
      "- The local verification contract now matches npm instead of pnpm.",
      "- `npm run build` currently fails because node_modules are missing core React, Recharts, and Tauri dependencies.",
      "",
      "## Next move",
      "- Restore the npm install baseline.",
      "- Rerun build and tests.",
      "- Capture the first blocker that survives setup cleanup.",
      "",
      "## Done when",
      "- The repo validates from a healthy install state and the next finish blocker is explicit.",
    ].join("\n"),
    tasks: [
      {
        title: "TicketDashboard - restore npm install baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Install the React, Recharts, Tauri, and related frontend dependencies needed for the build path to run meaningfully.",
      },
      {
        title: "TicketDashboard - record first post-install finish blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once build and tests can run from a healthy install state, capture the first blocker that still prevents a finish call.",
      },
    ],
  },
  {
    title: "TicketDocumentation",
    repoSlug: "saagpatel/TicketDocumentation",
    sourceTitle: "TicketDocumentation GitHub Repo",
    localPath: "/Users/d/Projects/ITPRJsViaClaude/TicketDocumentation",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    testPosture: "Sparse",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use the new canonical repo as the governed surface, restore the pnpm install baseline, and rerun build and tests so the first surviving blocker replaces setup drift.",
    biggestBlocker:
      "The canonical repo now exists and the guard path reaches the build, but the frontend and Tauri dependency baseline is missing so `pnpm build` fails before the real app blocker can surface.",
    projectHealthNotes:
      "TicketDocumentation is now properly onboarded into GitHub, but it still needs its first healthy install baseline before readiness claims can move beyond setup truth.",
    knownRisks:
      "Without restoring the dependency baseline, the project will stay stuck at generic missing-package errors and never expose the first real product issue.",
    whatWorks:
      "The new canonical GitHub repo exists, both `main` and the current codex branch are pushed, and the pnpm guard plus perf wrappers reach the real build path.",
    missingCorePieces:
      "A healthy pnpm install, the first post-install build and test proof, and an explicit issue-backed execution slice.",
    buildSessionTitle: "Governance batch - TicketDocumentation",
    buildSessionPlanned:
      "Re-home TicketDocumentation into a canonical GitHub repo, wire it into the governed operating flow, and capture the first real local blocker.",
    buildSessionShipped:
      "Created the canonical GitHub repo, pushed the baseline branches, created the missing operating records, and captured the missing dependency blocker from the local build path.",
    buildSessionBlockers:
      "The current install state is incomplete, so the build still stops before the first product-specific blocker is visible.",
    buildSessionLessons:
      "TicketDocumentation needed a repo home and a truthful first blocker more than it needed another generic readiness label.",
    buildSessionNextSteps:
      "Restore the pnpm install baseline, rerun build and tests, and use the governed issue to track the first blocker that survives setup cleanup.",
    decisionTitle: "TicketDocumentation - use the new canonical repo and start from install truth",
    decisionChosenOption:
      "Adopt `saagpatel/TicketDocumentation` as the canonical repo immediately and treat dependency restore as the first governed execution slice.",
    decisionRationale:
      "The project could not be operated cleanly without a real repo destination, and that gap is now closed.",
    packetTitle: "TicketDocumentation - canonical repo and first post-install blocker",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Build Push",
    packetGoal:
      "Restore the pnpm install baseline and rerun the first local quality path against the canonical repo.",
    packetDefinitionOfDone:
      "The repo validates from a healthy install state and the first real blocker is explicit in GitHub and Notion.",
    packetWhyNow:
      "The missing repo destination is fixed, so the next value is moving from onboarding to the first truthful execution slice.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The repo home is fixed, but the current install state is incomplete so build and test cannot yet reach the first real blocker.",
    primaryRunCommand: "pnpm build",
    issueTitle: "TicketDocumentation: restore pnpm install state and capture first blocker",
    issueBody: [
      "## Current state",
      "- The canonical repo is now `saagpatel/TicketDocumentation`.",
      "- Both `main` and the current codex branch are pushed.",
      "- `pnpm build` currently fails because node_modules are missing React, Tauri, and test-related dependencies.",
      "",
      "## Next move",
      "- Restore the pnpm install baseline.",
      "- Rerun build and tests.",
      "- Capture the first blocker that survives setup cleanup.",
      "",
      "## Done when",
      "- The repo validates from a healthy install state and the first real blocker is explicit.",
    ].join("\n"),
    tasks: [
      {
        title: "TicketDocumentation - restore pnpm install baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Install the frontend and Tauri dependency baseline so build and tests can produce real signal.",
      },
      {
        title: "TicketDocumentation - record first post-install blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once the install state is healthy, record the first blocker that remains on the canonical repo.",
      },
    ],
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the governance batch rollout");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance || !config.phase7Actuation) {
      throw new AppError("Governance batch rollout requires phases 2, 5, 6, and 7");
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
      const existingResearchIds = relationIds(projectPage.properties["Related Research"]);
      const existingSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
      const existingToolIds = relationIds(projectPage.properties["Tool Stack Records"]);
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
            url: "",
          };

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
            "Local Path": richTextValue(target.localPath),
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

      if (flags.live) {
        const request = await ensureGitHubCreateIssueActionRequest({
          api,
          config,
          actionRequestTitlePropertyName: requestSchema.titlePropertyName,
          policies,
          actionRequests,
          githubSources: [...sourceRecordByTitle.values()],
          requestTitle: `Governance batch - ${target.title} - GitHub issue`,
          projectId: projectPage.id,
          projectTitle: target.title,
          projectNextMove: target.nextMove,
          sourceId: source.id,
          today: flags.today,
          approve: true,
          payloadTitle: target.issueTitle,
          payloadBody: target.issueBody,
          providerRequestKey: `governance-batch:${projectPage.id}:github.create_issue`,
          approvalReasonApproved:
            "Approved governance batch request so the project is fully connected to the governed GitHub issue lane.",
          approvalReasonPending: "Pending approval for the governance batch GitHub issue request.",
          executionNotes:
            "Created by the governance batch rollout workflow to establish or refresh the governed GitHub issue for this project.",
          markdownPurpose:
            "Create the governed GitHub issue so the project has a current execution surface in GitHub.",
        });
        requestIds.push(request.id);

        results.push({
          title: target.title,
          projectPageId: projectPage.id,
          sourceId: source.id,
          buildLogId: buildLog.id,
          decisionId: decision.id,
          packetId: packet.id,
          taskIds: tasks.map((task) => task.id),
          requestId: request.id,
        });
      } else {
        results.push({
          title: target.title,
          projectPageId: projectPage.id,
          sourceId: source.id,
          buildLogId: buildLog.id,
          decisionId: decision.id,
          packetId: packet.id,
          taskIds: tasks.map((task) => task.id),
        });
      }
    }

    const followUps: Record<string, unknown> = {};
    let createdIssues: Array<Record<string, unknown>> = [];

    if (flags.live) {
      followUps.actionRequestSyncBeforeRuns = await runScriptJson("portfolio-audit:action-request-sync", ["--live"]);
      createdIssues = await runIssueLane(requestIds);
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
    Tags: multiSelectValue(["portfolio", "batch", "governance"]),
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
      "This row is maintained by the governance batch rollout so the canonical GitHub repo mapping stays explicit.",
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
      "Options Considered": richTextValue("Keep stale readiness language or move the project into a truthful GitHub-backed execution slice."),
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
  return [
    SNAPSHOT_START,
    "## Governance Batch Snapshot",
    "",
    `- GitHub repo: [${input.target.repoSlug}](${input.repoUrl})`,
    `- Local path: \`${input.target.localPath}\``,
    `- Build-log checkpoint: [${input.target.buildSessionTitle}](${input.buildLogUrl})`,
    `- Governed issue request: Governance batch - ${input.target.title} - GitHub issue`,
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

function requirePage<T extends { id: string }>(pageMap: Map<string, T>, title: string, kind: string): T {
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
