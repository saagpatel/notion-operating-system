import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { extractNotionIdFromUrl } from "../utils/notion-id.js";
import { pageMarkdownMatches } from "../utils/markdown.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
	DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	loadLocalPortfolioControlTowerConfig,
	saveLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";

export async function replaceCommandCenterPageAfterPatchFailure(input: {
	api: DirectNotionClient;
	config: Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>;
	configPath?: string;
	markdown: string;
}): Promise<Awaited<ReturnType<typeof loadLocalPortfolioControlTowerConfig>>> {
	const currentPageId = input.config.commandCenter.pageId;
	if (currentPageId) {
		try {
			const current = await input.api.readPageMarkdown(currentPageId);
			if (
				pageMarkdownMatches({
					expectedMarkdown: input.markdown,
					actualMarkdown: current.markdown,
					title: input.config.commandCenter.title,
				})
			) {
				return input.config;
			}
		} catch {
			// The original page is unreadable; replacement remains the recovery path.
		}
	}

	const parentPageId = extractNotionIdFromUrl(
		input.config.commandCenter.parentPageUrl,
	);
	if (!parentPageId) {
		throw new Error(
			"Control tower command center parentPageUrl is not a Notion page URL",
		);
	}

	const created = await input.api.createPageWithMarkdown({
		parent: { page_id: parentPageId },
		properties: {
			title: [
				{
					type: "text",
					text: { content: input.config.commandCenter.title },
				},
			],
		},
		markdown: stripLeadingMarkdownTitle(
			input.markdown,
			input.config.commandCenter.title,
		),
	});
	const nextConfig = {
		...input.config,
		commandCenter: {
			...input.config.commandCenter,
			pageId: created.id,
			pageUrl: created.url,
		},
	};
	await saveLocalPortfolioControlTowerConfig(
		nextConfig,
		input.configPath ?? DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
	);
	const registry = await DestinationRegistry.load(
		loadRuntimeConfig().paths.destinationsPath,
	);
	await registry.patchDestination(nextConfig.destinations.commandCenterAlias, {
		sourceUrl: created.url,
		resolvedId: created.id,
		mode: "replace_full_content",
	});
	if (currentPageId) {
		await input.api.archivePage(currentPageId);
	}
	return nextConfig;
}

export function isMarkdownPatchTransportError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/Notion request transport error.*PATCH \/pages\/.*\/markdown/i.test(
			message,
		) ||
		/Notion request returned retryable error responses after \d+ attempt\(s\) for PATCH \/pages\/.*\/markdown/i.test(
			message,
		)
	);
}

function stripLeadingMarkdownTitle(markdown: string, title: string): string {
	const lines = markdown.split("\n");
	if (lines[0]?.trim() !== `# ${title}`) {
		return markdown;
	}
	const [, maybeBlank, ...rest] = lines;
	return (maybeBlank?.trim() === "" ? rest : [maybeBlank, ...rest])
		.join("\n")
		.trim();
}
