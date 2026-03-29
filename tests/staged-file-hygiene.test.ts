import { describe, expect, test } from "vitest";

// @ts-expect-error runtime-only helper script
import { validateStagedFiles } from "../scripts/check-staged-files.mjs";

describe("staged file hygiene", () => {
  test("allows normal repo files", () => {
    expect(validateStagedFiles(["README.md", "src/cli.ts"])).toEqual({
      ok: true,
      blocked: [],
    });
  });

  test("rejects machine-local and generated artifacts", () => {
    expect(validateStagedFiles([".env", "logs/run-1.jsonl", "dist/src/cli.js"])).toEqual({
      ok: false,
      blocked: [".env", "logs/run-1.jsonl", "dist/src/cli.js"],
    });
  });
});
