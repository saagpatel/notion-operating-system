import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  parseLocalPortfolioViewPlan,
  renderLocalPortfolioViewPlanSummary,
} from "../src/notion/local-portfolio-views.js";

describe("local portfolio views config", () => {
  test("parses the repo view plan and keeps the expected core views", async () => {
    const raw = JSON.parse(await readFile(new URL("../config/local-portfolio-views.json", import.meta.url), "utf8"));
    const plan = parseLocalPortfolioViewPlan(raw);

    expect(plan.database.name).toBe("Local Portfolio Projects");
    expect(plan.views).toHaveLength(8);
    expect(plan.views.map((view) => view.name)).toEqual([
      "Portfolio Home",
      "Resume Now",
      "Worth Finishing",
      "Needs Decision",
      "Needs Review",
      "Cold Storage",
      "By Category",
      "Gallery Snapshot",
    ]);
    expect(plan.views.every((view) => Boolean(view.viewId))).toBe(true);
    expect(renderLocalPortfolioViewPlanSummary(plan)).toContain("notion_mcp primary");
    expect(renderLocalPortfolioViewPlanSummary(plan)).toContain("View ID:");
  });
});
