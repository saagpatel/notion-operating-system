import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";
import type { DataSourceSchemaSnapshot, PropertySchema } from "../types.js";
import type { LocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";

export const DEFAULT_LOCAL_PORTFOLIO_NATIVE_DASHBOARDS_PATH = "./config/local-portfolio-native-dashboards.json";
export const DEFAULT_LOCAL_PORTFOLIO_NATIVE_AUTOMATIONS_PATH = "./config/local-portfolio-native-automations.json";
export const DEFAULT_LOCAL_PORTFOLIO_NATIVE_PILOTS_PATH = "./config/local-portfolio-native-pilots.json";

export type NativeDashboardKey = "portfolio" | "execution";
export type NativeDashboardDatabaseKey = "projects" | "tasks";
export type NativeDashboardWidgetKind = "chart" | "table";
export type NativeChartType = "bar" | "column" | "donut";
export type NativeFilterValue = string | boolean;
export type NativePlanStatus = "active" | "deferred" | "missing";

export interface NativeEntitlementState {
  businessPlanRequired: boolean;
  businessWorkspaceVerified: boolean;
  customAgentsVisible: boolean;
  syncedDatabasesVisible: boolean;
  verifiedAt?: string;
}

export interface NativeDashboardWidgetFilter {
  property: string;
  value: NativeFilterValue;
}

export interface NativeDashboardChartWidget {
  kind: "chart";
  title: string;
  chartType: NativeChartType;
  groupBy: string;
  measure: "count";
  filters: NativeDashboardWidgetFilter[];
}

export interface NativeDashboardTableWidget {
  kind: "table";
  title: string;
  sourceViewName: string;
}

export type NativeDashboardWidget = NativeDashboardChartWidget | NativeDashboardTableWidget;

export interface NativeDashboardPlan {
  key: NativeDashboardKey;
  name: string;
  databaseKey: NativeDashboardDatabaseKey;
  databaseName: string;
  maxWidgets: number;
  widgets: NativeDashboardWidget[];
}

export interface LocalPortfolioNativeDashboardConfig {
  version: 1;
  strategy: {
    primary: "notion_mcp";
    fallback: "playwright";
    notes: string[];
  };
  dashboards: NativeDashboardPlan[];
}

export interface NativeAutomationPlan {
  key: "projectReviewReminder" | "decisionRevisitReminder" | "weeklyRunReviewReminder";
  name: string;
  databaseKey: "projects" | "decisions" | "recommendationRuns";
  recurring: boolean;
  cadenceLabel: string;
  nonCanonical: true;
  reminderTarget: string;
  triggerSummary: string;
  allowedActions: string[];
  forbiddenActions: string[];
}

export interface LocalPortfolioNativeAutomationConfig {
  version: 1;
  strategy: {
    primary: "playwright";
    fallback: "manual";
    notes: string[];
  };
  automations: NativeAutomationPlan[];
}

export interface NativePilotPlan {
  key: "githubDeliverySignals" | "weeklyNativeSummaryDraft";
  name: string;
  type: "synced_database" | "custom_agent";
  gatedBy: "business_plan" | "custom_agents";
  scope: string;
  successCriteria: string[];
  constraints: string[];
  defaultStatus: NativePlanStatus;
  deferReason?: string;
}

export interface LocalPortfolioNativePilotConfig {
  version: 1;
  strategy: {
    primary: "notion_native";
    fallback: "document_and_defer";
    notes: string[];
  };
  pilots: NativePilotPlan[];
}

export interface NativeDashboardValidationResult {
  dashboardKey: NativeDashboardKey;
  dashboardName: string;
  widgetCount: number;
  maxWidgets: number;
  widgetTitles: string[];
}

export interface NativeOverlayAuditSummary {
  entitlements: NativeEntitlementState;
  dashboards: Array<{
    key: NativeDashboardKey;
    name: string;
    status: NativePlanStatus;
    widgetCount: number;
    url?: string;
    notes?: string;
  }>;
  automations: Array<{
    key: NativeAutomationPlan["key"];
    name: string;
    status: NativePlanStatus;
    liveMethod: "playwright" | "manual" | "deferred";
    notes?: string;
    deferReason?: string;
  }>;
  pilots: Array<{
    key: NativePilotPlan["key"];
    name: string;
    status: NativePlanStatus;
    liveMethod: "playwright" | "manual" | "deferred";
    notes?: string;
    deferReason?: string;
    pageUrl?: string;
  }>;
  counts: {
    activeDashboards: number;
    deferredDashboards: number;
    activeAutomations: number;
    deferredAutomations: number;
    activePilots: number;
    deferredPilots: number;
  };
}

const DASHBOARD_FILTERABLE_TYPES = new Set(["select", "status", "checkbox", "multi_select"]);
const DASHBOARD_GROUPABLE_TYPES = new Set(["select", "status", "multi_select"]);
const CHART_TYPES = new Set<NativeChartType>(["bar", "column", "donut"]);

export async function loadLocalPortfolioNativeDashboardConfig(
  filePath = DEFAULT_LOCAL_PORTFOLIO_NATIVE_DASHBOARDS_PATH,
): Promise<LocalPortfolioNativeDashboardConfig> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioNativeDashboardConfig(raw);
}

