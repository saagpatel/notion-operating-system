import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
  saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import { mergeManagedSection } from "./local-portfolio-execution.js";
import {
  buildProjectIntelligenceContext,
  buildRecommendation,
  renderIntelligenceCommandCenterSection,
  renderRecommendationBriefSection,
} from "./local-portfolio-intelligence.js";
import {
  toIntelligenceProjectRecord,
  toLinkSuggestionRecord,
  toRecommendationRunRecord,
  toResearchLibraryRecord,
  toSkillLibraryRecord,
  toToolMatrixRecord,
} from "./local-portfolio-intelligence-live.js";
import {
  buildEventKey,
  buildExternalSignalSummary,
  calculateExternalSignalMetrics,
  defaultSyncRunScope,
  getPrimarySourceProjectId,
  loadLocalPortfolioExternalSignalProviderConfig,
  providerCredentialPresent,
  renderExternalSignalBriefSection,
  renderExternalSignalCommandCenterSection,
  renderWeeklyExternalSignalsSection,
  requirePhase5ExternalSignals,
  type ExternalProviderKey,
  type ExternalSignalEventRecord,
  type ExternalSignalProviderPlan,
  type ExternalSignalSourceRecord,
  type ExternalSignalSyncRunRecord,
} from "./local-portfolio-external-signals.js";
import {
  ensurePhase5ExternalSignalSchema,
  toExternalSignalEventRecord,
  toExternalSignalSourceRecord,
  toExternalSignalSyncRunRecord,
} from "./local-portfolio-external-signals-live.js";
import {
  fetchAllPages,
  relationIds,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  toBuildSessionRecord,
} from "./local-portfolio-control-tower-live.js";
import {
  toExecutionTaskRecord,
  toProjectDecisionRecord,
  toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { assertSafeReplacement, buildReplaceCommand } from "../utils/markdown.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";

const RECOMMENDATION_BRIEF_START = "<!-- codex:notion-recommendation-brief:start -->";
const RECOMMENDATION_BRIEF_END = "<!-- codex:notion-recommendation-brief:end -->";
const EXTERNAL_SIGNAL_BRIEF_START = "<!-- codex:notion-external-signal-brief:start -->";
const EXTERNAL_SIGNAL_BRIEF_END = "<!-- codex:notion-external-signal-brief:end -->";
const INTELLIGENCE_COMMAND_CENTER_START = "<!-- codex:notion-intelligence-command-center:start -->";
const INTELLIGENCE_COMMAND_CENTER_END = "<!-- codex:notion-intelligence-command-center:end -->";
const EXTERNAL_SIGNAL_COMMAND_CENTER_START = "<!-- codex:notion-external-signal-command-center:start -->";
const EXTERNAL_SIGNAL_COMMAND_CENTER_END = "<!-- codex:notion-external-signal-command-center:end -->";
const WEEKLY_EXTERNAL_SIGNALS_START = "<!-- codex:notion-weekly-external-signals:start -->";
const WEEKLY_EXTERNAL_SIGNALS_END = "<!-- codex:notion-weekly-external-signals:end -->";

interface NormalizedSignalEvent {
  title: string;
  localProjectId: string;
  sourceId: string;
  provider: ExternalSignalEventRecord["provider"];
  signalType: ExternalSignalEventRecord["signalType"];
  occurredAt: string;
  status: string;
  environment: ExternalSignalEventRecord["environment"];
  severity: ExternalSignalEventRecord["severity"];
  sourceIdValue: string;
  sourceUrl: string;
  eventKey: string;
  summary: string;
  rawExcerpt: string;
}

export interface ProviderSyncResult {
  provider: ExternalSignalSyncRunRecord["provider"];
  status: ExternalSignalSyncRunRecord["status"];
  itemsSeen: number;
  itemsWritten: number;
  itemsDeduped: number;
  failures: number;
  notes: string[];
  cursor: string;
  events: NormalizedSignalEvent[];
  syncedSourceIds: string[];
}

export interface ExternalSignalSyncCommandOptions {
  live?: boolean;
  provider?: "github" | "vercel" | "all";
  today?: string;
  config?: string;
}

export async function runExternalSignalSyncCommand(
  options: ExternalSignalSyncCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for external signal sync");
  const live = options.live ?? false;
  const provider = options.provider ?? "all";
  const today = options.today ?? losAngelesToday();
  const weekStart = startOfWeekMonday(today);
  const configPath = options.config ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let config = await loadLocalPortfolioControlTowerConfig(configPath);

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (live) {
      logLiveStage(live, "Ensuring Phase 5 schema");
      config = await ensurePhase5ExternalSignalSchema(sdk, config);
    }

    const phase5 = requirePhase5ExternalSignals(config);
    const providerConfig = await loadLocalPortfolioExternalSignalProviderConfig();

    logLiveStage(live, "Loading external signal schemas");
    const [
      projectSchema,
      buildSchema,
      weeklySchema,
      researchSchema,
      skillSchema,
      toolSchema,
      decisionSchema,
      packetSchema,
      taskSchema,
      runSchema,
      suggestionSchema,
      sourceSchema,
      eventSchema,
      syncRunSchema,
    ] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
      api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
      api.retrieveDataSource(config.relatedDataSources.researchId),
      api.retrieveDataSource(config.relatedDataSources.skillsId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
      api.retrieveDataSource(config.phase2Execution!.decisions.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.packets.dataSourceId),
      api.retrieveDataSource(config.phase2Execution!.tasks.dataSourceId),
      api.retrieveDataSource(config.phase3Intelligence!.recommendationRuns.dataSourceId),
      api.retrieveDataSource(config.phase3Intelligence!.linkSuggestions.dataSourceId),
      api.retrieveDataSource(phase5.sources.dataSourceId),
      api.retrieveDataSource(phase5.events.dataSourceId),
      api.retrieveDataSource(phase5.syncRuns.dataSourceId),
    ]);

    logLiveStage(live, "Fetching external signal datasets");
    const [
      projectPages,
      buildPages,
      weeklyPages,
      researchPages,
      skillPages,
      toolPages,
      decisionPages,
      packetPages,
      taskPages,
      runPages,
      suggestionPages,
      sourcePages,
      eventPages,
      syncRunPages,
    ] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.weeklyReviewsId, weeklySchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution!.decisions.dataSourceId, decisionSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution!.packets.dataSourceId, packetSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution!.tasks.dataSourceId, taskSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase3Intelligence!.recommendationRuns.dataSourceId, runSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase3Intelligence!.linkSuggestions.dataSourceId, suggestionSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.events.dataSourceId, eventSchema.titlePropertyName),
      fetchAllPages(sdk, phase5.syncRuns.dataSourceId, syncRunSchema.titlePropertyName),
    ]);

    const projects = projectPages.map((page) => toIntelligenceProjectRecord(page));
    const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
    const research = researchPages.map((page) => toResearchLibraryRecord(page));
    const skills = skillPages.map((page) => toSkillLibraryRecord(page));
    const tools = toolPages.map((page) => toToolMatrixRecord(page));
    const decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
    const packets = packetPages.map((page) => toWorkPacketRecord(page));
    const tasks = taskPages.map((page) => toExecutionTaskRecord(page));
    const runs = runPages.map((page) => toRecommendationRunRecord(page));
    const suggestions = suggestionPages.map((page) => toLinkSuggestionRecord(page));
    const sources = sourcePages.map((page) => toExternalSignalSourceRecord(page));
    const existingEvents = eventPages.map((page) => toExternalSignalEventRecord(page));
    const existingSyncRuns = syncRunPages.map((page) => toExternalSignalSyncRunRecord(page));

    let createdEventCount = 0;
    let createdSyncRunCount = 0;
    let providerResults: ProviderSyncResult[] = [];
    const eventKeySet = new Set(existingEvents.map((event) => event.eventKey));
    const sourceMap = new Map(sources.map((source) => [source.id, source]));

    if (live) {
      logLiveStage(live, "Syncing providers", { provider });
      providerResults = await syncProviders({
        flags: { live, provider, today: options.today },
        today,
        phase5,
        providers: providerConfig.providers,
        sources,
        eventKeySet,
      });

      logLiveStage(live, "Writing sync runs", { providerRunCount: providerResults.length });
      for (const result of providerResults) {
        const syncRun = await createSyncRunPage({
          api,
          dataSourceId: phase5.syncRuns.dataSourceId,
          titlePropertyName: syncRunSchema.titlePropertyName,
          today,
          result,
        });
        createdSyncRunCount += 1;
        existingSyncRuns.push(syncRun);

        for (const event of result.events) {
          const created = await createSignalEventPage({
            api,
            dataSourceId: phase5.events.dataSourceId,
            titlePropertyName: eventSchema.titlePropertyName,
            event,
            syncRunId: syncRun.id,
          });
          createdEventCount += 1;
          existingEvents.push(created);
        }

        for (const sourceId of result.syncedSourceIds) {
          const source = sourceMap.get(sourceId);
          if (!source) {
            continue;
          }
          await api.updatePageProperties({
            pageId: source.id,
            properties: {
              "Last Synced At": { date: { start: today } },
            },
          });
          source.lastSyncedAt = today;
        }
      }
    }

    const summaryMap = new Map(
      projects.map((project) => [
        project.id,
        buildExternalSignalSummary({
          project,
          sources,
          events: existingEvents,
          today,
        }),
      ]),
    );

    const recommendations = projects.map((project) => {
      const context = buildProjectIntelligenceContext({
        project,
        researchRecords: research,
        skillRecords: skills,
        toolRecords: tools,
        decisions,
        packets,
        tasks,
        buildSessions,
        today,
      });
      return buildRecommendation(context, summaryMap.get(project.id));
    });

    const latestWeeklyRun = runs
      .filter((run) => run.runType === "Weekly Portfolio")
      .sort((left, right) => right.runDate.localeCompare(left.runDate))[0];
    const latestDailyRun = runs
      .filter((run) => run.runType === "Daily Focus")
      .sort((left, right) => right.runDate.localeCompare(left.runDate))[0];

    let changedProjectPages = 0;
    if (live) {
      logLiveStage(live, "Refreshing project signal briefs", { projectCount: projects.length });
      for (const project of projects) {
        logLoopProgress(live, "external-signal-sync", "Project brief", projects.indexOf(project) + 1, projects.length);
        const recommendation = recommendations.find((entry) => entry.projectId === project.id);
        const summary = summaryMap.get(project.id);
        if (!recommendation || !summary) {
          continue;
        }

        await api.updatePageProperties({
          pageId: project.id,
          properties: {
            "Recommendation Lane": { select: { name: recommendation.lane } },
            "Recommendation Score": { number: recommendation.score },
            "Recommendation Confidence": { select: { name: recommendation.confidence } },
            "Recommendation Updated": { date: { start: today } },
            "External Signal Coverage": { select: { name: summary.coverage } },
            "Latest External Activity": summary.latestExternalActivity
              ? { date: { start: summary.latestExternalActivity } }
              : { date: null },
            "Latest Deployment Status": { select: { name: summary.latestDeploymentStatus } },
            "Open PR Count": { number: summary.openPrCount },
            "Recent Failed Workflow Runs": { number: summary.recentFailedWorkflowRuns },
            "External Signal Updated": summary.externalSignalUpdated
              ? { date: { start: summary.externalSignalUpdated } }
              : { date: null },
          },
        });

        const context = buildProjectIntelligenceContext({
          project: {
            ...project,
            recommendationLane: recommendation.lane,
            recommendationScore: recommendation.score,
            recommendationConfidence: recommendation.confidence,
            recommendationUpdated: today,
            externalSignalCoverage: summary.coverage,
            latestExternalActivity: summary.latestExternalActivity,
            latestDeploymentStatus: summary.latestDeploymentStatus,
            openPrCount: summary.openPrCount,
            recentFailedWorkflowRuns: summary.recentFailedWorkflowRuns,
            externalSignalUpdated: summary.externalSignalUpdated,
          },
          researchRecords: research,
          skillRecords: skills,
          toolRecords: tools,
          decisions,
          packets,
          tasks,
          buildSessions,
          today,
        });

        const previous = await api.readPageMarkdown(project.id);
        const withRecommendation = mergeManagedSection(
          previous.markdown,
          renderRecommendationBriefSection({ context, recommendation }),
          RECOMMENDATION_BRIEF_START,
          RECOMMENDATION_BRIEF_END,
        );
        const nextMarkdown = mergeManagedSection(
          withRecommendation,
          renderExternalSignalBriefSection({ summary }),
          EXTERNAL_SIGNAL_BRIEF_START,
          EXTERNAL_SIGNAL_BRIEF_END,
        );

        if (nextMarkdown !== previous.markdown.trim()) {
          assertSafeReplacement(previous.markdown, nextMarkdown);
          await api.patchPageMarkdown({
            pageId: project.id,
            command: "replace_content",
            newMarkdown: buildReplaceCommand(nextMarkdown),
          });
          changedProjectPages += 1;
        }
      }

      logLiveStage(live, "Refreshing command center and weekly review");
      const previousCommandCenter = await api.readPageMarkdown(config.commandCenter.pageId!);
      const withIntelligence = mergeManagedSection(
        previousCommandCenter.markdown,
        renderIntelligenceCommandCenterSection({
          recommendations,
          projects: projects.map((project) => ({
            ...project,
            recommendationLane: recommendations.find((entry) => entry.projectId === project.id)?.lane,
          })),
          latestWeeklyRun,
          latestDailyRun,
          linkSuggestionQueue: suggestions,
        }),
        INTELLIGENCE_COMMAND_CENTER_START,
        INTELLIGENCE_COMMAND_CENTER_END,
      );
      const withExternalSignals = mergeManagedSection(
        withIntelligence,
        renderExternalSignalCommandCenterSection({
          summaries: [...summaryMap.values()],
          syncRuns: existingSyncRuns,
          projects,
        }),
        EXTERNAL_SIGNAL_COMMAND_CENTER_START,
        EXTERNAL_SIGNAL_COMMAND_CENTER_END,
      );
      if (withExternalSignals !== previousCommandCenter.markdown.trim()) {
        assertSafeReplacement(previousCommandCenter.markdown, withExternalSignals);
        await api.patchPageMarkdown({
          pageId: config.commandCenter.pageId!,
          command: "replace_content",
          newMarkdown: buildReplaceCommand(withExternalSignals),
        });
      }

      const weeklyReview = weeklyPages.find((page) => page.title === `Week of ${weekStart}`);
      if (weeklyReview) {
        const previous = await api.readPageMarkdown(weeklyReview.id);
        const nextMarkdown = mergeManagedSection(
          previous.markdown,
          renderWeeklyExternalSignalsSection({
            summaries: [...summaryMap.values()],
            syncRuns: existingSyncRuns,
          }),
          WEEKLY_EXTERNAL_SIGNALS_START,
          WEEKLY_EXTERNAL_SIGNALS_END,
        );
        if (nextMarkdown !== previous.markdown.trim()) {
          assertSafeReplacement(previous.markdown, nextMarkdown);
          await api.patchPageMarkdown({
            pageId: weeklyReview.id,
            command: "replace_content",
            newMarkdown: buildReplaceCommand(nextMarkdown),
          });
        }
      }

      const externalMetrics = calculateExternalSignalMetrics({
        summaries: [...summaryMap.values()],
      });
      logLiveStage(live, "Persisting external signal metrics");
      const nextConfig = {
        ...config,
        phaseState: {
          ...config.phaseState,
        },
        phase3Intelligence: config.phase3Intelligence
          ? {
              ...config.phase3Intelligence,
              scoringModelVersion: phase5.scoringModelVersion,
            }
          : undefined,
        phase5ExternalSignals: {
          ...phase5,
          baselineCapturedAt: phase5.baselineCapturedAt ?? today,
          baselineMetrics: phase5.baselineMetrics ?? serializeMetrics(externalMetrics),
          lastSyncAt: today,
          lastSyncMetrics: serializeMetrics(externalMetrics),
        },
      };
      await saveLocalPortfolioControlTowerConfig(nextConfig, configPath);
      config = nextConfig;
    }

    const output = {
      ok: true,
      live,
      provider,
      createdEventCount,
      createdSyncRunCount,
      changedProjectPages,
      metrics: calculateExternalSignalMetrics({
        summaries: [...summaryMap.values()],
      }),
    };
    recordCommandOutputSummary(output, {
      status: deriveExternalSignalSyncStatus(providerResults),
      warningCategories: deriveExternalSignalSyncWarningCategories(providerResults),
      metadata: {
        provider,
        providerRunCount: providerResults.length,
      },
    });
    console.log(JSON.stringify(output, null, 2));
}

