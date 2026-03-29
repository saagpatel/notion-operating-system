import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  loadLocalPortfolioExecutionViewPlan,
  validateLocalPortfolioExecutionViewPlanAgainstSchemas,
} from "./local-portfolio-execution-views.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required to validate local portfolio execution views");
    }

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
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
