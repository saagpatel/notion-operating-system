import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release readiness", () => {
  test("package metadata supports GitHub installs without enabling npm publish", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      version: string;
      private: boolean;
      license?: string;
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
      keywords?: string[];
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson.private).toBe(true);
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/saagpatel/notion-operating-system.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/saagpatel/notion-operating-system");
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/saagpatel/notion-operating-system/issues",
    });
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining(["notion", "publishing", "cli", "automation"]),
    );
    expect(packageJson.files).toEqual(
      expect.arrayContaining(["dist/", "README.md", "LICENSE", "CHANGELOG.md"]),
    );
    expect(packageJson.scripts?.prepare).toBe("npm run build");
    expect(packageJson.scripts?.["pack:tarball"]).toBe("node scripts/pack-release.mjs");
    expect(packageJson.scripts?.["smoke:packed-install"]).toBe("node scripts/packed-install-smoke.mjs");
    expect(packageJson.scripts?.["release:prepare"]).toBe("npm run verify && npm run pack:tarball");
  });

  test("release-facing docs and workflow are present", async () => {
    const [licenseText, changelogText, releaseProcess, workflowText] = await Promise.all([
      readFile(path.join(repoRoot, "LICENSE"), "utf8"),
      readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
      readFile(path.join(repoRoot, "docs", "release-process.md"), "utf8"),
      readFile(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8"),
    ]);

    expect(licenseText).toContain("MIT License");
    expect(changelogText).toContain("## [0.2.0]");
    expect(releaseProcess).toContain("npm run release:prepare");
    expect(workflowText).toContain("workflow_dispatch:");
    expect(workflowText).toContain("npm run release:prepare");
    expect(workflowText).toContain("draft: true");
  });
});