function logLiveStage(live: boolean, stage: string, details?: Record<string, unknown>): void {
  if (!live) {
    return;
  }

  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[external-signal-sync] ${stage}${suffix}`);
}

function logLoopProgress(live: boolean, scope: string, label: string, index: number, total: number): void {
  if (!live) {
    return;
  }
  if (index === 1 || index === total || index % 10 === 0) {
    console.error(`[${scope}] ${label} ${index}/${total}`);
  }
}

export function deriveExternalSignalSyncStatus(
  providerResults: ProviderSyncResult[],
): "completed" | "warning" | "partial" | undefined {
  if (providerResults.some((result) => result.status === "Partial")) {
    return "partial";
  }
  if (
    providerResults.some((result) =>
      result.notes.some((note) => note.includes("Missing ") || note.includes("intentionally deferred")),
    )
  ) {
    return "warning";
  }
  return undefined;
}

export function deriveExternalSignalSyncWarningCategories(
  providerResults: ProviderSyncResult[],
): Array<"partial_success" | "missing_credentials" | "unsupported_provider"> | undefined {
  const categories = new Set<"partial_success" | "missing_credentials" | "unsupported_provider">();
  for (const result of providerResults) {
    if (result.status === "Partial") {
      categories.add("partial_success");
    }
    for (const note of result.notes) {
      if (note.includes("Missing ")) {
        categories.add("missing_credentials");
      }
      if (note.includes("intentionally deferred")) {
        categories.add("unsupported_provider");
      }
    }
  }
  return categories.size > 0 ? [...categories] : undefined;
}

export async function syncProviders(input: {
  flags: { provider: "github" | "vercel" | "all"; live: boolean; today?: string };
  today: string;
  phase5: NonNullable<Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>["phase5ExternalSignals"]>;
  providers: ExternalSignalProviderPlan[];
  sources: ExternalSignalSourceRecord[];
  eventKeySet: Set<string>;
}): Promise<ProviderSyncResult[]> {
  const selectedProviders =
    input.flags.provider === "all"
      ? input.providers.filter((provider) => provider.enabled)
      : input.providers.filter((provider) => provider.key === input.flags.provider);

  const results: ProviderSyncResult[] = [];
  for (const provider of selectedProviders) {
    const sources = input.sources.filter(
      (source) =>
        source.status === "Active" &&
        Boolean(source.identifier.trim()) &&
        normalizeProviderName(source.provider) === provider.key,
    );
    logLiveStage(input.flags.live, "Provider source set prepared", {
      provider: provider.key,
      sourceCount: sources.length,
    });
    if (provider.key === "github") {
      results.push(await syncGithubSources(provider, sources, input.phase5.syncLimits.maxEventsPerSource, input.today, input.eventKeySet));
      continue;
    }
    if (provider.key === "vercel") {
      results.push(await syncVercelSources(provider, sources, input.phase5.syncLimits.maxEventsPerSource, input.today, input.eventKeySet));
      continue;
    }
    results.push({
      provider: provider.displayName as ProviderSyncResult["provider"],
      status: "Partial",
      itemsSeen: 0,
      itemsWritten: 0,
      itemsDeduped: 0,
      failures: 0,
      notes: ["Provider scaffold exists, but live sync is intentionally deferred in the first Phase 5 slice."],
      cursor: "",
      events: [],
      syncedSourceIds: [],
    });
  }

  return results;
}

export async function syncGithubSources(
  provider: ExternalSignalProviderPlan,
  sources: ExternalSignalSourceRecord[],
  maxEventsPerSource: number,
  today: string,
  eventKeySet: Set<string>,
): Promise<ProviderSyncResult> {
  if (sources.length === 0) {
    return emptyProviderResult(provider.displayName as ProviderSyncResult["provider"], "No active GitHub sources are ready for sync.");
  }
  if (!providerCredentialPresent(provider)) {
    return {
      ...emptyProviderResult(provider.displayName as ProviderSyncResult["provider"], `Missing ${provider.authEnvVar} for live GitHub sync.`),
      status: "Failed",
      failures: sources.length,
    };
  }

  const token = process.env[provider.authEnvVar]!.trim();
  const events: NormalizedSignalEvent[] = [];
  const notes: string[] = [];
  let itemsSeen = 0;
  let itemsDeduped = 0;
  let failures = 0;
  const syncedSourceIds: string[] = [];

  for (const source of sources) {
    try {
      logLiveStage(true, "Syncing GitHub source", {
        sourceTitle: source.title,
        identifier: source.identifier,
      });
      const localProjectId = getPrimarySourceProjectId(source);
      if (!localProjectId) {
        failures += 1;
        notes.push(`GitHub sync skipped for ${source.title}: active source is missing a linked Local Project.`);
        continue;
      }
      const repo = source.identifier.trim();
      const [pullsResponse, workflowResponse] = await Promise.all([
        fetchProviderJson(`${provider.baseUrl}/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${maxEventsPerSource}`, {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        }),
        fetchProviderJson(`${provider.baseUrl}/repos/${repo}/actions/runs?per_page=${maxEventsPerSource}`, {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        }),
      ]);

      const pulls = Array.isArray(pullsResponse) ? pullsResponse : [];
      const runs = Array.isArray(workflowResponse?.workflow_runs) ? workflowResponse.workflow_runs : [];
      itemsSeen += pulls.length + runs.length;

      for (const pull of pulls) {
        const eventKey = buildEventKey(["github", "pull_request", repo, String(pull.id ?? pull.number ?? ""), String(pull.state ?? "open")]);
        if (eventKeySet.has(eventKey)) {
          itemsDeduped += 1;
          continue;
        }
        eventKeySet.add(eventKey);
        events.push({
          title: `PR #${pull.number} - ${String(pull.title ?? "Untitled pull request")}`,
          localProjectId,
          sourceId: source.id,
          provider: "GitHub",
          signalType: "Pull Request",
          occurredAt: formatExternalDate(pull.updated_at),
          status: pull.draft ? "draft" : String(pull.state ?? "open"),
          environment: "N/A",
          severity: "Info",
          sourceIdValue: String(pull.id ?? pull.number ?? ""),
          sourceUrl: String(pull.html_url ?? source.sourceUrl ?? ""),
          eventKey,
          summary: `Open pull request #${pull.number} in ${repo}.`,
          rawExcerpt: `state=${String(pull.state ?? "open")}, draft=${String(Boolean(pull.draft))}`,
        });
      }

      for (const run of runs) {
        const derivedStatus = String(run.conclusion ?? run.status ?? "unknown");
        const eventKey = buildEventKey(["github", "workflow_run", repo, String(run.id ?? ""), derivedStatus]);
        if (eventKeySet.has(eventKey)) {
          itemsDeduped += 1;
          continue;
        }
        eventKeySet.add(eventKey);
        events.push({
          title: String(run.display_title ?? run.name ?? `Workflow run ${run.id}`),
          localProjectId,
          sourceId: source.id,
          provider: "GitHub",
          signalType: "Workflow Run",
          occurredAt: formatExternalDate(run.updated_at ?? run.created_at),
          status: derivedStatus,
          environment: "N/A",
          severity: isFailureStatus(derivedStatus) ? "Risk" : "Info",
          sourceIdValue: String(run.id ?? ""),
          sourceUrl: String(run.html_url ?? source.sourceUrl ?? ""),
          eventKey,
          summary: `Workflow run ${String(run.name ?? run.id)} finished with ${derivedStatus}.`,
          rawExcerpt: `status=${String(run.status ?? "")}, conclusion=${String(run.conclusion ?? "")}`,
        });
      }

      syncedSourceIds.push(source.id);
    } catch (error) {
      failures += 1;
      notes.push(`GitHub sync failed for ${source.title}: ${toErrorMessage(error)}`);
    }
  }

  return {
    provider: "GitHub",
    status: failures > 0 && events.length > 0 ? "Partial" : failures > 0 ? "Failed" : "Succeeded",
    itemsSeen,
    itemsWritten: events.length,
    itemsDeduped,
    failures,
    notes,
    cursor: newestOccurredAt(events) || today,
    events,
    syncedSourceIds,
  };
}