export async function loadLocalPortfolioNativeAutomationConfig(
  filePath = DEFAULT_LOCAL_PORTFOLIO_NATIVE_AUTOMATIONS_PATH,
): Promise<LocalPortfolioNativeAutomationConfig> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioNativeAutomationConfig(raw);
}

export async function loadLocalPortfolioNativePilotConfig(
  filePath = DEFAULT_LOCAL_PORTFOLIO_NATIVE_PILOTS_PATH,
): Promise<LocalPortfolioNativePilotConfig> {
  const raw = await readJsonFile<unknown>(filePath);
  return parseLocalPortfolioNativePilotConfig(raw);
}

export function parseLocalPortfolioNativeDashboardConfig(raw: unknown): LocalPortfolioNativeDashboardConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native dashboards config must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio native dashboards config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    strategy: parseDashboardStrategy(value.strategy),
    dashboards: parseDashboardPlans(value.dashboards),
  };
}

export function parseLocalPortfolioNativeAutomationConfig(raw: unknown): LocalPortfolioNativeAutomationConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native automations config must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio native automations config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    strategy: parseAutomationStrategy(value.strategy),
    automations: parseAutomationPlans(value.automations),
  };
}

export function parseLocalPortfolioNativePilotConfig(raw: unknown): LocalPortfolioNativePilotConfig {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native pilots config must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.version !== 1) {
    throw new AppError(`Unsupported local portfolio native pilots config version "${String(value.version)}"`);
  }

  return {
    version: 1,
    strategy: parsePilotStrategy(value.strategy),
    pilots: parsePilotPlans(value.pilots),
  };
}

export function validateNativeDashboardPlanAgainstSchemas(input: {
  controlConfig: LocalPortfolioControlTowerConfig;
  dashboardConfig: LocalPortfolioNativeDashboardConfig;
  schemas: Record<NativeDashboardDatabaseKey, DataSourceSchemaSnapshot>;
}): { validatedDashboards: NativeDashboardValidationResult[] } {
  const validatedDashboards: NativeDashboardValidationResult[] = [];
  const availableViews = buildAvailableSourceViews(input.controlConfig);

  for (const dashboard of input.dashboardConfig.dashboards) {
    if (dashboard.widgets.length > dashboard.maxWidgets) {
      throw new AppError(
        `Dashboard "${dashboard.name}" defines ${dashboard.widgets.length} widgets but maxWidgets is ${dashboard.maxWidgets}`,
      );
    }
    if (dashboard.maxWidgets > 8) {
      throw new AppError(`Dashboard "${dashboard.name}" exceeds the phase-4 widget guardrail of 8`);
    }

    const schema = input.schemas[dashboard.databaseKey];
    if (!schema) {
      throw new AppError(`Missing schema for dashboard database "${dashboard.databaseKey}"`);
    }

    for (const widget of dashboard.widgets) {
      if (widget.kind === "table") {
        const viewNames = availableViews[dashboard.databaseKey];
        if (!viewNames.has(widget.sourceViewName)) {
          throw new AppError(
            `Dashboard "${dashboard.name}" references missing source view "${widget.sourceViewName}"`,
          );
        }
        continue;
      }

      if (!CHART_TYPES.has(widget.chartType)) {
        throw new AppError(`Dashboard "${dashboard.name}" uses unsupported chart type "${widget.chartType}"`);
      }
      const groupProperty = assertPropertyExists(schema, dashboard.name, widget.groupBy);
      assertPropertyType(dashboard.name, groupProperty, DASHBOARD_GROUPABLE_TYPES, "dashboard chart grouping");
      if (widget.measure !== "count") {
        throw new AppError(`Dashboard "${dashboard.name}" uses unsupported chart measure "${widget.measure}"`);
      }

      for (const filter of widget.filters) {
        const property = assertPropertyExists(schema, dashboard.name, filter.property);
        if (typeof filter.value === "boolean") {
          assertPropertyType(dashboard.name, property, new Set(["checkbox"]), "dashboard boolean filter");
          continue;
        }
        assertPropertyType(dashboard.name, property, DASHBOARD_FILTERABLE_TYPES, "dashboard string filter");
      }
    }

    validatedDashboards.push({
      dashboardKey: dashboard.key,
      dashboardName: dashboard.name,
      widgetCount: dashboard.widgets.length,
      maxWidgets: dashboard.maxWidgets,
      widgetTitles: dashboard.widgets.map((widget) => widget.title),
    });
  }

  return { validatedDashboards };
}

