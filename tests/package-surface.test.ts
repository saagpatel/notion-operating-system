import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import * as advanced from "../src/advanced.js";
import * as core from "../src/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const tsxBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

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
    expect(packageJson.scripts["control-tower:export-project-snapshot"]).toBe(
      "tsx src/cli.ts control-tower export-project-snapshot",
    );
    expect(packageJson.scripts["control-tower:schema-report"]).toBe("tsx src/cli.ts control-tower schema-report");
    expect(packageJson.scripts["control-tower:review-recovery"]).toBe(
      "tsx src/cli.ts control-tower review-recovery",
    );
    expect(packageJson.scripts["control-tower:packet-follow-through"]).toBe(
      "tsx src/cli.ts control-tower packet-follow-through",
    );
    expect(packageJson.scripts["control-tower:packet-prioritizer"]).toBe(
      "tsx src/cli.ts control-tower packet-prioritizer",
    );
    expect(packageJson.scripts["control-tower:today"]).toBe(
      "tsx src/cli.ts control-tower today",
    );
    expect(packageJson.scripts["control-tower:managed-section-audit"]).toBe(
      "tsx src/cli.ts control-tower managed-section-audit",
    );
    expect(packageJson.scripts["control-tower:repo-mapping-audit"]).toBe(
      "tsx src/cli.ts control-tower repo-mapping-audit",
    );
    expect(packageJson.scripts["governance:audit"]).toBe("tsx src/cli.ts governance audit");
    expect(packageJson.scripts["signals:sync"]).toBe("tsx src/cli.ts signals sync");
    expect(packageJson.scripts["rollout:operational"]).toBe("tsx src/cli.ts rollout operational");
    expect(packageJson.scripts["rollout:vercel-readiness"]).toBe("tsx src/cli.ts rollout vercel-readiness");
    expect(packageJson.scripts["maintenance:weekly-refresh"]).toBe("tsx src/cli.ts maintenance weekly-refresh");

    expect(packageJson.scripts["portfolio-audit:control-tower-sync"]).toBe("tsx src/cli.ts control-tower sync");
    expect(packageJson.scripts["portfolio-audit:governance-audit"]).toBe("tsx src/cli.ts governance audit");
    expect(packageJson.scripts["portfolio-audit:external-signal-sync"]).toBe("tsx src/cli.ts signals sync");
    expect(packageJson.scripts["portfolio-audit:vercel-rollout-readiness"]).toBe(
      "tsx src/cli.ts rollout vercel-readiness",
    );
    expect(packageJson.scripts["portfolio-audit:weekly-refresh"]).toBe("tsx src/cli.ts maintenance weekly-refresh");
  });

  test("public npm scripts do not point directly at src/notion entry files anymore", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    const directNotionScripts = Object.entries(packageJson.scripts).filter(([, command]) =>
      command.includes("tsx src/notion/"),
    );

    expect(directNotionScripts).toEqual([]);
  });

  test("active operator surfaces do not point agents at the historical checkout stub", async () => {
    const activeSurfaces = [
      "AGENTS.md",
      "docs/claude-code-handoff.md",
      "docs/audit-prompt-templates.md",
      "docs/personal-ops-coordination-ingestion.md",
      "src/notion/repo-mapping-audit.ts",
    ];

    for (const file of activeSurfaces) {
      const content = await readFile(path.join(repoRoot, file), "utf8");
      expect(content, file).not.toContain("/Users/d/Notion");
    }
  });

  test("environment example documents the active runtime env surface", async () => {
    const envExample = await readFile(path.join(repoRoot, ".env.example"), "utf8");
    const expectedKeys = [
      "NOTION_PROFILE",
      "NOTION_TOKEN",
      "NOTION_LOG_DIR",
      "NOTION_RETRY_MAX_ATTEMPTS",
      "NOTION_HTTP_TIMEOUT_MS",
      "NOTION_DESTINATIONS_PATH",
      "GITHUB_TOKEN",
      "VERCEL_TOKEN",
      "GOOGLE_CALENDAR_TOKEN",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY_PEM",
      "GITHUB_APP_WEBHOOK_SECRET",
      "VERCEL_WEBHOOK_SECRET",
      "GITHUB_BREAK_GLASS_TOKEN",
      "VERCEL_BREAK_GLASS_TOKEN",
    ];

    for (const key of expectedKeys) {
      expect(envExample, key).toContain(`${key}=`);
    }
    expect(envExample).not.toContain("secret_xxx");
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
      {
        preferred: "maintenance:weekly-refresh",
        legacy: "portfolio-audit:weekly-refresh",
        expected: "Run the safe weekly refresh orchestrator",
      },
      {
        preferred: "rollout:vercel-readiness",
        legacy: "portfolio-audit:vercel-rollout-readiness",
        expected: "Audit whether the Vercel rollout manifest is ready for rollout execution.",
      },
    ];

    const results = await Promise.all(
      checks.map(async (check) => ({
        check,
        executions: await Promise.all([
          runNpmScript(check.preferred, ["--help"]),
          runNpmScript(check.legacy, ["--help"]),
        ]),
      })),
    );

    for (const { check, executions: [preferred, legacy] } of results) {

      expect(preferred.exitCode).toBe(0);
      expect(preferred.stdout).toContain(check.expected);
      expect(legacy.exitCode).toBe(0);
      expect(legacy.stdout).toContain(check.expected);
    }
  }, 20_000);

  test("dry-run example script stays executable", async () => {
    const result = await runNpmScript("dry-run:example", []);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"dryRun": true');
  }, 20_000);

  test("straggler direct scripts render help safely instead of doing work", async () => {
    const checks = [
      {
        file: "src/internal/notion-maintenance/validate-local-portfolio-actuation-views.ts",
        expected: "Validate the local portfolio actuation view plan against live Notion schemas.",
      },
      {
        file: "src/internal/notion-maintenance/validate-local-portfolio-github-views.ts",
        expected: "Validate the local portfolio GitHub view plan against live Notion schemas.",
      },
      {
        file: "src/internal/notion-maintenance/validate-local-portfolio-native-dashboards.ts",
        expected: "Validate the native dashboard plan against live schemas.",
      },
    ];

    for (const check of checks) {
      const result = await runTsxFile(check.file, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(check.expected);
      expect(result.stderr).toBe("");
    }
  }, 20_000);

  test("legacy maintenance aliases stay inspectable through safe help output", async () => {
    const checks = [
      {
        script: "portfolio-audit:github-notion-catch-up",
        expected: "Compare GitHub repos against Notion project rows and prepare catch-up actions.",
      },
      {
        script: "portfolio-audit:notion-hygiene-pass",
        expected: "Audit Notion and GitHub alignment, clean duplicate rows, and repair canonical source links.",
      },
      {
        script: "portfolio-audit:fill-empty-local-project-fields",
        expected: "Backfill missing Local Portfolio Project fields from intelligence, execution, and external-signal evidence.",
      },
    ];

    for (const check of checks) {
      const result = await runNpmScript(check.script, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(check.expected);
      expect(result.stderr).toBe("");
    }
  }, 20_000);

  test("historical schema migration scripts stay inspectable through safe help output", async () => {
    const checks = [
      {
        script: "schema-migrate-probe",
        expected:
          "Run the historical schema migration probe that verifies rollup property creation against the Local Portfolio Projects data source.",
      },
      {
        script: "schema-migrate",
        expected:
          "Run the historical Local Portfolio Projects schema migration that replaces manual count fields with native rollups.",
      },
    ];

    for (const check of checks) {
      const result = await runNpmScript(check.script, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(check.expected);
      expect(result.stderr).toBe("");
    }
  }, 20_000);

  test("local source has no unreviewed LLM generation callsites", async () => {
    const sourceFiles = await walkTsFiles("src");
    const generationPatterns = [
      /\/api\/generate/,
      /chat\.completions/,
      /responses\.create/,
      /openai\.chat/,
      /generateText\(/,
    ];
    const matches: string[] = [];

    for (const file of sourceFiles) {
      const content = await readFile(path.join(repoRoot, file), "utf8");
      if (generationPatterns.some((pattern) => pattern.test(content))) {
        matches.push(file);
      }
    }

    expect(matches).toEqual([]);
  });

  test("agent-readable Notion renderers keep untrusted-content wrappers", async () => {
    const guardedFiles = [
      "src/notion/action-dry-run.ts",
      "src/notion/coordination-snapshot-ingest.ts",
      "src/notion/operational-rollout.ts",
    ];

    for (const file of guardedFiles) {
      const content = await readFile(path.join(repoRoot, file), "utf8");
      expect(content, file).toContain("untrustedMarkdownEvidence");
    }
  });

  test("live mutation surfaces keep explicit dry-run and confirmation gates", async () => {
    const actionRunner = await readFile(path.join(repoRoot, "src/notion/action-runner.ts"), "utf8");
    const cliRegistry = await readFile(path.join(repoRoot, "src/cli/registry.ts"), "utf8");

    expect(actionRunner).toContain('const mode = options.mode ?? "dry-run";');
    expect(cliRegistry).toContain('defaultValue: "dry-run"');
    expect(cliRegistry).toContain('name: "write-scope"');
    expect(cliRegistry).toContain('name: "confirm-live"');
    expect(cliRegistry).toContain('name: "confirm-full-live"');
  });
});

async function walkTsFiles(relativeDir: string): Promise<string[]> {
  const root = path.join(repoRoot, relativeDir);
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkTsFiles(relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }

  return files;
}

async function runNpmScript(
  scriptName: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(npmBin, ["run", scriptName, "--", ...args], {
      cwd: repoRoot,
      env: quietNodeWarningsEnv(),
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

async function runTsxFile(
  filePath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(tsxBin, [filePath, ...args], {
      cwd: repoRoot,
      env: quietNodeWarningsEnv(),
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

function quietNodeWarningsEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--no-deprecation"].filter(Boolean).join(" "),
  };
}