export async function syncVercelSources(
  provider: ExternalSignalProviderPlan,
  sources: ExternalSignalSourceRecord[],
  maxEventsPerSource: number,
  today: string,
  eventKeySet: Set<string>,
): Promise<ProviderSyncResult> {
  if (sources.length === 0) {
    return emptyProviderResult(provider.displayName as ProviderSyncResult["provider"], "No active Vercel sources are ready for sync.");
  }
  if (!providerCredentialPresent(provider)) {
    return {
      ...emptyProviderResult(provider.displayName as ProviderSyncResult["provider"], `Missing ${provider.authEnvVar} for live Vercel sync.`),
      status: "Failed",
      failures: sources.length,
    };
  }

  const token = process.env[provider.authEnvVar]!.trim();
  const events: NormalizedSignalEvent[] = [];
  const notes: string[] = [];
  let itemsSeen = 0;
  let itemsDeduped = 0;
  let failures = 0;
  const syncedSourceIds: string[] = [];

  for (const source of sources) {
    try {
      logLiveStage(true, "Syncing Vercel source", {
        sourceTitle: source.title,
        identifier: source.identifier,
      });
      const localProjectId = getPrimarySourceProjectId(source);
      if (!localProjectId) {
        failures += 1;
        notes.push(`Vercel sync skipped for ${source.title}: active source is missing a linked Local Project.`);
        continue;
      }
      const response = await fetchProviderJson(
        `${provider.baseUrl}/v6/deployments?projectId=${encodeURIComponent(source.identifier.trim())}&limit=${maxEventsPerSource}`,
        {
          Authorization: `Bearer ${token}`,
        },
      );
      const deployments = Array.isArray(response?.deployments)
        ? response.deployments
        : Array.isArray(response)
          ? response
          : [];
      itemsSeen += deployments.length;

      for (const deployment of deployments) {
        const status = String(
          deployment.readyState ?? deployment.state ?? deployment.status ?? deployment.ready ?? "unknown",
        );
        const eventKey = buildEventKey(["vercel", "deployment", source.identifier, String(deployment.uid ?? deployment.id ?? ""), status]);
        if (eventKeySet.has(eventKey)) {
          itemsDeduped += 1;
          continue;
        }
        eventKeySet.add(eventKey);
        const environment = String(deployment.target ?? deployment.meta?.target ?? "production").toLowerCase().includes("preview")
          ? "Preview"
          : "Production";
        events.push({
          title: `Deployment - ${String(deployment.name ?? deployment.uid ?? deployment.id ?? source.identifier)}`,
          localProjectId,
          sourceId: source.id,
          provider: "Vercel",
          signalType: "Deployment",
          occurredAt: formatExternalDate(deployment.createdAt ?? deployment.created),
          status,
          environment,
          severity: isFailureStatus(status) ? "Risk" : status.toLowerCase().includes("build") ? "Watch" : "Info",
          sourceIdValue: String(deployment.uid ?? deployment.id ?? ""),
          sourceUrl: normalizeVercelUrl(deployment.url) || source.sourceUrl || "",
          eventKey,
          summary: `Deployment status is ${status.toLowerCase()} for ${source.identifier}.`,
          rawExcerpt: `readyState=${String(deployment.readyState ?? "")}, target=${String(deployment.target ?? "")}`,
        });
      }

      syncedSourceIds.push(source.id);
    } catch (error) {
      failures += 1;
      notes.push(`Vercel sync failed for ${source.title}: ${toErrorMessage(error)}`);
    }
  }

  return {
    provider: "Vercel",
    status: failures > 0 && events.length > 0 ? "Partial" : failures > 0 ? "Failed" : "Succeeded",
    itemsSeen,
    itemsWritten: events.length,
    itemsDeduped,
    failures,
    notes,
    cursor: newestOccurredAt(events) || today,
    events,
    syncedSourceIds,
  };
}

