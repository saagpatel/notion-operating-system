# Personal Ops Coordination Ingestion

Personal Ops owns generation of the Coordination Snapshot. Notion owns durable display and ledger workflows.

The Notion-side path defaults to dry-run:

```bash
notion-os signals coordination-snapshot --input /path/to/personal-ops-coordination-export.json
notion-os signals coordination-snapshot --input /path/to/personal-ops-coordination-export.json --json
```

The command accepts the `personal_ops.coordination_notion_export.v1` payload emitted by:

```bash
personal-ops coordination export --for notion --json --output /path/to/personal-ops-coordination-export.json
```

It validates the schema, snapshot identity, dry-run handoff contract, unique dedupe keys, and evidence references before converting rows into an ingestion plan for External Signal Events. The default plan reports `write_scope: none`, `planned_writes: 0`, deferred row counts, and `Dry-run contract: verified`.

The first hardening pass intentionally fails early if a row does not match the source snapshot id, has a duplicate dedupe key, lacks evidence, or if the Personal Ops export no longer declares `write_mode: dry_run_only`.

An approved live event-write lane now exists, but it is locked behind all three flags:

```bash
notion-os signals coordination-snapshot --input /path/to/personal-ops-coordination-export.json --live --write-scope events --confirm-live --json
```

That live lane only writes External Signal Events. It looks up the active External Signal Source row with `Identifier = personal_ops_coordination_snapshot`, upserts event rows by `dedupe_key`, and reads each event back before reporting success.

## Current Proof

On 2026-05-10, the manual green-loop proof passed end to end before the live gate was added:

- `personal-ops workflow morning --json` surfaced the Coordination section with `health: green`, current source freshness, 5 Notion handoff rows, and `planned_writes: 0`.
- `personal-ops coordination diff --against last-green --json` reported 0 changes against the trusted green baseline.
- `npm --prefix /Users/d/Notion run signals:coordination-snapshot -- --input <coordination-export.json> --json` validated the live Personal Ops export with 5 planned items, unique dedupe keys, evidence on every row, and zero Notion writes.
- Contract fixtures live in `tests/fixtures/personal-ops-coordination-export.v1.json` and `tests/fixtures/personal-ops-coordination-ingestion-plan.v1.json` so future schema drift is caught before a live Notion lane is added.

The installed `notion-os` binary was not on PATH in the shell used for this proof, so the repo-local npm alias was used as the verified command path.

Later on 2026-05-10, the implementation proof for the approved write gate passed its targeted tests, and the Personal Ops export still validated through the Notion dry-run consumer. The broader coordination burn-in was yellow at that point because the source snapshot reported current coordination health as yellow and one source-quality check was failing; that needs repair before the live command should be used against Notion.

## Controlled Ingestion Lane

The first live-capable lane remains separate from the default dry-run path. These gates are now encoded in the command or required before use:

1. Source row exists: Notion has a single active External Signal Source for `personal_ops_coordination_snapshot`.
2. Destination is explicit: rows write only to External Signal Events, not project pages, weekly reviews, Command Center markdown, or Personal Ops state.
3. Dedupe is deterministic: `dedupe_key` is the upsert key, and a repeated snapshot updates or skips the same event instead of creating duplicates.
4. Review display is bounded: `needs_review` rows are visible as active review signals, while `archive_candidate` rows can be hidden or marked quiet without deletion.
5. Deferred Notion row stays visible: the `source:notion:deferred` row remains a Watch signal until a separate Notion-owned live snapshot source is approved.
6. Approval is explicit: the command still defaults to dry-run and requires `--live --write-scope events --confirm-live` before any Notion mutation.
7. Read-back is required: every write path reads back the created or updated event rows and fails if a planned dedupe key is missing after the write.

The safest implementation shape is:

```bash
npm run signals:coordination-snapshot -- --input /path/to/export.json --json
npm run signals:coordination-snapshot -- --input /path/to/export.json --write-scope events --live --confirm-live --json
npm run signals:coordination-snapshot -- --input /path/to/export.json --json
```

The live command should only support `--write-scope events` at first. Provider/source setup, project-page rollups, weekly-review sections, and Command Center display should stay out of this lane until the event ingestion path proves stable.

## Current Follow-Up

Before using the live command against Notion:

- repair the failing Personal Ops coordination source-quality check
- rerun `personal-ops coordination burn-in --json` until the snapshot is green
- confirm the active Notion source row exists for `personal_ops_coordination_snapshot`
- run dry-run, live, then dry-run again and compare the planned item count to the written/read-back count
