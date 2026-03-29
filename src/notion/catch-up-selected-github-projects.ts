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
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

interface Flags {
  live: boolean;
  today: string;
}

interface TargetConfig {
  title: string;
  completion: string;
  readiness: string;
  keyIntegrations: string;
  valueOutcome: string;
  monetizationValue: string;
  researchTitles: string[];
  skillTitles: string[];
  toolTitles: string[];
  buildSessionTitle: string;
  buildPlanned: string;
  buildShipped: string;
  buildBlockers: string;
  buildLessons: string;
  buildNextSteps: string;
}

const TODAY = losAngelesToday();
const COMMON_TOOL_TITLES = ["Codex CLI (OpenAI)", "GitHub", "Git", "Notion"];

const TARGETS: TargetConfig[] = [
  {
    title: "EarthPulse",
    completion:
      "Feature-complete desktop data explorer with strong live-data scope. The remaining work is fresh local validation after the repo-path and dependency-state blockers are cleared.",
    readiness:
      "Near ship from a product-scope standpoint, but not ready for a confident release call until the project runs from a colon-free path and the primary validation path is rerun cleanly.",
    keyIntegrations:
      "Tauri 2 desktop shell, React 19 frontend, Rust services, Leaflet-powered mapping, SQLite, live public-data feeds from USGS/NOAA/NASA-class sources, and optional local-summary support.",
    valueOutcome:
      "A high-signal showcase app that turns scattered Earth and near-Earth feeds into one live, explorable desktop dashboard people can actually keep open and use.",
    monetizationValue:
      "Strong portfolio value today and credible premium desktop-utility potential later through alerts, exports, richer monitoring workflows, and a polished mission-control experience.",
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
      "Dependency Restores Should Convert Setup Noise Into Real Blockers",
    ],
    skillTitles: ["Codex CLI", "Git", "React", "TypeScript", "Tauri", "Rust", "Documentation & Runbooks"],
    toolTitles: COMMON_TOOL_TITLES,
    buildSessionTitle: "Notion catch-up - EarthPulse",
    buildPlanned:
      "Complete the missing Notion operating record for EarthPulse after the repo and source rows already existed in GitHub and Notion.",
    buildShipped:
      "Filled the missing completion, readiness, value, and integration fields, linked the shared research and skills pages, and created a durable build-log checkpoint for the project.",
    buildBlockers:
      "The product blocker is unchanged: fresh local proof is still blocked until the repo runs from a colon-free path with a healthy dependency baseline.",
    buildLessons:
      "A project can be clearly real and still remain underrepresented in Notion if the support records and value framing never get added.",
    buildNextSteps:
      "Move or clone the repo into a colon-free path, restore the pnpm baseline, rerun preflight plus the primary validation path, and then reassess release readiness.",
  },
  {
    title: "Relay",
    completion:
      "Feature-complete core transfer flow with strong architectural clarity and test evidence. The remaining gap is current transfer-path proof and workflow confidence, not missing product shape.",
    readiness:
      "Close to a release-candidate desktop beta, but still gated by fresh transfer validation and better confidence around the active workflow surface.",
    keyIntegrations:
      "Go signaling and relay service, Rust QUIC client, Tauri desktop shell, Solid.js frontend, encrypted relay fallback, and end-to-end file-transfer verification.",
    valueOutcome:
      "A differentiated desktop utility that makes secure peer-to-peer file transfer understandable and reliable without asking users to touch networking setup.",
    monetizationValue:
      "Strong potential as a paid desktop utility or prosumer tool, with added upside from self-hosted relay flows or premium sharing features once reliability is fully proven.",
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    ],
    skillTitles: ["Codex CLI", "Git", "TypeScript", "Rust", "Documentation & Runbooks"],
    toolTitles: COMMON_TOOL_TITLES,
    buildSessionTitle: "Notion catch-up - Relay",
    buildPlanned:
      "Finish the missing Notion support layer for Relay so the project reads as a real finish candidate instead of a thin GitHub-backed row.",
    buildShipped:
      "Added the missing build-log checkpoint, linked the shared research, skills, and tool records, and filled the missing value, monetization, and integration fields.",
    buildBlockers:
      "The main blocker remains live transfer-path confidence: the repo still needs the next fresh transfer-validation proof and workflow cleanup.",
    buildLessons:
      "Security-heavy utility projects need explicit value framing in Notion or they get treated like half-finished experiments even when the product story is strong.",
    buildNextSteps:
      "Use the existing issue lane to reconcile the failure surface and capture the next transfer-validation proof.",
  },
  {
    title: "SynthWave",
    completion:
      "Feature-complete private-beta desktop visualizer with a strong audio and graphics surface. Remaining work is deliberate beta closeout and release slicing rather than missing core product work.",
    readiness:
      "Near ship for private beta, with the main gate being one intentional decision on how to land the current readiness-recovery work.",
    keyIntegrations:
      "Tauri desktop shell, React and TypeScript frontend, Rust audio pipeline, WebGL shader visualizations, recording and screenshot capture, and optional Ollama-based genre classification.",
    valueOutcome:
      "A compelling flagship portfolio app that shows real-time graphics, audio analysis, and polished desktop interaction working together in one memorable product.",
    monetizationValue:
      "Clear premium desktop-app potential through private-beta distribution, creative-tool positioning, and future paid recording or export features.",
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    ],
    skillTitles: ["Codex CLI", "Git", "React", "TypeScript", "Tauri", "Rust", "Documentation & Runbooks"],
    toolTitles: COMMON_TOOL_TITLES,
    buildSessionTitle: "Notion catch-up - SynthWave",
    buildPlanned:
      "Close the Notion-support gap for SynthWave so the current private-beta and readiness-recovery work is visible as part of the operating story.",
    buildShipped:
      "Created a build-log checkpoint, linked the shared support records, and filled the missing completion, readiness, value, and strategic fields.",
    buildBlockers:
      "The product blocker is still a release decision: the repo carries real readiness-recovery work and needs one clear call on what lands next.",
    buildLessons:
      "When a repo has active release work, Notion needs to reflect that current story or the project keeps looking older and less real than it is.",
    buildNextSteps:
      "Keep the project reopened, preserve the current readiness-recovery branch, and validate the current AI and private-beta slice before deciding what becomes the next publishable change.",
  },
  {
    title: "Terroir",
    completion:
      "Feature-complete iOS concept with the core globe-to-flavor interaction in sight. Remaining work is device performance hardening and deeper enrichment polish rather than product discovery.",
    readiness:
      "Near ship as a polished demo or premium beta if the globe rendering and enrichment path hold up on device.",
    keyIntegrations:
      "SwiftUI app shell, SceneKit 3D globe, bundled terroir.bin flavor dataset, CoreLocation, flavor-card generation, and CloudKit or Vercel enrichment services.",
    valueOutcome:
      "A memorable iOS showcase that translates environmental data into a novel sensory product experience with a clear visual hook.",
    monetizationValue:
      "Strong direct one-time paid App Store potential because the experience feels premium, visual, and self-contained even before deeper expansion work.",
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    ],
    skillTitles: ["Codex CLI", "Git", "Documentation & Runbooks"],
    toolTitles: COMMON_TOOL_TITLES,
    buildSessionTitle: "Notion catch-up - Terroir",
    buildPlanned:
      "Fill the missing Notion completion layer for Terroir so the project reads like a real finish candidate instead of a thin review row.",
    buildShipped:
      "Added a durable build-log checkpoint, linked shared research, skills, and tool records, and filled the missing completion, readiness, value, and integration fields.",
    buildBlockers:
      "The product blocker remains device truth: globe rendering performance and enrichment depth still need confirmation on the real target experience.",
    buildLessons:
      "Premium-feeling concept apps need explicit commercialization framing in Notion or they undersell their strongest product advantage.",
    buildNextSteps:
      "Device test globe rendering, wire the CloudKit enrichment endpoint, and optimize globe textures on older hardware.",
  },
  {
    title: "Wavelength",
    completion:
      "Feature-complete sensing concept with the main rendering and interpretation loop defined. Remaining work is entitlement reality, device proof, and finish-level polish.",
    readiness:
      "Near ship as a polished demo, but full shipping confidence still depends on device testing and the final Wi-Fi entitlement path.",
    keyIntegrations:
      "SwiftUI interface, Metal spectrogram renderer, CoreBluetooth and CoreLocation sensing, NetworkExtension or NEHotspotHelper Wi-Fi capture, contextual signal interpretation, and iOS device testing.",
    valueOutcome:
      "A standout technical portfolio app that turns invisible radio activity into a clear, beautiful visual experience with real educational value.",
    monetizationValue:
      "Good paid-app potential if the sensing experience feels trustworthy, with extra upside from education-minded and prosumer radio users.",
    researchTitles: [
      "Finish-Track Projects Need Evidence, Packaging Proof, and Release Inputs",
      "Desktop App Readiness Needs Happy-Path Proof Beyond Passing Tests",
    ],
    skillTitles: ["Codex CLI", "Git", "Documentation & Runbooks"],
    toolTitles: COMMON_TOOL_TITLES,
    buildSessionTitle: "Notion catch-up - Wavelength",
    buildPlanned:
      "Complete the missing Notion support layer for Wavelength so the project can be judged from its real device and entitlement story.",
    buildShipped:
      "Added a build-log checkpoint, linked the shared support records, and filled the missing completion, readiness, value, monetization, and integration fields.",
    buildBlockers:
      "The main blocker remains the last entitlement and hardware-confidence step, not missing documentation or missing project framing.",
    buildLessons:
      "Sensor-heavy iOS work needs both product framing and operating evidence in Notion or the technical depth is easy to miss.",
    buildNextSteps:
      "Merge the polish branch, run device validation on real hardware, and confirm the final entitlement strategy.",
  },
];

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