async function createSyncRunPage(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  today: string;
  result: ProviderSyncResult;
}): Promise<ExternalSignalSyncRunRecord> {
  const title = `${input.result.provider} sync - ${input.today}`;
  const markdown = [
    `# ${title}`,
    "",
    `- Provider: ${input.result.provider}`,
    `- Status: ${input.result.status}`,
    `- Items seen: ${input.result.itemsSeen}`,
    `- Items written: ${input.result.itemsWritten}`,
    `- Items deduped: ${input.result.itemsDeduped}`,
    `- Failures: ${input.result.failures}`,
    "",
    "## Notes",
    ...(input.result.notes.length > 0 ? input.result.notes.map((note) => `- ${note}`) : ["- No provider-specific notes."]),
  ].join("\n");
  const created = await input.api.createPageWithMarkdown({
    parent: {
      data_source_id: input.dataSourceId,
    },
    properties: {
      [input.titlePropertyName]: titleValue(title),
    },
    markdown,
  });
  await input.api.updatePageProperties({
    pageId: created.id,
    properties: {
      Provider: selectPropertyValue(input.result.provider),
      Status: selectPropertyValue(input.result.status),
      "Started At": { date: { start: input.today } },
      "Completed At": { date: { start: input.today } },
      Scope: richTextValue(defaultSyncRunScope(input.result.provider, input.result.syncedSourceIds.length)),
      "Items Seen": { number: input.result.itemsSeen },
      "Items Written": { number: input.result.itemsWritten },
      "Items Deduped": { number: input.result.itemsDeduped },
      Failures: { number: input.result.failures },
      "Cursor / Sync Token": richTextValue(input.result.cursor),
      Notes: richTextValue(input.result.notes.join(" | ")),
    },
  });

  return {
    id: created.id,
    url: created.url,
    title,
    provider: input.result.provider,
    status: input.result.status,
    startedAt: input.today,
    completedAt: input.today,
    scope: defaultSyncRunScope(input.result.provider, input.result.syncedSourceIds.length),
    itemsSeen: input.result.itemsSeen,
    itemsWritten: input.result.itemsWritten,
    itemsDeduped: input.result.itemsDeduped,
    failures: input.result.failures,
    cursor: input.result.cursor,
    notes: input.result.notes.join(" | "),
  };
}

