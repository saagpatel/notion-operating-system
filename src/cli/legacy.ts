import { pathToFileURL } from "node:url";

export function isDirectExecution(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
}

export async function runLegacyCliPath(commandPath: string[], argv: string[] = process.argv.slice(2)): Promise<void> {
  const { runCli } = await import("./runner.js");
  await runCli([...commandPath, ...argv]);
}

