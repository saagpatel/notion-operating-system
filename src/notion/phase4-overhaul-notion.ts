import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  buildNativeOverlayAuditSummary,
  ensurePhase4NativeState,
  loadLocalPortfolioNativeAutomationConfig,
  loadLocalPortfolioNativeDashboardConfig,
  loadLocalPortfolioNativePilotConfig,
  renderNativeBriefsMarkdown,
} from "./local-portfolio-native.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "./local-portfolio-roadmap.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import type { DestinationRegistryConfig } from "../types.js";
import { extractNotionIdFromUrl } from "../utils/notion-id.js";

const DESTINATIONS_PATH = process.env.NOTION_DESTINATIONS_PATH ?? "./config/destinations.json";
const DEFAULT_NATIVE_BRIEFS_TITLE = "Local Portfolio Native Briefs";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for the phase 4 overhaul");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;

    const [dashboardConfig, automationConfig, pilotConfig] = await Promise.all([
      loadLocalPortfolioNativeDashboardConfig(),
      loadLocalPortfolioNativeAutomationConfig(),
      loadLocalPortfolioNativePilotConfig(),
    ]);

    let config = await loadLocalPortfolioControlTowerConfig(configPath);
    let nativeBriefPage = getExistingNativeBriefPage(config);

    if (flags.live) {
      const api = new DirectNotionClient(token);
      nativeBriefPage = await ensureNativeBriefsPage({
        api,
        config,
        today,
        title: DEFAULT_NATIVE_BRIEFS_TITLE,
      });
    }

    const phase4Native = ensurePhase4NativeState(config, {
      today,
      nativeBriefPage,
    });
    const nextConfig = {
      ...config,
      phase4Native,
      phaseState: {
        ...config.phaseState,
        currentPhase: Math.max(config.phaseState.currentPhase, 4),
        currentPhaseStatus: "In Progress",
      },
    };

    const summary = buildNativeOverlayAuditSummary(nextConfig);
    const briefsMarkdown = renderNativeBriefsMarkdown({
      generatedAt: today,
      summary,
      dashboardConfig,
      automationConfig,
      pilotConfig,
      config: nextConfig,
    });

    if (flags.live && nativeBriefPage) {
      const api = new DirectNotionClient(token);
      await api.patchPageMarkdown({
        pageId: nativeBriefPage.id,
        command: "replace_content",
        newMarkdown: briefsMarkdown,
      });
    }

    await upsertDestinationAliases(nextConfig);

    const roadmapMarkdown = renderNotionRoadmapMarkdown({
      generatedAt: today,
      currentPhase: nextConfig.phaseState.currentPhase,
      currentPhaseStatus: nextConfig.phaseState.currentPhaseStatus,
      baselineMetrics: nextConfig.phaseState.baselineMetrics,
      latestMetrics: nextConfig.phaseState.lastSyncMetrics,
      lastClosedPhase: nextConfig.phaseState.lastClosedPhase,
    });
    const phaseMemoryMarkdown = renderNotionPhaseMemoryMarkdown({
      generatedAt: today,
      currentPhase: nextConfig.phaseState.currentPhase,
    });

    await writeFile(path.join(process.cwd(), "docs", "notion-roadmap.md"), roadmapMarkdown, "utf8");
    await writeFile(path.join(process.cwd(), "docs", "notion-phase-memory.md"), phaseMemoryMarkdown, "utf8");
    await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          nativeBriefPageId: nativeBriefPage?.id,
          nativeBriefPageUrl: nativeBriefPage?.url,
          dashboardPlanCount: dashboardConfig.dashboards.length,
          automationPlanCount: automationConfig.automations.length,
          pilotPlanCount: pilotConfig.pilots.length,
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

async function ensureNativeBriefsPage(input: {
  api: DirectNotionClient;
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
  title: string;
  today: string;
}): Promise<{ id: string; url: string }> {
  const existing = getExistingNativeBriefPage(input.config);

  if (existing) {
    return existing;
  }

  const parentPageId = extractNotionIdFromUrl(input.config.commandCenter.parentPageUrl);
  if (!parentPageId) {
    throw new AppError("Could not resolve the command-center parent page ID for native briefs");
  }
  const created = await input.api.createPageWithMarkdown({
    parent: {
      page_id: parentPageId,
    },
    properties: {
      title: {
        title: [{ type: "text", text: { content: input.title } }],
      },
    },
    markdown: [
      `# ${input.title}`,
      "",
      `Created: ${input.today}`,
      "",
      "This page is the repo-owned landing zone for Phase 4 native overlay briefs and pilot notes.",
    ].join("\n"),
  });

  return created;
}

function getExistingNativeBriefPage(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): { id: string; url: string } | undefined {
  const pageId = config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.pageId;
  const pageUrl = config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.pageUrl;
  if (!pageId || !pageUrl || pageId === config.commandCenter.pageId) {
    return undefined;
  }
  return {
    id: pageId,
    url: pageUrl,
  };
}

async function upsertDestinationAliases(
  config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>,
): Promise<void> {
  const registry = await readJsonFile<DestinationRegistryConfig>(DESTINATIONS_PATH);
  const upsert = (alias: string, patch: DestinationRegistryConfig["destinations"][number]) => {
    const existingIndex = registry.destinations.findIndex((destination) => destination.alias === alias);
    if (existingIndex >= 0) {
      registry.destinations[existingIndex] = patch;
      return;
    }
    registry.destinations.push(patch);
  };

  const nativePage = config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft;
  if (nativePage?.pageId && nativePage.pageUrl) {
    upsert("local_portfolio_native_briefs", {
      alias: "local_portfolio_native_briefs",
      description: "Update the repo-owned Local Portfolio Native Briefs page.",
      destinationType: "page",
      sourceUrl: nativePage.pageUrl,
      resolvedId: nativePage.pageId,
      templateMode: "none",
      titleRule: {
        source: "literal",
        value: DEFAULT_NATIVE_BRIEFS_TITLE,
        fallback: DEFAULT_NATIVE_BRIEFS_TITLE,
      },
      fixedProperties: {},
      defaultProperties: {},
      mode: "replace_full_content",
      safeDefaults: {
        allowDeletingContent: false,
        templatePollIntervalMs: 1500,
        templatePollTimeoutMs: 30000,
      },
    });
  }

  await writeJsonFile(DESTINATIONS_PATH, registry);
}

function parseFlags(argv: string[]): { live: boolean; today?: string } {
  let live = false;
  let today: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1];
      index += 1;
    }
  }

  return { live, today };
}

void main();
