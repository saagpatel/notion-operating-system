---
title: ADR-001 Local Notion Publisher
---

# Decision

We will publish to Notion from local files through a direct REST client instead of relying on MCP.

## Why

- Easier to reuse across future Codex sessions
- Better control over retries and logging
- Clearer separation of secrets and code

## Consequences

- We need a Notion integration token
- Destinations must be shared with that integration
