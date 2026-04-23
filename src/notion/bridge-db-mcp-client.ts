import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ShippedEvent {
	id: number;
	project_name: string;
	summary: string;
	timestamp: string;
	source: string;
	branch?: string | null;
	tags?: string | string[] | null;
}

export interface BridgeDbStatus {
	ok: boolean;
	db_path: string;
	db_exists: boolean;
	schema_version: number;
	row_counts: {
		activity_log: number;
		pending_handoffs: number;
		cost_records: number;
	};
	bridge_file_exists: boolean;
	bridge_file_age_seconds?: number;
	unprocessed_shipped_count: number;
}

export interface BridgeDbMcpSessionOptions {
	dbPath?: string;
}

export function buildBridgeDbMcpEnvironment(
	options: BridgeDbMcpSessionOptions = {},
): Record<string, string> {
	const env = getDefaultEnvironment();
	const dbPath = options.dbPath?.trim();
	if (dbPath) {
		env["BRIDGE_DB_PATH"] = dbPath;
	}
	return env;
}

export function parseBridgeDbToolResult(result: unknown): unknown {
	const r = result as {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: { result?: unknown };
		isError?: boolean;
	};

	if (r?.isError) {
		const errorText = r.content?.[0]?.text ?? "Unknown MCP tool error";
		throw new Error(`MCP tool returned error: ${errorText}`);
	}

	if (
		r?.structuredContent &&
		Object.prototype.hasOwnProperty.call(r.structuredContent, "result")
	) {
		return r.structuredContent.result;
	}

	const textContent = r?.content?.find((content) => content.type === "text");
	if (!textContent?.text) {
		throw new Error("MCP tool result has no text content");
	}

	try {
		return JSON.parse(textContent.text) as unknown;
	} catch {
		return textContent.text;
	}
}

export function normalizeBridgeDbToolArray(
	value: unknown,
	toolName: string,
): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (value && typeof value === "object") {
		return [value];
	}
	throw new Error(`${toolName} returned unexpected type: ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Session class — one subprocess per command invocation
// ---------------------------------------------------------------------------

export class BridgeDbMcpSession {
	private constructor(private readonly client: Client) {}

	static async open(
		options: BridgeDbMcpSessionOptions = {},
	): Promise<BridgeDbMcpSession> {
		const transport = new StdioClientTransport({
			command: "uv",
			args: [
				"run",
				"--directory",
				"/Users/d/Projects/bridge-db",
				"python",
				"-m",
				"bridge_db",
			],
			env: buildBridgeDbMcpEnvironment(options),
		});
		const client = new Client({ name: "notion-os", version: "1.0" });
		await client.connect(transport);
		return new BridgeDbMcpSession(client);
	}

	async getShippedEvents(limit: number): Promise<ShippedEvent[]> {
		const result = await this.client.callTool({
			name: "get_shipped_events",
			arguments: { unprocessed_only: true, limit },
		});
		const parsed = parseBridgeDbToolResult(result);
		return normalizeBridgeDbToolArray(
			parsed,
			"get_shipped_events",
		) as ShippedEvent[];
	}

	async markProcessed(id: number): Promise<void> {
		await this.client.callTool({
			name: "mark_shipped_processed",
			arguments: { activity_ids: [id] },
		});
	}

	async getStatus(): Promise<BridgeDbStatus> {
		const result = await this.client.callTool({
			name: "health",
			arguments: {},
		});
		const parsed = parseBridgeDbToolResult(result);
		return parsed as BridgeDbStatus;
	}

	async logActivity(summary: string, count: number): Promise<void> {
		try {
			await this.client.callTool({
				name: "log_activity",
				arguments: {
					caller: "notion_os",
					project_name: "notion_os",
					summary: `${summary} (count=${count})`,
					tags: ["bridge-sync"],
				},
			});
		} catch (error) {
			console.error("[bridge-db-mcp] Failed to log activity:", error);
			// Don't throw — sync success is more important than logging
		}
	}

	/**
	 * Fetch recent personal_ops activity entries that have event tags
	 * (TASK_DONE, APPROVAL_SENT, PLANNING_APPLIED, REVIEW_CLOSED) but
	 * have not yet been marked PROCESSED.
	 */
	async getPersonalOpsEvents(limit: number): Promise<ShippedEvent[]> {
		const result = await this.client.callTool({
			name: "get_recent_activity",
			arguments: { source: "personal_ops", limit },
		});
		const parsed = normalizeBridgeDbToolArray(
			parseBridgeDbToolResult(result),
			"get_recent_activity",
		);
		const OPS_TAGS = new Set([
			"TASK_DONE",
			"APPROVAL_SENT",
			"PLANNING_APPLIED",
			"REVIEW_CLOSED",
		]);
		// Filter to rows that have at least one ops event tag and no PROCESSED tag
		return (parsed as ShippedEvent[]).filter((row) => {
			let tags: string[] = [];
			if (typeof row.tags === "string") {
				try {
					tags = JSON.parse(row.tags) as string[];
				} catch {
					return false;
				}
			} else if (Array.isArray(row.tags)) {
				tags = row.tags as string[];
			}
			const hasOpsTag = tags.some((t) => OPS_TAGS.has(t));
			const alreadyProcessed = tags.includes("PROCESSED");
			return hasOpsTag && !alreadyProcessed;
		});
	}

	async close(): Promise<void> {
		await this.client.close();
	}

}
