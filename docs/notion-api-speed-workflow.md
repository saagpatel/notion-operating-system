# Notion API Speed Workflow

This workflow exists to keep portfolio maintenance from turning into a long broad Notion pass.

## Default fast path

Start with scoped triage:

```bash
npm run maintenance:weekly-refresh -- --fast
```

`--fast` bundles the speed defaults that are safe to apply together:

- caps project-page batches at 10 unless a different `--max-project-pages` is passed
- caps GitHub signal source reads at 5 and events per source at 5 unless overridden
- skips project pages already listed in the blocked markdown registry
- streams child-command progress so a stuck lane is visible quickly
- lowers the transient retry budget from 5 attempts to 2
- prints the compact summary first

## Clearing drift

When fast triage reports drift, do not run the full live weekly sequence first. Run only the drifting lane:

```bash
npm run maintenance:weekly-refresh -- --today <date> --only <step> --fast --live --confirm-full-live
npm run maintenance:weekly-refresh -- --today <date> --only <step> --fast
```

Live lane repairs still require explicit operator approval before running the live command.

Use the broad live command only when the operator explicitly wants a full weekly write sequence and accepts the runtime.

## Parallel work rules

Parallelize analysis, not live writes.

Good subagent or separate-chat work:

- classify new markdown blockers from logs
- review generated JSON summaries and identify the next lane
- design child-page or linked-record storage for managed briefs
- review tests and docs after code changes
- visually confirm Notion UI state in the signed-in browser

Avoid:

- multiple live Notion writers against the same integration
- parallel Command Center writers
- browser-driven bulk edits
- broad live weekly refresh as a repair shortcut

## Durable speed direction

The long-term fix is to stop treating direct project-page markdown as the primary storage layer for generated briefs. Move generated execution, intelligence, and external-signal briefs toward child pages, linked records, or structured properties, then keep project pages to lightweight links or summaries.

Until that migration exists, the blocked markdown registry is an exception list, not the final architecture.
