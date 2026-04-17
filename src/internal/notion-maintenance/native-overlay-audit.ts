import "dotenv/config";

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "../../notion/local-portfolio-control-tower.js";
import { mergeManagedSection } from "../../notion/local-portfolio-execution.js";
import {
  buildNativeOverlayAuditSummary,
  loadLocalPortfolioNativeAutomationConfig,
  loadLocalPortfolioNativeDashboardConfig,
  loadLocalPortfolioNativePilotConfig,
  renderNativeBriefsMarkdown,
  renderNativeOverlaySection,
  requirePhase4Native,
} from "../../notion/local-portfolio-native.js";
import { renderNotionPhaseMemoryMarkdown, renderNotionRoadmapMarkdown } from "../../notion/local-portfolio-roadmap.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand } from "../../utils/markdown.js";
import { losAngelesToday } from "../../utils/date.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

const NATIVE_OVERLAY_START = "<!-- codex:notion-native-overlays:start -->";
const NATIVE_OVERLAY_END = "<!-- codex:notion-native-overlays:end -->";

async function main(): Promise<void> {
  try {
    if (shouldShowHelp(process.argv.slice(2))) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:native-overlay-audit --",
          description: "Audit the deferred native-overlay layer and optionally patch its managed pages.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--live", description: "Patch the managed native-overlay pages and config live." },
            { flag: "--today <date>", description: "Override the date anchor in YYYY-MM-DD format." },
          ],
        }),
      );
      return;
    }

    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for native overlay audit");
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
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    const phase4 = requirePhase4Native(config);
    const summary = buildNativeOverlayAuditSummary(config);

    if (flags.live) {
      const api = new DirectNotionClient(token);
      const commandCenter = await api.readPageMarkdown(config.commandCenter.pageId!);
      const nextCommandCenter = mergeManagedSection(
        commandCenter.markdown,
        renderNativeOverlaySection({
          generatedAt: today,
          config,
          summary,
        }),
        NATIVE_OVERLAY_START,
        NATIVE_OVERLAY_END,
      );
      if (nextCommandCenter !== commandCenter.markdown.trim()) {
        assertSafeReplacement(commandCenter.markdown, nextCommandCenter);
        await api.patchPageMarkdown({
          pageId: config.commandCenter.pageId!,
          command: "replace_content",
          newMarkdown: buildReplaceCommand(nextCommandCenter),
        });
      }

      if (phase4.pilotRegistry.weeklyNativeSummaryDraft.pageId) {
        const nativeBriefsMarkdown = renderNativeBriefsMarkdown({
          generatedAt: today,
          summary,
          dashboardConfig,
          automationConfig,
          pilotConfig,
          config,
        });
        await api.patchPageMarkdown({
          pageId: phase4.pilotRegistry.weeklyNativeSummaryDraft.pageId,
          command: "replace_content",
          newMarkdown: nativeBriefsMarkdown,
        });
      }

      const nextConfig = {
        ...config,
        phase4Native: {
          ...phase4,
          lastAuditAt: today,
          lastAuditSummary: {
            activeDashboards: summary.counts.activeDashboards,
            deferredDashboards: summary.counts.deferredDashboards,
            activeAutomations: summary.counts.activeAutomations,
            deferredAutomations: summary.counts.deferredAutomations,
            activePilots: summary.counts.activePilots,
            deferredPilots: summary.counts.deferredPilots,
          },
        },
        phaseState: {
          ...config.phaseState,
          currentPhaseStatus: "In Progress",
        },
      };

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
    }

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
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

if (process.argv[1]?.endsWith("native-overlay-audit.ts")) {
  void main();
}
