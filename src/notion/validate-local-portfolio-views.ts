import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  loadLocalPortfolioViewPlan,
  validateLocalPortfolioViewPlanAgainstSchema,
} from "./local-portfolio-views.js";

export interface LocalPortfolioViewsValidateCommandOptions {
  config?: string;
}

export async function runLocalPortfolioViewsValidateCommand(
  options: LocalPortfolioViewsValidateCommandOptions = {},
): Promise<void> {
  const token = resolveRequiredNotionToken("NOTION_TOKEN is required for local portfolio view validation");
  const plan = await loadLocalPortfolioViewPlan(options.config);
  const api = new DirectNotionClient(token);
  const schema = await api.retrieveDataSource(plan.database.dataSourceId);
  const summary = validateLocalPortfolioViewPlanAgainstSchema(plan, schema);

  const output = {
    ok: true,
    database: plan.database,
    schemaTitle: summary.schemaTitle,
    validatedViews: summary.validatedViews,
  };
  recordCommandOutputSummary(output, {
    metadata: {
      schemaTitle: summary.schemaTitle,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["control-tower", "views-validate"]);
}
