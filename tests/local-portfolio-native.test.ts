import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  buildNativeOverlayAuditSummary,
  ensurePhase4NativeState,
  parseLocalPortfolioNativeAutomationConfig,
  parseLocalPortfolioNativeDashboardConfig,
  parseLocalPortfolioNativePilotConfig,
  validateNativeDashboardPlanAgainstSchemas,
} from "../src/notion/local-portfolio-native.js";
import { parseLocalPortfolioControlTowerConfig } from "../src/notion/local-portfolio-control-tower.js";

describe("local portfolio native phase-4 config", () => {
  test("parses native dashboard, automation, and pilot plans", async () => {
    const [dashboardsRaw, automationsRaw, pilotsRaw] = await Promise.all([
      readConfig("../config/local-portfolio-native-dashboards.json"),
      readConfig("../config/local-portfolio-native-automations.json"),
      readConfig("../config/local-portfolio-native-pilots.json"),
    ]);

    const dashboards = parseLocalPortfolioNativeDashboardConfig(dashboardsRaw);
    const automations = parseLocalPortfolioNativeAutomationConfig(automationsRaw);
    const pilots = parseLocalPortfolioNativePilotConfig(pilotsRaw);

    expect(dashboards.dashboards).toHaveLength(2);
    expect(dashboards.dashboards[0]?.maxWidgets).toBeLessThanOrEqual(8);
    expect(automations.automations).toHaveLength(3);
    expect(automations.automations.every((entry) => entry.nonCanonical)).toBe(true);
    expect(pilots.pilots).toHaveLength(2);
  });

  test("validates dashboard widgets against the live-shape schemas and view registry", async () => {
    const controlConfig = await loadControlConfig();
    const dashboardConfig = parseLocalPortfolioNativeDashboardConfig(
      await readConfig("../config/local-portfolio-native-dashboards.json"),
    );

    const summary = validateNativeDashboardPlanAgainstSchemas({
      controlConfig,
      dashboardConfig,
      schemas: {
        projects: {
          id: controlConfig.database.dataSourceId,
          title: controlConfig.database.name,
          titlePropertyName: "Name",
          properties: {
            Name: { name: "Name", type: "title", writable: true },
            "Recommendation Lane": { name: "Recommendation Lane", type: "select", writable: true },
            "Operating Queue": { name: "Operating Queue", type: "select", writable: true },
          },
        },
        tasks: {
          id: controlConfig.phase2Execution!.tasks.dataSourceId,
          title: controlConfig.phase2Execution!.tasks.name,
          titlePropertyName: "Task",
          properties: {
            Task: { name: "Task", type: "title", writable: true },
            Status: { name: "Status", type: "status", writable: true },
            Priority: { name: "Priority", type: "select", writable: true },
          },
        },
      },
    });

    expect(summary.validatedDashboards).toHaveLength(2);
    expect(summary.validatedDashboards[0]?.widgetCount).toBe(7);
  });

  test("builds phase-4 audit summaries with future-phase memory", async () => {
    const controlConfig = await loadControlConfig();
    const nextConfig = {
      ...controlConfig,
      phase4Native: ensurePhase4NativeState(controlConfig, {
        today: "2026-03-17",
        nativeBriefPage: {
          id: "326c21f1-caf0-819f-aaaa-000c11111111",
          url: "https://www.notion.so/Local-Portfolio-Native-Briefs-326c21f1caf0819faaaa000c11111111",
        },
      }),
    };

    const summary = buildNativeOverlayAuditSummary(nextConfig);
    expect(summary.entitlements.businessPlanRequired).toBe(true);
    expect(summary.dashboards).toHaveLength(2);
    expect(nextConfig.phase4Native?.phaseMemory.phase5Brief).toContain("Phase 5");
    expect(nextConfig.phase4Native?.phaseMemory.phase6Brief).toContain("Phase 6");
  });
});

async function loadControlConfig() {
  return parseLocalPortfolioControlTowerConfig(await readConfig("../config/local-portfolio-control-tower.json"));
}

async function readConfig(relativePath: string) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}