export function ensurePhase4NativeState(
  config: LocalPortfolioControlTowerConfig,
  input: {
    today: string;
    nativeBriefPage?: { id: string; url: string };
  },
): NonNullable<LocalPortfolioControlTowerConfig["phase4Native"]> {
  return {
    entitlements: {
      businessPlanRequired: true,
      businessWorkspaceVerified: config.phase4Native?.entitlements.businessWorkspaceVerified ?? true,
      customAgentsVisible: config.phase4Native?.entitlements.customAgentsVisible ?? true,
      syncedDatabasesVisible: config.phase4Native?.entitlements.syncedDatabasesVisible ?? false,
      verifiedAt: input.today,
    },
    dashboardRegistry: {
      portfolio: {
        name: config.phase4Native?.dashboardRegistry.portfolio.name ?? "Portfolio Dashboard",
        databaseKey: "projects",
        viewId: config.phase4Native?.dashboardRegistry.portfolio.viewId,
        url: config.phase4Native?.dashboardRegistry.portfolio.url,
        widgetCount: config.phase4Native?.dashboardRegistry.portfolio.widgetCount ?? 7,
        status: config.phase4Native?.dashboardRegistry.portfolio.status ?? "missing",
        notes: config.phase4Native?.dashboardRegistry.portfolio.notes,
      },
      execution: {
        name: config.phase4Native?.dashboardRegistry.execution.name ?? "Execution Dashboard",
        databaseKey: "tasks",
        viewId: config.phase4Native?.dashboardRegistry.execution.viewId,
        url: config.phase4Native?.dashboardRegistry.execution.url,
        widgetCount: config.phase4Native?.dashboardRegistry.execution.widgetCount ?? 7,
        status: config.phase4Native?.dashboardRegistry.execution.status ?? "missing",
        notes: config.phase4Native?.dashboardRegistry.execution.notes,
      },
    },
    automationRegistry: {
      projectReviewReminder: {
        name: config.phase4Native?.automationRegistry.projectReviewReminder.name ?? "Project Review Reminder",
        databaseKey: "projects",
        nonCanonical: true,
        status: config.phase4Native?.automationRegistry.projectReviewReminder.status ?? "deferred",
        liveMethod: config.phase4Native?.automationRegistry.projectReviewReminder.liveMethod ?? "deferred",
        notes:
          config.phase4Native?.automationRegistry.projectReviewReminder.notes ??
          "Desired state is recorded in repo config; live rollout is tracked separately from canonical PM state.",
        deferReason: config.phase4Native?.automationRegistry.projectReviewReminder.deferReason,
      },
      decisionRevisitReminder: {
        name: config.phase4Native?.automationRegistry.decisionRevisitReminder.name ?? "Decision Revisit Reminder",
        databaseKey: "decisions",
        nonCanonical: true,
        status: config.phase4Native?.automationRegistry.decisionRevisitReminder.status ?? "deferred",
        liveMethod: config.phase4Native?.automationRegistry.decisionRevisitReminder.liveMethod ?? "deferred",
        notes:
          config.phase4Native?.automationRegistry.decisionRevisitReminder.notes ??
          "Decision-owner nudges stay outside canonical state transitions.",
        deferReason: config.phase4Native?.automationRegistry.decisionRevisitReminder.deferReason,
      },
      weeklyRunReviewReminder: {
        name: config.phase4Native?.automationRegistry.weeklyRunReviewReminder.name ?? "Weekly Run Review Reminder",
        databaseKey: "recommendationRuns",
        nonCanonical: true,
        status: config.phase4Native?.automationRegistry.weeklyRunReviewReminder.status ?? "deferred",
        liveMethod: config.phase4Native?.automationRegistry.weeklyRunReviewReminder.liveMethod ?? "deferred",
        notes:
          config.phase4Native?.automationRegistry.weeklyRunReviewReminder.notes ??
          "Draft-review nudges should never publish or mutate recommendation state automatically.",
        deferReason: config.phase4Native?.automationRegistry.weeklyRunReviewReminder.deferReason,
      },
    },
    pilotRegistry: {
      githubDeliverySignals: {
        name: config.phase4Native?.pilotRegistry.githubDeliverySignals.name ?? "GitHub Delivery Signals",
        status: config.phase4Native?.pilotRegistry.githubDeliverySignals.status ?? "deferred",
        liveMethod: config.phase4Native?.pilotRegistry.githubDeliverySignals.liveMethod ?? "deferred",
        notes:
          config.phase4Native?.pilotRegistry.githubDeliverySignals.notes ??
          "Keep any synced delivery signal pilot read-only and scoped to one project.",
        deferReason: config.phase4Native?.pilotRegistry.githubDeliverySignals.deferReason,
      },
      weeklyNativeSummaryDraft: {
        name: config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.name ?? "Weekly Native Summary Draft",
        status: config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.status ?? "deferred",
        liveMethod: config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.liveMethod ?? "deferred",
        destinationAlias: "local_portfolio_native_briefs",
        pageId:
          input.nativeBriefPage?.id ??
          config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.pageId,
        pageUrl:
          input.nativeBriefPage?.url ??
          config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.pageUrl,
        notes:
          config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.notes ??
          "Pilot remains human-reviewed and separate from canonical project or recommendation state.",
        deferReason: config.phase4Native?.pilotRegistry.weeklyNativeSummaryDraft.deferReason,
      },
    },
    phaseMemory: {
      phase1GaveUs:
        "Phase 1 gave us the project control tower, saved views, derived PM signals, weekly reviews, and durable roadmap memory.",
      phase2Added:
        "Phase 2 gave us structured execution data: decisions, work packets, tasks, blockers, throughput, and weekly execution history.",
      phase3Added:
        "Phase 3 gave us structured recommendation memory, recommendation-run history, and reviewed cross-database link intelligence.",
      phase4Added:
        "Phase 4 gave us stable native dashboards, in-Notion review nudges, and bounded premium-native pilots layered on top of the repo-owned operating system.",
      phase5Brief:
        "Phase 5 will bring in external repo, deploy, calendar, and workflow signals as additive recommendation inputs so the operating system can compare Notion memory with real execution telemetry.",
      phase6Brief:
        "Phase 6 will add cross-system governance and approval gates so recommendations and external signals can safely influence actions outside Notion without losing human control.",
    },
    baselineCapturedAt: config.phase4Native?.baselineCapturedAt ?? input.today,
    baselineMetrics: config.phase4Native?.baselineMetrics,
    lastAuditAt: config.phase4Native?.lastAuditAt,
    lastAuditSummary: config.phase4Native?.lastAuditSummary,
  };
}

