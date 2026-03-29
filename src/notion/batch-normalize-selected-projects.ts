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

const SNAPSHOT_START = "<!-- codex:selected-batch-normalize:start -->";
const SNAPSHOT_END = "<!-- codex:selected-batch-normalize:end -->";

interface BatchTaskConfig {
  title: string;
  status: "Ready" | "Blocked";
  priority: "P0" | "P1" | "P2";
  taskType: "Build" | "Review" | "Decision Prep" | "Fix" | "Ship";
  estimate: "<2h" | "Half day" | "1 day" | "2+ days";
  notes: string;
}

interface BatchProjectConfig {
  title: string;
  repoSlug: string;
  sourceTitle: string;
  currentState: "Active Build" | "Ready for Review";
  portfolioCall: "Build Now" | "Finish";
  momentum: "Hot" | "Warm" | "Cold";
  setupFriction: "Low" | "Medium" | "High";
  runsLocally: "Yes" | "Partial" | "Likely" | "Unknown";
  buildMaturity?: "Functional Core" | "Feature Complete" | "Demoable";
  shipReadiness?: "Needs Hardening" | "Near Ship";
  effortToDemo: "<2h" | "2-3 days" | "Unknown";
  effortToShip: "2-3 days" | "1 week" | "2+ weeks";
  testPosture: "Strong" | "Some" | "Sparse";
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

const TODAY = losAngelesToday();

const TARGETS: BatchProjectConfig[] = [
  {
    title: "OPscinema",
    repoSlug: "saagpatel/OPscinema",
    sourceTitle: "OPscinema GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "1 week",
    testPosture: "Strong",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Run the desktop happy path on the newly connected canonical repo and turn the passing Rust workspace baseline into the first finish-oriented execution slice.",
    biggestBlocker:
      "The canonical repo and governed issue lane now exist, and the Rust workspace tests are green, but desktop happy-path validation still has not been captured on the connected GitHub baseline.",
    projectHealthNotes:
      "OPscinema is healthier than its archived posture implied. The repo now has a live GitHub home and strong Rust test evidence, but app-level validation still needs to catch up.",
    knownRisks:
      "If we stop at workspace test evidence, the project can look more ready in Notion than it really is in the desktop experience and release lane.",
    whatWorks:
      "The Rust workspace test suite passed cleanly, the repo now exists under the canonical GitHub home, and the operating flow can finally track real delivery work.",
    missingCorePieces:
      "Desktop happy-path proof, a bounded finish slice rooted in the passing Rust baseline, and release-facing validation beyond the current test suite.",
    buildSessionTitle: "Batch normalize - OPscinema",
    buildSessionPlanned:
      "Reopen OPscinema from archive, create the canonical GitHub home, and replace placeholder readiness language with live test evidence.",
    buildSessionShipped:
      "Created the canonical repo, connected the project to the governed GitHub lane, and captured the passing Rust workspace baseline in the operating flow.",
    buildSessionBlockers:
      "Workspace tests pass, but the desktop happy path and release-facing validation have not been run on the newly connected canonical repo.",
    buildSessionLessons:
      "OPscinema was operationally underwired more than it was technically broken, so the next step is deeper product validation rather than setup repair.",
    buildSessionNextSteps:
      "Run the desktop happy path, capture the first blocker or pass, and use the new GitHub issue lane to define a bounded finish slice.",
    decisionTitle: "OPscinema - reopen from archive on passing Rust evidence",
    decisionChosenOption:
      "Treat the passing Rust workspace baseline and new canonical GitHub home as enough evidence to reopen OPscinema into finish-oriented execution.",
    decisionRationale:
      "Archive posture was stale. The healthier truth is a connected project with strong local test evidence that now needs app-level validation, not neglect.",
    packetTitle: "OPscinema - desktop happy path after canonical repo setup",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal:
      "Validate the desktop happy path on the canonical GitHub baseline and record the next concrete finish blocker or pass.",
    packetDefinitionOfDone:
      "Desktop validation is captured, the next blocker is explicit, and the first finish slice is visible in the governed issue lane.",
    packetWhyNow:
      "This project already has the strongest local test proof in the batch, so the highest-leverage work is to move it from disconnected archive state into active finish mode.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The remaining truth gap is not missing dependencies anymore; it is missing app-level validation on the newly connected canonical repo.",
    primaryRunCommand: "cargo test --workspace --all-targets",
    issueMode: "create_issue",
    issueTitle: "OPscinema: validate desktop happy path after canonical repo setup",
    issueBody: [
      "## Current state",
      "- The canonical `saagpatel/OPscinema` repo now exists and is connected to the operating flow.",
      "- `cargo test --workspace --all-targets` passed during the batch normalization pass.",
      "- The project was previously archived in Notion, but the current evidence is stronger than that posture showed.",
      "",
      "## Next move",
      "- Run the desktop happy path on the connected repo baseline.",
      "- Capture the first blocker or pass beyond the Rust workspace suite.",
      "- Use that result to define the first finish-oriented slice.",
      "",
      "## Done when",
      "- Desktop validation is captured.",
      "- The next blocker or pass is explicit in GitHub and Notion.",
    ].join("\n"),
    tasks: [
      {
        title: "OPscinema - run desktop happy path on canonical repo",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Move beyond the passing Rust workspace suite and capture the first desktop-level blocker or pass.",
      },
      {
        title: "OPscinema - define first finish slice from test baseline",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Turn the passing Rust baseline and desktop result into a bounded finish-oriented issue slice.",
      },
    ],
  },
  {
    title: "SignalFlow",
    repoSlug: "saagpatel/SignalFlow",
    sourceTitle: "SignalFlow GitHub Repo",
    currentState: "Ready for Review",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Demoable",
    shipReadiness: "Near Ship",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Strong",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Use issue #2 to reconcile the still-open PR and workflow failure surface against the now-passing local verify baseline, then decide whether any follow-up fix slice is still needed.",
    biggestBlocker:
      "Local verification now passes end to end after the dependency restore, so the remaining blocker is operational: two open PRs and three recent failed workflow runs still need explicit triage against the new local baseline.",
    projectHealthNotes:
      "SignalFlow is clearly no longer archive work. After restoring dependencies it passed the full local verify flow, which is much stronger evidence than the old archived posture suggested.",
    knownRisks:
      "If the GitHub PR and workflow failures are left untriaged, the repo will still look riskier in delivery than its now-passing local baseline suggests.",
    whatWorks:
      "The canonical repo, source row, action lane, and local `main` branch are now aligned, and the full local verify flow passes after install restoration.",
    missingCorePieces:
      "Reconcile the open PR and workflow failures inside the governed issue lane and decide whether any code changes are still required beyond the passing local baseline.",
    buildSessionTitle: "Batch normalize - SignalFlow",
    buildSessionPlanned:
      "Replace stale archive posture with live repo truth, restore the dependency baseline, and capture the first blocker after the missing-eslint setup noise is gone.",
    buildSessionShipped:
      "Restored the pnpm install state, normalized local main tracking, paused duplicate placeholder source rows, and passed the full local verify flow end to end.",
    buildSessionBlockers:
      "The remaining work is no longer local verification. It is explicit PR and workflow failure triage against the now-passing local baseline.",
    buildSessionLessons:
      "SignalFlow was substantially healthier than its archived Notion posture suggested once the install baseline was restored and the verify flow could run completely.",
    buildSessionNextSteps:
      "Reconcile the current GitHub PR and workflow failures through the existing issue lane and decide whether any remaining fix slice is still necessary.",
    decisionTitle: "SignalFlow - reopen from archive on restored local and GitHub evidence",
    decisionChosenOption:
      "Treat SignalFlow as an active finish candidate because the dependency restore unlocked a passing local verify baseline and the canonical GitHub lane already exists.",
    decisionRationale:
      "Archive posture was stale and misleading. The project now has stronger evidence than many active repos, with remaining work centered on delivery triage rather than local setup or correctness.",
    packetTitle: "SignalFlow - finish verify tail and triage GitHub failures",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal:
      "Reconcile the open PR and workflow failures against the now-passing local baseline and decide whether any fix slice is still required.",
    packetDefinitionOfDone:
      "The GitHub failure surface is triaged through the active governed issue and the next slice is explicit, whether that is a fix or a ready-to-finish call.",
    packetWhyNow:
      "SignalFlow already had the GitHub lane; the missing install state was the main thing keeping it from truthful readiness assessment.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The project is now gated by GitHub failure triage rather than missing dependencies, placeholder mappings, or failing local verification.",
    primaryRunCommand: "bash .codex/scripts/run_verify_commands.sh",
    issueMode: "reuse_issue",
    existingIssueNumber: 2,
    cleanupSourceTitles: ["SignalFlow - GitHub Repo", "SignalFlow - Deployment Project"],
    tasks: [
      {
        title: "SignalFlow - triage PR and workflow failure surface",
        status: "Ready",
        priority: "P0",
        taskType: "Review",
        estimate: "Half day",
        notes: "Use the current governed issue to reconcile the two open PRs and recent failed workflow runs with the now-passing local verify baseline.",
      },
      {
        title: "SignalFlow - decide next slice after triage",
        status: "Ready",
        priority: "P1",
        taskType: "Decision Prep",
        estimate: "1 day",
        notes: "After triaging the GitHub failure surface, decide whether SignalFlow needs one more fix slice or can move directly toward finish readiness.",
      },
    ],
  },
  {
    title: "Nexus",
    repoSlug: "saagpatel/Nexus",
    sourceTitle: "Nexus GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Demoable",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "1 week",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Restore or replace the missing desktop build scripts, rerun `pnpm test:e2e:smoke`, and then reconcile the current PR and workflow failure surface through issue #1.",
    biggestBlocker:
      "After restoring dependencies, typecheck and unit tests passed, but desktop smoke now fails because `build:main` still points at missing `scripts/build/build-main.mjs`, `build-preload.mjs`, and `build-renderer-electron.mjs` files.",
    projectHealthNotes:
      "Nexus is healthier than its archived posture suggested. The dependency baseline is restored and fast checks are green, but desktop execution is blocked by missing build-script files in the active worktree.",
    knownRisks:
      "If the missing desktop build scripts are not reconciled, the project will look healthier in GitHub and Notion than it is for desktop packaging and smoke validation.",
    whatWorks:
      "The canonical repo, source row, action lane, and local `main` branch are now aligned, and both typecheck and 129 unit tests passed after install restoration.",
    missingCorePieces:
      "Restore the missing build-script files, rerun desktop smoke, and then line that result up with the existing PR and workflow failure surface.",
    buildSessionTitle: "Batch normalize - Nexus",
    buildSessionPlanned:
      "Replace the stale archive posture, restore the dependency baseline, and capture the first real blocker after the missing `vue-tsc` setup failure.",
    buildSessionShipped:
      "Restored the pnpm install state, normalized local main tracking, paused duplicate placeholder source rows, and confirmed that typecheck and unit tests now pass.",
    buildSessionBlockers:
      "Desktop smoke moved the blocker deeper: `pnpm build:main` fails because the expected build scripts are missing from `scripts/build`.",
    buildSessionLessons:
      "The old dependency blocker was hiding a more important desktop packaging problem in the active worktree.",
    buildSessionNextSteps:
      "Restore or replace the missing build scripts, rerun `pnpm test:e2e:smoke`, and then assess the remaining GitHub PR and workflow failure surface.",
    decisionTitle: "Nexus - reopen from archive on restored baseline and real desktop blocker",
    decisionChosenOption:
      "Treat Nexus as active build work because the restored install state exposed a concrete desktop blocker rather than a setup placeholder.",
    decisionRationale:
      "Archive posture was stale. The repo already has a canonical GitHub lane, passing fast checks, and a concrete next blocker that deserves active execution.",
    packetTitle: "Nexus - restore desktop build scripts and rerun smoke",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Build Push",
    packetGoal:
      "Restore the missing desktop build scripts and rerun the smoke flow until the next meaningful blocker is explicit.",
    packetDefinitionOfDone:
      "The missing build scripts are reconciled, desktop smoke reruns, and the next blocker is captured in the existing governed issue lane.",
    packetWhyNow:
      "The dependency baseline no longer blocks understanding, so the highest-value work is to fix the newly exposed desktop failure path.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "Nexus is now gated by missing desktop build scripts rather than missing `node_modules`.",
    primaryRunCommand: "pnpm test:e2e:smoke",
    issueMode: "reuse_issue",
    existingIssueNumber: 1,
    cleanupSourceTitles: ["Nexus - GitHub Repo", "Nexus - Deployment Project"],
    tasks: [
      {
        title: "Nexus - restore missing desktop build scripts",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Recover or replace the missing `scripts/build` files so the desktop smoke path can run again.",
      },
      {
        title: "Nexus - rerun smoke and triage GitHub failure surface",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once smoke advances, align the new blocker or pass with the current PR and workflow failures already visible in GitHub.",
      },
    ],
  },
  {
    title: "prompt-englab",
    repoSlug: "saagpatel/prompt-englab",
    sourceTitle: "prompt-englab GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "1 week",
    testPosture: "Strong",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: TODAY,
    nextMove:
      "Triage the high-severity audit findings, decide whether to remediate directly or pin around the Prisma-related transitive chain, and then rerun the remaining perf and release checks.",
    biggestBlocker:
      "After restoring dependencies, Prisma generate, typecheck, lint, tests, and production build passed, but `npm audit --audit-level=high --omit=dev` reports 12 vulnerabilities, including high-severity issues in Prisma's transitive Hono and Effect chain.",
    projectHealthNotes:
      "prompt-englab is farther along than its parked posture suggested. The main correctness gates pass, so the current blocker is dependency-risk posture rather than missing setup.",
    knownRisks:
      "A blanket `npm audit fix --force` would introduce breaking Prisma and Next upgrades into a very dirty worktree, so remediation needs a deliberate change plan.",
    whatWorks:
      "The canonical repo now exists, install is healthy, and the project clears Prisma generate, typecheck, lint, tests, and production build.",
    missingCorePieces:
      "A safe vulnerability remediation decision, the remaining perf and release checks, and the first governed GitHub issue slice for finishing work.",
    buildSessionTitle: "Batch normalize - prompt-englab",
    buildSessionPlanned:
      "Move prompt-englab out of parked state, create the canonical GitHub home, restore dependencies, and capture the first real blocker after the missing-prisma setup failure.",
    buildSessionShipped:
      "Created the canonical repo, restored the npm install state, and confirmed that Prisma generate, typecheck, lint, tests, and build all pass before the security audit gate.",
    buildSessionBlockers:
      "The first real blocker is security posture: `npm audit` reports 12 vulnerabilities, including high-severity issues in the Prisma-related transitive dependency chain.",
    buildSessionLessons:
      "prompt-englab was blocked less by missing install state than by an unresolved vulnerability posture hidden behind it.",
    buildSessionNextSteps:
      "Decide the vulnerability remediation path, rerun the remaining perf and release checks, and convert that work into a bounded finish slice.",
    decisionTitle: "prompt-englab - move from parked to active finish on restored baseline",
    decisionChosenOption:
      "Treat prompt-englab as an active finish candidate because the restored baseline clears the main correctness gates and exposes a real security decision instead of setup noise.",
    decisionRationale:
      "Parked posture no longer matches the evidence. The repo now deserves a governed finishing lane focused on dependency risk rather than missing tooling.",
    packetTitle: "prompt-englab - remediate audit findings and finish verify tail",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal:
      "Resolve or explicitly bound the current audit findings and then rerun the remaining perf and release checks.",
    packetDefinitionOfDone:
      "The audit remediation plan is explicit, the remaining verify tail reruns, and the next blocker or pass is captured in GitHub and Notion.",
    packetWhyNow:
      "The project already clears the main correctness gates, so dependency-risk posture is now the highest-leverage thing preventing finish work.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "prompt-englab is no longer gated by missing Prisma tooling; it is gated by high-severity dependency audit findings and the remediation decision they require.",
    primaryRunCommand: "bash .codex/scripts/run_verify_commands.sh",
    issueMode: "create_issue",
    issueTitle: "prompt-englab: remediate audit findings after restored baseline",
    issueBody: [
      "## Current state",
      "- The canonical `saagpatel/prompt-englab` repo now exists and is connected to the operating flow.",
      "- `npm ci`, Prisma generate, typecheck, lint, tests, and production build passed during the batch normalization pass.",
      "- `npm audit --audit-level=high --omit=dev` is now the first real blocker.",
      "",
      "## Blocking reality",
      "- Audit reports 12 vulnerabilities, including high-severity issues in the Prisma-related transitive Hono and Effect chain.",
      "- A force-fix would introduce breaking Prisma and Next upgrades into a very dirty worktree.",
      "",
      "## Next move",
      "- Decide the safest remediation path.",
      "- Rerun the remaining perf and release checks after that decision.",
      "- Capture the next blocker or pass in the operating flow.",
      "",
      "## Done when",
      "- The audit posture is explicitly resolved or bounded.",
      "- The remaining verify tail has been rerun.",
    ].join("\n"),
    tasks: [
      {
        title: "prompt-englab - decide audit remediation path",
        status: "Ready",
        priority: "P0",
        taskType: "Decision Prep",
        estimate: "Half day",
        notes: "Choose whether to remediate directly, pin around the vulnerable chain, or explicitly accept bounded risk before further finish work.",
      },
      {
        title: "prompt-englab - rerun perf and release tail",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once the audit posture is resolved, rerun the remaining perf and release checks to capture the next blocker or pass.",
      },
    ],
  },
  {
    title: "app",
    repoSlug: "saagpatel/app",
    sourceTitle: "app GitHub Repo",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Cold",
    setupFriction: "Low",
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
      "Restore or replace `ContentView` in the app target, rerun the macOS build, and then decide whether this scaffold is worth continuing now that the repo is wired into GitHub.",
    biggestBlocker:
      "The repo now has a canonical GitHub home, but the app does not build because `appApp.swift` still references `ContentView` after `app/ContentView.swift` was deleted.",
    projectHealthNotes:
      "app is a scaffold-level project, not a healthy app. The key value of this pass is making the blocker explicit and getting the project into the governed operating flow instead of leaving it archived.",
    knownRisks:
      "Any readiness signal beyond repo setup will be misleading until the missing entry view is restored and the app can build again.",
    whatWorks:
      "The canonical repo now exists, the project is connected to the operating flow, and the current blocker is concrete rather than hidden inside archive posture.",
    missingCorePieces:
      "Restore the view entry point, rerun the macOS build, and decide whether to continue investing past the current scaffold stage.",
    buildSessionTitle: "Batch normalize - app",
    buildSessionPlanned:
      "Reopen the archived scaffold into truthful active tracking, create the canonical GitHub home, and capture the current build blocker.",
    buildSessionShipped:
      "Created the canonical repo, connected the project to the operating flow, and replaced the archive placeholder story with the real `ContentView` build failure.",
    buildSessionBlockers:
      "`xcodebuild` fails because `appApp.swift` references `ContentView` after `app/ContentView.swift` was deleted.",
    buildSessionLessons:
      "For early-stage scaffolds, the operational win is clarity: a concrete blocker and a live repo lane matter more than pretending the project is healthier than it is.",
    buildSessionNextSteps:
      "Restore or replace `ContentView`, rerun the macOS build, and decide whether the scaffold is still worth active execution.",
    decisionTitle: "app - reopen as a tracked scaffold blocker instead of archive noise",
    decisionChosenOption:
      "Treat app as active build work with a concrete scaffold blocker so the operating system can track the next decision honestly.",
    decisionRationale:
      "Archive posture hid the real situation. The project is not healthy, but it is clearer and more actionable when tracked as an explicit build blocker on a live GitHub repo.",
    packetTitle: "app - restore ContentView or confirm scaffold stop",
    packetStatus: "Ready",
    packetPriority: "Standby",
    packetType: "Build Push",
    packetGoal:
      "Restore the missing entry view or make an explicit stop decision after one clean build attempt on the canonical repo baseline.",
    packetDefinitionOfDone:
      "The missing `ContentView` blocker is either fixed and verified with `xcodebuild` or explicitly confirmed as the current stop point.",
    packetWhyNow:
      "This project was fully disconnected from GitHub and truth in Notion, so even a blocked scaffold benefits from being tracked accurately.",
    packetEstimatedSize: "1 day",
    packetBlockerSummary:
      "app is currently gated by a missing SwiftUI entry view, not by GitHub setup anymore.",
    primaryRunCommand: "xcodebuild -project app.xcodeproj -scheme app -sdk macosx build CODE_SIGNING_ALLOWED=NO",
    issueMode: "create_issue",
    issueTitle: "app: restore missing ContentView or lock scaffold blocker",
    issueBody: [
      "## Current state",
      "- The canonical `saagpatel/app` repo now exists and is connected to the operating flow.",
      "- The project is a scaffold-level SwiftUI app rather than a healthy build.",
      "- `xcodebuild -project app.xcodeproj -scheme app -sdk macosx build CODE_SIGNING_ALLOWED=NO` currently fails.",
      "",
      "## Blocking reality",
      "- `appApp.swift` still references `ContentView` after `app/ContentView.swift` was deleted.",
      "",
      "## Next move",
      "- Restore or replace `ContentView` in the app target.",
      "- Rerun the macOS build.",
      "- Decide whether to continue investing or explicitly stop at scaffold stage.",
      "",
      "## Done when",
      "- The build passes or the scaffold blocker is explicitly confirmed as the stop point.",
    ].join("\n"),
    tasks: [
      {
        title: "app - restore or replace ContentView",
        status: "Ready",
        priority: "P0",
        taskType: "Fix",
        estimate: "Half day",
        notes: "Resolve the missing SwiftUI entry view reference so the app can reach a truthful build attempt.",
      },
      {
        title: "app - rerun build and decide scaffold future",
        status: "Ready",
        priority: "P1",
        taskType: "Decision Prep",
        estimate: "1 day",
        notes: "Once the entry view is restored or confirmed missing, rerun `xcodebuild` and decide whether the scaffold should continue as active work.",
      },
    ],
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for selected batch normalization");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance || !config.phase7Actuation) {
      throw new AppError("Selected batch normalization requires phases 2, 5, 6, and 7");
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

    const [projectSchema, buildSchema, sourceSchema, requestSchema, policySchema, decisionSchema, packetSchema, taskSchema] =
      await Promise.all([
        api.retrieveDataSource(config.database.dataSourceId),
        api.retrieveDataSource(config.relatedDataSources.buildLogId),
        api.retrieveDataSource(phase5.sources.dataSourceId),
        api.retrieveDataSource(phase6.actionRequests.dataSourceId),
        api.retrieveDataSource(phase6.policies.dataSourceId),
        api.retrieveDataSource(phase2.decisions.dataSourceId),
        api.retrieveDataSource(phase2.packets.dataSourceId),
        api.retrieveDataSource(phase2.tasks.dataSourceId),
      ]);

    const [projectPages, buildPages, sourcePages, requestPages, policyPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.policies.dataSourceId, policySchema.titlePropertyName),
    ]);

