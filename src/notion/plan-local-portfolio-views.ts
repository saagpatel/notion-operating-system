import "dotenv/config";

import { loadLocalPortfolioViewPlan, renderLocalPortfolioViewPlanSummary } from "./local-portfolio-views.js";
import { toErrorMessage } from "../utils/errors.js";

async function main(): Promise<void> {
  try {
    const plan = await loadLocalPortfolioViewPlan(process.argv[2] ?? undefined);
    const output = {
      ...plan,
      summary: renderLocalPortfolioViewPlanSummary(plan),
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

void main();
