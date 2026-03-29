import { afterEach, describe, expect, test, vi } from "vitest";

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

    await expect(client.requestJson("/pages")).rejects.toThrow("timed out");
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
});