export function buildNativeOverlayAuditSummary(
  config: LocalPortfolioControlTowerConfig,
): NativeOverlayAuditSummary {
  const phase4 = requirePhase4Native(config);
  const dashboards = [
    {
      key: "portfolio" as const,
      name: phase4.dashboardRegistry.portfolio.name,
      status: phase4.dashboardRegistry.portfolio.status,
      widgetCount: phase4.dashboardRegistry.portfolio.widgetCount,
      url: phase4.dashboardRegistry.portfolio.url,
      notes: phase4.dashboardRegistry.portfolio.notes,
    },
    {
      key: "execution" as const,
      name: phase4.dashboardRegistry.execution.name,
      status: phase4.dashboardRegistry.execution.status,
      widgetCount: phase4.dashboardRegistry.execution.widgetCount,
      url: phase4.dashboardRegistry.execution.url,
      notes: phase4.dashboardRegistry.execution.notes,
    },
  ];
  const automations = [
    {
      key: "projectReviewReminder" as const,
      name: phase4.automationRegistry.projectReviewReminder.name,
      status: phase4.automationRegistry.projectReviewReminder.status,
      liveMethod: phase4.automationRegistry.projectReviewReminder.liveMethod,
      notes: phase4.automationRegistry.projectReviewReminder.notes,
      deferReason: phase4.automationRegistry.projectReviewReminder.deferReason,
    },
    {
      key: "decisionRevisitReminder" as const,
      name: phase4.automationRegistry.decisionRevisitReminder.name,
      status: phase4.automationRegistry.decisionRevisitReminder.status,
      liveMethod: phase4.automationRegistry.decisionRevisitReminder.liveMethod,
      notes: phase4.automationRegistry.decisionRevisitReminder.notes,
      deferReason: phase4.automationRegistry.decisionRevisitReminder.deferReason,
    },
    {
      key: "weeklyRunReviewReminder" as const,
      name: phase4.automationRegistry.weeklyRunReviewReminder.name,
      status: phase4.automationRegistry.weeklyRunReviewReminder.status,
      liveMethod: phase4.automationRegistry.weeklyRunReviewReminder.liveMethod,
      notes: phase4.automationRegistry.weeklyRunReviewReminder.notes,
      deferReason: phase4.automationRegistry.weeklyRunReviewReminder.deferReason,
    },
  ];
  const pilots = [
    {
      key: "githubDeliverySignals" as const,
      name: phase4.pilotRegistry.githubDeliverySignals.name,
      status: phase4.pilotRegistry.githubDeliverySignals.status,
      liveMethod: phase4.pilotRegistry.githubDeliverySignals.liveMethod,
      notes: phase4.pilotRegistry.githubDeliverySignals.notes,
      deferReason: phase4.pilotRegistry.githubDeliverySignals.deferReason,
    },
    {
      key: "weeklyNativeSummaryDraft" as const,
      name: phase4.pilotRegistry.weeklyNativeSummaryDraft.name,
      status: phase4.pilotRegistry.weeklyNativeSummaryDraft.status,
      liveMethod: phase4.pilotRegistry.weeklyNativeSummaryDraft.liveMethod,
      notes: phase4.pilotRegistry.weeklyNativeSummaryDraft.notes,
      deferReason: phase4.pilotRegistry.weeklyNativeSummaryDraft.deferReason,
      pageUrl: phase4.pilotRegistry.weeklyNativeSummaryDraft.pageUrl,
    },
  ];

  return {
    entitlements: phase4.entitlements,
    dashboards,
    automations,
    pilots,
    counts: {
      activeDashboards: dashboards.filter((entry) => entry.status === "active").length,
      deferredDashboards: dashboards.filter((entry) => entry.status === "deferred").length,
      activeAutomations: automations.filter((entry) => entry.status === "active").length,
      deferredAutomations: automations.filter((entry) => entry.status === "deferred").length,
      activePilots: pilots.filter((entry) => entry.status === "active").length,
      deferredPilots: pilots.filter((entry) => entry.status === "deferred").length,
    },
  };
}

