# Destination Aliases

`config/destinations.json` is the local registry that maps a friendly alias like `weekly_reviews` to a real Notion parent page or data source.

## Active aliases in this repo

- `weekly_reviews` -> `📅 Weekly Reviews`
- `build_log` -> `🔨 Build Log`
- `project_portfolio` -> `📦 Project Portfolio`
- `local_portfolio_projects` -> `Local Portfolio Projects`
- `local_portfolio_command_center` -> `Local Portfolio Audit` parent, then the stable command-center page after bootstrap
- `skills_library` -> `🤹 Skills Library`
- `research_library` -> `📚 Research Library`
- `ai_tool_site_matrix` -> `🧠 AI Tool & Site Matrix`

## Alias shape

Each destination supports:

- `alias`: friendly command name
- `destinationType`: `page` or `data_source`
- `sourceUrl`: the original Notion URL or `collection://...` data source URL
- `resolvedId`: optional stored `page_id` or `data_source_id`
- `templateMode`: `none`, `default`, or `specific`
- `templateId` or `templateName`: optional template selection
- `titleRule`: how the publish title is derived
- `fixedProperties`: property values users cannot override
- `defaultProperties`: baseline property values users can override
- `mode`: `create_new_page`, `update_existing_page`, `replace_full_content`, or `targeted_search_replace`
- `lookup`: how to find an existing page for update modes
- `safeDefaults`: publish safety behavior
- `schemaSnapshot`: optional offline schema copy for dry-run when no token is present

## How to add a new destination

1. Copy an existing destination block in `config/destinations.json`.
2. Choose a stable `alias`.
3. Set `destinationType`.
4. Paste the Notion `sourceUrl`.
5. Pick a `mode`.
6. Add `templateMode` only if the parent is a data source and you want a template.
7. Add `fixedProperties` and `defaultProperties` only for writable properties.
8. Run:

   ```bash
   npm run destinations:resolve
   ```

9. Run a dry-run publish before any live write.

## Notes on updates

- `replace_full_content` targets an existing page and replaces all markdown.
- `targeted_search_replace` requires explicit `contentUpdates` in the request file.
- `update_existing_page` only updates properties unless request content updates are supplied.
- `schemaSnapshot` is useful for local dry-runs before the real integration token is configured.
- `local_portfolio_command_center` starts as a parent-page bootstrap alias and is patched to a stable page alias after the first live control-tower sync.

## Notes on page parents

When `destinationType` is `page`, Notion only accepts the plain page `title` property on creation. Other properties are not valid until the page lives inside a data source.
