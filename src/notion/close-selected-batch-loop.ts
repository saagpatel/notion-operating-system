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
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface Flags {
  live: boolean;
  today: string;
}

interface ProjectStateUpdate {
  title: string;
  currentState: "Active Build" | "Ready for Review";
  portfolioCall: "Build Now" | "Finish";
  momentum: "Warm" | "Hot";
  setupFriction: "Low" | "Medium" | "High";
  runsLocally: "Yes" | "Partial";
  buildMaturity: "Functional Core" | "Feature Complete" | "Demoable";
  shipReadiness: "Needs Hardening" | "Near Ship";
  effortToDemo: "<2h" | "2-3 days" | "Unknown";
  effortToShip: "2-3 days" | "1 week" | "2+ weeks";
  testPosture: "Strong" | "Some" | "Sparse";
  nextMove: string;
  biggestBlocker: string;
  projectHealthNotes: string;
  knownRisks: string;
  whatWorks: string;
  missingCorePieces: string;
  buildSessionTitle: string;
  primaryRunCommand: string;
}

const TODAY = losAngelesToday();

const PROJECT_UPDATES: ProjectStateUpdate[] = [
  {
    title: "SignalFlow",
    currentState: "Ready for Review",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Low",
    runsLocally: "Yes",
    buildMaturity: "Demoable",
    shipReadiness: "Near Ship",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Strong",
    nextMove:
      "Run one final finish review from the now-clean GitHub baseline and decide whether SignalFlow should ship as-is or take a very small polish slice.",
    biggestBlocker:
      "No material repo blocker remains. Local verify passes and the GitHub PR and workflow cleanup is complete, so the remaining work is finish review rather than broken checks.",
    projectHealthNotes:
      "SignalFlow is fully out of archive posture now. The repo has a passing local verify baseline and a clean GitHub lane, which is much stronger evidence than the old portfolio story.",
    knownRisks:
      "The remaining risk is release confidence and human finish judgment, not automation failures or missing dependencies.",
    whatWorks:
      "The full local verify flow passes, the dependency PRs are merged, and the GitHub hygiene noise that used to distort readiness is gone.",
    missingCorePieces:
      "A final finish decision and any release-input confirmation that should happen before calling the project fully ready.",
    buildSessionTitle: "Batch closeout - SignalFlow",
    primaryRunCommand: "bash .codex/scripts/run_verify_commands.sh",
  },
  {
    title: "Nexus",
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
    nextMove:
      "Use the clean GitHub baseline to do a final finish review, then decide whether Nexus needs any release-specific polish beyond the passing smoke path.",
    biggestBlocker:
      "No active repo blocker remains. Smoke coverage passes, the dependency PR is merged, and the misleading release-workflow failure on main pushes has been removed.",
    projectHealthNotes:
      "Nexus moved from noisy active build work into a stable near-finish lane once the missing build scripts and GitHub workflow noise were repaired.",
    knownRisks:
      "Release confidence still depends on tagged-release behavior and final human review rather than ordinary main-push checks alone.",
    whatWorks:
      "Typecheck, tests, smoke validation, dependency update merge, and GitHub CI cleanup are all in place on the canonical repo.",
    missingCorePieces:
      "A final release-confidence pass and any last finish-level polish decision.",
    buildSessionTitle: "Batch closeout - Nexus",
    primaryRunCommand: "pnpm test:e2e:smoke",
  },
  {
    title: "OPscinema",
    currentState: "Active Build",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Demoable",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Strong",
    nextMove:
      "Run the real screen-recording happy path on the packaged app and capture the first product-level blocker or finish call from that manual flow.",
    biggestBlocker:
      "Packaging and smoke install verification now pass, but the real screen-recording happy path still needs manual proof before finish confidence is justified.",
    projectHealthNotes:
      "OPscinema is no longer blocked by setup or packaging work. The remaining gap is product-path validation, which is a healthier and more honest blocker than its earlier archive posture.",
    knownRisks:
      "Permission, capture, or UX issues can still appear in the actual recording flow even when tests and package verification are green.",
    whatWorks:
      "Rust workspace tests pass, packaging succeeds, and the smoke install and verify path now passes for the desktop app.",
    missingCorePieces:
      "Manual happy-path validation for the primary recording flow and the first follow-up slice based on that result.",
    buildSessionTitle: "Batch closeout - OPscinema",
    primaryRunCommand: "make smoke-app-install smoke-app-verify",
  },
  {
    title: "prompt-englab",
    currentState: "Ready for Review",
    portfolioCall: "Finish",
    momentum: "Hot",
    setupFriction: "Low",
    runsLocally: "Yes",
    buildMaturity: "Feature Complete",
    shipReadiness: "Near Ship",
    effortToDemo: "<2h",
    effortToShip: "2-3 days",
    testPosture: "Strong",
    nextMove:
      "Run the remaining release-confidence and performance tail, then decide whether prompt-englab is ready for the next delivery move without more remediation work.",
    biggestBlocker:
      "The audit and correctness gates now pass, so the remaining work is release-confidence and performance review rather than dependency risk or broken setup.",
    projectHealthNotes:
      "prompt-englab is much healthier than its parked posture suggested. The repo now clears the main correctness and security gates and only needs finish-level confidence work.",
    knownRisks:
      "A technically green repo can still feel under-described if the final release-confidence pass and tail checks are skipped.",
    whatWorks:
      "Install, Prisma generate, typecheck, lint, tests, build, and the high-severity audit gate all pass on the canonical repo baseline.",
    missingCorePieces:
      "A final release-confidence pass and any small polish slice that emerges from it.",
    buildSessionTitle: "Batch closeout - prompt-englab",
    primaryRunCommand: "npm run build",
  },
  {
    title: "app",
    currentState: "Ready for Review",
    portfolioCall: "Build Now",
    momentum: "Warm",
    setupFriction: "Medium",
    runsLocally: "Yes",
    buildMaturity: "Functional Core",
    shipReadiness: "Needs Hardening",
    effortToDemo: "<2h",
    effortToShip: "2+ weeks",
    testPosture: "Sparse",
    nextMove:
      "Decide whether this scaffold is worth continuing now that it builds again and, if yes, define the first real feature slice instead of another setup-only pass.",
    biggestBlocker:
      "The build blocker is cleared. The remaining blocker is strategic: app is still a scaffold and needs a keep-or-stop product decision rather than more wiring work.",
    projectHealthNotes:
      "app is no longer a broken archived scaffold. It is a buildable scaffold with a clear portfolio decision pending, which is a much more useful operating posture.",
    knownRisks:
      "A passing build could be mistaken for product readiness even though the repo still lacks a meaningful feature slice and real usage proof.",
    whatWorks:
      "ContentView is restored, the canonical GitHub home exists, and xcodebuild now succeeds on the current repo baseline.",
    missingCorePieces:
      "A keep-or-stop decision and, if kept, the first real product slice that moves the repo beyond scaffold status.",
    buildSessionTitle: "Batch closeout - app",
    primaryRunCommand: "xcodebuild -project app.xcodeproj -scheme app -sdk macosx build CODE_SIGNING_ALLOWED=NO",
  },
];

async function main(): Promise<void> {
  try {
    const flags = parseFlags(process.argv.slice(2));
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for selected batch closeout");
    }

    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
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

    const updates = [];

    for (const update of PROJECT_UPDATES) {
      const page = projectByTitle.get(update.title);
      if (!page) {
        throw new AppError(`Could not find project page for "${update.title}"`);
      }

      const buildSessionIds = relationIds(page.properties["Build Sessions"]);
      const properties = {
        "Date Updated": { date: { start: flags.today } },
        "Current State": selectPropertyValue(update.currentState),
        "Portfolio Call": selectPropertyValue(update.portfolioCall),
        Momentum: selectPropertyValue(update.momentum),
        "Needs Review": { checkbox: false },
        "Last Active": { date: { start: flags.today } },
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
        "Last Build Session Date": { date: { start: flags.today } },
        "Primary Run Command": richTextValue(update.primaryRunCommand),
      };

      if (flags.live) {
        await api.updatePageProperties({
          pageId: page.id,
          properties,
        });
      }

      updates.push({
        title: update.title,
        pageId: page.id,
        currentState: update.currentState,
        portfolioCall: update.portfolioCall,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          today: flags.today,
          updatedProjects: updates,
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
