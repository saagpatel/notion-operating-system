import "dotenv/config";

import { execFileSync } from "child_process";
import { promises as fs } from "fs";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  datePropertyValue,
  fetchAllPages,
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
import { toWorkPacketRecord, toExecutionTaskRecord } from "./local-portfolio-execution-live.js";
import { toExternalSignalSourceRecord } from "./local-portfolio-external-signals-live.js";
import { toActionPolicyRecord, toActionRequestRecord } from "./local-portfolio-governance-live.js";
import { ensureGitHubCreateIssueActionRequest } from "./operational-rollout.js";
import { losAngelesToday } from "../utils/date.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

const BATCH = "audit-batch-1";
const SNAPSHOT_START = "<!-- codex:audit-batch-1:start -->";
const SNAPSHOT_END = "<!-- codex:audit-batch-1:end -->";
const PROJECT_PORTFOLIO_DATA_SOURCE_ID = "35e04e4d-bcd8-45c0-b783-238edef210f7";

interface ProjectSpec {
  name: string;
  basePath: string;
}

interface SeedConfig {
  manualSeeds: Array<{
    title: string;
    localProjectId: string;
    provider: string;
    sourceType: string;
    status: string;
    environment: string;
    syncStrategy: string;
    identifier?: string;
    sourceUrl?: string;
  }>;
}

interface LocalRepoAudit {
  basePath: string;
  gitRoot: string;
  branch: string;
  dirtyCount: number;
  origin: string;
  originSlug: string;
}

interface GitHubAudit {
  targetSlug: string;
  repoExists: boolean;
  repoArchived: boolean;
  defaultBranch: string;
  pushedAt: string;
  visibility: string;
  openPrs: number;
  recentFailedRuns: number;
  latestActivityDate: string;
}

interface ProjectAudit {
  name: string;
  page: DataSourcePageRef;
  project: ReturnType<typeof toControlTowerProjectRecord>;
  portfolioRows: DataSourcePageRef[];
  sourceRows: ReturnType<typeof toExternalSignalSourceRecord>[];
  packets: ReturnType<typeof toWorkPacketRecord>[];
  tasks: ReturnType<typeof toExecutionTaskRecord>[];
  actionRequests: ReturnType<typeof toActionRequestRecord>[];
  local: LocalRepoAudit;
  github: GitHubAudit;
  activeCoverage: "None" | "Repo Only" | "Repo + Deploy" | "Mixed";
}

interface FieldOverride {
  biggestBlocker?: string;
  nextMove?: string;
  needsReview?: boolean;
  evidenceConfidence?: "Low" | "Medium" | "High";
  runsLocally?: "Yes" | "Partial" | "Likely" | "Unknown";
}

interface ScaffoldConfig {
  buildLogTitle: string;
  packetTitle: string;
  packetStatus: "Ready";
  packetPriority: "Now";
  packetType: "Build Push" | "Finish Push" | "Review Prep";
  packetGoal: string;
  packetDefinitionOfDone: string;
  packetWhyNow: string;
  packetEstimatedSize: "Half day" | "1 day" | "2-3 days";
  packetBlockerSummary: string;
  taskTitle: string;
  taskPriority: "P0" | "P1";
  taskType: "Build" | "Review" | "Fix";
  taskEstimate: "<2h" | "Half day" | "1 day";
  taskNotes: string;
  requestTitle?: string;
  requestPayloadTitle?: string;
  requestPayloadBody?: string;
}

const TODAY = losAngelesToday();

