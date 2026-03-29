import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { isDirectExecution, runLegacyCliPath } from "../cli/legacy.js";
import { loadLocalPortfolioViewPlan, renderLocalPortfolioViewPlanSummary } from "./local-portfolio-views.js";

export interface LocalPortfolioViewsPlanCommandOptions {
  config?: string;
}

export async function runLocalPortfolioViewsPlanCommand(
  options: LocalPortfolioViewsPlanCommandOptions = {},
): Promise<void> {
  const plan = await loadLocalPortfolioViewPlan(options.config);
  const output = {
    ...plan,
    summary: renderLocalPortfolioViewPlanSummary(plan),
  };

  recordCommandOutputSummary(output, {
    metadata: {
      validatedViews: Array.isArray(plan.views) ? plan.views.length : undefined,
    },
  });
  console.log(JSON.stringify(output, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  void runLegacyCliPath(["control-tower", "views-plan"]);
}