export function renderNativeOverlaySection(input: {
  generatedAt: string;
  config: LocalPortfolioControlTowerConfig;
  summary: NativeOverlayAuditSummary;
}): string {
  const lines = [
    "<!-- codex:notion-native-overlays:start -->",
    "## Native Overlays",
    `Updated: ${input.generatedAt}`,
    "",
    "### Entitlements",
    `- Business workspace verified: ${yesNo(input.summary.entitlements.businessWorkspaceVerified)}`,
    `- Custom agents visible: ${yesNo(input.summary.entitlements.customAgentsVisible)}`,
    `- Synced databases visible: ${yesNo(input.summary.entitlements.syncedDatabasesVisible)}`,
    "",
    "### Dashboards",
    ...input.summary.dashboards.map((dashboard) => {
      const location = dashboard.url ? `[open](${dashboard.url})` : "not linked yet";
      return `- ${dashboard.name}: ${dashboard.status}; ${dashboard.widgetCount} widgets; ${location}`;
    }),
    "",
    "### Reminder Automations",
    ...input.summary.automations.map((automation) =>
      `- ${automation.name}: ${automation.status}; method ${automation.liveMethod}${automation.deferReason ? `; ${automation.deferReason}` : ""}`,
    ),
    "",
    "### Premium Pilots",
    ...input.summary.pilots.map((pilot) =>
      `- ${pilot.name}: ${pilot.status}; method ${pilot.liveMethod}${pilot.pageUrl ? `; [brief](${pilot.pageUrl})` : ""}${pilot.deferReason ? `; ${pilot.deferReason}` : ""}`,
    ),
    "",
    "### Future Phases",
    `- Phase 5: ${requirePhase4Native(input.config).phaseMemory.phase5Brief}`,
    `- Phase 6: ${requirePhase4Native(input.config).phaseMemory.phase6Brief}`,
    "<!-- codex:notion-native-overlays:end -->",
  ];

  return lines.join("\n");
}

