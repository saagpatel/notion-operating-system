import { DestinationRegistry } from "../config/destination-registry.js";
import { loadRuntimeConfig, requireNotionToken, type RuntimeConfig } from "../config/runtime-config.js";
import { RunLogger } from "../logging/run-logger.js";
import { AppError } from "../utils/errors.js";
import { getCurrentCommandLogger, getCurrentCommandRuntimeConfig } from "./run-observability.js";

export interface CommandRuntimeContext {
  runtimeConfig: RuntimeConfig;
}

export function createCommandRuntimeContext(): CommandRuntimeContext {
  return {
    runtimeConfig: getCurrentCommandRuntimeConfig() ?? loadRuntimeConfig(),
  };
}

export async function createCommandLogger(
  context: CommandRuntimeContext = createCommandRuntimeContext(),
): Promise<RunLogger> {
  const existingLogger = getCurrentCommandLogger();
  if (existingLogger) {
    return existingLogger;
  }

  const logger = RunLogger.fromRuntimeConfig(context.runtimeConfig);
  await logger.init();
  return logger;
}

export async function loadCommandDestinationRegistry(
  context: CommandRuntimeContext = createCommandRuntimeContext(),
): Promise<DestinationRegistry> {
  return DestinationRegistry.load(context.runtimeConfig.paths.destinationsPath);
}

export function resolveRequiredNotionToken(
  message: string,
  context: CommandRuntimeContext = createCommandRuntimeContext(),
): string {
  return context.runtimeConfig.notion.token ?? requireNotionToken(message);
}

export function resolveOptionalControlTowerConfigPath(input: {
  config?: string;
  positionals?: string[];
}): string {
  const runtimeConfig = getCurrentCommandRuntimeConfig() ?? loadRuntimeConfig();
  const config = input.config?.trim();
  const positionals = input.positionals ?? [];
  if (positionals.length > 1) {
    throw new AppError(`Expected at most one positional config path, received ${positionals.length}`);
  }

  return config || positionals[0] || runtimeConfig.paths.controlTowerConfigPath;
}
