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
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import { ensureGitHubCreateIssueActionRequest, runScriptJson } from "./operational-rollout.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

const SNAPSHOT_START = "<!-- codex:batch-wire-snapshot:start -->";
const SNAPSHOT_END = "<!-- codex:batch-wire-snapshot:end -->";

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
  localProjectId: string;
  currentState: "Active Build" | "Ready for Review" | "Archived";
  portfolioCall: "Build Now" | "Finish" | "Archive";
  momentum: "Hot" | "Warm" | "Cold";
  setupFriction: "Low" | "Medium" | "High";
  runsLocally: "Yes" | "Partial" | "Likely" | "Unknown";
  buildMaturity: "Functional Core" | "Feature Complete" | "Demoable";
  shipReadiness: "Needs Hardening" | "Near Ship" | "Not Ready";
  effortToDemo: "<2h" | "2-3 days" | "Unknown";
  effortToShip: "2-3 days" | "1 week" | "2+ weeks";
  testPosture: "Strong" | "Some" | "Sparse";
  docsQuality: "Usable";
  evidenceConfidence: "Medium";
  lastActive: string;
  nextMove: string;
  biggestBlocker: string;
  lastMeaningfulWork: string;
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
  buildSessionTags: string[];
  buildSessionArtifacts: string[];
  buildSessionTools: string[];
  decisionTitle: string;
  decisionChosenOption: string;
  decisionRationale: string;
  packetTitle: string;
  packetStatus: "Ready" | "Blocked";
  packetPriority: "Now" | "Standby" | "Later";
  packetType: "Build Push" | "Finish Push" | "Review Prep";
  packetGoal: string;
  packetDefinitionOfDone: string;
  packetWhyNow: string;
  packetEstimatedSize: "1 day" | "2-3 days";
  packetBlockerSummary: string;
  issueTitle: string;
  issueBody: string;
  tasks: BatchTaskConfig[];
}

interface SupplementalProjectConfig {
  title: string;
  currentState: "Parked";
  portfolioCall: "Merge";
  momentum: "Cold";
  nextMove: string;
  biggestBlocker: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
}