export function renderNativeBriefsMarkdown(input: {
  generatedAt: string;
  summary: NativeOverlayAuditSummary;
  dashboardConfig: LocalPortfolioNativeDashboardConfig;
  automationConfig: LocalPortfolioNativeAutomationConfig;
  pilotConfig: LocalPortfolioNativePilotConfig;
  config: LocalPortfolioControlTowerConfig;
}): string {
  const phase4 = requirePhase4Native(input.config);
  const lines = [
    "# Local Portfolio Native Briefs",
    "",
    `Updated: ${input.generatedAt}`,
    "",
    "## Phase 4 Goal",
    "Layer premium-native Notion visibility, nudges, and bounded pilots on top of the repo-owned operating system without moving canonical logic into native features.",
    "",
    "## Dashboard Plan",
    ...input.dashboardConfig.dashboards.flatMap((dashboard) => [
      `### ${dashboard.name}`,
      `- Database: ${dashboard.databaseName}`,
      `- Widget count: ${dashboard.widgets.length}/${dashboard.maxWidgets}`,
      ...dashboard.widgets.map((widget) =>
        widget.kind === "table"
          ? `- Table: ${widget.title} <- ${widget.sourceViewName}`
          : `- Chart: ${widget.title} <- ${widget.groupBy} (${widget.chartType})`,
      ),
      "",
    ]),
    "## Reminder Automation Plan",
    ...input.automationConfig.automations.flatMap((automation) => [
      `### ${automation.name}`,
      `- Trigger: ${automation.triggerSummary}`,
      `- Target: ${automation.reminderTarget}`,
      `- Allowed: ${automation.allowedActions.join("; ")}`,
      `- Forbidden: ${automation.forbiddenActions.join("; ")}`,
      "",
    ]),
    "## Premium Pilot Plan",
    ...input.pilotConfig.pilots.flatMap((pilot) => [
      `### ${pilot.name}`,
      `- Scope: ${pilot.scope}`,
      `- Default status: ${pilot.defaultStatus}`,
      ...pilot.successCriteria.map((criterion) => `- Success: ${criterion}`),
      ...pilot.constraints.map((constraint) => `- Constraint: ${constraint}`),
      ...(pilot.deferReason ? [`- Default defer reason: ${pilot.deferReason}`] : []),
      "",
    ]),
    "## Current Audit Snapshot",
    `- Active dashboards: ${input.summary.counts.activeDashboards}`,
    `- Deferred dashboards: ${input.summary.counts.deferredDashboards}`,
    `- Active automations: ${input.summary.counts.activeAutomations}`,
    `- Deferred automations: ${input.summary.counts.deferredAutomations}`,
    `- Active pilots: ${input.summary.counts.activePilots}`,
    `- Deferred pilots: ${input.summary.counts.deferredPilots}`,
    "",
    "## Phase Memory",
    `- Phase 1 gave us: ${phase4.phaseMemory.phase1GaveUs}`,
    `- Phase 2 gave us: ${phase4.phaseMemory.phase2Added}`,
    `- Phase 3 gave us: ${phase4.phaseMemory.phase3Added}`,
    `- Phase 4 gives us: ${phase4.phaseMemory.phase4Added}`,
    `- Phase 5 will do: ${phase4.phaseMemory.phase5Brief}`,
    `- Phase 6 will do: ${phase4.phaseMemory.phase6Brief}`,
  ];

  return lines.join("\n");
}

export function requirePhase4Native(
  config: LocalPortfolioControlTowerConfig,
): NonNullable<LocalPortfolioControlTowerConfig["phase4Native"]> {
  if (!config.phase4Native) {
    throw new AppError("Control tower config is missing phase4Native");
  }
  return config.phase4Native;
}

function parseDashboardStrategy(raw: unknown): LocalPortfolioNativeDashboardConfig["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native dashboards strategy must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.primary !== "notion_mcp" || value.fallback !== "playwright") {
    throw new AppError('Local portfolio native dashboards strategy must be notion_mcp -> playwright');
  }

  return {
    primary: "notion_mcp",
    fallback: "playwright",
    notes: requiredStringArray(value.notes, "strategy.notes"),
  };
}

function parseDashboardPlans(raw: unknown): NativeDashboardPlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("Local portfolio native dashboards config must include dashboards");
  }

  return raw.map((entry, index) => parseDashboardPlan(entry, `dashboards[${index}]`));
}

