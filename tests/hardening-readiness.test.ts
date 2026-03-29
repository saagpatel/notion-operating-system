import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("hardening readiness", () => {
  test("package scripts cover git installs and fresh workspace verification", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:git-install"]).toBe("node scripts/git-install-smoke.mjs");
    expect(packageJson.scripts?.["verify:fresh-clone"]).toBe("node scripts/fresh-clone-verify.mjs");
    expect(packageJson.scripts?.verify).toContain("npm run smoke:git-install");
  });

  test("ci and dependency workflows cover the hardening lanes", async () => {
    const [ciWorkflow, dependencyWorkflow, dependabot] = await Promise.all([
      readFile(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"),
      readFile(path.join(repoRoot, ".github", "workflows", "dependency-hygiene.yml"), "utf8"),
      readFile(path.join(repoRoot, ".github", "dependabot.yml"), "utf8"),
    ]);

    expect(ciWorkflow).toContain("workflow-lint:");
    expect(ciWorkflow).toContain("quality-gates:");
    expect(ciWorkflow).toContain("fresh-clone-verify:");
    expect(ciWorkflow).toContain("npm run smoke:git-install");
    expect(ciWorkflow).toContain("node scripts/audit-report.mjs tmp/npm-audit.json");

    expect(dependencyWorkflow).toContain("schedule:");
    expect(dependencyWorkflow).toContain("workflow_dispatch:");
    expect(dependencyWorkflow).toContain("npm audit --json > tmp/npm-audit.json || true");
    expect(dependencyWorkflow).toContain("--fail-on-vulnerabilities");

    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain("production-dependencies:");
    expect(dependabot).toContain("development-tooling:");
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
  });

  test("docs reflect governance, install modes, and sandbox discipline", async () => {
    const [readme, handoff, portability, releaseProcess, contributing] = await Promise.all([
      readFile(path.join(repoRoot, "README.md"), "utf8"),
      readFile(path.join(repoRoot, "HANDOFF.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "github-portability.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "release-process.md"), "utf8"),
      readFile(path.join(repoRoot, "CONTRIBUTING.md"), "utf8"),
    ]);

    expect(readme).toContain("GitHub ref install");
    expect(readme).toContain("GitHub release tarball install");
    expect(readme).toContain("local repo development");
    expect(readme).toContain("Sandbox Profile Discipline");

    expect(handoff).toContain("Branch: `main`");
    expect(handoff).not.toContain("codex/phase-10-github-release-readiness");

    expect(portability).toContain("Consumer install modes");
    expect(releaseProcess).toContain("Release checklist");
    expect(contributing).toContain("`main` is protected");
  });
});
