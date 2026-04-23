import "../../config/load-default-env.js";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createNotionSdkClient } from "../../notion/notion-sdk.js";

import { recordCommandOutputSummary } from "../../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../../cli/context.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import {
  dateValue,
  fetchAllPages,
  relationIds,
  type DataSourcePageRef,
} from "../../notion/local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();
const DEFAULT_STALE_SUPPORT_CLASSIFICATION_PATH = "config/stale-support-classifications.json";

type SupportKind = "research" | "skill" | "tool";
type CandidateClassification = "actionable" | "intentional_single_project";

interface Flags {
  today: string;
  config: string;
  limit: number;
  weakProjectThreshold: number;
  classificationConfig: string;
}

interface Candidate {
  kind: SupportKind;
  title: string;
  id: string;
  url: string;
  linkedProjectCount: number;
  linkedProjectTitles: string[];
  reviewReason: string;
  freshnessDate: string;
  classification: CandidateClassification;
  classificationReason: string;
}

interface ClassificationEntries {
  research: Record<string, string>;
  skill: Record<string, string>;
  tool: Record<string, string>;
}

function parseFlags(argv: string[]): Flags {
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let limit = 25;
  let weakProjectThreshold = 1;
  let classificationConfig = DEFAULT_STALE_SUPPORT_CLASSIFICATION_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
      continue;
    }
    if (current === "--config") {
      config = argv[index + 1] ?? config;
      index += 1;
      continue;
    }
    if (current === "--limit") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new AppError("Expected a numeric value after --limit");
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new AppError(`Invalid --limit value "${raw}"`);
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (current === "--weak-project-threshold") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new AppError("Expected a numeric value after --weak-project-threshold");
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new AppError(`Invalid --weak-project-threshold value "${raw}"`);
      }
      weakProjectThreshold = parsed;
      index += 1;
      continue;
    }
    if (current === "--classification-config") {
      classificationConfig = argv[index + 1] ?? classificationConfig;
      index += 1;
    }
  }

  return { today, config, limit, weakProjectThreshold, classificationConfig };
}

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (shouldShowHelp(argv)) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:stale-support-audit --",
          description: "Review stale or weakly linked support rows before cleanup.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--today <date>", description: "Override the date anchor in YYYY-MM-DD format." },
            { flag: "--config <path>", description: "Path to the control-tower config file." },
            { flag: "--limit <count>", description: "Maximum candidates to return. Defaults to 25." },
            { flag: "--weak-project-threshold <count>", description: "Project-link threshold for weak support. Defaults to 1." },
            { flag: "--classification-config <path>", description: "Path to the stale-support classification config file." },
          ],
        }),
      );
      return;
    }

    const output = await runStaleSupportAudit(parseFlags(argv));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runStaleSupportAudit(flags: Flags): Promise<Record<string, unknown>> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for the stale support audit");
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const classificationEntries = await loadClassificationEntries(flags.classificationConfig);
  const sdk = createNotionSdkClient(token);
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

  const projectById = new Map(projectPages.map((page) => [page.id, page]));
  const candidates = [
    ...collectCandidates("research", researchPages, projectById, flags.weakProjectThreshold, classificationEntries),
    ...collectCandidates("skill", skillPages, projectById, flags.weakProjectThreshold, classificationEntries),
    ...collectCandidates("tool", toolPages, projectById, flags.weakProjectThreshold, classificationEntries),
  ];
  candidates.sort(compareCandidates);

  const orphaned = candidates.filter((candidate) => candidate.linkedProjectCount === 0);
  const weak = candidates.filter(
    (candidate) =>
      candidate.linkedProjectCount > 0 && candidate.linkedProjectCount <= flags.weakProjectThreshold,
  );
  const actionable = candidates.filter((candidate) => candidate.classification === "actionable");
  const intentionalSingleProject = candidates.filter(
    (candidate) => candidate.classification === "intentional_single_project",
  );

  return {
    ok: true,
    live: false,
    today: flags.today,
    weakProjectThreshold: flags.weakProjectThreshold,
    classificationConfig: flags.classificationConfig,
    totalCandidates: candidates.length,
    orphanedCount: orphaned.length,
    weakCount: weak.length,
    actionableCount: actionable.length,
    intentionalSingleProjectCount: intentionalSingleProject.length,
    countsByKind: summarizeByKind(candidates),
    countsByClassification: {
      actionable: actionable.length,
      intentionalSingleProject: intentionalSingleProject.length,
    },
    reviewQueue: candidates.slice(0, flags.limit),
    actionableReviewQueue: actionable.slice(0, flags.limit),
    intentionalSingleProjectQueue: intentionalSingleProject.slice(0, flags.limit),
  };
}

