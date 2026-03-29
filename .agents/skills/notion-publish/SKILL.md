---
name: notion-publish
description: Publish a local markdown or text file into a configured Notion destination alias with dry-run first.
---

# notion-publish

## Use this when

- The user says "publish this file to Notion"
- The user gives a local `.md` or `.txt` file and a destination alias
- The user wants a dry-run preview or a safe live write

## Workflow

1. Read `README.md`, `DESTINATIONS.md`, and `config/destinations.json`.
2. Confirm the target alias exists.
3. Use dry-run first unless the user explicitly approves a live write.
4. Run:

   ```bash
   npm run publish:notion -- --destination <alias> --file <path> --dry-run
   ```

   Or with a request file:

   ```bash
   npm run publish:notion -- --request <request.json> --dry-run
   ```

5. If the user wants the live write and the token plus integration access are ready, rerun with `--live`.
6. Report:
   - destination alias
   - resolved page or data source
   - operation mode
   - properties applied
   - final page URL when available
   - any warnings about truncation or unknown block IDs

## Safety rules

- Do not put the Notion token into code or docs.
- Keep `allowDeletingContent=false` unless the user explicitly approves destructive replacement.
- If a destination uses a template, wait for template readiness before patching markdown.