function parseDashboardPlan(raw: unknown, fieldName: string): NativeDashboardPlan {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }

  const value = raw as Record<string, unknown>;
  const key = requiredString(value.key, `${fieldName}.key`);
  if (key !== "portfolio" && key !== "execution") {
    throw new AppError(`${fieldName}.key must be portfolio or execution`);
  }
  const databaseKey = requiredString(value.databaseKey, `${fieldName}.databaseKey`);
  if (databaseKey !== "projects" && databaseKey !== "tasks") {
    throw new AppError(`${fieldName}.databaseKey must be projects or tasks`);
  }

  return {
    key,
    name: requiredString(value.name, `${fieldName}.name`),
    databaseKey,
    databaseName: requiredString(value.databaseName, `${fieldName}.databaseName`),
    maxWidgets: requiredPositiveNumber(value.maxWidgets, `${fieldName}.maxWidgets`),
    widgets: parseDashboardWidgets(value.widgets, `${fieldName}.widgets`),
  };
}

function parseDashboardWidgets(raw: unknown, fieldName: string): NativeDashboardWidget[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(`${fieldName} must include at least one widget`);
  }

  return raw.map((entry, index) => parseDashboardWidget(entry, `${fieldName}[${index}]`));
}

function parseDashboardWidget(raw: unknown, fieldName: string): NativeDashboardWidget {
  if (!raw || typeof raw !== "object") {
    throw new AppError(`${fieldName} must be an object`);
  }

  const value = raw as Record<string, unknown>;
  const kind = requiredString(value.kind, `${fieldName}.kind`);
  if (kind === "table") {
    return {
      kind: "table",
      title: requiredString(value.title, `${fieldName}.title`),
      sourceViewName: requiredString(value.sourceViewName, `${fieldName}.sourceViewName`),
    };
  }

  if (kind !== "chart") {
    throw new AppError(`${fieldName}.kind must be chart or table`);
  }

  const chartType = requiredString(value.chartType, `${fieldName}.chartType`);
  if (!CHART_TYPES.has(chartType as NativeChartType)) {
    throw new AppError(`${fieldName}.chartType must be bar, column, or donut`);
  }

  return {
    kind: "chart",
    title: requiredString(value.title, `${fieldName}.title`),
    chartType: chartType as NativeChartType,
    groupBy: requiredString(value.groupBy, `${fieldName}.groupBy`),
    measure: requiredMeasure(value.measure, `${fieldName}.measure`),
    filters: parseWidgetFilters(value.filters, `${fieldName}.filters`),
  };
}

function parseWidgetFilters(raw: unknown, fieldName: string): NativeDashboardWidgetFilter[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new AppError(`${fieldName} must be an array when provided`);
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`${fieldName}[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    const rawFilterValue = value.value;
    if (typeof rawFilterValue !== "string" && typeof rawFilterValue !== "boolean") {
      throw new AppError(`${fieldName}[${index}].value must be a string or boolean`);
    }
    return {
      property: requiredString(value.property, `${fieldName}[${index}].property`),
      value: rawFilterValue,
    };
  });
}

function parseAutomationStrategy(raw: unknown): LocalPortfolioNativeAutomationConfig["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native automations strategy must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.primary !== "playwright" || value.fallback !== "manual") {
    throw new AppError('Local portfolio native automations strategy must be playwright -> manual');
  }

  return {
    primary: "playwright",
    fallback: "manual",
    notes: requiredStringArray(value.notes, "strategy.notes"),
  };
}

function parseAutomationPlans(raw: unknown): NativeAutomationPlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("Local portfolio native automations config must include automations");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`automations[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    const key = requiredString(value.key, `automations[${index}].key`);
    if (
      key !== "projectReviewReminder" &&
      key !== "decisionRevisitReminder" &&
      key !== "weeklyRunReviewReminder"
    ) {
      throw new AppError(`automations[${index}].key is unsupported`);
    }
    const databaseKey = requiredString(value.databaseKey, `automations[${index}].databaseKey`);
    if (databaseKey !== "projects" && databaseKey !== "decisions" && databaseKey !== "recommendationRuns") {
      throw new AppError(`automations[${index}].databaseKey is unsupported`);
    }

    return {
      key: key as NativeAutomationPlan["key"],
      name: requiredString(value.name, `automations[${index}].name`),
      databaseKey: databaseKey as NativeAutomationPlan["databaseKey"],
      recurring: requiredBoolean(value.recurring, `automations[${index}].recurring`),
      cadenceLabel: requiredString(value.cadenceLabel, `automations[${index}].cadenceLabel`),
      nonCanonical: requiredTrue(value.nonCanonical, `automations[${index}].nonCanonical`),
      reminderTarget: requiredString(value.reminderTarget, `automations[${index}].reminderTarget`),
      triggerSummary: requiredString(value.triggerSummary, `automations[${index}].triggerSummary`),
      allowedActions: requiredStringArray(value.allowedActions, `automations[${index}].allowedActions`),
      forbiddenActions: requiredStringArray(value.forbiddenActions, `automations[${index}].forbiddenActions`),
    };
  });
}

