import type { NotionApi } from "../types.js";
import type { RunLogger } from "../logging/run-logger.js";
import { AppError } from "../utils/errors.js";

export async function waitForTemplateReadiness({
  api,
  pageId,
  timeoutMs,
  intervalMs,
  logger,
}: {
  api: NotionApi;
  pageId: string;
  timeoutMs: number;
  intervalMs: number;
  logger?: RunLogger;
}): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const markdown = await api.readPageMarkdown(pageId);
    if (markdown.markdown.trim().length > 0) {
      await logger?.info("template_ready", {
        pageId,
      });
      return;
    }

    await sleep(intervalMs);
  }

  throw new AppError("Timed out waiting for template content to become readable", {
    pageId,
    timeoutMs,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
