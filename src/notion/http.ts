import { loadRuntimeConfig } from "../config/runtime-config.js";
import { AppError } from "../utils/errors.js";
import type { RunLogger } from "../logging/run-logger.js";
import {
  getCurrentCommandLogger,
  incrementCommandSummary,
  recordCommandFailureCategory,
  recordCommandWarningCategory,
} from "../cli/run-observability.js";

interface RequestOptions {
  method?: string;
  body?: unknown;
  recordClientErrorAsFailure?: boolean;
}

export class NotionHttp {
  private readonly token: string;

  private readonly notionVersion: string;

  private readonly maxAttempts: number;

  private readonly timeoutMs: number;

  private readonly logger?: RunLogger;

  public constructor({
    token,
    notionVersion,
    maxAttempts,
    timeoutMs,
    logger,
  }: {
    token: string;
    notionVersion?: string;
    maxAttempts?: number;
    timeoutMs?: number;
    logger?: RunLogger;
  }) {
    const runtimeConfig = loadRuntimeConfig();
    this.token = token;
    this.notionVersion = notionVersion ?? runtimeConfig.notion.version;
    this.maxAttempts = maxAttempts ?? runtimeConfig.notion.retryMaxAttempts;
    this.timeoutMs = timeoutMs ?? runtimeConfig.notion.httpTimeoutMs;
    this.logger = logger ?? getCurrentCommandLogger();
  }

  public async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    let recoveredAfterRetry = false;
    let terminalCategory: "timeout_exhausted" | "transport_error" | "unexpected_response" = "timeout_exhausted";

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
          incrementCommandSummary("timeoutCount");
          await this.logger?.warn("notion_http_timeout", {
            path,
            method,
            attempt,
            timeoutMs: this.timeoutMs,
          });

          if (attempt === this.maxAttempts) {
            recordCommandFailureCategory("timeout_exhausted");
            terminalCategory = "timeout_exhausted";
            await this.logger?.error("notion_http_timeout_exhausted", {
              path,
              method,
              attempts: this.maxAttempts,
              timeoutMs: this.timeoutMs,
            });
            break;
          }

          incrementCommandSummary("retryCount");
          recoveredAfterRetry = true;
          await sleep(Math.min(attempt * 1000, 5000));
          continue;
        }

        await this.logger?.warn("notion_http_retry", {
          path,
          method,
          attempt,
          classification: "transport_error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        if (attempt === this.maxAttempts) {
          recordCommandFailureCategory("transport_error");
          terminalCategory = "transport_error";
          await this.logger?.error("notion_http_retry_exhausted", {
            path,
            method,
            attempts: this.maxAttempts,
            classification: "transport_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          break;
        }

        incrementCommandSummary("retryCount");
        recoveredAfterRetry = true;
        await sleep(Math.min(attempt * 1500, 8000));
        continue;
      }
      clearTimeout(timeout);

      if (response.ok) {
        if (recoveredAfterRetry) {
          recordCommandWarningCategory("retry_recovered");
        }
        return (await response.json()) as T;
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        incrementCommandSummary("retryCount");
        await this.logger?.warn("notion_http_retry", {
          path,
          method,
          attempt,
          status: response.status,
          retryAfterSeconds: retryAfter,
        });

        if (attempt === this.maxAttempts) {
          recordCommandFailureCategory("unexpected_response");
          terminalCategory = "unexpected_response";
          await this.logger?.error("notion_http_retry_exhausted", {
            path,
            method,
            attempts: this.maxAttempts,
            status: response.status,
            retryAfterSeconds: retryAfter,
          });
          break;
        }

        await sleep(retryAfter * 1000);
        recoveredAfterRetry = true;
        continue;
      }

      const errorBody = await safeJson(response);
      if (options.recordClientErrorAsFailure ?? true) {
        recordCommandFailureCategory(
          response.status >= 400 && response.status < 500 ? "validation_error" : "unexpected_response",
        );
      }
      await this.logger?.error("notion_http_failure", {
        path,
        method,
        attempt,
        status: response.status,
        classification: response.status >= 400 && response.status < 500 ? "client_error" : "unexpected_response",
      });
      throw new AppError(`Notion request failed for ${method} ${path}`, {
        status: response.status,
        body: errorBody,
      });
    }

    recordCommandFailureCategory(terminalCategory);
    await this.logger?.error("notion_http_failure", {
      path,
      method,
      attempts: this.maxAttempts,
      classification: terminalCategory,
      timeoutMs: this.timeoutMs,
    });
    const errorMessage =
      terminalCategory === "transport_error"
        ? `Notion request transport error after ${this.maxAttempts} attempt(s) for ${method} ${path}`
        : terminalCategory === "unexpected_response"
          ? `Notion request returned retryable error responses after ${this.maxAttempts} attempt(s) for ${method} ${path}`
          : `Notion request timed out after ${this.maxAttempts} attempt(s) for ${method} ${path}`;
    throw new AppError(errorMessage, {
      timeoutMs: this.timeoutMs,
      classification: terminalCategory,
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
  const raw = await response.text();
  if (!raw) {
    return "";
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
