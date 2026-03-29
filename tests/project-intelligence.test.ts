import { describe, expect, test } from "vitest";

import {
  deriveCurrentState,
  deriveDocsQuality,
  derivePrimaryRunCommand,
  deriveTestPosture,
} from "../src/portfolio-audit/project-intelligence.js";

describe("project intelligence helpers", () => {
  test("prefers active build when recent local activity exists", () => {
    expect(
      deriveCurrentState({
        canonicalStatus: "In Progress",
        readiness: "🟡",
        completion: "70%",
        lastActive: new Date().toISOString().slice(0, 10),
        registryStatus: "active",
        canonicalVerdict: "Strong Candidate",
      }),
    ).toBe("Active Build");
  });

  test("chooses the strongest available run command", () => {
    expect(
      derivePrimaryRunCommand({
        packageScripts: ["lint", "dev:tauri", "test"],
        packageManager: "pnpm",
        hasPackageJson: true,
        hasCargoToml: true,
        hasPyproject: false,
        hasTauri: true,
      }),
    ).toBe("pnpm run dev:tauri");
  });

  test("maps documentation signals into a stable docs-quality rating", () => {
    expect(
      deriveDocsQuality({
        hasReadme: true,
        hasAgents: true,
        hasClaude: true,
        contextDocsCount: 3,
      }),
    ).toBe("Strong");
  });

  test("treats broad automated test coverage as strong posture", () => {
    expect(
      deriveTestPosture({
        hasTests: true,
        completion: "95%",
        codeQuality: "Tests: 158 Rust + 7 frontend + Playwright + a11y",
      }),
    ).toBe("Strong");
  });
});
