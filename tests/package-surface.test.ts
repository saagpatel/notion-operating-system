import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import * as advanced from "../src/advanced.js";
import * as core from "../src/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

describe("package surface", () => {
  test("root exports stay focused on the reusable toolkit", () => {
    expect(core).toHaveProperty("Publisher");
    expect(core).toHaveProperty("DirectNotionClient");
    expect(core).toHaveProperty("DestinationRegistry");
    expect(core).toHaveProperty("loadRuntimeConfig");
    expect(core).not.toHaveProperty("DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH");
    expect(core).not.toHaveProperty("DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_POLICIES_PATH");
    expect(core).not.toHaveProperty("WORKSPACE_PROFILE_OWNED_FILES");
  });

  test("advanced exports expose repo-specific operating-system modules", () => {
    expect(advanced).toHaveProperty("DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH");
    expect(advanced).toHaveProperty("DEFAULT_LOCAL_PORTFOLIO_GOVERNANCE_POLICIES_PATH");
  });

  test("modern operator aliases exist alongside legacy compatibility scripts", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["control-tower:sync"]).toBe("tsx src/cli.ts control-tower sync");
    expect(packageJson.scripts["governance:audit"]).toBe("tsx src/cli.ts governance audit");
    expect(packageJson.scripts["signals:sync"]).toBe("tsx src/cli.ts signals sync");
    expect(packageJson.scripts["rollout:operational"]).toBe("tsx src/cli.ts rollout operational");

    expect(packageJson.scripts["portfolio-audit:control-tower-sync"]).toBe("tsx src/notion/control-tower-sync.ts");
    expect(packageJson.scripts["portfolio-audit:governance-audit"]).toBe("tsx src/notion/governance-audit.ts");
    expect(packageJson.scripts["portfolio-audit:external-signal-sync"]).toBe("tsx src/notion/external-signal-sync.ts");
  });

  test("preferred and legacy npm aliases both work for representative durable workflows", async () => {
    const checks = [
      {
        preferred: "control-tower:sync",
        legacy: "portfolio-audit:control-tower-sync",
        expected: "Refresh control-tower derived fields",
      },
      {
        preferred: "governance:audit",
        legacy: "portfolio-audit:governance-audit",
        expected: "Audit the governance policy and webhook posture",
      },
      {
        preferred: "signals:sync",
        legacy: "portfolio-audit:external-signal-sync",
        expected: "Sync external provider signals",
      },
    ];

    for (const check of checks) {
      const preferred = await runNpmScript(check.preferred, ["--help"]);
      const legacy = await runNpmScript(check.legacy, ["--help"]);

      expect(preferred.exitCode).toBe(0);
      expect(preferred.stdout).toContain(check.expected);
      expect(legacy.exitCode).toBe(0);
      expect(legacy.stdout).toContain(check.expected);
    }
  });
});

async function runNpmScript(
  scriptName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(npmBin, ["run", scriptName, "--", ...args], {
      cwd: repoRoot,
      env: process.env,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}
