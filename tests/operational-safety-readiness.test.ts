import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("operational safety readiness", () => {
  test("package scripts include the local sandbox smoke lane", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["sandbox:smoke"]).toBe("node scripts/sandbox-smoke.mjs");
  });

  test("docs link the sandbox runbook and maintenance proving paths", async () => {
    const [readme, handoff, contributing, maintenancePlaybook, sandboxRunbook, portability] = await Promise.all([
      readFile(path.join(repoRoot, "README.md"), "utf8"),
      readFile(path.join(repoRoot, "HANDOFF.md"), "utf8"),
      readFile(path.join(repoRoot, "CONTRIBUTING.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "maintenance-playbook.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "sandbox-rehearsal-runbook.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "github-portability.md"), "utf8"),
    ]);

    expect(readme).toContain("npm run sandbox:smoke");
    expect(readme).toContain("Sandbox rehearsal runbook");
    expect(handoff).toContain("npm run sandbox:smoke");
    expect(contributing).toContain("npm run sandbox:smoke");
    expect(maintenancePlaybook).toContain("same week");
    expect(maintenancePlaybook).toContain("When CI workflow names or job names change");
    expect(sandboxRunbook).toContain("Before Live Write");
    expect(sandboxRunbook).toContain("After Sandbox Rehearsal");
    expect(sandboxRunbook).toContain("temporary workspace copy");
    expect(portability).toContain("npm run sandbox:smoke");
  });
});
