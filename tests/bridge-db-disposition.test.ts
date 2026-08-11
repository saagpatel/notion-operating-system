/**
 * Regression tests for the shipped-row disposition call.
 *
 * Background: bridge-db retired `confirm_shipped_sync` when it consolidated its
 * disposition verbs into `record_disposition`. notion-os kept calling the
 * retired verb AND discarded the tool result, so every call came back an error
 * that nobody read. The sync reported "Written: 14, Failed: 0" while all 14
 * rows stayed unprocessed — a silent no-op wearing a success message.
 *
 * These tests pin both halves of the fix: the verb we call, and the fact that
 * a result which does not prove the write is treated as a failure.
 *
 * Deliberately in its own file: the sibling client test mocks
 * BridgeDbMcpSession wholesale, which would hide the very call being asserted.
 */
import { describe, expect, test } from "vitest";

import {
	assertDispositionRecorded,
	BridgeDbMcpSession,
} from "../src/notion/bridge-db-mcp-client.js";

interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

/**
 * Build a session over a fake MCP client. The constructor is private to
 * TypeScript only; at runtime it is an ordinary one-argument constructor.
 */
function sessionOver(
	respond: (call: ToolCall) => unknown,
): { session: BridgeDbMcpSession; calls: ToolCall[] } {
	const calls: ToolCall[] = [];
	const client = {
		callTool: async (call: ToolCall) => {
			calls.push(call);
			return respond(call);
		},
	};
	const Ctor = BridgeDbMcpSession as unknown as new (
		client: unknown,
	) => BridgeDbMcpSession;
	return { session: new Ctor(client), calls };
}

function okPayload(call: ToolCall) {
	return {
		structuredContent: {
			result: { ok: true, activity_id: call.arguments.activity_id },
		},
	};
}

describe("confirmShippedSync uses the live disposition verb", () => {
	test("calls record_disposition, not the retired confirm_shipped_sync", async () => {
		const { session, calls } = sessionOver(okPayload);

		await session.confirmShippedSync({
			activityId: 6318,
			caller: "cc",
			downstreamRef: "notion-page-6318",
			notes: "Created Build Log page",
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("record_disposition");
		expect(calls[0]?.name).not.toBe("confirm_shipped_sync");
	});

	test("sends disposition 'synced' with the notion downstream reference", async () => {
		const { session, calls } = sessionOver(okPayload);

		await session.confirmShippedSync({
			activityId: 6318,
			caller: "cc",
			downstreamRef: "notion-page-6318",
		});

		expect(calls[0]?.arguments).toMatchObject({
			activity_id: 6318,
			disposition: "synced",
			downstream_system: "notion",
			downstream_ref: "notion-page-6318",
		});
	});

	test("binds the caller to the row's source rather than to notion_os", async () => {
		// record_disposition rejects a caller that does not match the event's
		// own source, so a hardcoded "notion_os" fails on every cc-authored row.
		const { session, calls } = sessionOver(okPayload);

		await session.confirmShippedSync({
			activityId: 42,
			caller: "codex",
			downstreamRef: "page-42",
		});

		expect(calls[0]?.arguments.caller).toBe("codex");
	});
});

describe("a result that does not prove the write is a failure", () => {
	test("throws when the tool reports an error instead of confirming", async () => {
		// This is the exact production shape: the verb is gone, MCP answers with
		// isError, and the old code discarded it and reported success.
		const { session } = sessionOver(() => ({
			isError: true,
			content: [{ type: "text", text: "Unknown tool: confirm_shipped_sync" }],
		}));

		await expect(
			session.confirmShippedSync({
				activityId: 6318,
				caller: "cc",
				downstreamRef: "page-6318",
			}),
		).rejects.toThrow(/Unknown tool/);
	});

	test("throws when the payload does not say ok", async () => {
		const { session } = sessionOver(() => ({
			structuredContent: { result: { ok: false, activity_id: 6318 } },
		}));

		await expect(
			session.confirmShippedSync({
				activityId: 6318,
				caller: "cc",
				downstreamRef: "page-6318",
			}),
		).rejects.toThrow(/was not confirmed/);
	});

	test("throws when a different row than the one requested was confirmed", async () => {
		const { session } = sessionOver(() => ({
			structuredContent: { result: { ok: true, activity_id: 999 } },
		}));

		await expect(
			session.confirmShippedSync({
				activityId: 6318,
				caller: "cc",
				downstreamRef: "page-6318",
			}),
		).rejects.toThrow(/confirmed activity 999 but 6318 was requested/);
	});

	test("resolves when the payload proves the requested row was confirmed", async () => {
		// Companion to the three above: without this, the guard could pass by
		// rejecting everything.
		const { session } = sessionOver(okPayload);

		await expect(
			session.confirmShippedSync({
				activityId: 6318,
				caller: "cc",
				downstreamRef: "page-6318",
			}),
		).resolves.toBeUndefined();
	});
});

describe("assertDispositionRecorded", () => {
	test("rejects a missing payload", () => {
		expect(() => assertDispositionRecorded(null, 1)).toThrow(/no payload/);
	});

	test("rejects a non-object payload", () => {
		expect(() => assertDispositionRecorded("done", 1)).toThrow(/no payload/);
	});

	test("accepts a matching confirmation", () => {
		expect(() =>
			assertDispositionRecorded({ ok: true, activity_id: 1 }, 1),
		).not.toThrow();
	});
});
