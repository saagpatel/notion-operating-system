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
} from "./local-portfolio-control-tower-live.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord } from "./local-portfolio-governance-live.js";
import { runBatchReusableLinkBackfill } from "./backfill-batch-reusable-links.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

const SNAPSHOT_START = "<!-- codex:batch-finish-snapshot:start -->";
const SNAPSHOT_END = "<!-- codex:batch-finish-snapshot:end -->";

interface ProjectBatchConfig {
  title: string;
  repoSlug: string;
  activeIssueNumber: number;
  activeIssueTitle: string;
  currentState: string;
  portfolioCall: string;
  momentum: string;
  setupFriction: string;
  runsLocally: string;
  buildMaturity: string;
  shipReadiness: string;
  effortToDemo: string;
  effortToShip: string;
  lastActive: string;
  lastMeaningfulWork: string;
  nextMove: string;
  biggestBlocker: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
  checkPosture: string;
  deploymentDisposition: string;
  buildSessionTitle: string;
  buildSessionType: string;
  buildSessionOutcome: string;
  buildSessionPlanned: string;
  buildSessionShipped: string;
  buildSessionBlockers: string;
  buildSessionLessons: string;
  buildSessionNextSteps: string;
  buildSessionTags: string[];
  buildSessionTools: string[];
  buildSessionArtifacts: string[];
  buildSessionScopeDrift: string;
  buildSessionRating: string;
  followUpNeeded: boolean;
  buildSessionMarkdown: string;
}

