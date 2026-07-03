/**
 * Tests for ensurePhase6GovernanceSchema (local-portfolio-governance-live.ts).
 *
 * These tests exercise the highest-blast-radius live-mutation path in the system:
 * five database creates + five schema patches per call. A fake Client is injected
 * at the sdk boundary — no network, no real Notion token.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Client } from "@notionhq/client";
import { describe, expect, test } from "vitest";

import {
	type LocalPortfolioControlTowerConfig,
	parseLocalPortfolioControlTowerConfig,
} from "../src/notion/local-portfolio-control-tower.js";
import { ensurePhase6GovernanceSchema } from "../src/notion/local-portfolio-governance-live.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, "../config");

// ---------------------------------------------------------------------------
// Fake SDK client — captures every sdk.request() call made by the live fn
// ---------------------------------------------------------------------------

interface CapturedRequest {
	path: string;
	method: string;
	body?: unknown;
}

function makeFakeSdk(): {
	sdk: Client;
	calls: CapturedRequest[];
} {
	const calls: CapturedRequest[] = [];

	/**
	 * Default request handler. Returns a valid "new database" response for POST
	 * databases, and an empty object for everything else.
	 */
	const request = async (args: {
		path: string;
		method: string;
		body?: unknown;
	}) => {
		calls.push({ path: args.path, method: args.method, body: args.body });

		if (args.path === "databases" && args.method === "post") {
			// Simulate Notion creating a new database with a data_sources entry.
			// IDs must be valid Notion UUIDs (32 lowercase hex chars, version nibble in [1-8]).
			return {
				id: "aaaabbbb1ccc8dddeeeeffffaaaabbbb",
				url: "https://www.notion.so/aaaabbbb1ccc8dddeeeeffffaaaabbbb",
				data_sources: [{ id: "bbbbcccc1ddd8eeeffffaaaabbbbcccc" }],
			};
		}

		return {};
	};

	// Cast: we only need `request` — the rest of the Client surface is unused
	const sdk = { request } as unknown as Client;

	return { sdk, calls };
}

// ---------------------------------------------------------------------------
// Config loader — parses the real control-tower config from disk
// ---------------------------------------------------------------------------

