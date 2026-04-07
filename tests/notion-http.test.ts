import { afterEach, describe, expect, test, vi } from "vitest";

import { getCommandRunSummary, withCommandRunContext } from "../src/cli/run-observability.js";
import { NotionHttp } from "../src/notion/http.js";

describe("NotionHttp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("times out slow Notion requests instead of hanging silently", async () => {
    vi.useFakeTimers();

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const client = new NotionHttp({
      token: "test-token",
      timeoutMs: 25,
      maxAttempts: 1,
    });

    const pending = expect(client.requestJson("/pages")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);

    await pending;
  });

  test("logs retry exhaustion for repeated 429 responses", async () => {
    const warn = vi.fn(async () => undefined);
    const error = vi.fn(async () => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "rate limited" }), {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      ),
    );

    const client = new NotionHttp({
      token: "test-token",
      maxAttempts: 2,
      logger: { warn, error } as never,
    });

    await expect(client.requestJson("/pages")).rejects.toThrow("retryable error responses");
    expect(warn).toHaveBeenCalledWith(
      "notion_http_retry",
      expect.objectContaining({
        attempt: 1,
        status: 429,
      }),
    );
    expect(error).toHaveBeenCalledWith(
      "notion_http_retry_exhausted",
      expect.objectContaining({
        attempts: 2,
        status: 429,
      }),
    );
  });

  test("logs timeout exhaustion when every attempt aborts", async () => {
    vi.useFakeTimers();
    const warn = vi.fn(async () => undefined);
    const error = vi.fn(async () => undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const client = new NotionHttp({
      token: "test-token",
      timeoutMs: 25,
      maxAttempts: 2,
      logger: { warn, error } as never,
    });

    const pending = expect(client.requestJson("/pages")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);

    await pending;
    expect(warn).toHaveBeenCalledWith(
      "notion_http_timeout",
      expect.objectContaining({
        attempt: 1,
        timeoutMs: 25,
      }),
    );
    expect(error).toHaveBeenCalledWith(
      "notion_http_timeout_exhausted",
      expect.objectContaining({
        attempts: 2,
        timeoutMs: 25,
      }),
    );
  });

  test("marks recovered retries as warnings in the shared summary", async () => {
    const responses = [
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "Retry-After": "0" },
      }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() ?? new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    let summary = undefined as ReturnType<typeof getCommandRunSummary>;
    await withCommandRunContext(
      {
        commandPath: ["signals", "sync"],
        parsed: { options: { live: true }, positionals: [], helpRequested: false },
      },
      async () => {
        const client = new NotionHttp({
          token: "test-token",
          maxAttempts: 2,
        });
        await expect(client.requestJson("/pages")).resolves.toEqual({ ok: true });
        summary = getCommandRunSummary();
      },
    );

    expect(summary).toEqual(
      expect.objectContaining({
        status: "warning",
        retryCount: 1,
        warningCategories: ["retry_recovered"],
      }),
    );
  });

  test("classifies transport failures in the shared summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket closed");
      }),
    );

    let summary = undefined as ReturnType<typeof getCommandRunSummary>;
    await withCommandRunContext(
      {
        commandPath: ["signals", "sync"],
        parsed: { options: { live: true }, positionals: [], helpRequested: false },
      },
      async () => {
        const client = new NotionHttp({
          token: "test-token",
          maxAttempts: 1,
        });
        await expect(client.requestJson("/pages")).rejects.toThrow("transport error");
        summary = getCommandRunSummary();
      },
    );

    expect(summary?.failureCategories).toEqual(["transport_error"]);
    expect(summary?.status).toBe("failed");
  });
});