const CANONICAL_PROJECTS: BatchProjectConfig[] = [
  {
    title: "Chronomap",
    repoSlug: "saagpatel/Chronomap",
    sourceTitle: "Chronomap - GitHub Repo",
    localProjectId: "326c21f1-caf0-813b-bc3b-c87985287073",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Likely",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: "2026-03-13",
    nextMove:
      "Restore the frontend dependency baseline, rerun typecheck, and capture the first product-level failure after the install state is healthy.",
    biggestBlocker:
      "Preflight passes, but TypeScript typecheck currently stops because the frontend dependency set is missing from node_modules.",
    lastMeaningfulWork:
      "Release and verification scaffolding landed recently, but current local validation cannot move past the missing frontend install state.",
    projectHealthNotes:
      "Chronomap is the strongest active candidate in this batch, but the current proof stops at preflight until the package baseline is restored.",
    knownRisks:
      "Leaving the dependency gap unresolved will make the rest of the quality and release surface look healthier than it really is.",
    whatWorks:
      "The repo has real preflight, release, perf, and test commands, and preflight passed cleanly during this batch run.",
    missingCorePieces:
      "A healthy dependency install plus the next failing product check after typecheck can run end to end.",
    buildSessionTitle: "Batch wire - Chronomap",
    buildSessionPlanned:
      "Wire Chronomap into the GitHub and Notion operating flow and replace placeholder blocker language with real check evidence.",
    buildSessionShipped:
      "Created the operating records, mapped the canonical GitHub repo, and captured the current dependency-gated typecheck blocker.",
    buildSessionBlockers:
      "Frontend dependencies are missing, so typecheck stops before deeper product validation can run.",
    buildSessionLessons:
      "Chronomap already has the strongest operating surface in the batch, so dependency health is now the main gating truth.",
    buildSessionNextSteps:
      "Install the expected frontend dependencies, rerun typecheck, then continue into the next product-level validation failure.",
    buildSessionTags: ["portfolio", "github", "batch"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "pnpm"],
    decisionTitle: "Chronomap - move from placeholder state to active execution",
    decisionChosenOption: "Wire the repo now and treat dependency restore as the first execution slice.",
    decisionRationale:
      "Chronomap already has the right portfolio priority and the best local operating surface in this batch, so it should become the current Now project.",
    packetTitle: "Chronomap - dependency baseline and first blocker",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Build Push",
    packetGoal:
      "Restore the dependency baseline and identify the next concrete blocker after typecheck succeeds.",
    packetDefinitionOfDone:
      "Dependencies install cleanly, typecheck reruns successfully or fails on a real product issue, and the next blocker is recorded.",
    packetWhyNow:
      "This is the hottest project in the batch and the best candidate to convert from descriptive state into real execution history.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The repo cannot reach meaningful product validation until the missing frontend dependencies are restored.",
    issueTitle: "Chronomap: restore dependency baseline and capture first real blocker",
    issueBody: [
      "## Current state",
      "- The repo is now wired into the Notion operating flow.",
      "- `pnpm preflight` passed during the batch run.",
      "- `pnpm typecheck` is currently blocked because the frontend dependency set is missing from `node_modules`.",
      "",
      "## Next move",
      "- Restore the frontend dependency baseline.",
      "- Rerun typecheck.",
      "- Capture the first product-level blocker after the install state is healthy.",
      "",
      "## Done when",
      "- Typecheck no longer fails for missing packages.",
      "- The next meaningful blocker is documented in the operating flow.",
    ].join("\n"),
    tasks: [
      {
        title: "Chronomap - restore dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Bring the frontend package install back to a healthy state so typecheck can run meaningfully.",
      },
      {
        title: "Chronomap - capture next blocker after typecheck",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once dependencies are healthy, rerun validation and record the first real product failure instead of placeholder text.",
      },
    ],
  },
  {
    title: "Conductor",
    repoSlug: "saagpatel/Conductor",
    sourceTitle: "Conductor - GitHub Repo",
    localProjectId: "326c21f1-caf0-81f7-8923-c3649066647c",
    currentState: "Ready for Review",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Low",
    runsLocally: "Yes",
    buildMaturity: "Demoable",
    shipReadiness: "Near Ship",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Strong",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: "2026-03-22",
    nextMove:
      "Use the new GitHub issue lane to turn the passing local native checks into a clear finish slice and tighten the external delivery posture around the repo.",
    biggestBlocker:
      "The native build and tests pass locally, so the main remaining blocker is operational: the repo was not connected to the GitHub-backed workflow or reflected accurately in Notion.",
    lastMeaningfulWork:
      "The current native app branch contains substantial new workflows and app work, and the repo now has a passing local build and test proof.",
    projectHealthNotes:
      "Conductor is healthier than Notion previously showed; the build and full test suite are passing, so this project is mostly blocked by delivery wiring and execution focus.",
    knownRisks:
      "If we leave the project marked as low-confidence or test-unknown, it will continue to be deprioritized despite having better evidence than most of the batch.",
    whatWorks:
      "Both the debug build and full `xcodebuild test` run succeeded during this batch, including the app's test suites and force-simulation checks.",
    missingCorePieces:
      "A governed GitHub issue, updated operating posture, and a bounded finish packet that reflects the now-proven native check baseline.",
    buildSessionTitle: "Batch wire - Conductor",
    buildSessionPlanned:
      "Correct Conductor's operating posture, wire it into GitHub, and replace the stale test-unknown story with real local evidence.",
    buildSessionShipped:
      "Mapped the canonical GitHub repo, created execution records, and refreshed the project state with passing native build and test proof.",
    buildSessionBlockers:
      "The remaining blocker is delivery focus rather than native build health.",
    buildSessionLessons:
      "Conductor was underrepresented in Notion; the repo is already farther along than the prior control-tower state implied.",
    buildSessionNextSteps:
      "Use the governed issue to convert passing local validation into a focused finish slice and then watch for any branch-specific CI gaps.",
    buildSessionTags: ["portfolio", "github", "batch"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "xcodebuild"],
    decisionTitle: "Conductor - recognize passing native validation and move to finish mode",
    decisionChosenOption: "Treat passing native build and test proof as enough evidence to move Conductor into finish-oriented operating flow.",
    decisionRationale:
      "Conductor has stronger real validation than its previous Notion state showed, so the right next step is operational cleanup and a bounded finish slice.",
    packetTitle: "Conductor - finish slice from passing native baseline",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Finish Push",
    packetGoal:
      "Use the passing local native baseline to define the first finish-oriented GitHub-backed execution slice.",
    packetDefinitionOfDone:
      "The first finish slice is clearly captured in GitHub and the remaining polish or release blockers are explicit.",
    packetWhyNow:
      "Conductor no longer needs placeholder investigation; it needs a smaller finish-oriented follow-through.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "The main gap is operating-flow and delivery focus, not native build failure.",
    issueTitle: "Conductor: convert passing native checks into a finish slice",
    issueBody: [
      "## Current state",
      "- The repo is now mapped into the Notion operating flow.",
      "- `xcodebuild ... build` succeeded during the batch run.",
      "- `xcodebuild ... test` also succeeded, including the app test suites.",
      "",
      "## Next move",
      "- Use that passing native baseline to define the first finish-oriented slice.",
      "- Capture any branch-specific CI or packaging gaps after the GitHub lane is live.",
      "",
      "## Done when",
      "- The remaining finish blockers are explicit and tracked through the governed GitHub issue.",
    ].join("\n"),
    tasks: [
      {
        title: "Conductor - define finish slice from passing native baseline",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Turn the passing build and test posture into one bounded finish packet with explicit acceptance criteria.",
      },
      {
        title: "Conductor - validate external delivery posture",
        status: "Ready",
        priority: "P2",
        taskType: "Ship",
        estimate: "1 day",
        notes: "After the repo lane is live, confirm whether any CI, release, or branch policy gaps still need attention.",
      },
    ],
  },
  {
    title: "Echolocate",
    repoSlug: "saagpatel/Echolocate",
    sourceTitle: "Echolocate - GitHub Repo",
    localProjectId: "326c21f1-caf0-81a8-ab1a-cd5ca37aafe2",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Likely",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: "2026-02-17",
    nextMove:
      "Restore the missing formatter/tooling dependency, rerun lint and test entrypoints, and use the new issue lane to capture the next real repo blocker.",
    biggestBlocker:
      "The preflight tooling contract passes, but lint currently stops because `prettier` is not available in the current install state.",
    lastMeaningfulWork:
      "The repo carries broad bootstrap, docs, release, and test scaffolding work, but current execution still stalls on the missing formatter dependency.",
    projectHealthNotes:
      "Echolocate has substantial in-progress infrastructure that was invisible in Notion, but it still needs dependency normalization before deeper validation is trustworthy.",
    knownRisks:
      "Treating the expanded repo surface as ready without restoring the install baseline would overstate readiness and hide the next real blocker.",
    whatWorks:
      "The tooling preflight check passed, and the repo already contains richer docs, test, and release scaffolding than the prior control-tower row suggested.",
    missingCorePieces:
      "A healthy install state that includes the formatter toolchain, followed by the next meaningful lint, test, or product blocker after that restore.",
    buildSessionTitle: "Batch wire - Echolocate",
    buildSessionPlanned:
      "Bring Echolocate into the GitHub operating flow and replace stale low-confidence state with real check evidence.",
    buildSessionShipped:
      "Created the operating records, mapped the repo, and captured the formatter dependency gap that currently blocks lint.",
    buildSessionBlockers:
      "Lint cannot progress because `prettier` is missing from the current install state.",
    buildSessionLessons:
      "Echolocate has more repo progress than its Notion row implied, but local dependency health still gates meaningful proof.",
    buildSessionNextSteps:
      "Restore the missing formatter dependency, rerun lint, and then continue to the next real validation blocker.",
    buildSessionTags: ["portfolio", "github", "batch"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "pnpm"],
    decisionTitle: "Echolocate - move the repo from stale description to active execution",
    decisionChosenOption: "Treat the missing formatter dependency as the first execution slice and use the repo's stronger scaffolding as the base for active work.",
    decisionRationale:
      "Echolocate has enough real repo progress to justify active execution, but the install baseline needs to be restored before deeper checks mean much.",
    packetTitle: "Echolocate - restore formatter baseline and rerun lint",
    packetStatus: "Ready",
    packetPriority: "Standby",
    packetType: "Build Push",
    packetGoal:
      "Restore the formatter and install baseline so lint and downstream checks can run meaningfully.",
    packetDefinitionOfDone:
      "The lint path no longer fails because `prettier` is missing, and the next real blocker is recorded.",
    packetWhyNow:
      "Echolocate is the cleanest standby candidate behind Chronomap because its repo already contains broad hardening work that is not yet reflected in the operating flow.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "Missing formatter tooling prevents the repo from proving anything beyond preflight.",
    issueTitle: "Echolocate: restore formatter baseline and capture next blocker",
    issueBody: [
      "## Current state",
      "- The repo is now wired into the Notion operating flow.",
      "- `pnpm verify:preflight` passed during the batch run.",
      "- `pnpm lint` currently fails because `prettier` is not available in the current install state.",
      "",
      "## Next move",
      "- Restore the formatter and dependency baseline.",
      "- Rerun lint.",
      "- Capture the next meaningful blocker after the install state is healthy.",
      "",
      "## Done when",
      "- Lint no longer fails for missing formatter tooling.",
      "- The next real blocker is visible in the governed issue and operating flow.",
    ].join("\n"),
    tasks: [
      {
        title: "Echolocate - restore formatter and install baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Make the repo capable of running lint and the broader verify path without missing-tool errors.",
      },
      {
        title: "Echolocate - record post-lint blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "After lint is healthy, capture the next blocker so the active work stops being generic.",
      },
    ],
  },
  {
    title: "OrbitForge (staging)",
    repoSlug: "saagpatel/OrbitForge",
    sourceTitle: "OrbitForge (staging) - GitHub Repo",
    localProjectId: "326c21f1-caf0-81e5-801d-e192312939fc",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Likely",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "2+ weeks",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: "2026-02-17",
    nextMove:
      "Treat the staging repo as canonical, restore the missing dependency baseline, and then continue through the new GitHub-backed finish lane from the first real post-install blocker.",
    biggestBlocker:
      "Typecheck and lint both stop immediately because node_modules are missing, so the repo cannot yet prove the active staging work beyond static files.",
    lastMeaningfulWork:
      "The staging repo contains the active operating-flow work and broader changes, but current local validation is blocked before React, Tauri, and Three dependencies resolve.",
    projectHealthNotes:
      "OrbitForge needed two fixes at once: pick the staging repo as canonical and replace the stale idea-level Notion story with the repo's real staging posture.",
    knownRisks:
      "If the duplicate base and staging stories remain unresolved, future sessions could push work or decisions against the wrong copy.",
    whatWorks:
      "The staging repo clearly carries the active work and includes verify commands, workflow scaffolding, docs, and tests.",
    missingCorePieces:
      "A restored install state for the staging repo, plus a clear post-install blocker and a stable canonical repo story.",
    buildSessionTitle: "Batch wire - OrbitForge (staging)",
    buildSessionPlanned:
      "Normalize OrbitForge around the staging repo, wire the canonical GitHub lane, and replace the conflicting Notion story with one active surface.",
    buildSessionShipped:
      "Mapped the staging repo as canonical, created the operating records, and captured the missing-dependency blocker that currently prevents typecheck.",
    buildSessionBlockers:
      "The staging repo cannot reach meaningful validation until its missing dependency baseline is restored.",
    buildSessionLessons:
      "The duplicate base/staging story was a portfolio problem as much as a repo problem; the operating layer needed a canonical surface.",
    buildSessionNextSteps:
      "Restore the staging repo install state, rerun typecheck or lint, and continue the finish slice from the first real blocker.",
    buildSessionTags: ["portfolio", "github", "batch"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "pnpm"],
    decisionTitle: "OrbitForge - treat staging as the canonical delivery surface",
    decisionChosenOption: "Use the staging repo as the canonical GitHub and execution surface and treat the base copy as a reference/merge concern.",
    decisionRationale:
      "The staging repo holds the active operating work, while the base copy is cleaner but no longer the correct execution surface for this batch.",
    packetTitle: "OrbitForge - staging dependency restore and canonical finish lane",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Finish Push",
    packetGoal:
      "Restore the staging repo dependency baseline and continue the finish slice from the first real validation blocker.",
    packetDefinitionOfDone:
      "The staging repo validates past missing-package errors and the canonical finish blocker is explicit.",
    packetWhyNow:
      "OrbitForge needed canonicalization before it could support trustworthy execution, and that work is now done.",
    packetEstimatedSize: "2-3 days",
    packetBlockerSummary:
      "Missing dependencies currently stop the staging repo before meaningful validation can begin.",
    issueTitle: "OrbitForge: use staging as canonical and restore dependency baseline",
    issueBody: [
      "## Current state",
      "- `FunGamePrjs/OrbitForge` is now treated as the canonical delivery surface.",
      "- The repo is wired into the Notion operating flow under that staging surface.",
      "- Typecheck and lint currently fail because the dependency baseline is missing from `node_modules`.",
      "",
      "## Next move",
      "- Restore the staging repo dependency baseline.",
      "- Rerun typecheck or lint.",
      "- Record the next real finish blocker after the install state is healthy.",
      "",
      "## Done when",
      "- The canonical staging repo validates past missing-package errors.",
      "- The next finish blocker is explicit and tracked through GitHub and Notion.",
    ].join("\n"),
    tasks: [
      {
        title: "OrbitForge - restore staging dependency baseline",
        status: "Ready",
        priority: "P0",
        taskType: "Build",
        estimate: "Half day",
        notes: "Bring the canonical staging repo back to a state where typecheck and lint can run meaningfully.",
      },
      {
        title: "OrbitForge - confirm post-install finish blocker",
        status: "Ready",
        priority: "P1",
        taskType: "Review",
        estimate: "1 day",
        notes: "Once dependencies are healthy, capture the next finish blocker so the canonical repo story stays grounded in real evidence.",
      },
    ],
  },
  {
    title: "TerraSynth",
    repoSlug: "saagpatel/TerraSynth",
    sourceTitle: "TerraSynth - GitHub Repo",
    localProjectId: "326c21f1-caf0-81c4-b7cf-d8b7d597e476",
    currentState: "Archived",
    portfolioCall: "Archive",
    momentum: "Cold",
    setupFriction: "Low",
    runsLocally: "Unknown",
    buildMaturity: "Functional Core",
    shipReadiness: "Not Ready",
    effortToDemo: "Unknown",
    effortToShip: "2+ weeks",
    testPosture: "Some",
    docsQuality: "Usable",
    evidenceConfidence: "Medium",
    lastActive: "2026-02-17",
    nextMove:
      "Keep TerraSynth archived for now, but use the new GitHub and Notion lane to track the reactivation criteria if the project is brought back later.",
    biggestBlocker:
      "The repo remains archived and current validation stops immediately because node_modules are missing and TypeScript cannot resolve the Three.js type baseline.",
    lastMeaningfulWork:
      "TerraSynth still has real docs, tests, and project structure, but it is not currently worth reactivating until its install baseline and product intent are re-confirmed.",
    projectHealthNotes:
      "This batch keeps TerraSynth archived but fully mapped so future reactivation work starts from a truthful operating baseline instead of a stale abandoned row.",
    knownRisks:
      "Reactivating TerraSynth without explicitly choosing to do so would distract the batch and muddy the now/standby execution picture.",
    whatWorks:
      "The repo still contains a meaningful codebase, docs, and test surface even though it is not the current execution priority.",
    missingCorePieces:
      "A deliberate reactivation decision, restored dependencies, and fresh validation proof if the project is resumed later.",
    buildSessionTitle: "Batch wire - TerraSynth",
    buildSessionPlanned:
      "Resolve TerraSynth's batch posture explicitly by keeping it archived but mapping it into the operating and GitHub systems.",
    buildSessionShipped:
      "Mapped the canonical GitHub repo, created the archive-track operating records, and captured the dependency-gated validation reality.",
    buildSessionBlockers:
      "The project is intentionally archived, and current validation cannot run beyond missing dependency errors anyway.",
    buildSessionLessons:
      "Archived projects still benefit from durable operating records because they reduce ambiguity if the project ever comes back.",
    buildSessionNextSteps:
      "Leave TerraSynth archived unless a later portfolio decision explicitly reactivates it; if that happens, start by restoring dependencies and rerunning validation.",
    buildSessionTags: ["portfolio", "github", "batch"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "pnpm"],
    decisionTitle: "TerraSynth - keep archived but fully mapped",
    decisionChosenOption: "Keep TerraSynth archived for this batch while still wiring its canonical GitHub and Notion records.",
    decisionRationale:
      "The project is not the right active execution candidate today, but leaving it unmapped would preserve ambiguity and make future reactivation slower.",
    packetTitle: "TerraSynth - archive posture and reactivation criteria",
    packetStatus: "Ready",
    packetPriority: "Later",
    packetType: "Review Prep",
    packetGoal:
      "Record a clean archive posture and the criteria required before TerraSynth is reactivated.",
    packetDefinitionOfDone:
      "The project is explicitly archived in the operating system, and the reactivation criteria are visible in GitHub and Notion.",
    packetWhyNow:
      "This closes the ambiguity loop without pulling TerraSynth into the active Now or Standby execution lanes.",
    packetEstimatedSize: "1 day",
    packetBlockerSummary:
      "Reactivation is not approved, and the repo currently lacks the dependency baseline needed for meaningful validation anyway.",
    issueTitle: "TerraSynth: archive posture and future reactivation criteria",
    issueBody: [
      "## Current state",
      "- TerraSynth is being kept archived for this batch.",
      "- The repo is now mapped into the GitHub and Notion operating flow so future work starts from truthful state.",
      "- Current validation also stops immediately because the dependency baseline is missing and TypeScript cannot resolve the Three.js type set.",
      "",
      "## Reactivation criteria",
      "- Make an explicit portfolio decision to resume the project.",
      "- Restore the dependency baseline.",
      "- Rerun validation and capture fresh evidence.",
      "",
      "## Done when",
      "- The archive posture is explicit and future reactivation steps are durable.",
    ].join("\n"),
    tasks: [
      {
        title: "TerraSynth - document archive posture",
        status: "Ready",
        priority: "P2",
        taskType: "Review",
        estimate: "<2h",
        notes: "Keep the archive posture explicit so the project is not silently treated as active.",
      },
      {
        title: "TerraSynth - record reactivation criteria",
        status: "Ready",
        priority: "P2",
        taskType: "Decision Prep",
        estimate: "<2h",
        notes: "If the project comes back later, start from dependency restore and fresh validation proof.",
      },
    ],
  },
];

