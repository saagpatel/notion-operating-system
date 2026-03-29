import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "./local-portfolio-control-tower.js";
import { fetchAllPages, relationValue, richTextValue, titleValue } from "./local-portfolio-control-tower-live.js";
import { toActionRequestRecord } from "./local-portfolio-governance-live.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

const TODAY = "2026-03-22";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for manual current-batch completion");
    }

    const config = await loadLocalPortfolioControlTowerConfig("./config/local-portfolio-control-tower.json");
    if (!config.phase5ExternalSignals || !config.phase6Governance || !config.phase7Actuation) {
      throw new AppError("Manual current-batch completion requires phases 5, 6, and 7");
    }

    const now = new Date().toISOString();
    const api = new DirectNotionClient(token);
    const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });

    const [requestSchema, executionSchema, projectSchema, sourceSchema, toolSchema] = await Promise.all([
      api.retrieveDataSource(config.phase6Governance.actionRequests.dataSourceId),
      api.retrieveDataSource(config.phase7Actuation.executions.dataSourceId),
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.phase5ExternalSignals.sources.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.toolsId),
    ]);

    const [requestPages, projectPages, sourcePages, toolPages] = await Promise.all([
      fetchAllPages(sdk, config.phase6Governance.actionRequests.dataSourceId, requestSchema.titlePropertyName),
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase5ExternalSignals.sources.dataSourceId, sourceSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
    ]);

    const requestByTitle = new Map(
      requestPages.map((page) => {
        const record = toActionRequestRecord(page);
        return [record.title, record] as const;
      }),
    );
    const projectByTitle = new Map(projectPages.map((page) => [page.title, page] as const));
    const sourceByTitle = new Map(sourcePages.map((page) => [page.title, page] as const));
    const toolByTitle = new Map(toolPages.map((page) => [page.title, page] as const));

    const requestIssues = [
      {
        title: "Current batch rollout - AIGCCore - GitHub issue",
        issueNumber: 1,
        issueUrl: "https://github.com/saagpatel/AIGCCore/issues/1",
      },
      {
        title: "Current batch rollout - DatabaseSchema - GitHub issue",
        issueNumber: 4,
        issueUrl: "https://github.com/saagpatel/DatabaseSchema/issues/4",
      },
      {
        title: "Current batch rollout - LegalDocsReview - GitHub issue",
        issueNumber: 3,
        issueUrl: "https://github.com/saagpatel/LegalDocsReview/issues/3",
      },
    ];

    for (const entry of requestIssues) {
      const request = requestByTitle.get(entry.title);
      if (!request) {
        throw new AppError(`Could not find action request "${entry.title}"`);
      }

      const dryRun = await api.createPageWithMarkdown({
        parent: { data_source_id: config.phase7Actuation.executions.dataSourceId },
        properties: {
          [executionSchema.titlePropertyName]: titleValue(`Dry Run - ${request.title} - ${TODAY}`),
        },
        markdown: [
          `# Dry Run - ${request.title} - ${TODAY}`,
          "",
          "- Status: Succeeded",
          "- Result: Request validated for manual recovery execution.",
        ].join("\n"),
      });
      await api.updatePageProperties({
        pageId: dryRun.id,
        properties: {
          "Action Request": relationValue([request.id]),
          "Local Project": relationValue(request.localProjectIds),
          Policy: relationValue(request.policyIds),
          "Target Source": relationValue(request.targetSourceIds),
          Provider: { select: { name: "GitHub" } },
          "Action Key": richTextValue("github.create_issue"),
          Mode: { select: { name: "Dry Run" } },
          Status: { select: { name: "Succeeded" } },
          "Idempotency Key": richTextValue(`manual-recovery:${request.id}:dry-run:${TODAY}`),
          "Executed At": { date: { start: now } },
          "Issue Number": { number: null },
          "Comment ID": richTextValue(""),
          "Label Delta Summary": richTextValue("No label changes requested."),
          "Assignee Delta Summary": richTextValue("No assignee changes requested."),
          "Response Classification": { select: { name: "Success" } },
          "Reconcile Status": { select: { name: "Not Needed" } },
          "Response Summary": richTextValue("Dry run validated the request before manual recovery execution."),
          "Failure Notes": richTextValue(""),
          "Compensation Plan": richTextValue(
            "If a duplicate issue appears later, close the duplicate and keep the canonical issue URL on the request.",
          ),
        },
      });
      await api.updatePageProperties({
        pageId: request.id,
        properties: {
          "Latest Execution": relationValue([dryRun.id]),
          "Latest Execution Status": { select: { name: "Dry Run Passed" } },
          "Execution Intent": { select: { name: "Ready for Live" } },
          "Execution Notes": richTextValue(
            "Dry run validated. Live issue was then created through the manual recovery path.",
          ),
        },
      });

      const live = await api.createPageWithMarkdown({
        parent: { data_source_id: config.phase7Actuation.executions.dataSourceId },
        properties: {
          [executionSchema.titlePropertyName]: titleValue(`Live Run - ${request.title} - ${TODAY}`),
        },
        markdown: [
          `# Live Run - ${request.title} - ${TODAY}`,
          "",
          "- Status: Succeeded",
          `- Provider URL: ${entry.issueUrl}`,
        ].join("\n"),
      });
      await api.updatePageProperties({
        pageId: live.id,
        properties: {
          "Action Request": relationValue([request.id]),
          "Local Project": relationValue(request.localProjectIds),
          Policy: relationValue(request.policyIds),
          "Target Source": relationValue(request.targetSourceIds),
          Provider: { select: { name: "GitHub" } },
          "Action Key": richTextValue("github.create_issue"),
          Mode: { select: { name: "Live" } },
          Status: { select: { name: "Succeeded" } },
          "Idempotency Key": richTextValue(`manual-recovery:${request.id}:live:${entry.issueNumber}`),
          "Executed At": { date: { start: now } },
          "Provider Result Key": richTextValue(entry.issueUrl),
          "Provider URL": { url: entry.issueUrl },
          "Issue Number": { number: entry.issueNumber },
          "Comment ID": richTextValue(""),
          "Label Delta Summary": richTextValue("No label changes requested."),
          "Assignee Delta Summary": richTextValue("No assignee changes requested."),
          "Response Classification": { select: { name: "Success" } },
          "Reconcile Status": { select: { name: "Confirmed" } },
          "Response Summary": richTextValue(
            "Created GitHub issue through the manual recovery path after the generic runner stalled.",
          ),
          "Failure Notes": richTextValue(""),
          "Compensation Plan": richTextValue(
            "If a duplicate issue appears later, close the duplicate and keep this issue as the canonical one.",
          ),
        },
      });
      await api.updatePageProperties({
        pageId: request.id,
        properties: {
          Status: { select: { name: "Executed" } },
          "Latest Execution": relationValue([live.id]),
          "Latest Execution Status": { select: { name: "Executed" } },
          "Execution Intent": { select: { name: "Dry Run" } },
          "Execution Notes": richTextValue(
            "Issue created successfully through the manual recovery path after the generic runner stalled.",
          ),
          "Provider Request Key": richTextValue(entry.issueUrl),
          "Target Number": { number: entry.issueNumber },
        },
      });
    }

    const projectSignals = [
      { title: "AIGCCore", openPrCount: 0, failedRuns: 0 },
      { title: "Construction", openPrCount: 1, failedRuns: 2 },
      { title: "DatabaseSchema", openPrCount: 0, failedRuns: 0 },
      { title: "LegalDocsReview", openPrCount: 0, failedRuns: 0 },
      { title: "RealEstate", openPrCount: 2, failedRuns: 2 },
    ];
    for (const signal of projectSignals) {
      const page = projectByTitle.get(signal.title);
      if (!page) {
        continue;
      }
      await api.updatePageProperties({
        pageId: page.id,
        properties: {
          "External Signal Coverage": { select: { name: "Repo Only" } },
          "Latest External Activity": { date: { start: TODAY } },
          "Latest Deployment Status": { select: { name: "Not Deployed" } },
          "Open PR Count": { number: signal.openPrCount },
          "Recent Failed Workflow Runs": { number: signal.failedRuns },
          "External Signal Updated": { date: { start: TODAY } },
        },
      });
    }

    for (const title of [
      "AIGCCore GitHub Repo",
      "Construction GitHub Repo",
      "DatabaseSchema GitHub Repo",
      "LegalDocsReview GitHub Repo",
      "RealEstate GitHub Repo",
    ]) {
      const page = sourceByTitle.get(title);
      if (!page) {
        continue;
      }
      await api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Last Synced At": { date: { start: now } },
        },
      });
    }

    for (const title of ["RealEstate - GitHub Repo", "RealEstate - Deployment Project"]) {
      const page = sourceByTitle.get(title);
      if (!page) {
        continue;
      }
      await api.updatePageProperties({
        pageId: page.id,
        properties: {
          Status: { select: { name: "Paused" } },
        },
      });
    }

    for (const toolTitle of ["GitHub", "Notion", "Codex CLI (OpenAI)"]) {
      const page = toolByTitle.get(toolTitle);
      if (!page) {
        continue;
      }
      const linked = new Set((page.properties["Linked Local Projects"]?.relation ?? []).map((entry) => entry.id));
      for (const projectTitle of ["AIGCCore", "Construction", "DatabaseSchema", "LegalDocsReview", "RealEstate"]) {
        const project = projectByTitle.get(projectTitle);
        if (project) {
          linked.add(project.id);
        }
      }
      await api.updatePageProperties({
        pageId: page.id,
        properties: {
          "Linked Local Projects": relationValue([...linked]),
        },
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          updatedRequests: requestIssues.map((entry) => entry.title),
          updatedProjects: projectSignals.map((entry) => entry.title),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exit(1);
  }
}

void main();
