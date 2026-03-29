import { AppError } from "../utils/errors.js";
import type { RunLogger } from "../logging/run-logger.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class NotionHttp {
  private readonly token: string;

  private readonly notionVersion: string;

  private readonly maxAttempts: number;

  private readonly timeoutMs: number;

  private readonly logger?: RunLogger;

  public constructor({
    token,
    notionVersion = "2026-03-11",
    maxAttempts = 5,
    timeoutMs = 90_000,
    logger,
  }: {
    token: string;
    notionVersion?: string;
    maxAttempts?: number;
    timeoutMs?: number;
    logger?: RunLogger;
  }) {
    this.token = token;
    this.notionVersion = notionVersion;
    this.maxAttempts = maxAttempts;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  public async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(`Timed out after ${this.timeoutMs}ms`), this.timeoutMs);
      let response: Response;

      try {
        response = await fetch(`https://api.notion.com/v1${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": this.notionVersion,
            "Content-Type": "application/json",
          },
          body: options.body === undefined ? null : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        if (isAbortError(error)) {
          await this.logger?.warn("notion_http_timeout", {
            path,
            method,
            attempt,
            timeoutMs: this.timeoutMs,
          });

          if (attempt === this.maxAttempts) {
            break;
          }

          await sleep(Math.min(attempt * 1000, 5000));
          continue;
        }

        throw error;
      }
      clearTimeout(timeout);

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await this.logger?.warn("notion_http_retry", {
          path,
          method,
          attempt,
          status: response.status,
          retryAfterSeconds: retryAfter,
        });

        if (attempt === this.maxAttempts) {
          break;
        }

        await sleep(retryAfter * 1000);
        continue;
      }

      const errorBody = await safeJson(response);
      throw new AppError(`Notion request failed for ${method} ${path}`, {
        status: response.status,
        body: errorBody,
      });
    }

    throw new AppError(`Notion request timed out after ${this.maxAttempts} attempt(s) for ${method} ${path}`, {
      timeoutMs: this.timeoutMs,
    });
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