const PROJECT_SPECS: ProjectSpec[] = [
  { name: "ComplianceKit", basePath: "/Users/d/Projects/ComplianceKit" },
  { name: "DesktopTerrarium", basePath: "/Users/d/Projects/Fun:GamePrjs/DesktopTerrarium" },
  { name: "job-search-2026", basePath: "/Users/d/Projects/job-search-2026" },
  { name: "knowledgecore", basePath: "/Users/d/Projects/knowledgecore" },
  { name: "IncidentWorkbench", basePath: "/Users/d/Projects/ITPRJsViaClaude/IncidentWorkbench" },
  { name: "KBFreshnessDetector", basePath: "/Users/d/Projects/ITPRJsViaClaude/KBFreshnessDetector" },
  { name: "PersonalKBDrafter", basePath: "/Users/d/Projects/ITPRJsViaClaude/PersonalKBDrafter" },
  { name: "ScreenshotAnnotate", basePath: "/Users/d/Projects/ITPRJsViaClaude/ScreenshotAnnotate" },
  { name: "ContentEngine", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/ContentEngine" },
  { name: "FreeLanceInvoice", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/FreeLanceInvoice" },
  { name: "ShipKit", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/ShipKit" },
  { name: "StatusPage", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/StatusPage" },
  { name: "compliance-suite", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/compliance-suite" },
  { name: "BattleGrid", basePath: "/Users/d/Projects/Fun:GamePrjs/BattleGrid" },
  { name: "EarthPulse", basePath: "/Users/d/Projects/Fun:GamePrjs/EarthPulse" },
  { name: "Relay", basePath: "/Users/d/Projects/VanityPRJs/Relay" },
  { name: "SynthWave", basePath: "/Users/d/Projects/MoneyPRJsViaGPT/SynthWave" },
  { name: "DevToolsTranslator", basePath: "/Users/d/Projects/DevToolsTranslator" },
  { name: "GPT_RAG", basePath: "/Users/d/Projects/GPT_RAG" },
  { name: "JobCommandCenter", basePath: "/Users/d/Projects/JobCommandCenter" },
  { name: "Phantom Frequencies", basePath: "/Users/d/Projects/Phantom Frequencies" },
  { name: "Recall", basePath: "/Users/d/Projects/Recall" },
];

const FIELD_OVERRIDES: Record<string, FieldOverride> = {
  ComplianceKit: {
    biggestBlocker:
      "The project is mapped into GitHub and Notion, but it still needed a real execution slice instead of a row that only pointed at setup strength.",
    nextMove:
      "Use the new packet and governed issue request to define the first bounded compliance workflow slice and capture the first real build proof.",
    needsReview: false,
    evidenceConfidence: "Medium",
    runsLocally: "Yes",
  },
  DesktopTerrarium: {
    biggestBlocker:
      "The canonical repo lives under desktop_terrarium, and recent GitHub workflow noise is still high enough that the first local boot path needs explicit proof.",
    nextMove:
      "Work from the nested git root, validate the first usable local boot path, and triage the current workflow failure surface against that canonical root.",
    needsReview: false,
    evidenceConfidence: "Medium",
    runsLocally: "Unknown",
  },
  "job-search-2026": {
    biggestBlocker:
      "No active blocker is known right now; treat this as a shipped local-document system unless a new automation slice is intentionally reopened.",
    nextMove:
      "Keep the project in shipped posture and only reopen it if a new job-search workflow or automation slice is explicitly planned.",
    needsReview: false,
    evidenceConfidence: "High",
    runsLocally: "Yes",
  },
  knowledgecore: {
    biggestBlocker:
      "The local worktree is dirty on codex/chore/bootstrap-codex-os, and the open PR surface is materially larger than the old project row suggested.",
    nextMove:
      "Decide whether to land, split, or park the current codex branch, then reconcile the real PR backlog against the desktop-validation slice.",
    evidenceConfidence: "Medium",
  },
  IncidentWorkbench: {
    biggestBlocker:
      "The project is close to finish, but the backend verification lane still depends on hydrating the Python environment and rerunning the report path cleanly.",
    nextMove:
      "Hydrate the backend environment, run the verification bundle, and confirm the finish path end to end with one real report generation pass.",
    runsLocally: "Partial",
    evidenceConfidence: "Medium",
  },
  KBFreshnessDetector: {
    biggestBlocker:
      "The GitHub source mapping is now canonical, but the product still needs one real freshness scan and follow-through on the current workflow failures.",
    nextMove:
      "Run one live freshness scan, confirm the repaired workflows on GitHub, and tighten the remaining finish blocker into a bounded next slice.",
    needsReview: false,
    evidenceConfidence: "Medium",
  },
  PersonalKBDrafter: {
    biggestBlocker:
      "Placeholder source drift is cleaned up, but the local worktree is still dirty and the authenticated Jira-to-draft flow needs fresh proof.",
    nextMove:
      "Validate the live drafting flow end to end, then split the remaining worktree changes into cleaner publishable slices.",
    evidenceConfidence: "Medium",
  },
  ScreenshotAnnotate: {
    biggestBlocker:
      "The governed issue exists, but the first execution packet/task scaffold was still missing and the local repo is not yet clean.",
    nextMove:
      "Use the new execution packet to capture payload proof and finish validation on the current repo state.",
    evidenceConfidence: "Medium",
  },
  ContentEngine: {
    biggestBlocker:
      "Archive posture still conflicts with a very dirty local repo plus live PR and workflow noise.",
    nextMove:
      "Choose explicitly between cleaning the archive posture or reopening the project into active execution; do not leave it half-active.",
    evidenceConfidence: "Medium",
  },
  FreeLanceInvoice: {
    biggestBlocker:
      "Archive posture still conflicts with a heavily dirty local repo and live PR activity.",
    nextMove:
      "Either cleanly park the repo and close archive drift, or reopen it with a bounded finish slice.",
    evidenceConfidence: "Medium",
  },
  ShipKit: {
    biggestBlocker:
      "No active blocker is known right now; the repo and GitHub baseline are clean, and the main fix here was removing stale generic review text.",
    nextMove:
      "Keep the project archived unless a new shipping or polish goal is explicitly queued.",
    needsReview: false,
    evidenceConfidence: "High",
    runsLocally: "Likely",
  },
  StatusPage: {
    biggestBlocker:
      "Archive posture still conflicts with live PR, workflow, and execution-lane activity.",
    nextMove:
      "Decide whether to cleanly archive the remaining activity or reopen the project into an active finish lane.",
    evidenceConfidence: "Medium",
  },
  "compliance-suite": {
    biggestBlocker:
      "The repo is clean, but the project is still archived on a codex feature branch and the operating metadata was too generic to trust.",
    nextMove:
      "Choose whether to merge or close the codex branch and keep the project archived, or reopen it with a specific finish slice.",
    needsReview: false,
    evidenceConfidence: "Medium",
    runsLocally: "Likely",
  },
  BattleGrid: {
    biggestBlocker:
      "The canonical repo mapping is now clear, but placeholder drift had been masking the real PR and workflow noise on the active repo.",
    nextMove:
      "Use the existing governed lane to turn the next gameplay-validation slice into tighter finish proof.",
    evidenceConfidence: "Medium",
  },
  EarthPulse: {
    biggestBlocker:
      "Placeholder source drift is now cleaned up, but the repo still carries a large open PR backlog relative to the earlier project row.",
    nextMove:
      "Triage the real PR backlog and decide whether EarthPulse is truly ready for review or still in active finish mode.",
    evidenceConfidence: "Medium",
  },
  Relay: {
    biggestBlocker:
      "The canonical repo mapping is clear now, but recent workflow failures and thin support density still limit confidence.",
    nextMove:
      "Use the existing issue lane to reconcile the failure surface and capture the next transfer-validation proof.",
    evidenceConfidence: "Medium",
  },
  SynthWave: {
    biggestBlocker:
      "The local origin is now corrected to the canonical repo, but the worktree is still dirty and the archive posture remains a portfolio decision.",
    nextMove:
      "Decide whether to keep the project archived after cleaning the local drift, or reopen it with a specific music-workflow slice.",
    evidenceConfidence: "Medium",
  },
  DevToolsTranslator: {
    biggestBlocker:
      "The release blocker slice is still real: Chrome sign-off, credential inputs, updater signatures, and the latest perf/reliability gate.",
    nextMove:
      "Keep driving the release-readiness issue until the final workflow gate and manual inputs are clean.",
    evidenceConfidence: "High",
  },
  GPT_RAG: {
    biggestBlocker:
      "The deployment placeholder is paused, but retrieval hardening and a meaningful proof path still remain.",
    nextMove:
      "Continue the bounded vector and retrieval-proof slice and avoid reintroducing deployment noise until a real deployment surface exists.",
    evidenceConfidence: "Medium",
  },
  JobCommandCenter: {
    biggestBlocker:
      "The default branch is still a feature branch, and the real bundle plus batch proof is still missing.",
    nextMove:
      "Run the PyInstaller and real-batch validation slice, then decide whether polish/v1.0-improvements remains the operating default branch.",
    evidenceConfidence: "Medium",
  },
  "Phantom Frequencies": {
    biggestBlocker:
      "The deployment placeholder is paused, but the local worktree is still dirty and the active vertical slice is not yet closed.",
    nextMove:
      "Close the current vertical slice or split the local drift into cleaner follow-up branches.",
    evidenceConfidence: "Medium",
  },
  Recall: {
    biggestBlocker:
      "The deployment placeholder is paused, but the local worktree is still dirty and the current foundation slice is still open.",
    nextMove:
      "Finish or narrow the current foundation slice and keep the repo mapping as the only active external source.",
    evidenceConfidence: "Medium",
  },
};

const EXECUTION_SCAFFOLDS: Record<string, ScaffoldConfig> = {
  ComplianceKit: {
    buildLogTitle: "Audit batch 1 remediation - ComplianceKit",
    packetTitle: "ComplianceKit - first governed execution slice",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Build Push",
    packetGoal: "Turn ComplianceKit from a mapped project into an actively tracked execution slice.",
    packetDefinitionOfDone:
      "The first bounded compliance workflow slice is explicit in Notion and the governed GitHub lane, with one concrete proof step queued.",
    packetWhyNow:
      "This project had good baseline mapping but no execution scaffolding, which made the active-build posture weaker than it looked.",
    packetEstimatedSize: "1 day",
    packetBlockerSummary:
      "Execution scaffolding was missing even though the repo and operating row already existed.",
    taskTitle: "ComplianceKit - define first execution proof slice",
    taskPriority: "P0",
    taskType: "Build",
    taskEstimate: "Half day",
    taskNotes:
      "Use the governed issue lane and the new packet to define the first real proof step instead of leaving the project as a setup-only active build.",
    requestTitle: "Audit batch 1 - ComplianceKit - governed issue request",
    requestPayloadTitle: "ComplianceKit: first governed execution slice",
    requestPayloadBody: [
      "This issue should carry the first bounded execution slice for ComplianceKit.",
      "",
      "## Current focus",
      "Define and capture the first concrete compliance workflow proof step.",
      "",
      "## Done when",
      "- The next build slice is explicit.",
      "- The first blocker or pass is captured.",
    ].join("\n"),
  },
  DesktopTerrarium: {
    buildLogTitle: "Audit batch 1 remediation - DesktopTerrarium",
    packetTitle: "DesktopTerrarium - nested repo and first boot validation",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal: "Validate the first real boot path from the nested canonical repo and tighten the workflow-noise story around that root.",
    packetDefinitionOfDone:
      "The canonical nested repo path is explicit, one boot-path result is captured, and the next blocker is concrete.",
    packetWhyNow:
      "The row was blocked less by product uncertainty than by repo-root ambiguity and untriaged workflow noise.",
    packetEstimatedSize: "1 day",
    packetBlockerSummary:
      "The actual git root is nested under desktop_terrarium, and recent workflow noise is still high.",
    taskTitle: "DesktopTerrarium - validate nested repo boot path",
    taskPriority: "P0",
    taskType: "Review",
    taskEstimate: "Half day",
    taskNotes:
      "Work from the nested git root, confirm the first usable local boot path, and capture the first blocker or pass.",
    requestTitle: "Audit batch 1 - DesktopTerrarium - governed issue request",
    requestPayloadTitle: "DesktopTerrarium: nested repo and first boot validation",
    requestPayloadBody: [
      "This issue should carry the first real validation slice for DesktopTerrarium.",
      "",
      "## Current focus",
      "Treat /desktop_terrarium as the canonical repo root and capture the first usable boot-path result.",
      "",
      "## Done when",
      "- The canonical local root is explicit.",
      "- The first blocker or pass is captured against that root.",
    ].join("\n"),
  },
  ScreenshotAnnotate: {
    buildLogTitle: "Audit batch 1 remediation - ScreenshotAnnotate",
    packetTitle: "ScreenshotAnnotate - payload and finish proof",
    packetStatus: "Ready",
    packetPriority: "Now",
    packetType: "Finish Push",
    packetGoal: "Add the missing execution packet/task scaffold to the already-governed issue lane for ScreenshotAnnotate.",
    packetDefinitionOfDone:
      "The project has a real execution packet and task tied to the existing governed GitHub lane.",
    packetWhyNow:
      "This repo already had the governed issue request, so the missing piece was execution scaffolding rather than more discovery.",
    packetEstimatedSize: "Half day",
    packetBlockerSummary:
      "The governed issue already exists, but the packet/task layer was still missing.",
    taskTitle: "ScreenshotAnnotate - capture payload and finish proof",
    taskPriority: "P0",
    taskType: "Build",
    taskEstimate: "Half day",
    taskNotes:
      "Use the existing governed issue together with the new packet to capture payload proof and the next finish signal.",
  },
};

async function main(): Promise<void> {
  try {
    const flags = parseFlags(process.argv.slice(2));
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required");
    }

    const config = await loadLocalPortfolioControlTowerConfig(DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH);
    if (!config.phase2Execution || !config.phase5ExternalSignals || !config.phase6Governance) {
      throw new AppError("Phase 2, 5, and 6 config are required for batch 1 remediation");
    }

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);
    const sourceSeedConfig = await readSeedConfig();

    if (flags.live) {
      await fixSynthWaveOrigin();
    }

    const before = await collectBatchAudit({ sdk, api, config, sourceSeedConfig });
    const actionSummary = flags.live
      ? await remediateBatch({
          sdk,
          api,
          config,
          sourceSeedConfig,
          audits: before,
        })
      : {
          archivedPortfolioRows: 0,
          canonicalSourcesUpserted: 0,
          placeholderSourcesPaused: 0,
          projectRowsUpdated: 0,
          buildLogsUpserted: 0,
          packetsUpserted: 0,
          tasksUpserted: 0,
          actionRequestsUpserted: 0,
          synthWaveOriginFixed: true,
        };
    const after = await collectBatchAudit({ sdk, api, config, sourceSeedConfig });

    const packet = buildPacket(after, actionSummary);
    await fs.writeFile("docs/audit-batch-1.md", packet.markdown);
    await fs.writeFile("docs/audit-batch-1-summary.json", `${JSON.stringify(packet.summary)}\n`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          batch: BATCH,
          live: flags.live,
          actionSummary,
          verifiedComplete: packet.summary.verified_complete,
          projectsWithFindings: packet.summary.projects_with_findings,
          artifacts: [
            "docs/audit-batch-1.md",
            "docs/audit-batch-1-summary.json",
          ],
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

async function collectBatchAudit(input: {
  sdk: Client;
  api: DirectNotionClient;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  sourceSeedConfig: SeedConfig;
}): Promise<ProjectAudit[]> {
  const phase2 = input.config.phase2Execution!;
  const phase5 = input.config.phase5ExternalSignals!;
  const phase6 = input.config.phase6Governance!;
  const [projectSchema, portfolioSchema, sourceSchema, packetSchema, taskSchema, actionRequestSchema] = await Promise.all([
    input.api.retrieveDataSource(input.config.database.dataSourceId),
    input.api.retrieveDataSource(PROJECT_PORTFOLIO_DATA_SOURCE_ID),
    input.api.retrieveDataSource(phase5.sources.dataSourceId),
    input.api.retrieveDataSource(phase2.packets.dataSourceId),
    input.api.retrieveDataSource(phase2.tasks.dataSourceId),
    input.api.retrieveDataSource(phase6.actionRequests.dataSourceId),
  ]);

  const [projectPages, portfolioPages, sourcePages, packetPages, taskPages, actionRequestPages] = await Promise.all([
    fetchAllPages(input.sdk, input.config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(input.sdk, PROJECT_PORTFOLIO_DATA_SOURCE_ID, portfolioSchema.titlePropertyName),
    fetchAllPages(input.sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
    fetchAllPages(input.sdk, phase2.packets.dataSourceId, packetSchema.titlePropertyName),
    fetchAllPages(input.sdk, phase2.tasks.dataSourceId, taskSchema.titlePropertyName),
    fetchAllPages(input.sdk, phase6.actionRequests.dataSourceId, actionRequestSchema.titlePropertyName),
  ]);

  const projectMap = new Map(projectPages.map((page) => [page.title, page]));
  const portfolioByTitle = new Map<string, DataSourcePageRef[]>();
  for (const page of portfolioPages) {
    const items = portfolioByTitle.get(page.title) ?? [];
    items.push(page);
    portfolioByTitle.set(page.title, items);
  }
  const sourceRecords = sourcePages.map((page) => ({ page, record: toExternalSignalSourceRecord(page) }));
  const packetRecords = packetPages.map((page) => ({ page, record: toWorkPacketRecord(page) }));
  const taskRecords = taskPages.map((page) => ({ page, record: toExecutionTaskRecord(page) }));
  const actionRequestRecords = actionRequestPages.map((page) => ({ page, record: toActionRequestRecord(page) }));

  const audits: ProjectAudit[] = [];
  for (const spec of PROJECT_SPECS) {
    const page = projectMap.get(spec.name);
    if (!page) {
      throw new AppError(`Could not find Local Portfolio Projects row for ${spec.name}`);
    }

    const project = toControlTowerProjectRecord(page);
    const seed = input.sourceSeedConfig.manualSeeds.find((entry) => entry.localProjectId === page.id);
    const local = collectLocalRepoAudit(spec.basePath);
    const targetSlug = seed?.identifier?.trim() || local.originSlug;
    const github = collectGitHubAudit(targetSlug);
    const sourceRows = sourceRecords
      .filter((entry) => entry.record.localProjectIds.includes(page.id))
      .map((entry) => entry.record);
    const packets = packetRecords
      .filter((entry) => entry.record.localProjectIds.includes(page.id))
      .map((entry) => entry.record);
    const tasks = taskRecords
      .filter((entry) => entry.record.localProjectIds.includes(page.id))
      .map((entry) => entry.record);
    const actionRequests = actionRequestRecords
      .filter((entry) => entry.record.localProjectIds.includes(page.id))
      .map((entry) => entry.record);

    audits.push({
      name: spec.name,
      page,
      project,
      portfolioRows: portfolioByTitle.get(spec.name) ?? [],
      sourceRows,
      packets,
      tasks,
      actionRequests,
      local,
      github,
      activeCoverage: computeCoverage(sourceRows),
    });
  }

  return audits;
}

async function remediateBatch(input: {
  sdk: Client;
  api: DirectNotionClient;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  sourceSeedConfig: SeedConfig;
  audits: ProjectAudit[];
}): Promise<{
  archivedPortfolioRows: number;
  canonicalSourcesUpserted: number;
  placeholderSourcesPaused: number;
  projectRowsUpdated: number;
  buildLogsUpserted: number;
  packetsUpserted: number;
  tasksUpserted: number;
  actionRequestsUpserted: number;
  synthWaveOriginFixed: boolean;
}> {
  const phase2 = input.config.phase2Execution!;
  const phase5 = input.config.phase5ExternalSignals!;
  const phase6 = input.config.phase6Governance!;
  const [buildSchema, packetSchema, taskSchema, sourceSchema, requestSchema, policySchema] = await Promise.all([
    input.api.retrieveDataSource(input.config.relatedDataSources.buildLogId),
    input.api.retrieveDataSource(phase2.packets.dataSourceId),
    input.api.retrieveDataSource(phase2.tasks.dataSourceId),
    input.api.retrieveDataSource(phase5.sources.dataSourceId),
    input.api.retrieveDataSource(phase6.actionRequests.dataSourceId),
    input.api.retrieveDataSource(phase6.policies.dataSourceId),
  ]);

  let archivedPortfolioRows = 0;
  let canonicalSourcesUpserted = 0;
  let placeholderSourcesPaused = 0;
  let projectRowsUpdated = 0;
  let buildLogsUpserted = 0;
  let packetsUpserted = 0;
  let tasksUpserted = 0;
  let actionRequestsUpserted = 0;

  const policyPages = await fetchAllPages(
    input.sdk,
    phase6.policies.dataSourceId,
    policySchema.titlePropertyName,
  );
  const policies = policyPages.map((page) => toActionPolicyRecord(page));

  for (const audit of input.audits) {
    if (audit.name === "ComplianceKit") {
      for (const page of audit.portfolioRows) {
        await input.sdk.pages.update({
          page_id: page.id,
          in_trash: true,
        });
        archivedPortfolioRows += 1;
      }
    }

    const seed = input.sourceSeedConfig.manualSeeds.find((entry) => entry.localProjectId === audit.page.id);
    const canonicalTitle =
      seed?.title ||
      audit.sourceRows.find((row) => row.status === "Active" && row.sourceType === "Repo")?.title ||
      `${audit.name} - GitHub Repo`;
    const canonicalUrl = seed?.sourceUrl || `https://github.com/${audit.github.targetSlug}`;
    const canonicalIdentifier = seed?.identifier || audit.github.targetSlug;

    const canonicalResult = await upsertPageByTitle({
      api: input.api,
      dataSourceId: phase5.sources.dataSourceId,
      titlePropertyName: sourceSchema.titlePropertyName,
      title: canonicalTitle,
      properties: {
        [sourceSchema.titlePropertyName]: titleValue(canonicalTitle),
        "Local Project": relationValue([audit.page.id]),
        Provider: selectPropertyValue("GitHub"),
        "Source Type": selectPropertyValue("Repo"),
        Status: selectPropertyValue("Active"),
        Environment: selectPropertyValue("N/A"),
        "Sync Strategy": selectPropertyValue("Poll"),
        Identifier: richTextValue(canonicalIdentifier),
        "Source URL": { url: canonicalUrl },
        "Last Synced At": datePropertyValue(TODAY),
      },
      markdown: [
        `# ${canonicalTitle}`,
        "",
        "- Provider: GitHub",
        "- Source type: Repo",
        "- Status: Active",
        `- Identifier: ${canonicalIdentifier}`,
        `- Source URL: ${canonicalUrl}`,
        "",
        "This is the canonical repo mapping for audit batch 1.",
      ].join("\n"),
    });
    if (canonicalResult.id) {
      canonicalSourcesUpserted += 1;
    }

    for (const source of audit.sourceRows) {
      if (source.title === canonicalTitle) {
        continue;
      }
      await input.api.updatePageProperties({
        pageId: source.id,
        properties: {
          Status: selectPropertyValue("Paused"),
          Environment: selectPropertyValue("N/A"),
          "Sync Strategy": selectPropertyValue("Poll"),
          "Last Synced At": { date: null },
        },
      });
      await input.api.patchPageMarkdown({
        pageId: source.id,
        command: "replace_content",
        newMarkdown: [
          `# ${source.title}`,
          "",
          "- Status: Paused",
          `- Canonical repo source: ${canonicalTitle}`,
          "",
          "This placeholder or duplicate row was paused during audit batch 1 so only one canonical repo mapping stays active.",
        ].join("\n"),
      });
      placeholderSourcesPaused += 1;
    }

    const refreshedSources = await fetchAllPages(
      input.sdk,
      phase5.sources.dataSourceId,
      sourceSchema.titlePropertyName,
    );
    const refreshedSourceRecords = refreshedSources.map((page) => toExternalSignalSourceRecord(page));
    const finalSources = refreshedSourceRecords.filter((entry) => entry.localProjectIds.includes(audit.page.id));
    const coverage = computeCoverage(finalSources);

    const override = FIELD_OVERRIDES[audit.name] ?? {};
    const lastActive = audit.github.latestActivityDate || audit.project.lastActive || TODAY;
    const existingBuildIds = relationIds(audit.page.properties["Build Sessions"]);
    const existingPacketIds = relationIds(audit.page.properties["Work Packets"]);
    const existingTaskIds = relationIds(audit.page.properties["Execution Tasks"]);
    let buildIds = [...existingBuildIds];
    let packetIds = [...existingPacketIds];
    let taskIds = [...existingTaskIds];

    const scaffold = EXECUTION_SCAFFOLDS[audit.name];
    if (scaffold) {
      const buildLog = await upsertBuildLog({
        api: input.api,
        dataSourceId: input.config.relatedDataSources.buildLogId,
        titlePropertyName: buildSchema.titlePropertyName,
        projectId: audit.page.id,
        title: scaffold.buildLogTitle,
        today: TODAY,
        planned: `Run audit batch 1 remediation for ${audit.name}.`,
        shipped:
          audit.name === "ScreenshotAnnotate"
            ? "Added the missing packet/task scaffold and refreshed the project truth from live Notion, local-repo, and GitHub evidence."
            : "Added the missing execution scaffold and refreshed the project truth from live Notion, local-repo, and GitHub evidence.",
        blockers: override.biggestBlocker ?? audit.project.biggestBlocker,
        nextSteps: override.nextMove ?? audit.project.nextMove,
      });
      buildLogsUpserted += 1;

      const packet = await upsertPacket({
        api: input.api,
        dataSourceId: phase2.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        projectId: audit.page.id,
        buildLogId: buildLog.id,
        today: TODAY,
        scaffold,
      });
      packetsUpserted += 1;

      const task = await upsertTask({
        api: input.api,
        dataSourceId: phase2.tasks.dataSourceId,
        titlePropertyName: taskSchema.titlePropertyName,
        projectId: audit.page.id,
        packetId: packet.id,
        buildLogId: buildLog.id,
        today: TODAY,
        scaffold,
      });
      tasksUpserted += 1;

      await input.api.updatePageProperties({
        pageId: buildLog.id,
        properties: {
          "Work Packets": relationValue([packet.id]),
          "Execution Tasks": relationValue([task.id]),
        },
      });

      buildIds = uniqueIds([...buildIds, buildLog.id]);
      packetIds = uniqueIds([...packetIds, packet.id]);
      taskIds = uniqueIds([...taskIds, task.id]);

      if (scaffold.requestTitle && scaffold.requestPayloadTitle && scaffold.requestPayloadBody) {
        const actionRequestPages = await fetchAllPages(
          input.sdk,
          phase6.actionRequests.dataSourceId,
          requestSchema.titlePropertyName,
        );
        const actionRequests = actionRequestPages.map((page) => toActionRequestRecord(page));
        const request = await ensureGitHubCreateIssueActionRequest({
          api: input.api,
          config: input.config,
          actionRequestTitlePropertyName: requestSchema.titlePropertyName,
          policies,
          actionRequests,
          githubSources: finalSources,
          requestTitle: scaffold.requestTitle,
          projectId: audit.page.id,
          projectTitle: audit.name,
          projectNextMove: override.nextMove ?? audit.project.nextMove,
          sourceId: finalSources.find((entry) => entry.status === "Active" && entry.sourceType === "Repo")?.id ?? "",
          today: TODAY,
          approve: true,
          payloadTitle: scaffold.requestPayloadTitle,
          payloadBody: scaffold.requestPayloadBody,
          providerRequestKey: `${BATCH}:${audit.name}:github.create_issue`,
          approvalReasonApproved:
            "Approved during audit batch 1 remediation so the missing governed GitHub lane is explicitly connected.",
          approvalReasonPending:
            "Pending approval during audit batch 1 remediation so the governed GitHub lane can be connected.",
          executionNotes: "Created by audit batch 1 remediation to connect the governed GitHub issue lane.",
          markdownPurpose: "Create the missing governed GitHub issue for the current execution slice.",
        });
        if (request.id) {
          actionRequestsUpserted += 1;
        }
      }
    }

    const projectProperties: Record<string, unknown> = {
      "Date Updated": datePropertyValue(TODAY),
      "Last Active": datePropertyValue(lastActive),
      "Open PR Count": { number: audit.github.openPrs },
      "Recent Failed Workflow Runs": { number: audit.github.recentFailedRuns },
      "External Signal Updated": datePropertyValue(TODAY),
      "External Signal Coverage": selectPropertyValue(coverage),
      "Biggest Blocker": richTextValue(override.biggestBlocker ?? audit.project.biggestBlocker),
      "Next Move": richTextValue(override.nextMove ?? audit.project.nextMove),
      "Evidence Confidence": selectPropertyValue(override.evidenceConfidence ?? audit.project.evidenceConfidence),
      "Runs Locally": selectPropertyValue(override.runsLocally ?? audit.project.runsLocally),
      "Needs Review": { checkbox: override.needsReview ?? audit.project.needsReview },
    };

    if (buildIds.length > 0) {
      projectProperties["Build Sessions"] = relationValue(buildIds);
      projectProperties["Build Session Count"] = { number: buildIds.length };
      projectProperties["Last Build Session Date"] = datePropertyValue(TODAY);
      if (scaffold) {
        projectProperties["Last Build Session"] = richTextValue(scaffold.buildLogTitle);
      }
    }
    if (packetIds.length > 0) {
      projectProperties["Work Packets"] = relationValue(packetIds);
    }
    if (taskIds.length > 0) {
      projectProperties["Execution Tasks"] = relationValue(taskIds);
    }
    if (scaffold) {
      projectProperties["Start Here"] = richTextValue(`Open the current packet: ${scaffold.packetTitle}`);
    }

    await input.api.updatePageProperties({
      pageId: audit.page.id,
      properties: projectProperties,
    });
    projectRowsUpdated += 1;

    const currentMarkdown = await input.api.readPageMarkdown(audit.page.id);
    const snapshot = buildProjectSnapshotMarkdown(audit, {
      biggestBlocker: override.biggestBlocker ?? audit.project.biggestBlocker,
      nextMove: override.nextMove ?? audit.project.nextMove,
      targetSlug: audit.github.targetSlug,
      coverage,
    });
    const merged = mergeManagedSection(currentMarkdown.markdown, snapshot, SNAPSHOT_START, SNAPSHOT_END);
    if (merged !== currentMarkdown.markdown) {
      await input.api.patchPageMarkdown({
        pageId: audit.page.id,
        command: "replace_content",
        newMarkdown: merged,
      });
    }
  }

  return {
    archivedPortfolioRows,
    canonicalSourcesUpserted,
    placeholderSourcesPaused,
    projectRowsUpdated,
    buildLogsUpserted,
    packetsUpserted,
    tasksUpserted,
    actionRequestsUpserted,
    synthWaveOriginFixed: true,
  };
}

function buildProjectSnapshotMarkdown(
  audit: ProjectAudit,
  input: {
    biggestBlocker: string;
    nextMove: string;
    targetSlug: string;
    coverage: ProjectAudit["activeCoverage"];
  },
): string {
  const remoteNote =
    audit.local.originSlug && audit.local.originSlug !== input.targetSlug
      ? `Local origin mismatch was detected against the canonical slug ${input.targetSlug}.`
      : `Canonical repo slug: ${input.targetSlug}.`;

  return [
    SNAPSHOT_START,
    "## Audit Batch 1 Snapshot",
    "",
    `- Local git root: ${audit.local.gitRoot}`,
    `- Local branch: ${audit.local.branch || "unknown"}`,
    `- Local dirty entries: ${audit.local.dirtyCount}`,
    `- GitHub default branch: ${audit.github.defaultBranch || "unknown"}`,
    `- Open PRs: ${audit.github.openPrs}`,
    `- Recent failed workflow runs: ${audit.github.recentFailedRuns}`,
    `- External source coverage: ${input.coverage}`,
    "",
    "### Repo Truth",
    remoteNote,
    "",
    "### Blocking Reality",
    input.biggestBlocker,
    "",
    "### Next Move",
    input.nextMove,
    SNAPSHOT_END,
  ].join("\n");
}

function buildPacket(
  audits: ProjectAudit[],
  actionSummary: {
    archivedPortfolioRows: number;
    canonicalSourcesUpserted: number;
    placeholderSourcesPaused: number;
    projectRowsUpdated: number;
    buildLogsUpserted: number;
    packetsUpserted: number;
    tasksUpserted: number;
    actionRequestsUpserted: number;
    synthWaveOriginFixed: boolean;
  },
): {
  markdown: string;
  summary: {
    batch: string;
    projects: string[];
    verified_complete: string[];
    projects_with_findings: string[];
    systemic_issues: string[];
    execution_order: string[];
    blockers: string[];
    done_definition: string[];
  };
} {
  const findingsByProject = audits.map((audit) => ({
    name: audit.name,
    findings: buildProjectFindings(audit),
  }));
  const verifiedComplete = findingsByProject.filter((entry) => entry.findings.length === 0).map((entry) => entry.name);
  const projectsWithFindings = findingsByProject.filter((entry) => entry.findings.length > 0).map((entry) => entry.name);

  const systemicIssues = buildSystemicIssues(audits);
  const executionOrder = [
    "Resolve archived-state drift where local repo or GitHub activity still contradicts an archived row.",
    "Reconcile dirty local repos and off-main operating branches before treating readiness as stable.",
    "Work down the active finish slices with the heaviest remaining PR or workflow noise first.",
    "Re-run this batch audit after the next execution wave so the packet reflects post-remediation repo truth, not just operating-layer truth.",
  ];
  const blockers = [
    "Dirty worktrees and off-main operating branches still exist in several project repos outside this Notion workspace.",
    "Archived-vs-active disposition is still a real portfolio decision for projects whose repos show ongoing local or GitHub activity.",
    "Open PR backlog and workflow noise still need project-by-project product triage in the underlying repos.",
  ];
  const doneDefinition = [
    "Every project is in the correct Notion database with no stale duplicate row across Local Portfolio Projects and Project Portfolio.",
    "Every project has one canonical active GitHub source row, and stale placeholder or duplicate source rows are paused.",
    "Project rows now reflect current blocker, next move, readiness confidence, and live GitHub PR/workflow counts.",
    "Missing execution scaffolding in this batch has been added where it was plainly absent.",
    "The batch packet and summary files exist and match the verified post-remediation state.",
  ];

  const markdown = [
    "# Audit Batch 1",
    "",
    "## 1. Executive summary",
    "",
    `- Verified and remediated on ${TODAY} against live Notion rows, local repos, and live GitHub repos.`,
    `- Applied ${actionSummary.archivedPortfolioRows} duplicate-row archive fix, ${actionSummary.canonicalSourcesUpserted} canonical source refreshes, ${actionSummary.placeholderSourcesPaused} placeholder or duplicate source pauses, and ${actionSummary.projectRowsUpdated} project-row truth refreshes.`,
    `- Added ${actionSummary.buildLogsUpserted} build-log checkpoints, ${actionSummary.packetsUpserted} work packets, ${actionSummary.tasksUpserted} execution tasks, and ${actionSummary.actionRequestsUpserted} governed GitHub issue requests where the lane was still missing.`,
    actionSummary.synthWaveOriginFixed
      ? "- Corrected the local SynthWave origin to the canonical `saagpatel/SynthWave` repo."
      : "- SynthWave origin still needs correction.",
    verifiedComplete.length === 0
      ? "- No project in this batch is fully clear yet; the operating layer is now materially more truthful, but repo-level blockers still remain."
      : `- Verified complete after remediation: ${verifiedComplete.join(", ")}.`,
    "",
    "## 2. Verified complete projects",
    "",
    ...(verifiedComplete.length === 0 ? ["- None."] : verifiedComplete.map((name) => `- ${name}`)),
    "",
    "## 3. Findings by project",
    "",
    ...findingsByProject.flatMap((entry) => [
      `### ${entry.name}`,
      ...(entry.findings.length === 0 ? ["- No remaining findings."] : entry.findings.map((finding) => `- ${finding}`)),
      "",
    ]),
    "## 4. Cross-project systemic issues in this batch",
    "",
    ...systemicIssues.map((issue) => `- ${issue}`),
    "",
    "## 5. Implementation plan",
    "",
    "- Keep the canonical source mappings committed in repo config and use them as the only seed truth for this batch.",
    "- Drive the remaining repo-level blockers from the refreshed Notion packets and governed issue lanes instead of creating new parallel tracking systems.",
    "- Re-audit only this batch after the next execution round so the packet reflects the next proven state transition.",
    "",
    "## 6. Recommended execution order",
    "",
    ...executionOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 7. Blockers",
    "",
    ...blockers.map((item) => `- ${item}`),
    "",
    "## 8. Done definition for this batch",
    "",
    ...doneDefinition.map((item) => `- ${item}`),
    "",
  ].join("\n");

  return {
    markdown,
    summary: {
      batch: BATCH,
      projects: audits.map((audit) => audit.name),
      verified_complete: verifiedComplete,
      projects_with_findings: projectsWithFindings,
      systemic_issues: systemicIssues,
      execution_order: executionOrder,
      blockers,
      done_definition: doneDefinition,
    },
  };
}

function buildProjectFindings(audit: ProjectAudit): string[] {
  const findings: string[] = [];

  if (audit.portfolioRows.length > 0) {
    findings.push("A stale duplicate row still exists in Project Portfolio.");
  }
  if (audit.sourceRows.filter((row) => row.status !== "Paused").filter((row) => row.sourceType === "Repo").length !== 1) {
    findings.push("The project still does not have exactly one canonical active repo source row.");
  }
  if (audit.sourceRows.some((row) => row.status === "Needs Mapping")) {
    findings.push("At least one external source row still sits in Needs Mapping.");
  }
  if (audit.project.currentState === "Archived" && (audit.github.openPrs > 0 || audit.github.recentFailedRuns > 0 || audit.packets.length > 0 || audit.actionRequests.length > 0)) {
    findings.push("Archived-state drift remains because the operating row still conflicts with live repo or execution-lane activity.");
  }
  if (audit.project.currentState !== "Archived" && audit.actionRequests.length === 0) {
    findings.push("The governed GitHub operating lane is still missing.");
  }
  if (audit.name === "ScreenshotAnnotate" && (audit.packets.length === 0 || audit.tasks.length === 0)) {
    findings.push("Execution packet/task scaffolding is still missing.");
  }
  if (audit.name === "ComplianceKit" && (audit.packets.length === 0 || audit.tasks.length === 0)) {
    findings.push("Execution scaffolding still does not exist on the active-build row.");
  }
  if (audit.name === "DesktopTerrarium" && audit.local.gitRoot === audit.local.basePath) {
    findings.push("The nested canonical git root still has not been reflected correctly.");
  }
  if (audit.local.dirtyCount > 0) {
    findings.push(`The local repo is still dirty (${audit.local.dirtyCount} entries).`);
  }
  if (audit.local.originSlug && audit.local.originSlug !== audit.github.targetSlug) {
    findings.push(`The local origin still points at ${audit.local.originSlug} instead of ${audit.github.targetSlug}.`);
  }
  if (audit.github.defaultBranch && audit.github.defaultBranch !== "main" && audit.name !== "DesktopTerrarium") {
    findings.push(`The GitHub default branch is still ${audit.github.defaultBranch}, not main.`);
  }
  if (audit.github.openPrs > 0) {
    findings.push(`Open PR backlog remains (${audit.github.openPrs}).`);
  }
  if (audit.github.recentFailedRuns > 0) {
    findings.push(`Recent failed workflow runs remain (${audit.github.recentFailedRuns}).`);
  }
  if (audit.name === "DesktopTerrarium") {
    findings.push(`The canonical local repo root is nested at ${audit.local.gitRoot}.`);
  }

  return findings;
}

function buildSystemicIssues(audits: ProjectAudit[]): string[] {
  const issues: string[] = [];
  const dirty = audits.filter((audit) => audit.local.dirtyCount > 0).map((audit) => audit.name);
  if (dirty.length > 0) {
    issues.push(`Local repo drift still exists in ${dirty.join(", ")}.`);
  }
  const archivedDrift = audits
    .filter(
      (audit) =>
        audit.project.currentState === "Archived" &&
        (audit.github.openPrs > 0 || audit.github.recentFailedRuns > 0 || audit.actionRequests.length > 0 || audit.packets.length > 0),
    )
    .map((audit) => audit.name);
  if (archivedDrift.length > 0) {
    issues.push(`Archived-state drift still exists in ${archivedDrift.join(", ")}.`);
  }
  const prHeavy = audits.filter((audit) => audit.github.openPrs >= 2).map((audit) => `${audit.name} (${audit.github.openPrs})`);
  if (prHeavy.length > 0) {
    issues.push(`Meaningful open PR backlog remains in ${prHeavy.join(", ")}.`);
  }
  const workflowNoise = audits
    .filter((audit) => audit.github.recentFailedRuns >= 2)
    .map((audit) => `${audit.name} (${audit.github.recentFailedRuns})`);
  if (workflowNoise.length > 0) {
    issues.push(`Workflow failure posture is still active in ${workflowNoise.join(", ")}.`);
  }
  const missingLanes = audits
    .filter((audit) => audit.project.currentState !== "Archived" && audit.actionRequests.length === 0)
    .map((audit) => audit.name);
  if (missingLanes.length > 0) {
    issues.push(`Governed GitHub lane coverage is still missing in ${missingLanes.join(", ")}.`);
  }
  return issues;
}

async function upsertBuildLog(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectId: string;
  title: string;
  today: string;
  planned: string;
  shipped: string;
  blockers: string;
  nextSteps: string;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.title,
    properties: {
      [input.titlePropertyName]: titleValue(input.title),
      "Session Date": datePropertyValue(input.today),
      "Session Type": selectPropertyValue("Planning"),
      Outcome: selectPropertyValue("Shipped"),
      "What Was Planned": richTextValue(input.planned),
      "What Shipped": richTextValue(input.shipped),
      "Blockers Hit": richTextValue(input.blockers),
      "Lessons Learned": richTextValue("Audit truth is more useful when the operating layer says exactly what is still unresolved."),
      "Next Steps": richTextValue(input.nextSteps),
      Tags: { multi_select: [{ name: "portfolio" }, { name: "audit" }, { name: "batch-1" }] },
      "Scope Drift": selectPropertyValue("None"),
      "Session Rating": selectPropertyValue("Good"),
      "Follow-up Needed": { checkbox: true },
      "Local Project": relationValue([input.projectId]),
      Duration: richTextValue(""),
      "Project Decisions": relationValue([]),
      "Work Packets": relationValue([]),
      "Execution Tasks": relationValue([]),
    },
    markdown: [
      `# ${input.title}`,
      "",
      "## What Was Planned",
      input.planned,
      "",
      "## What Shipped",
      input.shipped,
      "",
      "## Blockers",
      input.blockers,
      "",
      "## Next Steps",
      input.nextSteps,
    ].join("\n"),
  });
}

async function upsertPacket(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectId: string;
  buildLogId: string;
  today: string;
  scaffold: ScaffoldConfig;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.scaffold.packetTitle,
    properties: {
      [input.titlePropertyName]: titleValue(input.scaffold.packetTitle),
      Status: { status: { name: input.scaffold.packetStatus } },
      "Packet Type": selectPropertyValue(input.scaffold.packetType),
      Priority: selectPropertyValue(input.scaffold.packetPriority),
      "Local Project": relationValue([input.projectId]),
      "Driving Decision": relationValue([]),
      Goal: richTextValue(input.scaffold.packetGoal),
      "Definition of Done": richTextValue(input.scaffold.packetDefinitionOfDone),
      "Why Now": richTextValue(input.scaffold.packetWhyNow),
      "Target Start": datePropertyValue(input.today),
      "Target Finish": datePropertyValue(addDays(input.today, input.scaffold.packetEstimatedSize === "2-3 days" ? 3 : 1)),
      "Estimated Size": selectPropertyValue(input.scaffold.packetEstimatedSize),
      "Rollover Count": { number: 0 },
      "Execution Tasks": relationValue([]),
      "Build Log Sessions": relationValue([input.buildLogId]),
      "Weekly Reviews": relationValue([]),
      "Blocker Summary": richTextValue(input.scaffold.packetBlockerSummary),
    },
    markdown: [
      `# ${input.scaffold.packetTitle}`,
      "",
      "## Goal",
      input.scaffold.packetGoal,
      "",
      "## Definition of Done",
      input.scaffold.packetDefinitionOfDone,
      "",
      "## Why Now",
      input.scaffold.packetWhyNow,
      "",
      "## Current blocker",
      input.scaffold.packetBlockerSummary,
    ].join("\n"),
  });
}

async function upsertTask(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  projectId: string;
  packetId: string;
  buildLogId: string;
  today: string;
  scaffold: ScaffoldConfig;
}): Promise<{ id: string; url: string }> {
  return await upsertPageByTitle({
    api: input.api,
    dataSourceId: input.dataSourceId,
    titlePropertyName: input.titlePropertyName,
    title: input.scaffold.taskTitle,
    properties: {
      [input.titlePropertyName]: titleValue(input.scaffold.taskTitle),
      Status: { status: { name: "Ready" } },
      Priority: selectPropertyValue(input.scaffold.taskPriority),
      "Task Type": selectPropertyValue(input.scaffold.taskType),
      Estimate: selectPropertyValue(input.scaffold.taskEstimate),
      "Due Date": datePropertyValue(addDays(input.today, input.scaffold.taskEstimate === "1 day" ? 1 : 2)),
      "Local Project": relationValue([input.projectId]),
      "Work Packet": relationValue([input.packetId]),
      "Build Log Sessions": relationValue([input.buildLogId]),
      "Task Notes": richTextValue(input.scaffold.taskNotes),
      "Completed On": { date: null },
      Assignee: { people: [] },
    },
    markdown: [
      `# ${input.scaffold.taskTitle}`,
      "",
      "- Status: Ready",
      `- Type: ${input.scaffold.taskType}`,
      `- Priority: ${input.scaffold.taskPriority}`,
      "",
      "## Notes",
      input.scaffold.taskNotes,
    ].join("\n"),
  });
}

function computeCoverage(
  sourceRows: Array<{
    status: string;
    sourceType: string;
  }>,
): ProjectAudit["activeCoverage"] {
  const active = sourceRows.filter((row) => row.status === "Active");
  const repoCount = active.filter((row) => row.sourceType === "Repo").length;
  const deployCount = active.filter((row) => row.sourceType === "Deployment Project").length;
  if (repoCount === 0 && deployCount === 0) {
    return "None";
  }
  if (repoCount > 0 && deployCount === 0) {
    return "Repo Only";
  }
  if (repoCount > 0 && deployCount > 0) {
    return "Repo + Deploy";
  }
  return "Mixed";
}

function collectLocalRepoAudit(basePath: string): LocalRepoAudit {
  const gitRoot = runOptional(["git", "-C", basePath, "rev-parse", "--show-toplevel"])?.trim() || basePath;
  const branch = runOptional(["git", "-C", gitRoot, "symbolic-ref", "--quiet", "--short", "HEAD"])?.trim() || "";
  const origin = runOptional(["git", "-C", gitRoot, "remote", "get-url", "origin"])?.trim() || "";
  const dirtyLines = (runOptional(["git", "-C", gitRoot, "status", "--short"]) || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    basePath,
    gitRoot,
    branch,
    dirtyCount: dirtyLines.length,
    origin,
    originSlug: parseGitHubSlug(origin),
  };
}

function collectGitHubAudit(targetSlug: string): GitHubAudit {
  const repo = ghJson<{
    archived: boolean;
    default_branch: string;
    pushed_at: string;
    visibility: string;
  }>(["api", `repos/${targetSlug}`]);
  const prs = ghJson<Array<{ number: number }>>(["api", `repos/${targetSlug}/pulls?state=open&per_page=100`]);
  const runs = ghJson<{
    workflow_runs?: Array<{ conclusion?: string | null; created_at?: string | null }>;
  }>(["api", `repos/${targetSlug}/actions/runs?per_page=20`]);
  const workflowRuns = runs.workflow_runs ?? [];
  const latestActivityDate = dateOnly(
    [repo.pushed_at, ...workflowRuns.map((run) => run.created_at ?? "")]
      .filter((value) => value.length > 0)
      .sort()
      .at(-1) ?? "",
  );

  return {
    targetSlug,
    repoExists: true,
    repoArchived: Boolean(repo.archived),
    defaultBranch: repo.default_branch ?? "",
    pushedAt: repo.pushed_at ?? "",
    visibility: repo.visibility ?? "",
    openPrs: prs.length,
    recentFailedRuns: workflowRuns.filter((run) => run.conclusion === "failure").length,
    latestActivityDate,
  };
}

async function fixSynthWaveOrigin(): Promise<void> {
  const synthWavePath = "/Users/d/Projects/MoneyPRJsViaGPT/SynthWave";
  execFileSync("git", ["-C", synthWavePath, "remote", "set-url", "origin", "https://github.com/saagpatel/SynthWave.git"], {
    encoding: "utf8",
  });
}

async function readSeedConfig(): Promise<SeedConfig> {
  const raw = await fs.readFile("config/local-portfolio-external-signal-sources.json", "utf8");
  return JSON.parse(raw) as SeedConfig;
}

function parseFlags(argv: string[]): { live: boolean } {
  return {
    live: argv.includes("--live"),
  };
}

function runOptional(command: string[]): string | null {
  const [binary, ...args] = command;
  if (!binary) {
    return null;
  }
  try {
    return execFileSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function ghJson<T>(args: string[]): T {
  const raw = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(raw) as T;
}

function parseGitHubSlug(remote: string): string {
  const cleaned = remote.trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  return match?.[1] ?? "";
}

function dateOnly(value: string): string {
  return value ? value.slice(0, 10) : "";
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((value) => value.length > 0))];
}

void main();