async function createSignalEventPage(input: {
  api: DirectNotionClient;
  dataSourceId: string;
  titlePropertyName: string;
  event: NormalizedSignalEvent;
  syncRunId: string;
}): Promise<ExternalSignalEventRecord> {
  const markdown = [
    `# ${input.event.title}`,
    "",
    `- Provider: ${input.event.provider}`,
    `- Signal type: ${input.event.signalType}`,
    `- Status: ${input.event.status}`,
    `- Occurred at: ${input.event.occurredAt}`,
    `- Severity: ${input.event.severity}`,
    "",
    "## Summary",
    input.event.summary,
    "",
    "## Raw Excerpt",
    input.event.rawExcerpt || "No raw excerpt captured.",
  ].join("\n");
  const created = await input.api.createPageWithMarkdown({
    parent: {
      data_source_id: input.dataSourceId,
    },
    properties: {
      [input.titlePropertyName]: titleValue(input.event.title),
    },
    markdown,
  });
  await input.api.updatePageProperties({
    pageId: created.id,
    properties: {
      "Local Project": relationValue([input.event.localProjectId]),
      Source: relationValue([input.event.sourceId]),
      Provider: selectPropertyValue(input.event.provider),
      "Signal Type": selectPropertyValue(input.event.signalType),
      "Occurred At": { date: { start: input.event.occurredAt } },
      Status: richTextValue(input.event.status),
      Environment: selectPropertyValue(input.event.environment),
      Severity: selectPropertyValue(input.event.severity),
      "Source ID": richTextValue(input.event.sourceIdValue),
      "Source URL": input.event.sourceUrl ? { url: input.event.sourceUrl } : { url: null },
      "Sync Run": relationValue([input.syncRunId]),
      "Event Key": richTextValue(input.event.eventKey),
      Summary: richTextValue(input.event.summary),
      "Raw Excerpt": richTextValue(input.event.rawExcerpt),
    },
  });

  return {
    id: created.id,
    url: created.url,
    title: input.event.title,
    localProjectIds: [input.event.localProjectId],
    sourceIds: [input.event.sourceId],
    provider: input.event.provider,
    signalType: input.event.signalType,
    occurredAt: input.event.occurredAt,
    status: input.event.status,
    environment: input.event.environment,
    severity: input.event.severity,
    sourceIdValue: input.event.sourceIdValue,
    sourceUrl: input.event.sourceUrl,
    syncRunIds: [input.syncRunId],
    eventKey: input.event.eventKey,
    summary: input.event.summary,
    rawExcerpt: input.event.rawExcerpt,
  };
}

