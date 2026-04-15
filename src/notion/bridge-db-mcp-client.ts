import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
	tags?: string;
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

// ---------------------------------------------------------------------------
// Session class — one subprocess per command invocation
// ---------------------------------------------------------------------------

export class BridgeDbMcpSession {
	private constructor(private readonly client: Client) {}

	static async open(): Promise<BridgeDbMcpSession> {
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
		const parsed = this.parseToolResult(result);
		if (!Array.isArray(parsed)) {
			throw new Error(
				`get_shipped_events returned unexpected type: ${typeof parsed}`,
			);
		}
		return parsed as ShippedEvent[];
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
		const parsed = this.parseToolResult(result);
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

	async close(): Promise<void> {
		await this.client.close();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private parseToolResult(result: unknown): unknown {
		// MCP tool results come as { content: Array<{ type: "text", text: string }> }
		const r = result as {
			content?: Array<{ type: string; text?: string }>;
			isError?: boolean;
		};

		if (r?.isError) {
			const errorText = r.content?.[0]?.text ?? "Unknown MCP tool error";
			throw new Error(`MCP tool returned error: ${errorText}`);
		}

		const textContent = r?.content?.find((c) => c.type === "text");
		if (!textContent?.text) {
			throw new Error("MCP tool result has no text content");
		}

		try {
			return JSON.parse(textContent.text) as unknown;
		} catch {
			// If it's not JSON, return the raw string
			return textContent.text;
		}
	}
}
