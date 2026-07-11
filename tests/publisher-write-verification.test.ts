import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { RunLogger } from "../src/logging/run-logger.js";
import { Publisher } from "../src/publishing/publisher.js";
import type {
	CreatePageInput,
	DestinationConfig,
	MarkdownPatchInput,
	MarkdownReadResult,
	NotionApi,
	PageSnapshot,
	PageUpdateInput,
	ResolvedDestination,
	TemplateDescriptor,
} from "../src/types.js";
import { AppError } from "../src/utils/errors.js";

class VerificationFakeApi implements NotionApi {
	public createCalls: CreatePageInput[] = [];

	public patchCalls: MarkdownPatchInput[] = [];

	private readonly readbackMarkdown: string;

	private readonly templates: TemplateDescriptor[];

	public constructor(
		options: {
			readbackMarkdown?: string;
			templates?: TemplateDescriptor[];
		} = {},
	) {
		this.readbackMarkdown = options.readbackMarkdown ?? "";
		this.templates = options.templates ?? [];
	}

	public async resolveDestination(
		destination: DestinationConfig,
	): Promise<ResolvedDestination> {
		if (destination.destinationType === "page") {
			return {
				alias: destination.alias,
				sourceUrl: destination.sourceUrl,
				destinationType: "page",
				pageId: "page-1",
			};
		}
		return {
			alias: destination.alias,
			sourceUrl: destination.sourceUrl,
			destinationType: "data_source",
			dataSourceId: "ds-1",
		};
	}

	public async retrievePage(pageId: string): Promise<PageSnapshot> {
		return { id: pageId, url: `https://notion.so/${pageId}` };
	}

	public async retrieveDataSource() {
		return {
			id: "ds-1",
			title: "Example",
			titlePropertyName: "Title",
			properties: {
				Title: { name: "Title", type: "title", writable: true },
			},
		};
	}

	public async listTemplates(): Promise<TemplateDescriptor[]> {
		return this.templates;
	}

	public async searchPage() {
		return null;
	}

	public async createPageWithMarkdown(
		input: CreatePageInput,
	): Promise<PageSnapshot> {
		this.createCalls.push(input);
		return { id: "page-1", url: "https://notion.so/page-1" };
	}

	public async updatePageProperties(
		input: PageUpdateInput,
	): Promise<PageSnapshot> {
		return { id: input.pageId, url: `https://notion.so/${input.pageId}` };
	}

	public async readPageMarkdown(): Promise<MarkdownReadResult> {
		return {
			markdown: this.readbackMarkdown,
			raw: {},
			truncated: false,
			unknownBlockIds: [],
		};
	}

	public async patchPageMarkdown(input: MarkdownPatchInput): Promise<void> {
		this.patchCalls.push(input);
	}
}

function buildPageDestination(
	overrides: Partial<DestinationConfig> = {},
): DestinationConfig {
	return {
		alias: "command_center",
		destinationType: "page",
		sourceUrl: "https://www.notion.so/page-1",
		resolvedId: "page-1",
		templateMode: "none",
		titleRule: {
			source: "literal",
			value: "Command Center",
			fallback: "Command Center",
		},
		fixedProperties: {},
		defaultProperties: {},
		mode: "replace_full_content",
		safeDefaults: {
			allowDeletingContent: false,
			templatePollIntervalMs: 1500,
			templatePollTimeoutMs: 30000,
		},
		...overrides,
	};
}

async function setupTempFile(basename: string, body: string): Promise<string> {
	const tempDir = await mkdtemp(
		path.join(os.tmpdir(), "notion-write-verification-"),
	);
	const filePath = path.join(tempDir, basename);
	await writeFile(filePath, body, "utf8");
	return filePath;
}

async function setupLogger(): Promise<RunLogger> {
	const tempDir = await mkdtemp(
		path.join(os.tmpdir(), "notion-write-verification-log-"),
	);
	const logger = new RunLogger(tempDir, { mirrorToConsole: false });
	await logger.init();
	return logger;
}