async function fetchProviderJson(url: string, headers: Record<string, string>, attempt = 0): Promise<any> {
  const response = await fetch(url, {
    headers,
  });
  if (response.ok) {
    return response.json();
  }

  const retryAfter = Number(response.headers.get("retry-after") ?? "0");
  if ((response.status === 429 || response.status === 403) && attempt < 2) {
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1500;
    await wait(delayMs);
    return fetchProviderJson(url, headers, attempt + 1);
  }

  const body = await response.text();
  throw new AppError(`Provider request failed (${response.status}) for ${url}: ${body.slice(0, 300)}`);
}

function newestOccurredAt(events: NormalizedSignalEvent[]): string {
  return [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]?.occurredAt ?? "";
}

function formatExternalDate(value: unknown): string {
  if (typeof value === "number") {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }
  return losAngelesToday();
}

export function normalizeProviderName(
  value: ExternalSignalSourceRecord["provider"],
): ExternalProviderKey | undefined {
  switch (value) {
    case "GitHub":
      return "github";
    case "Vercel":
      return "vercel";
    case "Google Calendar":
      return "google_calendar";
    default:
      return undefined;
  }
}

function normalizeVercelUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }
  return value.startsWith("http") ? value : `https://${value}`;
}

function isFailureStatus(value: string): boolean {
  return ["failed", "failure", "error", "timed_out", "cancelled", "canceled"].includes(value.toLowerCase());
}

function emptyProviderResult(
  provider: ProviderSyncResult["provider"],
  note: string,
): ProviderSyncResult {
  return {
    provider,
    status: "Succeeded",
    itemsSeen: 0,
    itemsWritten: 0,
    itemsDeduped: 0,
    failures: 0,
    notes: [note],
    cursor: "",
    events: [],
    syncedSourceIds: [],
  };
}

function serializeMetrics(metrics: ReturnType<typeof calculateExternalSignalMetrics>): Record<string, number> {
  return {
    mappedProjects: metrics.mappedProjects,
    projectsNeedingMapping: metrics.projectsNeedingMapping,
    activeSources: metrics.activeSources,
    riskEvents: metrics.riskEvents,
    successfulDeployments: metrics.successfulDeployments,
    failedWorkflowRuns: metrics.failedWorkflowRuns,
    contradictionProjects: metrics.contradictionProjects,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["signals", "sync"]);
}
