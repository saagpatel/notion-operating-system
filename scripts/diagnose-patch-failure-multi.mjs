#!/usr/bin/env node
// Multi-page probe: confirm whether PATCH /pages/{id}/markdown failure is
// page-specific or global. Runs PROBE 2 (4KB real-content update) against
// several distinct pages and reports per-page outcomes.

import { config as loadEnv } from "dotenv";
loadEnv();

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("NOTION_TOKEN required");
  process.exit(1);
}

const NOTION_VERSION = "2026-03-11";

// Mix of distinct page types we can confirm exist.
const PAGES = [
  { id: "356c21f1-caf0-8113-a665-c2f45baabc10", label: "weekly review (known-failing)" },
  { id: "35cc21f1-caf0-8188-99ca-d0f376d29136", label: "Command Center" },
  { id: "326c21f1-caf0-81c3-8759-e5aa28dee730", label: "LoreKeeper project" },
  { id: "326c21f1-caf0-8199-be5f-f43dfdc02cdb", label: "Construction project" },
];

async function readMarkdown(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}/markdown`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  return {
    status: res.status,
    markdown: typeof body.markdown === "string" ? body.markdown : "",
    truncated: Boolean(body.truncated),
    bodyRaw: body,
  };
}

async function probe(pageId, label, markdown) {
  const slice = markdown.slice(0, Math.min(2000, markdown.length));
  if (!slice) {
    return { label, result: "skip", reason: "empty markdown" };
  }
  const body = {
    type: "update_content",
    update_content: {
      content_updates: [{ old_str: slice, new_str: slice, replace_all_matches: false }],
      allow_deleting_content: false,
    },
  };
  const bodyStr = JSON.stringify(body);
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}/markdown`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    const text = await res.text();
    return {
      label,
      result: res.ok ? "success" : `http_${res.status}`,
      bodyBytes: Buffer.byteLength(bodyStr, "utf8"),
      response: text.slice(0, 300),
    };
  } catch (err) {
    return {
      label,
      result: "fetch_failed",
      bodyBytes: Buffer.byteLength(bodyStr, "utf8"),
      causeName: err?.cause?.name,
      causeMessage: err?.cause?.message,
      causeCode: err?.cause?.code,
    };
  }
}

console.log("=== Multi-page PATCH probe ===\n");

for (const page of PAGES) {
  console.log(`--- ${page.label} (${page.id}) ---`);
  let read;
  try {
    read = await readMarkdown(page.id);
  } catch (err) {
    console.log(`READ FAILED: ${err?.cause?.message ?? err?.message}\n`);
    continue;
  }
  if (read.status !== 200) {
    console.log(`READ STATUS ${read.status}: ${JSON.stringify(read.bodyRaw).slice(0, 200)}\n`);
    continue;
  }
  const markdownBytes = Buffer.byteLength(read.markdown, "utf8");
  console.log(`read OK: ${markdownBytes} bytes markdown`);
  const result = await probe(page.id, page.label, read.markdown);
  console.log(`PATCH probe → ${result.result}`);
  if (result.causeName) {
    console.log(`  cause: ${result.causeName} ${result.causeMessage} (${result.causeCode})`);
  }
  if (result.response) {
    console.log(`  response: ${result.response}`);
  }
  console.log();
}
