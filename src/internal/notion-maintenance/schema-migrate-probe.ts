/**
 * Read-only schema capability probe for the historical Local Portfolio Projects
 * rollup migration. This command never PATCHes Notion.
 */

import type { Client } from "@notionhq/client";

import { isDirectExecution } from "../../cli/legacy.js";
import {
	loadRuntimeConfig,
	requireNotionToken,
} from "../../config/runtime-config.js";
import { RunLogger } from "../../logging/run-logger.js";
import { DirectNotionClient } from "../../notion/direct-notion-client.js";
import { loadLocalPortfolioControlTowerConfig } from "../../notion/local-portfolio-control-tower.js";
import type { DataSourceSchemaSnapshot } from "../../types.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

const REQUIRED_RELATIONS = [
	"Build Sessions",
	"Related Research",
	"Supporting Skills",
	"Tool Stack Records",
] as const;

export async function runReadOnlySchemaProbe(input: {
	dataSourceId: string;
	retrieveDataSource: (
		dataSourceId: string,
	) => Promise<DataSourceSchemaSnapshot>;
	/**
	 * Accepted only so tests can prove that the probe has no SDK mutation path.
	 * The implementation intentionally never calls this client.
	 */
	sdk?: Client;
}): Promise<Record<string, unknown>> {
	void input.sdk;
	const schema = await input.retrieveDataSource(input.dataSourceId);
	const relations = REQUIRED_RELATIONS.map((name) => ({
		name,
		id: schema.properties[name]?.id ?? null,
		type: schema.properties[name]?.type ?? "missing",
	}));
	return {
		schema: "NotionSchemaMigrationProbeV1",
		mode: "read_only",
		dataSourceId: schema.id,
		titlePropertyName: schema.titlePropertyName,
		relations,
		ready: relations.every((property) => property.type === "relation"),
		networkMutations: 0,
	};
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (shouldShowHelp(argv)) {
		process.stdout.write(
			renderInternalScriptHelp({
				command: "npm run schema-migrate-probe --",
				description:
					"Inspect the Local Portfolio Projects schema for rollup migration readiness without mutating Notion.",
				options: [{ flag: "--help, -h", description: "Show this help message." }],
				notes: [
					"This probe is permanently read-only; it does not create or delete temporary properties.",
				],
			}),
		);
		return;
	}

	const token = requireNotionToken(
		"NOTION_TOKEN is required for the read-only schema migration probe",
	);
	const runtimeConfig = loadRuntimeConfig();
	const logger = new RunLogger(runtimeConfig.paths.logDir);
	const api = new DirectNotionClient(token, logger);
	const config = await loadLocalPortfolioControlTowerConfig();
	const result = await runReadOnlySchemaProbe({
		dataSourceId: config.database.dataSourceId,
		retrieveDataSource: (dataSourceId) => api.retrieveDataSource(dataSourceId),
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.ready !== true) {
		process.exitCode = 1;
	}
}

if (isDirectExecution(import.meta.url)) {
	void main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
