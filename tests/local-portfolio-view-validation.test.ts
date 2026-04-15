import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
	parseLocalPortfolioViewPlan,
	validateLocalPortfolioViewPlanAgainstSchema,
} from "../src/notion/local-portfolio-views.js";
import type { DataSourceSchemaSnapshot } from "../src/types.js";

const SCHEMA: DataSourceSchemaSnapshot = {
	id: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
	title: "Local Portfolio Projects",
	titlePropertyName: "Name",
	properties: {
		Name: { name: "Name", type: "title", writable: true },
		"Current State": { name: "Current State", type: "select", writable: true },
		"Portfolio Call": {
			name: "Portfolio Call",
			type: "select",
			writable: true,
		},
		"One-Line Pitch": {
			name: "One-Line Pitch",
			type: "rich_text",
			writable: true,
		},
		"Next Move": { name: "Next Move", type: "rich_text", writable: true },
		"Biggest Blocker": {
			name: "Biggest Blocker",
			type: "rich_text",
			writable: true,
		},
		"Operating Queue": {
			name: "Operating Queue",
			type: "formula",
			writable: false,
		},
		"Evidence Freshness": {
			name: "Evidence Freshness",
			type: "formula",
			writable: false,
		},
		"Next Review Date": {
			name: "Next Review Date",
			type: "formula",
			writable: false,
		},
		"Last Active": { name: "Last Active", type: "date", writable: true },
		"Primary Run Command": {
			name: "Primary Run Command",
			type: "rich_text",
			writable: true,
		},
		"Setup Friction": {
			name: "Setup Friction",
			type: "select",
			writable: true,
		},
		"Runs Locally": { name: "Runs Locally", type: "select", writable: true },
		"Build Maturity": {
			name: "Build Maturity",
			type: "select",
			writable: true,
		},
		"Ship Readiness": {
			name: "Ship Readiness",
			type: "select",
			writable: true,
		},
		"Effort to Demo": {
			name: "Effort to Demo",
			type: "select",
			writable: true,
		},
		"Effort to Ship": {
			name: "Effort to Ship",
			type: "select",
			writable: true,
		},
		"Needs Review": { name: "Needs Review", type: "checkbox", writable: true },
		"Evidence Confidence": {
			name: "Evidence Confidence",
			type: "select",
			writable: true,
		},
		"Docs Quality": { name: "Docs Quality", type: "select", writable: true },
		"Test Posture": { name: "Test Posture", type: "select", writable: true },
		Category: { name: "Category", type: "select", writable: true },
	},
};

describe("local portfolio view validation", () => {
	test("validates the repo view config against the expected schema", async () => {
		const raw = JSON.parse(
			await readFile(
				new URL("../config/local-portfolio-views.json", import.meta.url),
				"utf8",
			),
		);
		const plan = parseLocalPortfolioViewPlan(raw);
		const summary = validateLocalPortfolioViewPlanAgainstSchema(plan, SCHEMA);

		expect(summary.validatedViews).toHaveLength(8);
		expect(summary.validatedViews.every((view) => Boolean(view.viewId))).toBe(
			true,
		);
	});

	test("fails when a referenced property is missing", async () => {
		const raw = JSON.parse(
			await readFile(
				new URL("../config/local-portfolio-views.json", import.meta.url),
				"utf8",
			),
		);
		raw.views[0].configure =
			'SHOW "Name", "Missing Property", "Current State"; SORT BY "Last Active" DESC';

		const plan = parseLocalPortfolioViewPlan(raw);

		expect(() =>
			validateLocalPortfolioViewPlanAgainstSchema(plan, SCHEMA),
		).toThrow(
			'View "Portfolio Home" references missing property "Missing Property"',
		);
	});

	test("fails when a boolean filter targets a non-checkbox property", async () => {
		const raw = JSON.parse(
			await readFile(
				new URL("../config/local-portfolio-views.json", import.meta.url),
				"utf8",
			),
		);
		raw.views[1].configure = 'FILTER "Current State" = true; SHOW "Name"';

		const plan = parseLocalPortfolioViewPlan(raw);

		expect(() =>
			validateLocalPortfolioViewPlanAgainstSchema(plan, SCHEMA),
		).toThrow(
			'View "Resume Now" uses property "Current State" for checkbox filter, but its type is "select"',
		);
	});
});
