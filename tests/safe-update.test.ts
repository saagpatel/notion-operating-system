import { describe, expect, test } from "vitest";

import { assertSafeReplacement } from "../src/utils/markdown.js";

describe("assertSafeReplacement", () => {
  test("throws when a child database block would be removed", () => {
    const previous = '<database url="https://www.notion.so/db">Database</database>';
    const next = "# Replacement";

    expect(() => assertSafeReplacement(previous, next)).toThrow(/Refusing to replace/);
  });

  test("allows replacements that preserve child references", () => {
    const previous = '<database url="https://www.notion.so/db">Database</database>';
    const next = `${previous}\n# Replacement`;

    expect(() => assertSafeReplacement(previous, next)).not.toThrow();
  });
});
