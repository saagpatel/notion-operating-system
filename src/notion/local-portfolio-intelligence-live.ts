import { Client } from "@notionhq/client";

import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import type {
  IntelligenceProjectRecord,
  LinkSuggestionRecord,
  RecommendationRunRecord,
  ResearchLibraryRecord,
  SkillLibraryRecord,
  ToolMatrixRecord,
} from "./local-portfolio-intelligence.js";
import type { DataSourcePageRef, NotionPageProperty } from "./local-portfolio-control-tower-live.js";
import { extractNotionIdFromUrl, normalizeNotionId } from "../utils/notion-id.js";
import { AppError } from "../utils/errors.js";
import {
  checkboxValue,
  dateValue,
  numberValue,
  relationIds,
  selectValue,
  textValue,
} from "./local-portfolio-control-tower-live.js";

export async function ensurePhase3IntelligenceSchema(
  sdk: Client,
  config: LocalPortfolioControlTowerConfig,
): Promise<LocalPortfolioControlTowerConfig> {
  const recommendationRuns = await ensureDataSourceRef({
    sdk,
    existing: config.phase3Intelligence?.recommendationRuns,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "Recommendation Runs",
    titlePropertyName: "Name",
    destinationAlias: "recommendation_runs",
  });
  const linkSuggestions = await ensureDataSourceRef({
    sdk,
    existing: config.phase3Intelligence?.linkSuggestions,
    parentPageUrl: config.commandCenter.parentPageUrl,
    title: "Link Suggestions",
    titlePropertyName: "Name",
    destinationAlias: "link_suggestions",
  });

  await Promise.all([
    sdk.request({
      path: `data_sources/${config.database.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Recommendation Lane": {
            select: {
              options: colorize([
                ["Resume", "green"],
                ["Finish", "blue"],
                ["Investigate", "orange"],
                ["Defer", "gray"],
                ["Monitor", "default"],
              ]),
            },
          },
          "Recommendation Score": { number: { format: "number" } },
          "Recommendation Confidence": {
            select: {
              options: colorize([
                ["High", "green"],
                ["Medium", "orange"],
                ["Low", "red"],
              ]),
            },
          },
          "Recommendation Updated": { date: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${recommendationRuns.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          "Run Date": { date: {} },
          "Run Type": {
            select: {
              options: colorize([
                ["Weekly Portfolio", "blue"],
                ["Daily Focus", "green"],
                ["Ad Hoc", "gray"],
              ]),
            },
          },
          Status: {
            select: {
              options: colorize([
                ["Draft", "gray"],
                ["Published", "green"],
                ["Superseded", "orange"],
              ]),
            },
          },
          "Model Version": { rich_text: {} },
          "Top Resume Project": { relation: relationSchema(config.database.dataSourceId) },
          "Top Finish Project": { relation: relationSchema(config.database.dataSourceId) },
          "Top Investigate Project": { relation: relationSchema(config.database.dataSourceId) },
          "Top Defer Project": { relation: relationSchema(config.database.dataSourceId) },
          "Projects Mentioned": {
            relation: dualRelationSchema(config.database.dataSourceId, "Recommendation Runs"),
          },
          "Weekly Review": {
            relation: dualRelationSchema(config.relatedDataSources.weeklyReviewsId, "Recommendation Runs"),
          },
          Supersedes: { relation: relationSchema(recommendationRuns.dataSourceId) },
          Reviewer: { people: {} },
          "Reviewed On": { date: {} },
          Summary: { rich_text: {} },
        },
      },
    }),
    sdk.request({
      path: `data_sources/${linkSuggestions.dataSourceId}`,
      method: "patch",
      body: {
        properties: {
          Status: {
            select: {
              options: colorize([
                ["Proposed", "orange"],
                ["Accepted", "green"],
                ["Rejected", "red"],
                ["Superseded", "gray"],
              ]),
            },
          },
          "Suggestion Type": {
            select: {
              options: colorize([
                ["Project->Research", "blue"],
                ["Project->Skill", "green"],
                ["Project->Tool", "purple"],
              ]),
            },
          },
          "Local Project": { relation: relationSchema(config.database.dataSourceId) },
          "Suggested Research": { relation: relationSchema(config.relatedDataSources.researchId) },
          "Suggested Skill": { relation: relationSchema(config.relatedDataSources.skillsId) },
          "Suggested Tool": { relation: relationSchema(config.relatedDataSources.toolsId) },
          "Confidence Score": { number: { format: "number_with_commas" } },
          "Match Reasons": { rich_text: {} },
          "Suggested In Run": { relation: relationSchema(recommendationRuns.dataSourceId) },
          "Review Notes": { rich_text: {} },
          Supersedes: { relation: relationSchema(linkSuggestions.dataSourceId) },
        },
      },
    }),
  ]);

  const derived = new Set(config.fieldOwnership.derived);
  derived.add("Recommendation Lane");
  derived.add("Recommendation Score");
  derived.add("Recommendation Confidence");
  derived.add("Recommendation Updated");

  return {
    ...config,
    fieldOwnership: {
      ...config.fieldOwnership,
      derived: [...derived],
    },
    phase3Intelligence: {
      recommendationRuns,
      linkSuggestions,
      scoringModelVersion: config.phase3Intelligence?.scoringModelVersion ?? "balanced-hybrid-v1",
      cadence: config.phase3Intelligence?.cadence ?? {
        weeklyCanonical: true,
        dailyDrillDown: true,
      },
      confidenceThresholds: config.phase3Intelligence?.confidenceThresholds ?? {
        highSupportDensity: 8,
        suggestionMinimum: 0.7,
      },
      reviewRequirements: config.phase3Intelligence?.reviewRequirements ?? {
        weeklyRequiresHumanReview: true,
      },
      viewIds: config.phase3Intelligence?.viewIds ?? {
        projects: {},
        recommendationRuns: {},
        linkSuggestions: {},
      },
      phaseMemory: config.phase3Intelligence?.phaseMemory ?? {
        phase1GaveUs:
          "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
        phase2Added:
          "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
        phase3Added:
          "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
        phase4Brief:
          "Phase 4 will evaluate premium-native Notion overlays such as dashboards, reminder automations, synced databases, and custom agents only after the phase-3 recommendation engine is stable, trusted, and worth augmenting.",
        phase5Brief:
          "Phase 5 will bring in external signals such as repo, deploy, calendar, or workflow telemetry so recommendations can incorporate real execution evidence beyond Notion records.",
      },
      baselineCapturedAt: config.phase3Intelligence?.baselineCapturedAt,
      baselineMetrics: config.phase3Intelligence?.baselineMetrics,
      lastSyncAt: config.phase3Intelligence?.lastSyncAt,
      lastSyncMetrics: config.phase3Intelligence?.lastSyncMetrics,
    },
  };
}

export function toIntelligenceProjectRecord(page: DataSourcePageRef): IntelligenceProjectRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    currentState: selectValue(page.properties["Current State"]),
    portfolioCall: selectValue(page.properties["Portfolio Call"]),
    momentum: selectValue(page.properties.Momentum),
    needsReview: checkboxValue(page.properties["Needs Review"]),
    nextMove: textValue(page.properties["Next Move"]),
    biggestBlocker: textValue(page.properties["Biggest Blocker"]),
    lastActive: dateValue(page.properties["Last Active"]),
    dateUpdated: dateValue(page.properties["Date Updated"]),
    lastBuildSessionDate: dateValue(page.properties["Last Build Session Date"]),
    buildSessionCount: numberValue(page.properties["Build Session Count"]),
    relatedResearchCount: numberValue(page.properties["Related Research Count"]),
    supportingSkillsCount: numberValue(page.properties["Supporting Skills Count"]),
    linkedToolCount: numberValue(page.properties["Linked Tool Count"]),
    setupFriction: selectValue(page.properties["Setup Friction"]),
    runsLocally: selectValue(page.properties["Runs Locally"]),
    buildMaturity: selectValue(page.properties["Build Maturity"]),
    shipReadiness: selectValue(page.properties["Ship Readiness"]),
    effortToDemo: selectValue(page.properties["Effort to Demo"]),
    effortToShip: selectValue(page.properties["Effort to Ship"]),
    oneLinePitch: textValue(page.properties["One-Line Pitch"]),
    valueOutcome: textValue(page.properties["Value / Outcome"]),
    monetizationValue: textValue(page.properties["Monetization / Strategic Value"]),
    evidenceConfidence: selectValue(page.properties["Evidence Confidence"]),
    docsQuality: selectValue(page.properties["Docs Quality"]),
    testPosture: selectValue(page.properties["Test Posture"]),
    category: selectValue(page.properties.Category),
    operatingQueue: selectValue(page.properties["Operating Queue"]) as IntelligenceProjectRecord["operatingQueue"],
    nextReviewDate: dateValue(page.properties["Next Review Date"]),
    evidenceFreshness: selectValue(page.properties["Evidence Freshness"]) as IntelligenceProjectRecord["evidenceFreshness"],
    relatedResearchIds: relationIds(page.properties["Related Research"]),
    supportingSkillIds: relationIds(page.properties["Supporting Skills"]),
    toolStackIds: relationIds(page.properties["Tool Stack Records"]),
    recommendationRunIds: relationIds(page.properties["Recommendation Runs"]),
    projectShape: multiSelectNames(page.properties["Project Shape"]),
    deploymentSurface: multiSelectNames(page.properties["Deployment Surface"]),
    primaryTool: textValue(page.properties["Primary Tool"]),
    externalSignalCoverage: selectValue(page.properties["External Signal Coverage"]) as IntelligenceProjectRecord["externalSignalCoverage"],
    latestExternalActivity: dateValue(page.properties["Latest External Activity"]),
    latestDeploymentStatus: selectValue(page.properties["Latest Deployment Status"]) as IntelligenceProjectRecord["latestDeploymentStatus"],
    openPrCount: readNumber(page.properties["Open PR Count"]),
    recentFailedWorkflowRuns: readNumber(page.properties["Recent Failed Workflow Runs"]),
    externalSignalUpdated: dateValue(page.properties["External Signal Updated"]),
    recommendationLane: selectValue(page.properties["Recommendation Lane"]) as IntelligenceProjectRecord["recommendationLane"],
    recommendationScore: readNumber(page.properties["Recommendation Score"]),
    recommendationConfidence: selectValue(page.properties["Recommendation Confidence"]) as IntelligenceProjectRecord["recommendationConfidence"],
    recommendationUpdated: dateValue(page.properties["Recommendation Updated"]),
  };
}

export function toResearchLibraryRecord(page: DataSourcePageRef): ResearchLibraryRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    category: selectValue(page.properties.Category),
    tags: multiSelectNames(page.properties.Tags),
    actionable: checkboxOrSelect(page.properties.Actionable),
    confidence: selectValue(page.properties.Confidence),
    decisionImpact: selectValue(page.properties["Decision Impact"]),
    lastVerified: dateValue(page.properties["Last Verified"]),
    dateResearched: dateValue(page.properties["Date Researched"]),
    relatedProjectIds: relationIds(page.properties["Related Local Projects"]),
  };
}

export function toSkillLibraryRecord(page: DataSourcePageRef): SkillLibraryRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    category: selectValue(page.properties.Category),
    proficiency: selectValue(page.properties.Proficiency),
    status: selectValue(page.properties.Status),
    projectRelevance: selectValue(page.properties["Project Relevance"]),
    lastPracticed: dateValue(page.properties["Last Practiced"]),
    relatedProjectIds: relationIds(page.properties["Related Local Projects"]),
  };
}

export function toToolMatrixRecord(page: DataSourcePageRef): ToolMatrixRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    category: selectValue(page.properties.Category),
    status: selectValue(page.properties.Status),
    myRole: selectValue(page.properties["My Role"]),
    stackIntegration: selectValue(page.properties["Stack Integration"]),
    utilityScore: numberValue(page.properties["Utility Score"]),
    delightScore: numberValue(page.properties["Delight Score"]),
    lastReviewed: dateValue(page.properties["Last Reviewed"]),
    tags: multiSelectNames(page.properties.Tags),
    linkedProjectIds: relationIds(page.properties["Linked Local Projects"]),
  };
}

export function toRecommendationRunRecord(page: DataSourcePageRef): RecommendationRunRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    runDate: dateValue(page.properties["Run Date"]),
    runType: selectValue(page.properties["Run Type"]),
    status: selectValue(page.properties.Status),
    modelVersion: textValue(page.properties["Model Version"]),
    topResumeProjectIds: relationIds(page.properties["Top Resume Project"]),
    topFinishProjectIds: relationIds(page.properties["Top Finish Project"]),
    topInvestigateProjectIds: relationIds(page.properties["Top Investigate Project"]),
    topDeferProjectIds: relationIds(page.properties["Top Defer Project"]),
    weeklyReviewIds: relationIds(page.properties["Weekly Review"]),
    supersedesIds: relationIds(page.properties.Supersedes),
    reviewerIds: peopleIds(page.properties.Reviewer),
    reviewedOn: dateValue(page.properties["Reviewed On"]),
    summary: textValue(page.properties.Summary),
    referencedProjectIds: relationIds(page.properties["Projects Mentioned"]),
  };
}

export function toLinkSuggestionRecord(page: DataSourcePageRef): LinkSuggestionRecord {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    status: selectValue(page.properties.Status),
    suggestionType: selectValue(page.properties["Suggestion Type"]) as LinkSuggestionRecord["suggestionType"],
    localProjectIds: relationIds(page.properties["Local Project"]),
    suggestedResearchIds: relationIds(page.properties["Suggested Research"]),
    suggestedSkillIds: relationIds(page.properties["Suggested Skill"]),
    suggestedToolIds: relationIds(page.properties["Suggested Tool"]),
    confidenceScore: readNumber(page.properties["Confidence Score"]) ?? 0,
    matchReasons: textValue(page.properties["Match Reasons"]),
    suggestedInRunIds: relationIds(page.properties["Suggested In Run"]),
    reviewNotes: textValue(page.properties["Review Notes"]),
    supersedesIds: relationIds(page.properties.Supersedes),
  };
}

function peopleIds(property?: NotionPageProperty): string[] {
  return Array.isArray(property?.people)
    ? property.people
        .map((person) => (typeof person?.id === "string" ? normalizeNotionId(person.id) : ""))
        .filter(Boolean)
    : [];
}

function multiSelectNames(property?: NotionPageProperty): string[] {
  return (property?.multi_select ?? [])
    .map((entry) => entry.name?.trim() ?? "")
    .filter(Boolean);
}

function readNumber(property?: NotionPageProperty): number | undefined {
  return typeof property?.number === "number" ? property.number : undefined;
}

function checkboxOrSelect(property?: NotionPageProperty): boolean {
  if (property?.checkbox !== undefined) {
    return checkboxValue(property);
  }
  const value = selectValue(property).toLowerCase();
  return value === "yes" || value === "true" || value === "high";
}

async function ensureDataSourceRef(input: {
  sdk: Client;
  existing:
    | {
        name: string;
        databaseUrl: string;
        databaseId: string;
        dataSourceId: string;
        destinationAlias: string;
      }
    | undefined;
  parentPageUrl: string;
  title: string;
  titlePropertyName: string;
  destinationAlias: string;
}): Promise<{
  name: string;
  databaseUrl: string;
  databaseId: string;
  dataSourceId: string;
  destinationAlias: string;
}> {
  if (input.existing) {
    return input.existing;
  }

  const parentPageId = extractNotionIdFromUrl(input.parentPageUrl);
  if (!parentPageId) {
    throw new AppError(`Could not resolve parent page id from "${input.parentPageUrl}"`);
  }

  const response = (await input.sdk.request({
    path: "databases",
    method: "post",
    body: {
      parent: {
        type: "page_id",
        page_id: parentPageId,
      },
      title: toRichText(input.title),
      properties: {
        [input.titlePropertyName]: {
          title: {},
        },
      },
    },
  })) as {
    id: string;
    url: string;
    data_sources?: Array<{ id: string }>;
  };

  const dataSourceId = response.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new AppError(`Notion did not return a data source for "${input.title}"`);
  }

  return {
    name: input.title,
    databaseUrl: response.url,
    databaseId: normalizeNotionId(response.id),
    dataSourceId: normalizeNotionId(dataSourceId),
    destinationAlias: input.destinationAlias,
  };
}

function relationSchema(dataSourceId: string): { data_source_id: string; single_property: Record<string, never> } {
  return {
    data_source_id: dataSourceId,
    single_property: {},
  };
}

function dualRelationSchema(
  dataSourceId: string,
  syncedPropertyName: string,
): { data_source_id: string; dual_property: { synced_property_name: string } } {
  return {
    data_source_id: dataSourceId,
    dual_property: {
      synced_property_name: syncedPropertyName,
    },
  };
}

function toRichText(value: string): Array<{ type: "text"; text: { content: string } }> {
  return [
    {
      type: "text",
      text: {
        content: value,
      },
    },
  ];
}

function colorize(options: Array<[string, string]>): Array<{ name: string; color: string }> {
  return options.map(([name, color]) => ({ name, color }));
}
