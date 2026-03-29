import "dotenv/config";

import { Client } from "@notionhq/client";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  addDays,
  applyDerivedSignals,
  buildTopPriorities,
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  fetchAllPages,
  multiSelectValue,
  relationValue,
  richTextValue,
  selectPropertyValue,
  titleValue,
  toBuildSessionRecord,
  toControlTowerProjectRecord,
  upsertPageByTitle,
} from "./local-portfolio-control-tower-live.js";
import {
  buildProjectExecutionContext,
  calculateExecutionMetrics,
  mergeManagedSection,
  renderWeeklyExecutionSection,
  type ExecutionTaskRecord,
  type ProjectDecisionRecord,
  type WorkPacketRecord,
} from "./local-portfolio-execution.js";
import {
  ensurePhase2ExecutionSchema,
  toExecutionTaskRecord,
  toProjectDecisionRecord,
  toWorkPacketRecord,
} from "./local-portfolio-execution-live.js";
import {
  renderWeeklyReviewMarkdown,
  type ControlTowerProjectRecord,
} from "./local-portfolio-control-tower.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday, startOfWeekMonday } from "../utils/date.js";

const WEEKLY_EXECUTION_START = "<!-- codex:notion-weekly-execution:start -->";
const WEEKLY_EXECUTION_END = "<!-- codex:notion-weekly-execution:end -->";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for weekly planning");
    }

    const flags = parseFlags(process.argv.slice(2));
    const today = flags.today ?? losAngelesToday();
    const weekStart = startOfWeekMonday(today);
    const weekTitle = `Week of ${weekStart}`;
    const configPath =
      process.argv[2]?.startsWith("--")
        ? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH
        : process.argv[2] ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
    const config = await loadLocalPortfolioControlTowerConfig(configPath);
    if (!config.phase2Execution) {
      throw new AppError("Control tower config is missing phase2Execution");
    }

    const sdk = new Client({
      auth: token,
      notionVersion: "2026-03-11",
    });
    const api = new DirectNotionClient(token);

    if (flags.live) {
      await ensurePhase2ExecutionSchema(sdk, config);
    }

    const [projectSchema, buildSchema, weeklySchema, decisionSchema, packetSchema, taskSchema] = await Promise.all([
      api.retrieveDataSource(config.database.dataSourceId),
      api.retrieveDataSource(config.relatedDataSources.buildLogId),
      api.retrieveDataSource(config.relatedDataSources.weeklyReviewsId),
      api.retrieveDataSource(config.phase2Execution.decisions.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.packets.dataSourceId),
      api.retrieveDataSource(config.phase2Execution.tasks.dataSourceId),
    ]);

    const [projectPages, buildPages, weeklyPages, decisionPages, packetPages, taskPages] = await Promise.all([
      fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.buildLogId, buildSchema.titlePropertyName),
      fetchAllPages(sdk, config.relatedDataSources.weeklyReviewsId, weeklySchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution.decisions.dataSourceId, decisionSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution.packets.dataSourceId, packetSchema.titlePropertyName),
      fetchAllPages(sdk, config.phase2Execution.tasks.dataSourceId, taskSchema.titlePropertyName),
    ]);

    const projects = projectPages.map((page) => applyDerivedSignals(toControlTowerProjectRecord(page), config, today));
    const buildSessions = buildPages.map((page) => toBuildSessionRecord(page));
    let decisions = decisionPages.map((page) => toProjectDecisionRecord(page));
    let packets = packetPages.map((page) => toWorkPacketRecord(page));
    let tasks = taskPages.map((page) => toExecutionTaskRecord(page));

    const nowProject = pickProject(projects, ["Resume Now", "Worth Finishing", "Needs Review"]);
    const standbyProject = pickProject(
      projects,
      ["Worth Finishing", "Resume Now", "Needs Decision"],
      new Set<string>([nowProject?.id].filter((value): value is string => typeof value === "string")),
    );
    const blockedProject = pickProject(
      projects,
      ["Needs Decision", "Needs Review", "Watch"],
      new Set<string>(
        [nowProject?.id, standbyProject?.id].filter((value): value is string => typeof value === "string"),
      ),
    );

    if (!nowProject || !standbyProject || !blockedProject) {
      throw new AppError("Could not select enough projects to seed the weekly execution system");
    }

    if (flags.live) {
      const committedDecision = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.decisions.dataSourceId,
        titlePropertyName: decisionSchema.titlePropertyName,
        title: `Phase 2 decision - resume ${nowProject.title}`,
        properties: {
          [decisionSchema.titlePropertyName]: titleValue(`Phase 2 decision - resume ${nowProject.title}`),
          Status: selectPropertyValue("Committed"),
          "Decision Type": selectPropertyValue("Priority"),
          "Decision Owner": peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Proposed On": { date: { start: addDays(today, -1) } },
          "Decided On": { date: { start: today } },
          "Revisit By": { date: { start: addDays(today, 7) } },
          "Local Project": relationValue([nowProject.id]),
          "Chosen Option": richTextValue(`Resume ${nowProject.title} with one tight weekly packet.`),
          Rationale: richTextValue(
            `${nowProject.title} is the strongest current resume candidate because it already fits the low-friction execution queue.`,
          ),
          "Expected Impact": richTextValue("Turn project priority into a concrete weekly delivery push."),
        },
        markdown: renderDecisionMarkdown(nowProject.title, "Committed"),
      });

      const proposedDecision = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.decisions.dataSourceId,
        titlePropertyName: decisionSchema.titlePropertyName,
        title: `Phase 2 decision - unblock ${blockedProject.title}`,
        properties: {
          [decisionSchema.titlePropertyName]: titleValue(`Phase 2 decision - unblock ${blockedProject.title}`),
          Status: selectPropertyValue("Proposed"),
          "Decision Type": selectPropertyValue("Delivery"),
          "Decision Owner": peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Proposed On": { date: { start: today } },
          "Revisit By": { date: { start: addDays(today, 7) } },
          "Local Project": relationValue([blockedProject.id]),
          "Options Considered": richTextValue("Finish now; pause; narrow the scope; gather missing evidence."),
          Rationale: richTextValue("This project needs one material decision before execution can continue cleanly."),
          "Expected Impact": richTextValue("Clarify whether the project should be resumed, narrowed, or paused."),
        },
        markdown: renderDecisionMarkdown(blockedProject.title, "Proposed"),
      });

      const nowPacket = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        title: `Phase 2 now packet - ${nowProject.title}`,
        properties: {
          [packetSchema.titlePropertyName]: titleValue(`Phase 2 now packet - ${nowProject.title}`),
          Status: statusValue("In Progress"),
          "Execution State": selectPropertyValue("In Progress"),
          Priority: selectPropertyValue("Now"),
          "Packet Type": selectPropertyValue("Resume"),
          Owner: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Local Project": relationValue([nowProject.id]),
          "Driving Decision": relationValue([committedDecision.id]),
          Goal: richTextValue(`Resume ${nowProject.title} and ship one clean weekly slice.`),
          "Definition of Done": richTextValue("Local environment boots, next slice is implemented, and proof is logged."),
          "Why Now": richTextValue("This is the best low-friction resume candidate in the portfolio right now."),
          "Target Start": { date: { start: today } },
          "Target Finish": { date: { start: addDays(today, 4) } },
          "Estimated Size": selectPropertyValue("2-3 days"),
          "Rollover Count": { number: 0 },
        },
        markdown: renderPacketMarkdown(nowProject.title, "Now"),
      });

      const standbyPacket = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        title: `Phase 2 standby packet - ${standbyProject.title}`,
        properties: {
          [packetSchema.titlePropertyName]: titleValue(`Phase 2 standby packet - ${standbyProject.title}`),
          Status: statusValue("Ready"),
          "Execution State": selectPropertyValue("Ready"),
          Priority: selectPropertyValue("Standby"),
          "Packet Type": selectPropertyValue("Finish Push"),
          Owner: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Local Project": relationValue([standbyProject.id]),
          Goal: richTextValue(`Keep ${standbyProject.title} ready as the next finish push.`),
          "Definition of Done": richTextValue("The packet can start immediately if the Now packet is blocked or finished."),
          "Why Now": richTextValue("This is the highest-value backup packet if the current week shifts."),
          "Target Start": { date: { start: addDays(today, 5) } },
          "Target Finish": { date: { start: addDays(today, 9) } },
          "Estimated Size": selectPropertyValue("2-3 days"),
          "Rollover Count": { number: 0 },
        },
        markdown: renderPacketMarkdown(standbyProject.title, "Standby"),
      });

      const blockedPacket = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        title: `Phase 2 blocked packet - ${blockedProject.title}`,
        properties: {
          [packetSchema.titlePropertyName]: titleValue(`Phase 2 blocked packet - ${blockedProject.title}`),
          Status: statusValue("Blocked"),
          "Execution State": selectPropertyValue("Blocked"),
          Priority: selectPropertyValue("Later"),
          "Packet Type": selectPropertyValue("Review Prep"),
          Owner: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Local Project": relationValue([blockedProject.id]),
          "Driving Decision": relationValue([proposedDecision.id]),
          Goal: richTextValue(`Unblock ${blockedProject.title} by resolving the open project-level decision.`),
          "Definition of Done": richTextValue("The blocking decision is committed and the next packet is clear."),
          "Why Now": richTextValue("This packet should stay visible so the blocker is not lost."),
          "Target Start": { date: { start: today } },
          "Target Finish": { date: { start: addDays(today, 3) } },
          "Estimated Size": selectPropertyValue("1 day"),
          "Rollover Count": { number: 0 },
          "Blocker Summary": richTextValue("A material delivery decision still needs to be made."),
        },
        markdown: renderPacketMarkdown(blockedProject.title, "Blocked"),
      });

      const donePacket = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        title: `Phase 2 done packet - ${nowProject.title}`,
        properties: {
          [packetSchema.titlePropertyName]: titleValue(`Phase 2 done packet - ${nowProject.title}`),
          Status: statusValue("Done"),
          "Execution State": selectPropertyValue("Done"),
          Priority: selectPropertyValue("Later"),
          "Packet Type": selectPropertyValue("Review Prep"),
          Owner: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Local Project": relationValue([nowProject.id]),
          Goal: richTextValue("Capture a completed packet so weekly summaries have history to read from."),
          "Definition of Done": richTextValue("Evidence is recorded and the packet is marked complete."),
          "Why Now": richTextValue("This seeds a clean packet history for the execution system."),
          "Target Start": { date: { start: addDays(today, -4) } },
          "Target Finish": { date: { start: addDays(today, -1) } },
          "Estimated Size": selectPropertyValue("1 day"),
          "Rollover Count": { number: 0 },
        },
        markdown: renderPacketMarkdown(nowProject.title, "Done"),
      });

      const rolloverPacket = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.packets.dataSourceId,
        titlePropertyName: packetSchema.titlePropertyName,
        title: `Phase 2 rollover packet - ${standbyProject.title}`,
        properties: {
          [packetSchema.titlePropertyName]: titleValue(`Phase 2 rollover packet - ${standbyProject.title}`),
          Status: statusValue("Ready"),
          "Execution State": selectPropertyValue("Ready"),
          Priority: selectPropertyValue("Later"),
          "Packet Type": selectPropertyValue("Finish Push"),
          Owner: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Local Project": relationValue([standbyProject.id]),
          Goal: richTextValue("Keep one explicit rollover example for review and reporting."),
          "Definition of Done": richTextValue("The packet either starts cleanly or is dropped intentionally."),
          "Why Now": richTextValue("This gives the weekly review a concrete rollover example."),
          "Target Start": { date: { start: addDays(today, -7) } },
          "Target Finish": { date: { start: addDays(today, -2) } },
          "Estimated Size": selectPropertyValue("2-3 days"),
          "Rollover Count": { number: 1 },
        },
        markdown: renderPacketMarkdown(standbyProject.title, "Rollover"),
      });

      await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.tasks.dataSourceId,
        titlePropertyName: taskSchema.titlePropertyName,
        title: `Boot ${nowProject.title} locally`,
        properties: {
          [taskSchema.titlePropertyName]: titleValue(`Boot ${nowProject.title} locally`),
          Status: statusValue("In Progress"),
          "Execution State": selectPropertyValue("In Progress"),
          Assignee: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Due Date": { date: { start: addDays(today, 1) } },
          Priority: selectPropertyValue("P0"),
          "Task Type": selectPropertyValue("Build"),
          "Work Packet": relationValue([nowPacket.id]),
          "Local Project": relationValue([nowProject.id]),
          Estimate: selectPropertyValue("1h"),
          "Task Notes": richTextValue("Verify the local boot flow and confirm the next slice."),
        },
        markdown: renderTaskMarkdown(nowProject.title, "In Progress"),
      });

      await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.tasks.dataSourceId,
        titlePropertyName: taskSchema.titlePropertyName,
        title: `Document the next slice for ${nowProject.title}`,
        properties: {
          [taskSchema.titlePropertyName]: titleValue(`Document the next slice for ${nowProject.title}`),
          Status: statusValue("Ready"),
          "Execution State": selectPropertyValue("Ready"),
          Assignee: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Due Date": { date: { start: addDays(today, 2) } },
          Priority: selectPropertyValue("P1"),
          "Task Type": selectPropertyValue("Review"),
          "Work Packet": relationValue([nowPacket.id]),
          "Local Project": relationValue([nowProject.id]),
          Estimate: selectPropertyValue("Half day"),
          "Task Notes": richTextValue("Capture the goal, definition of done, and any proof needed for review."),
        },
        markdown: renderTaskMarkdown(nowProject.title, "Ready"),
      });

      const blockedTask = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.tasks.dataSourceId,
        titlePropertyName: taskSchema.titlePropertyName,
        title: `Resolve the blocker on ${blockedProject.title}`,
        properties: {
          [taskSchema.titlePropertyName]: titleValue(`Resolve the blocker on ${blockedProject.title}`),
          Status: statusValue("Blocked"),
          "Execution State": selectPropertyValue("Blocked"),
          Assignee: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Due Date": { date: { start: addDays(today, 1) } },
          Priority: selectPropertyValue("P0"),
          "Task Type": selectPropertyValue("Decision Prep"),
          "Work Packet": relationValue([blockedPacket.id]),
          "Local Project": relationValue([blockedProject.id]),
          Estimate: selectPropertyValue("1h"),
          "Task Notes": richTextValue("The packet cannot proceed until the delivery decision is committed."),
        },
        markdown: renderTaskMarkdown(blockedProject.title, "Blocked"),
      });

      const completedTask = await upsertPageByTitle({
        api,
        dataSourceId: config.phase2Execution.tasks.dataSourceId,
        titlePropertyName: taskSchema.titlePropertyName,
        title: `Capture evidence for the finished ${nowProject.title} packet`,
        properties: {
          [taskSchema.titlePropertyName]: titleValue(`Capture evidence for the finished ${nowProject.title} packet`),
          Status: statusValue("Done"),
          "Execution State": selectPropertyValue("Done"),
          Assignee: peopleValue(config.phase2Execution.defaultOwnerUserId),
          "Due Date": { date: { start: addDays(today, -1) } },
          Priority: selectPropertyValue("P2"),
          "Task Type": selectPropertyValue("Admin"),
          "Work Packet": relationValue([donePacket.id]),
          "Local Project": relationValue([nowProject.id]),
          Estimate: selectPropertyValue("30m"),
          "Completed On": { date: { start: today } },
          "Task Notes": richTextValue("Seed one completed task so weekly flow metrics have real history."),
        },
        markdown: renderTaskMarkdown(nowProject.title, "Done"),
      });

      for (const packet of packets) {
        if (
          packet.priority === "Now" &&
          packet.title !== `Phase 2 now packet - ${nowProject.title}` &&
          packet.status !== "Done" &&
          packet.status !== "Dropped"
        ) {
          await api.updatePageProperties({
            pageId: packet.id,
            properties: {
              Priority: selectPropertyValue("Later"),
            },
          });
        }
        if (
          packet.priority === "Standby" &&
          packet.title !== `Phase 2 standby packet - ${standbyProject.title}` &&
          packet.status !== "Done" &&
          packet.status !== "Dropped"
        ) {
          await api.updatePageProperties({
            pageId: packet.id,
            properties: {
              Priority: selectPropertyValue("Later"),
            },
          });
        }
      }

      decisions = (
        await fetchAllPages(sdk, config.phase2Execution.decisions.dataSourceId, decisionSchema.titlePropertyName)
      ).map((page) => toProjectDecisionRecord(page));
      packets = (
        await fetchAllPages(sdk, config.phase2Execution.packets.dataSourceId, packetSchema.titlePropertyName)
      ).map((page) => toWorkPacketRecord(page));
      tasks = (
        await fetchAllPages(sdk, config.phase2Execution.tasks.dataSourceId, taskSchema.titlePropertyName)
      ).map((page) => toExecutionTaskRecord(page));

      const weekDecisionIds = decisions
        .filter((decision) => decision.status === "Committed" && decision.decidedOn >= weekStart)
        .map((decision) => decision.id);
      const weekPacketIds = packets
        .filter((packet) => packet.targetStart >= weekStart || packet.targetFinish >= weekStart)
        .map((packet) => packet.id);
      const completedTaskIds = tasks
        .filter((task) => task.completedOn && task.completedOn >= weekStart)
        .map((task) => task.id);
      const touchedProjectIds = [
        ...new Set(
          [
            nowProject.id,
            standbyProject.id,
            blockedProject.id,
            ...packets.flatMap((packet) => packet.localProjectIds),
            ...tasks.flatMap((task) => task.localProjectIds),
          ].filter(Boolean),
        ),
      ];
      const touchedProjects = projects.filter((project) => touchedProjectIds.includes(project.id));
      const recentBuildSessions = buildSessions
        .filter((session) => session.sessionDate && session.sessionDate >= addDays(today, -7))
        .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate));
      const baseMarkdown = renderWeeklyReviewMarkdown({
        weekTitle,
        compareStartDate: addDays(weekStart, -7),
        compareLabel: `Since ${addDays(weekStart, -7)} (rolling weekly execution window)`,
        projectsChanged: touchedProjects,
        projectsNeedDecision: projects.filter((project) => project.operatingQueue === "Needs Decision"),
        projectsWorthFinishing: projects.filter((project) => project.operatingQueue === "Worth Finishing"),
        overdueProjects: projects.filter((project) => project.nextReviewDate && project.nextReviewDate <= today),
        staleActiveProjects: projects.filter(
          (project) => project.currentState === "Active Build" && project.evidenceFreshness === "Stale",
        ),
        recentBuildSessions,
        topPrioritiesNextWeek: buildTopPriorities(projects),
      });

      const executionMarkdown = renderWeeklyExecutionSection({
        weekTitle,
        nowPackets: packets.filter((packet) => packet.priority === "Now" && packet.status !== "Done" && packet.status !== "Dropped"),
        standbyPackets: packets.filter(
          (packet) => packet.priority === "Standby" && packet.status !== "Done" && packet.status !== "Dropped",
        ),
        decisionsCommitted: decisions.filter((decision) => decision.status === "Committed" && decision.decidedOn >= weekStart),
        blockedTasks: tasks.filter((task) => task.status === "Blocked"),
        completedTasks: tasks.filter((task) => task.completedOn && task.completedOn >= weekStart),
        rolloverPackets: packets.filter((packet) => packet.rolloverCount > 0),
        nextFocus: [
          `Finish the current Now packet for ${nowProject.title}.`,
          `Keep ${standbyProject.title} ready as the clean fallback packet.`,
          `Resolve the blocking decision on ${blockedProject.title}.`,
        ],
        includeNextPhase: Boolean(flags.includeNextPhase),
        phase3Brief: config.phase2Execution.phaseMemory.phase3Brief,
      });
      const weeklyMarkdown = mergeManagedSection(
        baseMarkdown,
        executionMarkdown,
        WEEKLY_EXECUTION_START,
        WEEKLY_EXECUTION_END,
      );

      await upsertPageByTitle({
        api,
        dataSourceId: config.relatedDataSources.weeklyReviewsId,
        titlePropertyName: weeklySchema.titlePropertyName,
        title: weekTitle,
        properties: {
          [weeklySchema.titlePropertyName]: titleValue(weekTitle),
          "Review Status": selectPropertyValue("Published"),
          "Top Priorities Next Week": richTextValue(buildTopPriorities(projects).join(" ")),
          "Local Projects Touched": relationValue(touchedProjectIds),
          "Build Log Sessions": relationValue(recentBuildSessions.map((session) => session.id)),
          "Work Packets Touched": relationValue(weekPacketIds),
          "Decisions Made": relationValue(weekDecisionIds),
          "Tasks Completed": relationValue(completedTaskIds),
          Tags: multiSelectValue(["notion", "portfolio", "execution-system"]),
        },
        markdown: weeklyMarkdown,
      });
    }

    const metrics = calculateExecutionMetrics({
      decisions,
      packets,
      tasks,
      today,
      config,
    });
    const context = buildProjectExecutionContext({
      project: nowProject,
      decisions,
      packets,
      tasks,
      buildSessions,
      today,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          live: flags.live,
          weekTitle,
          nowProject: nowProject.title,
          standbyProject: standbyProject.title,
          blockedProject: blockedProject.title,
          metrics,
          currentPacket: context.activePacket?.title,
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

function pickProject(
  projects: ControlTowerProjectRecord[],
  queues: Array<ControlTowerProjectRecord["operatingQueue"]>,
  excludedIds = new Set<string>(),
): ControlTowerProjectRecord | undefined {
  for (const queue of queues) {
    const match = projects.find((project) => project.operatingQueue === queue && !excludedIds.has(project.id));
    if (match) {
      return match;
    }
  }

  return projects.find((project) => !excludedIds.has(project.id));
}

function peopleValue(userId?: string): { people: Array<{ id: string }> } {
  return {
    people: userId ? [{ id: userId }] : [],
  };
}

function statusValue(value: string): { status: { name: string } } {
  return {
    status: {
      name: value,
    },
  };
}

function renderDecisionMarkdown(projectTitle: string, status: string): string {
  return [
    `# ${projectTitle} decision`,
    "",
    `Status: ${status}`,
    "",
    "## Context",
    "This decision exists so the execution system has durable project-level rationale, not just task noise.",
  ].join("\n");
}

function renderPacketMarkdown(projectTitle: string, lane: string): string {
  return [
    `# ${projectTitle} packet`,
    "",
    `Lane: ${lane}`,
    "",
    "## Goal",
    "Turn the project priority into one clear weekly commitment.",
  ].join("\n");
}

function renderTaskMarkdown(projectTitle: string, status: string): string {
  return [
    `# ${projectTitle} task`,
    "",
    `Status: ${status}`,
    "",
    "## Why this task exists",
    "Keep the execution packet grounded in visible, trackable work.",
  ].join("\n");
}

function parseFlags(argv: string[]): { live: boolean; today?: string; includeNextPhase: boolean } {
  let live = false;
  let today: string | undefined;
  let includeNextPhase = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--include-next-phase") {
      includeNextPhase = true;
    }
  }

  return { live, today, includeNextPhase };
}

void main();
