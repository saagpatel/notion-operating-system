import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  relationIds,
  selectValue,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();

type SupportKind = "research" | "skill" | "tool";

interface Flags {
  today: string;
  config: string;
  limit: number;
  minimumTotalSupport: number;
}

interface CoverageCandidate {
  projectTitle: string;
  projectId: string;
  url: string;
  operatingQueue: string;
  currentState: string;
  totalSupport: number;
  relatedResearchCount: number;
  supportingSkillsCount: number;
  linkedToolCount: number;
  missingCategories: string[];
  reverseBackfillCounts: {
    research: number;
    skills: number;
    tools: number;
  };
  reverseBackfillTitles: {
    research: string[];
    skills: string[];
    tools: string[];
  };
  score: number;
}

function parseFlags(argv: string[]): Flags {
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let limit = 25;
  let minimumTotalSupport = 3;

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
    if (current === "--minimum-total-support") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new AppError("Expected a numeric value after --minimum-total-support");
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new AppError(`Invalid --minimum-total-support value "${raw}"`);
      }
      minimumTotalSupport = parsed;
      index += 1;
    }
  }

  return { today, config, limit, minimumTotalSupport };
}

async function main(): Promise<void> {
  try {
    const output = await runProjectSupportCoverageAudit(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runProjectSupportCoverageAudit(flags: Flags): Promise<Record<string, unknown>> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for the project support coverage audit");
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
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

  const reverseResearch = buildReverseSupportMap("research", researchPages);
  const reverseSkills = buildReverseSupportMap("skill", skillPages);
  const reverseTools = buildReverseSupportMap("tool", toolPages);

  const candidates = projectPages
    .map((page) =>
      buildCoverageCandidate({
        page,
        minimumTotalSupport: flags.minimumTotalSupport,
        reverseResearch,
        reverseSkills,
        reverseTools,
      }),
    )
    .filter((candidate): candidate is CoverageCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.projectTitle.localeCompare(right.projectTitle);
    });

  return {
    ok: true,
    live: false,
    today: flags.today,
    minimumTotalSupport: flags.minimumTotalSupport,
    totalCandidates: candidates.length,
    missingCategoryCount: candidates.filter((candidate) => candidate.missingCategories.length > 0).length,
    reverseBackfillReadyCount: candidates.filter(
      (candidate) =>
        candidate.reverseBackfillCounts.research +
          candidate.reverseBackfillCounts.skills +
          candidate.reverseBackfillCounts.tools >
        0,
    ).length,
    reviewQueue: candidates.slice(0, flags.limit),
  };
}

function buildReverseSupportMap(
  kind: SupportKind,
  pages: DataSourcePageRef[],
): Map<string, Array<{ id: string; title: string }>> {
  const result = new Map<string, Array<{ id: string; title: string }>>();
  for (const page of pages) {
    for (const projectId of relationIds(page.properties[projectRelationProperty(kind)])) {
      const existing = result.get(projectId) ?? [];
      existing.push({ id: page.id, title: page.title });
      result.set(projectId, existing);
    }
  }
  return result;
}

function buildCoverageCandidate(input: {
  page: DataSourcePageRef;
  minimumTotalSupport: number;
  reverseResearch: Map<string, Array<{ id: string; title: string }>>;
  reverseSkills: Map<string, Array<{ id: string; title: string }>>;
  reverseTools: Map<string, Array<{ id: string; title: string }>>;
}): CoverageCandidate | null {
  const directResearchIds = relationIds(input.page.properties["Related Research"]);
  const directSkillIds = relationIds(input.page.properties["Supporting Skills"]);
  const directToolIds = relationIds(input.page.properties["Tool Stack Records"]);
  const reverseResearch = input.reverseResearch.get(input.page.id) ?? [];
  const reverseSkills = input.reverseSkills.get(input.page.id) ?? [];
  const reverseTools = input.reverseTools.get(input.page.id) ?? [];
  const missingCategories = [
    ...(directResearchIds.length === 0 ? ["Related Research"] : []),
    ...(directSkillIds.length === 0 ? ["Supporting Skills"] : []),
    ...(directToolIds.length === 0 ? ["Tool Stack Records"] : []),
  ];
  const reverseBackfillTitles = {
    research: reverseResearch.filter((row) => !directResearchIds.includes(row.id)).map((row) => row.title),
    skills: reverseSkills.filter((row) => !directSkillIds.includes(row.id)).map((row) => row.title),
    tools: reverseTools.filter((row) => !directToolIds.includes(row.id)).map((row) => row.title),
  };
  const reverseBackfillCounts = {
    research: reverseBackfillTitles.research.length,
    skills: reverseBackfillTitles.skills.length,
    tools: reverseBackfillTitles.tools.length,
  };
  const totalSupport = directResearchIds.length + directSkillIds.length + directToolIds.length;
  const score =
    missingCategories.length * 100 +
    Math.max(0, input.minimumTotalSupport - totalSupport) * 20 +
    (reverseBackfillCounts.research + reverseBackfillCounts.skills + reverseBackfillCounts.tools) * 15 +
    operatingQueueWeight(selectValue(input.page.properties["Operating Queue"]));

  if (
    missingCategories.length === 0 &&
    totalSupport >= input.minimumTotalSupport &&
    reverseBackfillCounts.research + reverseBackfillCounts.skills + reverseBackfillCounts.tools === 0
  ) {
    return null;
  }

  return {
    projectTitle: input.page.title,
    projectId: input.page.id,
    url: input.page.url,
    operatingQueue: selectValue(input.page.properties["Operating Queue"]),
    currentState: selectValue(input.page.properties["Current State"]),
    totalSupport,
    relatedResearchCount: directResearchIds.length,
    supportingSkillsCount: directSkillIds.length,
    linkedToolCount: directToolIds.length,
    missingCategories,
    reverseBackfillCounts,
    reverseBackfillTitles,
    score,
  };
}

function operatingQueueWeight(value: string): number {
  switch (value) {
    case "Resume Now":
      return 25;
    case "Worth Finishing":
      return 20;
    case "Needs Review":
      return 15;
    case "Needs Decision":
      return 15;
    case "Shipped":
      return 5;
    case "Watch":
      return 3;
    default:
      return 0;
  }
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

if (process.argv[1]?.endsWith("project-support-coverage-audit.ts")) {
  void main();
}