    const projectPageByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const projectRecordByTitle = new Map(projectPages.map((page) => [page.title, toControlTowerProjectRecord(page)]));
    const buildPageByTitle = new Map(buildPages.map((page) => [page.title, page]));
    const sourcePageByTitle = new Map(sourcePages.map((page) => [page.title, page]));
    const sourceRecordByTitle = new Map(sourcePages.map((page) => [page.title, toExternalSignalSourceRecord(page)]));
    const actionRequests = requestPages.map((page) => toActionRequestRecord(page));
    const policies = policyPages.map((page) => toActionPolicyRecord(page));

    const requestIds: string[] = [];
    const results: Array<Record<string, unknown>> = [];

    for (const target of TARGETS) {
      const projectPage = requirePage(projectPageByTitle, target.title, "project");
      const currentProject = requireRecord(projectRecordByTitle, target.title, "project");

      const existingBuildIds = relationIds(projectPage.properties["Build Sessions"]);
      const existingResearchIds = relationIds(projectPage.properties["Related Research"]);
      const existingSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
      const existingToolIds = relationIds(projectPage.properties["Tool Stack Records"]);

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
        : { id: `dry-run-build-${projectPage.id}`, url: "" };

      const source = flags.live
        ? await upsertSource({
            api,
            dataSourceId: phase5.sources.dataSourceId,
            titlePropertyName: sourceSchema.titlePropertyName,
            projectId: projectPage.id,
            target,
          })
        : { id: `dry-run-source-${projectPage.id}`, url: `https://github.com/${target.repoSlug}` };

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
            "Tool Stack Records": relationValue(existingToolIds),
            "Last Build Session": richTextValue(target.buildSessionTitle),
            "Last Build Session Date": { date: { start: flags.today } },
            "Build Session Count": { number: buildSessionIds.length },
            "Related Research Count": { number: existingResearchIds.length },
            "Supporting Skills Count": { number: existingSkillIds.length },
            "Linked Tool Count": { number: existingToolIds.length },
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
              "This placeholder row was paused during the selected batch normalization workflow so the canonical repo mapping stays clear.",
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
          requestTitle: `Selected batch normalize - ${target.title} - GitHub issue`,
          projectId: projectPage.id,
          projectTitle: target.title,
          projectNextMove: target.nextMove,
          sourceId: source.id,
          today: flags.today,
          approve: true,
          payloadTitle: target.issueTitle ?? `${target.title}: selected batch normalize`,
          payloadBody: target.issueBody ?? target.nextMove,
          providerRequestKey: `selected-batch-normalize:${projectPage.id}:github.create_issue`,
          approvalReasonApproved:
            "Approved selected batch normalization request so the project is fully connected to the governed GitHub issue lane.",
          approvalReasonPending:
            "Pending approval for the selected batch normalization GitHub issue request.",
          executionNotes:
            "Created by the selected batch normalization workflow to establish or refresh the GitHub execution slice.",
          markdownPurpose:
            "Create the governed GitHub issue that will carry the current execution slice for this project.",
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
    "Tools Used": { multi_select: [{ name: "Codex CLI (OpenAI)" }, { name: "Notion" }, { name: "GitHub" }] },
    "Artifacts Updated": { multi_select: [{ name: "notion" }, { name: "github" }, { name: "build-log" }] },
    Tags: { multi_select: [{ name: "portfolio" }, { name: "batch" }, { name: "github" }] },
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
      "This row is maintained by the selected batch normalization workflow so the canonical GitHub repo mapping stays explicit.",
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
      "Options Considered": richTextValue("Keep the stale archive or parked posture, or reopen the project around the current GitHub and local evidence."),
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
      : `- Governed issue request: Selected batch normalize - ${input.target.title} - GitHub issue`;
  return [
    SNAPSHOT_START,
    "## Selected Batch Snapshot",
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

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
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

function requirePage<T>(map: Map<string, T>, title: string, kind: string): T {
  const page = map.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page for "${title}"`);
  }
  return page;
}

function requireRecord<T>(map: Map<string, T>, title: string, kind: string): T {
  const record = map.get(title);
  if (!record) {
    throw new AppError(`Could not find ${kind} record for "${title}"`);
  }
  return record;
}

function parseFlags(argv: string[]): { live: boolean; today: string } {
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