function collectCandidates(
  kind: SupportKind,
  pages: DataSourcePageRef[],
  projectById: Map<string, DataSourcePageRef>,
  weakProjectThreshold: number,
  classificationEntries: ClassificationEntries,
): Candidate[] {
  return pages
    .map((page) => {
      const linkedProjectIds = relationIds(page.properties[projectRelationProperty(kind)]);
      const linkedProjectTitles = linkedProjectIds
        .map((projectId) => projectById.get(projectId)?.title ?? projectId)
        .sort((left, right) => left.localeCompare(right));
      const classification = classifyCandidate(kind, page.title, linkedProjectIds.length, classificationEntries);
      return {
        kind,
        title: page.title,
        id: page.id,
        url: page.url,
        linkedProjectCount: linkedProjectIds.length,
        linkedProjectTitles,
        reviewReason:
          linkedProjectIds.length === 0
            ? "No linked local projects"
            : `Only linked to ${linkedProjectIds.length} local project${linkedProjectIds.length === 1 ? "" : "s"}`,
        freshnessDate: supportFreshnessDate(kind, page),
        classification,
        classificationReason: classificationReason(kind, page.title, classificationEntries),
      };
    })
    .filter((candidate) => candidate.linkedProjectCount <= weakProjectThreshold);
}

function projectRelationProperty(kind: SupportKind): string {
  switch (kind) {
    case "research":
      return "Related Local Projects";
    case "skill":
      return "Related Local Projects";
    case "tool":
      return "Linked Local Projects";
  }
}

function supportFreshnessDate(kind: SupportKind, page: DataSourcePageRef): string {
  if (kind === "research") {
    return (
      dateValue(page.properties["Last Verified"]) ||
      dateValue(page.properties["Date Researched"]) ||
      page.createdTime?.slice(0, 10) ||
      ""
    );
  }
  if (kind === "skill") {
    return dateValue(page.properties["Last Practiced"]) || page.createdTime?.slice(0, 10) || "";
  }
  return (
    dateValue(page.properties["Last Reviewed"]) ||
    dateValue(page.properties["Date First Used"]) ||
    page.createdTime?.slice(0, 10) ||
    ""
  );
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const classificationRank = compareClassification(left.classification, right.classification);
  if (classificationRank !== 0) {
    return classificationRank;
  }
  if (left.linkedProjectCount !== right.linkedProjectCount) {
    return left.linkedProjectCount - right.linkedProjectCount;
  }
  const leftFreshness = left.freshnessDate || "9999-12-31";
  const rightFreshness = right.freshnessDate || "9999-12-31";
  if (leftFreshness !== rightFreshness) {
    return leftFreshness.localeCompare(rightFreshness);
  }
  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }
  return left.title.localeCompare(right.title);
}

function summarizeByKind(
  candidates: Candidate[],
): Record<
  SupportKind,
  { total: number; orphaned: number; weak: number; actionable: number; intentionalSingleProject: number }
> {
  return {
    research: summarizeKind("research", candidates),
    skill: summarizeKind("skill", candidates),
    tool: summarizeKind("tool", candidates),
  };
}

function summarizeKind(
  kind: SupportKind,
  candidates: Candidate[],
): { total: number; orphaned: number; weak: number; actionable: number; intentionalSingleProject: number } {
  const rows = candidates.filter((candidate) => candidate.kind === kind);
  return {
    total: rows.length,
    orphaned: rows.filter((candidate) => candidate.linkedProjectCount === 0).length,
    weak: rows.filter((candidate) => candidate.linkedProjectCount > 0).length,
    actionable: rows.filter((candidate) => candidate.classification === "actionable").length,
    intentionalSingleProject: rows.filter((candidate) => candidate.classification === "intentional_single_project").length,
  };
}

async function loadClassificationEntries(configPath: string): Promise<ClassificationEntries> {
  const raw = await readFile(resolve(process.cwd(), configPath), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    research: toStringMap(parsed.research),
    skill: toStringMap(parsed.skill),
    tool: toStringMap(parsed.tool),
  };
}

function toStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function classifyCandidate(
  kind: SupportKind,
  title: string,
  linkedProjectCount: number,
  classificationEntries: ClassificationEntries,
): CandidateClassification {
  if (linkedProjectCount > 0 && classificationEntries[kind][title]) {
    return "intentional_single_project";
  }
  return "actionable";
}

function classificationReason(
  kind: SupportKind,
  title: string,
  classificationEntries: ClassificationEntries,
): string {
  return classificationEntries[kind][title] ?? "Needs review for possible reuse, merge, or cleanup.";
}

function compareClassification(left: CandidateClassification, right: CandidateClassification): number {
  const rank = (value: CandidateClassification): number =>
    value === "actionable" ? 0 : 1;
  return rank(left) - rank(right);
}

if (process.argv[1]?.endsWith("stale-support-audit.ts")) {
  void main();
}