function requirePage(pageMap: Map<string, DataSourcePageRef>, title: string, kind: string): DataSourcePageRef {
  const page = pageMap.get(title);
  if (!page) {
    throw new AppError(`Could not find ${kind} page "${title}"`);
  }
  return page;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function upsertBuildLog(input: {
  api: DirectNotionClient;
  buildDataSourceId: string;
  buildTitlePropertyName: string;
  projectId: string;
  today: string;
  target: TargetConfig;
}): Promise<{ id: string; url: string }> {
  const result = await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.buildDataSourceId,
    titlePropertyName: input.buildTitlePropertyName,
    title: input.target.buildSessionTitle,
    properties: {
      [input.buildTitlePropertyName]: titleValue(input.target.buildSessionTitle),
      "Session Date": { date: { start: input.today } },
      "Session Type": selectPropertyValue("Planning"),
      Outcome: selectPropertyValue("Shipped"),
      "What Was Planned": richTextValue(input.target.buildPlanned),
      "What Shipped": richTextValue(input.target.buildShipped),
      "Blockers Hit": richTextValue(input.target.buildBlockers),
      "Lessons Learned": richTextValue(input.target.buildLessons),
      "Next Steps": richTextValue(input.target.buildNextSteps),
      "Tools Used": multiSelectValue(["Codex CLI (OpenAI)", "Notion", "GitHub"]),
      "Artifacts Updated": multiSelectValue(["notion", "build-log"]),
      Tags: multiSelectValue(["portfolio", "notion", "catch-up"]),
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
      `# ${input.target.buildSessionTitle}`,
      "",
      "## What Was Planned",
      input.target.buildPlanned,
      "",
      "## What Shipped",
      input.target.buildShipped,
      "",
      "## Blockers",
      input.target.buildBlockers,
      "",
      "## Next Steps",
      input.target.buildNextSteps,
    ].join("\n"),
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
  projectId: string;
}): Promise<void> {
  await input.api.updatePageProperties({
    pageId: input.pageId,
    properties: {
      [input.propertyName]: relationValue(uniqueIds([...input.existingIds, input.projectId])),
    },
  });
}

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for selected GitHub project catch-up");
    }

    const flags = parseFlags(process.argv.slice(2));
    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    const [projectSchema, buildSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
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
    const researchByTitle = new Map(researchPages.map((page) => [page.title, page]));
    const skillByTitle = new Map(skillPages.map((page) => [page.title, page]));
    const toolByTitle = new Map(toolPages.map((page) => [page.title, page]));

    const results: Array<Record<string, unknown>> = [];

    for (const target of TARGETS) {
      const projectPage = requirePage(projectByTitle, target.title, "project");
      const buildLog = flags.live
        ? await upsertBuildLog({
            api,
            buildDataSourceId: config.relatedDataSources.buildLogId,
            buildTitlePropertyName: buildSchema.titlePropertyName,
            projectId: projectPage.id,
            today: flags.today,
            target,
          })
        : {
            id: `dry-run-build-${target.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            url: "",
          };

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
      const buildSessionIds = uniqueIds([...relationIds(projectPage.properties["Build Sessions"]), buildLog.id]);

      if (flags.live) {
        await api.updatePageProperties({
          pageId: projectPage.id,
          properties: {
            "Date Updated": { date: { start: flags.today } },
            Completion: richTextValue(target.completion),
            Readiness: richTextValue(target.readiness),
            "Key Integrations": richTextValue(target.keyIntegrations),
            "Value / Outcome": richTextValue(target.valueOutcome),
            "Monetization / Strategic Value": richTextValue(target.monetizationValue),
            "Build Sessions": relationValue(buildSessionIds),
            "Build Session Count": { number: buildSessionIds.length },
            "Last Build Session": richTextValue(target.buildSessionTitle),
            "Last Build Session Date": { date: { start: flags.today } },
            "Related Research": relationValue(researchIds),
            "Supporting Skills": relationValue(skillIds),
            "Tool Stack Records": relationValue(toolIds),
            "Related Research Count": { number: researchIds.length },
            "Supporting Skills Count": { number: skillIds.length },
            "Linked Tool Count": { number: toolIds.length },
          },
        });

        for (const researchTitle of target.researchTitles) {
          const researchPage = requirePage(researchByTitle, researchTitle, "research");
          await addReverseRelation({
            api,
            pageId: researchPage.id,
            existingIds: relationIds(researchPage.properties["Related Local Projects"]),
            propertyName: "Related Local Projects",
            projectId: projectPage.id,
          });
        }

        for (const skillTitle of target.skillTitles) {
          const skillPage = requirePage(skillByTitle, skillTitle, "skill");
          await addReverseRelation({
            api,
            pageId: skillPage.id,
            existingIds: relationIds(skillPage.properties["Related Local Projects"]),
            propertyName: "Related Local Projects",
            projectId: projectPage.id,
          });
        }

        for (const toolTitle of target.toolTitles) {
          const toolPage = requirePage(toolByTitle, toolTitle, "tool");
          await addReverseRelation({
            api,
            pageId: toolPage.id,
            existingIds: relationIds(toolPage.properties["Linked Local Projects"]),
            propertyName: "Linked Local Projects",
            projectId: projectPage.id,
          });
        }
      }

      results.push({
        title: target.title,
        buildSessionCount: buildSessionIds.length,
        relatedResearchCount: researchIds.length,
        supportingSkillsCount: skillIds.length,
        linkedToolCount: toolIds.length,
        live: flags.live,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          today: flags.today,
          updatedProjects: TARGETS.map((target) => target.title),
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
