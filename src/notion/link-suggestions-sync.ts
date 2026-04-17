import { createNotionSdkClient } from "./notion-sdk.js";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveOptionalControlTowerConfigPath, resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  generateCandidateLinkSuggestions,
  requirePhase3Intelligence,
} from "./local-portfolio-intelligence.js";
import {
  ensurePhase3IntelligenceSchema,
  toIntelligenceProjectRecord,
  toLinkSuggestionRecord,
  toRecommendationRunRecord,
  toResearchLibraryRecord,
  toSkillLibraryRecord,
  toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";
import {
  fetchAllPages,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";

export interface LinkSuggestionsSyncCommandOptions {
  live?: boolean;
  config?: string;
  positionals?: string[];
}

export async function runLinkSuggestionsSyncCommand(
  options: LinkSuggestionsSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for link suggestion sync");
  const live = options.live ?? false;
  const configPath = resolveOptionalControlTowerConfigPath({
    config: options.config,
    positionals: options.positionals,
  });
  let config = await loadLocalPortfolioControlTowerConfig(configPath);

  const sdk = createNotionSdkClient(token);
  const api = new DirectNotionClient(token);

  if (live) {
    config = await ensurePhase3IntelligenceSchema(sdk, config);
  }
  const phase3 = requirePhase3Intelligence(config);

    const [projectSchema, researchSchema, skillSchema, toolSchema, suggestionSchema, runSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.researchId),
      api.retrieveDataSource(config.relatedDataSources.skillsId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
      api.retrieveDataSource(phase3.linkSuggestions.dataSourceId),
      api.retrieveDataSource(phase3.recommendationRuns.dataSourceId),
    ]);

    const [projectPages, researchPages, skillPages, toolPages, suggestionPages, runPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
      fetchAllPages(sdk, phase3.linkSuggestions.dataSourceId, suggestionSchema.titlePropertyName),
      fetchAllPages(sdk, phase3.recommendationRuns.dataSourceId, runSchema.titlePropertyName),
    ]);

    const projects = projectPages.map((page) => toIntelligenceProjectRecord(page));
    const research = researchPages.map((page) => toResearchLibraryRecord(page));
    const skills = skillPages.map((page) => toSkillLibraryRecord(page));
    const tools = toolPages.map((page) => toToolMatrixRecord(page));
    const existingSuggestions = suggestionPages.map((page) => toLinkSuggestionRecord(page));
    const latestRun = runPages
      .map((page) => toRecommendationRunRecord(page))
      .sort((left, right) => right.runDate.localeCompare(left.runDate))[0];

    const candidates = generateCandidateLinkSuggestions({
      projects,
      researchRecords: research,
      skillRecords: skills,
      toolRecords: tools,
      existingSuggestions,
      config,
    });

  if (live) {
    for (const candidate of candidates) {
      const title = `${candidate.projectTitle} -> ${candidate.suggestionType.split("->")[1]} -> ${candidate.targetTitle}`;
      await upsertPageByTitle({
        api,
        dataSourceId: phase3.linkSuggestions.dataSourceId,
        titlePropertyName: suggestionSchema.titlePropertyName,
        title,
        properties: {
          [suggestionSchema.titlePropertyName]: titleValue(title),
          Status: selectPropertyValue("Proposed"),
          "Suggestion Type": selectPropertyValue(candidate.suggestionType),
          "Local Project": relationValue([candidate.projectId]),
          "Suggested Research":
            candidate.suggestionType === "Project->Research" ? relationValue([candidate.targetId]) : relationValue([]),
          "Suggested Skill":
            candidate.suggestionType === "Project->Skill" ? relationValue([candidate.targetId]) : relationValue([]),
          "Suggested Tool":
            candidate.suggestionType === "Project->Tool" ? relationValue([candidate.targetId]) : relationValue([]),
          "Confidence Score": { number: candidate.confidenceScore },
          "Match Reasons": richTextValue(candidate.matchReasons.join("; ")),
          "Suggested In Run": latestRun ? relationValue([latestRun.id]) : relationValue([]),
        },
        markdown: renderSuggestionMarkdown(candidate),
      });
    }
  }

  const output = {
    ok: true,
    live,
    candidateCount: candidates.length,
    topCandidates: candidates.slice(0, 10).map((candidate) => ({
      title: `${candidate.projectTitle} -> ${candidate.targetTitle}`,
      type: candidate.suggestionType,
      confidenceScore: candidate.confidenceScore,
    })),
  };
  recordCommandOutputSummary(output);
  console.log(JSON.stringify(output, null, 2));
}

function renderSuggestionMarkdown(candidate: ReturnType<typeof generateCandidateLinkSuggestions>[number]): string {
  return [
    `# ${candidate.projectTitle} -> ${candidate.targetTitle}`,
    "",
    `- Type: ${candidate.suggestionType}`,
    `- Confidence: ${candidate.confidenceScore}`,
    "",
    "## Match Reasons",
    ...candidate.matchReasons.map((reason) => `- ${reason}`),
    "",
    "## Review Notes",
    "- Accept if this link would materially improve project support coverage.",
  ].join("\n");
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["intelligence", "link-suggestions-sync"]);
}
