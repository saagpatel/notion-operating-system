import { describe, expect, test } from "vitest";

import {
  deriveValueOutcome,
  deriveWhatWorks,
  mergeNarrativeSources,
} from "../src/notion/project-narrative-backfill.js";

describe("project narrative backfill helpers", () => {
  test("derives value outcome from project category when explicit text is missing", () => {
    expect(
      deriveValueOutcome({
        title: "KBFreshnessDetector",
        category: "IT Tool",
        summary: "Rust/React app monitoring KB articles and support tickets.",
        primaryRunCommand: "cargo run",
        primaryContextDoc: "AGENTS.md",
        docsQuality: "Usable",
        testPosture: "Some",
        buildMaturity: "Demoable",
        shipReadiness: "Near Ship",
        readiness: "",
        projectHealthNotes: "",
        valueOutcome: "",
        whatWorks: "",
      }),
    ).toBe("Shortens repetitive operational work and improves response quality.");
  });

  test("promotes concrete readiness evidence into what works text", () => {
    expect(
      deriveWhatWorks({
        title: "BattleGrid",
        category: "Game",
        summary: "Real-time multiplayer hex strategy game.",
        primaryRunCommand: "",
        primaryContextDoc: "",
        docsQuality: "Usable",
        testPosture: "Strong",
        buildMaturity: "Feature Complete",
        shipReadiness: "Near Ship",
        readiness: "✅ | 328 tests",
        projectHealthNotes: "",
        valueOutcome: "",
        whatWorks: "",
      }),
    ).toBe("There is already meaningful verification coverage (328 tests), and the core real-time multiplayer hex strategy game is in place.");
  });

  test("falls back to current evidence when no explicit works note exists", () => {
    expect(
      deriveWhatWorks({
        title: "ShipKit",
        category: "Desktop App",
        summary: "Reusable Rust + Tauri foundation library.",
        primaryRunCommand: "pnpm run build",
        primaryContextDoc: "AGENTS.md",
        docsQuality: "Usable",
        testPosture: "Some",
        buildMaturity: "Feature Complete",
        shipReadiness: "Needs Hardening",
        readiness: "",
        projectHealthNotes: "",
        valueOutcome: "",
        whatWorks: "",
      }),
    ).toBe(
      "The Reusable Rust + Tauri foundation library is already in place and far enough along to harden instead of restart, with a defined run path via `pnpm run build`, usable context in `AGENTS.md`, and some test coverage.",
    );
  });

  test("merges duplicate title sources by keeping the richest available fields", () => {
    const merged = mergeNarrativeSources([
      {
        title: "EarthPulse",
        category: "Desktop App",
        summary: "",
        primaryRunCommand: "",
        primaryContextDoc: "",
        docsQuality: "",
        testPosture: "",
        buildMaturity: "",
        shipReadiness: "",
        readiness: "",
        projectHealthNotes: "",
        valueOutcome: "",
        whatWorks: "",
      },
      {
        title: "EarthPulse",
        category: "Desktop App",
        summary: "Weather and climate dashboard.",
        primaryRunCommand: "pnpm run dev",
        primaryContextDoc: "AGENTS.md",
        docsQuality: "Usable",
        testPosture: "Some",
        buildMaturity: "Demoable",
        shipReadiness: "Near Ship",
        readiness: "",
        projectHealthNotes: "",
        valueOutcome: "Strong showcase value and a credible portfolio story when polished.",
        whatWorks: "",
      },
    ]);

    expect(merged?.summary).toBe("Weather and climate dashboard.");
    expect(merged?.primaryRunCommand).toBe("pnpm run dev");
    expect(merged?.valueOutcome).toBe("Strong showcase value and a credible portfolio story when polished.");
  });
});
