import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  loadLocalPortfolioExecutionViewPlan,
  validateLocalPortfolioExecutionViewPlanAgainstSchemas,
} from "./local-portfolio-execution-views.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

export async function runExecutionViewsValidateCommand(): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required to validate local portfolio execution views");
  const api = new DirectNotionClient(token);
  const plan = await loadLocalPortfolioExecutionViewPlan();
  const schemas = Object.fromEntries(
    await Promise.all(
      plan.collections.map(async (collection) => [
        collection.key,
        await api.retrieveDataSource(collection.database.dataSourceId),
      ]),
    ),
  ) as Record<(typeof plan.collections)[number]["key"], Awaited<ReturnType<typeof api.retrieveDataSource>>>;

  const summary = validateLocalPortfolioExecutionViewPlanAgainstSchemas(plan, schemas);
  const output = { ok: true, ...summary };
  recordCommandOutputSummary(output, {
    metadata: {
      validatedViews: summary.validatedViews.length,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

async function main(): Promise<void> {
  try {
    await runExecutionViewsValidateCommand();
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["execution", "views-validate"]);
}