const TARGET_PROJECTS: ProjectBatchConfig[] = [
  {
    title: "DevToolsTranslator",
    repoSlug: "saagpatel/DevToolsTranslator",
    activeIssueNumber: 1,
    activeIssueTitle: "DevToolsTranslator: release-readiness blockers",
    currentState: "Ready for Review",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "2-3 days",
    lastActive: "2026-03-21",
    lastMeaningfulWork:
      "Release-hardening landed on main, stage-controller runs succeeded, and the open governed issue now needs the final unblock-and-verify slice.",
    nextMove:
      "Use the governed GitHub issue to clear manual Chrome sign-off, confirm Chrome Web Store credentials, confirm updater-signature inputs, and rerun the failing perf/reliability workflow on main until release readiness is clean.",
    biggestBlocker:
      "Manual Chrome sign-off, Chrome Web Store credentials, updater-signature inputs, and a failed perf/reliability workflow on the March 21, 2026 main-line commit.",
    projectHealthNotes:
      "The release lane is mature and the repo has real automation, but final release readiness is still blocked by a mix of manual release inputs and one failing workflow on the latest main commit.",
    knownRisks:
      "Shipping before the failing perf/reliability workflow is green would leave the strongest readiness signal contradicted by CI.",
    whatWorks:
      "The desktop and extension release flow already has real staged automation, strong test posture, and recent successful controller runs.",
    missingCorePieces:
      "Final credentials and sign-off inputs, plus a green perf/reliability run tied to the current main-line release state.",
    checkPosture:
      "Main branch has meaningful release automation. Recent stage-controller runs succeeded, but the perf/reliability workflow failed on the current March 21, 2026 commit and remains the main gating signal.",
    deploymentDisposition:
      "No separate deployment-project record is needed right now because release readiness is already tracked through the GitHub repo and release workflows.",
    buildSessionTitle: "Batch finish normalization - DevToolsTranslator",
    buildSessionType: "Planning",
    buildSessionOutcome: "Shipped",
    buildSessionPlanned:
      "Normalize the DevToolsTranslator Notion page and governed GitHub lane so release blockers, check posture, and next steps match the real repo state.",
    buildSessionShipped:
      "Updated the project page with the real release-readiness slice, attached build-log evidence, paused stale operating drift, and prepared a governed GitHub issue refresh for the final unblock path.",
    buildSessionBlockers:
      "Manual Chrome sign-off, Chrome Web Store credentials, updater-signature inputs, and the failed perf/reliability workflow still block clean closure.",
    buildSessionLessons:
      "This project is close enough to ship that stale operating text is now riskier than missing new features; the operating layer must track the exact release gate.",
    buildSessionNextSteps:
      "Use the refreshed governed issue to clear the manual release blockers and rerun the failing workflow until the release path is clean.",
    buildSessionTags: ["portfolio", "github", "release"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionScopeDrift: "None",
    buildSessionRating: "Great",
    followUpNeeded: true,
    buildSessionMarkdown: [
      "# Batch finish normalization - DevToolsTranslator",
      "",
      "## What Was Planned",
      "Normalize the DevToolsTranslator Notion page and governed GitHub lane so release blockers, check posture, and next steps match the real repo state.",
      "",
      "## What Shipped",
      "Updated the project page with the real release-readiness slice, attached build-log evidence, paused stale operating drift, and prepared a governed GitHub issue refresh for the final unblock path.",
      "",
      "## Blockers",
      "Manual Chrome sign-off, Chrome Web Store credentials, updater-signature inputs, and the failed perf/reliability workflow still block clean closure.",
      "",
      "## Lessons",
      "This project is close enough to ship that stale operating text is now riskier than missing new features; the operating layer must track the exact release gate.",
      "",
      "## Next Steps",
      "Use the refreshed governed issue to clear the manual release blockers and rerun the failing workflow until the release path is clean.",
    ].join("\n"),
  },
  {
    title: "JobCommandCenter",
    repoSlug: "saagpatel/JobCommandCenter",
    activeIssueNumber: 3,
    activeIssueTitle: "JobCommandCenter: finish validation slice",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Demoable",
    shipReadiness: "Near Ship",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    lastActive: "2026-03-21",
    lastMeaningfulWork:
      "The governed issue and PR-comment acceptance lane are live, but the actual finish proof still depends on real bundle and batch validation.",
    nextMove:
      "Use issue #3 as the active finish slice: validate the PyInstaller bundle, run a real 5-job batch, document LinkedIn bot-detection behavior, and decide whether polish/v1.0-improvements remains the operating default branch.",
    biggestBlocker:
      "PyInstaller bundle proof, real 5-job batch evidence, LinkedIn bot-detection uncertainty, and unresolved default-branch strategy.",
    projectHealthNotes:
      "The GitHub operating lane is real and deeper than the rest of the batch, but the repo still lacks meaningful product checks on the branch that matters and needs proof from a real batch run.",
    knownRisks:
      "Staying on a non-main default branch without an explicit decision will keep readiness ambiguous even if the bundle and batch proof land.",
    whatWorks:
      "The product is already demoable, the repo has a governed GitHub issue flow, and the PR comment acceptance path is proven on a real pull request.",
    missingCorePieces:
      "Real finish evidence: PyInstaller bundle output, real 5-job batch behavior, LinkedIn bot-detection notes, and an explicit branch strategy.",
    checkPosture:
      "The repo exposes useful local check commands, but GitHub workflow activity currently shows placeholder dependabot queue entries instead of meaningful product validation on the operating branch.",
    deploymentDisposition:
      "No separate deployment-project record is justified today; keep the GitHub repo as the canonical external source until a real deployment surface exists.",
    buildSessionTitle: "Batch finish normalization - JobCommandCenter",
    buildSessionType: "Planning",
    buildSessionOutcome: "Shipped",
    buildSessionPlanned:
      "Normalize JobCommandCenter so the Notion page, governed issue, and evidence trail all point at the real finish-validation slice.",
    buildSessionShipped:
      "Updated the project page to reflect the active finish slice, attached a build-log checkpoint, and prepared a governed GitHub issue refresh tied to bundle, batch, and bot-detection proof.",
    buildSessionBlockers:
      "PyInstaller output is not yet proven, the real 5-job batch has not been captured, LinkedIn bot-detection is still unvalidated, and default-branch strategy is unresolved.",
    buildSessionLessons:
      "This repo is blocked less by missing features than by missing closure proof and operating-branch clarity.",
    buildSessionNextSteps:
      "Run the bundle and real batch proof, document LinkedIn behavior, and decide whether the current default branch stays authoritative.",
    buildSessionTags: ["portfolio", "github", "desktop-app"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionScopeDrift: "None",
    buildSessionRating: "Good",
    followUpNeeded: true,
    buildSessionMarkdown: [
      "# Batch finish normalization - JobCommandCenter",
      "",
      "## What Was Planned",
      "Normalize JobCommandCenter so the Notion page, governed issue, and evidence trail all point at the real finish-validation slice.",
      "",
      "## What Shipped",
      "Updated the project page to reflect the active finish slice, attached a build-log checkpoint, and prepared a governed GitHub issue refresh tied to bundle, batch, and bot-detection proof.",
      "",
      "## Blockers",
      "PyInstaller output is not yet proven, the real 5-job batch has not been captured, LinkedIn bot-detection is still unvalidated, and default-branch strategy is unresolved.",
      "",
      "## Lessons",
      "This repo is blocked less by missing features than by missing closure proof and operating-branch clarity.",
      "",
      "## Next Steps",
      "Run the bundle and real batch proof, document LinkedIn behavior, and decide whether the current default branch stays authoritative.",
    ].join("\n"),
  },
  {
    title: "GPT_RAG",
    repoSlug: "saagpatel/GPT_RAG",
    activeIssueNumber: 1,
    activeIssueTitle: "GPT_RAG: retrieval hardening slice",
    currentState: "Active Build",
    portfolioCall: "Merge",
    momentum: "Hot",
    setupFriction: "Low",
    runsLocally: "Yes",
    buildMaturity: "Feature Complete",
    shipReadiness: "Needs Hardening",
    effortToDemo: "2-3 days",
    effortToShip: "1 week",
    lastActive: "2026-03-21",
    lastMeaningfulWork:
      "Real knowledge-corpus proof already landed in the governed issue history, but the project still needs bounded vector and retrieval hardening before it is represented cleanly as a passing system.",
    nextMove:
      "Use issue #1 as the hardening slice: continue bounded vector indexing on /Users/d/Knowledge, prove semantic or hybrid retrieval on a targeted topic set, and promote a real project check path beyond the placeholder dependabot workflow.",
    biggestBlocker:
      "Semantic retrieval on the real corpus still needs more vector coverage, answer-quality validation, and a decision on whether any deployment surface should be tracked at all.",
    projectHealthNotes:
      "The project already has real corpus evidence and a clean governed issue, but the operating page was still missing build evidence and the repo has not yet earned a meaningful CI signal.",
    knownRisks:
      "Treating the queued dependabot workflow as real check coverage would overstate readiness and hide the missing retrieval-quality validation.",
    whatWorks:
      "Local-only architecture is clear, the corpus proof is real, and the governed GitHub lane is already active.",
    missingCorePieces:
      "Bounded vector-index proof, semantic or hybrid retrieval validation, and an explicit answer about whether a deployment-project source belongs here.",
    checkPosture:
      "GitHub currently shows only a queued dependabot-generated workflow run. The repo still needs a meaningful project check path that proves retrieval quality or at least core repo health.",
    deploymentDisposition:
      "No deployment-project source should stay active for this project until a real deployment surface exists; keep the repo source active and pause the placeholder deployment row.",
    buildSessionTitle: "Batch finish normalization - GPT_RAG",
    buildSessionType: "Planning",
    buildSessionOutcome: "Shipped",
    buildSessionPlanned:
      "Normalize GPT_RAG so Notion, the governed GitHub issue, and the external-source map all reflect the real retrieval-hardening slice.",
    buildSessionShipped:
      "Added build-log evidence, refreshed the project page, paused the placeholder deployment source, and prepared a governed issue-body refresh around bounded retrieval hardening.",
    buildSessionBlockers:
      "Real-corpus semantic retrieval still needs proof, and there is no meaningful CI signal beyond a queued dependabot run.",
    buildSessionLessons:
      "A project can have strong product proof and still be partially represented if evidence and external-source posture are not normalized in Notion.",
    buildSessionNextSteps:
      "Keep working through the active issue: bounded vector indexing, targeted semantic retrieval proof, and a real project check path.",
    buildSessionTags: ["portfolio", "github", "rag"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionScopeDrift: "None",
    buildSessionRating: "Great",
    followUpNeeded: true,
    buildSessionMarkdown: [
      "# Batch finish normalization - GPT_RAG",
      "",
      "## What Was Planned",
      "Normalize GPT_RAG so Notion, the governed GitHub issue, and the external-source map all reflect the real retrieval-hardening slice.",
      "",
      "## What Shipped",
      "Added build-log evidence, refreshed the project page, paused the placeholder deployment source, and prepared a governed issue-body refresh around bounded retrieval hardening.",
      "",
      "## Blockers",
      "Real-corpus semantic retrieval still needs proof, and there is no meaningful CI signal beyond a queued dependabot run.",
      "",
      "## Lessons",
      "A project can have strong product proof and still be partially represented if evidence and external-source posture are not normalized in Notion.",
      "",
      "## Next Steps",
      "Keep working through the active issue: bounded vector indexing, targeted semantic retrieval proof, and a real project check path.",
    ].join("\n"),
  },
  {
    title: "Recall",
    repoSlug: "saagpatel/Recall",
    activeIssueNumber: 1,
    activeIssueTitle: "Recall: vertical-slice proof and cleanup",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "Unknown",
    effortToShip: "1 week",
    lastActive: "2026-03-21",
    lastMeaningfulWork:
      "Headless boot still initializes the active systems, but it surfaces a missing crack-overlay texture, which makes the current vertical slice real but not clean yet.",
    nextMove:
      "Use issue #1 as the active vertical-slice issue: prove the first source set, capture a performance baseline, and fix the missing crack-overlay asset/error so the current slice boots cleanly.",
    biggestBlocker:
      "Missing crack-overlay asset on headless boot, plus performance and source-set validation for the current vertical slice.",
    projectHealthNotes:
      "The codebase is further along than the old Notion wording implied, but the current readiness call was too optimistic and needed a more evidence-backed slice definition.",
    knownRisks:
      "Leaving the boot-time asset error undocumented would make the project look cleaner in Notion than it actually is.",
    whatWorks:
      "The project boots, autoload systems initialize, and the governed GitHub lane is already active.",
    missingCorePieces:
      "Clean boot proof, first source-set proof, performance baseline, and sharper readiness language in Notion.",
    checkPosture:
      "The repo has no GitHub workflow automation yet. The strongest live evidence right now is a successful local headless boot that still reports a missing crack-overlay texture during initialization.",
    deploymentDisposition:
      "No deployment-project source should stay unresolved for Recall until there is a real deployment target; keep the repo source active and pause the placeholder deployment row.",
    buildSessionTitle: "Batch finish normalization - Recall",
    buildSessionType: "Planning",
    buildSessionOutcome: "Shipped",
    buildSessionPlanned:
      "Normalize Recall so the Notion page stops talking about GitHub kickoff and instead tracks the current vertical-slice proof and cleanup work.",
    buildSessionShipped:
      "Added build-log evidence, refreshed the project page, paused the placeholder deployment source, and prepared a governed issue update centered on the real vertical-slice blockers.",
    buildSessionBlockers:
      "Headless boot reports a missing crack-overlay texture, there is still no performance baseline, and the current source-set proof has not been documented end to end.",
    buildSessionLessons:
      "This project needed better evidence framing more than new operating infrastructure; the core lane already existed.",
    buildSessionNextSteps:
      "Fix the missing asset path, capture the performance baseline, and prove the first source set through the active issue.",
    buildSessionTags: ["portfolio", "github", "godot"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "Godot"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionScopeDrift: "None",
    buildSessionRating: "Good",
    followUpNeeded: true,
    buildSessionMarkdown: [
      "# Batch finish normalization - Recall",
      "",
      "## What Was Planned",
      "Normalize Recall so the Notion page stops talking about GitHub kickoff and instead tracks the current vertical-slice proof and cleanup work.",
      "",
      "## What Shipped",
      "Added build-log evidence, refreshed the project page, paused the placeholder deployment source, and prepared a governed issue update centered on the real vertical-slice blockers.",
      "",
      "## Blockers",
      "Headless boot reports a missing crack-overlay texture, there is still no performance baseline, and the current source-set proof has not been documented end to end.",
      "",
      "## Lessons",
      "This project needed better evidence framing more than new operating infrastructure; the core lane already existed.",
      "",
      "## Next Steps",
      "Fix the missing asset path, capture the performance baseline, and prove the first source set through the active issue.",
    ].join("\n"),
  },
  {
    title: "Phantom Frequencies",
    repoSlug: "saagpatel/PhantomFrequencies",
    activeIssueNumber: 1,
    activeIssueTitle: "Phantom Frequencies: foundation proof slice",
    currentState: "Active Build",
    portfolioCall: "Build Now",
    momentum: "Hot",
    setupFriction: "Low",
    runsLocally: "Yes",
    buildMaturity: "Scaffolded",
    shipReadiness: "Not Ready",
    effortToDemo: "Unknown",
    effortToShip: "2+ weeks",
    lastActive: "2026-03-21",
    lastMeaningfulWork:
      "A local headless Godot boot now confirms the repo launches, but the project still lacks first gameplay proof and a meaningful validation path.",
    nextMove:
      "Use issue #1 as the active foundation slice: boot the current build, capture first gameplay proof, and document the minimal validation path for the rhythm-stealth core loop.",
    biggestBlocker:
      "No gameplay proof or meaningful automated validation yet, and the project is still too early for a stronger readiness call.",
    projectHealthNotes:
      "The repo was already mapped into GitHub, but the Notion page still described kickoff work instead of the real foundation slice and had no build evidence attached.",
    knownRisks:
      "Without first gameplay proof, the project can look more advanced in portfolio views than the actual evidence supports.",
    whatWorks:
      "The project boots locally and the governed GitHub issue lane is already in place.",
    missingCorePieces:
      "First gameplay proof, explicit validation steps for the rhythm-stealth loop, and a cleaner external-source story.",
    checkPosture:
      "The repo has no GitHub workflow automation yet. Current evidence is a successful local headless Godot boot, which is enough to mark local run viability but not gameplay readiness.",
    deploymentDisposition:
      "No deployment-project source should remain unresolved here until a real deployment target exists; keep the repo source active and pause the placeholder deployment row.",
    buildSessionTitle: "Batch finish normalization - Phantom Frequencies",
    buildSessionType: "Planning",
    buildSessionOutcome: "Shipped",
    buildSessionPlanned:
      "Normalize Phantom Frequencies so the Notion page, build evidence, and GitHub issue all point at the real foundation proof slice instead of kickoff language.",
    buildSessionShipped:
      "Added build-log evidence, refreshed the project page, confirmed local boot viability, paused the placeholder deployment source, and prepared a governed issue update for the current foundation slice.",
    buildSessionBlockers:
      "Gameplay proof is still missing, no meaningful automated validation exists yet, and the project is still early enough that readiness must stay conservative.",
    buildSessionLessons:
      "For early game projects, a simple boot proof plus a precise active slice is better than vague kickoff language.",
    buildSessionNextSteps:
      "Capture first gameplay proof and write down the minimal validation path for the rhythm-stealth core loop through the active issue.",
    buildSessionTags: ["portfolio", "github", "godot"],
    buildSessionTools: ["Codex CLI (OpenAI)", "Notion", "GitHub", "Godot"],
    buildSessionArtifacts: ["notion", "github", "build-log"],
    buildSessionScopeDrift: "None",
    buildSessionRating: "Good",
    followUpNeeded: true,
    buildSessionMarkdown: [
      "# Batch finish normalization - Phantom Frequencies",
      "",
      "## What Was Planned",
      "Normalize Phantom Frequencies so the Notion page, build evidence, and GitHub issue all point at the real foundation proof slice instead of kickoff language.",
      "",
      "## What Shipped",
      "Added build-log evidence, refreshed the project page, confirmed local boot viability, paused the placeholder deployment source, and prepared a governed issue update for the current foundation slice.",
      "",
      "## Blockers",
      "Gameplay proof is still missing, no meaningful automated validation exists yet, and the project is still early enough that readiness must stay conservative.",
      "",
      "## Lessons",
      "For early game projects, a simple boot proof plus a precise active slice is better than vague kickoff language.",
      "",
      "## Next Steps",
      "Capture first gameplay proof and write down the minimal validation path for the rhythm-stealth core loop through the active issue.",
    ].join("\n"),
  },
];

interface BatchFlags {
  live: boolean;
  today: string;
}

interface BatchResult {
  title: string;
  projectPageId: string;
  buildLogPageId: string;
  pausedSourceIds: string[];
  issueUpdateRequestId: string;
  issueUrl: string;
}

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for batch finish normalization");
    }

    const flags = parseFlags(process.argv.slice(2));
    const reusableLinkBackfill = await runBatchReusableLinkBackfill(flags);
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase5ExternalSignals || !config.phase6Governance) {
      throw new AppError("Batch finish normalization requires phase5ExternalSignals and phase6Governance");
    }

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, buildSchema, sourceSchema, actionRequestSchema, policySchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase6Governance.policies.dataSourceId),
    ]);

    const [projectPages, buildPages, sourcePages, actionRequestPages, policyPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase6Governance.actionRequests.dataSourceId, actionRequestSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase6Governance.policies.dataSourceId, policySchema.titlePropertyName),
    ]);

    const projectPageByTitle = new Map(projectPages.map((page) => [page.title, page]));
    const buildPageByTitle = new Map(buildPages.map((page) => [page.title, page]));
    const sourceRecords = sourcePages.map((page) => ({ page, record: toExternalSignalSourceRecord(page) }));
    const actionRequestByTitle = new Map(actionRequestPages.map((page) => [page.title, page]));
    const policies = policyPages.map((page) => ({ page, record: toActionPolicyRecord(page) }));

    const updatePolicy = policies.find((entry) => entry.record.title === "github.update_issue");
    if (!updatePolicy) {
      throw new AppError('Could not find the "github.update_issue" action policy');
    }

    const results: BatchResult[] = [];
    for (const target of TARGET_PROJECTS) {
      const projectPage = projectPageByTitle.get(target.title);
      if (!projectPage) {
        throw new AppError(`Could not find project page for "${target.title}"`);
      }

      const existingBuildIds = relationIds(projectPage.properties["Build Sessions"]);
      const existingResearchIds = relationIds(projectPage.properties["Related Research"]);
      const existingSkillIds = relationIds(projectPage.properties["Supporting Skills"]);
      const existingToolIds = relationIds(projectPage.properties["Tool Stack Records"]);

      const activeRepoSource = sourceRecords.find(
        (entry) =>
          entry.record.localProjectIds.includes(projectPage.id) &&
          entry.record.sourceType === "Repo" &&
          entry.record.identifier === target.repoSlug,
      );
      if (!activeRepoSource) {
        throw new AppError(`Could not find active repo source for "${target.title}"`);
      }

      const deploymentSources = sourceRecords.filter(
        (entry) =>
          entry.record.localProjectIds.includes(projectPage.id) &&
          entry.record.sourceType === "Deployment Project",
      );

      const existingBuildPage = buildPageByTitle.get(target.buildSessionTitle);
      const buildLog = flags.live
        ? await upsertBuildLogPage({
            api,
            titlePropertyName: buildSchema.titlePropertyName,
            dataSourceId: config.relatedDataSources.buildLogId,
            existingPageId: existingBuildPage?.id,
            projectId: projectPage.id,
            config: target,
            today: flags.today,
          })
        : {
            id: existingBuildPage?.id ?? `dry-run-build-${projectPage.id}`,
            url: existingBuildPage?.url ?? "",
          };

      const pausedSourceIds: string[] = [];
      if (flags.live) {
        for (const source of deploymentSources) {
          await api.updatePageProperties({
            pageId: source.page.id,
            properties: {
              Status: selectPropertyValue("Paused"),
              Environment: selectPropertyValue("N/A"),
              "Sync Strategy": selectPropertyValue("Poll"),
              "Last Synced At": { date: null },
            },
          });
          await api.patchPageMarkdown({
            pageId: source.page.id,
            command: "replace_content",
            newMarkdown: buildDeferredDeploymentMarkdown(target),
          });
          pausedSourceIds.push(source.page.id);
        }
      }

      const buildSessionIds = [...new Set([...existingBuildIds, buildLog.id])];
      const projectProperties = {
        "Date Updated": { date: { start: flags.today } },
        "Current State": selectPropertyValue(target.currentState),
        "Portfolio Call": selectPropertyValue(target.portfolioCall),
        Momentum: selectPropertyValue(target.momentum),
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
      };

      if (flags.live) {
        await api.updatePageProperties({
          pageId: projectPage.id,
          properties: projectProperties,
        });
        const currentMarkdown = await api.readPageMarkdown(projectPage.id);
        const issueUrl = `https://github.com/${target.repoSlug}/issues/${target.activeIssueNumber}`;
        const snapshotMarkdown = buildProjectSnapshotMarkdown(target, {
          buildLogUrl: buildLog.url,
          issueUrl,
        });
        const merged = mergeManagedSection(currentMarkdown.markdown, snapshotMarkdown, SNAPSHOT_START, SNAPSHOT_END);
        if (merged !== currentMarkdown.markdown) {
          await api.patchPageMarkdown({
            pageId: projectPage.id,
            command: "replace_content",
            newMarkdown: merged,
          });
        }
      }

      const requestTitle = issueUpdateRequestTitle(target.title);
      const requestResult = flags.live
        ? await upsertPageByTitle({
            api,
            dataSourceId: config.phase6Governance.actionRequests.dataSourceId,
            titlePropertyName: actionRequestSchema.titlePropertyName,
            title: requestTitle,
            properties: {
              [actionRequestSchema.titlePropertyName]: titleValue(requestTitle),
              "Local Project": relationValue([projectPage.id]),
              Policy: relationValue([updatePolicy.page.id]),
              "Target Source": relationValue([activeRepoSource.page.id]),
              Status: selectPropertyValue("Approved"),
              "Source Type": selectPropertyValue("Manual"),
              "Requested By": peopleValue(config.phase2Execution?.defaultOwnerUserId),
              Approver: peopleValue(config.phase2Execution?.defaultOwnerUserId),
              "Requested At": { date: { start: flags.today } },
              "Decided At": { date: { start: flags.today } },
              "Expires At": { date: { start: addDays(flags.today, 3) } },
              "Planned Payload Summary": richTextValue(
                `Refresh the active governed GitHub issue for ${target.title} so the title and body match the current execution slice.`,
              ),
              "Payload Title": richTextValue(target.activeIssueTitle),
              "Payload Body": richTextValue(buildIssueBody(target)),
              "Target Number": { number: target.activeIssueNumber },
              "Execution Intent": selectPropertyValue("Dry Run"),
              "Provider Request Key": richTextValue(
                `batch-finish:${target.title}:github.update_issue:${target.activeIssueNumber}`,
              ),
              "Approval Reason": richTextValue(
                "Approved batch-finish refresh so the current governed issue matches the active slice and the Notion state.",
              ),
              "Execution Notes": richTextValue(
                "Created by the batch finish normalization workflow to refresh the active governed GitHub issue in place.",
              ),
            },
            markdown: buildIssueRequestMarkdown(target, {
              issueUrl: `https://github.com/${target.repoSlug}/issues/${target.activeIssueNumber}`,
              issueNumber: target.activeIssueNumber,
            }),
          })
        : {
            id: actionRequestByTitle.get(requestTitle)?.id ?? `dry-run-request-${projectPage.id}`,
            url: actionRequestByTitle.get(requestTitle)?.url ?? "",
            existed: Boolean(actionRequestByTitle.get(requestTitle)?.id),
          };

      results.push({
        title: target.title,
        projectPageId: projectPage.id,
        buildLogPageId: buildLog.id,
        pausedSourceIds,
        issueUpdateRequestId: requestResult.id,
        issueUrl: `https://github.com/${target.repoSlug}/issues/${target.activeIssueNumber}`,
      });
    }

    console.log(
      JSON.stringify(
        { ok: true, live: flags.live, today: flags.today, reusableLinkBackfill, results },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

async function upsertBuildLogPage(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  existingPageId?: string;
  projectId: string;
  config: ProjectBatchConfig;
  today: string;
}): Promise<{ id: string; url: string }> {
  const properties = {
    [input.titlePropertyName]: titleValue(input.config.buildSessionTitle),
    "Session Date": { date: { start: input.today } },
    "Session Type": selectPropertyValue(input.config.buildSessionType),
    Outcome: selectPropertyValue(input.config.buildSessionOutcome),
    "What Was Planned": richTextValue(input.config.buildSessionPlanned),
    "What Shipped": richTextValue(input.config.buildSessionShipped),
    "Blockers Hit": richTextValue(input.config.buildSessionBlockers),
    "Lessons Learned": richTextValue(input.config.buildSessionLessons),
    "Next Steps": richTextValue(input.config.buildSessionNextSteps),
    "Tools Used": multiSelectValue(input.config.buildSessionTools),
    "Artifacts Updated": multiSelectValue(input.config.buildSessionArtifacts),
    Tags: multiSelectValue(input.config.buildSessionTags),
    "Scope Drift": selectPropertyValue(input.config.buildSessionScopeDrift),
    "Session Rating": selectPropertyValue(input.config.buildSessionRating),
    "Follow-up Needed": { checkbox: input.config.followUpNeeded },
    "Local Project": relationValue([input.projectId]),
    Duration: richTextValue(""),
    "Model Used": { select: null },
    "Tech Debt Created": richTextValue(""),
  };

  if (input.existingPageId) {
    await input.api.updatePageProperties({
      pageId: input.existingPageId,
      properties,
    });
    await input.api.patchPageMarkdown({
      pageId: input.existingPageId,
      command: "replace_content",
      newMarkdown: input.config.buildSessionMarkdown,
    });
    const page = await input.api.retrievePage(input.existingPageId);
    return { id: page.id, url: page.url };
  }

  return input.api.createPageWithMarkdown({
    parent: { data_source_id: input.dataSourceId },
    properties,
    markdown: input.config.buildSessionMarkdown,
  });
}

function buildProjectSnapshotMarkdown(
  target: ProjectBatchConfig,
  input: {
    buildLogUrl: string;
    issueUrl: string;
  },
): string {
  return [
    SNAPSHOT_START,
    "## Batch Finish Snapshot",
    "",
    `- Active governed issue: [#${target.activeIssueNumber}](${input.issueUrl})`,
    `- Build-log checkpoint: [${target.buildSessionTitle}](${input.buildLogUrl})`,
    `- Check posture: ${target.checkPosture}`,
    `- Deployment source posture: ${target.deploymentDisposition}`,
    "",
    "### Current Slice",
    target.nextMove,
    "",
    "### Blocking Reality",
    target.biggestBlocker,
    "",
    "### Readiness Notes",
    target.projectHealthNotes,
    SNAPSHOT_END,
  ].join("\n");
}

function buildDeferredDeploymentMarkdown(target: ProjectBatchConfig): string {
  return [
    `# ${target.title} deployment source deferred`,
    "",
    "- Status: Paused",
    "- Source type: Deployment Project",
    "- Environment: N/A",
    "",
    "## Why this is paused",
    target.deploymentDisposition,
    "",
    "## Reactivate only when",
    "A real deployment surface exists and can be mapped with a live identifier and URL.",
  ].join("\n");
}

function buildIssueBody(target: ProjectBatchConfig): string {
  return [
    `This issue is the current governed execution slice for **${target.title}**.`,
    "",
    "## Why this issue is current",
    "- Keep the active GitHub issue aligned with the real next slice instead of kickoff-era wording.",
    "- Carry the project's real blockers, check posture, and evidence needs inside the governed lane.",
    "",
    "## Current focus",
    target.nextMove,
    "",
    "## Check posture",
    target.checkPosture,
    "",
    "## Blocking reality",
    target.biggestBlocker,
    "",
    "## Done when",
    "- The active Notion page and this governed issue describe the same slice.",
    "- The current blockers are either resolved or replaced with fresher evidence-backed blockers.",
    "- The next proof step for this project is captured through the governed GitHub lane.",
  ].join("\n");
}

function buildIssueRequestMarkdown(
  target: ProjectBatchConfig,
  input: { issueUrl: string; issueNumber: number },
): string {
  return [
    `# ${issueUpdateRequestTitle(target.title)}`,
    "",
    `- Target issue: [#${input.issueNumber}](${input.issueUrl})`,
    `- Requested title: ${target.activeIssueTitle}`,
    "",
    "## Purpose",
    "Refresh the active governed issue so GitHub and Notion describe the same execution slice.",
    "",
    "## Current focus",
    target.nextMove,
    "",
    "## Blocking reality",
    target.biggestBlocker,
  ].join("\n");
}

function issueUpdateRequestTitle(projectTitle: string): string {
  return `Batch finish - ${projectTitle} - governed issue refresh`;
}

function relationIds(
  property?: {
    relation?: Array<{ id: string }>;
  },
): string[] {
  return (property?.relation ?? []).map((entry) => entry.id);
}

function peopleValue(id?: string): { people: Array<{ id: string }> } {
  return id ? { people: [{ id }] } : { people: [] };
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
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
