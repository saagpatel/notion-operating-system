import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  multiSelectValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import {
  buildRoadmapPhases,
  renderLocalPortfolioAdrMarkdown,
  renderNotionPhaseMemoryMarkdown,
  renderNotionRoadmapMarkdown,
} from "./local-portfolio-roadmap.js";
import { AppError } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";

export interface PhaseCloseoutCommandOptions {
  phase?: number;
  today?: string;
  config?: string;
}

export async function runPhaseCloseoutCommand(options: PhaseCloseoutCommandOptions = {}): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for phase closeout");
  const today = options.today ?? losAngelesToday();
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  const config = await loadLocalPortfolioControlTowerConfig(configPath);
  const phaseToClose = options.phase ?? config.phaseState.currentPhase;

    const phases = buildRoadmapPhases(
      config.phaseState.currentPhase,
      config.phaseState.currentPhaseStatus,
      config.phaseState.currentPhase > 1,
    );
    const currentPhase = phases.find((phase) => phase.phase === phaseToClose);
    const nextPhase = phases.find((phase) => phase.phase === phaseToClose + 1);
    if (!currentPhase || !nextPhase) {
      throw new AppError(`Could not resolve phase ${phaseToClose} or its successor from the roadmap`);
    }

    const isHistoricalBackfill = phaseToClose < config.phaseState.currentPhase;
    const nextPhaseState = isHistoricalBackfill
      ? {
          ...config.phaseState,
          lastClosedPhase: Math.max(config.phaseState.lastClosedPhase ?? 0, currentPhase.phase),
        }
      : {
          ...config.phaseState,
          currentPhase: nextPhase.phase,
          currentPhaseStatus: "Planned",
          lastClosedPhase: currentPhase.phase,
        };

    const nextConfig = {
      ...config,
      phaseState: nextPhaseState,
    };

    const roadmapMarkdown = renderNotionRoadmapMarkdown({
      generatedAt: today,
      currentPhase: nextConfig.phaseState.currentPhase,
      currentPhaseStatus: nextConfig.phaseState.currentPhaseStatus,
      baselineMetrics: nextConfig.phaseState.baselineMetrics,
      latestMetrics: nextConfig.phaseState.lastSyncMetrics,
      lastClosedPhase: currentPhase.phase,
    });
    const phaseMemoryMarkdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: today,
      currentPhase: nextConfig.phaseState.currentPhase,
    });
    const adrMarkdown = renderLocalPortfolioAdrMarkdown();

    await mkdir(path.join(process.cwd(), "docs", "adr"), { recursive: true });
    await writeFile(path.join(process.cwd(), "docs", "notion-roadmap.md"), roadmapMarkdown, "utf8");
    await writeFile(path.join(process.cwd(), "docs", "notion-phase-memory.md"), phaseMemoryMarkdown, "utf8");
    await writeFile(path.join(process.cwd(), "docs", "adr", "0001-local-portfolio-control-tower.md"), adrMarkdown, "utf8");

    const api = new DirectNotionClient(token);
    const buildSchema = await api.retrieveDataSource(nextConfig.relatedDataSources.buildLogId);
    const buildTitle = `Phase ${currentPhase.phase} closeout - ${currentPhase.title}`;
    const shippedSummary = currentPhase.deliverables.join("; ");
    const lesson =
      "Keeping the repo as the canonical memory makes phase transitions much safer than relying on chat history or ad hoc pages.";
    const nextSteps =
      currentPhase.phase === 8 && nextConfig.phase8GithubDeepening
        ? nextConfig.phase8GithubDeepening.phaseMemory.phase9Brief
      : currentPhase.phase === 7 && nextConfig.phase7Actuation
        ? nextConfig.phase7Actuation.phaseMemory.phase8Brief
      : currentPhase.phase === 2 && nextConfig.phase2Execution
        ? nextConfig.phase2Execution.phaseMemory.phase3Brief
        : currentPhase.phase === 3 && nextConfig.phase3Intelligence
          ? nextConfig.phase3Intelligence.phaseMemory.phase4Brief
          : currentPhase.phase === 6 && nextConfig.phase6Governance
            ? nextConfig.phase6Governance.phaseMemory.phase7Brief
          : currentPhase.phase === 5 && nextConfig.phase5ExternalSignals
            ? nextConfig.phase5ExternalSignals.phaseMemory.phase6Brief
          : currentPhase.phase === 4 && nextConfig.phase4Native
            ? nextConfig.phase4Native.phaseMemory.phase5Brief
        : currentPhase.nextPhaseBrief;
    const phaseMemoryLines =
      currentPhase.phase >= 8 && nextConfig.phase8GithubDeepening
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase8GithubDeepening.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase2Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase3Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase4Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase5Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase6Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase7Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase8Added,
            "",
            nextConfig.phase8GithubDeepening.phaseMemory.phase9Brief,
          ]
      : currentPhase.phase >= 7 && nextConfig.phase7Actuation
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase7Actuation.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase2Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase3Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase4Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase5Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase6Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase7Added,
            "",
            nextConfig.phase7Actuation.phaseMemory.phase8Brief,
          ]
      : currentPhase.phase >= 6 && nextConfig.phase6Governance
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase6Governance.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase6Governance.phaseMemory.phase2Added,
            "",
            nextConfig.phase6Governance.phaseMemory.phase3Added,
            "",
            nextConfig.phase6Governance.phaseMemory.phase4Added,
            "",
            nextConfig.phase6Governance.phaseMemory.phase5Added,
            "",
            nextConfig.phase6Governance.phaseMemory.phase6Added,
            "",
            nextConfig.phase6Governance.phaseMemory.phase7Brief,
          ]
        : currentPhase.phase >= 5 && nextConfig.phase5ExternalSignals
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase5ExternalSignals.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase2Added,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase3Added,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase4Added,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase5Added,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase6Brief,
            "",
            nextConfig.phase5ExternalSignals.phaseMemory.phase7Brief,
          ]
        : currentPhase.phase >= 4 && nextConfig.phase4Native
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase4Native.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase4Native.phaseMemory.phase2Added,
            "",
            nextConfig.phase4Native.phaseMemory.phase3Added,
            "",
            nextConfig.phase4Native.phaseMemory.phase4Added,
            "",
            nextConfig.phase4Native.phaseMemory.phase5Brief,
            "",
            nextConfig.phase4Native.phaseMemory.phase6Brief,
          ]
        : currentPhase.phase >= 3 && nextConfig.phase3Intelligence
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase3Intelligence.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase3Intelligence.phaseMemory.phase2Added,
            "",
            nextConfig.phase3Intelligence.phaseMemory.phase3Added,
            "",
            nextConfig.phase3Intelligence.phaseMemory.phase4Brief,
            "",
            nextConfig.phase3Intelligence.phaseMemory.phase5Brief,
          ]
        : currentPhase.phase >= 2 && nextConfig.phase2Execution
        ? [
            "",
            "## Phase Memory",
            nextConfig.phase2Execution.phaseMemory.phase1GaveUs,
            "",
            nextConfig.phase2Execution.phaseMemory.phase2Added,
            "",
            nextConfig.phase2Execution.phaseMemory.phase3WillUse,
          ]
        : [];
    const markdown = [
      `# ${buildTitle}`,
      "",
      "## What Was Planned",
      currentPhase.objective,
      "",
      "## What Shipped",
      shippedSummary,
      "",
      "## Lessons",
      lesson,
      "",
      "## Next Steps",
      nextSteps,
      ...phaseMemoryLines,
    ].join("\n");

    const result = await upsertPageByTitle({
      api,
      dataSourceId: nextConfig.relatedDataSources.buildLogId,
      titlePropertyName: buildSchema.titlePropertyName,
      title: buildTitle,
      properties: {
        [buildSchema.titlePropertyName]: titleValue(buildTitle),
        "Session Date": { date: { start: today } },
        "Session Type": selectPropertyValue("Planning"),
        Outcome: selectPropertyValue("Shipped"),
        "What Was Planned": richTextValue(currentPhase.objective),
        "What Shipped": richTextValue(shippedSummary),
        "Lessons Learned": richTextValue(lesson),
        "Next Steps": richTextValue(nextSteps),
        Tags: multiSelectValue(["notion", "portfolio", "phase-closeout"]),
        "Tools Used": multiSelectValue(["Codex CLI (OpenAI)", "Notion"]),
        "Artifacts Updated": multiSelectValue(["notion", "docs", "data"]),
        "Scope Drift": selectPropertyValue("Minor"),
        "Session Rating": selectPropertyValue("Great"),
        "Follow-up Needed": {
          checkbox: true,
        },
      },
      markdown,
    });

    await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);

  const output = {
    ok: true,
    closedPhase: currentPhase.phase,
    nextPhase: nextPhase.phase,
    historicalBackfill: isHistoricalBackfill,
    roadmapPath: "docs/notion-roadmap.md",
    phaseMemoryPath: "docs/notion-phase-memory.md",
    adrPath: "docs/adr/0001-local-portfolio-control-tower.md",
    buildLogPageId: result.id,
    buildLogPageUrl: result.url,
  };
  recordCommandOutputSummary(output, {
    metadata: {
      closedPhase: currentPhase.phase,
      nextPhase: nextPhase.phase,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["control-tower", "phase-closeout"]);
}
