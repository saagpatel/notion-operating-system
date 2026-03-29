import { describe, expect, test } from "vitest";

import { buildDataSourceProperties } from "../src/publishing/property-validator.js";
import type { DataSourceSchemaSnapshot, DestinationConfig, ParsedInputFile } from "../src/types.js";

const parsed: ParsedInputFile = {
  absolutePath: "/tmp/example.md",
  rawText: "# Hello",
  body: "# Hello",
  frontmatter: {},
  firstHeading: "Hello",
  basename: "example",
};

const destination: DestinationConfig = {
  alias: "weekly_review",
  destinationType: "data_source",
  sourceUrl: "collection://abc",
  resolvedId: "abc",
  templateMode: "none",
  titleRule: {
    source: "first_heading",
    fallback: "Fallback",
  },
  fixedProperties: {},
  defaultProperties: {
    Status: "Draft",
    Tags: ["One", "Two"],
    Published: false,
  },
  mode: "create_new_page",
  safeDefaults: {
    allowDeletingContent: false,
    templatePollIntervalMs: 1500,
    templatePollTimeoutMs: 30000,
  },
};

const schema: DataSourceSchemaSnapshot = {
  id: "abc",
  title: "Weekly Reviews",
  titlePropertyName: "Title",
  properties: {
    Title: { name: "Title", type: "title", writable: true },
    Status: { name: "Status", type: "select", writable: true },
    Tags: { name: "Tags", type: "multi_select", writable: true },
    Published: { name: "Published", type: "checkbox", writable: true },
    Formula: { name: "Formula", type: "formula", writable: false },
  },
};

describe("buildDataSourceProperties", () => {
  test("converts common writable property types", () => {
    const result = buildDataSourceProperties({
      destination,
      schema,
      parsed,
    });

    expect(result.title).toBe("Hello");
    expect(result.properties.Title).toEqual({
      title: [{ type: "text", text: { content: "Hello" } }],
    });
    expect(result.properties.Status).toEqual({ select: { name: "Draft" } });
    expect(result.properties.Tags).toEqual({
      multi_select: [{ name: "One" }, { name: "Two" }],
    });
    expect(result.properties.Published).toEqual({ checkbox: false });
  });

  test("rejects non-writable properties", () => {
    expect(() =>
      buildDataSourceProperties({
        destination: {
          ...destination,
          defaultProperties: {
            Formula: "nope",
          },
        },
        schema,
        parsed,
      }),
    ).toThrow(/not writable/);
  });
});