const SUPPLEMENTAL_PROJECTS: SupplementalProjectConfig[] = [
  {
    title: "OrbitForge",
    currentState: "Parked",
    portfolioCall: "Merge",
    momentum: "Cold",
    nextMove:
      "Treat OrbitForge (staging) as the canonical delivery surface and keep this base copy as a clean reference until an intentional merge or retirement decision is made.",
    biggestBlocker:
      "This base copy is no longer the canonical execution surface for the batch, so using it directly would split history and operating truth.",
    projectHealthNotes:
      "The clean base copy still has value as a reference, but the staging repo is the correct delivery surface for active work and GitHub wiring.",
    knownRisks:
      "Any future execution that forgets the staging/base split could push the wrong copy and recreate the duplicate-story problem.",
    whatWorks:
      "This copy remains cleaner than staging and can still act as a reference point if a later merge-back happens intentionally.",
    missingCorePieces:
      "A later intentional merge or retirement decision; this row should not compete with the staging row for active execution.",
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for batch project wiring");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance || !config.phase7Actuation) {
      throw new AppError("Batch project wiring requires phases 2, 5, 6, and 7");
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

    const [projectPages, buildPages, sourcePages, requestPages, policyPages, executionPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, phase6.policies.dataSourceId, policySchema.titlePropertyName),
      fetchAllPages(sdk, phase7.executions.dataSourceId, "Name"),
    ]);

    const projectPageByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const buildPageByTitle = new Map(buildPages.map((page) => [page.title, page]));
    const sourceRecordByTitle = new Map(sourcePages.map((page) => [page.title, toExternalSignalSourceRecord(page)]));
    const actionRequests = requestPages.map((page) => toActionRequestRecord(page));
    const policies = policyPages.map((page) => toActionPolicyRecord(page));

    const results: Array<Record<string, unknown>> = [];
    const requestIds: string[] = [];

    for (const target of CANONICAL_PROJECTS) {
      const projectPage = projectPageByTitle.get(target.title);
      if (!projectPage) {
        throw new AppError(`Could not find project page for "${target.title}"`);
      }

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
        : buildDryRunSource(projectPage.id, target);

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

        const buildSessionIds = [...new Set([...existingBuildIds, buildLog.id])];
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
            "Last Meaningful Work": richTextValue(target.lastMeaningfulWork),
            "Setup Friction": selectPropertyValue(target.setupFriction),
            "Runs Locally": selectPropertyValue(target.runsLocally),
            "Build Maturity": selectPropertyValue(target.buildMaturity),
            "Ship Readiness": selectPropertyValue(target.shipReadiness),
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
            "Start Here": richTextValue(`Open AGENTS.md, then use ${target.packetTitle} as the current packet.`),
            "Primary Run Command": richTextValue(extractPrimaryRunCommand(target)),
          },
        });

        const currentMarkdown = await api.readPageMarkdown(projectPage.id);
        const merged = mergeManagedSection(
          currentMarkdown.markdown,
          buildProjectSnapshotMarkdown({
            target,
            repoUrl: `https://github.com/${target.repoSlug}`,
            buildLogUrl: buildLog.url,
            requestTitle: requestTitleFor(target),
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

      const request = flags.live
        ? await ensureGitHubCreateIssueActionRequest({
            api,
            config,
            actionRequestTitlePropertyName: requestSchema.titlePropertyName,
            policies,
            actionRequests,
            githubSources: [...sourceRecordByTitle.values()],
            requestTitle: requestTitleFor(target),
            projectId: projectPage.id,
            projectTitle: target.title,
            projectNextMove: target.nextMove,
            sourceId: source.id,
            today: flags.today,
            approve: true,
            payloadTitle: target.issueTitle,
            payloadBody: target.issueBody,
            providerRequestKey: `batch-wire:${target.localProjectId}:github.create_issue`,
            approvalReasonApproved:
              "Approved batch wiring request so the project is moved into the governed GitHub issue lane immediately.",
            approvalReasonPending:
              "Pending approval for the governed GitHub issue lane created by the batch wiring workflow.",
            executionNotes:
              "Created by the batch project wiring workflow to establish the first governed GitHub issue for this project.",
            markdownPurpose:
              "Create the first governed GitHub issue so the project is fully connected to the GitHub-backed operating flow.",
          })
        : {
            id: `dry-run-request-${projectPage.id}`,
            url: "",
            existed: false,
            title: requestTitleFor(target),
            status: "Approved",
          };

      if (flags.live) {
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
        requestId: request.id,
      });
    }

    if (flags.live) {
      for (const supplemental of SUPPLEMENTAL_PROJECTS) {
        const page = projectPageByTitle.get(supplemental.title);
        const stagingPage = projectPageByTitle.get("OrbitForge (staging)");
        if (!page || !stagingPage) {
          continue;
        }
        await api.updatePageProperties({
          pageId: page.id,
          properties: {
            "Date Updated": { date: { start: flags.today } },
            "Current State": selectPropertyValue(supplemental.currentState),
            "Portfolio Call": selectPropertyValue(supplemental.portfolioCall),
            Momentum: selectPropertyValue(supplemental.momentum),
            "Needs Review": { checkbox: false },
            "Next Move": richTextValue(supplemental.nextMove),
            "Biggest Blocker": richTextValue(supplemental.biggestBlocker),
            "Project Health Notes": richTextValue(supplemental.projectHealthNotes),
            "Known Risks": richTextValue(supplemental.knownRisks),
            "What Works": richTextValue(supplemental.whatWorks),
            "Missing Core Pieces": richTextValue(supplemental.missingCorePieces),
          },
        });
        const currentMarkdown = await api.readPageMarkdown(page.id);
        const merged = mergeManagedSection(
          currentMarkdown.markdown,
          [
            SNAPSHOT_START,
            "## Batch Wire Snapshot",
            "",
            `- Canonical delivery surface: [OrbitForge (staging)](${stagingPage.url})`,
            `- Portfolio posture: ${supplemental.portfolioCall}`,
            "",
            "### Why this row is no longer primary",
            supplemental.biggestBlocker,
            "",
            "### Next move",
            supplemental.nextMove,
            SNAPSHOT_END,
          ].join("\n"),
          SNAPSHOT_START,
          SNAPSHOT_END,
        );
        if (merged !== currentMarkdown.markdown) {
          await api.patchPageMarkdown({
            pageId: page.id,
            command: "replace_content",
            newMarkdown: merged,
          });
        }
      }
    }

    let followUps: Record<string, unknown> = {};
    let createdIssues: Array<Record<string, unknown>> = [];

    if (flags.live && !flags.skipFollowUps) {
      followUps.viewsValidate = await runScriptJson("portfolio-audit:views-validate", []);
      followUps.executionViewsValidate = await runScriptJson("portfolio-audit:execution-views-validate", []);
      followUps.intelligenceViewsValidate = await runScriptJson("portfolio-audit:intelligence-views-validate", []);
      followUps.externalSignalViewsValidate = await runScriptJson("portfolio-audit:external-signal-views-validate", []);
      followUps.phase6ViewsValidate = await runScriptJson("portfolio-audit:phase6-views-validate", []);
      followUps.phase7ViewsValidate = await runScriptJson("portfolio-audit:phase7-views-validate", []);
      followUps.phase8ViewsValidate = await runScriptJson("portfolio-audit:phase8-views-validate", []);
      followUps.actionRequestSyncBeforeRuns = await runScriptJson("portfolio-audit:action-request-sync", ["--live"]);

      createdIssues = await runIssueLane(requestIds);

      followUps.externalSignalSync = await runScriptJson("portfolio-audit:external-signal-sync", ["--provider", "github", "--live"]);
      followUps.controlTowerSync = await runScriptJson("portfolio-audit:control-tower-sync", ["--live"]);
      followUps.executionSync = await runScriptJson("portfolio-audit:execution-sync", ["--live"]);
      followUps.reviewPacket = await runScriptJson("portfolio-audit:review-packet", ["--live"]);
    }

      const liveExecutions = flags.live
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
          initialExecutionPages: executionPages.length,
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
    "Tools Used": multiSelectValue(input.target.buildSessionTools),
    "Artifacts Updated": multiSelectValue(input.target.buildSessionArtifacts),
    Tags: multiSelectValue(input.target.buildSessionTags),
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
      "This row is maintained by the batch wiring workflow so the GitHub lane stays explicit and reusable.",
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
      "Options Considered": richTextValue("Keep the project in stale descriptive state or move it into a governed GitHub-backed execution flow."),
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
  const summaries = pages
    .filter((page) => input.requestIds.some((requestId) => relationIds(page.properties["Action Request"]).includes(requestId)))
    .map((page) => ({
      title: page.title,
      issueNumber: page.properties["Issue Number"]?.number ?? null,
      providerUrl: page.properties["Provider URL"]?.url ?? "",
      status: page.properties.Status?.status?.name ?? page.properties.Status?.select?.name ?? "",
      requestIds: relationIds(page.properties["Action Request"]),
    }));
  return summaries;
}