describe("Publisher write verification wiring", () => {
	test("replace_full_content divergence warns without throwing under the default (warn) mode", async () => {
		const filePath = await setupTempFile(
			"command-center.md",
			"# Command Center\n\nSection A body.\n\nSection B body.",
		);
		const logger = await setupLogger();
		const api = new VerificationFakeApi({
			readbackMarkdown: "# Command Center\n\nSection A body.",
		});
		const publisher = new Publisher(api, logger);
		const destination = buildPageDestination();

		const summary = await publisher.publish(destination, {
			destinationAlias: destination.alias,
			inputFile: filePath,
			dryRun: false,
			live: true,
		});

		expect(summary.verification?.status).toBe("diverged");
		expect(
			summary.warnings.some((warning) =>
				warning.includes("Write verification diverged"),
			),
		).toBe(true);
	});

	test("replace_full_content divergence throws an AppError carrying the page state when verifyWrites is fail", async () => {
		const filePath = await setupTempFile(
			"command-center.md",
			"# Command Center\n\nSection A body.\n\nSection B body.",
		);
		const logger = await setupLogger();
		const api = new VerificationFakeApi({
			readbackMarkdown: "# Command Center\n\nSection A body.",
		});
		const publisher = new Publisher(api, logger);
		const destination = buildPageDestination({
			safeDefaults: {
				allowDeletingContent: false,
				templatePollIntervalMs: 1500,
				templatePollTimeoutMs: 30000,
				verifyWrites: "fail",
			},
		});

		await expect(
			publisher.publish(destination, {
				destinationAlias: destination.alias,
				inputFile: filePath,
				dryRun: false,
				live: true,
			}),
		).rejects.toThrow(AppError);

		try {
			await publisher.publish(destination, {
				destinationAlias: destination.alias,
				inputFile: filePath,
				dryRun: false,
				live: true,
			});
			expect.unreachable("expected publish to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			const appError = error as AppError;
			expect(appError.details?.destinationAlias).toBe(destination.alias);
			expect(appError.details?.verification).toMatchObject({
				status: "diverged",
			});
		}
	});

	test("template create with postTemplatePatchMode: none is unverifiable, never verified", async () => {
		const filePath = await setupTempFile(
			"decision.md",
			"# Decision\n\nBody content.",
		);
		const logger = await setupLogger();
		const api = new VerificationFakeApi({
			readbackMarkdown: "# Decision\n\nTemplate-authored content that differs.",
			templates: [{ id: "tpl-1", name: "Default", isDefault: true }],
		});
		const publisher = new Publisher(api, logger);
		const destination: DestinationConfig = {
			alias: "decision_log",
			destinationType: "data_source",
			sourceUrl: "collection://ds-1",
			resolvedId: "ds-1",
			templateMode: "default",
			titleRule: {
				source: "first_heading",
				fallback: "Fallback",
			},
			fixedProperties: {},
			defaultProperties: {},
			mode: "create_new_page",
			safeDefaults: {
				allowDeletingContent: false,
				templatePollIntervalMs: 1,
				templatePollTimeoutMs: 100,
			},
			postTemplatePatchMode: "none",
		};

		const summary = await publisher.publish(destination, {
			destinationAlias: "decision_log",
			inputFile: filePath,
			dryRun: false,
			live: true,
		});

		expect(summary.verification).toEqual({
			status: "unverifiable",
			reason: "template content is not locally known",
		});
		expect(api.patchCalls).toHaveLength(0);
	});

	test("dry run produces no verification field", async () => {
		const filePath = await setupTempFile(
			"command-center.md",
			"# Command Center\n\nSection A body.",
		);
		const logger = await setupLogger();
		const api = new VerificationFakeApi();
		const publisher = new Publisher(api, logger);
		const destination = buildPageDestination();

		const summary = await publisher.publish(destination, {
			destinationAlias: destination.alias,
			inputFile: filePath,
			dryRun: true,
		});

		expect(summary.verification).toBeUndefined();
	});

	test('verifyWrites: "off" records disabled status without comparing', async () => {
		const filePath = await setupTempFile(
			"command-center.md",
			"# Command Center\n\nSection A body.",
		);
		const logger = await setupLogger();
		const api = new VerificationFakeApi({
			readbackMarkdown: "# Command Center\n\nCompletely different content.",
		});
		const publisher = new Publisher(api, logger);
		const destination = buildPageDestination({
			safeDefaults: {
				allowDeletingContent: false,
				templatePollIntervalMs: 1500,
				templatePollTimeoutMs: 30000,
				verifyWrites: "off",
			},
		});

		const summary = await publisher.publish(destination, {
			destinationAlias: destination.alias,
			inputFile: filePath,
			dryRun: false,
			live: true,
		});

		expect(summary.verification).toEqual({
			status: "unverifiable",
			reason: "verification disabled",
		});
		expect(
			summary.warnings.some((warning) =>
				warning.includes("Write verification"),
			),
		).toBe(false);
	});
});
