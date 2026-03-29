import path from "node:path";

import {
  DestinationRegistrySchema,
  PublishRequestSchema,
  type DestinationConfig,
  type DestinationRegistryConfig,
  type PublishRequest,
} from "../types.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { readJsonFile, writeJsonFile } from "../utils/files.js";
import { AppError } from "../utils/errors.js";

export class DestinationRegistry {
  public constructor(
    public readonly configPath: string,
    private config: DestinationRegistryConfig,
  ) {}

  public static async load(configPath = loadRuntimeConfig().paths.destinationsPath): Promise<DestinationRegistry> {
    const absolutePath = path.resolve(configPath);
    const file = await readJsonFile<unknown>(absolutePath);
    const config = DestinationRegistrySchema.parse(file);
    return new DestinationRegistry(absolutePath, config);
  }

  public get destinations(): DestinationConfig[] {
    return this.config.destinations;
  }

  public getDestination(alias: string): DestinationConfig {
    const destination = this.config.destinations.find((entry) => entry.alias === alias);
    if (!destination) {
      throw new AppError(`Unknown destination alias "${alias}"`);
    }

    return destination;
  }

  public parseRequestFile(payload: unknown): PublishRequest {
    return PublishRequestSchema.parse(payload);
  }

  public async saveResolvedId(alias: string, resolvedId: string): Promise<void> {
    await this.patchDestination(alias, { resolvedId });
  }

  public async patchDestination(alias: string, patch: Partial<DestinationConfig>): Promise<void> {
    const existing = this.getDestination(alias);
    const nextDestination = {
      ...existing,
      ...patch,
    };
    const nextConfig: DestinationRegistryConfig = {
      ...this.config,
      destinations: this.config.destinations.map((destination) =>
        destination.alias === alias ? nextDestination : destination,
      ),
    };

    await writeJsonFile(this.configPath, nextConfig);
    this.config = nextConfig;
  }
}