function buildProjectSnapshotMarkdown(input: {
  target: BatchProjectConfig;
  repoUrl: string;
  buildLogUrl: string;
  requestTitle: string;
}): string {
  return [
    SNAPSHOT_START,
    "## Batch Wire Snapshot",
    "",
    `- GitHub repo: [${input.target.repoSlug}](${input.repoUrl})`,
    `- Build-log checkpoint: [${input.target.buildSessionTitle}](${input.buildLogUrl})`,
    `- Governed issue request: ${input.requestTitle}`,
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

function buildDryRunSource(projectId: string, target: BatchProjectConfig): { id: string; url: string } {
  return {
    id: `dry-run-source-${projectId}`,
    url: `https://github.com/${target.repoSlug}`,
  };
}

function requestTitleFor(target: BatchProjectConfig): string {
  return `Batch wire - ${target.title} - GitHub issue`;
}

function extractPrimaryRunCommand(target: BatchProjectConfig): string {
  if (target.title === "Conductor") {
    return "xcodebuild -project Conductor.xcodeproj -scheme Conductor -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO test";
  }
  if (target.title === "Chronomap") {
    return "pnpm typecheck";
  }
  if (target.title === "Echolocate") {
    return "pnpm lint";
  }
  return "pnpm lint";
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

function parseFlags(argv: string[]): { live: boolean; today: string; skipFollowUps: boolean } {
  let live = false;
  let today = losAngelesToday();
  let skipFollowUps = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--skip-follow-ups") {
      skipFollowUps = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
    }
  }

  return { live, today, skipFollowUps };
}

void main();
