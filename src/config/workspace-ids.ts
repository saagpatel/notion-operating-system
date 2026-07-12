import path from "node:path";

import { z } from "zod";

import { AppError } from "../utils/errors.js";
import { readJsonFile } from "../utils/files.js";

export const DEFAULT_WORKSPACE_IDS_PATH = "./config/workspace-ids.json";

const BuildLogProjectRelationSchema = z.enum(["Project", "Local Project"]);
const SupportKindSchema = z.enum(["research", "skill", "tool"]);
const WorkspaceIdsSchema = z.object({
  version: z.literal(1),
  dataSources: z.object({
    projectPortfolio: z.string().uuid(),
    intakeProjects: z.string().uuid(),
    localProjects: z.string().uuid(),
  }),
  operationalAliases: z.array(z.object({
    repoKey: z.string().min(1),
    targetTitle: z.string().min(1),
    relationProperty: BuildLogProjectRelationSchema,
  })),
  canonicalSupportPageIds: z.record(z.string(), z.string().uuid()),
  canonicalToolPageIds: z.record(z.string(), z.string().uuid()),
  forcedNearDuplicateMerges: z.array(z.object({
    kind: SupportKindSchema,
    canonicalId: z.string().uuid(),
    duplicateId: z.string().uuid(),
  })),
});

type WorkspaceIdsConfig = z.infer<typeof WorkspaceIdsSchema>;
export type BuildLogProjectRelation = z.infer<typeof BuildLogProjectRelationSchema>;
export type OperationalAlias = WorkspaceIdsConfig["operationalAliases"][number];
export type ForcedNearDuplicateMerge = WorkspaceIdsConfig["forcedNearDuplicateMerges"][number];

export class WorkspaceIds {
  public constructor(
    public readonly configPath: string,
    private readonly config: WorkspaceIdsConfig,
  ) {}

  public static async load(configPath = DEFAULT_WORKSPACE_IDS_PATH): Promise<WorkspaceIds> {
    const absolutePath = path.resolve(configPath);
    const file = await readJsonFile<unknown>(absolutePath);
    const parsed = WorkspaceIdsSchema.safeParse(file);
    if (!parsed.success) {
      const key = parsed.error.issues[0]?.path.join(".") || "root";
      throw new AppError(`Invalid workspace ids config key "${key}" in ${absolutePath}`);
    }
    return new WorkspaceIds(absolutePath, parsed.data);
  }

  public getDataSource(key: keyof WorkspaceIdsConfig["dataSources"]): string {
    const value = this.config.dataSources[key];
    if (!value) {
      throw new AppError(`Missing workspace ids config key "dataSources.${key}" in ${this.configPath}`);
    }
    return value;
  }

  public get operationalAliases(): OperationalAlias[] {
    return this.config.operationalAliases;
  }

  public get canonicalSupportPageIds(): ReadonlyMap<string, string> {
    return new Map(Object.entries(this.config.canonicalSupportPageIds));
  }

  public get canonicalToolPageIds(): ReadonlyMap<string, string> {
    return new Map(Object.entries(this.config.canonicalToolPageIds));
  }

  public get forcedNearDuplicateMerges(): ForcedNearDuplicateMerge[] {
    return this.config.forcedNearDuplicateMerges;
  }
}
