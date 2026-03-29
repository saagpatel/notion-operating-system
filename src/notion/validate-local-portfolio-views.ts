import "dotenv/config";

import { DirectNotionClient } from "./direct-notion-client.js";
import {
  loadLocalPortfolioViewPlan,
  validateLocalPortfolioViewPlanAgainstSchema,
} from "./local-portfolio-views.js";
import { AppError, toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for local portfolio view validation");
    }

    const plan = await loadLocalPortfolioViewPlan(process.argv[2] ?? undefined);
    const api = new DirectNotionClient(token);
    const schema = await api.retrieveDataSource(plan.database.dataSourceId);
    const summary = validateLocalPortfolioViewPlanAgainstSchema(plan, schema);

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: plan.database,
          schemaTitle: summary.schemaTitle,
          validatedViews: summary.validatedViews,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