function parsePilotStrategy(raw: unknown): LocalPortfolioNativePilotConfig["strategy"] {
  if (!raw || typeof raw !== "object") {
    throw new AppError("Local portfolio native pilots strategy must be an object");
  }

  const value = raw as Record<string, unknown>;
  if (value.primary !== "notion_native" || value.fallback !== "document_and_defer") {
    throw new AppError('Local portfolio native pilots strategy must be notion_native -> document_and_defer');
  }

  return {
    primary: "notion_native",
    fallback: "document_and_defer",
    notes: requiredStringArray(value.notes, "strategy.notes"),
  };
}

function parsePilotPlans(raw: unknown): NativePilotPlan[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError("Local portfolio native pilots config must include pilots");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new AppError(`pilots[${index}] must be an object`);
    }
    const value = entry as Record<string, unknown>;
    const key = requiredString(value.key, `pilots[${index}].key`);
    if (key !== "githubDeliverySignals" && key !== "weeklyNativeSummaryDraft") {
      throw new AppError(`pilots[${index}].key is unsupported`);
    }
    const type = requiredString(value.type, `pilots[${index}].type`);
    if (type !== "synced_database" && type !== "custom_agent") {
      throw new AppError(`pilots[${index}].type is unsupported`);
    }
    const gatedBy = requiredString(value.gatedBy, `pilots[${index}].gatedBy`);
    if (gatedBy !== "business_plan" && gatedBy !== "custom_agents") {
      throw new AppError(`pilots[${index}].gatedBy is unsupported`);
    }

    return {
      key: key as NativePilotPlan["key"],
      name: requiredString(value.name, `pilots[${index}].name`),
      type: type as NativePilotPlan["type"],
      gatedBy: gatedBy as NativePilotPlan["gatedBy"],
      scope: requiredString(value.scope, `pilots[${index}].scope`),
      successCriteria: requiredStringArray(value.successCriteria, `pilots[${index}].successCriteria`),
      constraints: requiredStringArray(value.constraints, `pilots[${index}].constraints`),
      defaultStatus: requiredNativePlanStatus(value.defaultStatus, `pilots[${index}].defaultStatus`),
      deferReason: optionalString(value.deferReason, `pilots[${index}].deferReason`),
    };
  });
}

function buildAvailableSourceViews(
  config: LocalPortfolioControlTowerConfig,
): Record<NativeDashboardDatabaseKey, Set<string>> {
  return {
    projects: new Set([
      ...Object.keys(config.viewIds),
      ...Object.keys(config.phase3Intelligence?.viewIds.projects ?? {}),
    ]),
    tasks: new Set(Object.keys(config.phase2Execution?.viewIds.tasks ?? {})),
  };
}

function assertPropertyExists(
  schema: DataSourceSchemaSnapshot,
  dashboardName: string,
  propertyName: string,
): PropertySchema {
  const property = schema.properties[propertyName];
  if (!property) {
    throw new AppError(`Dashboard "${dashboardName}" references missing property "${propertyName}"`);
  }
  return property;
}

function assertPropertyType(
  dashboardName: string,
  property: PropertySchema,
  allowedTypes: Set<string>,
  usage: string,
): void {
  if (!allowedTypes.has(property.type)) {
    throw new AppError(
      `Dashboard "${dashboardName}" uses property "${property.name}" for ${usage}, but its type is "${property.type}"`,
    );
  }
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requiredString(value, fieldName);
}

function requiredPositiveNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new AppError(`${fieldName} must be a positive number`);
  }
  return value;
}

function requiredBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AppError(`${fieldName} must be a boolean`);
  }
  return value;
}

function requiredTrue(value: unknown, fieldName: string): true {
  if (value !== true) {
    throw new AppError(`${fieldName} must be true`);
  }
  return true;
}

function requiredStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new AppError(`${fieldName} must be a string array`);
  }
  return value.map((entry) => entry.trim());
}

function requiredMeasure(value: unknown, fieldName: string): "count" {
  if (value !== "count") {
    throw new AppError(`${fieldName} must be "count"`);
  }
  return "count";
}

function requiredNativePlanStatus(value: unknown, fieldName: string): NativePlanStatus {
  if (value !== "active" && value !== "deferred" && value !== "missing") {
    throw new AppError(`${fieldName} must be active, deferred, or missing`);
  }
  return value;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}