async function loadConfig(): Promise<LocalPortfolioControlTowerConfig> {
	const raw = JSON.parse(
		await readFile(
			path.join(CONFIG_DIR, "local-portfolio-control-tower.json"),
			"utf8",
		),
	);
	return parseLocalPortfolioControlTowerConfig(raw);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ensurePhase6GovernanceSchema", () => {
	test("creates 5 databases and patches their schemas when phase6 is absent", async () => {
		const { sdk, calls } = makeFakeSdk();
		// Strip phase6 from the real config to simulate first-run provisioning
		const { phase6Governance: _dropped, ...configWithoutPhase6 } =
			await loadConfig();
		const config = configWithoutPhase6 as LocalPortfolioControlTowerConfig;

		const result = await ensurePhase6GovernanceSchema(sdk, config);

		// 5 POST /databases (one per governance DB)
		const creates = calls.filter(
			(c) => c.path === "databases" && c.method === "post",
		);
		expect(creates).toHaveLength(5);

		const expectedTitles = [
			"External Action Policies",
			"External Action Requests",
			"Webhook Endpoints",
			"Webhook Deliveries",
			"Webhook Receipts",
		];
		for (const title of expectedTitles) {
			const found = creates.some((c) => {
				const body = c.body as
					| { title?: Array<{ text?: { content?: string } }> }
					| undefined;
				return body?.title?.[0]?.text?.content === title;
			});
			expect(
				found,
				`Expected a POST /databases call with title "${title}"`,
			).toBe(true);
		}

		// 5 PATCH /data_sources/<id> (schema mutations)
		const patches = calls.filter(
			(c) => c.path.startsWith("data_sources/") && c.method === "patch",
		);
		expect(patches).toHaveLength(5);

		// Returned config has all five phase6 refs populated
		expect(result.phase6Governance?.policies).toBeDefined();
		expect(result.phase6Governance?.actionRequests).toBeDefined();
		expect(result.phase6Governance?.webhookEndpoints).toBeDefined();
		expect(result.phase6Governance?.webhookDeliveries).toBeDefined();
		expect(result.phase6Governance?.webhookReceipts).toBeDefined();
	});

	test("patches schema with correct property names for policies DB", async () => {
		const { sdk, calls } = makeFakeSdk();
		const { phase6Governance: _dropped, ...configWithoutPhase6 } =
			await loadConfig();
		const config = configWithoutPhase6 as LocalPortfolioControlTowerConfig;

		await ensurePhase6GovernanceSchema(sdk, config);

		// At least one patch body must include "Execution Mode" (policies schema)
		const patchBodies = calls
			.filter((c) => c.method === "patch")
			.map(
				(c) => c.body as { properties?: Record<string, unknown> } | undefined,
			);

		const hasExecutionMode = patchBodies.some(
			(b) => b?.properties !== undefined && "Execution Mode" in b.properties,
		);
		expect(
			hasExecutionMode,
			"Expected a patch with 'Execution Mode' property (policies schema)",
		).toBe(true);

		// At least one patch body must include "Dry Run Required" (policies checkbox)
		const hasDryRunRequired = patchBodies.some(
			(b) => b?.properties !== undefined && "Dry Run Required" in b.properties,
		);
		expect(
			hasDryRunRequired,
			"Expected a patch with 'Dry Run Required' property",
		).toBe(true);
	});

	test("patches schema with correct property names for actionRequests DB", async () => {
		const { sdk, calls } = makeFakeSdk();
		const { phase6Governance: _dropped, ...configWithoutPhase6 } =
			await loadConfig();
		const config = configWithoutPhase6 as LocalPortfolioControlTowerConfig;

		await ensurePhase6GovernanceSchema(sdk, config);

		const patchBodies = calls
			.filter((c) => c.method === "patch")
			.map(
				(c) => c.body as { properties?: Record<string, unknown> } | undefined,
			);

		// actionRequests schema must include approval + payload fields
		const hasApprover = patchBodies.some(
			(b) => b?.properties !== undefined && "Approver" in b.properties,
		);
		expect(
			hasApprover,
			"Expected a patch with 'Approver' property (actionRequests schema)",
		).toBe(true);

		const hasPayloadTitle = patchBodies.some(
			(b) => b?.properties !== undefined && "Payload Title" in b.properties,
		);
		expect(
			hasPayloadTitle,
			"Expected a patch with 'Payload Title' property",
		).toBe(true);
	});

	test("skips database creation and only patches when all 5 refs already exist (idempotent)", async () => {
		const { sdk, calls } = makeFakeSdk();
		// Use the real config which already has phase6Governance populated with real
		// non-sentinel URLs — this exercises the idempotent path
		const config = await loadConfig();

		// Guard: if the live config has no phase6, the test setup is wrong
		if (!config.phase6Governance) {
			throw new Error(
				"Test setup: real config has no phase6Governance — cannot test idempotent path",
			);
		}

		const result = await ensurePhase6GovernanceSchema(sdk, config);

		// No POST /databases — all five refs already have real URLs
		const creates = calls.filter(
			(c) => c.path === "databases" && c.method === "post",
		);
		expect(creates).toHaveLength(0);

		// 5 PATCH /data_sources/<id> still fire — schema sync always applies
		const patches = calls.filter(
			(c) => c.path.startsWith("data_sources/") && c.method === "patch",
		);
		expect(patches).toHaveLength(5);

		// Returned config preserves the real ref identities
		expect(result.phase6Governance?.policies.dataSourceId).toBe(
			config.phase6Governance.policies.dataSourceId,
		);
		expect(result.phase6Governance?.actionRequests.dataSourceId).toBe(
			config.phase6Governance.actionRequests.dataSourceId,
		);
	});

	test("returned config preserves existing ref object identity on idempotent run", async () => {
		const { sdk } = makeFakeSdk();
		const config = await loadConfig();

		if (!config.phase6Governance) {
			throw new Error(
				"Test setup: real config has no phase6Governance — cannot test ref preservation",
			);
		}

		const originalPoliciesRef = config.phase6Governance.policies;
		const result = await ensurePhase6GovernanceSchema(sdk, config);

		// Policies ref must be the same object — no replacement from a create response
		expect(result.phase6Governance?.policies).toStrictEqual(
			originalPoliciesRef,
		);
	});
});
