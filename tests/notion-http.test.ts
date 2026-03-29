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
});
