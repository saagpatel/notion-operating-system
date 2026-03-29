import { describe, expect, test } from "vitest";

import { selectLatestBuildEvidence } from "../src/notion/activity-refresh.js";

describe("activity refresh", () => {
  test("prefers the newest build session evidence when it is newer than workflow runs", () => {
    const selection = selectLatestBuildEvidence({
      buildSessions: [
        {
          id: "build-1",
          title: "Liminal build log",
          sessionDate: "2026-03-24",
          createdDate: "2026-03-24",
        },
      ],
      workflowRuns: [{ occurredAt: "2026-03-22" }],
    });

    expect(selection.latest).toEqual({
      date: "2026-03-24",
      label: "Liminal build log",
      source: "build_session",
    });
    expect(selection.buildSessionCount).toBe(1);
  });

  test("falls back to workflow evidence when no build session exists", () => {
    const selection = selectLatestBuildEvidence({
      buildSessions: [],
      workflowRuns: [{ occurredAt: "2026-03-22" }],
    });

    expect(selection.latest).toEqual({
      date: "2026-03-22",
      label: "GitHub workflow run",
      source: "workflow_run",
    });
    expect(selection.buildSessionCount).toBe(0);
  });

  test("uses the build page created date when the session date is missing", () => {
    const selection = selectLatestBuildEvidence({
      buildSessions: [
        {
          id: "build-1",
          title: "Ghost Routes build log",
          sessionDate: "",
          createdDate: "2026-03-23",
        },
      ],
      workflowRuns: [{ occurredAt: "2026-03-22" }],
    });

    expect(selection.latest).toEqual({
      date: "2026-03-23",
      label: "Ghost Routes build log",
      source: "build_session",
    });
  });
});
