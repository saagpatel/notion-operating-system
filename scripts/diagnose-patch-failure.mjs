#!/usr/bin/env node
// Diagnostic: probe the failing PATCH /pages/{id}/markdown endpoint
// to surface the real underlying error (Node's `fetch failed` hides .cause).

import { config as loadEnv } from "dotenv";
loadEnv();

const PAGE_ID = "356c21f1-caf0-8113-a665-c2f45baabc10";
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("NOTION_TOKEN required");
  process.exit(1);
}

const NOTION_VERSION = "2025-09-03";

async function readMarkdown() {
  const res = await fetch(`https://api.notion.com/v1/pages/${PAGE_ID}/markdown`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  return {
    status: res.status,
    ok: res.ok,
    markdown: typeof body.markdown === "string" ? body.markdown : "",
    truncated: Boolean(body.truncated),
    raw: body,
  };
}

async function attemptPatch(label, body) {
  const bodyStr = JSON.stringify(body);
  console.log(`\n--- ${label} (body bytes: ${Buffer.byteLength(bodyStr, "utf8")}) ---`);
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${PAGE_ID}/markdown`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    const text = await res.text();
    console.log(`status: ${res.status}`);
    console.log(`body: ${text.slice(0, 500)}`);
  } catch (err) {
    console.log(`error name: ${err?.name}`);
    console.log(`error message: ${err?.message}`);
    console.log(`error code: ${err?.code}`);
    if (err?.cause) {
      console.log(`cause name: ${err.cause?.name}`);
      console.log(`cause message: ${err.cause?.message}`);
      console.log(`cause code: ${err.cause?.code}`);
      console.log(`cause errno: ${err.cause?.errno}`);
      console.log(`cause syscall: ${err.cause?.syscall}`);
    }
  }
}

console.log("=== Reading page ===");
const read = await readMarkdown();
console.log(`status: ${read.status}, markdown bytes: ${Buffer.byteLength(read.markdown, "utf8")}, truncated: ${read.truncated}`);

// Probe 1: minimal append (1 tiny update — should always work)
await attemptPatch("PROBE 1: tiny content_update", {
  type: "update_content",
  update_content: {
    content_updates: [
      { old_str: "DOES_NOT_EXIST_PLACEHOLDER_XYZ123", new_str: "x", replace_all_matches: false },
    ],
    allow_deleting_content: false,
  },
});

// Probe 2: realistic morning-brief-size update (old_str = a chunk of the actual page)
const slice = read.markdown.slice(0, 2000);
await attemptPatch("PROBE 2: 2KB update with old_str = first 2KB of page", {
  type: "update_content",
  update_content: {
    content_updates: [{ old_str: slice, new_str: slice, replace_all_matches: false }],
    allow_deleting_content: false,
  },
});

// Probe 3: full page replace (mimic morning-brief worst case)
await attemptPatch("PROBE 3: replace_content with the entire current page", {
  type: "replace_content",
  replace_content: {
    new_str: read.markdown,
    allow_deleting_content: false,
  },
});

// Probe 4: 2KB of synthetic content (no real page text) — isolate size vs content
const synthetic = "a".repeat(2000);
await attemptPatch("PROBE 4: 2KB synthetic update (no real page text in old_str)", {
  type: "update_content",
  update_content: {
    content_updates: [{ old_str: synthetic, new_str: synthetic, replace_all_matches: false }],
    allow_deleting_content: false,
  },
});

// Probe 5: try a 2KB substring from later in the page (not the front)
const lateSlice = read.markdown.slice(Math.max(0, read.markdown.length - 2000));
await attemptPatch("PROBE 5: 2KB tail slice of page as old_str", {
  type: "update_content",
  update_content: {
    content_updates: [{ old_str: lateSlice, new_str: lateSlice, replace_all_matches: false }],
    allow_deleting_content: false,
  },
});

// Probe 6: small real-content update (200 chars of real page text)
const tinyReal = read.markdown.slice(0, 200);
await attemptPatch("PROBE 6: 200 chars of real page text", {
  type: "update_content",
  update_content: {
    content_updates: [{ old_str: tinyReal, new_str: tinyReal, replace_all_matches: false }],
    allow_deleting_content: false,
  },
});
