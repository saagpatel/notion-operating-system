import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { loadRuntimeConfig, safeLoadRuntimeConfig } from "../src/config/runtime-config.js";

describe("runtime config", () => {
  test("loads defaults and resolves runtime paths from the provided cwd", () => {
    const config = loadRuntimeConfig({
      cwd: "/tmp/notion-os",
      env: {},
    });

    expect(config.profile.configVersion).toBe(1);
    expect(config.profile.sourceConfigVersion).toBe(1);
    expect(config.notion.retryMaxAttempts).toBe(5);
    expect(config.notion.httpTimeoutMs).toBe(90_000);
    expect(config.profile.name).toBe("default");
    expect(config.paths.logDir).toBe(path.resolve("/tmp/notion-os", "./logs"));
    expect(config.paths.destinationsPath).toBe(path.resolve("/tmp/notion-os", "./config/destinations.json"));
    expect(config.paths.controlTowerConfigPath).toBe(
      path.resolve("/tmp/notion-os", "./config/local-portfolio-control-tower.json"),
    );
  });

  test("reports invalid numeric env values through the safe loader", () => {
    const result = safeLoadRuntimeConfig({
      cwd: "/tmp/notion-os",
      env: {
        NOTION_RETRY_MAX_ATTEMPTS: "zero",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected runtime config parsing to fail");
    }

    expect(result.issues.join(" ")).toContain("NOTION_RETRY_MAX_ATTEMPTS");
  });

  test("resolves an explicit named profile and lets the option override env selection", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "notion-runtime-profile-"));
    const profileDir = path.join(tempDir, "config", "profiles");
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      path.join(tempDir, "config", "profiles.json"),
      JSON.stringify({
        version: 1,
        defaultProfile: "alpha",
        profiles: ["alpha", "beta"],
      }),
      "utf8",
    );
    await writeFile(
      path.join(profileDir, "alpha.json"),
      JSON.stringify({
        name: "alpha",
        label: "Alpha Workspace",
        envFile: ".env.alpha",
        destinationsPath: "./config/profiles/alpha/destinations.json",
        controlTowerConfigPath: "./config/profiles/alpha/local-portfolio-control-tower.json",
      }),
      "utf8",
    );
    await writeFile(
      path.join(profileDir, "beta.json"),
      JSON.stringify({
        name: "beta",
        label: "Beta Workspace",
        envFile: ".env.beta",
        destinationsPath: "./config/profiles/beta/destinations.json",
        controlTowerConfigPath: "./config/profiles/beta/local-portfolio-control-tower.json",
      }),
      "utf8",
    );

    const config = loadRuntimeConfig({
      cwd: tempDir,
      env: {
        NOTION_PROFILE: "alpha",
      },
      profile: "beta",
    });

    expect(config.profile.name).toBe("beta");
    expect(config.profile.configVersion).toBe(1);
    expect(config.profile.sourceConfigVersion).toBe(0);
    expect(config.paths.envFile).toBe(path.resolve(tempDir, ".env.beta"));
    expect(config.paths.destinationsPath).toBe(
      path.resolve(tempDir, "./config/profiles/beta/destinations.json"),
    );
    expect(config.paths.controlTowerConfigPath).toBe(
      path.resolve(tempDir, "./config/profiles/beta/local-portfolio-control-tower.json"),
    );
  });
});
