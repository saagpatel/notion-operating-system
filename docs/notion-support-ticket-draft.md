# Notion API Support Ticket — Draft

**Endpoint:** `PATCH /pages/{id}/markdown`
**Account / token:** `saagpatel` Notion integration (internal token `NOTION_TOKEN`)
**First observed:** 2026-05-10 (Pacific)
**Status:** persistent, reproducible across 4+ distinct pages

## Summary

Every `PATCH /pages/{id}/markdown` request from our integration token closes the TCP socket without returning an HTTP response. Affected operations include `update_content` and `replace_content` modes. The corresponding `GET /pages/{id}/markdown` calls succeed cleanly (200 OK) on the same pages. This breaks our automation workflows that depend on managed markdown sections.

## Reproduction

We have a deterministic reproduction. Running the diagnostic at `scripts/diagnose-patch-failure-multi.mjs` against four distinct pages produces identical failures.

### Probe matrix

| Body | Body size | Result |
|---|---|---|
| `update_content` with placeholder `old_str` that doesn't match | 185 bytes | **200 → 400 validation_error** (server responded) |
| `update_content` with 200-char real-page `old_str` | 555 bytes | socket closed |
| `update_content` with 2 KB real-page `old_str` | 4191 bytes | socket closed |
| `update_content` with 2 KB **synthetic** `old_str` (`"a".repeat(2000)`) | 4151 bytes | socket closed |
| `replace_content` with the entire current page markdown as `new_str` | 19252 bytes | socket closed |

### Multi-page test

All four pages (one weekly review, one workspace dashboard, two project pages — markdown sizes 13-21 KB) fail identically on the 4 KB `update_content` probe.

## Underlying error

Node.js `undici` (fetch) reports:

```
TypeError: fetch failed
  cause: SocketError
  cause.message: "other side closed"
  cause.code: UND_ERR_SOCKET
```

This indicates the server closes the TCP socket mid-request without sending an HTTP response. No headers, no body, no status code returned.

## Request shape (illustrative)

```
PATCH https://api.notion.com/v1/pages/356c21f1-caf0-8113-a665-c2f45baabc10/markdown
Headers:
  Authorization: Bearer <integration-token>
  Notion-Version: 2026-03-11
  Content-Type: application/json
Body:
{
  "type": "update_content",
  "update_content": {
    "content_updates": [
      { "old_str": "<200+ chars of real page markdown>", "new_str": "<same string>", "replace_all_matches": false }
    ],
    "allow_deleting_content": false
  }
}
```

(The `old_str = new_str` shape is a no-op used for probing; production usage replaces an existing managed section's content with new content of similar size.)

## What we've ruled out

- **Not page-specific** — fails on 4 distinct pages across different databases (weekly reviews, dashboards, project pages).
- **Not version-specific** — same failure with `Notion-Version: 2026-03-11` (latest) and `2025-09-03`.
- **Not content-specific** — synthetic content (`"a".repeat(2000)`) fails identically to real page content.
- **Not size-only** — 185 bytes succeed (probe got a normal 400 response), 555 bytes fail. The cutoff is somewhere in between.
- **Not a client retry issue** — every retry across multiple attempts produces the same socket-close behavior.
- **Reads on the same pages succeed** — `GET /pages/{id}/markdown` returns 200 with valid markdown body.
- **Other Notion API endpoints work** — `GET /pages/{id}` (page properties), search, database queries all succeed for the same token.

## Hypotheses

1. A Cloudflare WAF or rate-limit rule on this endpoint is dropping connections for our token/IP combination.
2. The `/pages/{id}/markdown` PATCH endpoint has been disabled or scope-restricted for our integration.
3. There is an undocumented body-size or content-pattern limit that triggers connection closure rather than a 4xx response.

## Request

Please investigate why `PATCH /pages/{id}/markdown` is closing connections for our integration. If this endpoint has been deprecated or restricted, please confirm the migration path — our workflows are heavily dependent on it.

## Trace info

- Successful probe request_id (for cross-reference): `744dea38-c6a5-4f28-aaf3-8735ed95747b`
- Diagnostic script: `scripts/diagnose-patch-failure-multi.mjs` in the `notion-operating-system` repository

## Contact

GitHub: `saagpatel` · Email: saagar210@gmail.com
