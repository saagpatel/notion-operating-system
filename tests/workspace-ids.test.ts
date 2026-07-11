import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { WorkspaceIds } from "../src/config/workspace-ids.js";
import { AppError } from "../src/utils/errors.js";

const fixture = {
  version: 1,
  dataSources: {
    projectPortfolio: "35e04e4d-bcd8-45c0-b783-238edef210f7",
    intakeProjects: "35e04e4d-bcd8-45c0-b783-238edef210f7",
    localProjects: "7858b551-4ce9-4bc3-ad1d-07b187d7117b",
  },
  operationalAliases: [
    { repoKey: "claude-md-lint", targetTitle: "Machine Audits", relationProperty: "Project" },
  ],
  canonicalSupportPageIds: { "tool:ollama": "326c21f1-caf0-81f6-8558-ef78d04f60cb" },
  canonicalToolPageIds: { Ollama: "326c21f1-caf0-81f6-8558-ef78d04f60cb" },
  forcedNearDuplicateMerges: [
    {
      kind: "skill",
      canonicalId: "32bc21f1-caf0-81fe-8451-de2e17ad29d1",
      duplicateId: "326c21f1-caf0-81c6-8120-f91c4f82b6b1",
    },
  ],
};

describe("WorkspaceIds", () => {
  test("loads and resolves every workspace id section", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-workspace-ids-"));
    const filePath = path.join(tempDir, "workspace-ids.json");
    await writeFile(filePath, JSON.stringify(fixture), "utf8");

    const workspaceIds = await WorkspaceIds.load(filePath);
    expect(workspaceIds.getDataSource("projectPortfolio")).toBe(fixture.dataSources.projectPortfolio);
    expect(workspaceIds.getDataSource("intakeProjects")).toBe(fixture.dataSources.intakeProjects);
    expect(workspaceIds.getDataSource("localProjects")).toBe(fixture.dataSources.localProjects);
    expect(workspaceIds.operationalAliases).toEqual(fixture.operationalAliases);
    expect(workspaceIds.canonicalSupportPageIds.get("tool:ollama")).toBe(fixture.canonicalSupportPageIds["tool:ollama"]);
    expect(workspaceIds.canonicalToolPageIds.get("Ollama")).toBe(fixture.canonicalToolPageIds.Ollama);
    expect(workspaceIds.forcedNearDuplicateMerges).toEqual(fixture.forcedNearDuplicateMerges);
  });

  test("fails loudly when a required config key is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-workspace-ids-"));
    const filePath = path.join(tempDir, "workspace-ids.json");
    const { localProjects: _localProjects, ...dataSources } = fixture.dataSources;
    await writeFile(filePath, JSON.stringify({ ...fixture, dataSources }), "utf8");

    await expect(WorkspaceIds.load(filePath)).rejects.toBeInstanceOf(AppError);
    await expect(WorkspaceIds.load(filePath)).rejects.toThrow("dataSources.localProjects");
    await expect(WorkspaceIds.load(filePath)).rejects.toThrow(filePath);
  });

  test("loads the checked-in config without workspace id drift", async () => {
    const workspaceIds = await WorkspaceIds.load("config/workspace-ids.json");
    expect(workspaceIds.getDataSource("projectPortfolio")).toBe("35e04e4d-bcd8-45c0-b783-238edef210f7");
    expect(workspaceIds.getDataSource("intakeProjects")).toBe("35e04e4d-bcd8-45c0-b783-238edef210f7");
    expect(workspaceIds.getDataSource("localProjects")).toBe("7858b551-4ce9-4bc3-ad1d-07b187d7117b");
    expect(workspaceIds.operationalAliases).toEqual([
      { repoKey: "claude-md-lint", targetTitle: "Machine Audits", relationProperty: "Project" },
      { repoKey: "operator-os-docs", targetTitle: "Machine Audits", relationProperty: "Project" },
      { repoKey: "portfolio-docs-agent-contract-lane", targetTitle: "Machine Audits", relationProperty: "Project" },
      { repoKey: "portfolio-dep-security", targetTitle: "GitHub Repo Auditor", relationProperty: "Local Project" },
      { repoKey: "portfoliocommandcenter", targetTitle: "GitHub Repo Auditor", relationProperty: "Local Project" },
    ]);
    expect(workspaceIds.canonicalSupportPageIds.get("tool:ollama")).toBe("326c21f1-caf0-81f6-8558-ef78d04f60cb");
    expect(workspaceIds.canonicalToolPageIds.get("Ollama")).toBe("326c21f1-caf0-81f6-8558-ef78d04f60cb");
    expect(workspaceIds.forcedNearDuplicateMerges).toEqual([
      {
        kind: "skill",
        canonicalId: "32bc21f1-caf0-81fe-8451-de2e17ad29d1",
        duplicateId: "326c21f1-caf0-81c6-8120-f91c4f82b6b1",
      },
    ]);
  });
});
