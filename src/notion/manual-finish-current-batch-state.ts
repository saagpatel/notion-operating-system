import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import { fetchAllPages, relationIds, relationValue, richTextValue, selectPropertyValue } from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

const TODAY = "2026-03-22";

interface ProjectStateUpdate {
  title: string;
  currentState: "Active Build";
  portfolioCall: "Build Now" | "Finish";
  momentum: "Warm" | "Hot";
  setupFriction: "Medium" | "High";
  runsLocally: "Partial";
  buildMaturity: "Functional Core" | "Feature Complete";
  shipReadiness: "Needs Hardening";
  effortToDemo: "<2h" | "2-3 days" | "Unknown";
  effortToShip: "2-3 days" | "1 week" | "2+ weeks";
  testPosture: "Some" | "Sparse";
  nextMove: string;
  biggestBlocker: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
  buildSessionTitle: string;
  primaryRunCommand: string;
  packetTitle: string;
}

const PROJECT_UPDATES: ProjectStateUpdate[] = [
  {
    title: "Construction",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Some",
    nextMove:
      "Use the existing governed issue to triage PR #1 workflow failures, decide whether those failures are acceptable, and restore the local dependency baseline.",
    biggestBlocker:
      "The local frontend check failed on missing React and routing dependencies, and PR #1 still shows failing git-hygiene and lockfile-rationale checks.",
    projectHealthNotes:
      "Construction is fully inside the GitHub lane now, so the remaining work is failure triage and dependency restore rather than more setup.",
    knownRisks:
      "If the PR failures remain untriaged, the repo will still look healthier in Notion than it really is on GitHub.",
    whatWorks:
      "The repo has an active source row, a governed issue trail, and a local check path that already revealed the current dependency blocker.",
    missingCorePieces:
      "An explicit accept-or-fix decision on PR #1 and a restored dependency baseline for local checks.",
    buildSessionTitle: "Batch rollout - Construction",
    primaryRunCommand: "pnpm check:frontend",
    packetTitle: "Construction - PR failure triage and dependency restore",
  },
  {
    title: "RealEstate",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Warm",
    setupFriction: "High",
    runsLocally: "Partial",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "1 week",
    testPosture: "Some",
    nextMove:
      "Keep the canonical repo mapping, leave the placeholder rows paused, and triage PR #1 and PR #3 after restoring the local dependency baseline.",
    biggestBlocker:
      "Local lint fails because prettier is missing, and PR #1 plus PR #3 still carry failing git-hygiene or lockfile-rationale checks.",
    projectHealthNotes:
      "RealEstate is now fully wired, so cleanup and trust restoration are the remaining themes rather than onboarding.",
    knownRisks:
      "If the failing PRs are not triaged explicitly, the repo will stay noisy and harder to trust.",
    whatWorks:
      "The canonical repo source, onboarding packet, webhook evidence, and governed issue lane are all in place.",
    missingCorePieces:
      "Dependency restore and an explicit decision on the two failing PRs.",
    buildSessionTitle: "Batch rollout - RealEstate",
    primaryRunCommand: "pnpm lint",
    packetTitle: "RealEstate - source cleanup and PR failure triage",
  },
  {
    title: "DatabaseSchema",
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
    nextMove:
      "Use the canonical `DatabaseSchema` repo, restore the dependency baseline, and rerun `npm run verify:all` from the first real post-install blocker.",
    biggestBlocker:
      "The first full verify run failed in typecheck because core frontend dependencies like React are missing from the install state.",
    projectHealthNotes:
      "DatabaseSchema now has a stable repo home and a truthful first blocker, so it should no longer sit in archive posture.",
    knownRisks:
      "The local package still uses older visualizer naming, so the repo-name decision should stay explicit until the broader surface settles.",
    whatWorks:
      "The repo now has a canonical GitHub destination and a real verify command that already exposed the dependency blocker.",
    missingCorePieces:
      "Dependency restore and a rerun of the full verify path.",
    buildSessionTitle: "Batch rollout - DatabaseSchema",
    primaryRunCommand: "npm run verify:all",
    packetTitle: "DatabaseSchema - canonical repo and verify baseline",
  },
  {
    title: "LegalDocsReview",
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
    nextMove:
      "Use the new GitHub repo as canonical, restore the missing node_modules baseline, and rerun lint and typecheck so the first non-setup blocker can be captured.",
    biggestBlocker:
      "Local lint failed immediately because prettier is not available in the current install state.",
    projectHealthNotes:
      "LegalDocsReview now has a real repo home and a truthful first blocker, but it still needs the dependency baseline restored before deeper quality claims matter.",
    knownRisks:
      "Until the dependency baseline is restored, any stronger readiness claim would be based on scaffolding rather than execution proof.",
    whatWorks:
      "The repo exposes a verify surface, has a live source row, and now has an executed governed issue request.",
    missingCorePieces:
      "Dependency restore and the first rerun of lint and typecheck after install is healthy.",
    buildSessionTitle: "Batch rollout - LegalDocsReview",
    primaryRunCommand: "pnpm lint",
    packetTitle: "LegalDocsReview - dependency restore and first real blocker",
  },
  {
    title: "AIGCCore",
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
    nextMove:
      "Use the new GitHub repo as canonical, restore the missing node_modules baseline, and rerun lint so the first post-install blocker can be captured.",
    biggestBlocker:
      "Local lint failed immediately because eslint is not installed in the current node_modules state.",
    projectHealthNotes:
      "AIGCCore now has a real repo home and a truthful first blocker, but it still needs the most basic local baseline restored before deeper readiness claims mean anything.",
    knownRisks:
      "Because AIGCCore had the weakest prior confidence in the batch, leaving it vague would make it easy to misclassify again.",
    whatWorks:
      "The repo exposes a broad verify surface and now has a reachable canonical GitHub destination with a governed issue request.",
    missingCorePieces:
      "Dependency restore and the first rerun of lint after install is healthy.",
    buildSessionTitle: "Batch rollout - AIGCCore",
    primaryRunCommand: "pnpm lint",
    packetTitle: "AIGCCore - dependency restore and first gate rerun",
  },
];

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for current-batch state completion");
    }

    const config = await loadLocalPortfolioControlTowerConfig("./config/local-portfolio-control-tower.json");
    const api = new DirectNotionClient(token);
    const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });

    const [projectSchema, toolSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
    ]);
    const [projectPages, toolPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    ]);
    const projectByTitle = new Map(projectPages.map((page) => [page.title, page] as const));
    const toolIds = toolPages
      .filter((page) => ["GitHub", "Notion", "Codex CLI (OpenAI)"].includes(page.title))
      .map((page) => page.id);

    for (const update of PROJECT_UPDATES) {
      const page = projectByTitle.get(update.title);
      if (!page) {
        throw new AppError(`Could not find project page for "${update.title}"`);
      }
      const buildSessionIds = relationIds(page.properties["Build Sessions"]);
      await api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Date Updated": { date: { start: TODAY } },
          "Current State": selectPropertyValue(update.currentState),
          "Portfolio Call": selectPropertyValue(update.portfolioCall),
          Momentum: selectPropertyValue(update.momentum),
          "Needs Review": { checkbox: false },
          "Last Active": { date: { start: TODAY } },
          "Next Move": richTextValue(update.nextMove),
          "Biggest Blocker": richTextValue(update.biggestBlocker),
          "Setup Friction": selectPropertyValue(update.setupFriction),
          "Runs Locally": selectPropertyValue(update.runsLocally),
          "Build Maturity": selectPropertyValue(update.buildMaturity),
          "Ship Readiness": selectPropertyValue(update.shipReadiness),
          "Effort to Demo": selectPropertyValue(update.effortToDemo),
          "Effort to Ship": selectPropertyValue(update.effortToShip),
          "Test Posture": selectPropertyValue(update.testPosture),
          "Docs Quality": selectPropertyValue("Usable"),
          "Evidence Confidence": selectPropertyValue("Medium"),
          "Project Health Notes": richTextValue(update.projectHealthNotes),
          "Known Risks": richTextValue(update.knownRisks),
          "What Works": richTextValue(update.whatWorks),
          "Missing Core Pieces": richTextValue(update.missingCorePieces),
          "Tool Stack Records": relationValue(toolIds),
          "Linked Tool Count": { number: toolIds.length },
          "Build Session Count": { number: buildSessionIds.length },
          "Last Build Session": richTextValue(update.buildSessionTitle),
          "Last Build Session Date": { date: { start: TODAY } },
          "Start Here": richTextValue(`Open the current packet: ${update.packetTitle}`),
          "Primary Run Command": richTextValue(update.primaryRunCommand),
        },
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          updatedProjects: PROJECT_UPDATES.map((entry) => entry.title),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exit(1);
  }
}

void main();
